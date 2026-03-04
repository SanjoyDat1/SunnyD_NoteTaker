"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import {
  extractDocumentText,
  getWordCount,
  findAnchorInDoc,
} from "@/lib/context";
import { shouldTriggerAnalysis } from "@/lib/triggers";

export interface MarginInsight {
  anchorText: string;
  type: "suggestion" | "gap" | "action" | "question";
  insight: string;
  from: number;
  to: number;
}

export interface UseMarginInsightsReturn {
  insights: MarginInsight[];
  loading: boolean;
}

export interface UseMarginInsightsOptions {
  onFetchStart?: () => void;
}

const ANALYSIS_DEBOUNCE_MS = 2000;

/**
 * Fetches document analysis insights and maps anchorText to doc positions.
 * Triggers when word count > 150 and increased by 50 since last analysis.
 */
export function useMarginInsights(
  editor: Editor | null,
  noteType: string,
  onLoadingChange: (loading: boolean) => void,
  options?: UseMarginInsightsOptions
): UseMarginInsightsReturn {
  const { isEnabled } = useSunnyD();
  const { onFetchStart } = options ?? {};
  const [insights, setInsights] = useState<MarginInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const lastAnalysisWordCountRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!editor || !isEnabled("marginInsights")) return;

    const wordCount = getWordCount(editor);
    if (!shouldTriggerAnalysis(wordCount, lastAnalysisWordCountRef.current)) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    setLoading(true);
    onLoadingChange(true);
    onFetchStart?.();

    const documentText = extractDocumentText(editor);

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentText, noteType }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok || abortControllerRef.current.signal.aborted) {
        setLoading(false);
        onLoadingChange(false);
        return;
      }

      const json = await res.json();
      const rawInsights = json.insights ?? [];

      const doc = editor.state.doc;
      const mapped: MarginInsight[] = [];

      for (const item of rawInsights) {
        if (
          typeof item !== "object" ||
          !item.anchorText ||
          !item.type ||
          !item.insight
        )
          continue;
        const range = findAnchorInDoc(doc, String(item.anchorText));
        if (range) {
          mapped.push({
            anchorText: item.anchorText,
            type: item.type,
            insight: item.insight,
            from: range.from,
            to: range.to,
          });
        }
      }

      if (!abortControllerRef.current.signal.aborted) {
        lastAnalysisWordCountRef.current = wordCount;
        setInsights(mapped);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      onLoadingChange(false);
      abortControllerRef.current = null;
    }
  }, [editor, noteType, onLoadingChange, isEnabled, onFetchStart]);

  useEffect(() => {
    if (!editor || !isEnabled("marginInsights")) {
      setInsights([]);
      return;
    }

    const schedule = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      const wordCount = getWordCount(editor);
      if (wordCount < 150) {
        setInsights([]);
        return;
      }
      if (!shouldTriggerAnalysis(wordCount, lastAnalysisWordCountRef.current)) {
        return;
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        fetchInsights();
      }, ANALYSIS_DEBOUNCE_MS);
    };

    const onUpdate = () => {
      schedule();
    };

    editor.on("update", onUpdate);
    schedule();

    return () => {
      editor.off("update", onUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortControllerRef.current?.abort();
    };
  }, [editor, fetchInsights, isEnabled]);

  return { insights, loading };
}
