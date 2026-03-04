"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { markdownToHtml, escapeHtml } from "@/lib/utils";

/** Simple word-level diff: wrap changed words in span.sunnyd-diff. Returns safe HTML. */
function diffWordsToHtml(original: string, result: string): string {
  const origWords = original.trim().split(/\s+/);
  const resultWords = result.trim().split(/\s+/);
  if (origWords.length === 0 || resultWords.length === 0) {
    return escapeHtml(result);
  }

  let o = 0;
  let r = 0;
  const fragments: string[] = [];

  while (r < resultWords.length) {
    const rWord = resultWords[r];
    if (o < origWords.length && origWords[o] === rWord) {
      fragments.push(escapeHtml(rWord));
      o++;
      r++;
    } else {
      const run: string[] = [];
      while (
        r < resultWords.length &&
        (o >= origWords.length || origWords[o] !== resultWords[r])
      ) {
        run.push(resultWords[r]);
        r++;
      }
      if (run.length > 0) {
        fragments.push(
          `<span class="sunnyd-diff">${run.map(escapeHtml).join(" ")}</span>`
        );
      }
    }
  }
  return fragments.join(" ");
}

export interface SunnyDResultPanelProps {
  visible: boolean;
  label: string;
  content: string;
  streaming: boolean;
  originalText?: string;
  showDiff?: boolean;
  /** Position relative to the editor container (which has position: relative) */
  position: { x: number; y: number; above: boolean };
  onApply: () => void;
  onDiscard: () => void;
  onCopy: () => void;
}

export function SunnyDResultPanel({
  visible,
  label,
  content,
  streaming,
  originalText,
  showDiff,
  position,
  onApply,
  onDiscard,
  onCopy,
}: SunnyDResultPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const htmlContent =
    showDiff && originalText && content
      ? diffWordsToHtml(originalText, content)
      : markdownToHtml(content);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = htmlContent;
    }
  }, [htmlContent]);

  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onDiscard();
    },
    [onDiscard]
  );

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest?.(".sunnyd-toolbar")
      ) {
        onDiscard();
      }
    },
    [onDiscard]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [visible, handleKeyDown, handleClickOutside]);

  if (!visible) return null;

  const panelY = position.above ? position.y + 10 : position.y - 10;

  return (
    <motion.div
      ref={panelRef}
      className="sunnyd-result-panel"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      style={{
        position: "absolute",
        left: position.x,
        top: panelY,
        transform: "translate(-50%, 0)",
      }}
    >
      <div className="sunnyd-result-label">{label}</div>
      <div
        ref={contentRef}
        className="sunnyd-result-content"
      />
      {streaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-[rgba(45,106,79,0.6)] animate-pulse" />
      )}
      <div className="sunnyd-result-actions">
        <button
          type="button"
          className="sunnyd-result-apply"
          onClick={onApply}
          disabled={streaming}
        >
          Apply
        </button>
        <button
          type="button"
          className="sunnyd-result-discard"
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          className="sunnyd-result-copy"
          onClick={onCopy}
          disabled={streaming}
        >
          Copy
        </button>
      </div>
    </motion.div>
  );
}
