/**
 * Compact plaintext for Workspace scan LLM — completed / failed drafts so it avoids duplicate proposals.
 * @param {Array<{ status?: string, type?: string, title?: string, webViewLink?: string, error?: string }>} jobs
 */
export function buildWorkspaceLedgerSnippet(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return "";
  const lines = [];
  for (const j of jobs.slice(0, 30)) {
    const kt = String(j.type || "").toLowerCase() || "assignment";
    if (!["assignment", "calendar", "meeting"].includes(kt)) continue;
    const st = String(j.status || "").toLowerCase();
    if (!["done", "failed", "queued", "running"].includes(st)) continue;
    const t = String(j.title || (kt === "assignment" ? "Draft" : "Event")).slice(0, 120);
    const label = kt === "assignment" ? "assignment" : kt === "meeting" ? "meeting invite" : "calendar";
    let line = `- [${st}] ${label} "${t}"`;
    if (j.webViewLink) line += `\n  link: ${j.webViewLink}`;
    if (st === "failed" && j.error) line += `\n  last error (summary): ${String(j.error).slice(0, 200)}`;
    lines.push(line);
  }
  return lines.join("\n").slice(0, 3800);
}
