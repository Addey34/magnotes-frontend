# MagNotes

Visual post-it board app — an infinite, pannable canvas of draggable cards you
can stack, dock, link, and reorganize. Cards support Markdown, inline images,
checklists, `[[mentions]]`, and alternate Kanban / Agenda / Timeline views, plus
a command palette (`Ctrl`/`Cmd`+K).

**Live:** https://magnotes.adrianguichard.dev

> This repository contains the **frontend only**. The API is a separate,
> private service; this app talks to it over HTTPS via `VITE_API_URL`
> (see `.env.production`). A guest **demo mode** (`/app/?demo=1`) runs entirely
> in the browser with `localStorage`, so the app is usable without the backend.

## Stack

React 18 + TypeScript, Vite, Axios. State lives in focused hooks (viewport,
cards, stacks, tabs, connections, history). Bilingual FR/EN.

## Development

```bash
npm install
npm run dev        # Vite dev server on :5173
```

`npm run dev` proxies `/api` to `VITE_API_URL` (or `http://127.0.0.1:5500` if
unset). To work fully offline, use the demo sandbox at `/app/?demo=1`.

## Build & deploy

The app is served under `/app/`; `/` serves the static landing page. Firebase
Hosting is the target.

```bash
npm run build:firebase   # vite build + assemble ./firebase-dist
firebase deploy --only hosting:magnotes
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run build:firebase` | Build + assemble `firebase-dist/` (landing + app) |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit tests |
| `npm run lint` | ESLint (zero warnings) |

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md) — free to use, modify, and share
for **noncommercial** purposes. Commercial use requires a separate license.
