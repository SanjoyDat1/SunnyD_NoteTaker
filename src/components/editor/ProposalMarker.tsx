"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Proposal } from "@/hooks/useProposals";
import { SUNNYD } from "@/lib/sunnyd";
import { motion, AnimatePresence } from "framer-motion";

export interface ProposalMarkerProps {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLElement | null>;
  proposals: Proposal[];
  onApply: (p: Proposal) => void;
  onDismiss: (p: Proposal) => void;
}

export function ProposalMarker({
  editor,
  containerRef,
  proposals,
  onApply,
  onDismiss,
}: ProposalMarkerProps) {
  const [positions, setPositions] = useState<
    Array<{ proposal: Proposal; x: number; y: number }>
  >([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (!editor?.view || !containerRef.current || proposals.length === 0) {
      setPositions([]);
      return;
    }

    const update = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const view = editor.view;
      const result: Array<{ proposal: Proposal; x: number; y: number }> = [];

      for (const p of proposals) {
        if (p.from == null) continue;
        try {
          const coords = view.coordsAtPos(p.from);
          const lineHeight = coords.bottom - coords.top;
          result.push({
            proposal: p,
            x: 8,
            y: coords.top - rect.top + lineHeight / 2 - 10,
          });
        } catch {
          // invalid pos
        }
      }
      setPositions(result);
    };

    update();
    editor.on("update", update);

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
    scrollParent?.addEventListener("scroll", update);

    return () => {
      editor.off("update", update);
      scrollParent?.removeEventListener("scroll", update);
    };
  }, [editor, containerRef, proposals]);

  if (proposals.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 h-full w-10"
      aria-hidden
    >
      <AnimatePresence>
        {positions.map(({ proposal, x, y }) => {
          const id = `${proposal.targetText}-${proposal.label}`;
          const isHovered = hoveredId === id;

          return (
            <motion.div
              key={id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto absolute left-0 top-0 group"
              style={{ transform: `translate(${x}px, ${y}px)` }}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <span className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-sunnyd-accent text-sm hover:text-sunnyd-accent/90">
                ✦
              </span>

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="absolute left-full top-0 z-[100] ml-2 min-w-72 max-w-[min(320px,90vw)] max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-xl"
                  >
                    <p className="mb-2 text-[10px] font-sans uppercase tracking-wide text-text-muted">
                      {SUNNYD.proposalHeader}
                    </p>
                    <p className="mb-2 text-sm font-sans text-text break-words">
                      {proposal.label}
                    </p>
                    <p className="mb-3 text-xs text-text-muted break-words line-clamp-3">
                      {proposal.preview}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(proposal)}
                        className="rounded bg-accent px-2 py-1 text-xs font-sans text-white hover:bg-accent/90"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismiss(proposal)}
                        className="rounded border border-border px-2 py-1 text-xs font-sans text-text-muted hover:bg-border"
                      >
                        Dismiss
                      </button>
                    </div>
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
