"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import {
  extractDocumentText,
  getWordCount,
  getHeadingsSignature,
} from "@/lib/context";
import {
  shouldTriggerTypeDetection,
  shouldRetriggerTypeDetectionForHeadings,
} from "@/lib/triggers";
import type { NoteType } from "@/types";

const DETECTION_DEBOUNCE_MS = 800;

export interface UseNoteTypeOptions {
  onDetectionStart?: () => void;
}

export function useNoteType(
  editor: Editor | null,
  options?: UseNoteTypeOptions
): NoteType {
  const { isEnabled } = useSunnyD();
  const { onDetectionStart } = options ?? {};
  const [noteType, setNoteType] = useState<NoteType>("GENERAL");
  const hasDetectedRef = useRef(false);
  const lastHeadingsSignatureRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runDetection = useCallback(async () => {
    if (!editor) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    onDetectionStart?.();
    const signal = abortControllerRef.current.signal;

    const documentText = extractDocumentText(editor);

    try {
      const res = await fetch("/api/ai/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentText }),
        signal,
      });

      if (!res.ok || signal.aborted) return;

      const json = await res.json();
      const detected = (json.noteType ?? "GENERAL").toUpperCase();

      const validTypes: NoteType[] = [
        "MEETING",
        "STUDY",
        "BRAINSTORM",
        "JOURNAL",
        "TECHNICAL",
        "PLANNING",
        "GENERAL",
      ];

      if (validTypes.includes(detected as NoteType)) {
        setNoteType(detected as NoteType);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setNoteType("GENERAL");
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [editor, onDetectionStart]);

  useEffect(() => {
    if (!editor || !isEnabled("noteTypeDetection")) return;

    const onUpdate = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;

        const wordCount = getWordCount(editor);
        const headingsSignature = getHeadingsSignature(editor);

        const shouldRun =
          shouldTriggerTypeDetection(wordCount, hasDetectedRef.current) ||
          (hasDetectedRef.current &&
            wordCount >= 60 &&
            shouldRetriggerTypeDetectionForHeadings(
              lastHeadingsSignatureRef.current,
              headingsSignature
            ));

        if (shouldRun) {
          hasDetectedRef.current = true;
          lastHeadingsSignatureRef.current = headingsSignature;
          runDetection();
        }
      }, DETECTION_DEBOUNCE_MS);
    };

    editor.on("update", onUpdate);

    return () => {
      editor.off("update", onUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortControllerRef.current?.abort();
    };
  }, [editor, runDetection, isEnabled]);

  return isEnabled("noteTypeDetection") ? noteType : "GENERAL";
}
