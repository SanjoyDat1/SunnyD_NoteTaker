"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { MarginInsight } from "@/hooks/useMarginInsights";
import { SUNNYD } from "@/lib/sunnyd";
import { motion, AnimatePresence } from "framer-motion";

export interface MarginInsightsOverlayProps {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLElement | null>;
  insights: MarginInsight[];
  loading?: boolean;
  onAddQuestionToNotes?: (insight: MarginInsight) => void;
}

const INSIGHT_ICONS: Record<string, string> = {
  suggestion: "✦",
  gap: "○",
  action: "●",
  question: "?",
};

export function MarginInsightsOverlay({
  editor,
  containerRef,
  insights,
  loading = false,
  onAddQuestionToNotes,
}: MarginInsightsOverlayProps) {
  const [positions, setPositions] = useState<
    Array<{ insight: MarginInsight; x: number; y: number }>
  >([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    if (!editor?.view || !containerRef.current || insights.length === 0) {
      setPositions([]);
      return;
    }

    const updatePositions = () => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const view = editor.view;
      const result: Array<{ insight: MarginInsight; x: number; y: number }> = [];

      for (const insight of insights) {
        try {
          const coords = view.coordsAtPos(insight.from);
          const lineHeight = coords.bottom - coords.top;
          result.push({
            insight,
            x: 8,
            y: coords.top - containerRect.top + lineHeight / 2 - 8,
          });
        } catch {
          // pos may be invalid
        }
      }
      setPositions(result);
    };

    updatePositions();

    let scrollParent: HTMLElement | null = null;
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if (["auto", "scroll", "overlay"].includes(overflowY)) {
        scrollParent = el;
        break;
      }
      el = el.parentElement;
    }

    scrollParent?.addEventListener("scroll", updatePositions);
    editor.on("update", updatePositions);

    return () => {
      editor.off("update", updatePositions);
      scrollParent?.removeEventListener("scroll", updatePositions);
    };
  }, [editor, containerRef, insights]);

  if (insights.length === 0 && !loading) return null;

  return (
    <div
      className="pointer-events-none absolute right-0 top-0 h-full w-16"
      aria-hidden
    >
      {loading && insights.length === 0 && (
        <div
          className="absolute top-4 text-[10px] font-sans text-sunnyd-accent"
          style={{ right: 8 }}
        >
          ✦
        </div>
      )}
      <AnimatePresence>
        {positions.map(({ insight, x, y }) => {
          const key = `${insight.from}-${insight.to}`;
          const isHovered = hoveredKey === key;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto absolute left-0 top-0"
              style={{
                transform: `translate(${x}px, ${y}px)`,
              }}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <span className="flex h-4 w-4 cursor-default items-center justify-center rounded text-[10px] text-sunnyd-accent transition-colors hover:text-sunnyd-accent/90">
                {INSIGHT_ICONS[insight.type] ?? "✦"}
              </span>

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    className="absolute right-full top-0 z-50 mr-1 w-64 max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-surface p-2.5 shadow-lg"
                  >
                    <p className="mb-1.5 text-[10px] font-sans uppercase tracking-wide text-text-muted">
                      {SUNNYD.noticed}
                    </p>
                    <p className="text-xs font-sans text-text leading-relaxed break-words">
                      {insight.insight}
                    </p>
                    {insight.type === "question" && onAddQuestionToNotes && (
                      <button
                        type="button"
                        onClick={() => onAddQuestionToNotes(insight)}
                        className="mt-2 w-full rounded border border-border bg-transparent px-2 py-1.5 text-[11px] font-sans text-accent hover:bg-accent-light transition-colors"
                      >
                        {SUNNYD.addQuestionToNotes}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
