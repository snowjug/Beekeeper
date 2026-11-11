# Privacy

Beekeeper is **offline by default** and has **no telemetry**. Nothing about you, your voice, your
screen or your usage is collected, and Beekeeper never sends anything to the author.

## What stays on your PC

| Data                             | Where                                    | Notes                                                                                                                        |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Settings                         | `%APPDATA%\Beekeeper\settings.json`      | Plain JSON, validated on load.                                                                                               |
| API keys (optional)              | `%APPDATA%\Beekeeper\secrets.json`       | Encrypted with Windows DPAPI (Electron `safeStorage`); never logged, never sent to a UI.                                     |
| Conversation history (last 200)  | `%APPDATA%\Beekeeper\history.json`       | Can be switched off and cleared in Settings > Privacy.                                                                       |
| Notes, timers and reminders      | `notes.json`, `timers.json` (same place) | Notes can be cleared in Settings > Privacy.                                                                                  |
| Voice model (~40 MB)             | `%APPDATA%\Beekeeper\models`             | Downloaded once, used offline.                                                                                               |
| Logs (5 files x 5 MB)            | `%APPDATA%\Beekeeper\logs`               | Secrets are redacted. "Open logs folder" in Settings > Privacy.                                                              |
| Screenshots for Circle to Search | Memory only                              | Freed when the overlay closes (at the latest after 5 minutes). Saved only if you choose "Save image" (`Pictures\Beekeeper`). |

Your voice is processed **on this PC** by the offline Vosk recognizer. Audio is not recorded to disk.
The microphone is only open while you are talking to Beekeeper, or - if you turn on the optional
"Hey Beekeeper" wake word - while the tray shows the "armed" icon. The wake word listens locally and
forwards audio to the recognizer only while someone is speaking.

## What can use the network

| Feature                 | Service                                                                  | What is sent                                                   | When                              |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------- |
| Weather                 | [Open-Meteo](https://open-meteo.com) (forecast + geocoding)              | The city (or your approximate coordinates), no account, no key | When you ask for the weather      |
| Automatic location      | ipwho.is / geojs.io / ipapi.co (first one that answers)                  | Your IP address, to estimate a city                            | Weather without a city, if "Auto" |
| Dictionary              | [dictionaryapi.dev](https://dictionaryapi.dev)                           | The word                                                       | "define ..."                      |
| Voice model             | GitHub Pages / raw.githubusercontent.com (alphacephei Vosk model mirror) | A plain file download                                          | Once, when you choose to download |
| Web search / translate  | Your default browser (Bing)                                              | What you chose to search for                                   | Search, Translate, Visual Search  |
| Updates                 | GitHub Releases (`electron-updater`)                                     | A version check                                                | At start and every 6 hours        |
| Azure Speech (optional) | Azure AI Speech in the region you configure                              | Your voice (recognition) or the reply text (speech), over TLS  | Only if you enable and configure  |
| Azure OpenAI (optional) | The endpoint you configure                                               | Your question (and the circled image for "Ask about this")     | Only if you enable and configure  |

Everything else - commands, calculator, unit conversion, timers, notes, OCR, the wake word - runs
locally. You can turn updates off in Settings > Updates and never enable the Azure options.

## Your control

- Settings > Privacy: turn history off, clear history, clear notes, open the logs folder.
- Delete `%APPDATA%\Beekeeper` to remove every trace of Beekeeper from your user profile.
- Uninstalling does not touch your data (the installer asks nothing and deletes nothing in `%APPDATA%`).

## Contact

Questions or concerns: open an issue at <https://github.com/snowjug/Beekeeper/issues>.
