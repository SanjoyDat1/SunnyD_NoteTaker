# SunnyD Notes — roadmap & ownership

All features are currently owned by the SunnyD team (Sanjoy Datta).

## Shipped (in production)

- **AI suggestions** — Fact Check, Expand, Clarity, Explain, Research citations, Lecture
  (see ADR-004). Motivated by the goal of grounded, verifiable help.
- **Ghost completion** — inline continuation, Tab to accept.
- **Selection actions** — Summarize / Expand / Explain on a highlight.
- **Lecture mode** — live on-device transcription and lecture-aware suggestions (ADR-005).
- **SunnyD Cast** — notes → two-host podcast with Dee and Ray (ADR-006).
- **Multi-note** — sidebar with multiple notes, keyboard navigation.
- **Search** — semantic vector search (OpenAI/Gemini) or keyword scoring (Claude).
- **Export** — current note or all notes to `.docx`.
- **Persistence** — auto-save to `localStorage`; optional Save to disk (File System Access API).
- **Google Workspace** — Calendar, meetings, Docs, Sheets, Gmail drafts via browser OAuth
  (ADR-007). Requested by meeting-heavy professionals.

## Planned / under consideration

- **Cross-device sync** — currently per-device only. [FILL IN: priority and whether paid.]
- **Mobile / Safari support** — Lecture mode is Chrome/Edge-only today.
- **Collaboration** — shared notes. [FILL IN: is multiplayer on the roadmap?]
- [FILL IN: the next big bet for the next quarter, and the customer pain it addresses.]

## Metrics we care about

- Suggestion acceptance rate (by category).
- Notes that reach export or Cast (a proxy for "this note mattered").
- Lectures transcribed per week (student engagement).
- [FILL IN: the north-star metric from the product overview, with a current value and target.]
