
# SunnyD Notes

An intelligent note-taking app powered by AI. SunnyD reads your notes as you write and surfaces contextual suggestions—fact checks, expansions, clarity improvements, research citations, and more. Your API key stays in your browser; nothing is stored on any server.

![SunnyD Notes](https://img.shields.io/badge/React-18-61dafb?logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai)

## Features

- **Fact Check** — Flags verifiable inaccuracies and suggests corrections (no caveats or "consult sources")
- **Expand** — Suggests ideas worth developing further
- **Clarity** — Identifies sentences that could be clearer
- **Explain** — Surfaces concepts that deserve simpler explanations
- **Research** — Suggests citations with real URLs (DOI, PubMed, journals)
- **Ghost completion** — Tab to accept AI-suggested completions when you pause mid-thought
- **Selection actions** — Highlight text to Summarize, Expand, or Explain
- **Lecture mode** — Live transcription of lectures; view full transcript and add to notes
- **Multi-note** — Switch between notes; suggestions stay when you type in unrelated sections

## Quick Start

### Prerequisites

- Node.js 18+
- API key for at least one provider:
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Claude](https://console.anthropic.com/settings/keys)
  - [Gemini](https://aistudio.google.com/apikey)

### Install & Run

```bash
git clone https://github.com/SanjoyDat1/SunnyD_NoteTaker.git
cd SunnyD_NoteTaker
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), choose your LLM (OpenAI, Claude, or Gemini), enter the corresponding API key when prompted, and start writing.

### Build for Production

```bash
npm run build
npm run preview
```

The built app is in `dist/`.

## Project Structure

```
SunnyD_NoteTaker/
├── index.html          # Entry HTML
├── src/
│   └── main.jsx       # React mount + error boundary
├── sunnyd.jsx         # Main app (components, logic, styles)
├── package.json
├── vite.config.js
└── README.md
```

## How It Works

1. **API keys** — Stored in `sessionStorage`; only sent to the provider you choose (OpenAI, Claude, or Gemini).
2. **Suggestions** — Generated as you write; frequency controlled by "Suggestions" bar (Off, Zen, Just Right, Eager).
3. **Fact checks** — Only real factual errors are flagged; caveats and "consult sources" are filtered out.
4. **Apply** — Click a suggestion card to expand, then Apply to weave it into your notes.

## Configuration

| Setting        | Storage           | Description                          |
|----------------|-------------------|--------------------------------------|
| LLM provider   | `sessionStorage`  | OpenAI / Claude / Gemini             |
| API keys       | `sessionStorage`  | Per-provider keys (`sd_key_openai`, etc.) |
| Suggestion freq| `sessionStorage`  | Off / Zen / Just Right / Eager  |

## Tech Stack

- **React 18** — UI
- **Vite 5** — Build & dev server
- **LLM options** — OpenAI (gpt-4o-mini), Claude (claude-haiku-4-5), or Gemini (gemini-3.1-flash-lite-preview) — pick the fastest model per provider
- **react-speech-recognition** — Live lecture transcription ([GitHub](https://github.com/JamesBrill/react-speech-recognition))

## License

MIT — see [LICENSE](LICENSE).

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/your-feature`)
3. Commit (`git commit -m 'Add feature'`)
4. Push (`git push origin feature/your-feature`)
5. Open a Pull Request
