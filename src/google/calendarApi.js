import { SUNNYD_CALENDAR_EVENT_COLOR_ID } from "./constants.js";
import { gfetch } from "./gapi.js";

/**
 * @param {object} event Google Calendar event resource
 * @param {"all" | "externalOnly" | "none"} sendUpdates
 */
export async function insertCalendarEvent(event, sendUpdates = "none") {
  const payload = { ...event, colorId: SUNNYD_CALENDAR_EVENT_COLOR_ID };
  const q = new URLSearchParams({ sendUpdates });
  const r = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || d.error || `Calendar ${r.status}`);
  return d;
}
