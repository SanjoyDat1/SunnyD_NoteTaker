"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { useApiHealth } from "@/contexts/ApiHealthContext";
import type { DetectedQuestion } from "@/extensions/PatternDetectorExtension";
import {
  hasOnlyH1AndFewWords,
  getPositionAfterFirstH1,
  findActionItemsSectionPos,
  getDocEndPos,
  extractDocumentText,
  findSafeInsertionPoint,
  wrapInSunnyDCard,
  textOffsetToDocPos,
} from "@/lib/context";
import { markdownToHtml, escapeHtml } from "@/lib/utils";
import { SUNNYD } from "@/lib/sunnyd";
import { extractCandidateQuestions } from "@/lib/patterns";

const QUESTION_DEBOUNCE_MS = 1500;
const STRUCTURE_DEBOUNCE_MS = 2000;

export interface UsePatternTriggersReturn {
  /** Questions that have been stable for 1500ms - show "Answer this?" */
  confirmedQuestions: DetectedQuestion[];
  /** Question currently being answered (for thinking UI) */
  answeringQuestion: DetectedQuestion | null;
  /** Show structure suggestion toast when doc has only H1 and <20 words */
  showStructureSuggestion: boolean;
  /** Dismiss structure suggestion (e.g. user typed or clicked X) */
  dismissStructureSuggestion: () => void;
  /** Answer a question: call API, insert block below with chat */
  answerQuestion: (question: DetectedQuestion) => Promise<void>;
  /** Dismiss a question (remove highlight, suppress prompts) */
  dismissQuestion: (question: DetectedQuestion) => void;
  /** Run structure command: insert H2 skeleton after H1 */
  runStructureSuggestion: () => Promise<void>;
  /** Move action item to Action Items section (create section if needed) */
  addActionItemToList: (text: string, from: number, to: number) => void;
}

export interface UsePatternTriggersOptions {
  onAnswerInsert?: (questionText: string) => void;
  /** Called when we scan and find questions (e.g. to show reading sweep) */
  onQuestionScan?: (questionCount: number) => void;
  /** Called when answering starts/stops (for thinking dot) */
  onThinkingChange?: (position: { from: number; to: number } | null) => void;
}

/**
 * Manages pattern-based triggers: question prompts, structure suggestion, action items.
 */
export function usePatternTriggers(
  editor: Editor | null,
  containerRef: React.RefObject<HTMLElement | null>,
  noteType: string,
  onLoadingChange: (loading: boolean) => void,
  options?: UsePatternTriggersOptions
): UsePatternTriggersReturn {
  const { isEnabled } = useSunnyD();
  const { isHealthy: isApiHealthy } = useApiHealth();
  const { onAnswerInsert, onQuestionScan, onThinkingChange } = options ?? {};
  const answeredQuestionsRef = useRef<Set<string>>(new Set());
  const [confirmedQuestions, setConfirmedQuestions] = useState<
    DetectedQuestion[]
  >([]);
  const [answeringQuestion, setAnsweringQuestion] = useState<DetectedQuestion | null>(null);
  const [showStructureSuggestion, setShowStructureSuggestion] = useState(false);
  const structureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Check if a SunnyD card answer already exists near this question (avoids duplicates) */
  function hasAnswerInDoc(questionText: string): boolean {
    if (!editor?.view?.dom) return false;
    const slice = questionText.trim().toLowerCase().slice(0, 25);
    if (!slice) return false;
    const normalized = slice.replace(/[?!.,]/g, "");
    if (answeredQuestionsRef.current.has(normalized)) return true;
    const cards = editor.view.dom.querySelectorAll(
      '[data-type="sunnyd-card"], [data-type="question-answer-block"]'
    );
    for (const block of Array.from(cards)) {
      let prev: Element | null = block.previousElementSibling;
      while (prev) {
        if (prev.textContent?.toLowerCase().includes(slice)) return true;
        prev = prev.previousElementSibling;
      }
    }
    return false;
  }

  // Question detection: regex pre-filter → classify (gpt-4o-mini) → answer (gpt-4o-mini)
  const runQuestionDetection = useCallback(async () => {
    if (!editor || !isEnabled("questionDetector") || !isApiHealthy()) return;

    const text = extractDocumentText(editor);
    const candidates = extractCandidateQuestions(text);
    const doc = editor.state.doc;

    for (const { text: sentence, start, end } of candidates) {
      const key = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      if (answeredQuestionsRef.current.has(key) || hasAnswerInDoc(sentence))
        continue;

      const classifyRes = await fetch("/api/ai/classify-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence }),
      }).catch(() => ({ ok: false }));
      const classifyData = classifyRes.ok ? await classifyRes.json() : {};
      if ((classifyData.classification ?? "").trim() !== "ANSWER") continue;

      answeredQuestionsRef.current.add(key);

      onLoadingChange(true);
      setAnsweringQuestion({
        from: textOffsetToDocPos(doc, start) ?? 0,
        to: textOffsetToDocPos(doc, end) ?? 0,
        text: sentence,
      });
      onThinkingChange?.({
        from: textOffsetToDocPos(doc, start) ?? 0,
        to: textOffsetToDocPos(doc, end) ?? 0,
      });

      try {
        const res = await fetch("/api/ai/answer-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionText: sentence,
            docContext: text.slice(-600),
            noteType,
          }),
        });

        const { answer } = res.ok ? await res.json() : { answer: "" };
        const trimmed = (answer ?? "").trim();

        const toPos = textOffsetToDocPos(doc, end);
        if (toPos == null) continue;
        const rawPos = doc.resolve(toPos).after();
        const insertPos = findSafeInsertionPoint(editor, rawPos);

        const innerHtml = trimmed
          ? `<p class="sunnyd-crafting">${markdownToHtml(trimmed)}</p>`
          : `<p class="sunnyd-crafting">${escapeHtml(SUNNYD.rhetoricalExpand)}</p>`;
        const cardHtml = wrapInSunnyDCard(
          `<span class="sunnyd-label">✦ answer</span> ${innerHtml}`
        );
        editor
          .chain()
          .insertContentAt(insertPos, cardHtml, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .run();
        onAnswerInsert?.(sentence);
      } catch (err) {
        console.error("[SunnyD]", err);
      } finally {
        setAnsweringQuestion(null);
        onThinkingChange?.(null);
        onLoadingChange(false);
      }
    }
  }, [
    editor,
    noteType,
    isEnabled,
    isApiHealthy,
    onLoadingChange,
    onAnswerInsert,
    onThinkingChange,
  ]);

  useEffect(() => {
    if (!editor || !isEnabled("questionDetector")) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runQuestionDetection();
      }, QUESTION_DEBOUNCE_MS);
    };

    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [editor, isEnabled, runQuestionDetection]);

  // Structure suggestion: when hasOnlyH1AndFewWords, 2000ms debounce then show toast. Level 3 only.
  useEffect(() => {
    if (!editor || !isEnabled("structureSuggestion")) {
      setShowStructureSuggestion(false);
      return;
    }

    const check = () => {
      if (structureTimerRef.current) {
        clearTimeout(structureTimerRef.current);
        structureTimerRef.current = null;
      }

      if (!hasOnlyH1AndFewWords(editor, 20)) {
        setShowStructureSuggestion(false);
        return;
      }

      structureTimerRef.current = setTimeout(() => {
        structureTimerRef.current = null;
        setShowStructureSuggestion(true);
      }, STRUCTURE_DEBOUNCE_MS);
    };

    const onUpdate = () => {
      setShowStructureSuggestion(false); // dismiss on any typing
      check();
    };

    editor.on("update", onUpdate);
    check();

    return () => {
      editor.off("update", onUpdate);
      if (structureTimerRef.current) {
        clearTimeout(structureTimerRef.current);
      }
    };
  }, [editor, isEnabled]);

  const dismissStructureSuggestion = useCallback(() => {
    setShowStructureSuggestion(false);
  }, []);

  const dismissQuestion = useCallback(
    (question: DetectedQuestion) => {
      if (!editor) return;
      editor.commands.dismissQuestion?.(question.from, question.to);
      setConfirmedQuestions((prev) =>
        prev.filter((p) => p.from !== question.from || p.to !== question.to)
      );
      const key = question.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      answeredQuestionsRef.current.add(key);
    },
    [editor]
  );

  const answerQuestion = useCallback(
    async (question: DetectedQuestion) => {
      if (!editor || !isApiHealthy()) return;
      const normalized = question.text.trim().toLowerCase().replace(/[?!.,]/g, "");
      if (answeredQuestionsRef.current.has(normalized) || hasAnswerInDoc(question.text))
        return;
      answeredQuestionsRef.current.add(normalized);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      onLoadingChange(true);
      setConfirmedQuestions((prev) =>
        prev.filter((p) => p.from !== question.from || p.to !== question.to)
      );
      setAnsweringQuestion(question);
      editor.commands.setQuestionAnswering?.(question.from, question.to);
      onThinkingChange?.({ from: question.from, to: question.to });

      const docContext = extractDocumentText(editor).slice(0, 1200);

      try {
        const res = await fetch("/api/ai/answer-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionText: question.text,
            docContext,
            noteType,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok || abortControllerRef.current.signal.aborted) {
          onLoadingChange(false);
          return;
        }

        const { answer } = await res.json();
        const trimmed = (answer ?? "").trim();

        const rawPos = editor.state.doc.resolve(question.to).after();
        const insertPos = findSafeInsertionPoint(editor, rawPos);

        if (trimmed && !abortControllerRef.current.signal.aborted) {
          const html = markdownToHtml(trimmed);
          const cardHtml = wrapInSunnyDCard(
            `<p class="sunnyd-crafting">${html}</p>`
          );
          editor
            .chain()
            .insertContentAt(insertPos, cardHtml, {
              parseOptions: { preserveWhitespace: "full" },
            })
            .setMeta("addToHistory", true)
            .focus()
            .run();
          onAnswerInsert?.(question.text);
        } else if (trimmed === "" && !abortControllerRef.current.signal.aborted) {
          const cardHtml = wrapInSunnyDCard(
            `<p class="sunnyd-crafting">${escapeHtml(SUNNYD.rhetoricalExpand)}</p>`
          );
          editor
            .chain()
            .insertContentAt(insertPos, cardHtml, {
              parseOptions: { preserveWhitespace: "full" },
            })
            .setMeta("addToHistory", true)
            .focus()
            .run();
          onAnswerInsert?.(question.text);
        }
      } catch (err) {
        console.error("[SunnyD]", err);
        return;
      } finally {
        setAnsweringQuestion(null);
        editor.commands.clearQuestionAnswering?.();
        onThinkingChange?.(null);
        onLoadingChange(false);
        abortControllerRef.current = null;
      }
    },
    [editor, noteType, onLoadingChange, onAnswerInsert, onThinkingChange, isApiHealthy]
  );

  const runStructureSuggestion = useCallback(async () => {
    if (!editor || !isApiHealthy()) return;

    dismissStructureSuggestion();
    onLoadingChange(true);
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const documentContent = extractDocumentText(editor);
    const insertPos = getPositionAfterFirstH1(editor) ?? 1;

    try {
      const res = await fetch("/api/ai/slash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "structure",
          documentContent: documentContent.slice(0, 4000),
          precedingParagraph: "",
          cursorContext: documentContent.slice(0, 800),
          noteType,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok || !res.body || abortControllerRef.current.signal.aborted) {
        onLoadingChange(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      const trimmed = accumulated.trim();
      if (trimmed && !abortControllerRef.current.signal.aborted) {
        const headings = trimmed.split("\n").filter(Boolean);
        const structureHtml = headings
          .map((h) => `<h2>${h.replace(/^#+\s*/, "").trim()}</h2>`)
          .join("");
        editor
          .chain()
          .insertContentAt(insertPos, structureHtml || "<p></p>", {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .focus()
          .run();
      }
    } catch (err) {
      console.error("[SunnyD]", err);
    } finally {
      onLoadingChange(false);
      abortControllerRef.current = null;
    }
  }, [editor, noteType, onLoadingChange, dismissStructureSuggestion]);

  const addActionItemToList = useCallback(
    (text: string, from: number, to: number) => {
      if (!editor || !isEnabled("actionItemDetector")) return;

      const targetPos = findActionItemsSectionPos(editor);
      const safe = escapeHtml(text);
      const itemHtml = `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${safe}</p></li></ul>`;

      if (targetPos !== null) {
        editor
          .chain()
          .deleteRange({ from, to })
          .insertContentAt(targetPos, itemHtml, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .setMeta("addToHistory", true)
          .focus()
          .run();
      } else {
        const sectionHtml = `<h2>Action Items</h2>${itemHtml}`;
        editor
          .chain()
          .deleteRange({ from, to })
          .command(({ state, chain }) => {
            const newDocEnd = state.doc.content.size;
            return chain()
              .insertContentAt(newDocEnd, sectionHtml, {
                parseOptions: { preserveWhitespace: "full" },
              })
              .setMeta("addToHistory", true)
              .focus()
              .run();
          })
          .run();
      }
    },
    [editor, isEnabled]
  );

  return {
    confirmedQuestions,
    answeringQuestion,
    showStructureSuggestion,
    dismissStructureSuggestion,
    answerQuestion,
    dismissQuestion,
    runStructureSuggestion,
    addActionItemToList,
  };
}
