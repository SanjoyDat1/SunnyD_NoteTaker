"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { useApiHealth } from "@/contexts/ApiHealthContext";
import {
  getWordCount,
  findSafeInsertionPoint,
  wrapProactiveCard,
  PROACTIVE_BORDER_COLORS,
} from "@/lib/context";
import { markdownToHtml, escapeHtml } from "@/lib/utils";
import type { ProactiveIntervention } from "@/app/api/ai/proactive/route";

const PROACTIVE_WORD_INTERVAL = 60;

export interface UseProactiveInsertionsOptions {
  onScanStart?: () => void;
  onScanEnd?: () => void;
  /** Called with segment position during scan, null when done */
  onThinkingChange?: (position: { from: number; to: number } | null) => void;
  settleOn: (anchorText: string) => void;
  startScan: (
    onComplete?: (settleOnText?: string) => void,
    opts?: { onSegment?: (from: number, to: number) => void }
  ) => void;
}

/**
 * Triggers proactive analysis every N words written.
 * Runs scan animation, fetches interventions, inserts SunnyD cards.
 */
export function useProactiveInsertions(
  editor: Editor | null,
  noteType: string,
  options: UseProactiveInsertionsOptions
) {
  const { isEnabled } = useSunnyD();
  const { isHealthy: isApiHealthy } = useApiHealth();
  const {
    onScanStart,
    onScanEnd,
    onThinkingChange,
    settleOn,
    startScan,
  } = options;

  const wordCountAtLastProactiveRef = useRef(0);
  const inProgressRef = useRef(false);

  const runProactiveAnalysis = useCallback(async () => {
    if (!editor?.view || !isEnabled("proactive") || !isApiHealthy() || inProgressRef.current)
      return;

    const fullText = editor.state.doc.textContent;
    if (fullText.trim().length < 80) return;

    inProgressRef.current = true;
    onScanStart?.();
    startScan(undefined, {
      onSegment: (from, to) => onThinkingChange?.({ from, to }),
    });

    try {
      const res = await fetch("/api/ai/proactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullText,
          noteType,
        }),
      });

      if (!res.ok) {
        onThinkingChange?.(false);
        onScanEnd?.();
        return;
      }

      const { interventions } = (await res.json()) as {
        interventions: ProactiveIntervention[];
      };

      onThinkingChange?.(null);
      onScanEnd?.();

      if (!interventions?.length) return;

      for (const iv of interventions) {
        if (!iv.anchorText || !iv.content) continue;

        settleOn(iv.anchorText);

        await new Promise((r) => setTimeout(r, 400));

        const doc = editor.state.doc;
        const slice = iv.anchorText.slice(0, 25);
        let insertPos = doc.content.size;
        doc.descendants((node, pos) => {
          if (node.isBlock && node.textContent.includes(slice)) {
            insertPos = pos + node.nodeSize;
            return false;
          }
          return true;
        });

        insertPos = findSafeInsertionPoint(editor, Math.max(0, insertPos - 1));

        const borderColor =
          PROACTIVE_BORDER_COLORS[iv.type] ??
          PROACTIVE_BORDER_COLORS.CLARIFY;
        const label = iv.label || "SunnyD";

        let innerHtml: string;
        if (iv.type === "QUIZ") {
          const match = iv.content.match(/\s*Q:\s*(.+?)\s*\|\s*A:\s*(.+)/is);
          const question = (match?.[1] ?? iv.content).trim();
          const answer = (match?.[2] ?? "").trim();
          innerHtml = `
            <p class="sunnyd-quiz-q">${escapeHtml(question)}</p>
            <button type="button" class="sunnyd-quiz-reveal">Reveal →</button>
            <p class="sunnyd-quiz-a" style="display:none;">${escapeHtml(answer)}</p>
          `;
        } else {
          const html = markdownToHtml(iv.content);
          innerHtml = `<p class="sunnyd-crafting">${html}</p>`;
        }

        const cardHtml = wrapProactiveCard(innerHtml, {
          label,
          cardType: iv.type,
          borderColor,
        });

        editor
          .chain()
          .insertContentAt(insertPos, cardHtml, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .run();

        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      inProgressRef.current = false;
    }
  }, [
    editor,
    noteType,
    isEnabled,
    isApiHealthy,
    onScanStart,
    onScanEnd,
    onThinkingChange,
    settleOn,
    startScan,
  ]);

  useEffect(() => {
    if (!editor || !isEnabled("proactive")) return;

    const onUpdate = () => {
      const wc = getWordCount(editor);
      if (wc - wordCountAtLastProactiveRef.current >= PROACTIVE_WORD_INTERVAL) {
        wordCountAtLastProactiveRef.current = wc;
        runProactiveAnalysis();
      }
    };

    editor.on("update", onUpdate);
    return () => editor.off("update", onUpdate);
  }, [editor, isEnabled, runProactiveAnalysis]);
}
