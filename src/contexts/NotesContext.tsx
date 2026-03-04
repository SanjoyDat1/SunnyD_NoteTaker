"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Note } from "@/lib/notes-store";
import {
  loadNotes,
  saveNotes,
  createEmptyNote,
} from "@/lib/notes-store";

interface NotesContextValue {
  notes: Note[];
  activeNoteId: string | null;
  activeNote: Note | null;
  setActiveNote: (id: string | null) => void;
  createNote: () => Note;
  deleteNote: (id: string) => void;
  updateNote: (id: string, updates: Partial<Pick<Note, "title" | "content">>) => void;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const data = loadNotes();
    setNotes(data.notes.length > 0 ? data.notes : [createEmptyNote()]);
    setActiveNoteId(
      data.lastActiveNoteId && data.notes.some((n) => n.id === data.lastActiveNoteId)
        ? data.lastActiveNoteId
        : data.notes[0]?.id ?? null
    );
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized || notes.length === 0) return;
    saveNotes({
      notes,
      lastActiveNoteId: activeNoteId,
    });
  }, [notes, activeNoteId, initialized]);

  const setActiveNote = useCallback((id: string | null) => {
    setActiveNoteId(id);
  }, []);

  const createNote = useCallback(() => {
    const note = createEmptyNote();
    setNotes((prev) => [note, ...prev]);
    setActiveNoteId(note.id);
    return note;
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      return next.length > 0 ? next : [createEmptyNote()];
    });
    setActiveNoteId((current) =>
      current === id ? null : current
    );
  }, []);

  useEffect(() => {
    if (activeNoteId === null && notes.length > 0) {
      setActiveNoteId(notes[0].id);
    } else if (
      activeNoteId &&
      !notes.some((n) => n.id === activeNoteId)
    ) {
      setActiveNoteId(notes[0]?.id ?? null);
    }
  }, [notes, activeNoteId]);

  const updateNote = useCallback(
    (id: string, updates: Partial<Pick<Note, "title" | "content">>) => {
      const now = Date.now();
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, ...updates, updatedAt: now }
            : n
        )
      );
    },
    []
  );

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId]
  );

  const value = useMemo<NotesContextValue>(
    () => ({
      notes,
      activeNoteId,
      activeNote,
      setActiveNote,
      createNote,
      deleteNote,
      updateNote,
    }),
    [
      notes,
      activeNoteId,
      activeNote,
      setActiveNote,
      createNote,
      deleteNote,
      updateNote,
    ]
  );

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
}
