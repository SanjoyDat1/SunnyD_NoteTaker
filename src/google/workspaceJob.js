import { formatWorkspaceApiError } from "./apiErrors.js";
import { saveJob, getJob, getMeta, setMeta, listJobs } from "./db.js";
import { createDriveFile, createSunnyDFolder } from "./driveApi.js";
import { gfetch } from "./gapi.js";
import { insertFormattedMarkdownIntoDocument } from "./docsApi.js";
import { appendSheetValues } from "./sheetsApi.js";
import { createDraft } from "./gmailApi.js";

async function ensureFolderId() {
  let id = await getMeta("folder_id");
  if (id) return id;
  const f = await createSunnyDFolder();
  id = f.id;
  await setMeta("folder_id", id);
  return id;
}

async function patchJob(jobId, partial) {
  const prev = await getJob(jobId);
  if (!prev) return;
  await saveJob({ ...prev, ...partial });
}

async function fetchDriveLink(fileId) {
  const q = new URLSearchParams({ fields: "webViewLink,name,id" });
  const r = await gfetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${q}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || "Drive fetch link failed");
  return d.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

async function composeDraft(aiFn, title, instructions, noteContext) {
  const system =
    `You are helping the user draft a deliverable FOR THEIR REVIEW. Output plain text only — no preamble. ` +
    `Produce structured, substantive content aligned with the instructions. The user must edit and ensure academic honesty.`;
  const user =
    `Title: ${title}\n\nInstructions:\n${instructions}\n\nContext from notes:\n${noteContext.slice(0, 8000)}\n\nWrite the full draft.`;
  const t = await aiFn(system, user, 4000);
  return (t || "").trim();
}

/**
 * Tab-separated rows for Sheets API (USER_ENTERED — leading = formulas work).
 */
async function composeSpreadsheetDraft(aiFn, title, instructions, noteContext) {
  const system = `You are filling a Google Sheets workbook via the API.

Output TAB-SEPARATED text only — one ROW per LINE. Columns separated by SINGLE tab characters (\t conceptually as literal tab delimiter in your answer).
Rules:
• Row 1 = column headers.
• Prefer live stock prices via Google Sheets formulas exactly like =GOOGLEFINANCE("AAPL","price") in the cell column for CURRENT price (omit $ in formula).
• Use VALID US ticker symbols (Apple=AAPL). If instructions say APPL, use AAPL in formulas/instructions rows.
• Add a subtitle row describing the sheet if helpful (still tab-separated columns or single cell row).
• No Markdown, no preamble, no code fences — ONLY data rows starting at line 1.
• At least 6 rows whenever tickers/quotes/stocks are requested: headers + companies/tickers/formulas/metadata as needed.

The user edits and verifies data; cite no investment advice beyond listing prices.`;

  const user = `Spreadsheet title: ${title}\n\nBuild-instructions:\n${instructions}\n\nNote context:\n${noteContext.slice(0, 8000)}\n\nWrite all rows now.`;

  const t = await aiFn(system, user, 5000);
  return (t || "").trim();
}

async function composeDeliverableMarkdown(aiFn, title, instructions, noteContext) {
  const system =
    `You are helping the user draft a deliverable FOR THEIR REVIEW.

Output **GitHub-flavored Markdown only** — no HTML, no preamble, no code fences unless the assignment asks for code.

Use liberally for a polished look:
- Hierarchy: # Title, ## Section, ### Subsection
- **bold** for key terms, *italic* for emphasis
- Bullets (- ) and short numbered lists (1. ) where they help
- Blank lines between sections

The user must edit and ensure academic honesty.`;
  const user =
    `Title: ${title}\n\nInstructions:\n${instructions}\n\nContext from notes:\n${noteContext.slice(0, 8000)}\n\nWrite the full Markdown draft.`;
  const t = await aiFn(system, user, 8000);
  return (t || "").trim();
}

/**
 * @param {{ jobId: string, aiFn: function, payload: object, noteContext: string }} p
 */
export async function runAssignmentJob(p) {
  const { jobId, aiFn, payload, noteContext } = p;
  await patchJob(jobId, { status: "running", step: "Preparing…" });
  const folderId = await ensureFolderId();
  const title = (payload.title || "SunnyD draft").slice(0, 200);
  const type = payload.deliverableType || "doc";

  try {
    if (type === "email_draft") {
      await patchJob(jobId, { step: "Drafting email…" });
      const to = (payload.emailTo || "").trim() || "recipient@example.com";
      const subj = title;
      const body = await composeDraft(
        aiFn,
        title,
        (payload.instructionsSummary || "") + "\nFormat as email body (greeting + paragraphs).",
        noteContext
      );
      await patchJob(jobId, { step: "Saving Gmail draft…" });
      await createDraft(to, subj, body);
      const prev = await getJob(jobId);
      await saveJob({
        ...prev,
        status: "done",
        step: "",
        webViewLink: "https://mail.google.com/mail/u/0/#drafts",
      });
      return;
    }

    const mime =
      type === "sheet"
        ? "application/vnd.google-apps.spreadsheet"
        : "application/vnd.google-apps.document";

    await patchJob(jobId, { step: "Creating Google file…" });
    const created = await createDriveFile({
      name: title,
      mimeType: mime,
      parents: [folderId],
    });
    const fileId = created.id;

    if (type === "sheet") {
      await patchJob(jobId, { step: "Building sheet…", driveFileId: fileId });
      const draftMd = await composeSpreadsheetDraft(
        aiFn,
        title,
        payload.instructionsSummary || "",
        noteContext
      );
      const lines = draftMd.split("\n").filter(Boolean).slice(0, 200);
      const rows = lines.map(line => (line.includes("\t") ? line.split("\t") : [line]));
      await appendSheetValues(fileId, "Sheet1!A1", rows);
      const url = await fetchDriveLink(fileId);
      const prev = await getJob(jobId);
      await saveJob({ ...prev, status: "done", step: "", webViewLink: url, driveFileId: fileId });
      return;
    }

    await patchJob(jobId, { step: "Writing document…", driveFileId: fileId });
    const body = await composeDeliverableMarkdown(aiFn, title, payload.instructionsSummary || "", noteContext);
    const trimmed = (body || "").trim();
    if (!trimmed) {
      throw new Error(
        "The AI returned an empty draft. Check your model API key / quota / provider messages, then try again."
      );
    }
    await insertFormattedMarkdownIntoDocument(fileId, body);
    const url = await fetchDriveLink(fileId);
    const prev = await getJob(jobId);
    await saveJob({ ...prev, status: "done", step: "", webViewLink: url, driveFileId: fileId });
  } catch (e) {
    const msg = formatWorkspaceApiError(e);
    const prev = await getJob(jobId);
    await saveJob({
      ...prev,
      status: "failed",
      step: "",
      error: msg,
    });
    throw e;
  }
}

let resumeDrainChain = Promise.resolve();

/**
 * Jobs left running are reset to queued (reload / tab close mid-flight).
 */
export async function reconcileStaleAssignmentJobs() {
  const jobs = await listJobs(400);
  for (const j of jobs) {
    if ((j.type || "") !== "assignment" || String(j.status) !== "running") continue;
    const prev = await getJob(j.jobId);
    if (!prev) continue;
    await saveJob({
      ...prev,
      status: "queued",
      step: "Resuming…",
      error: undefined,
    });
  }
}

/**
 * Process queued assignment jobs sequentially. Safe to call from submit or after reconnect.
 */
export function resumePendingAssignmentJobs(aiFn, hooks = {}) {
  resumeDrainChain = resumeDrainChain
    .then(async () => {
      await reconcileStaleAssignmentJobs();
      const queued = (await listJobs(500))
        .filter(j => (j.type || "") === "assignment" && String(j.status) === "queued")
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const job of queued) {
        try {
          await runAssignmentJob({
            jobId: job.jobId,
            aiFn,
            payload: job.payload || {},
            noteContext: typeof job.noteContext === "string" ? job.noteContext : "",
          });
          const done = await getJob(job.jobId);
          hooks?.onJobDone?.({ job: done, jobMeta: job });
        } catch {
          hooks?.onJobFailed?.({ jobId: job.jobId });
        }
      }
    })
    .catch(() => {});
  return resumeDrainChain;
}
