/**
 * Pattern detection regexes and helpers for the PatternDetectorExtension.
 */

/** Question words — sentences containing these + ending in ? are candidates */
export const QUESTION_WORDS =
  /\b(who|what|where|when|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will)\b/i;

/** Extract candidate questions: sentences ending in ? with a question word, length > 15 */
export function extractCandidateQuestions(
  text: string
): Array<{ text: string; start: number; end: number }> {
  const results: Array<{ text: string; start: number; end: number }> = [];
  const matches = text.matchAll(/[^.!?\n]+[?]/g);
  for (const m of matches) {
    const sentence = (m[0] ?? "").trim();
    if (
      sentence.length > 15 &&
      QUESTION_WORDS.test(sentence)
    ) {
      results.push({
        text: sentence,
        start: m.index ?? 0,
        end: (m.index ?? 0) + (m[0]?.length ?? 0),
      });
    }
  }
  return results;
}

/** Match a sentence ending in ? at end of line (for question detection) */
export const QUESTION_LINE_REGEX = /[^.!?]+\?(\s*)$/m;

/** Match question clauses anywhere in text (e.g. "...text. What is X? More text.") */
export const QUESTION_GLOBAL_REGEX = /[^.!?]*\?/g;

/** Action item phrase patterns - case insensitive */
export const ACTION_ITEM_PATTERNS = [
  /\bI need to\b/i,
  /\bwe should\b/i,
  /\bfollow up on\b/i,
  /\bTODO\s*:/i,
  /\bAction\s*:/i,
  /\bACTION\s*:/i,
  /\bto[- ]?do\s*:/i,
  /\b(follow[- ]?up|followup)\b/i,
];

/** Person name + "will" + verb (simplified: "will" before a verb) */
export const PERSON_WILL_PATTERN = /\b[A-Z][a-z]+\s+will\s+\w+/;

/** Combined regex for action item detection */
export function getActionItemRegex(): RegExp {
  const parts = ACTION_ITEM_PATTERNS.map((r) => r.source);
  parts.push(PERSON_WILL_PATTERN.source);
  return new RegExp(`(${parts.join("|")})`, "gi");
}

/** Find all matches of regex in text, return [start, end] pairs (text offsets) */
export function findMatchesInText(
  text: string,
  regex: RegExp
): Array<{ start: number; end: number; text: string }> {
  const results: Array<{ start: number; end: number; text: string }> = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let match;
  while ((match = re.exec(text)) !== null) {
    results.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }
  return results;
}
