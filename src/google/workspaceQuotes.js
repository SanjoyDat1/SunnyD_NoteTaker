/** Normalize note text vs model sourceQuote so verification survives typography differences. */

function normalizeForQuoteMatch(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse whitespace completely (for pasted / list formatting mismatches). */
function compactLetters(s) {
  return normalizeForQuoteMatch(s).replace(/\s+/g, "");
}

/**
 * @param {string} plainText
 * @param {string} quote
 * @returns {boolean}
 */
export function plainTextMatchesSourceQuote(plainText, quote) {
  const q = String(quote ?? "").trim();
  if (q.length < 10) return false;
  if (!plainText) return false;
  if (plainText.includes(q)) return true;
  const pn = normalizeForQuoteMatch(plainText);
  const qn = normalizeForQuoteMatch(q);
  if (qn.length < 10) return false;
  if (pn.includes(qn)) return true;
  const pc = compactLetters(plainText);
  const qc = compactLetters(q);
  if (qc.length >= 10 && pc.includes(qc)) return true;
  return false;
}
