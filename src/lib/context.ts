import type { Editor } from "@tiptap/react";
import { escapeHtml } from "@/lib/utils";

/** Style fingerprint for constraining AI output to match user's writing */
export interface StyleFingerprint {
  avgSentenceLength: number;
  usesFirstPerson: boolean;
  formality: "casual" | "neutral" | "formal";
  usesBullets: boolean;
  usesFragments: boolean;
  vocabularySample: string[];
}

function detectFormality(text: string): "casual" | "neutral" | "formal" {
  const casualMarkers = /\b(gonna|wanna|kinda|tbh|ngl|imo|lol|rn|btw)\b/i;
  const formalMarkers = /\b(therefore|consequently|furthermore|henceforth|wherein)\b/i;
  if (casualMarkers.test(text)) return "casual";
  if (formalMarkers.test(text)) return "formal";
  return "neutral";
}

/** Extract up to N characteristic words (excluding common stopwords) */
function extractUniqueWords(text: string, count: number): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "can", "this", "that",
    "these", "those", "it", "its", "i", "you", "he", "she", "we", "they",
  ]);
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (!stop.has(w) && !seen.has(w)) {
      seen.add(w);
      result.push(w);
      if (result.length >= count) break;
    }
  }
  return result;
}

export function extractStyleFingerprint(editor: Editor): StyleFingerprint {
  const text = editor.state.doc.textContent;
  const sentences = text.match(/[^.!?]+[.!?]/g) ?? [];
  const avgLen =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).filter(Boolean).length, 0) /
        sentences.length
      : 12;

  return {
    avgSentenceLength: Math.round(avgLen * 10) / 10,
    usesFirstPerson: /\bI\b|\bI'm\b|\bI'll\b|\bI've\b|\bmy\b/i.test(text),
    formality: detectFormality(text),
    usesBullets: /^[-•*]\s/m.test(text) || /^\d+\.\s/m.test(text),
    usesFragments:
      sentences.filter((s) => s.trim().split(/\s+/).filter(Boolean).length < 5).length >
      sentences.length * 0.3,
    vocabularySample: extractUniqueWords(text, 20),
  };
}

/** Extract fingerprint from plain text (for server-side use) */
export function extractStyleFingerprintFromText(text: string): StyleFingerprint {
  const sentences = text.match(/[^.!?]+[.!?]/g) ?? [];
  const avgLen =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).filter(Boolean).length, 0) /
        sentences.length
      : 12;

  return {
    avgSentenceLength: Math.round(avgLen * 10) / 10,
    usesFirstPerson: /\bI\b|\bI'm\b|\bI'll\b|\bI've\b|\bmy\b/i.test(text),
    formality: detectFormality(text),
    usesBullets: /^[-•*]\s/m.test(text) || /^\d+\.\s/m.test(text),
    usesFragments:
      sentences.filter((s) => s.trim().split(/\s+/).filter(Boolean).length < 5).length >
      sentences.length * 0.3,
    vocabularySample: extractUniqueWords(text, 20),
  };
}

/** Format fingerprint for inclusion in prompts */
export function formatStyleRulesForPrompt(fp: StyleFingerprint): string {
  return `
CRITICAL STYLE RULES — follow these or your output is wrong:
- Average sentence length in this user's notes: ${fp.avgSentenceLength} words. Match it.
- First person: ${fp.usesFirstPerson ? "Yes — write as if you are the user (use 'I')" : "No — write in third person or neutral"}.
- Formality: ${fp.formality}. Do not be more or less formal than this.
- Fragments: ${fp.usesFragments ? "This user writes in fragments. Match that." : "Write in full sentences."}
- Vocabulary sample from their notes: ${fp.vocabularySample.join(", ")}. Use similar words, not synonyms that feel foreign.

If you cannot write something that sounds like this person wrote it themselves, return empty string. Generic filler is worse than nothing.
`.trim();
}

export const BANNED_PHRASES = [
  "it's important to",
  "it's worth noting",
  "this is a key",
  "plays a crucial role",
  "in today's world",
  "when it comes to",
  "there are many",
  "as mentioned above",
  "in conclusion",
  "to summarize",
  "overall",
  "in general",
  "various",
  "numerous",
] as const;

export function formatBannedPhrasesForPrompt(): string {
  return `
BANNED PHRASES — if your output contains any of these, return empty string instead:
${BANNED_PHRASES.join(", ")}

If you catch yourself about to write one of these, stop and be more specific or return empty string.
`.trim();
}

/** Content structure for SunnyD cards — never dump raw AI text. */
export type CardContent =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "labeledParagraph"; label: string; text: string };

/** Build HTML for card content. Use escapeHtml from utils. */
export function buildCardHTML(
  content: CardContent,
  escapeFn: (s: string) => string
): string {
  if (content.type === "paragraph") {
    return `<p>${escapeFn(content.text)}</p>`;
  }
  if (content.type === "list") {
    return `<ul>${content.items.map((i) => `<li><p>${escapeFn(i)}</p></li>`).join("")}</ul>`;
  }
  if (content.type === "labeledParagraph") {
    return `<p><span class="sunnyd-label">${escapeFn(content.label)}</span> ${escapeFn(content.text)}</p>`;
  }
  return "";
}

/** Wrap content in a SunnyD card node (for Tiptap insertContentAt) */
export function wrapInSunnyDCard(innerHtml: string): string {
  return `<div data-type="sunnyd-card" class="sunnyd-card">${innerHtml}</div>`;
}

/** Border colors by proactive intervention type */
export const PROACTIVE_BORDER_COLORS: Record<string, string> = {
  CLARIFY: "rgba(45, 106, 79, 0.4)",
  QUESTION: "rgba(59, 130, 246, 0.4)",
  QUIZ: "rgba(139, 92, 246, 0.4)",
  SUMMARIZE: "rgba(45, 106, 79, 0.4)",
  GAP: "rgba(245, 158, 11, 0.4)",
  CONNECT: "rgba(20, 184, 166, 0.4)",
  PUSHBACK: "rgba(249, 115, 22, 0.4)",
};

/** Build HTML for a proactive SunnyD card with optional label and border color */
export function wrapProactiveCard(
  innerHtml: string,
  opts: { label?: string; cardType?: string; borderColor?: string }
): string {
  const { label, cardType, borderColor } = opts;
  const parts: string[] = [];
  if (label) {
    parts.push(`<span class="sunnyd-label">${escapeHtml(label)}</span>`);
  }
  parts.push(innerHtml);
  const style = borderColor ? `border-left-color: ${borderColor};` : "";
  const attrs = [
    'data-type="sunnyd-card"',
    "class=\"sunnyd-card\"",
    style ? `style="${style}"` : "",
    cardType ? `data-card-type="${cardType}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div ${attrs}>${parts.join(" ")}</div>`;
}

/** Find position after the block containing targetPos. Never insert mid-paragraph. */
export function findSafeInsertionPoint(
  editor: Editor,
  targetPos: number
): number {
  const doc = editor.state.doc;
  const $pos = doc.resolve(Math.min(targetPos, doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      return $pos.before(d) + node.nodeSize;
    }
  }
  return Math.min(targetPos, doc.content.size);
}

/**
 * Context extraction utilities for AI prompts.
 * Editor instance required — these will be used once the full editor is wired.
 */

export function extractTextBefore(editor: Editor, chars: number): string {
  const { from } = editor.state.selection;
  const start = Math.max(0, from - chars);
  return editor.state.doc.textBetween(start, from, "\n");
}

export function extractTextAfter(editor: Editor, chars: number): string {
  const { to } = editor.state.selection;
  const end = Math.min(editor.state.doc.content.size, to + chars);
  return editor.state.doc.textBetween(to, end, "\n");
}

export function extractPrecedingParagraph(editor: Editor): string {
  const range = extractPrecedingParagraphRange(editor);
  if (!range) return "";
  return editor.state.doc.textBetween(range.from, range.to, "\n");
}

/** Get the range (from, to) of the paragraph immediately before the cursor */
export function extractPrecedingParagraphRange(
  editor: Editor
): { from: number; to: number } | null {
  const { from } = editor.state.selection;
  const doc = editor.state.doc;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && pos + node.nodeSize <= from) {
      found = { from: pos, to: pos + node.nodeSize };
    }
    return true;
  });
  return found;
}

export function extractDocumentText(editor: Editor): string {
  return editor.state.doc.textContent;
}

/** Map character offset in full document text to doc position. */
export function textOffsetToDocPos(
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

export function getWordCount(editor: Editor): number {
  const text = editor.state.doc.textContent;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function extractTitle(editor: Editor): string {
  let title = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.attrs.level === 1) {
      title = node.textContent;
      return false;
    }
    return true;
  });
  if (!title) {
    const firstLine = editor.state.doc.firstChild?.textContent ?? "";
    title = firstLine.split("\n")[0] ?? "";
  }
  return title;
}

export function getLineAtPos(editor: Editor, pos: number): string {
  const $pos = editor.state.doc.resolve(pos);
  const from = $pos.start();
  const to = $pos.end();
  return editor.state.doc.textBetween(from, to, "\n");
}

export function findTextPosition(editor: Editor, text: string): number | null {
  const docText = editor.state.doc.textContent;
  const idx = docText.indexOf(text);
  return idx >= 0 ? idx : null;
}

/** Find anchor phrase in document; return doc positions { from, to } or null. */
export function findAnchorInDoc(
  doc: import("@tiptap/pm/model").Node,
  anchorText: string
): { from: number; to: number } | null {
  const docText = doc.textContent;
  const trimmed = anchorText.trim();
  if (!trimmed) return null;

  let startOffset: number;
  let matchLength: number;
  const exactIdx = docText.indexOf(trimmed);
  if (exactIdx >= 0) {
    startOffset = exactIdx;
    matchLength = trimmed.length;
  } else {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flexibleRe = new RegExp(escaped.replace(/\s+/g, "\\s+"), "i");
    const match = docText.match(flexibleRe);
    if (!match || match.index == null) return null;
    startOffset = match.index;
    matchLength = match[0].length;
  }

  const from = textOffsetToPos(doc, startOffset);
  const to = textOffsetToPos(doc, startOffset + matchLength);
  if (from === null || to === null) return null;
  return { from, to };
}

/** Check if cursor is inside a heading node (H1 or H2) */
export function isCursorInHeading(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name !== "heading") return false;
  const level = node.attrs.level;
  return level === 1 || level === 2;
}

/** Check if the character immediately before the cursor is a slash */
export function isLastCharSlash(editor: Editor): boolean {
  const { from } = editor.state.selection;
  if (from === 0) return false;
  const char = editor.state.doc.textBetween(from - 1, from, "");
  return char === "/";
}

/** Get a signature of all H1/H2 headings for change detection */
export function getHeadingsSignature(editor: Editor): string {
  const parts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && (node.attrs.level === 1 || node.attrs.level === 2)) {
      parts.push(node.textContent);
    }
    return true;
  });
  return parts.join("|");
}

/** Map flat text offset to document position (for pattern matching) */
export function textOffsetToPos(doc: import("@tiptap/pm/model").Node, offset: number): number | null {
  let current = 0;
  let pos = 0;
  let found = false;
  doc.descendants((node, p) => {
    if (found) return false;
    if (node.isText) {
      const len = node.text?.length ?? 0;
      if (current + len >= offset) {
        pos = p + (offset - current);
        found = true;
        return false;
      }
      current += len;
    }
    return true;
  });
  return found ? pos : null;
}

/** Get last N list items (bullets or numbered) as text for list continuation */
export function getLastListItems(editor: Editor, count: number): string[] {
  const items: string[] = [];
  const doc = editor.state.doc;
  doc.descendants((node) => {
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      items.push(node.textContent.trim());
    }
    return true;
  });
  return items.slice(-count).filter(Boolean);
}

/** Check if cursor is on an empty list item (bullet or numbered) */
export function isCursorOnEmptyListItem(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      return node.textContent.trim().length === 0;
    }
  }
  return false;
}

/** Check if doc has only H1 and fewer than maxWords (for structure suggestion) */
export function hasOnlyH1AndFewWords(
  editor: Editor,
  maxWords: number = 20
): boolean {
  const wordCount = getWordCount(editor);
  if (wordCount >= maxWords) return false;
  const doc = editor.state.doc;
  let hasH1 = false;
  let hasH2OrBelow = false;
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      if (node.attrs.level === 1) hasH1 = true;
      else hasH2OrBelow = true;
    }
    return true;
  });
  return hasH1 && !hasH2OrBelow && wordCount < maxWords;
}

/** Get position after first H1 node (for structure insertion) */
export function getPositionAfterFirstH1(editor: Editor): number | null {
  const doc = editor.state.doc;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level === 1) {
      found = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  return found;
}

/** Find Action Items heading; return position after it for inserting items. */
export function findActionItemsSectionPos(editor: Editor): number | null {
  const doc = editor.state.doc;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (
      node.type.name === "heading" &&
      /action\s*items/i.test(node.textContent.trim())
    ) {
      found = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  return found;
}

/** Get position at end of doc to append Action Items block. */
export function getDocEndPos(editor: Editor): number {
  return editor.state.doc.content.size - 1;
}

/** Last sentence before cursor (for intent fulfillment) */
export function extractLastSentence(editor: Editor, maxChars: number = 300): string {
  const before = extractTextBefore(editor, maxChars);
  const parts = before.split(/([.!?]\s+)/);
  if (parts.length < 2) return before.trim();
  const last = parts.pop() ?? "";
  const beforeLast = parts.pop() ?? "";
  return (beforeLast + last).trim();
}

/** Text from earlier in doc (before last N chars from cursor) for NEEDS_LINK */
export function extractEarlierContent(editor: Editor, excludeLastChars: number = 400): string {
  const { from } = editor.state.selection;
  const start = Math.max(0, from - 2000);
  const end = Math.max(0, from - excludeLastChars);
  if (end <= start) return "";
  return editor.state.doc.textBetween(start, end, "\n").slice(-600);
}

/** Get content above cursor up to previous H1/H2 (for /summarize) */
export function extractContentAboveCursorUntilHeading(
  editor: Editor,
  maxChars: number
): string {
  const { from } = editor.state.selection;
  const doc = editor.state.doc;
  let end = from;
  let start = Math.max(0, from - maxChars);

  doc.nodesBetween(start, from, (node, pos) => {
    if (node.type.name === "heading" && (node.attrs.level === 1 || node.attrs.level === 2)) {
      if (pos + node.nodeSize <= from) {
        start = pos + node.nodeSize;
      }
    }
    return true;
  });

  return doc.textBetween(start, end, "\n");
}
