"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { DetectedQuestion } from "@/extensions/PatternDetectorExtension";
import { SUNNYD } from "@/lib/sunnyd";
import { motion, AnimatePresence } from "framer-motion";

export interface QuestionAnswerPromptsProps {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLElement | null>;
  questions: DetectedQuestion[];
  answeringQuestion: DetectedQuestion | null;
  onAnswer: (question: DetectedQuestion) => void;
}

export function QuestionAnswerPrompts({
  editor,
  containerRef,
  questions,
  answeringQuestion,
  onAnswer,
}: QuestionAnswerPromptsProps) {
  const [positions, setPositions] = useState<
    Array<{ question: DetectedQuestion; x: number; y: number }>
  >([]);

  useEffect(() => {
    if (!editor?.view || !containerRef.current || questions.length === 0) {
      setPositions([]);
      return;
    }

    const update = () => {
      const containerRect = containerRef.current!.getBoundingClientRect();
      const view = editor.view;
      const result: Array<{ question: DetectedQuestion; x: number; y: number }> =
        [];
      for (const q of questions) {
        try {
          const coords = view.coordsAtPos(q.to);
          result.push({
            question: q,
            x: coords.right - containerRect.left - 4,
            y: coords.bottom - containerRect.top + 4,
          });
        } catch {
          // pos may be invalid if doc changed
        }
      }
      setPositions(result);
    };

    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor, containerRef, questions]);

  if (positions.length === 0) return null;

  return (
    <>
      <AnimatePresence>
        {positions.map(({ question, x, y }) => {
          const isAnswering =
            answeringQuestion &&
            answeringQuestion.from === question.from &&
            answeringQuestion.to === question.to;
          return (
            <motion.div
              key={`${question.from}-${question.to}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-0 z-[100] flex items-center gap-2 pointer-events-auto"
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              {isAnswering ? (
                <span className="flex items-center gap-1.5 rounded-md bg-[rgba(45,106,79,0.12)] px-2.5 py-1.5 text-xs font-sans text-[#2d6a4f] ring-1 ring-[rgba(45,106,79,0.25)] animate-pulse">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2d6a4f] animate-pulse" />
                  SunnyD is thinking...
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAnswer(question);
                  }}
                  className="flex items-center gap-1 rounded-md bg-surface px-3 py-1.5 text-xs font-sans font-medium text-accent shadow-md ring-1 ring-border hover:bg-accent/10 hover:ring-accent/30 transition-colors cursor-pointer"
                >
                  {SUNNYD.answerThis}
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}
