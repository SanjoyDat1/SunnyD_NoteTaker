"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSunnyD } from "@/contexts/SunnyDContext";

export interface SlashCommand {
  id: string;
  label: string;
  description?: string;
  /** Format-only: no API call, works at Off/Level 1 */
  formatOnly?: boolean;
}

const FORMAT_COMMANDS: SlashCommand[] = [
  { id: "h1", label: "Heading 1", description: "Large section title", formatOnly: true },
  { id: "h2", label: "Heading 2", description: "Medium section", formatOnly: true },
  { id: "h3", label: "Heading 3", description: "Small section", formatOnly: true },
  { id: "bullet", label: "Bullet list", description: "Convert to bullets", formatOnly: true },
  { id: "checklist", label: "Checklist", description: "Convert to task list", formatOnly: true },
  { id: "divider", label: "Divider", description: "Insert horizontal rule", formatOnly: true },
  { id: "image", label: "Image", description: "Insert image from file", formatOnly: true },
];

const AI_COMMANDS: SlashCommand[] = [
  { id: "ask", label: "Ask [question]", description: "Ask SunnyD about your notes" },
  { id: "summarize", label: "Summarize", description: "Summarize content above" },
  { id: "tldr", label: "TL;DR", description: "Create TL;DR of document" },
  { id: "bullets", label: "Bullets", description: "Convert paragraph to bullets" },
  { id: "expand", label: "Expand", description: "Expand paragraph above" },
  { id: "actions", label: "Actions", description: "Extract all action items" },
  { id: "simplify", label: "Simplify", description: "Simplify paragraph above" },
  { id: "structure", label: "Structure", description: "Suggest section headers" },
  { id: "next", label: "Next", description: "Suggest what to write next" },
  { id: "define", label: "Define [term]", description: "Define a term" },
];

function fuzzyMatch(query: string, str: string): boolean {
  const q = query.toLowerCase();
  const s = str.toLowerCase();
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export interface SlashCommandPickerProps {
  visible: boolean;
  query: string;
  position: { x: number; y: number };
  onSelect: (command: string, argument?: string) => void;
  onClose: () => void;
}

export function SlashCommandPicker({
  visible,
  query,
  position,
  onSelect,
  onClose,
}: SlashCommandPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { isEnabled } = useSunnyD();

  const aiSlashEnabled = isEnabled("slashCommands");
  const allCommands = aiSlashEnabled
    ? [...FORMAT_COMMANDS, ...AI_COMMANDS]
    : FORMAT_COMMANDS;

  const filtered = allCommands.filter(
    (cmd) =>
      fuzzyMatch(query, cmd.id) ||
      fuzzyMatch(query, cmd.label) ||
      (cmd.id === "ask" && fuzzyMatch(query, "ask"))
  );

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  const selectedCommand = filtered[clampedIndex];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    if (!visible) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && selectedCommand) {
        e.preventDefault();
        const isDefine = selectedCommand.id === "define";
        const isAsk = selectedCommand.id === "ask";
        const arg = isDefine
          ? query.replace(/^define\s*/, "").trim()
          : isAsk
            ? query.replace(/^ask\s*/, "").trim()
            : undefined;
        onSelect(selectedCommand.id, arg || undefined);
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, filtered.length, selectedCommand, query, onSelect]);

  useEffect(() => {
    if (listRef.current && selectedCommand) {
      const el = listRef.current.querySelector(`[data-command="${selectedCommand.id}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, selectedCommand]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="absolute z-50 w-72 rounded-lg border border-border bg-surface py-1 shadow-lg"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[13px] font-sans text-text-muted">
              No commands match
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                data-command={cmd.id}
                onClick={() => {
                  const isDefine = cmd.id === "define";
                  const isAsk = cmd.id === "ask";
                  const arg = isDefine
                    ? query.replace(/^define\s*/, "").trim()
                    : isAsk
                      ? query.replace(/^ask\s*/, "").trim()
                      : undefined;
                  onSelect(cmd.id, arg || undefined);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                  i === clampedIndex ? "bg-accent-light text-accent" : "hover:bg-border"
                }`}
              >
                <span className="text-[13px] font-sans font-medium">{cmd.label}</span>
                {cmd.description && (
                  <span className="text-[11px] font-sans text-text-muted">
                    {cmd.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
