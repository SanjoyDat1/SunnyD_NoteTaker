# ADR-001: No backend — privacy-first, browser-only architecture

## Status

Accepted on 2025-03-10. Owned by the SunnyD team (Sanjoy Datta).

## Context

Note-taking apps usually run a server that stores user notes and proxies AI calls, which means
the company holds users' private notes and their API usage. For a student writing personal and
academic notes, that is a trust problem and a liability.

## Decision

SunnyD has no backend. All data lives in the browser: notes in `localStorage` (`sd_notes_v1`),
provider choice and API keys in `sessionStorage`, and Google OAuth tokens in `IndexedDB`. AI
requests go directly from the browser to the chosen LLM provider; SunnyD never proxies them.
This privacy-first stance is a core product differentiator and motivates the Bring-Your-Own-Key
decision (ADR-002).

## Consequences

- No server cost, no inference bill on SunnyD's side, and nothing to breach.
- Persistence is per-device; the optional **Save to disk** feature (File System Access API,
  Chrome/Edge) lets users keep a portable JSON copy.
- Requested by privacy-conscious students and researchers who do not want their notes on a
  third-party server.
- Trade-off: no cross-device sync today. [FILL IN: is sync a planned paid feature?]
