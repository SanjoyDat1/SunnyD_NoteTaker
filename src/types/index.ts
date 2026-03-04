/**
 * Detected note type — used for context in all AI prompts
 */
export type NoteType =
  | "MEETING"
  | "STUDY"
  | "BRAINSTORM"
  | "JOURNAL"
  | "TECHNICAL"
  | "PLANNING"
  | "GENERAL";

/**
 * AI status for the status bar indicator
 */
export type AIStatus =
  | "idle"
  | "ghost-pending"
  | "ghost-ready"
  | "selection-loading"
  | "analysis-running";

/**
 * Margin insight — returned from /api/ai/analyze
 */
export interface Insight {
  anchorText: string;
  type: "suggestion" | "gap" | "action" | "question";
  insight: string;
}

/**
 * Selection toolbar action
 */
export type SelectionAction =
  | "improve"
  | "summarize"
  | "expand"
  | "bullets"
  | "actions"
  | "simplify"
  | "rephrase";
