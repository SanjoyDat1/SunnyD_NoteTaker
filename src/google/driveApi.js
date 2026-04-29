import { gfetch } from "./gapi.js";

/** @returns {Promise<{ id: string, name: string, webViewLink?: string }>} */
export async function createDriveFile(body) {
  const q = new URLSearchParams({ fields: "id,name,webViewLink,mimeType" });
  const r = await gfetch(`https://www.googleapis.com/drive/v3/files?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || d.error || `Drive ${r.status}`);
  return d;
}

/** @returns {Promise<{ id: string, name: string, webViewLink?: string }>} */
export async function createSunnyDFolder() {
  return createDriveFile({
    name: "SunnyD Notes",
    mimeType: "application/vnd.google-apps.folder",
  });
}
