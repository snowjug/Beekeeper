# Privacy

Beekeeper is **offline by default** and has **no telemetry**. Nothing about you, your voice, your
screen or your usage is collected, and Beekeeper never sends anything to the author.

## What stays on your PC

| Data                             | Where                                    | Notes                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings                         | `%APPDATA%\Beekeeper\settings.json`      | Plain JSON, validated on load.                                                                                                                                                                                                              |
| API keys (optional)              | `%APPDATA%\Beekeeper\secrets.json`       | Encrypted with Windows DPAPI (Electron `safeStorage`); never logged, never sent to a UI.                                                                                                                                                    |
| Conversation history (last 200)  | `%APPDATA%\Beekeeper\history.json`       | Can be switched off and cleared in Settings > Privacy.                                                                                                                                                                                      |
| Notes, timers and reminders      | `notes.json`, `timers.json` (same place) | Notes can be cleared in Settings > Privacy.                                                                                                                                                                                                 |
| Speech models                    | `%APPDATA%\Beekeeper\models\speech`      | Natural voice (~129 MB) and Whisper (~160-375 MB), plus the optional ~40 MB Vosk model. Downloaded once, used offline.                                                                                                                      |
| Logs (5 files x 5 MB)            | `%APPDATA%\Beekeeper\logs`               | Secrets are redacted; recognised text and dictation are never logged. "Open logs folder" in Settings > Privacy.                                                                                                                             |
| Screenshots for Circle to Search | Memory only                              | Freed when the overlay closes (at the latest after 5 minutes). Saved only if you choose "Save image" (`Pictures\Beekeeper`).                                                                                                                |
| Capture Studio screenshots       | Memory, then `Pictures\Beekeeper`        | Saved automatically unless you turn "Save automatically" off in Settings > Capture Studio (the folder can be changed). A capture stays in memory for at most 8 hours; a pinned screenshot for at most 30 days (or until you close the pin). |
| Wallpaper pictures               | `%APPDATA%\Beekeeper\wallpaper`          | "Set as wallpaper" keeps the picture here because Windows keeps reading the file; the last three are kept, older ones are deleted.                                                                                                          |

Your voice is processed **on this PC** by the on-device Whisper recognizer (or the small Vosk model if you chose it), and
replies are spoken by the on-device voice. Audio is not recorded to disk, and neither recognised text from dictation nor
the transcripts of your requests are logged. The microphone is only open while you are talking to Beekeeper or dictating,
or - if you turn on the optional "Hey Beekeeper" wake word - while the tray shows the "armed" icon. The wake word listens
locally and forwards audio to the recognizer only while someone is speaking. The speech models are loaded into memory
only while you use them and are released after three idle minutes.

## What can use the network

| Feature                 | Service                                                                  | What is sent                                                   | When                              |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------- |
| Weather                 | [Open-Meteo](https://open-meteo.com) (forecast + geocoding)              | The city (or your approximate coordinates), no account, no key | When you ask for the weather      |
| Automatic location      | ipwho.is / geojs.io / ipapi.co (first one that answers)                  | Your IP address, to estimate a city                            | Weather without a city, if "Auto" |
| Dictionary              | [dictionaryapi.dev](https://dictionaryapi.dev)                           | The word                                                       | "define ..."                      |
| Natural voice           | GitHub Releases (`k2-fsa/sherpa-onnx`, a Supertonic 3 package)           | A plain file download, verified with a pinned SHA-256          | Once, when you choose to download |
| Whisper recognition     | Hugging Face (`csukuangfj/sherpa-onnx-whisper-small` / `-base`)          | A plain file download, verified with a pinned SHA-256          | Once, when you choose to download |
| Light voice model       | GitHub Pages / raw.githubusercontent.com (alphacephei Vosk model mirror) | A plain file download                                          | Once, when you choose to download |
| Web search / translate  | Your default browser (Bing)                                              | What you chose to search for                                   | Search, Translate, Visual Search  |
| Updates                 | GitHub Releases (`electron-updater`)                                     | A version check                                                | At start and every 6 hours        |
| Azure Speech (optional) | Azure AI Speech in the region you configure                              | Your voice (recognition) or the reply text (speech), over TLS  | Only if you enable and configure  |
| Azure OpenAI (optional) | The endpoint you configure                                               | Your question (and the circled image for "Ask about this")     | Only if you enable and configure  |
| ElevenLabs (optional)   | `api.elevenlabs.io`                                                      | The text of the replies Beekeeper speaks, with your own key    | Only if you choose that voice     |

Everything else - commands, calculator, unit conversion, timers, notes, OCR, Capture Studio, dictation, speech recognition
and the natural voice, the wake word - runs locally. You can turn updates off in Settings > Updates and never enable the
Azure or ElevenLabs options.

## Your control

- Settings > Privacy: turn history off, clear history, clear notes, open the logs folder.
- Delete `%APPDATA%\Beekeeper` to remove every trace of Beekeeper from your user profile.
- Uninstalling does not touch your data (the installer asks nothing and deletes nothing in `%APPDATA%`).

## Contact

Questions or concerns: open an issue at <https://github.com/snowjug/Beekeeper/issues>.
