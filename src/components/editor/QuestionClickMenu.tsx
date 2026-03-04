"use client";

import type { DetectedQuestion } from "@/extensions/PatternDetectorExtension";
import { SUNNYD } from "@/lib/sunnyd";
import { useEffect, useRef } from "react";

export interface QuestionClickMenuProps {
  question: DetectedQuestion;
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLElement | null>;
  onAnswer: (question: DetectedQuestion) => void;
  onDismiss: (question: DetectedQuestion) => void;
  onClose: () => void;
}

export function QuestionClickMenu({
  question,
  x,
  y,
  containerRef,
  onAnswer,
  onDismiss,
  onClose,
}: QuestionClickMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest?.("[data-question]")
      ) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  if (!containerRef.current) return null;

  const rect = containerRef.current.getBoundingClientRect();
  const left = x - rect.left;
  const top = y - rect.top + 6;

  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-0 z-[110] flex flex-col gap-0.5 rounded-lg border border-border bg-surface py-1 shadow-lg"
      style={{ transform: `translate(${left}px, ${top}px)` }}
    >
      <button
        type="button"
        onClick={() => {
          onAnswer(question);
          onClose();
        }}
        className="flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-accent hover:bg-accent/10 transition-colors whitespace-nowrap"
      >
        {SUNNYD.answerThis}
      </button>
      <button
        type="button"
        onClick={() => {
          onDismiss(question);
          onClose();
        }}
        className="flex items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:bg-border/50 transition-colors whitespace-nowrap"
      >
        Dismiss
      </button>
    </div>
  );
}
