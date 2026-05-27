import { gfetch } from "./gapi.js";

function toBase64UrlUtf8(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Escape HTML entities */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert inline markdown: **bold**, *italic*, `code`, [text](url) */
function inlineMd(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g,
      '<code style="font-family:monospace;font-size:.88em;background:#f0ece6;padding:1px 5px;border-radius:3px;">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" style="color:#1a4aaa;text-decoration:underline;">$1</a>');
}

/**
 * Convert Markdown to email-safe HTML with inline styles.
 * Handles: headings, paragraphs, bold/italic/code, bullet + numbered lists, hr.
 * @param {string} markdown
 * @returns {string} HTML fragment
 */
export function markdownToEmailHtml(markdown) {
  const raw = (markdown || "").replace(/\r\n/g, "\n").trimEnd();
  const lines = raw.split("\n");
  let html = "";
  let inUl = false;
  let inOl = false;
  let inPara = false;
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length) {
      html += `<p style="margin:0 0 14px;line-height:1.7;color:#2a1e10;">${paraLines.map(inlineMd).join("<br>")}</p>\n`;
      paraLines = [];
    }
    inPara = false;
  };
  const closeUl = () => { if (inUl) { html += "</ul>\n"; inUl = false; } };
  const closeOl = () => { if (inOl) { html += "</ol>\n"; inOl = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // Blank line → flush paragraph / close lists
    if (!t) {
      flushPara(); closeUl(); closeOl();
      continue;
    }

    // Headings
    const h3 = t.match(/^###\s+(.+)/);
    const h2 = t.match(/^##\s+(.+)/);
    const h1 = t.match(/^#\s+(.+)/);
    if (h1 || h2 || h3) {
      flushPara(); closeUl(); closeOl();
      if (h1) {
        html += `<h1 style="font-size:20px;font-weight:700;margin:22px 0 8px 0;color:#1a1208;letter-spacing:-.3px;">${inlineMd(h1[1])}</h1>\n`;
      } else if (h2) {
        html += `<h2 style="font-size:16px;font-weight:700;margin:18px 0 6px 0;color:#1a1208;">${inlineMd(h2[1])}</h2>\n`;
      } else {
        html += `<h3 style="font-size:14px;font-weight:700;margin:14px 0 4px 0;color:#2a1e10;">${inlineMd(h3[1])}</h3>\n`;
      }
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara(); closeUl(); closeOl();
      html += `<hr style="border:none;border-top:1px solid #e5ddd4;margin:18px 0;">\n`;
      continue;
    }

    // Unordered list
    const ulm = t.match(/^[-*]\s+(.+)/);
    if (ulm) {
      flushPara(); closeOl();
      if (!inUl) {
        html += `<ul style="margin:8px 0 14px;padding-left:22px;">\n`;
        inUl = true;
      }
      html += `  <li style="margin:4px 0;line-height:1.6;color:#2a1e10;">${inlineMd(ulm[1])}</li>\n`;
      continue;
    }

    // Ordered list
    const olm = t.match(/^\d+[.)]\s+(.+)/);
    if (olm) {
      flushPara(); closeUl();
      if (!inOl) {
        html += `<ol style="margin:8px 0 14px;padding-left:22px;">\n`;
        inOl = true;
      }
      html += `  <li style="margin:4px 0;line-height:1.6;color:#2a1e10;">${inlineMd(olm[1])}</li>\n`;
      continue;
    }

    // Regular text — accumulate paragraph lines
    closeUl(); closeOl();
    paraLines.push(line.trimEnd());
    inPara = true;
  }

  flushPara(); closeUl(); closeOl();
  return html;
}

/**
 * Wrap HTML body fragment in a full responsive email template.
 * @param {string} bodyHtml
 * @param {string} subject
 * @returns {string}
 */
function wrapEmailTemplate(bodyHtml, subject) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f1eb;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f1eb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;" cellpadding="0" cellspacing="0" border="0">
          <!-- Body card -->
          <tr>
            <td style="background:#ffffff;border-radius:10px;padding:36px 40px 32px;border:1px solid #e8e0d4;box-shadow:0 2px 8px rgba(0,0,0,.06);">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 8px 0;text-align:center;font-size:11px;color:#b0a090;">
              Drafted by SunnyD Notes — review and edit before sending
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Strip markdown to plain text (for the text/plain fallback part). */
function mdToPlain(markdown) {
  return (markdown || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^\d+[.)]\s+/gm, (m) => m)
    .replace(/^-{3,}$/gm, "---")
    .trim();
}

/**
 * Create a Gmail draft with proper HTML formatting.
 * Sends multipart/alternative with plain-text fallback.
 *
 * @param {string} to   comma-separated recipients
 * @param {string} subject
 * @param {string} bodyMarkdown  markdown-formatted body from LLM
 */
export async function createDraft(to, subject, bodyMarkdown) {
  const htmlBody = wrapEmailTemplate(markdownToEmailHtml(bodyMarkdown), subject);
  const plainBody = mdToPlain(bodyMarkdown);

  const boundary = `sd_mime_${Date.now().toString(36)}`;

  const raw =
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
    `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n` +
    `\r\n` +
    `${plainBody}\r\n` +
    `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n` +
    `\r\n` +
    `${btoa(unescape(encodeURIComponent(htmlBody)))}\r\n` +
    `\r\n` +
    `--${boundary}--`;

  const r = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: toBase64UrlUtf8(raw) } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || d.error || `Gmail ${r.status}`);
  return d;
}
