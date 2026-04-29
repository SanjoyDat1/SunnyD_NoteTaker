import { gfetch } from "./gapi.js";

function toBase64UrlUtf8(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} to comma-separated
 * @param {string} subject
 * @param {string} body plain text
 */
export async function createDraft(to, subject, body) {
  const raw =
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    (body || "");
  const r = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: toBase64UrlUtf8(raw) } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || d.error || `Gmail ${r.status}`);
  return d;
}
