/** Chars before/after selection for local grounding */
const LOCAL_WINDOW = 720;
/** Tail of finalized lecture transcript to include */
const LECTURE_TAIL_CHARS = 3800;
/** For lecture-only deploy: last N words as pseudo-highlight */
const PSEUDO_HIGHLIGHT_WORDS = 120;

/**
 * Builds LLM-facing note text plus a verification plain string whose sentinel blocks satisfy sourceQuote checks.
 *
 * @param {{
 *   notePlain: string,
 *   selStart?: number,
 *   selEnd?: number,
 *   highlightText?: string,
 *   finalTranscript?: string,
 *   interimTranscript?: string,
 *   lectureOn?: boolean,
 * }} o
 */
export function buildSelectionAgentBundle(o) {
  const np = String(o.notePlain ?? "");
  const hi = String(o.highlightText ?? "").trim();
  let start = Number.isFinite(o.selStart) ? o.selStart : -1;
  let end = Number.isFinite(o.selEnd) ? o.selEnd : -1;

  let highlight = hi;
  if (!highlight && start >= 0 && end > start) {
    highlight = np.slice(Math.max(0, start), Math.min(np.length, end)).trim();
  }

  const before =
    start >= 0 && end > start ? np.slice(Math.max(0, start - LOCAL_WINDOW), Math.max(0, start)) : "";
  const after =
    start >= 0 && end > start ? np.slice(Math.min(np.length, end), Math.min(np.length, end + LOCAL_WINDOW)) : "";

  const lecRaw = String(o.finalTranscript ?? "").trim();
  const tail = lecRaw.length > LECTURE_TAIL_CHARS ? lecRaw.slice(-LECTURE_TAIL_CHARS) : lecRaw;

  let lectureSection = "";
  if (tail || (o.interimTranscript || "").trim()) {
    lectureSection = `\n---\nLecture (${o.lectureOn ? "recording on" : "context"}):\n`;
    if (tail) lectureSection += `Recent final transcript:\n"""${tail}"""\n`;
    const interim = String(o.interimTranscript ?? "").trim().slice(0, 320);
    if (interim) lectureSection += `Interim speech (partial): "${interim}"\n`;
  }

  const intent =
    "ACTION: Extract Workspace items (calendar, meeting with emails from THIS text only, Docs/Sheets/drafts). Prioritize commitments tied to the Highlight and lecture. Each sourceQuote must be verbatim from the FULL NOTE above, the Highlight line below, or the Lecture section.";

  const llmNoteText = `${np}

---
${intent}

Local passage:
Before: """${before}"""
Highlight: """${highlight}"""
After: """${after}"""
${lectureSection}`;

  /** Short tail for sentinel (quote verification uses full tail block when present) */
  const lecVerify = tail
    ? tail.length > 600
      ? tail.slice(-600)
      : tail
    : String(o.interimTranscript ?? "").trim().slice(0, 400);

  const lectureSentinel =
    lecVerify.length >= 15
      ? `\n[Lecture excerpt for agents]\n"""${lecVerify}"""`
      : "";

  const verificationPlain = `${np}\n\n---\nUser selection (agents):\n"""${highlight}"""${lectureSentinel}`;

  return { llmNoteText, verificationPlain };
}

/**
 * Pseudo-highlight from transcript tail — for "Act on transcript" without editor selection.
 */
export function buildLectureOnlyAgentBundle(o) {
  const np = String(o.notePlain ?? "");
  const lecRaw = String(o.finalTranscript ?? "").trim();
  const words = lecRaw.match(/\S+/g) || [];
  const sliced = words.slice(Math.max(0, words.length - PSEUDO_HIGHLIGHT_WORDS));
  let pseudo = sliced.join(" ").trim();

  if (pseudo.length < 40 && lecRaw.length) {
    pseudo = lecRaw.length > 2000 ? lecRaw.slice(-2000).trim() : lecRaw;
  }

  const tailFull = lecRaw.length > LECTURE_TAIL_CHARS ? lecRaw.slice(-LECTURE_TAIL_CHARS) : lecRaw;
  let lectureSection = `\n---\nLecture (full recent context):\n"""${tailFull}"""\n`;
  const interim = String(o.interimTranscript ?? "").trim().slice(0, 320);
  if (interim) lectureSection += `Interim: "${interim}"\n`;

  const intent =
    "ACTION: Extract Workspace tasks from lecture audio (exam dates, readings, deadlines, spreadsheet requests). sourceQuote verbatim from Lecture section or pseudohighlight line below.";

  const llmNoteText = `${np}

---
${intent}

Pseudohighlight (latest ~${PSEUDO_HIGHLIGHT_WORDS} words):\n"""${pseudo}"""

${lectureSection}`;

  const verTail = pseudo.length > 700 ? pseudo.slice(-700) : pseudo;
  const verificationPlain = `${np}\n\n---\nLecture focus (agents) — pseudohighlight:\n"""${verTail}"""`;

  return { llmNoteText, verificationPlain };
}
