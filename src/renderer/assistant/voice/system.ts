import type { MutableRefObject } from 'react';
import type { Bridge } from '@shared/ipc/bridge';
import type {
  AssistantShowEvent,
  SpeechState,
  SpeechTokenResult,
  VoiceModelState,
} from '@shared/ipc/types';
import { SPEECH_PACK_IDS, whisperPackFor } from '@shared/speech/packs';
import { resolveEngines, type EngineAvailability } from '@shared/voiceEngines';
import {
  EndpointDetector,
  type EndpointOptions,
  DEFAULT_ENDPOINT_OPTIONS,
} from '@renderer/lib/voice/vad';
import { MIC_ERROR_HELP, MicError, openMic, type MicSession } from '@renderer/lib/voice/mic';
import {
  ModelHost,
  RecognitionSession,
  type RecognitionHandlers,
} from '@renderer/lib/voice/recognizer';
import { WhisperRecognitionSession } from '@renderer/lib/voice/whisperSession';
import { smoothTowards } from '@renderer/motion/math';
import type { EarconKind, VoiceHooks } from '../controller';
import { useAssistantStore } from '../store';
import {
  AzureRecognitionSession,
  AzureSpeaker,
  loadSpeechSdk,
  type Recognition,
  type SpeechSdk,
} from './azure';
import { Earcons } from './earcons';
import { NaturalSpeaker } from './natural';
import { Speaker } from './tts';

export interface VoiceSystem {
  hooks: VoiceHooks;
  /** Smoothed mic level 0..1 for the orb and waveform. */
  levelRef: MutableRefObject<number>;
  toggleListening: () => void;
  dispose: () => void;
}

export interface VoiceSystemDeps {
  bridge: Bridge<'assistant'>;
  submit: (text: string) => Promise<void>;
}

const PTT_SILENCE_MS = 2600;

interface ListeningSession {
  mic: MicSession;
  recognition: Recognition | null;
  /** Which engine hears this utterance: Whisper only returns text once the utterance is over. */
  engine: 'whisper' | 'offline' | 'azure';
  detector: EndpointDetector;
  frame: number;
  lastFrame: number;
  source: AssistantShowEvent['source'];
  ending: boolean;
}

function endpointOptionsFor(pushToTalk: boolean): EndpointOptions {
  return pushToTalk
    ? { ...DEFAULT_ENDPOINT_OPTIONS, silenceMs: PTT_SILENCE_MS }
    : DEFAULT_ENDPOINT_OPTIONS;
}

/**
 * The assistant's voice pipeline: microphone -> VAD + Vosk (offline) -> live transcript -> command,
 * and TTS / earcons on the way out. Only one listening session exists at a time and the microphone
 * (plus the edge glow) is released the moment it ends.
 */
export function createVoiceSystem({ bridge, submit }: VoiceSystemDeps): VoiceSystem {
  const store = useAssistantStore;
  const levelRef: MutableRefObject<number> = { current: 0 };
  const earcons = new Earcons();
  const speaker = new Speaker();
  const azureSpeaker = new AzureSpeaker();
  const naturalSpeaker = new NaturalSpeaker(bridge);
  const models = new ModelHost();
  let active: ListeningSession | null = null;
  let starting = false;
  let progressOff: (() => void) | null = null;

  // What the on-device speech engine has installed (downloaded packs); kept fresh by main.
  let speechState: SpeechState | null = null;
  const speechStateReady: Promise<void> = bridge
    .invoke('speech:status')
    .then((state) => {
      speechState = state;
    })
    .catch(() => undefined);
  const offSpeechState = bridge.on('speech:state', (state) => {
    speechState = state;
  });

  const availability = (voskReady: boolean, azureReady: boolean): EngineAvailability => {
    const settings = store.getState().settings;
    const state = speechState;
    return {
      packs: state ? SPEECH_PACK_IDS.filter((id) => state.packs[id].state === 'ready') : [],
      voskReady,
      azureSpeechConfigured: azureReady,
      elevenLabsConfigured:
        Boolean(settings?.secrets.elevenLabsKey) && Boolean(settings?.voice.elevenLabsVoiceId),
    };
  };

  /** Loads the models in the background so the first sentence does not wait for them. */
  const warmUp = (): void => {
    const settings = store.getState().settings;
    if (!settings || !speechState) return;
    const engines = resolveEngines(settings.voice, availability(false, false));
    const stt = engines.stt === 'whisper';
    const tts = settings.voice.ttsEnabled && engines.tts === 'natural';
    if (stt || tts) void bridge.invoke('speech:preload', { stt, tts }).catch(() => undefined);
  };
  const offShow = bridge.on('assistant:show', () => {
    void speechStateReady.then(warmUp);
  });

  /** SDK + a short-lived token; null (never throws) when Azure Speech cannot be used right now. */
  const prepareAzure = async (): Promise<{ sdk: SpeechSdk; token: SpeechTokenResult } | null> => {
    try {
      const [token, sdk] = await Promise.all([bridge.invoke('ai:speechToken'), loadSpeechSdk()]);
      return token ? { sdk, token } : null;
    } catch {
      return null;
    }
  };

  const earconsEnabled = (): boolean => store.getState().settings?.voice.earcons ?? true;

  const playEarcon = (kind: EarconKind): void => {
    // Timers and alarms must always be audible; UI earcons follow the setting.
    if (kind === 'chime' || earconsEnabled()) earcons.play(kind);
  };

  const setNoticeForMicError = (error: MicError): void => {
    store.getState().setNotice({
      text: MIC_ERROR_HELP[error.kind],
      tone: 'error',
      ...(error.kind === 'denied'
        ? {
            actionLabel: 'Open settings',
            onAction: () => void bridge.invoke('os:openMicSettings'),
          }
        : {}),
    });
  };

  const showDownloadNotice = (state: VoiceModelState): void => {
    const downloading = state.state === 'downloading';
    const percent =
      state.totalBytes > 0 ? Math.round((state.receivedBytes / state.totalBytes) * 100) : 0;
    store.getState().setNotice({
      text: downloading
        ? `Downloading the voice model... ${percent}%`
        : state.state === 'error'
          ? `The voice model download failed. ${state.message ?? ''}`.trim()
          : 'Voice recognition needs a one-time 40 MB model download. It stays on your PC.',
      tone: state.state === 'error' ? 'error' : 'info',
      ...(downloading
        ? {}
        : {
            actionLabel: state.state === 'error' ? 'Retry' : 'Download',
            onAction: () => void startModelDownload(),
          }),
    });
  };

  const startModelDownload = async (): Promise<void> => {
    progressOff?.();
    progressOff = bridge.on('voice:modelProgress', (state) => {
      showDownloadNotice(state);
      if (state.state === 'ready') {
        progressOff?.();
        progressOff = null;
        store.getState().setNotice(null);
        void startListening('api');
      }
    });
    const state = await bridge.invoke('voice:modelEnsure');
    showDownloadNotice(state);
  };

  const whisperPack = () =>
    whisperPackFor(store.getState().settings?.voice.whisperModel ?? 'small');

  const showSpeechDownloadNotice = (state: SpeechState | null): void => {
    const entry = state?.packs[whisperPack()];
    const downloading = entry?.state === 'downloading' || entry?.state === 'verifying';
    const percent =
      entry && entry.totalBytes > 0
        ? Math.round((entry.receivedBytes / entry.totalBytes) * 100)
        : 0;
    const failed = entry?.state === 'error';
    store.getState().setNotice({
      text: downloading
        ? `Downloading the voice recognition model... ${percent}%`
        : failed
          ? `The voice model download failed. ${entry?.message ?? ''}`.trim()
          : 'Voice recognition needs a one-time download (about 375 MB). It runs on this PC and understands Indian English and Hindi. A smaller offline model is available in Settings > Voice.',
      tone: failed ? 'error' : 'info',
      ...(downloading
        ? {}
        : {
            actionLabel: failed ? 'Retry' : 'Download',
            onAction: () => void startSpeechDownload(),
          }),
    });
  };

  const startSpeechDownload = async (): Promise<void> => {
    progressOff?.();
    const pack = whisperPack();
    progressOff = bridge.on('speech:state', (state) => {
      showSpeechDownloadNotice(state);
      if (state.packs[pack].state === 'ready') {
        progressOff?.();
        progressOff = null;
        store.getState().setNotice(null);
        void startListening('api');
      }
    });
    try {
      showSpeechDownloadNotice(await bridge.invoke('speech:ensurePack', { pack }));
    } catch {
      store.getState().setNotice({
        text: 'The voice model could not be downloaded right now. Try again from Settings > Voice.',
        tone: 'error',
      });
    }
  };

  const finish = async (submitText: boolean): Promise<void> => {
    const session = active;
    if (!session || session.ending) return;
    session.ending = true;
    cancelAnimationFrame(session.frame);
    session.mic.stop();
    levelRef.current = 0;

    const state = store.getState();
    state.setListening(false);
    void bridge.invoke('glow:set', { active: false }).catch(() => undefined);
    void bridge.invoke('voice:micActive', { active: false }).catch(() => undefined);
    playEarcon('stop');

    let text = '';
    if (session.recognition) {
      if (!submitText) {
        text = session.recognition.text;
      } else if (session.engine !== 'whisper') {
        text = await session.recognition.finish();
      } else if (session.detector.hasSpeech) {
        // Whisper decodes the finished recording: show the "thinking" orb while it does.
        state.setOrb('thinking');
        text = await session.recognition.finish();
      }
      session.recognition.close();
    }
    active = null;
    models.scheduleRelease();

    const after = store.getState();
    if (submitText && text.trim().length > 0) {
      after.setTranscript({ partial: '', final: text });
      await submit(text);
    } else {
      after.setOrb('idle');
      after.setTranscript({ partial: '', final: '' });
      if (submitText) {
        after.setNotice({ text: "I didn't hear anything. Try again, or type your request." });
      }
    }
  };

  const startListening = async (source: AssistantShowEvent['source']): Promise<void> => {
    if (active || starting) return;
    starting = true;
    try {
      const state = store.getState();
      speaker.cancel();
      azureSpeaker.cancel();
      naturalSpeaker.cancel();
      state.setNotice(null);

      // Azure Speech when the user chose it and it can issue a token; otherwise Whisper or the
      // small offline model, whichever is installed (see resolveEngines).
      const settings = store.getState().settings;
      const wantsAzure = settings?.voice.sttEngine === 'azure' && settings.ai.useAzureSpeech;
      const azure = wantsAzure ? await prepareAzure() : null;
      let fallbackNotice: string | null = null;
      if (wantsAzure && !azure) {
        fallbackNotice = 'Azure Speech is not reachable, so I used on-device recognition.';
      }

      await speechStateReady;
      const status = await bridge.invoke('voice:modelStatus');
      const engines = settings
        ? resolveEngines(settings.voice, availability(status.state === 'ready', azure !== null))
        : null;
      const engine: ListeningSession['engine'] | null =
        engines?.stt === 'azure' && azure
          ? 'azure'
          : engines?.stt === 'whisper'
            ? 'whisper'
            : status.state === 'ready' && status.modelUrl
              ? 'offline'
              : null;

      if (engine === null) {
        // Nothing is installed yet: offer the recommended download (or the legacy small model).
        if (settings?.voice.sttEngine === 'offline') showDownloadNotice(status);
        else showSpeechDownloadNotice(speechState);
        return;
      }
      if (engine === 'whisper') warmUp();

      let mic: MicSession;
      try {
        mic = await openMic(store.getState().settings?.voice.micDeviceId ?? 'default');
      } catch (error) {
        playEarcon('error');
        setNoticeForMicError(
          error instanceof MicError ? error : new MicError('unknown', String(error)),
        );
        return;
      }

      const pushToTalk = store.getState().settings?.voice.pushToTalk ?? false;
      const detector = new EndpointDetector(endpointOptionsFor(pushToTalk));
      const handlers: RecognitionHandlers = {
        onText: (text) => store.getState().setTranscript({ partial: text, final: '' }),
        onError: (message) => {
          store
            .getState()
            .setNotice({ text: `Speech recognition problem: ${message}`, tone: 'error' });
        },
      };
      let recognition: Recognition;
      if (engine === 'azure' && azure) {
        recognition = new AzureRecognitionSession(azure.sdk, azure.token, handlers);
      } else if (engine === 'whisper') {
        recognition = new WhisperRecognitionSession(
          (samples) => bridge.invoke('speech:transcribe', { samples }),
          handlers,
          () => detector.speechDurationMs / 1000,
        );
      } else {
        recognition = new RecognitionSession(models, status.modelUrl ?? '', handlers);
      }
      mic.onSamples((samples, rate) => recognition.feed(samples, rate));

      const session: ListeningSession = {
        mic,
        recognition,
        engine,
        detector,
        frame: 0,
        lastFrame: performance.now(),
        source,
        ending: false,
      };
      active = session;

      const next = store.getState();
      next.setListening(true);
      next.setOrb('listening');
      next.setTranscript({ partial: '', final: '' });
      if (fallbackNotice) next.setNotice({ text: fallbackNotice });
      playEarcon('start');
      void bridge.invoke('glow:set', { active: true }).catch(() => undefined);
      void bridge.invoke('voice:micActive', { active: true }).catch(() => undefined);

      const tick = (now: number): void => {
        if (active !== session || session.ending) return;
        const dtMs = Math.min(100, now - session.lastFrame);
        session.lastFrame = now;
        const rms = session.mic.readLevel();
        // Speech sits around 0.02-0.2 RMS; scale so normal speaking moves the orb well.
        levelRef.current = smoothTowards(
          levelRef.current,
          Math.min(1, rms * 6),
          dtMs / 1000,
          0.04,
          0.2,
        );
        const event = session.detector.push(rms, dtMs);
        if (event === 'speech-end' || event === 'max-duration') {
          void finish(true);
          return;
        }
        if (event === 'no-speech') {
          void finish(true);
          return;
        }
        session.frame = requestAnimationFrame(tick);
      };
      session.frame = requestAnimationFrame(tick);
    } finally {
      starting = false;
    }
  };

  const hooks: VoiceHooks = {
    speak(text) {
      const settings = store.getState().settings;
      const voice = settings?.voice;
      if (!voice?.ttsEnabled) return;
      const { setSpeaking, setOrb, pulseOrb } = store.getState();
      const callbacks = {
        onStart: () => {
          setSpeaking(true);
          setOrb('speaking');
        },
        onBoundary: () => pulseOrb(),
        onEnd: () => {
          setSpeaking(false);
          if (!store.getState().listening) setOrb('idle');
        },
      };
      const speakWithSystemVoice = (): void => {
        void speaker.speak(text, {
          voiceUri: voice.ttsVoiceUri,
          rate: voice.ttsRate,
          ...callbacks,
        });
      };

      const azureReady = Boolean(settings?.ai.useAzureSpeech && settings.secrets.speechKey);
      const engines = resolveEngines(voice, availability(false, azureReady));
      if (engines.tts === 'natural' || engines.tts === 'elevenlabs') {
        // Any problem with the natural voice (model missing, engine busy) falls back to Windows.
        naturalSpeaker.speak(text, callbacks).catch(speakWithSystemVoice);
        return;
      }

      if (engines.tts !== 'azure' || !settings?.ai.useAzureSpeech) {
        speakWithSystemVoice();
        return;
      }
      // Azure neural voice; any problem falls back to the installed Windows voice.
      void prepareAzure().then((azure) => {
        if (!azure) {
          speakWithSystemVoice();
          return;
        }
        try {
          azureSpeaker.speak(azure.sdk, azure.token, text, {
            voice: voice.azureVoice,
            rate: voice.ttsRate,
            ...callbacks,
          });
        } catch {
          speakWithSystemVoice();
        }
      });
    },
    stopSpeaking() {
      speaker.cancel();
      azureSpeaker.cancel();
      naturalSpeaker.cancel();
    },
    startListening,
    stopListening(submitText) {
      void finish(submitText);
    },
    playEarcon,
  };

  return {
    hooks,
    levelRef,
    toggleListening() {
      if (active) void finish(true);
      else void startListening('api');
    },
    dispose() {
      progressOff?.();
      offSpeechState();
      offShow();
      void finish(false);
      speaker.cancel();
      azureSpeaker.cancel();
      void naturalSpeaker.dispose();
      models.release();
      earcons.dispose();
    },
  };
}
