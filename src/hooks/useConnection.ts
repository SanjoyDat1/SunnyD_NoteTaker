"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { extractDocumentText, getWordCount } from "@/lib/context";

export interface ConnectionResult {
  hasConnection: boolean;
  currentTopic?: string;
  earlierTopic?: string;
  relationship?: string;
  insight?: string;
}

const WORDS_TRIGGER = 75;
const DEBOUNCE_MS = 1500;

export interface UseConnectionOptions {
  onFetchStart?: () => void;
}

export function useConnection(
  editor: Editor | null,
  options?: UseConnectionOptions
): { connection: ConnectionResult | null; loading: boolean } {
  const { isEnabled } = useSunnyD();
  const { onFetchStart } = options ?? {};
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const lastWordCountRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConnection = useCallback(async () => {
    if (!editor || !isEnabled("connectionSurfacing")) return;

    const docText = extractDocumentText(editor);
    const wordCount = getWordCount(editor);

    if (wordCount < WORDS_TRIGGER) {
      setConnection(null);
      return;
    }

    const delta = wordCount - lastWordCountRef.current;
    if (delta < WORDS_TRIGGER) return;

    lastWordCountRef.current = wordCount;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    onFetchStart?.();

    try {
      const res = await fetch("/api/ai/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullDocument: docText }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || abortRef.current.signal.aborted) {
        setLoading(false);
        return;
      }

      const data = (await res.json()) as ConnectionResult;
      if (!abortRef.current.signal.aborted) {
        setConnection(data.hasConnection ? data : null);
      }
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [editor, isEnabled, onFetchStart]);

  useEffect(() => {
    if (!editor || !isEnabled("connectionSurfacing")) {
      setConnection(null);
      return;
    }

    const schedule = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        fetchConnection();
      }, DEBOUNCE_MS);
    };

    editor.on("update", schedule);
    schedule();

    return () => {
      editor.off("update", schedule);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [editor, fetchConnection, isEnabled]);

  return { connection, loading };
}
