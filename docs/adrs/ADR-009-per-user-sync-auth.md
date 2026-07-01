# ADR-009: Per-user sync auth (JWT) — multi-tenant backend v2

## Status

Accepted. Owned by the SunnyD team (Sanjoy Datta).

## Context

ADR-008 v1 shipped an optional sync API with a single global workspace and optional shared-secret auth. That is sufficient for local dev and single-user self-hosting, but not for a hosted multi-tenant tier. ADR-001 and ADR-002 still require:

- Browser-first default (no backend required for core use)
- BYOK — LLM calls stay client-side; no SunnyD inference proxy
- No storage of API keys or Google OAuth tokens on the sync server

## Decision

Extend the optional sync backend with **per-user accounts** when `SUNNYD_JWT_SECRET` is set:

### Auth modes

| Mode | Trigger | Notes API auth |
|------|---------|----------------|
| **legacy** | `SUNNYD_JWT_SECRET` unset | Optional `SUNNYD_API_SECRET`; single shared workspace (`__legacy__`) |
| **jwt** | `SUNNYD_JWT_SECRET` set (≥32 chars) | Register/login; Bearer JWT per user; isolated workspaces |

### API surface

- `GET /api/auth/config` — `{ authMode, registerEnabled, dbDriver }`
- `POST /api/auth/register` — `{ email, password }` → `{ token, user }` (jwt mode only)
- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`
- `GET /api/auth/me` — current user (JWT required)
- `GET/PUT /api/notes` — scoped to authenticated user (unchanged shape)

### Database

- Default: **SQLite** (`SUNNYD_DB_PATH`, auto-migrates v1 single workspace)
- Optional: **PostgreSQL** when `DATABASE_URL` is set (hosted deployments)

### Client

- When `VITE_API_BASE_URL` is set and server reports `authMode: jwt`, show sync login/register before hydrating notes.
- JWT stored in `sessionStorage` (`sd_sync_jwt`); cleared on tab close.
- `localStorage` remains the live cache; offline/local fallback unchanged.

### Explicit non-goals (unchanged from ADR-008)

- No LLM proxy or managed API keys on the server
- No Google token storage on the server
- No telemetry or analytics pipeline

## Consequences

- Enables multi-tenant hosted sync while preserving privacy/BYOK defaults.
- ADR-001 default path unchanged — sync remains opt-in via env vars.
- E2E encryption of note bodies is still future work.
- Legacy self-hosters can keep v1 behavior by omitting `SUNNYD_JWT_SECRET`.
