# ADR-008: Optional sync backend (hosted tier foundation)

## Status

Accepted. Owned by the SunnyD team (Sanjoy Datta).

## Context

ADR-001 keeps SunnyD browser-first with no required backend. The roadmap lists **cross-device sync** as planned — students and professionals want notes on multiple devices without losing the option to run fully offline/local.

A full multi-user auth platform would conflict with the privacy-first stance and add operational burden before product–market fit. A minimal sync layer can still enable self-hosting and a future SunnyD-hosted tier.

## Decision

Add an **optional** Node.js + Express + SQLite API under `server/`:

- When `VITE_API_BASE_URL` is set, the client loads and saves notes via `GET` / `PUT` `/api/notes`.
- `localStorage` remains the live cache; if the server is unreachable, the app keeps working locally.
- **Scope v1:** notes array + active note id only. No LLM proxy, no Google token storage, no user accounts.
- **Auth v1:** optional shared secret (`SUNNYD_API_SECRET` / `VITE_SUNNYD_API_SECRET`). When unset, the server binds to localhost only for local dev.
- Self-hosters run `npm run server` alongside the Vite app.

## Consequences

- Enables cross-device sync for users who opt into a hosted or self-hosted sync endpoint.
- ADR-001 remains the default path — no backend required for core use.
- SQLite is not HA; acceptable for MVP, local dev, and single-user self-hosting.
- Shared secret in the frontend bundle is **not** strong multi-tenant security; per-user auth or E2E encryption are future work.
- SunnyD infrastructure can offer a hosted sync endpoint later without changing the client contract.
