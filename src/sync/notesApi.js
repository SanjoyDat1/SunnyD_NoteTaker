import { getSyncApiBase, getSyncToken, isSyncEnabled } from "./syncAuth.js";

const API_BASE = getSyncApiBase();
const API_SECRET = import.meta.env.VITE_SUNNYD_API_SECRET || "";

export { isSyncEnabled };

function authHeaders() {
  const headers = { Accept: "application/json" };
  const jwt = getSyncToken();
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  else if (API_SECRET) headers.Authorization = `Bearer ${API_SECRET}`;
  return headers;
}

function jsonHeaders() {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

/** @returns {Promise<{ notes: unknown[], activeId: string|number, updatedAt: number } | null>} */
export async function fetchNotesFromServer() {
  const res = await fetch(`${API_BASE}/api/notes`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "Sync unauthorized");
    err.code = "SYNC_AUTH";
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Sync fetch failed (${res.status})`);
  }
  return res.json();
}

/** @returns {Promise<{ ok: true, updatedAt: number }>} */
export async function pushNotesToServer(notes, activeId) {
  const res = await fetch(`${API_BASE}/api/notes`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ notes, activeId }),
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "Sync unauthorized");
    err.code = "SYNC_AUTH";
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Sync push failed (${res.status})`);
  }
  return res.json();
}
