/**
 * Simple markdown-to-HTML converter for AI responses.
 * Handles basic patterns: **bold**, *italic*, - bullets, - [ ] checklist, > blockquote.
 * Used when inserting AI output into Tiptap (which accepts HTML).
 */

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Escape for HTML attribute values */
export function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert markdown-ish text to safe HTML for Tiptap insertContent.
 */
export function markdownToHtml(text: string): string {
  if (!text.trim()) return "";

  const lines = text.split("\n");
  const result: string[] = [];
  let inList = false;
  let inChecklist = false;
  let listItems: string[] = [];
  let checklistItems: string[] = [];

  function flushList() {
    if (listItems.length > 0) {
      result.push(
        "<ul>",
        ...listItems.map((item) => `<li><p>${item}</p></li>`),
        "</ul>"
      );
      listItems = [];
    }
    inList = false;
  }

  function flushChecklist() {
    if (checklistItems.length > 0) {
      result.push(
        '<ul data-type="taskList">',
        ...checklistItems.map(
          (item) =>
            `<li data-type="taskItem" data-checked="false"><p>${item}</p></li>`
        ),
        "</ul>"
      );
      checklistItems = [];
    }
    inChecklist = false;
  }

  function processInline(content: string): string {
    return escapeHtml(content)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
      flushList();
      const content = trimmed.replace(/^-\s*\[[ x]\]\s*/i, "");
      checklistItems.push(processInline(content));
      inChecklist = true;
      continue;
    }

    if (/^-\s+/.test(trimmed) || /^•\s+/.test(trimmed)) {
      flushChecklist();
      const content = trimmed.replace(/^[-•]\s+/, "");
      listItems.push(processInline(content));
      inList = true;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushList();
      flushChecklist();
      const content = trimmed.replace(/^\d+\.\s+/, "");
      result.push(`<ol><li><p>${processInline(content)}</p></li></ol>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushList();
      flushChecklist();
      const content = trimmed.slice(2);
      result.push(`<blockquote>${processInline(content)}</blockquote>`);
      continue;
    }

    flushList();
    flushChecklist();

    if (trimmed === "") {
      result.push("<p></p>");
    } else {
      result.push(`<p>${processInline(trimmed)}</p>`);
    }
  }

  flushList();
  flushChecklist();

  return result.join("");
}
