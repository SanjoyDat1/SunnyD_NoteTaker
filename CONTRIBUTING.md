# Contributing to SunnyD Notes

Thanks for your interest in contributing! Here's everything you need to get started.

---

## Development setup

```bash
git clone https://github.com/SanjoyDat1/SunnyD_NoteTaker.git
cd SunnyD_NoteTaker
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). You'll need an API key for at least one supported LLM provider (OpenAI, Claude, or Gemini) to use AI features.

### Build and verify

```bash
npm run build   # production bundle — must succeed before opening a PR
npm run preview # preview the production build locally
```

---

## Codebase overview

The entire app lives in **`sunnyd.jsx`** — components, styles (injected via `<style>`), persistence helpers, AI calls, and the TipTap editor setup. There is intentionally no separate build pipeline for CSS or multiple component files.

```
sunnyd.jsx
├── CSS template literal           (~lines 1464–2300)
├── Toolbar / NoteEditor           (~lines 2310–2630)
├── PodcastFloatingDock / panels   (~lines 763–965)
├── Main app state + callbacks     (~lines 2820–4940)
├── Render tree                    (~lines 4940–5985)
└── Persistence helpers            (~lines 1222–1460)
```

---

## Code style

- Standard JSX/JS conventions — no special linter config beyond what Vite ships with.
- Keep components focused. New UI features go in `sunnyd.jsx`; if something grows very large, discuss extraction in the PR first.
- CSS lives in the `const CSS = \`...\`` template literal at the top of the file. Add new rules there rather than in separate `.css` files.
- Prefer `useCallback` for callbacks passed to child components or used in `useEffect` dependency arrays.
- Do not add comments that just restate what the code does. Comments should explain *why*, not *what*.

---

## AI integration guidelines

- All LLM calls go through the `ai(provider, apiKey, system, user, maxTokens)` helper.
- Keep prompts concise — the app targets the fastest/cheapest model per provider.
- Always handle errors gracefully and surface them to the user (not just `console.error`).
- Never log or send API keys anywhere other than the provider endpoint.

---

## Pull request process

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`
2. Make your changes. Ensure `npm run build` passes cleanly.
3. Write a clear PR description explaining *what* changed and *why*.
4. Reference any related issues.
5. Open the PR against `main`.

---

## Good areas to contribute

- Bug fixes and edge case handling
- UI/UX polish and accessibility improvements
- New suggestion types or smarter prompts
- Performance optimizations (especially around suggestion debouncing)
- Better responsive/mobile layout
- Dark mode support
- Documentation and examples
