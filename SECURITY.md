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

SunnyD Notes is a fully client-side application. No backend server processes or stores your data.

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

### Other persisted data (sessionStorage — cleared on tab close)

| Key | Contents |
|-----|----------|
| `sd_provider` | Selected LLM provider name |
| `sd_suggFreq` | Suggestion frequency setting |
| `sd_cast_max_min` | SunnyD Cast episode length preference |
| `sd_cast_float_pos` | Mini player dock position |

### What is NOT collected

- No analytics, telemetry, or tracking of any kind.
- No user accounts or registration.
- No server-side logging of notes, queries, or API keys.

---

## Third-party services

When you use the app, your note text (and relevant context) is sent to the AI provider you configured. Review their privacy policies:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)
