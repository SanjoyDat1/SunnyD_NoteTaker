/**
 * Authoritative "now" for Workspace extraction — so the model resolves
 * "today", "tomorrow", weekday names, and bare times against the user's calendar.
 */

/** @returns {string} */
export function getDefaultWorkspaceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Human-readable anchor block for the Workspace scan LLM.
 * @param {string} [timeZone] IANA zone (defaults to browser)
 * @param {Date} [at] reference instant (defaults to now)
 */
export function formatWorkspaceScanNowAnchor(timeZone, at = new Date()) {
  const tz = timeZone || getDefaultWorkspaceTimeZone();
  const d = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();

  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
  const monthLong = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long" }).format(d);
  const dayNum = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(d);
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(d);

  const localClock = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);

  return (
    `REFERENCE TIME (resolve ALL relative dates/times using this — not UTC alone):\n` +
    `- IANA time zone: ${tz}\n` +
    `- Today's calendar date in that zone: ${ymd} (${weekday}, ${monthLong} ${dayNum}, ${year})\n` +
    `- Current local time in that zone: ${localClock}\n` +
    `- "Today" means ${ymd}. "Tomorrow" is the next calendar day after ${ymd} in ${tz}.\n` +
    `- For startIso/endIso use wall-clock datetimes like ${ymd}T15:00:00 (NO trailing Z) and set timeZone to "${tz}" unless the note states another zone or city.`
  );
}

/**
 * @param {object | null} ev
 * @param {string} defaultTz
 */
export function ensureEventTimeZone(ev, defaultTz) {
  if (!ev || typeof ev !== "object") return ev;
  const tz = String(ev.timeZone || "").trim() || defaultTz;
  return { ...ev, timeZone: tz };
}
