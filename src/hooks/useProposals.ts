"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import {
  extractDocumentText,
  findActionItemsSectionPos,
  getDocEndPos,
  findAnchorInDoc,
  findSafeInsertionPoint,
  wrapInSunnyDCard,
} from "@/lib/context";
import { escapeHtml } from "@/lib/utils";

export interface Proposal {
  targetText: string;
  action: string;
  preview: string;
  label: string;
  from?: number;
  to?: number;
}

const PROPOSE_DEBOUNCE_MS = 4000;
const MIN_WORDS_FOR_PROPOSE = 100;

export interface UseProposalsOptions {
  onFetchStart?: () => void;
}

export function useProposals(
  editor: Editor | null,
  noteType: string,
  options?: UseProposalsOptions
): {
  proposals: Proposal[];
  loading: boolean;
  applyProposal: (p: Proposal) => void | Promise<void>;
  dismissProposal: (p: Proposal) => void;
} {
  const { onFetchStart } = options ?? {};
  const { isEnabled } = useSunnyD();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const dismissedRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchProposals = useCallback(async () => {
    if (!editor || !isEnabled("proposalMarkers")) return;

    const docText = extractDocumentText(editor);
    const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_FOR_PROPOSE) {
      setProposals([]);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    onFetchStart?.();

    try {
      const res = await fetch("/api/ai/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullDocumentText: docText,
          noteType,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || abortRef.current.signal.aborted) {
        setLoading(false);
        return;
      }

      const json = await res.json();
      const raw: Proposal[] = json.proposals ?? [];

      const doc = editor.state.doc;
      const mapped: Proposal[] = [];
      for (const p of raw) {
        if (dismissedRef.current.has(`${p.targetText}-${p.label}`)) continue;
        const range = findAnchorInDoc(doc, p.targetText);
        if (range) {
          mapped.push({ ...p, from: range.from, to: range.to });
        }
        if (mapped.length >= 3) break;
      }

      if (!abortRef.current.signal.aborted) {
        setProposals(mapped);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [editor, noteType, isEnabled, onFetchStart]);

  useEffect(() => {
    if (!editor || !isEnabled("proposalMarkers")) {
      setProposals([]);
      return;
    }

    const schedule = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortRef.current?.abort();

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        fetchProposals();
      }, PROPOSE_DEBOUNCE_MS);
    };

    editor.on("update", schedule);
    schedule();

    return () => {
      editor.off("update", schedule);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [editor, fetchProposals, isEnabled]);

  const applyProposal = useCallback(
    async (p: Proposal) => {
      if (!editor || p.from == null || p.to == null) return;

      const wordCount = p.preview.trim().split(/\s+/).filter(Boolean).length;
      const needsCritique =
        wordCount > 15 &&
        ["INSERT_AFTER", "APPEND_EXAMPLE", "ADD_CONTEXT", "REPLACE", "COMPLETE_THOUGHT"].includes(
          p.action
        );

      let previewToInsert = p.preview;
      if (needsCritique) {
        try {
          const res = await fetch("/api/ai/critique", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generated: p.preview }),
          });
          const json = await res.json();
          if (json.result === "") {
            setProposals((prev) => prev.filter((x) => x !== p));
            return;
          }
          previewToInsert = json.result;
        } catch {
          // on error, use original
        }
      }

      const safe = escapeHtml(previewToInsert);
      const innerHtml = `<p class="sunnyd-crafting">${safe}</p>`;
      const cardHtml = wrapInSunnyDCard(innerHtml);

      switch (p.action) {
        case "INSERT_AFTER":
        case "APPEND_EXAMPLE":
        case "ADD_CONTEXT": {
          const rawPos = editor.state.doc.resolve(p.to).after();
          const insertPos = findSafeInsertionPoint(editor, rawPos);
          editor
            .chain()
            .insertContentAt(insertPos, cardHtml, {
              parseOptions: { preserveWhitespace: "full" },
            })
            .setMeta("addToHistory", true)
            .run();
          break;
        }
        case "REPLACE":
        case "COMPLETE_THOUGHT": {
          editor
            .chain()
            .deleteRange({ from: p.from, to: p.to })
            .insertContentAt(
              p.from,
              cardHtml,
              { parseOptions: { preserveWhitespace: "full" } }
            )
            .setMeta("addToHistory", true)
            .run();
          break;
        }
        case "EXTRACT_ACTION": {
          const targetPos = findActionItemsSectionPos(editor);
          const docEnd = getDocEndPos(editor);
          const itemHtml = `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p class="sunnyd-crafting">${safe}</p></li></ul>`;
          editor
            .chain()
            .deleteRange({ from: p.from, to: p.to })
            .insertContentAt(
              targetPos ?? docEnd,
              targetPos
                ? itemHtml
                : `<h2>Action Items</h2>${itemHtml}`,
              { parseOptions: { preserveWhitespace: "full" } }
            )
            .setMeta("addToHistory", true)
            .run();
          break;
        }
        case "FLAG_CONTRADICTION":
          editor
            .chain()
            .insertContentAt(
              p.to,
              ` <span class="sunnyd-flag">${p.preview}</span>`,
              { parseOptions: { preserveWhitespace: "full" } }
            )
            .setMeta("addToHistory", true)
            .run();
          break;
        default: {
          const $p = editor.state.doc.resolve(p.to);
          const rawPos = $p.after();
          const insertPos = findSafeInsertionPoint(editor, rawPos);
          editor
            .chain()
            .insertContentAt(insertPos, cardHtml, {
              parseOptions: { preserveWhitespace: "full" },
            })
            .setMeta("addToHistory", true)
            .run();
        }
      }

      setProposals((prev) => prev.filter((x) => x !== p));
    },
    [editor]
  );

  const dismissProposal = useCallback((p: Proposal) => {
    dismissedRef.current.add(`${p.targetText}-${p.label}`);
    setProposals((prev) => prev.filter((x) => x !== p));
  }, []);

  return {
    proposals,
    loading,
    applyProposal,
    dismissProposal,
  };
}
