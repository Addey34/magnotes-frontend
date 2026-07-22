# Handoff — magnotes-frontend

Last updated: 2026-07-22.

> **Scope**: this is the standalone frontend repo. The API lives in `magnotes-full` (local: `MagNotes-server/`). No shared type package — mirror any HTTP contract changes by hand.

---

## Stack

React 18 · TypeScript · Vite · Axios · npm (not pnpm).

The app is served under `/app/`; `/` serves the static landing page (`landing/index.html`). In production the target is Firebase Hosting.

---

## Commands

```bash
npm install
npm run dev          # Vite dev server on :5173 (proxies /api → :5500)
npm run typecheck    # tsc --noEmit  ← run this, vite build does NOT type-check
npm test             # Jest tests (pure modules, focused hooks, UI components)
npm run lint         # ESLint (zero warnings enforced)
npm run build        # production build → dist/
npm run build:firebase  # build + assemble firebase-dist/ (landing + /app/)
```

> **Important**: `npm run build` passes even with type errors. Always run `npm run typecheck` before pushing.

---

## Architecture overview

### State — focused hooks, no global store

Board state is split across independent hooks in `src/hooks/`. There is no Redux or Context for board data — each hook owns its slice and exposes imperative methods.

| Hook                     | Owns                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `usePostIts`             | Card cache, CRUD, docking, stacking, undo/redo, optimistic revert      |
| `useStacks`              | Stack CRUD + stackOrder reordering with optimistic rollback            |
| `useConnections`         | Typed edges (arrows) with optimistic rollback                          |
| `useTabs`                | Board tabs lifecycle                                                   |
| `useBoardViewport`       | Pan, zoom, coordinate conversion (delegates math to `viewportMath.ts`) |
| `useHistory`             | Transactional undo/redo with compensation and concurrency guard        |
| `useKeyboardShortcuts`   | Global keyboard shortcuts (palette, undo, select-all, delete…)         |
| `useAutosave`            | Merged/serialized persistence, pending flush and online retry          |
| `useNotifications`       | Deduplicated, dismissible application notifications                    |
| `useOnlineStatus`        | Reactive browser online/offline state                                  |
| `useDismiss`             | Escape/outside-click dismissal for popovers                            |
| `useViewportPersistence` | Per-board viewport save/restore (localStorage)                         |

### Pure modules (unit-tested, no React)

Logic is extracted into small pure modules that hooks delegate to. Read these before changing behavior:

| Module                        | Role                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `hooks/dropIntent.ts`         | Stack / dock / free decision for card drops              |
| `hooks/viewportMath.ts`       | Screen ↔ board transforms, cursor-centered zoom, framing |
| `hooks/viewportCulling.ts`    | Visible board AABB — cull off-screen cards from DOM      |
| `hooks/viewportStorage.ts`    | Per-board viewport persistence (localStorage)            |
| `hooks/stackOrdering.ts`      | Contiguous `stackOrder` reordering on promote            |
| `hooks/historyCommands.ts`    | Reversible command definitions (move, dock, delete…)     |
| `utils/mentions.ts`           | `[[mention]]` parsing + resolution                       |
| `utils/mentionGraph.ts`       | Per-card view model: resolved chips + backlinks index    |
| `utils/connectionGeometry.ts` | SVG arrow geometry trimmed to card borders               |
| `utils/boardMarkdown.ts`      | Board → Markdown serialization                           |
| `utils/markdownImport.ts`     | Markdown → cards (inverse of export)                     |
| `utils/trelloImport.ts`       | Trello JSON export → cards                               |
| `utils/markdownRender.tsx`    | Dependency-free, XSS-safe Markdown renderer              |
| `utils/commandSearch.ts`      | Accent-insensitive fuzzy matcher for the palette         |
| `utils/boardTemplate.ts`      | Template card payload generation                         |
| `utils/checklist.ts`          | In-card checklist parse/toggle/serialize                 |
| `utils/cardMeta.ts`           | Card date/status grouping logic (Kanban/Agenda)          |
| `utils/timeline.ts`           | Timeline lane grouping logic                             |

### Components

```
src/components/
  postit/       PostItCard.tsx (inline edit, style, drag, resize)
                CardDetailModal.tsx (expand modal with Markdown preview)
  stacks/       PostItStackCard.tsx (collapsed pile, hover grid)
  connections/  ConnectionsLayer.tsx (SVG arrows)
  tabs/         BoardTabs.tsx (tab bar, rename, recolor, emoji picker)
  command/      CommandPalette.tsx (Ctrl+K, fuzzy search, quick capture)
  views/        KanbanView.tsx · AgendaView.tsx · TimelineView.tsx
  minimap/      BoardMinimap.tsx
  share/        ShareDialog.tsx
  appearance/   AppearancePanel.tsx (ambiance presets, canvas color)
  ui/           LoadingSpinner, EmptyState, TaskIconButton, NotificationCenter
```

### Services (API calls)

```
src/services/
  authApi.ts     Auth calls + silent refresh interceptor (axios)
  boardApi.ts    Cards, stacks, tabs, connections, search — delegates to demoBoard.ts in demo mode
  accountApi.ts  Profile, GDPR export, account deletion
  demoBoard.ts   localStorage mock store that mirrors server semantics (demo mode)
  demoImport.ts  Import sandbox into real account on signup
  demoMode.ts    Demo mode detection + state helpers
```

### i18n

System: `src/i18n/` — no external dependency.

- `dictionary.ts` — `{ fr: {...}, en: {...} }` (parity tested)
- `i18n.ts` — pure `t(key)` function (tested)
- `LangContext.tsx` — `useT()` hook + `LangProvider`
- `LanguageSwitch.tsx` — FR/EN toggle
- `labels.ts` — enum → localized labels

Detection: localStorage override → browser language → EN default. Adding a string = one key in `dictionary.ts` + `t('key')` in the component.

### Key pages

- `pages/BoardApp.tsx` — board shell: filters, viewport, composition of all hooks + components
- `pages/LoginForm.tsx` — auth (register, verify, login, reset)
- `pages/PublicBoardView.tsx` — read-only shared board (`/app/b/<token>`)

---

## API contract (summary)

All requests to `/api/**` are proxied to the backend in dev. Auth endpoints:

- `POST /api/auth/register`, `/verify`, `/login`, `/logout`, `/refresh`, `/forgot-password`, `/reset-password`
- `GET/DELETE/PUT /api/account/**` (protected)
- `GET/POST/PATCH/DELETE /api/tabs/**`, `/api/postits/**`, `/api/stacks/**`, `/api/connections/**` (protected)
- `GET /api/postits/search?q=` — global cross-board search
- `GET /api/public/boards/:token` — public board (no auth)

See `magnotes-full/docs/API.md` for the full reference.

---

## Demo mode

`/app/?demo=1` — enters a local sandbox without auth. `boardApi.ts` delegates to `demoBoard.ts` (localStorage). On signup, `demoImport.ts` replays the sandbox into the real account (remapping ids). The UI and all hooks are unchanged.

---

## Deployment

```bash
npm run build:firebase   # builds dist/ + assembles firebase-dist/ (landing + app)
firebase deploy --only hosting:magnotes
```

`.env.production` sets `VITE_API_URL=https://api-magnotes.adrianguichard.dev`. The app is served at `https://magnotes.adrianguichard.dev/app/`, the landing at `https://magnotes.adrianguichard.dev/`.

---

## Open items (frontend)

See `docs/QA.md` for the complete testing and bug checklist.

Key architectural debt:

- Inline base64 images stored in Mongo — need server-side migration to storage; frontend just needs to handle URL responses instead of data URIs
- `formatDueDate`/`cardMeta` dates on the canvas still use system locale (not language-aware); Timeline/Agenda views are already lang-aware
- No PWA (manifest, service worker) yet
- No component/interaction tests — only pure module unit tests
