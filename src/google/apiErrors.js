/**
 * GCP often returns PROJECT_NUMBER in error text. Build a prefilled APIs Library link.
 */
function projectQueryFromMessage(msg) {
  const m = (msg || "").match(/project\s+(\d+)/i);
  return m ? `?project=${encodeURIComponent(m[1])}` : "";
}

/** Library URLs (Google Cloud → APIs & Services → Library → enable). */
const LIBRARY = {
  docs: qs => `https://console.cloud.google.com/apis/library/docs.googleapis.com${qs}`,
  sheets: qs => `https://console.cloud.google.com/apis/library/sheets.googleapis.com${qs}`,
  gmail: qs => `https://console.cloud.google.com/apis/library/gmail.googleapis.com${qs}`,
  drive: qs => `https://console.cloud.google.com/apis/library/drive.googleapis.com${qs}`,
  calendar: qs =>
    `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${qs}`,
};

function disabledBlock(label, libraryUrl, raw) {
  return (
    `${label} Enable it under Google Cloud → APIs & Services → Library → search for that API → Enable.\n` +
    `Open:\n${libraryUrl}\n\n` +
    `(Original)\n${raw}`
  );
}

/** Docs "not been used / disabled" — wrong GCP project vs. OAuth client home project. */
function docsApiNotEnabledExtra(projectNum, libraryUrl) {
  const ref = projectNum || "the project number shown in Google’s message";
  return (
    `\n` +
    `What this means: Your OAuth Client ID (the one in .env as VITE_GOOGLE_CLIENT_ID) belongs to exactly one Google Cloud project. ` +
    `Google bills and gates APIs against that project. The number (${ref}) is the project where Google Docs API must be enabled.\n\n` +
    `Common mistake: a different project was selected in the blue project picker when you clicked Enable — so another project got the API, not this one. ` +
    `Open the Library link below, confirm the picker shows this project’s name/number (IAM & Admin → Settings shows Project number), then ensure Google Docs API shows Manage (enabled), not only the Enable button.\n\n` +
    `Credentials check: APIs & Services → Credentials — your OAuth 2.0 Client ID must be listed under this same project.\n\n` +
    `After enabling correctly: wait 2–5 minutes, reload SunnyD, then G menu → disconnect Google and connect once.\n\n` +
    `${libraryUrl}\n`
  );
}

/**
 * Turns Google Workspace API errors into a short fix paragraph + optional link before the raw message.
 */
export function formatWorkspaceApiError(err) {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw) return "";

  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE|insufficientPermissions|Request is missing required authentication credential/i.test(raw)) {
    return (
      `Google needs a newer permission grant for SunnyD.\n` +
      `Use the G menu: disconnect Google Workspace, then connect again so all scopes (Docs, Drive, Calendar, Sheets, Gmail) apply to your tokens.\n\n` +
      `(Original)\n${raw}`
    );
  }

  if (/insertion index must be inside the bounds of an existing paragraph|The insertion index/i.test(raw)) {
    return (
      `Could not insert text into the new Doc (structure/index issue). SunnyD retries use the latest Docs APIs; refresh the page and retry. If this persists, report the error.\n\n` +
      `(Original)\n${raw}`
    );
  }

  const qs = projectQueryFromMessage(raw);
  const notUsed =
    /has\s+not\s+been\s+used\s+in\s+project|is\s+disabled\b|SERVICE_DISABLED|ACCESS[_ ]NOT[_ ]CONFIGURED/i.test(
      raw
    );

  if (/Google Docs API|docs\.googleapis\.com/i.test(raw) && notUsed) {
    const pn = raw.match(/project\s+(\d+)/i)?.[1] ?? "";
    const libUrl = LIBRARY.docs(qs);
    return (
      `Google Docs API is not enabled on the Cloud project Google uses for your sign-in (see project number in the message below).\n` +
      docsApiNotEnabledExtra(pn, libUrl) +
      `\n` +
      `(Original)\n${raw}`
    );
  }
  if (/Google Sheets API|sheets\.googleapis\.com|spreadsheets\.googleapis\.com/i.test(raw) && notUsed) {
    return disabledBlock(
      "Google Sheets API is not enabled for your OAuth project.",
      LIBRARY.sheets(qs),
      raw
    );
  }
  if (/Gmail API|gmail\.googleapis\.com/i.test(raw) && notUsed) {
    return disabledBlock("Gmail API is not enabled for your OAuth project.", LIBRARY.gmail(qs), raw);
  }
  if (/Google Drive API|drive\.googleapis\.com/i.test(raw) && notUsed && !/documents\.spreadsheet/i.test(raw)) {
    return disabledBlock(
      "Google Drive API is not enabled for your OAuth project.",
      LIBRARY.drive(qs),
      raw
    );
  }
  if (/Calendar API|calendar\.googleapis\.com/i.test(raw) && notUsed) {
    return disabledBlock(
      "Google Calendar API is not enabled for your OAuth project.",
      LIBRARY.calendar(qs),
      raw
    );
  }

  return raw;
}
