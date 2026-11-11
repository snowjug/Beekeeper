# Security policy

## Supported versions

Only the latest release receives security fixes. Beekeeper updates itself (installer build) or can
be updated by downloading the new portable executable.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

1. Use GitHub's private reporting: **Security > Report a vulnerability** on
   <https://github.com/snowjug/Beekeeper/security/advisories/new>.
2. Include the affected version, steps to reproduce and the impact you expect.

You will get an answer within a few days. Fixes are released as a new version and credited in the
changelog unless you prefer to stay anonymous.

## Security model

Beekeeper is a desktop app that drives local resources (microphone, screen, shell helpers), so its
architecture is built around "renderers cannot do anything the main process has not validated".

- **Process isolation.** Every window has `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` and `webSecurity` on. Preload scripts expose one typed bridge (`window.beekeeper`).
- **Strict Content Security Policy per window**, no `unsafe-eval` in any document (`script-src 'self'
'wasm-unsafe-eval'`). Only the assistant window may talk to Azure Speech endpoints, and only the
  main process talks to Azure OpenAI. One documented exception: the Vosk WebAssembly worker
  (`vosk/vosk-worker.js`) is served with its own CSP that allows `unsafe-eval`, because its
  Emscripten glue uses `new Function`. The worker has no DOM, no network beyond the app origin and
  no nested workers; the documents that start it keep the strict policy.
- **IPC is a closed contract.** Every channel is declared in `src/shared/ipc`, restricted to the
  windows that may call it, checked against the sender's role and top-level app URL, and validated
  with zod in the main process before a handler runs. Unknown channels have no handler.
- **No shell injection.** OS commands run with `execFile`/`spawn` and argument arrays only; the
  PowerShell helpers are bundled scripts that take validated parameters. Apps are launched through
  a whitelist (Start Menu shortcuts and UWP AppUserModelIDs from the machine's own index). ESLint
  forbids `eval`, `new Function` and `child_process.exec`.
- **Navigation is blocked.** Windows cannot navigate away from `beekeeper://app/...` and cannot
  open new windows; external links open in the default browser through `shell.openExternal`, only
  for validated `http(s)` URLs (and `mailto:` built from a validated address).
- **Secrets.** Azure keys are stored with Electron `safeStorage` (Windows DPAPI), never reach a
  renderer (the UI only sees a masked hint) and are redacted from logs. The Speech SDK gets a
  short-lived token minted in the main process.
- **Files.** The custom protocol serves only the bundled renderer, the voice model file and
  in-memory captures; path traversal is rejected. Paths received from the UI are checked against
  Beekeeper-owned folders.
- **Native code.** The only native module is [koffi](https://koffi.dev) (MIT, prebuilt binary), which
  calls `user32`/`gdi32` to take a screenshot in about 40 ms. It is loaded lazily in the main
  process, never from a renderer, and Beekeeper falls back to Electron's `desktopCapturer` if it
  cannot load.
- **Dangerous actions need confirmation.** Shutdown, restart, sleep, empty recycle bin and force
  close always ask first; power actions add a 10 second cancel countdown.
- **Updates** come from GitHub Releases over HTTPS through `electron-updater` (and are disabled for the
  portable build). Releases are **not code signed**, so Windows SmartScreen shows a warning on first
  run ("More info" > "Run anyway"). Verify downloads against the release page.

## Dependencies

Dependencies are pinned through `package-lock.json`. `npm audit` is run before every release; the
result for the current release is recorded in `BUILD_LOG.md`. For 1.0.0 there are no high or
critical findings. The moderate ones are `minimatch` (reached only through the ESLint toolchain,
dev-only) and `uuid` inside `vosk-browser`, whose advisory concerns the `v3`/`v5`/`v6` functions with a
caller-supplied buffer - the recogniser only generates random `v4` message ids.
