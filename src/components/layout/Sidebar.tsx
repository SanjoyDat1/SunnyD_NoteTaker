"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotes } from "@/contexts/NotesContext";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function Sidebar() {
  const { notes, activeNoteId, setActiveNote, createNote, deleteNote } =
    useNotes();
  const [collapsed, setCollapsed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        createNote();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createNote]);

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 260 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex flex-col h-full bg-[var(--sidebar-bg)] border-r border-border shrink-0 overflow-hidden"
    >
      <div className="flex items-center justify-between h-14 px-3 shrink-0 border-b border-border">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-sans text-sm font-semibold text-text truncate"
            >
              Notes
            </motion.span>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={createNote}
            className="p-2 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            aria-label="New note"
            title="New note"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-border transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={collapsed ? "rotate-180" : ""}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <ul className="space-y-0.5 px-2">
            {notes.map((note) => (
              <li key={note.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveNote(note.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveNote(note.id);
                    }
                  }}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                    activeNoteId === note.id
                      ? "bg-accent/15 text-accent"
                      : "hover:bg-border/60 text-text"
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">
                    {note.title || "Untitled"}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {formatDate(note.updatedAt)}
                  </span>
                  {deleteConfirmId === note.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                        setDeleteConfirmId(null);
                      }}
                      className="text-[10px] text-danger font-medium px-1.5 py-0.5 rounded hover:bg-danger/10"
                    >
                      Delete?
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(note.id);
                        setTimeout(() => setDeleteConfirmId(null), 3000);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-all"
                      aria-label="Delete note"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {collapsed && (
          <div className="flex flex-col items-center gap-2 py-2">
            {notes.slice(0, 5).map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => setActiveNote(note.id)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                  activeNoteId === note.id
                    ? "bg-accent text-white"
                    : "bg-border/60 text-text-muted hover:bg-border"
                }`}
                title={note.title || "Untitled"}
              >
                {(note.title || "?")[0].toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.aside>
  );
}
