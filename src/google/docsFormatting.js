/** Google Docs body helpers — map merged UTF-16 text indices to API document indices. */

function iterateParagraphElements(body, fn) {
  for (const se of body?.content ?? []) {
    const els = se?.paragraph?.elements;
    if (!els?.length) continue;
    for (const el of els) fn(el);
  }
}

export function mergedTextFromBody(body) {
  let merged = "";
  iterateParagraphElements(body, el => {
    const c = el.textRun?.content;
    if (c !== undefined && c !== null) merged += String(c);
  });
  return merged;
}

/**
 * @param {object} body — document.body or documentTab.body
 * @param {string} merged — from mergedTextFromBody(body)
 * @param {number} utf16Offset — 0 .. merged.length (end offset uses merged.length)
 * @returns {number | null}
 */
export function mergedOffsetToDocIndex(body, merged, utf16Offset) {
  if (utf16Offset < 0 || utf16Offset > merged.length) return null;
  if (utf16Offset === merged.length) {
    let lastEnd = null;
    iterateParagraphElements(body, el => {
      if (el.endIndex !== undefined) lastEnd = el.endIndex;
    });
    return lastEnd;
  }

  let cum = 0;
  /** @type {number | null} */
  let found = null;
  iterateParagraphElements(body, el => {
    const t = el.textRun?.content;
    if (t === undefined || el.startIndex === undefined) return;
    const txt = String(t);
    const ln = txt.length;
    const nextCum = cum + ln;
    if (utf16Offset >= cum && utf16Offset < nextCum) {
      found = el.startIndex + (utf16Offset - cum);
    }
    cum = nextCum;
  });

  /** Boundary between runs lands on next segment start */
  let cum2 = 0;
  iterateParagraphElements(body, el => {
    if (found !== null) return;
    const t = el.textRun?.content;
    if (t === undefined) return;
    const ln = String(t).length;
    const next = cum2 + ln;
    if (utf16Offset === next && el.endIndex !== undefined) found = el.endIndex;
    cum2 = next;
  });

  /** offset 0 fallback */
  if (found === null && utf16Offset === 0) {
    iterateParagraphElements(body, el => {
      if (found !== null) return;
      if (el.textRun?.content && el.startIndex !== undefined) found = el.startIndex;
    });
  }

  return found;
}

/**
 * Absolute Google Range for a contiguous substring of merged body text.
 * @returns {{ startIndex: number, endIndex: number } | null}
 */
export function findInsertedPlainRangeIndexes(body, plain) {
  const merged = mergedTextFromBody(body);
  let idx = merged.lastIndexOf(plain);
  if (idx < 0) idx = merged.lastIndexOf(plain.trim());
  if (idx < 0) idx = merged.indexOf(plain);
  if (idx < 0) return null;

  const start = mergedOffsetToDocIndex(body, merged, idx);
  const end = mergedOffsetToDocIndex(body, merged, idx + plain.length);
  if (start === null || end === null || end <= start) return null;
  return { startIndex: start, endIndex: end };
}
