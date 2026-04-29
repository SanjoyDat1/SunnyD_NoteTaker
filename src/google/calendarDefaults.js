/** Shared defaults for Workspace calendar/meeting previews and Google Calendar create. */

/**
 * Match end formatting to typical start ISO strings (Calendar API carries timeZone separately).
 * @param {string} startSample original startIso substring style
 */
export function formatCalendarDatetimeLikeStartSample(startSample, d) {
  const pad = n => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const triple = /T\d{2}:\d{2}:\d{2}/.test(startSample || "");
  return triple ? `${y}-${mo}-${dd}T${hh}:${mi}:${ss}` : `${y}-${mo}-${dd}T${hh}:${mi}:00`;
}

/**
 * If end is absent, unparseable, or not strictly after start, use a **60-minute** block from start.
 * When the LLM inferred a genuine longer/shorter duration from note context, that end survives.
 */
export function normalizeCalendarDates(ev) {
  if (!ev || typeof ev !== "object") return ev;
  const start = String(ev.startIso ?? "").trim();
  let end = String(ev.endIso ?? "").trim();
  const t0 = Date.parse(start);
  if (!start || !Number.isFinite(t0)) return ev;
  let t1 = end ? Date.parse(end) : NaN;
  if (!end || !Number.isFinite(t1) || t1 <= t0) {
    const endD = new Date(t0 + 60 * 60 * 1000);
    return { ...ev, endIso: formatCalendarDatetimeLikeStartSample(start, endD) };
  }
  return { ...ev, endIso: end };
}
