import { getGoogleClientId, getGoogleClientSecret } from "./constants.js";
import { loadGoogleTokens, saveGoogleTokens } from "./db.js";

function tokenBundleFromOAuthResponse(resp) {
  const expires_at = Date.now() + (resp.expires_in || 3600) * 1000 - 60_000;
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token || undefined,
    expires_at,
  };
}

async function refreshAccessToken(rt) {
  const clientId = getGoogleClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: rt,
    grant_type: "refresh_token",
  });
  const secret = getGoogleClientSecret();
  if (secret) body.append("client_secret", secret);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.error || "Refresh failed");
  return tokenBundleFromOAuthResponse(d);
}

/** Merge initial OAuth tokens; keep refresh_token if omitted on refresh responses */
export async function persistNewTokens(oauthResp) {
  const existing = await loadGoogleTokens();
  const bundle = tokenBundleFromOAuthResponse(oauthResp);
  const merged = {
    ...bundle,
    refresh_token: bundle.refresh_token || existing?.refresh_token,
    expires_at: bundle.expires_at,
    access_token: bundle.access_token,
  };
  await saveGoogleTokens(merged);
  return merged;
}

/** @returns {Promise<string>} */
export async function getValidAccessToken() {
  const t = await loadGoogleTokens();
  if (!t?.refresh_token && !t?.access_token) throw new Error("Not connected to Google");
  const now = Date.now();
  if (t.access_token && t.expires_at && now < t.expires_at) return t.access_token;

  if (!t.refresh_token) throw new Error("Session expired — reconnect Google Workspace.");
  const next = await refreshAccessToken(t.refresh_token);
  const merged = { ...t, ...next, refresh_token: next.refresh_token || t.refresh_token };
  await saveGoogleTokens(merged);
  return merged.access_token;
}

export async function disconnectGoogle() {
  const t = await loadGoogleTokens();
  const tok = t?.access_token || t?.refresh_token;
  if (tok) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST" });
    } catch {}
  }
  await saveGoogleTokens(null);
}

export async function isGoogleConnected() {
  const t = await loadGoogleTokens();
  return !!(t?.refresh_token || t?.access_token);
}
