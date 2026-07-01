const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const SYNC_TOKEN_KEY = "sd_sync_jwt";
const SYNC_USER_KEY = "sd_sync_user";

export function isSyncEnabled() {
  return Boolean(API_BASE);
}

export function getSyncApiBase() {
  return API_BASE;
}

export function getSyncToken() {
  try {
    return sessionStorage.getItem(SYNC_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function getSyncUser() {
  try {
    const raw = sessionStorage.getItem(SYNC_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSyncSession(token, user) {
  sessionStorage.setItem(SYNC_TOKEN_KEY, token);
  sessionStorage.setItem(SYNC_USER_KEY, JSON.stringify(user));
}

export function clearSyncSession() {
  sessionStorage.removeItem(SYNC_TOKEN_KEY);
  sessionStorage.removeItem(SYNC_USER_KEY);
}

async function parseJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

/** @returns {Promise<{ authMode: 'legacy'|'jwt', registerEnabled: boolean }>} */
export async function fetchSyncConfig() {
  const res = await fetch(`${API_BASE}/api/auth/config`, { headers: { Accept: "application/json" } });
  return parseJson(res);
}

export async function registerSyncAccount(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJson(res);
  setSyncSession(body.token, body.user);
  return body;
}

export async function loginSyncAccount(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJson(res);
  setSyncSession(body.token, body.user);
  return body;
}

/** Validates stored JWT; clears session on failure. */
export async function validateSyncSession() {
  const token = getSyncToken();
  if (!token) return false;
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearSyncSession();
    return false;
  }
  const body = await res.json().catch(() => ({}));
  if (body.user) sessionStorage.setItem(SYNC_USER_KEY, JSON.stringify(body.user));
  return true;
}

export function logoutSyncAccount() {
  clearSyncSession();
}
