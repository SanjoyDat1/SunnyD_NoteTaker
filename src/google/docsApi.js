import { buildMarkdownDocModel } from "./docsMarkdown.js";
import { findInsertedPlainRangeIndexes } from "./docsFormatting.js";
import { sanitizeForDocsInsert } from "./docsSanitize.js";
import { gfetch } from "./gapi.js";

const CHUNK = 4500;

/**
 * Resolve end-of-body insert target (first tab when the document uses tabs).
 */
async function resolveEndOfSegmentLocation(documentId) {
  const base = { segmentId: "" };
  try {
    const q = new URLSearchParams({ includeTabsContent: "true" });
    const r = await gfetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?${q}`
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return base;
    const tabs = d.tabs;
    if (Array.isArray(tabs) && tabs.length > 0) {
      const tabId = tabs[0]?.tabProperties?.tabId;
      if (tabId) return { segmentId: "", tabId };
    }
  } catch {
    /* fall through */
  }
  return base;
}

/** Append plain text in chunks — uses endOfSegmentLocation so tabs-based docs work. */
export async function insertTextIntoDocument(documentId, fullText) {
  const text = sanitizeForDocsInsert(fullText || "");
  const loc = await resolveEndOfSegmentLocation(documentId);

  for (let i = 0; i < text.length; i += CHUNK) {
    const slice = text.slice(i, i + CHUNK);
    const r = await gfetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                text: slice,
                endOfSegmentLocation: loc,
              },
            },
          ],
        }),
      }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error?.message || d.error || `Docs ${r.status}`);
  }
}

function rangeWithTab(startIndex, endIndex, tabId) {
  const r = { startIndex, endIndex };
  if (tabId) r.tabId = tabId;
  return r;
}

/** Apply bold/italic/headings/bullets from GitHub-flavored Markdown after inserting body text. */
export async function insertFormattedMarkdownIntoDocument(documentId, markdown) {
  const model = buildMarkdownDocModel(markdown || "");
  const rawPlain = model.plain;
  const toInsert = sanitizeForDocsInsert(rawPlain);
  if (!toInsert.trim()) {
    await insertTextIntoDocument(documentId, "");
    return;
  }

  if (toInsert.length !== rawPlain.length) {
    await insertTextIntoDocument(documentId, rawPlain);
    return;
  }

  await insertTextIntoDocument(documentId, rawPlain);

  const q = new URLSearchParams({ includeTabsContent: "true" });
  const gr = await gfetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?${q}`);
  const doc = await gr.json().catch(() => ({}));
  if (!gr.ok) throw new Error(doc.error?.message || "Docs get failed after insert");

  const tabId = doc.tabs?.[0]?.tabProperties?.tabId;
  const body = doc.tabs?.[0]?.documentTab?.body || doc.body;
  const rg = findInsertedPlainRangeIndexes(body, toInsert);
  if (!rg || rg.endIndex <= rg.startIndex) {
    throw new Error("Could not map inserted Markdown text into the document for styling.");
  }

  const origin = rg.startIndex;
  const requests = [];

  const namedLevel = {
    1: "HEADING_1",
    2: "HEADING_2",
    3: "HEADING_3",
  };
  for (const ps of model.paragraphStyles) {
    requests.push({
      updateParagraphStyle: {
        range: rangeWithTab(origin + ps.absStart, origin + ps.absEnd, tabId),
        paragraphStyle: { namedStyleType: namedLevel[ps.level] },
        fields: "namedStyleType",
      },
    });
  }

  for (const br of model.bulletRanges) {
    requests.push({
      createParagraphBullets: {
        range: rangeWithTab(origin + br.absStart, origin + br.absEnd, tabId),
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }

  for (const ts of model.textStyles) {
    requests.push({
      updateTextStyle: {
        range: rangeWithTab(origin + ts.absStart, origin + ts.absEnd, tabId),
        textStyle:
          ts.type === "bold" ? { bold: true } : { italic: true },
        fields: ts.type === "bold" ? "bold" : "italic",
      },
    });
  }

  if (requests.length === 0) return;

  const BATCH = 45;
  for (let i = 0; i < requests.length; i += BATCH) {
    const chunk = requests.slice(i, i + BATCH);
    const r = await gfetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: chunk }),
      }
    );
    const bd = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(bd.error?.message || bd.error || `Docs style ${r.status}`);
  }
}
