# SunnyD Notes

An intelligent, privacy-first note-taking app powered by AI. SunnyD reads your notes as you write and surfaces contextual suggestions — fact checks, expansions, clarity improvements, research citations, and lecture-based additions. Your API key stays in your browser session and is sent only to the AI provider you select.

![React](https://img.shields.io/badge/React-18-61dafb?logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)
![TipTap](https://img.shields.io/badge/TipTap-2-6b7280)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### AI suggestions (right panel)

| Type | What it does |
|------|--------------|
| **Fact Check** | Flags clear factual errors and suggests corrections. Hedged phrasing is not flagged. |
| **Expand** | Surfaces ideas worth developing further. |
| **Clarity** | Identifies sentences that could be clearer or better structured. |
| **Explain** | Suggests a simpler explanation for a concept or term. |
| **Research** | Suggests citations with real URLs (DOI, PubMed, journals). Only for claims that merit a source; already-cited passages are skipped. |
| **Lecture** | When Lecture mode is active, compares the live transcript to your notes and surfaces relevant additions. |

### Suggestion modes

Control how many non-fact suggestions you see (fact checks are always included):

| Mode | What you get |
|------|--------------|
| **Off** | No suggestions. |
| **Zen** | Fact checks + research only. |
| **Just Right** | Fact checks + research, clarity, and explain. |
| **Eager** | All categories, including expand. |

### Editor

- Rich text editing powered by [TipTap](https://tiptap.dev/) — bold, italic, headings (H1/H2), bullet lists, code blocks.
- **Ghost completion** — pause mid-sentence; a suggested continuation appears. Press **Tab** to accept, **Esc** to dismiss. A "thinking…" indicator shows while the suggestion is loading.
- **Selection actions** — highlight any text to **Summarize**, **Expand**, or **Explain** it in place using a floating toolbar. Errors are surfaced inline so you always know what happened.
- Keyboard shortcuts: **⌘B** bold, **⌘I** italic (shown in toolbar tooltips on hover).

### Lecture mode

Live transcription using the browser's built-in speech recognition (Chrome/Edge). While recording:

- The full transcript is displayed in a collapsible panel.
- Detected questions are highlighted; click one to get a short AI-generated answer you can copy or add directly to your notes.
- SunnyD compares the transcript to your notes and surfaces "Lecture" suggestions for anything worth adding.

### SunnyD Cast

Turns your notes (and lecture transcript, if present) into a short two-host podcast — **Dee** and **Ray** — so you can listen back and relearn.

- Choose episode length (2–10 minutes).
- Supports high-quality **OpenAI TTS**, on-device **Kokoro TTS**, and browser Web Speech as fallback.
- **Minimize** the player to a floating draggable dock while you keep writing — playback and waveform visualizations continue uninterrupted.
- **Ask about this moment** — pause playback and ask the AI a question about what Dee and Ray just said, with your notes as context. Answers are kept brief and focused.
- Download the finished episode as a `.wav` file.

### Other capabilities

- **Multi-note** — multiple notes in the sidebar; switch between them with a click or keyboard (Tab/Enter on each row). Full note titles shown on hover.
- **Keyboard shortcuts** — **⌘K** / **Ctrl+K** to search, **⌘N** / **Ctrl+N** for a new note. Shortcuts are listed in the sidebar "How it works" section.
- **Metadata** — optionally tag each note with subject, professor, and study goal to get smarter, more personalised suggestions.
- **Note creation date** — the meta-row below the title shows when the note was created, not today's date.
- **Accurate word count** — HTML tags are stripped before counting, so formatting never inflates the number.
- **Export** — export the current note or all notes as a **.docx** file for Word or Google Docs.
- **Persistence** — notes are auto-saved to `localStorage` on every change; a subtle flash animation confirms each save.
- **Save to disk** — optionally save notes to a JSON file on your machine (Chrome/Edge; File System Access API).
- **Search** — semantic vector search across all notes (OpenAI/Gemini) or keyword scoring (Claude).

### Google Workspace (optional)

When you add an OAuth 2.0 **client ID for a browser app** at build time (`VITE_GOOGLE_CLIENT_ID`), the header **G** menu lets you connect your Google account. SunnyD can then (with your confirmation):

- Propose **Calendar** events when it detects a verifiable date/time in your notes.
- Propose **meeting invites** when it finds times and email addresses in the note; you edit details, then invites are sent via Google Calendar.
- Queue **assignment drafts** as a new Google Doc, Google Sheet, or Gmail draft (drafts are for your review; you are responsible for academic integrity).

OAuth **access and refresh tokens** are stored in **IndexedDB** in your browser. Requests go **directly from your browser to Google** and to your chosen LLM provider — there is still no SunnyD backend.

---

## Quick start

### Prerequisites

- **Node.js 18+**
- An API key for at least one provider:
  - [OpenAI](https://platform.openai.com/api-keys) — recommended (GPT-4o mini, TTS)
  - [Claude](https://console.anthropic.com/settings/keys) — Haiku
  - [Gemini](https://aistudio.google.com/apikey) — Flash Lite

### Google Cloud (optional, for Workspace integration)

SunnyD completes OAuth **in the browser** with PKCE (no SunnyD server). You can use either setup:

**A — Recommended (no secret in the app)**  
1. **Credentials** → **OAuth client ID** → type **Single Page Application**.  
2. Add **Authorized JavaScript origins** (e.g. `http://localhost:5173`) and **Authorized redirect URIs** (e.g. `http://localhost:5173/` — trailing slash must match).  
3. Put only `VITE_GOOGLE_CLIENT_ID` in `.env`.

**B — “Web application” OAuth client (confidential)**  
Google’s token endpoint expects a **`client_secret`** for this client type, which is why you may see `client_secret is missing` if the secret is not sent. For **local use only**, you may add the client secret from Google Cloud (Credentials → your OAuth 2.0 client) to `.env` as `VITE_GOOGLE_CLIENT_SECRET=...` and restart Vite. **Do not commit `.env`.** Do not publish a static build that embeds the secret if the site is public — anyone can read it from the JS bundle; use (A) for production.

**Everyone:** enable APIs: **Google Calendar**, **Google Drive**, **Google Docs**, **Google Sheets**, **Gmail API**. Copy the client ID into `.env` as `VITE_GOOGLE_CLIENT_ID=...`.

### Install and run

```bash
git clone https://github.com/SanjoyDat1/SunnyD_NoteTaker.git
cd SunnyD_NoteTaker
npm install
# Optional: cp .env.example .env and set VITE_GOOGLE_CLIENT_ID (never commit .env with secrets)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). On first run you'll see the API key screen: pick a provider, paste your key, and click **Continue**. You can switch provider or update your key anytime via **Change key** in the header.

### Build for production

```bash
npm run build
npm run preview
```

The built app is in `dist/`. Serve that folder with any static host (GitHub Pages, Netlify, Vercel, etc.).

---

## Where your data lives

| What | Where | Notes |
|------|-------|-------|
| API keys | `sessionStorage` | Per-provider (`sd_key_openai`, `sd_key_claude`, `sd_key_gemini`). Cleared when the browser tab closes. |
| LLM provider choice | `sessionStorage` | `sd_provider` |
| Notes | `localStorage` (`sd_notes_v1`) | Persists across reloads. |
| Active note ID | `localStorage` (`sd_activeId_v1`) | Restored on reload. |
| Suggestion frequency | `sessionStorage` (`sd_suggFreq`) | Off / zen / balanced / eager |
| Cast episode length | `sessionStorage` (`sd_cast_max_min`) | 2–10 min |
| Mini player position | `sessionStorage` (`sd_cast_float_pos`) | Draggable dock coords |
| Notes (disk file) | JSON file you choose | Opt-in; Chrome/Edge only. |
| Google OAuth tokens | `IndexedDB` (`sunnyd_google_db`) | Only if you connect Workspace; persists until disconnect or site data cleared. |
| Workspace UI toggles | `sessionStorage` | e.g. `sd_workspace_enabled`, per-feature switches |

There is **no SunnyD backend**: your notes stay in the browser. **LLM providers** receive text only when you use AI features. If you enable **Google Workspace**, your browser also sends data **directly to Google’s APIs** (Calendar, Drive, Docs, Sheets, Gmail) using your OAuth token — SunnyD never proxies that traffic through a separate server.

---

## Project structure

```
SunnyD_NoteTaker/
├── index.html          # Entry HTML
├── sunnyd.jsx          # Main app — UI, logic, styles, persistence, export
├── src/
│   ├── main.jsx        # React mount point and error boundary
│   └── google/         # Google OAuth (PKCE), Calendar/Drive/Docs/Sheets/Gmail helpers, job runner
├── public/
│   └── sunnyd-logo.png
├── package.json
├── vite.config.js
├── README.md
├── CONTRIBUTING.md
└── SECURITY.md
```

Most UI and behaviour live in `sunnyd.jsx` (CSS injected via `<style>`). Optional Google Workspace logic is modularized under [`src/google/`](src/google/) for OAuth and REST calls.

---

## Configuration reference

| Setting | Storage | Key |
|---------|---------|-----|
| LLM provider | `sessionStorage` | `sd_provider` |
| API key (OpenAI) | `sessionStorage` | `sd_key_openai` |
| API key (Claude) | `sessionStorage` | `sd_key_claude` |
| API key (Gemini) | `sessionStorage` | `sd_key_gemini` |
| Suggestion frequency | `sessionStorage` | `sd_suggFreq` |
| Notes | `localStorage` | `sd_notes_v1` |
| Active note | `localStorage` | `sd_activeId_v1` |

---

## Tech stack

| Library | Version | Role |
|---------|---------|------|
| [React](https://react.dev/) | 18 | UI and state |
| [Vite](https://vitejs.dev/) | 5 | Dev server and production build |
| [TipTap](https://tiptap.dev/) | 2 | Rich text editor (ProseMirror-based) |
| [react-speech-recognition](https://github.com/JamesBrill/react-speech-recognition) | latest | Live lecture transcription |
| [docx](https://docx.js.org/) + [file-saver](https://github.com/eligrey/FileSaver.js) | latest | Export to .docx |
| [Kokoro TTS](https://huggingface.co/onnx-community/Kokoro-82M-v1.0_timestep) | via ONNX | On-device text-to-speech for SunnyD Cast |

**LLM providers supported:** OpenAI (gpt-4o-mini), Claude (claude-haiku-4-5), Gemini (gemini-2.0-flash-lite).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
