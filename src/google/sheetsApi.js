import { gfetch } from "./gapi.js";

/** @param {string[][]} rows */
export async function appendSheetValues(spreadsheetId, range, rows) {
  const enc = encodeURIComponent(range);
  const q = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
  const r = await gfetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${enc}:append?${q}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    }
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || d.error || `Sheets ${r.status}`);
  return d;
}
