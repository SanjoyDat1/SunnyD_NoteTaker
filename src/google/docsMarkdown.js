/**
 * Minimal Markdown → flat string + style ops (UTF-16 offsets; JS string indices).
 */

/** @typedef {{ type: "bold"|"italic", start: number, end: number }} TextStyleSpan */

export function sanitizeForDocsSeg(s) {
  return Array.from(String(s ?? "").replace(/\uFEFF/g, ""))
    .filter(ch => {
      const cp = ch.codePointAt(0);
      if (cp <= 0x1f) return cp === 9 || cp === 10 || cp === 13;
      if (cp >= 0xe000 && cp <= 0xf8ff) return false;
      return true;
    })
    .join("");
}

export function parseInlinesPlainAndSpans(line) {
  /** @type {TextStyleSpan[]} */
  const spans = [];
  let plain = "";
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const j = line.indexOf("**", i + 2);
      if (j !== -1) {
        const inner = sanitizeForDocsSeg(line.slice(i + 2, j));
        const start = plain.length;
        plain += inner;
        if (inner.length > 0) spans.push({ type: "bold", start, end: plain.length });
        i = j + 2;
        continue;
      }
    }
    if (line[i] === "*" && line[i + 1] !== "*") {
      const j = line.indexOf("*", i + 1);
      if (j > i + 1) {
        const inner = sanitizeForDocsSeg(line.slice(i + 1, j));
        const start = plain.length;
        plain += inner;
        if (inner.length > 0) spans.push({ type: "italic", start, end: plain.length });
        i = j + 1;
        continue;
      }
    }
    plain += sanitizeForDocsSeg(line[i]);
    i++;
  }
  return { plain, spans };
}

/** @typedef {{ kind: "h", level: 1 | 2 | 3, line: string } | { kind: "ul", items: string[] } | { kind: "p", lines: string[] } | { kind: "blank" }} MdBlock */

export function parseMarkdownBlocks(markdown) {
  const raw = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  /** @type {MdBlock[]} */
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      blocks.push({ kind: "blank" });
      i++;
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      blocks.push({ kind: "h", level: 3, line: sanitizeForDocsSeg(trimmed.replace(/^###\s+/, "")) });
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed) && !/^###\s/.test(trimmed)) {
      blocks.push({ kind: "h", level: 2, line: sanitizeForDocsSeg(trimmed.replace(/^##\s+/, "")) });
      i++;
      continue;
    }
    if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) {
      blocks.push({ kind: "h", level: 1, line: sanitizeForDocsSeg(trimmed.replace(/^#\s+/, "")) });
      i++;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const items = [bulletMatch[1]];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = t.match(/^[-*]\s+(.+)$/);
        if (m) items.push(m[1]), i++;
        else break;
      }
      blocks.push({ kind: "ul", items: items.map(sanitizeForDocsSeg) });
      continue;
    }

    const para = [lines[i]];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (/^#{1,3}\s+/.test(t) || /^[-*]\s+/.test(t)) break;
      para.push(lines[i]);
      i++;
    }
    if (para.join("\n").trim()) blocks.push({ kind: "p", lines: para });
  }

  /** collapse duplicate blank markers */
  return blocks.filter(
    (b, idx) => b.kind !== "blank" || idx === 0 || blocks[idx - 1].kind !== "blank"
  );
}

/**
 * Concatenated plaintext + ranges for Docs (absolute indices into `plain`).
 */
export function buildMarkdownDocModel(markdown) {
  const blocks = parseMarkdownBlocks(markdown).filter(b => b.kind !== "blank");
  let plain = "";
  /** @type {{ type: "bold" | "italic"; absStart: number; absEnd: number }[]} */
  const textStyles = [];
  /** @type {{ level: 1 | 2 | 3; absStart: number; absEnd: number }[]} */
  const paragraphStyles = [];
  /** @type {{ absStart: number; absEnd: number }[]} */
  const bulletRanges = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (bi > 0) plain += "\n";

    if (b.kind === "h") {
      const inl = parseInlinesPlainAndSpans(b.line);
      const startP = plain.length;
      plain += inl.plain + "\n";
      const lineEnd = plain.length;
      for (const s of inl.spans) {
        textStyles.push({
          type: s.type,
          absStart: startP + s.start,
          absEnd: startP + s.end,
        });
      }
      paragraphStyles.push({ level: b.level, absStart: startP, absEnd: lineEnd });
      continue;
    }

    if (b.kind === "ul") {
      let ulStart = -1;
      let ulEnd = -1;
      for (const item of b.items) {
        const inl = parseInlinesPlainAndSpans(item);
        const lnStart = plain.length;
        if (ulStart < 0) ulStart = lnStart;
        plain += inl.plain + "\n";
        ulEnd = plain.length;
        for (const s of inl.spans) {
          textStyles.push({
            type: s.type,
            absStart: lnStart + s.start,
            absEnd: lnStart + s.end,
          });
        }
      }
      if (ulStart >= 0 && ulEnd >= ulStart) bulletRanges.push({ absStart: ulStart, absEnd: ulEnd });
      continue;
    }

    if (b.kind === "p") {
      for (let li = 0; li < b.lines.length; li++) {
        const inl = parseInlinesPlainAndSpans(b.lines[li].trimEnd());
        const lnStart = plain.length;
        plain += inl.plain;
        for (const s of inl.spans) {
          textStyles.push({
            type: s.type,
            absStart: lnStart + s.start,
            absEnd: lnStart + s.end,
          });
        }
        if (li < b.lines.length - 1) plain += "\n";
      }
      plain += "\n";
      continue;
    }
  }

  return { plain, textStyles, paragraphStyles, bulletRanges };
}
