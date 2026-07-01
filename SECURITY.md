# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x (current `main`) | ✅ |

## Reporting a vulnerability

Please open a [GitHub Issue](https://github.com/SanjoyDat1/SunnyD_NoteTaker/issues) to report security concerns. For sensitive disclosures, contact the maintainer directly through GitHub.

**Do not commit API keys, secrets, or credentials to the repository.**

---

## How user data is handled

SunnyD Notes is **browser-first by default**. No backend is required; nothing is sent to SunnyD infrastructure unless you opt into the optional sync server (see [ADR-008](docs/adrs/ADR-008-optional-sync-backend.md)).

### Optional sync server

If you set `VITE_API_BASE_URL` and run the sync API under `server/`:

- **Notes** (title, content, active note id) are stored in **SQLite** (or PostgreSQL via `DATABASE_URL`) on the host you run.
- **API keys**, **Google OAuth tokens**, and **LLM traffic** are still never stored or proxied by the sync server.
- For multi-user or internet-facing instances, use **per-user JWT auth** ([ADR-009](docs/adrs/ADR-009-per-user-sync-auth.md)): set `SUNNYD_JWT_SECRET` (≥32 chars). Passwords are hashed with scrypt; each account only sees its own workspace. Note content is **not end-to-end encrypted** — the host operator can read stored notes.
- The legacy v1 shared secret (`SUNNYD_API_SECRET` / `VITE_SUNNYD_API_SECRET`) only deters casual unauthenticated access — it is embedded in the frontend bundle at build time, so treat legacy remote sync as **single-user / trusted-network only**.
- Use HTTPS in production (reverse proxy); the sync API speaks plain HTTP only. Behind a proxy, set `SUNNYD_TRUST_PROXY=1` so login rate limiting sees real client IPs (`X-Forwarded-For` is ignored otherwise, since it is client-spoofable).
- Synced note HTML is sanitized client-side on hydration (script tags, event handlers, `javascript:` URLs stripped) before rendering, since a synced snapshot can be written by any device holding the account token.
- The server binds to `127.0.0.1` by default. Set `SUNNYD_BIND=0.0.0.0` for LAN/WAN access — the server **refuses to start** without `SUNNYD_JWT_SECRET` (or the legacy `SUNNYD_API_SECRET`).

### API keys

- Stored only in **`sessionStorage`** in your browser — one key per provider:
  - `sd_key_openai`
  - `sd_key_claude`
  - `sd_key_gemini`
- `sessionStorage` is cleared automatically when the browser tab is closed.
- Keys are sent **only** to the LLM provider you select (OpenAI, Anthropic, or Google). No other server ever receives them.

### Notes

- Stored in **`localStorage`** (`sd_notes_v1`, `sd_activeId_v1`) in your browser. They persist across reloads.
- Optionally, you can save notes to a **local JSON file** on your disk using the File System Access API (Chrome/Edge only). The app writes to whatever file you choose; no copy is sent anywhere.
- Note content is sent to the selected LLM provider **only** when you trigger an AI action (suggestion, ghost completion, selection action, lecture Q&A, SunnyD Cast, etc.).

### Google Workspace (optional)

If you enable **Google Workspace integration** and connect your Google account:

- **OAuth access and refresh tokens** are stored in **`IndexedDB`** (`sunnyd_google_db`) in your browser until you disconnect or clear site data for the app.
- Tokens are as sensitive as API keys: malicious scripts in the page (XSS) could exfiltrate them — the same class of risk as LLM API keys in `sessionStorage`.
- The app calls **Google APIs directly from your browser** (Calendar, Drive, Docs, Sheets, Gmail) using those tokens. There is no SunnyD server in the middle.

### Other persisted data (sessionStorage — cleared on tab close)

| Key | Contents |
|-----|----------|
| `sd_provider` | Selected LLM provider name |
| `sd_suggFreq` | Suggestion frequency setting |
| `sd_cast_max_min` | SunnyD Cast episode length preference |
| `sd_cast_float_pos` | Mini player dock position |
| `sd_workspace_*` | Workspace automation toggles |

### What is NOT collected

- No analytics, telemetry, or tracking of any kind.
- No user accounts or registration by default (the optional sync server in JWT mode stores an email + scrypt password hash per account — nothing else).
- No server-side logging of notes, queries, or API keys.

---

## Third-party services

When you use the app, your note text (and relevant context) is sent to the AI provider you configured. Review their privacy policies:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)
