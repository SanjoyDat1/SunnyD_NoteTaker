/** Remove characters Google Docs API strips from inserted text — shared by plain + Markdown paths. */

export function sanitizeForDocsInsert(t) {
  return Array.from(String(t ?? "").replace(/\uFEFF/g, ""))
    .filter(ch => {
      const cp = ch.codePointAt(0);
      if (cp <= 0x1f) return cp === 9 || cp === 10 || cp === 13;
      if (cp >= 0xe000 && cp <= 0xf8ff) return false;
      return true;
    })
    .join("");
}
