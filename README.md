# SunnyD Notes

An intelligent note-taking app powered by AI. SunnyD reads your notes as you write and surfaces contextual suggestions—fact checks, expansions, clarity improvements, research citations, and lecture-based additions. Your API keys stay in your browser; notes can be kept in the browser or saved to a file on your disk.

![React](https://img.shields.io/badge/React-18-61dafb?logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Suggestion types

- **Fact Check** — Flags clear factual errors and suggests corrections. Hedged phrasing (“about 50%”, “roughly”, “approximately”) is not flagged.
- **Expand** — Ideas worth developing further.
- **Clarity** — Sentences that could be clearer or better structured.
- **Explain** — Concepts or terms that deserve a simpler explanation.
- **Research** — Suggests citations with real URLs (DOI, PubMed, journals). Only for claims that merit sources; passages that already have citations are skipped.

### Suggestion modes

Control how many non-fact suggestions you see (fact checks are always included):

| Mode        | What you get                                                                 |
|------------|-------------------------------------------------------------------------------|
| **Off**    | No suggestions.                                                              |
| **Zen**    | Fact checks + research only (0–2 research suggestions).                      |
| **Just Right** | Fact checks + research, clarity, and explain (2–3 non-fact suggestions).  |
| **Eager**  | All categories including expand (5–9 non-fact suggestions).                 |

### Other capabilities

- **Ghost completion** — Pause mid-sentence and press **Tab** to accept an AI-suggested completion.
- **Selection actions** — Highlight text to **Summarize**, **Expand**, or **Explain** in place.
- **Lecture mode** — Live transcription (browser speech recognition). View the full transcript; when questions are detected, SunnyD suggests short answers you can copy. Optional **lecture suggestions** compare the transcript to your notes and suggest what to add (labeled “Lecture” in the panel).
- **Multi-note** — Multiple notes in the sidebar; switch between them. Notes and the active note are restored on reload.
- **Persistence** — Notes are saved in the browser (localStorage). You can optionally **Save to file on disk** so they’re stored in a JSON file on your computer (Chrome/Edge; File System Access API).
- **Export** — Export the current note or all notes as a **.docx** file for Word or Google Docs.

---

## Quick start

### Prerequisites

- **Node.js 18+**
- An API key for at least one provider:
  - [OpenAI](https://platform.openai.com/api-keys) (e.g. GPT-4o-mini)
  - [Claude](https://console.anthropic.com/settings/keys) (e.g. Haiku)
  - [Gemini](https://aistudio.google.com/apikey) (e.g. Flash)

### Install and run

```bash
git clone https://github.com/SanjoyDat1/SunnyD_NoteTaker.git
cd SunnyD_NoteTaker
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). On first run you’ll see the API key screen: pick an LLM provider, enter the key, and click **Continue**. You can change the key or provider later via **Change key** in the header.

### Build for production

```bash
npm run build
npm run preview
```

The built app is in `dist/`. Serve that folder with any static host.

---

## Where your data lives

- **API keys** — Stored in the browser’s `sessionStorage` and only sent to the provider you select. Not sent to any other server.
- **Notes (default)** — Stored in **localStorage** under keys `sd_notes_v1` and `sd_activeId_v1`. They persist across reloads and restarts in the same browser and origin.
- **Notes (optional disk file)** — If you use **Save to file on disk** in the sidebar, the app will ask for a file (e.g. `sunnyd-notes.json`) and then read/write that file on your machine. Supported in Chrome and Edge (File System Access API). The file contains a JSON object with `notes`, `activeId`, and `version`.

---

## Project structure

```
SunnyD_NoteTaker/
├── index.html          # Entry HTML
├── sunnyd.jsx          # Main app (UI, logic, styles, persistence, export)
├── src/
│   └── main.jsx       # React mount and error boundary
├── public/
│   └── sunnyd-logo.png
├── package.json
├── vite.config.js
└── README.md
```

---

## Configuration

| Setting           | Where it’s stored   | Description                                      |
|------------------|---------------------|--------------------------------------------------|
| LLM provider      | `sessionStorage`    | OpenAI / Claude / Gemini                         |
| API keys          | `sessionStorage`    | Per-provider (`sd_key_openai`, etc.)             |
| Suggestion mode  | `sessionStorage`    | Off / Zen / Just Right / Eager                   |
| Notes             | `localStorage` or file | All notes and active note ID                  |

---

## Tech stack

- **React 18** — UI components and state.
- **Vite 5** — Dev server and production build.
- **LLMs** — One of: OpenAI (gpt-4o-mini), Claude (claude-haiku-4-5), Gemini (gemini-2.0-flash-lite). You choose the provider; the app uses a fast, light model for that provider.
- **react-speech-recognition** — Live lecture transcription ([GitHub](https://github.com/JamesBrill/react-speech-recognition)).
- **docx** + **file-saver** — Export notes to .docx.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

1. Fork the repo.
2. Create a branch: `git checkout -b feature/your-feature`.
3. Commit: `git commit -m 'Add feature'`.
4. Push: `git push origin feature/your-feature`.
5. Open a Pull Request.
