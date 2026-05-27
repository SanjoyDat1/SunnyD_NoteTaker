import { normalizeCalendarDates } from "./calendarDefaults.js";
import { formatWorkspaceScanNowAnchor, getDefaultWorkspaceTimeZone, ensureEventTimeZone } from "./workspaceNowContext.js";

/** Same threshold as Workspace scan/min UI in sunnyd.jsx. */
export const WORKSPACE_SCAN_MIN_PLAIN_CHARS = 70;

const MAX_ASSIGNMENTS_PER_SCAN = 4;

/** Merge legacy singular `assignment` into `assignments[]` after parse; cap length. Best-effort. */
function normalizeAssignmentsList(parsed, max = MAX_ASSIGNMENTS_PER_SCAN) {
  let list = [];
  if (Array.isArray(parsed.assignments)) {
    list = parsed.assignments.filter(x => x && typeof x === "object");
  }
  if (!list.length && parsed.assignment && typeof parsed.assignment === "object") {
    list = [parsed.assignment];
  }
  return list.slice(0, max);
}

/**
 * One LLM call returning calendar / assignments / meeting candidates.
 * @param {function} aiFn async (system, user, max) => string
 * @param {string} [recentLedger] recent Workspace agent lines — avoid duplicate proposals
 */
export async function analyzeWorkspaceContent(aiFn, noteTitle, plainText, metaBlock, recentLedger = "") {
  const slice = plainText.length > 12000 ? plainText.slice(-12000) : plainText;
  const system = `You are SunnyD's Google Workspace extraction assistant. Read the whole note carefully.

Extract at most ONE calendar block, ONE meeting invite, AND as many DISTINCT assignment deliverables as clearly requested — each assignment must describe a separate doc, sheet, or draft (max ${MAX_ASSIGNMENTS_PER_SCAN}). If the note only asks for one deliverable, return one entry in assignments.

Return ONLY valid JSON (no markdown):
{
  "calendar": null | {
    "summary": "short event title",
    "startIso": "ISO 8601 local datetime e.g. 2026-05-01T15:00:00",
    "endIso": "ISO 8601",
    "timeZone": "IANA e.g. America/Los_Angeles or best guess",
    "sourceQuote": "EXACT 15-120 char substring from the note this is based on",
    "confidence": 0-1,
    "description": "optional details"
  },
  "assignments": [] | [
    {
      "title": "deliverable title",
      "deliverableType": "doc" | "sheet" | "email_draft",
      "instructionsSummary": "what to produce",
      "dueIso": "optional ISO or null",
      "sourceQuote": "EXACT substring from note — must differ across items when requests differ",
      "confidence": 0-1,
      "emailTo": "optional if email_draft and addresses appear in note; else null"
    }
  ],
  "assignment": null | { same shape as one element of assignments, for backward compatibility — prefer filling assignments instead },
  "meeting": null | {
    "summary": "meeting title",
    "startIso": "ISO 8601",
    "endIso": "ISO 8601",
    "timeZone": "IANA",
    "attendeesEmails": ["only emails literally present in the note — else empty array"],
    "sourceQuote": "EXACT substring from note",
    "confidence": 0-1,
    "description": "optional"
  }
}

RULES — interpreting dates and times (critical):
- Read REFERENCE TIME above the note. "Today", "tonight", "this afternoon", and bare times like "at 3" or "3pm" MUST be resolved using today's date and the IANA time zone from REFERENCE TIME, not UTC midnight.
- "Tomorrow", "next Tuesday", "Friday", "in the next few days", "whenever works" MUST be resolved to a concrete date range in REFERENCE TIME's zone — infer the earliest plausible slot for vague requests (prefer next weekdays, business hours unless note says evening).
- If only a time appears (e.g. "meeting 4pm") with no weekday, assume that time on the earliest reasonable day: today if still ahead on the clock, else tomorrow — both in REFERENCE TIME's zone.

RULES — event duration (calendar + meeting):
- If the note states an explicit end time, a time range (“2–3 pm”, “10:00–11:30”), or an explicit duration (“30 minutes”, “90 min”, “2 hours”, “half hour”), set endIso to match that intent in the SAME timeZone as startIso (coherent clock math).
- If the note mentions only WHEN it begins (single time/date) with no stretch and no conversational length cue for that event, meeting endIso MUST typically be ONE HOUR after startIso unless a coffee chat / short sync is clearly implied (~30 minutes then use 30 min).

RULES — calendar vs meeting:
- Use "calendar" for personal reminders/blocks WITHOUT inviting specific attendee emails from the note.
- Use "meeting" when scheduling with others AND at least one attendee email appears in the note OR is clearly identifiable. If no email for a human invite, attendeesEmails=[] and confidence must reflect ambiguity.

RULES — dependent timing (prep / haircut before another event, best-effort):
- When the user asks for a personal block BEFORE a meeting WITHOUT a concrete calendar time ("haircut before my coffee chat"), FIRST infer plausible startIso/endIso/tz for the MEETING from the note (email, vague day range).
- THEN set calendar (haircut/errand/travel prep) so that it ENDS when the MEETING BEGINS: calendar.endIso must equal meeting.startIso if both succeed. Default duration ONE HOUR unless the note gives another span — so haircut.startIso = meeting.startIso minus one hour (same timeZone, coherent clock arithmetic). Add modest buffer only if wording explicitly mentions travel (~15–45 min)—then widen the gap BEFORE meeting accordingly.
- If you cannot confidently schedule both relative to each other with ≥0.85 confidence, omit calendar—or lower confidence appropriately (below threshold so the app skips).

RULES — augmented note structure (often present in selection-triggered scans):
- The "Note text" may include "---" sections: Intent lines, Highlight/Before/After passages, Lecture transcript excerpts, or a pseudohighlight — treat these as grounding. Prefer extractions that connect the Highlight and lecture with the student's note above.
- Do NOT invent attendee emails or dates absent from Note text below (including "---" lecture blocks).

RULES — assignments (deliverables):
- Produce MULTIPLE array entries whenever the note DISTINCTLY asks for BOTH e.g. a Google Doc homework write-up AND a separate stock/finance spreadsheet. Each MUST have unique sourceQuote from the phrases that justified it.
  • "sheet" — spreadsheet / ticker / workbook / dashboards / portfolios / stocks (Apple → ticker AAPL in instructionsSummary).
  • "doc" — essays, labs, prose with reasoning.
  • "email_draft" — email drafts only.
When the imperative plus deliverable is unmistakable, confidence ≥ 0.85.

- sourceQuote MUST be copied verbatim FROM THE "Note text" BLOCK BELOW. If nothing qualifies for a branch, omit it (null / empty array entries removed).

RECENT AGENT OUTPUT (may be empty below):
If a ledger appears: (1) assignments — omit an item ONLY when THAT deliverable topic was already drafted AND the note does not imperatively revise or broaden it. Imperatives reopen. (2) calendar/meeting — null if duplicates same timing unless revised.`;

  const ledgerBlock =
    recentLedger && String(recentLedger).trim()
      ? `\n\nRecent Workspace agent activity (avoid duplicating unless the note clearly asks for a new version):\n"""${String(recentLedger).trim().slice(0, 3800)}"""\n`
      : "";

  const nowBlock = formatWorkspaceScanNowAnchor();
  const defaultTz = getDefaultWorkspaceTimeZone();

  const user = `${nowBlock}

Note title: "${noteTitle}"${metaBlock || ""}

Note text:
"""
${slice}
"""${ledgerBlock}`;

  const raw = await aiFn(system, user, 2800);
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return { calendar: null, assignments: [], meeting: null };
  try {
    const parsed = JSON.parse(m[0]);
    const cal = parsed.calendar
      ? normalizeCalendarDates(ensureEventTimeZone(parsed.calendar, defaultTz))
      : null;
    const mtg = parsed.meeting ? normalizeCalendarDates(ensureEventTimeZone(parsed.meeting, defaultTz)) : null;
    const assignments = normalizeAssignmentsList(parsed, MAX_ASSIGNMENTS_PER_SCAN);
    return {
      calendar: cal,
      assignments,
      meeting: mtg,
    };
  } catch {
    return { calendar: null, assignments: [], meeting: null };
  }
}

export function simpleHash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(16);
}

export function idemKey(kind, sourceQuote, iso) {
  return `${kind}:${simpleHash(`${sourceQuote}|${iso || ""}`)}`;
}
