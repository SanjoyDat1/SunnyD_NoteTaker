import { getGoogleClientId, getGoogleClientSecret, getRedirectUri, GOOGLE_SCOPES } from "./constants.js";

const SS_VERIFIER = "sd_g_oauth_verifier";
const SS_STATE = "sd_g_oauth_state";

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe random string for PKCE verifier */
function randomVerifier() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function generatePkcePair() {
  const code_verifier = randomVerifier();
  const enc = new TextEncoder().encode(code_verifier);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const code_challenge = b64url(digest);
  return { code_verifier, code_challenge };
}

export function buildAuthorizationUrl(code_challenge, state) {
  const clientId = getGoogleClientId();
  const redirect_uri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state,
    code_challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Start redirect-based OAuth — call from user gesture */
export async function beginGoogleAuthorization() {
  const { code_verifier, code_challenge } = await generatePkcePair();
  const state = randomVerifier().slice(0, 43);
  try {
    sessionStorage.setItem(SS_VERIFIER, code_verifier);
    sessionStorage.setItem(SS_STATE, state);
  } catch {}
  window.location.href = buildAuthorizationUrl(code_challenge, state);
}

/**
 * If URL contains oauth params, exchange code for tokens.
 * @returns {Promise<object | null>}
 */
export async function completeAuthorizationFromUrlIfPresent() {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const err = u.searchParams.get("error");
  if (err) {
    cleanupUrl();
    throw new Error(u.searchParams.get("error_description") || err);
  }
  if (!code || !state) return null;

  let expectedState = "";
  let verifier = "";
  try {
    expectedState = sessionStorage.getItem(SS_STATE) || "";
    verifier = sessionStorage.getItem(SS_VERIFIER) || "";
  } catch {}
  if (!verifier || state !== expectedState) {
    cleanupUrl();
    throw new Error("OAuth state mismatch — try connecting again.");
  }

  const clientId = getGoogleClientId();
  const redirect_uri = getRedirectUri();
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri,
  });
  const secret = getGoogleClientSecret();
  if (secret) body.append("client_secret", secret);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const d = await r.json().catch(() => ({}));
  cleanupUrl();
  try {
    sessionStorage.removeItem(SS_VERIFIER);
    sessionStorage.removeItem(SS_STATE);
  } catch {}

  if (!r.ok) {
    throw new Error(d.error_description || d.error || `Token exchange failed (${r.status})`);
  }
  return d;
}

function cleanupUrl() {
  try {
    const u = new URL(window.location.href);
    u.search = "";
    window.history.replaceState({}, document.title, u.pathname + u.hash);
  } catch {}
}
