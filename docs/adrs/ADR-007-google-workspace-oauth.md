# ADR-007: Google Workspace via in-browser OAuth (PKCE)

## Status

Accepted on 2025-04-28. Owned by the SunnyD team.

## Context

Notes often contain commitments — dates, meetings, assignments. Turning those into real Calendar
events, meeting invites, and Docs/Sheets/Gmail drafts is high-value, but it must not require a
SunnyD backend to hold Google tokens (ADR-001).

## Decision

The optional Google Workspace integration completes OAuth 2.0 in the browser with PKCE (no
SunnyD server). With a `VITE_GOOGLE_CLIENT_ID`, the header "G" menu connects a Google account;
SunnyD then proposes Calendar events, meeting invites (when it finds times + emails), and queues
assignment drafts as Google Docs, Sheets, or Gmail drafts — each pending user confirmation.
Access and refresh tokens are stored in `IndexedDB` (`sunnyd_google_db`); requests go directly
from the browser to Google. The Selection Agent extracts Workspace items grounded in verbatim
note text (`src/selectionAgentContext.js`, `src/google/`).

## Consequences

- Unlocks the **meeting-heavy professional** segment beyond students.
- Drafts are review-only; the user is responsible for academic integrity and for sending.
- Requested by users who live in Google Workspace.
- Maintains the no-backend promise even for OAuth.
- [FILL IN: are Workspace actions a candidate for a paid tier?]
