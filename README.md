# MagNotes

Visual post-it board app — an infinite, pannable canvas of draggable cards you
can stack, dock, link, and reorganize. Cards support Markdown, inline images,
checklists, `[[mentions]]`, and alternate Kanban / Agenda / Timeline views, plus
a command palette (`Ctrl`/`Cmd`+K).

**Live:** https://magnotes.adrianguichard.dev

> This repository contains the **frontend only**. The API is a separate,
> private service; this app talks to it over HTTPS via `VITE_API_URL`. Local environment files are ignored; use
> `.env.production.example` as the template. A guest **demo mode** (`/app/?demo=1`) runs entirely
> in the browser with `localStorage`, so the app is usable without the backend.

## Stack

React 18 + TypeScript, Vite 8, Axios. State lives in focused hooks (viewport,
cards, stacks, tabs, connections, history). Bilingual FR/EN.

## Development

```bash
pnpm install
pnpm run dev        # Vite dev server on :5173
```

`pnpm run dev` proxies `/api` to `VITE_API_URL` (or `http://127.0.0.1:5500` if
unset). To work fully offline, use the demo sandbox at `/app/?demo=1`.

## Build & deploy

The app is served under `/app/`; `/` serves the static landing page. Firebase
Hosting is the target.

```bash
pnpm run deploy:firebase  # rebuild ./firebase-dist, then deploy hosting:magnotes
```

## Scripts

| Command                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `pnpm run dev`             | Vite dev server                                   |
| `pnpm run build`           | Production build → `dist/`                        |
| `pnpm run build:firebase`  | Build + assemble `firebase-dist/` (landing + app) |
| `pnpm run deploy:firebase` | Rebuild the Firebase payload, then deploy it      |
| `pnpm run preview`         | Preview the production build                      |
| `pnpm run typecheck`       | `tsc --noEmit`                                    |
| `npm test`                 | Jest unit tests                                   |
| `pnpm run lint`            | ESLint (zero warnings)                            |
| `pnpm run verify`          | Typecheck, lint, tests, build and runtime audit   |
| `pnpm run e2e`             | Smoke E2E Playwright desktop + mobile + axe       |
| `pnpm run e2e:install`     | Installe Chromium pour les tests E2E              |

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md) — free to use, modify, and share
for **noncommercial** purposes. Commercial use requires a separate license.

## Repository boundary

This public repository contains the frontend and public build configuration only.
The Express/MongoDB backend and deployment assets live in the private repository
[`magnotes-backend`](https://github.com/Addey34/magnotes-backend). Local operator, AI,
QA and audit documents stay outside both repositories under the parent workspace.
Do not copy the parent `MagNotes/` workspace, `.env` files, or private documents
into this public repository.

For a local production build, copy `.env.production.example` to
`.env.production`. CI injects the public API URL explicitly at build time.
