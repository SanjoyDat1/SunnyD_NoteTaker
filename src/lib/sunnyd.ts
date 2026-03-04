/**
 * SunnyD — centralized display strings and proactivity levels.
 * Warm, brief, never shows off. Never hardcode these in components.
 */

export type SunnyDLevel = 0 | 1 | 2 | 3;

export const SUNNYD_LEVEL_LABELS: Record<SunnyDLevel, string> = {
  0: "Off",
  1: "1",
  2: "2",
  3: "3",
};

export const SUNNYD_LEVEL_TOOLTIPS: Record<SunnyDLevel, string> = {
  0: "Just a notes app",
  1: "SunnyD completes your thoughts",
  2: "SunnyD helps when you ask",
  3: "SunnyD is fully watching",
};

export const FEATURE_FLAGS = {
  ghostText: [1, 2, 3],
  selectionToolbar: [2, 3],
  slashCommands: [2, 3],
  noteTypeDetection: [2, 3],
  questionDetector: [2, 3],
  actionItemDetector: [2, 3],
  meetingMode: [2, 3],
  marginInsights: [3],
  proactive: [3],
  proposalMarkers: [3],
  connectionSurfacing: [3],
  structureSuggestion: [3],
  listContinuation: [3],
  autoTitling: [3],
  wordCounter: [0, 1, 2, 3],
  checklistDetection: [1, 2, 3],
  smartSentenceEnding: [1],
} as const;

export function isEnabled(
  feature: keyof typeof FEATURE_FLAGS,
  level: SunnyDLevel
): boolean {
  return (FEATURE_FLAGS[feature] as readonly number[]).includes(level);
}

/** Intents excluded at Level 1 & 2 (too intrusive). Level 3 gets all 8. */
export const INTENTS_FULL_SUITE = ["NEEDS_OPPOSITE", "NEEDS_LINK"] as const;

/** Status bar — what SunnyD is doing right now */
export const SUNNYD_STATUS = {
  idle: "SunnyD",
  readingDoc: "SunnyD is reading your notes...",
  findingConnections: "SunnyD is connecting ideas...",
  generatingProposal: "SunnyD is thinking of suggestions...",
  detectingType: "SunnyD is figuring out your note type...",
  ghostPending: "SunnyD · Tab to complete",
  verifyNumber: "SunnyD · verify this statistic ✱",
  working: "SunnyD is working...",
} as const;

export const SUNNYD = {
  /** Status bar */
  thinking: "SunnyD is thinking...",
  tabToComplete: "SunnyD · Tab to complete",
  verifyStatistic: (label: string) => `SunnyD · verify ${label} ✱`,
  ready: "SunnyD · AI ready",

  /** Margin / insights */
  noticed: "SunnyD noticed",
  suggests: "SunnyD suggests",
  addQuestionToNotes: "add to notes",

  /** Structure toast */
  structureToast: "SunnyD can sketch a structure for this →",

  /** Question detector */
  answerThis: "SunnyD · Answer this?",

  /** Connection surfacing */
  foundConnection: "SunnyD found a connection",

  /** Proposal marker card header */
  proposalHeader: "SunnyD suggests",

  /** Settings (future) */
  completions: "SunnyD completions",
  insights: "SunnyD insights",

  /** Welcome hint */
  welcomeHint:
    "SunnyD is here · type / for commands · select text for actions",

  /** Note type badge prefix */
  noteTypeBadge: (type: string) => `SunnyD · ${type}`,

  /** Rhetorical question (no answer) */
  rhetoricalExpand: "SunnyD · this might be worth expanding ↓",

  /** Contradiction flag */
  flaggedContradiction: "⚠ SunnyD flagged a contradiction",
} as const;
