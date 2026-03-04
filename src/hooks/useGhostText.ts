"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { useApiHealth } from "@/contexts/ApiHealthContext";
import {
  extractTextBefore,
  extractLastSentence,
  extractEarlierContent,
  getWordCount,
  getLastListItems,
  isCursorInHeading,
  isCursorOnEmptyListItem,
  isLastCharSlash,
} from "@/lib/context";
import { shouldTriggerGhostText } from "@/lib/triggers";

const STUCK_THRESHOLD_MS = 2200;
const MIN_WORDS_IN_SENTENCE = 3;
const LIST_DEBOUNCE_MS = 600;
const COOLDOWN_AFTER_ACCEPT_MS = 500;

const INCOMPLETE_ENDINGS =
  /[,;:\-–]$|(\b(and|but|or|so|because|when|if|that|which|who|the|a|an|to|of|in|on|at|for|with|by)\s*)$/i;

function isUserStuck(textBeforeCursor: string): boolean {
  const lastSentence =
    textBeforeCursor.split(/[.!?\n]/).pop()?.trim() ?? "";

  if (lastSentence.split(/\s+/).filter(Boolean).length < MIN_WORDS_IN_SENTENCE)
    return false;

  if (/[.!?]$/.test(textBeforeCursor.trim())) return false;

  if (INCOMPLETE_ENDINGS.test(lastSentence)) return true;

  if (lastSentence.split(/\s+/).filter(Boolean).length > 12) return true;

  return false;
}
const CONTEXT_CHARS = 800;

export type GhostTextStatus = "idle" | "pending" | "ready";

export interface UseGhostTextReturn {
  status: GhostTextStatus;
  /** True when ghost is NEEDS_NUMBER (show verify ✱) */
  needsVerifyStatistic: boolean;
  acceptGhost: () => void;
  dismissGhost: () => void;
  onGhostAccepted: () => void;
}

export interface UseGhostTextOptions {
  onRequestStart?: () => void;
}

/**
 * Two-stage intent prediction: classify → fulfill.
 * Replaces "what comes next" with "what would a brilliant friend do?"
 */
export function useGhostText(
  editor: Editor | null,
  noteType: string,
  slashMenuOpen: boolean,
  options?: UseGhostTextOptions
): UseGhostTextReturn {
  const { level, isEnabled } = useSunnyD();
  const { isHealthy: isApiHealthy } = useApiHealth();
  const { onRequestStart } = options ?? {};
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastAcceptTimeRef = useRef<number>(0);
  const cachedIntentRef = useRef<string | null>(null);
  const cachedParagraphKeyRef = useRef<string>("");
  const [status, setStatus] = useState<GhostTextStatus>("idle");
  const [needsVerifyStatistic, setNeedsVerifyStatistic] = useState(false);

  const clearGhost = useCallback(() => {
    if (editor) {
      (editor.commands as { clearGhostText?: () => boolean }).clearGhostText?.();
    }
  }, [editor]);

  const dismissGhost = useCallback(() => {
    clearGhost();
    setStatus("idle");
    setNeedsVerifyStatistic(false);
  }, [clearGhost]);

  const acceptGhost = useCallback(() => {
    if (editor) {
      (editor.commands as { insertGhostText?: () => boolean }).insertGhostText?.();
      lastAcceptTimeRef.current = Date.now();
      cachedIntentRef.current = null;
      cachedParagraphKeyRef.current = "";
      setStatus("idle");
      setNeedsVerifyStatistic(false);
    }
  }, [editor]);

  const onGhostAccepted = useCallback(() => {
    lastAcceptTimeRef.current = Date.now();
    cachedIntentRef.current = null;
    cachedParagraphKeyRef.current = "";
    setStatus("idle");
    setNeedsVerifyStatistic(false);
  }, []);

  const fireRequest = useCallback(async () => {
    if (!editor || !editor.isEditable || !isEnabled("ghostText")) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const wordCount = getWordCount(editor);
    const { from, to, empty } = editor.state.selection;
    const isSelecting = !empty;
    const lastCharIsSlash = isLastCharSlash(editor);
    const cursorInHeading = isCursorInHeading(editor);
    const onEmptyListItem = isCursorOnEmptyListItem(editor);

    if (onEmptyListItem && !isEnabled("listContinuation")) {
      setStatus("idle");
      return;
    }

    if (
      !onEmptyListItem &&
      !shouldTriggerGhostText(wordCount, isSelecting, lastCharIsSlash, cursorInHeading)
    ) {
      setStatus("idle");
      return;
    }

    const textBeforeCursor = extractTextBefore(editor, 500);
    if (!onEmptyListItem && !isUserStuck(textBeforeCursor)) {
      setStatus("idle");
      return;
    }
    if (slashMenuOpen) {
      setStatus("idle");
      return;
    }

    const now = Date.now();
    if (now - lastAcceptTimeRef.current < COOLDOWN_AFTER_ACCEPT_MS) {
      setStatus("idle");
      return;
    }

    setStatus("pending");
    setNeedsVerifyStatistic(false);
    onRequestStart?.();

    try {
        if (onEmptyListItem) {
        if (!isEnabled("listContinuation")) {
          setStatus("idle");
          return;
        }
        const listContext = getLastListItems(editor, 5).join("\n");
        const res = await fetch("/api/ai/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noteType,
            mode: "list",
            listContext,
          }),
          signal,
        });
        if (!res.ok || signal.aborted) {
          setStatus("idle");
          return;
        }
        const json = await res.json();
        const result = (json.result ?? "").trim();
        if (signal.aborted) {
          setStatus("idle");
          return;
        }
        if (result && editor.isEditable) {
          (editor.commands as { setGhostText?: (t: string) => boolean }).setGhostText?.(result);
          setStatus("ready");
        } else {
          setStatus("idle");
        }
        return;
      }

      const documentText = editor.state.doc.textContent;
      const last600 = extractTextBefore(editor, 600);
      const lastSentence = extractLastSentence(editor, 200);
      const last300 = extractTextBefore(editor, 300);
      const currentList = getLastListItems(editor, 5).join("\n");
      const relevantEarlier = extractEarlierContent(editor, 400);
      const documentSummary = documentText.slice(0, 400);

      const paragraphKey = `${editor.state.selection.from}-${last600.slice(-100)}`;
      const useCachedIntent =
        cachedParagraphKeyRef.current === paragraphKey && cachedIntentRef.current;

      const fullIntentSuite = level === 3;
      const hideStatisticFlag = level === 1;
      const res = await fetch("/api/ai/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText,
          last600chars: last600,
          lastSentence,
          last300chars: last300,
          currentList,
          relevantEarlier,
          documentSummary,
          noteType,
          cachedIntent: useCachedIntent ? cachedIntentRef.current : undefined,
          fullIntentSuite,
          hideStatisticFlag,
        }),
        signal,
      });

      if (!res.ok || signal.aborted) {
        setStatus("idle");
        return;
      }

      const json = await res.json();
      const result = (json.result ?? "").trim();
      const intent = json.intent ?? "CONTINUE";

      if (signal.aborted) {
        setStatus("idle");
        return;
      }

      cachedIntentRef.current = intent;
      cachedParagraphKeyRef.current = paragraphKey;

      const needsVerify = json.needsVerifyStatistic ?? (intent === "NEEDS_NUMBER");
      if (result && editor.isEditable) {
        const displayText =
          needsVerify && result ? `${result} ✱` : result;
        (editor.commands as { setGhostText?: (t: string) => boolean }).setGhostText?.(
          displayText
        );
        setStatus("ready");
        setNeedsVerifyStatistic(needsVerify);
      } else {
        setStatus("idle");
      }
    } catch {
      if (!signal.aborted) {
        setStatus("idle");
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [editor, noteType, slashMenuOpen, level, isEnabled, isApiHealthy, onRequestStart]);

  const scheduleRequest = useCallback(() => {
    if (!editor || !isEnabled("ghostText")) {
      clearGhost();
      setStatus("idle");
      setNeedsVerifyStatistic(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortControllerRef.current?.abort();
    clearGhost();
    setStatus("idle");
    setNeedsVerifyStatistic(false);

    const debounceMs = isCursorOnEmptyListItem(editor)
      ? isEnabled("listContinuation")
        ? LIST_DEBOUNCE_MS
        : STUCK_THRESHOLD_MS
      : STUCK_THRESHOLD_MS;

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fireRequest();
    }, debounceMs);
  }, [editor, fireRequest, clearGhost, isEnabled]);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => scheduleRequest();
    editor.on("selectionUpdate", onUpdate);
    editor.on("update", onUpdate);
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("update", onUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortControllerRef.current?.abort();
    };
  }, [editor, scheduleRequest]);

  return {
    status,
    needsVerifyStatistic,
    acceptGhost,
    dismissGhost,
    onGhostAccepted,
  };
}
