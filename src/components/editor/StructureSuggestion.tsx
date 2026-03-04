"use client";

import { SUNNYD } from "@/lib/sunnyd";
import { motion, AnimatePresence } from "framer-motion";

export interface StructureSuggestionProps {
  visible: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

export function StructureSuggestion({
  visible,
  onAccept,
  onDismiss,
}: StructureSuggestionProps) {
  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="fixed bottom-16 left-1/2 z-20 -translate-x-1/2"
      >
        <div className="flex items-center gap-2 rounded-lg bg-surface px-4 py-2.5 shadow-lg ring-1 ring-border">
          <button
            type="button"
            onClick={onAccept}
            className="text-sm font-sans text-accent hover:underline"
          >
            {SUNNYD.structureToast}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-text-muted hover:bg-border hover:text-text"
            aria-label="Dismiss"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
