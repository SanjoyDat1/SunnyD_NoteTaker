"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { markdownToHtml } from "@/lib/utils";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { findActionItemsSectionPos } from "@/lib/context";

const DEBOUNCE_MS = 150;
const MIN_WORDS = 3;
const OFFSET_ABOVE = 10;
const FLIP_THRESHOLD = 80;

export interface ToolbarPosition {
  x: number;
  y: number;
  above: boolean;
}

export interface ResultPanelState {
  visible: boolean;
  label: string;
  content: string;
  streaming: boolean;
  originalText?: string;
  showDiff?: boolean;
  position: ToolbarPosition;
}

export interface UseSelectionToolbarReturn {
  visible: boolean;
  position: ToolbarPosition;
  selectedText: string;
  runAction: (action: string) => void;
  resultPanel: ResultPanelState;
  closeResultPanel: () => void;
  applyResult: () => void;
  discardResult: () => void;
  copyResult: () => void;
  loadingAction: string | null;
  /** Range being processed when loading (for acting highlight) */
  loadingRange: { from: number; to: number } | null;
  onActionItemsAdded?: (count: number) => void;
}

const PANEL_ACTIONS = ["enhance", "distill", "expand"] as const;
const INLINE_ACTIONS = ["bullets", "simplify", "rephrase"] as const;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Manages selection toolbar visibility, position, action execution.
 * Enhance/Distill/Expand open a Result Panel. Bullets/Simplify/Rephrase replace inline.
 * Extract Actions appends to Action Items section.
 */
export function useSelectionToolbar(
  editor: Editor | null,
  containerRef: React.RefObject<HTMLElement | null>,
  noteType: string,
  onLoadingChange: (loading: boolean) => void,
  options?: {
    onActionItemsAdded?: (count: number) => void;
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
  }
): UseSelectionToolbarReturn {
  const { isEnabled } = useSunnyD();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({
    x: 0,
    y: 0,
    above: true,
  });
  const [selectedText, setSelectedText] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [loadingRange, setLoadingRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [resultPanel, setResultPanel] = useState<ResultPanelState>({
    visible: false,
    label: "",
    content: "",
    streaming: false,
    position: { x: 0, y: 0, above: true },
  });
  const selectionRef = useRef<{ from: number; to: number } | null>(null);
  const accumulatedRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const updatePosition = useCallback(() => {
    if (!editor || !containerRef.current) return;

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      setVisible(false);
      return;
    }

    const text = editor.state.doc.textBetween(from, to, "\n");
    if (countWords(text) < MIN_WORDS) {
      setVisible(false);
      return;
    }

    const view = editor.view;
    const startCoords = view.coordsAtPos(from);
    const endCoords = view.coordsAtPos(to);
    const midX = (startCoords.left + endCoords.right) / 2;
    const midY = (startCoords.top + endCoords.bottom) / 2;

    const containerRect = containerRef.current.getBoundingClientRect();
    const toolbarHeight = 44;
    const relativeX = midX - containerRect.left;
    const relativeY = midY - containerRect.top;
    const viewportTop = startCoords.top;

    const spaceAbove = viewportTop - containerRect.top;
    const above =
      spaceAbove >= FLIP_THRESHOLD &&
      spaceAbove >= toolbarHeight + OFFSET_ABOVE;

    const y = above
      ? relativeY - toolbarHeight - OFFSET_ABOVE
      : relativeY + OFFSET_ABOVE;

    setPosition({
      x: relativeX,
      y,
      above,
    });
  }, [editor, containerRef]);

  const clearLoading = useCallback(() => {
    setLoadingAction(null);
    setLoadingRange(null);
  }, []);

  const closeResultPanel = useCallback(() => {
    setResultPanel((p) => ({ ...p, visible: false }));
    clearLoading();
  }, [clearLoading]);

  const applyResult = useCallback(() => {
    const range = selectionRef.current;
    const content = accumulatedRef.current.trim();
    if (!editor || !range || !content) {
      closeResultPanel();
      return;
    }
    const { from, to } = range;
    const html = markdownToHtml(content);
    editor
      .chain()
      .setTextSelection({ from, to })
      .insertContent(html, { parseOptions: { preserveWhitespace: "full" } })
      .setMeta("addToHistory", true)
      .focus()
      .run();
    closeResultPanel();
    selectionRef.current = null;
    setVisible(false);
  }, [editor, closeResultPanel]);

  const discardResult = useCallback(() => {
    selectionRef.current = null;
    setVisible(false);
    closeResultPanel();
  }, [closeResultPanel]);

  const copyResult = useCallback(async () => {
    const content = accumulatedRef.current.trim();
    if (content) {
      await navigator.clipboard.writeText(content);
    }
    closeResultPanel();
  }, [closeResultPanel]);

  const getContext = useCallback(
    (from: number, to: number) => {
      if (!editor) return "";
      const before = editor.state.doc.textBetween(
        Math.max(0, from - 400),
        from,
        "\n"
      );
      const after = editor.state.doc.textBetween(
        to,
        Math.min(editor.state.doc.content.size, to + 400),
        "\n"
      );
      return before + "\n[SELECTION]\n" + after;
    },
    [editor]
  );

  const runInlineAction = useCallback(
    async (
      action: string,
      from: number,
      to: number,
      text: string,
      surroundingContext: string
    ) => {
      if (!editor) return;

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const res = await fetch("/api/ai/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          selectedText: text,
          surroundingContext,
          noteType,
        }),
        signal,
      });

      if (!res.ok || !res.body || signal.aborted) {
        clearLoading();
        onLoadingChange(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }
      const trimmed = accumulated.trim();
      if (!trimmed || signal.aborted) {
        clearLoading();
        onLoadingChange(false);
        return;
      }

      const html = markdownToHtml(trimmed);
      editor
        .chain()
        .setTextSelection({ from, to })
        .insertContent(html, { parseOptions: { preserveWhitespace: "full" } })
        .setMeta("addToHistory", true)
        .focus()
        .run();

      selectionRef.current = null;
      setVisible(false);
      clearLoading();
      onLoadingChange(false);
      abortControllerRef.current = null;
    },
    [editor, noteType, onLoadingChange, clearLoading]
  );

  const runExtractActions = useCallback(
    async (from: number, to: number, text: string, surroundingContext: string) => {
      if (!editor) return;

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const res = await fetch("/api/ai/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract-actions",
          selectedText: text,
          surroundingContext,
          noteType,
        }),
        signal,
      });

      if (!res.ok || !res.body || signal.aborted) {
        clearLoading();
        onLoadingChange(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }
      const trimmed = accumulated.trim();
      if (!trimmed || signal.aborted) {
        clearLoading();
        onLoadingChange(false);
        return;
      }

      const count = (trimmed.match(/- \[ \]/g) || []).length;
      const itemHtml = markdownToHtml(trimmed);

      const targetPos = findActionItemsSectionPos(editor);

      if (targetPos !== null) {
        editor
          .chain()
          .insertContentAt(targetPos, itemHtml, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .focus()
          .run();
      } else {
        const sectionHtml = `<h2>Action Items</h2>${itemHtml}`;
        const docEnd = editor.state.doc.content.size;
        editor
          .chain()
          .insertContentAt(docEnd, sectionHtml, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .focus()
          .run();
      }

      options?.onActionItemsAdded?.(count);
      selectionRef.current = null;
      setVisible(false);
      clearLoading();
      onLoadingChange(false);
      abortControllerRef.current = null;
    },
    [editor, noteType, onLoadingChange, clearLoading, options]
  );

  const runPanelAction = useCallback(
    async (
      action: "enhance" | "distill" | "expand",
      from: number,
      to: number,
      text: string,
      surroundingContext: string
    ) => {
      if (!editor) return;

      let label = "";
      let expandType = "CONTEXT";

      if (action === "expand") {
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        try {
          const classifyRes = await fetch("/api/ai/expand-classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedText: text, noteType }),
            signal: abortControllerRef.current.signal,
          });
          if (classifyRes.ok) {
            const { classification } = await classifyRes.json();
            expandType = classification;
          }
        } catch {
          // fallback to CONTEXT
        }
        label = `EXPANDED — ADDED ${expandType}`;
      } else if (action === "enhance") {
        label = "ENHANCED";
      } else {
        label = "DISTILLED";
      }

      const view = editor.view;
      const startCoords = view.coordsAtPos(from);
      const endCoords = view.coordsAtPos(to);
      const midX = (startCoords.left + endCoords.right) / 2;
      const panelY = endCoords.bottom;
      const containerRect = containerRef.current?.getBoundingClientRect();
      const panelPos: ToolbarPosition = containerRect
        ? {
            x: midX - containerRect.left,
            y: panelY - containerRect.top + OFFSET_ABOVE,
            above: false,
          }
        : { x: 0, y: 0, above: false };

      accumulatedRef.current = "";
      setResultPanel({
        visible: true,
        label,
        content: "",
        streaming: true,
        originalText: action === "enhance" ? text : undefined,
        showDiff: action === "enhance",
        position: panelPos,
      });
      setVisible(false);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const body: Record<string, unknown> = {
        action: action === "expand" ? "expand" : action,
        selectedText: text,
        surroundingContext,
        noteType,
      };
      if (action === "expand") {
        body.expandType = expandType;
      }

      const res = await fetch("/api/ai/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok || !res.body || signal.aborted) {
        setResultPanel((p) => ({ ...p, streaming: false }));
        clearLoading();
        onLoadingChange(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulatedRef.current += chunk;
        setResultPanel((p) => ({
          ...p,
          content: accumulatedRef.current,
        }));
      }

      setResultPanel((p) => ({
        ...p,
        content: accumulatedRef.current.trim(),
        streaming: false,
      }));
      clearLoading();
      onLoadingChange(false);
      abortControllerRef.current = null;
    },
    [editor, noteType, onLoadingChange, containerRef]
  );

  const runAction = useCallback(
    async (action: string) => {
      if (!editor) return;

      const range = selectionRef.current;
      if (!range) return;

      const { from, to } = range;
      const text = editor.state.doc.textBetween(from, to, "\n");
      if (!text.trim()) return;

      const surroundingContext = getContext(from, to);

      if (action === "copy") {
        await navigator.clipboard.writeText(text);
        selectionRef.current = null;
        setVisible(false);
        return;
      }
      if (action === "cut") {
        await navigator.clipboard.writeText(text);
        editor
          .chain()
          .deleteRange({ from, to })
          .setMeta("addToHistory", true)
          .focus()
          .run();
        selectionRef.current = null;
        setVisible(false);
        return;
      }

      if (!isEnabled("selectionToolbar")) return;

      setLoadingAction(action);
      setLoadingRange({ from, to });
      onLoadingChange(true);

      try {
        if (PANEL_ACTIONS.includes(action as (typeof PANEL_ACTIONS)[number])) {
          await runPanelAction(
            action as "enhance" | "distill" | "expand",
            from,
            to,
            text,
            surroundingContext
          );
        } else if (action === "extract-actions") {
          await runExtractActions(from, to, text, surroundingContext);
        } else if (INLINE_ACTIONS.includes(action as (typeof INLINE_ACTIONS)[number])) {
          await runInlineAction(action, from, to, text, surroundingContext);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResultPanel((p) => ({ ...p, visible: false }));
        }
        clearLoading();
        onLoadingChange(false);
      }
    },
    [
      editor,
      getContext,
      isEnabled,
      onLoadingChange,
      clearLoading,
      runPanelAction,
      runExtractActions,
      runInlineAction,
    ]
  );

  useEffect(() => {
    if (!editor || !containerRef.current) return;

    const onSelectionUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        selectionRef.current = null;
        setVisible(false);
        setSelectedText("");
        return;
      }

      const text = editor.state.doc.textBetween(from, to, "\n");
      if (countWords(text) < MIN_WORDS) {
        selectionRef.current = null;
        setVisible(false);
        setSelectedText("");
        return;
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        selectionRef.current = { from, to };
        setSelectedText(text);
        updatePosition();
        setVisible(true);
      }, DEBOUNCE_MS);
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, containerRef, updatePosition]);

  const scrollContainerRef = options?.scrollContainerRef;
  useEffect(() => {
    if (!visible || !scrollContainerRef?.current) return;
    const el = scrollContainerRef.current;
    const onScroll = () => updatePosition();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [visible, scrollContainerRef, updatePosition]);

  useEffect(() => {
    if (!visible) return;
    updatePosition();
  }, [visible, updatePosition]);

  useEffect(() => {
    if (!editor) return;

    const onUpdate = () => {
      if (!resultPanel.visible) {
        selectionRef.current = null;
        setVisible(false);
      }
      abortControllerRef.current?.abort();
    };
    const onBlur = () => {
      if (!resultPanel.visible) setVisible(false);
    };

    editor.on("update", onUpdate);
    editor.on("blur", onBlur);

    return () => {
      editor.off("update", onUpdate);
      editor.off("blur", onBlur);
    };
  }, [editor, resultPanel.visible]);

  useEffect(() => {
    if (!resultPanel.visible) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") discardResult();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [resultPanel.visible, discardResult]);

  return {
    visible,
    position,
    selectedText,
    runAction,
    resultPanel,
    closeResultPanel,
    applyResult,
    discardResult,
    copyResult,
    loadingAction,
    loadingRange,
  };
}
