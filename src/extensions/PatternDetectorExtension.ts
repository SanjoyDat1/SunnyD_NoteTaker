import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  getActionItemRegex,
  findMatchesInText,
  QUESTION_GLOBAL_REGEX,
} from "@/lib/patterns";

export interface DetectedQuestion {
  from: number;
  to: number;
  text: string;
}

export interface PatternDetectorOptions {
  onQuestionDetected?: (questions: DetectedQuestion[]) => void;
  /** Called when user clicks a question; (question, mouseEvent) for menu positioning */
  onQuestionClick?: (question: DetectedQuestion, event: MouseEvent) => void;
  onActionItemClick?: (text: string, from: number, to: number) => void;
}

export const patternDetectorPluginKey = new PluginKey<{
  questions: DetectedQuestion[];
  actionItemRanges: Array<{ from: number; to: number; text: string }>;
  answeringQuestion: { from: number; to: number } | null;
  dismissedKeys: Set<string>;
}>("patternDetector");

/**
 * Maps a character offset in the full document text to a document position.
 */
function textOffsetToDocPos(
  doc: import("@tiptap/pm/model").Node,
  targetOffset: number
): number | null {
  let offset = 0;
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (node.isText && node.text) {
      const len = node.text.length;
      if (offset + len > targetOffset) {
        result = pos + 1 + (targetOffset - offset);
        return false;
      }
      offset += len;
    }
    return true;
  });
  return result;
}

/**
 * Detect questions and action items in the document.
 * Questions: any clause ending in ? (e.g. "What is this?" mid-paragraph).
 */
function detectPatterns(
  doc: import("@tiptap/pm/model").Node,
  actionItemRegex: RegExp
): {
  questions: DetectedQuestion[];
  actionItemRanges: Array<{ from: number; to: number; text: string }>;
} {
  const fullText = doc.textContent;
  const questions: DetectedQuestion[] = [];
  const questionMatches = findMatchesInText(fullText, QUESTION_GLOBAL_REGEX);
  for (const m of questionMatches) {
    const text = m.text.trim();
    if (text.length < 4) continue; // Skip "?", "? ", "a?" etc.
    const from = textOffsetToDocPos(doc, m.start);
    const to = textOffsetToDocPos(doc, m.end);
    if (from !== null && to !== null) {
      questions.push({ from, to, text });
    }
  }

  const actionItemRanges: Array<{ from: number; to: number; text: string }> = [];
  const actionMatches = findMatchesInText(fullText, actionItemRegex);
  for (const m of actionMatches) {
    const from = textOffsetToDocPos(doc, m.start);
    const to = textOffsetToDocPos(doc, m.end);
    if (from !== null && to !== null) {
      actionItemRanges.push({ from, to, text: m.text });
    }
  }

  return { questions, actionItemRanges };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    patternDetector: {
      setQuestionAnswering: (from: number, to: number) => ReturnType;
      clearQuestionAnswering: () => ReturnType;
      dismissQuestion: (from: number, to: number) => ReturnType;
    };
  }
}

/**
 * Tiptap extension for pattern detection: action item highlighting, question detection.
 */
export const PatternDetectorExtension = Extension.create<PatternDetectorOptions>({
  name: "patternDetector",

  addCommands() {
    return {
      setQuestionAnswering:
        (from: number, to: number) =>
        ({ tr }) => {
          tr.setMeta(patternDetectorPluginKey, { setAnswering: { from, to } });
          return true;
        },
      clearQuestionAnswering:
        () =>
        ({ tr }) => {
          tr.setMeta(patternDetectorPluginKey, { clearAnswering: true });
          return true;
        },
      dismissQuestion:
        (from: number, to: number) =>
        ({ tr }) => {
          tr.setMeta(patternDetectorPluginKey, { dismissQuestion: { from, to } });
          return true;
        },
    };
  },

  addOptions() {
    return {
      onQuestionDetected: undefined,
      onQuestionClick: undefined,
      onActionItemClick: undefined,
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    const editor = this.editor;
    const onActionItemClick = ext.options.onActionItemClick;
    const actionItemRegex = getActionItemRegex();

    return [
      new Plugin({
        key: patternDetectorPluginKey,
        state: {
          init: (_config, state): {
            questions: DetectedQuestion[];
            actionItemRanges: Array<{ from: number; to: number; text: string }>;
            answeringQuestion: { from: number; to: number } | null;
            dismissedKeys: Set<string>;
          } => {
            const { questions, actionItemRanges } = detectPatterns(
              state.doc,
              actionItemRegex
            );
            return { questions, actionItemRanges, answeringQuestion: null, dismissedKeys: new Set() };
          },
          apply: (tr, value, _oldState, newState) => {
            const meta = tr.getMeta(patternDetectorPluginKey) as
              | { setAnswering?: { from: number; to: number }; clearAnswering?: boolean; dismissQuestion?: { from: number; to: number } }
              | undefined;

            let answeringQuestion = value.answeringQuestion;
            let dismissedKeys = value.dismissedKeys ?? new Set<string>();

            if (meta?.setAnswering) {
              answeringQuestion = meta.setAnswering;
            } else if (meta?.clearAnswering) {
              answeringQuestion = null;
            }
            if (meta?.dismissQuestion) {
              dismissedKeys = new Set(dismissedKeys);
              dismissedKeys.add(`${meta.dismissQuestion.from}-${meta.dismissQuestion.to}`);
            }

            if (!tr.docChanged && !tr.selectionSet) {
              if (!meta) return value;
              return {
                questions: value.questions,
                actionItemRanges: value.actionItemRanges,
                answeringQuestion,
                dismissedKeys,
              };
            }

            const doc = newState.doc;
            const { questions, actionItemRanges } = detectPatterns(doc, actionItemRegex);
            return { questions, actionItemRanges, answeringQuestion, dismissedKeys };
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = patternDetectorPluginKey.getState(state);
            if (!pluginState) return DecorationSet.empty;

            const decos: Decoration[] = [];
            const answering = pluginState.answeringQuestion;

            const dismissed = pluginState.dismissedKeys ?? new Set<string>();
            for (const { from, to } of pluginState.questions) {
              if (dismissed.has(`${from}-${to}`)) continue;
              const isAnswering =
                answering &&
                answering.from === from &&
                answering.to === to;
              decos.push(
                Decoration.inline(from, to, {
                  class: isAnswering
                    ? "question-highlight sunnyd-thinking"
                    : "question-highlight",
                  "data-question": "true",
                  title: "Click to answer or dismiss",
                })
              );
            }

            for (const { from, to } of pluginState.actionItemRanges) {
              decos.push(
                Decoration.inline(from, to, {
                  class: "action-item-highlight",
                  "data-action-item": "true",
                  title: "Detected action item. Add to list?",
                })
              );
            }

            return DecorationSet.create(state.doc, decos);
          },
          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement;
            if (target?.closest?.("[data-question]")) {
              const pluginState = patternDetectorPluginKey.getState(view.state);
              const question = pluginState?.questions.find(
                (q) => pos >= q.from && pos <= q.to
              );
              const dismissed = pluginState?.dismissedKeys ?? new Set();
              if (question && !dismissed.has(`${question.from}-${question.to}`) && ext.options.onQuestionClick) {
                ext.options.onQuestionClick(question, event);
                return true;
              }
            }
            if (target?.closest?.("[data-action-item]")) {
              const pluginState = patternDetectorPluginKey.getState(view.state);
              const range = pluginState?.actionItemRanges.find(
                (r) => pos >= r.from && pos <= r.to
              );
              if (range && onActionItemClick) {
                onActionItemClick(range.text, range.from, range.to);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
