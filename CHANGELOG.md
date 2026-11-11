# Changelog

All notable changes to Beekeeper are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-11

A Beekeeper that sounds human and understands your accent: an on-device natural voice, Whisper recognition,
Hindi and Hinglish, a new icon and a Samsung-style Capture Studio.

### Added

- **Natural voice.** Replies are spoken by [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) running on
  your PC (sherpa-onnx): ten voices, English and Hindi, speaking speed, sentence-by-sentence streaming so the first
  words start quickly. Windows voices remain as the fallback; ElevenLabs (your own key and voice ID) and Azure
  neural voices stay optional.
- **Whisper recognition** (small or base, on-device) replaces the small Vosk model as the default: Indian-accented
  English, Hindi and Hinglish with automatic language detection. Vosk stays as the light 40 MB option and for the
  wake word.
- **Model packs**: downloaded on demand from the first-run tour or Settings > Voice, resumable, verified against
  pinned SHA-256 sums, loaded when needed and released after three idle minutes (idle memory is unchanged).
- **Hindi and Hinglish commands.** Devanagari, Romanised and mixed sentences are understood by every command
  (410 corpus phrases, spelling-slip replays and 120 negative cases in the tests), and replies come back in Hindi.
- **Capture Studio** (`Alt+Shift+S`, tray, Settings, "take a screenshot"): a glowing gradient frame with corner
  brackets around the capture, **Photo assist** (extract the text, or find and blur sensitive information: e-mail
  addresses, phone, card and ID numbers, one-time codes, keys), **Set as wallpaper**, and a toolbar with **Edit**
  (crop, pen, highlighter, arrow, shapes, text, blur, undo/redo), **Pin to screen**, **Copy**, **Share** (copy as
  file, open with, e-mail, show in folder) and **Save** (`Pictures\Beekeeper` by default).
- **Pinned screenshots**: always-on-top copies you can drag, zoom with the wheel, make see-through with
  `Ctrl` + wheel or the slider, click through, copy, save and close.
- **Dictation anywhere** (`Alt+Shift+D`, or "start dictation"): speak in English, Hindi or both and the text is typed
  into the focused app, with spoken punctuation ("comma", "full stop", "new line", "पूर्ण विराम"), filler removal
  and hallucination filtering. Typing never goes into Beekeeper's own windows or an elevated app (the text is
  copied instead).
- **Daily briefing** ("good morning", "brief me": date, weather, today's reminders and timers, notes) and **repeat**
  ("say that again") commands, with Hindi equivalents.
- **New icon**: a bee in a honeycomb, with new tray glyphs (animated sound waves while listening), installer art
  and banner.
- Settings pages for **Voice** (language, recognition model, ten voices with previews, ElevenLabs), **Capture
  Studio** and **Dictation**; the first-run tour gained a **Language & voice** step.
- Circle to Search **Speak** reads the selection aloud with the natural voice.
- Two more rebindable global hotkeys (`Alt+Shift+S`, `Alt+Shift+D`) and tray entries for both.

### Changed

- New installs default to Whisper and the natural voice; until the packs are downloaded Beekeeper falls back to the
  1.0 engines and offers the download. People upgrading from 1.0 keep the engines they had and get a one-time hint in
  the bar that the new ones exist.
- "Take a screenshot" opens Capture Studio (turn "Open the preview" off in Settings > Capture Studio for the old quiet
  save).
- Brand names that Whisper mishears ("open crow" for Chrome) are recovered through alias phrases.
- The installer grew from 117 MB to 122 MB (the sherpa-onnx runtime); the portable build from 105 MB to 110 MB.

### Security

- Model downloads come from pinned URLs and revisions and are checked against SHA-256 sums before anything is
  extracted or loaded; the speech runtime runs in worker threads the main process owns and terminates.
- Capture Studio actions work only on pictures the session itself created, file paths are validated, and shares use
  `execFile` argument arrays.
- Dictation validates the focused window before typing and never types into protected or Beekeeper windows.

[1.1.0]: https://github.com/snowjug/Beekeeper/releases/tag/v1.1.0

## [1.0.0] - 2026-11-11

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
- **Circle to Search** (`Alt+Shift+C`): frozen, DPI-correct screenshot (taken in about 40 ms through GDI)
  of the display under the
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
