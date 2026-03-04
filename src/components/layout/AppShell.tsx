"use client";

import { ApiHealthProvider } from "@/contexts/ApiHealthContext";
import { NotesProvider } from "@/contexts/NotesContext";
import { SunnyDProvider } from "@/contexts/SunnyDContext";
import { Sidebar } from "./Sidebar";
import NoteEditor from "@/components/editor/NoteEditor";

export function AppShell() {
  return (
    <ApiHealthProvider>
    <SunnyDProvider>
      <NotesProvider>
      <div className="flex h-screen w-full bg-bg">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <NoteEditor />
        </main>
      </div>
    </NotesProvider>
    </SunnyDProvider>
    </ApiHealthProvider>
  );
}
