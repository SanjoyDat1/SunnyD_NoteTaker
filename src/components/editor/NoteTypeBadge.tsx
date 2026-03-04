"use client";

import { motion } from "framer-motion";
import type { NoteType } from "@/types";
import { SUNNYD } from "@/lib/sunnyd";

const BADGE_STYLES: Record<NoteType, string> = {
  MEETING: "bg-slate-200 text-slate-700",
  STUDY: "bg-amber-100 text-amber-800",
  BRAINSTORM: "bg-purple-100 text-purple-700",
  JOURNAL: "bg-rose-100 text-rose-700",
  TECHNICAL: "bg-cyan-100 text-cyan-700",
  PLANNING: "bg-green-100 text-green-700",
  GENERAL: "bg-[var(--border)] text-text-muted",
};

export interface NoteTypeBadgeProps {
  noteType: NoteType;
}

export function NoteTypeBadge({ noteType }: NoteTypeBadgeProps) {
  return (
    <motion.span
      key={noteType}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`px-3 py-1 rounded-full text-xs font-sans font-medium ${BADGE_STYLES[noteType]}`}
    >
      {SUNNYD.noteTypeBadge(noteType)}
    </motion.span>
  );
}
