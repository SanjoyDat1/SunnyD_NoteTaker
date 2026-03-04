/**
 * Notes persistence and types.
 * Uses localStorage for client-side storage.
 */

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "ai-notes-data";

export interface NotesData {
  notes: Note[];
  lastActiveNoteId: string | null;
}

function generateId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function loadNotes(): NotesData {
  if (typeof window === "undefined") {
    return { notes: [], lastActiveNoteId: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { notes: [], lastActiveNoteId: null };
    const data = JSON.parse(raw) as NotesData;
    if (!Array.isArray(data.notes)) {
      return { notes: [], lastActiveNoteId: null };
    }
    return {
      notes: data.notes,
      lastActiveNoteId: data.lastActiveNoteId ?? null,
    };
  } catch {
    return { notes: [], lastActiveNoteId: null };
  }
}

export function saveNotes(data: NotesData): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save notes:", e);
  }
}

export function createEmptyNote(): Note {
  const now = Date.now();
  return {
    id: generateId(),
    title: "Untitled Note",
    content: "",
    createdAt: now,
    updatedAt: now,
  };
}
