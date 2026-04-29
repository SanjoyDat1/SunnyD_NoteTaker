/** Google OAuth scopes — tight access per plan */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export const GOOGLE_DB = "sunnyd_google_db";
export const GOOGLE_DB_VERSION = 1;

/** Google Calendar event palette `colorId` — "Tangerine" (warm orange ~#ffb878 / modern ~#f4511e); closest preset to SunnyD accents (#ed7f21, #E8761A). */
export const SUNNYD_CALENDAR_EVENT_COLOR_ID = "6";

export function getGoogleClientId() {
  try {
    return (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
  } catch {
    return "";
  }
}

/**
 * Only for OAuth clients of type **Web application** (confidential): Google expects
 * client_secret when exchanging/refres tokens. Omit for **Single Page Application** clients (PKCE only).
 */
export function getGoogleClientSecret() {
  try {
    return (import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "").trim();
  } catch {
    return "";
  }
}

export function getRedirectUri() {
  if (typeof window === "undefined") return "";
  /** Must match Authorized redirect URIs exactly in Google Cloud Console (usually `https://yourhost/` or `http://localhost:5173/`) */
  return `${window.location.origin}/`;
}
