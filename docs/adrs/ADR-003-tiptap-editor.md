# ADR-003: TipTap (ProseMirror) as the rich-text editor

## Status

Accepted on 2025-03-14. Owned by the SunnyD team.

## Context

SunnyD needs a rich-text editing surface that supports inline AI affordances — ghost
completions, selection toolbars, and highlight-anchored suggestions — not just a plain
textarea. The editor must expose document structure and precise selection ranges so the
Selection Agent can ground suggestions in exact source text.

## Decision

Use TipTap 2 (built on ProseMirror) for the editor. It powers bold, italic, headings (H1/H2),
bullet lists, and code blocks, and gives the selection offsets the Selection Agent needs to
build its local-window grounding bundle (`src/selectionAgentContext.js`).

## Consequences

- The **Ghost completion** feature (pause mid-sentence, Tab to accept, Esc to dismiss) and the
  **Selection actions** feature (Summarize / Expand / Explain on highlight) both depend on
  TipTap's selection API.
- Verbatim `sourceQuote` checks are possible because the editor yields exact character ranges,
  which is the primary defense against hallucinated suggestions.
- Requested by users who want a real writing surface, not a chat box.
