/**
 * Sanitize note HTML that crossed the sync boundary before it can reach
 * dangerouslySetInnerHTML. Local note content is browser-only and trusted
 * (ADR-001), but synced snapshots can be written by any device holding the
 * account token — including a plain `curl PUT /api/notes` that bypasses the
 * editor entirely — so script vectors must be stripped on the way in.
 *
 * Deliberately dependency-free (DOMParser-based). Strips:
 *  - script/style/iframe/object/embed/link/meta/base/form/svg/math elements
 *  - every `on*` event-handler attribute
 *  - href/src/srcset/action/formaction values with javascript: or non-image data: schemes
 */

const BANNED_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE",
  "FORM", "SVG", "MATH", "TEMPLATE", "FRAME", "FRAMESET", "NOSCRIPT",
]);

const URL_ATTRS = ["href", "src", "srcset", "action", "formaction", "xlink:href"];

function isUnsafeUrl(value) {
  // Browsers ignore control chars and whitespace inside URL schemes ("java\tscript:")
  const v = String(value).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (v.startsWith("data:") && !v.startsWith("data:image/")) return true;
  return false;
}

function scrub(el) {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.includes(name) && isUnsafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

export function sanitizeHtml(html) {
  if (typeof html !== "string" || !html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const doomed = [];
  let node = walker.nextNode();
  while (node) {
    if (BANNED_TAGS.has(node.tagName)) doomed.push(node);
    else scrub(node);
    node = walker.nextNode();
  }
  for (const el of doomed) el.remove();
  return doc.body.innerHTML;
}

/** Sanitize a synced workspace snapshot before it enters app state. */
export function sanitizeRemoteNotes(notes) {
  return notes.map(n => ({
    ...n,
    title: typeof n.title === "string" ? n.title : "",
    content: sanitizeHtml(n.content),
  }));
}
