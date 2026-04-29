import { normalizeCalendarDates } from "./calendarDefaults.js";

/**
 * One LLM call returning calendar / assignment / meeting candidates (max one each).
 * @param {function} aiFn async (system, user, max) => string
 * @param {string} [recentLedger] recent Workspace assignment job lines — avoid duplicate proposals
 */
export async function analyzeWorkspaceContent(aiFn, noteTitle, plainText, metaBlock, recentLedger = "") {
  const slice = plainText.length > 12000 ? plainText.slice(-12000) : plainText;
  const system = `You are SunnyD's Google Workspace extraction assistant. Read the note and extract AT MOST one item per category if clearly present.

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
  "assignment": null | {
    "title": "deliverable title",
    "deliverableType": "doc" | "sheet" | "email_draft",
    "instructionsSummary": "what to produce",
    "dueIso": "optional ISO or null",
    "sourceQuote": "EXACT substring from note",
    "confidence": 0-1,
    "emailTo": "optional if email_draft and addresses appear in note; else null"
  },
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

RULES — event duration (calendar + meeting):
- If the note states an explicit end time, a time range (“2–3 pm”, “10:00–11:30”), or an explicit duration (“30 minutes”, “90 min”, “2 hours”, “half hour”), set endIso to match that intent in the SAME timeZone as startIso (coherent clock math).
- If the note mentions only WHEN it begins (single time/date: “Tuesday at 4pm”, “March 15 9am”, “coffee at noon”) with no duration, no stretch to an end time, and no conversational length cue, then endIso MUST be exactly ONE HOUR after startIso — not shorter unless explicitly stated otherwise.
- Use \"calendar\" for dated personal reminders / blocks WITHOUT inviting specific people (no attendee emails).
- Use "meeting" when the user schedules with others AND at least one email appears in the note OR they clearly name email addresses. If no email in text, set attendeesEmails to [] and low confidence.
- Use "assignment" only when there is a clear deliverable (homework, report, lab, slide deck, email to prof) with enough context. deliverableType: doc for essays/reports, sheet for tables/data, email_draft for emails.
- sourceQuote MUST be copied verbatim FROM THE "Note text" BLOCK BELOW (same words, punctuation, and spaces). If you paraphrase or use typographic substitutions the app will discard the extraction. Prefer a single contiguous LINE from the slice. If nothing qualifies, return null for that key.
- confidence must be honest; below 0.85 should be treated as failed by the app.

RECENT AGENT OUTPUT (may be empty below):
If a ledger appears: (1) For assignments — set "assignment" to null if the same deliverable is already completed, queued, failed, or running unless the note clearly asks for a new draft or revision. (2) For calendar/meeting — set "calendar" or "meeting" to null if the ledger already shows the same event time and title as done unless the user clearly adds a new or revised time.`;

  const ledgerBlock =
    recentLedger && String(recentLedger).trim()
      ? `\n\nRecent Workspace agent activity (avoid duplicating unless the note clearly asks for a new version):\n"""${String(recentLedger).trim().slice(0, 3800)}"""\n`
      : "";

  const user = `Note title: "${noteTitle}"${metaBlock || ""}

Note text:
"""
${slice}
"""${ledgerBlock}`;

  const raw = await aiFn(system, user, 2000);
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return { calendar: null, assignment: null, meeting: null };
  try {
    const parsed = JSON.parse(m[0]);
    return {
      calendar: parsed.calendar ? normalizeCalendarDates(parsed.calendar) : null,
      assignment: parsed.assignment || null,
      meeting: parsed.meeting ? normalizeCalendarDates(parsed.meeting) : null,
    };
  } catch {
    return { calendar: null, assignment: null, meeting: null };
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
