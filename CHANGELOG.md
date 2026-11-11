# Changelog

All notable changes to Beekeeper are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-10

First public release.

### Added

- **Assistant bar** (`Ctrl+Shift+Space`): frameless glass bar that springs up on the display under the
  cursor, with text input, suggestion chips, stacked answer cards (copy / pin / open), history
  (Up arrow recall + searchable panel) and an animated orb with idle, listening, thinking, speaking
  and error states.
- **Voice**: offline speech recognition (Vosk) with live partial transcripts, end-of-speech
  detection, earcons, text-to-speech replies, push-to-talk, a screen-edge glow while listening and an
  optional **"Hey Beekeeper" wake word** (off by default, auto-pauses on battery saver).
- **29 voice and text commands**: open/close apps, web search, YouTube, websites, time and date,
  weather (7-day animated card), battery, system info, calculator, unit conversion, dictionary,
  timers, reminders, alarms, notes, "copy that", volume, brightness, screenshot, lock, Windows
  settings pages, recycle bin, shutdown/restart/sleep (always with confirmation and a 10 s cancel
  countdown), dark mode, Circle to Search, help, and cancel.
- **Circle to Search** (`Alt+Shift+C`): frozen, DPI-correct screenshot of the display under the
  cursor, freehand glowing lasso that morphs into a resizable selection, tap-to-select a word,
  offline OCR (Tesseract), smart actions (links, e-mail, phone numbers, dates, math), image search,
  copy/save image and an optional "Ask about this" answer from Azure OpenAI vision.
- **Settings** (General, Voice, Hotkeys with conflict detection, Circle to Search, AI, Privacy,
  Updates, About) with instant, validated persistence and live application.
- **First-run onboarding**: welcome, microphone test, voice-model download, hotkeys and wake word,
  honey confetti.
- **System tray** with animated listening state, light/dark variants and the full menu; single
  instance lock; start with Windows.
- **Optional Azure**: Azure AI Speech (recognition and neural voices) and Azure OpenAI (streaming
  answers and vision), keys stored with Windows DPAPI.
- **Packaging and updates**: NSIS installer and portable executable, `electron-updater` (checks at
  start and every 6 hours, disabled for the portable build), GitHub Actions CI and release workflows.

### Security

- Context isolation, sandboxed renderers, strict per-window CSP, zod-validated IPC, `execFile`
  argument arrays only, blocked navigation and `window.open`, encrypted secrets, redacted logs.

[1.0.0]: https://github.com/snowjug/Beekeeper/releases/tag/v1.0.0
