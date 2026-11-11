# Contributing to Beekeeper

Thanks for helping! Beekeeper is an Electron + React + TypeScript app for Windows 11.

## Setup

```powershell
git clone https://github.com/snowjug/Beekeeper.git
cd Beekeeper
npm ci
npm run dev          # electron-vite dev server + Electron with hot reload
```

Requirements: Windows 10/11, Node.js 22.12 or newer (CI uses 24), npm 10 or newer.

Optional: copy `.env.example` to `.env` to try the Azure features without typing keys into Settings.

## Scripts

| Script              | What it does                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`       | Development build with hot reload                                                   |
| `npm run build`     | Production build into `out/`                                                        |
| `npm run typecheck` | `tsc` for the Node (main/preload/shared), web (renderer) and end-to-end projects    |
| `npm run lint`      | ESLint (type-aware, `--max-warnings=0`) and `prettier --check`                      |
| `npm run format`    | Prettier write                                                                      |
| `npm test`          | Vitest with coverage (>= 80 % for `src/main/commands` and `src/shared`)             |
| `npm run test:e2e`  | Playwright against the built app (run `npm run build` first)                        |
| `npm run icons`     | Regenerates every icon, tray frame and installer image from `scripts/gen-icons.mjs` |
| `npm run dist`      | Builds the installer and the portable exe into `release/`                           |

End-to-end tests drive the real app. The voice tests need the offline model once:
`node scripts/fetch-model.mjs --dir node_modules/.cache/beekeeper/models` and use Windows' own
speech synthesizer to create the audio they "speak" into a fake microphone. Run them on an
unlocked desktop (they open real windows and take real screenshots of the screen).

The README screenshots come from the running app: `$env:BEEKEEPER_DOCS = '1'; npm run build;
npx playwright test tests/e2e/docs-screenshots.spec.ts` regenerates `docs/screenshots` on a
neutral wallpaper window, so no personal desktop content is captured.

## Architecture in one minute

```
src/main        Electron main process: windows, tray, hotkeys, IPC handlers, services, commands
src/preload     One tiny contextBridge per window role
src/renderer    One React app per window (assistant, circle, edge-glow, settings, onboarding, worker)
src/shared      Types, zod IPC contracts and pure helpers used by both sides
```

- A **voice command** is a module in `src/main/commands/**` (`defineCommand`): it declares its
  phrases/slots, a scoring `match`, and a `run` that returns UI cards. Services (system, weather,
  timers ...) are injected, so commands are plain, unit-testable TypeScript.
- A **new IPC channel** needs an entry in `src/shared/ipc/channels.ts` (who may call/receive it) and
  `schemas.ts` (zod input/output). `contractIsConsistent()` is tested.
- **Animations** use transforms and opacity, springs from `src/renderer/motion/tokens.ts`, and must
  respect `prefers-reduced-motion`.

## Pull requests

- Keep changes focused; use conventional commits (`feat(circle): ...`, `fix(voice): ...`).
- Add tests for new behaviour. Run `npm run typecheck && npm run lint && npm test` before pushing.
- No secrets, models or binaries in git. Never log API keys.
- Security-sensitive changes (IPC, CSP, process execution) deserve a note in the PR description.
