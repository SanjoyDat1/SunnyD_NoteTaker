"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  extractContentAboveCursorUntilHeading,
  extractDocumentText,
  extractPrecedingParagraph,
  extractPrecedingParagraphRange,
  extractTextBefore,
  findSafeInsertionPoint,
  wrapInSunnyDCard,
} from "@/lib/context";
import { markdownToHtml } from "@/lib/utils";
import type { SlashState } from "@/extensions/SlashCommandExtension";
import { useSunnyD } from "@/contexts/SunnyDContext";

export interface UseSlashCommandReturn {
  slashState: SlashState;
  slashPosition: { x: number; y: number };
  executeSlashCommand: (command: string, argument?: string) => void;
}

/**
 * Manages slash command execution: API call, streaming, output placement.
 */
export function useSlashCommand(
  editor: Editor | null,
  containerRef: React.RefObject<HTMLElement | null>,
  noteType: string,
  onLoadingChange: (loading: boolean) => void,
  stateChangeRef: React.MutableRefObject<((state: SlashState) => void) | undefined>
): UseSlashCommandReturn {
  const { isEnabled } = useSunnyD();
  const [slashState, setSlashState] = useState<SlashState>({
    open: false,
    query: "",
    from: 0,
    to: 0,
  });
  const [slashPosition, setSlashPosition] = useState({ x: 0, y: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(slashState);
  stateRef.current = slashState;

  const updatePosition = useCallback(() => {
    if (!editor?.view || !containerRef.current || !slashState.open) return;
    const coords = editor.view.coordsAtPos(slashState.from);
    const containerRect = containerRef.current.getBoundingClientRect();
    setSlashPosition({
      x: coords.left - containerRect.left,
      y: coords.bottom - containerRect.top + 4,
    });
  }, [editor, containerRef, slashState.open, slashState.from]);

  useEffect(() => {
    if (slashState.open) updatePosition();
  }, [slashState.open, slashState.from, updatePosition]);

  useEffect(() => {
    stateChangeRef.current = setSlashState;
    return () => {
      stateChangeRef.current = undefined;
    };
  }, [stateChangeRef]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const executeSlashCommand = useCallback(
    async (command: string, argument?: string) => {
      if (!editor) return;

      editor.commands.closeSlashMenu();

      // Format-only commands (no API) — always available
      const formatHandlers: Record<string, () => boolean> = {
        image: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              const src = await fileToDataUrl(file);
              editor.chain().focus().setImage({ src }).run();
            }
          };
          input.click();
          return true;
        },
        h1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        bullet: () => editor.chain().focus().toggleBulletList().run(),
        checklist: () => editor.chain().focus().toggleTaskList().run(),
        divider: () => editor.chain().focus().setHorizontalRule().run(),
      };

      const formatHandler = formatHandlers[command];
      if (formatHandler) {
        formatHandler();
        return;
      }

      // AI commands — require slashCommands enabled
      if (!isEnabled("slashCommands")) return;

      const { from, to } = stateRef.current;

      const documentContent = extractDocumentText(editor);
      const cursorContext = extractTextBefore(editor, 600);
      const precedingParagraph = extractPrecedingParagraph(editor);
      const contentAboveHeading = extractContentAboveCursorUntilHeading(editor, 2000);
      const precedingParagraphRange = extractPrecedingParagraphRange(editor);

      editor.commands.closeSlashMenu();
      onLoadingChange(true);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const questionForAsk = argument || stateRef.current.query.replace(/^ask\s*/, "").trim() || "";
      const contextByCommand: Record<string, string> = {
        ask: documentContent,
        summarize: contentAboveHeading,
        tldr: documentContent,
        bullets: precedingParagraph,
        expand: precedingParagraph,
        actions: documentContent,
        simplify: precedingParagraph,
        structure: documentContent,
        next: documentContent,
        define: cursorContext,
      };

      const payload = {
        command: command === "ask" ? `ask ${questionForAsk}` : (argument ? `${command} ${argument}` : command),
        argument: command === "ask" ? questionForAsk : (argument ?? ""),
        documentContent: documentContent.slice(0, 4000),
        cursorContext: (contextByCommand[command] ?? cursorContext).slice(0, 800),
        precedingParagraph: precedingParagraph.slice(0, 500),
        noteType,
      };

      try {
        const res = await fetch("/api/ai/slash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });

        if (!res.ok || !res.body || signal.aborted) {
          onLoadingChange(false);
          return;
        }

        editor.chain().setMeta("addToHistory", true).focus().run();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          if (signal.aborted) break;
        }

        let trimmed = accumulated.trim();
        if (!trimmed || signal.aborted) {
          onLoadingChange(false);
          return;
        }

        const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
        const aiInsertCommands = [
          "summarize",
          "actions",
          "tldr",
          "define",
          "ask",
          "bullets",
          "expand",
          "simplify",
        ];
        if (wordCount > 15 && aiInsertCommands.includes(command)) {
          try {
            const critiqueRes = await fetch("/api/ai/critique", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ generated: trimmed }),
              signal,
            });
            const critiqueJson = await critiqueRes.json();
            if (critiqueJson.result === "") {
              onLoadingChange(false);
              return;
            }
            trimmed = critiqueJson.result;
          } catch {
            // use original on error
          }
        }

        const html = markdownToHtml(trimmed);
        const rawInsertPos = editor.state.selection.from;
        const insertPos = findSafeInsertionPoint(editor, rawInsertPos);

        switch (command) {
          case "summarize":
          case "actions":
          case "tldr":
          case "define":
          case "ask": {
            const cardHtml = wrapInSunnyDCard(
              `<div class="sunnyd-crafting">${html}</div>`
            );
            editor
              .chain()
              .insertContentAt(insertPos, cardHtml, {
                parseOptions: { preserveWhitespace: "full" },
              })
              .setMeta("addToHistory", true)
              .run();
            break;
          }

          case "structure": {
            const headings = trimmed.split("\n").filter(Boolean);
            const structureHtml = headings
              .map((h) => `<h2>${h.replace(/^#+\s*/, "").trim()}</h2>`)
              .join("");
            editor
              .chain()
              .insertContentAt(insertPos, structureHtml || html, {
                parseOptions: { preserveWhitespace: "full" },
              })
              .setMeta("addToHistory", true)
              .run();
            break;
          }

          case "next": {
            const cardHtml = wrapInSunnyDCard(
              `<div class="sunnyd-crafting">${html}</div>`
            );
            editor
              .chain()
              .insertContent(cardHtml, {
                parseOptions: { preserveWhitespace: "full" },
              })
              .setMeta("addToHistory", true)
              .run();
            break;
          }

          case "bullets":
          case "expand":
          case "simplify": {
            const cardHtml = wrapInSunnyDCard(
              `<div class="sunnyd-crafting">${html}</div>`
            );
            if (precedingParagraphRange) {
              const { from: rangeFrom, to: rangeTo } = precedingParagraphRange;
              editor
                .chain()
                .deleteRange({ from: rangeFrom, to: rangeTo })
                .insertContentAt(rangeFrom, cardHtml, {
                  parseOptions: { preserveWhitespace: "full" },
                })
                .setMeta("addToHistory", true)
                .run();
            } else {
              editor
                .chain()
                .insertContentAt(insertPos, cardHtml, {
                  parseOptions: { preserveWhitespace: "full" },
                })
                .setMeta("addToHistory", true)
                .run();
            }
            break;
          }

          default: {
            const cardHtml = wrapInSunnyDCard(
              `<div class="sunnyd-crafting">${html}</div>`
            );
            editor
              .chain()
              .insertContentAt(insertPos, cardHtml, {
                parseOptions: { preserveWhitespace: "full" },
              })
              .setMeta("addToHistory", true)
              .run();
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          editor.commands.focus();
        }
      } finally {
        onLoadingChange(false);
        abortControllerRef.current = null;
      }
    },
    [editor, noteType, onLoadingChange, isEnabled]
  );

  return {
    slashState,
    slashPosition,
    executeSlashCommand,
  };
}
