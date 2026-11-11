import type { MutableRefObject } from 'react';
import type { Bridge } from '@shared/ipc/bridge';
import type { AssistantShowEvent, SpeechTokenResult, VoiceModelState } from '@shared/ipc/types';
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
  const models = new ModelHost();
  let active: ListeningSession | null = null;
  let starting = false;
  let progressOff: (() => void) | null = null;

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
      text = submitText ? await session.recognition.finish() : session.recognition.text;
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
      state.setNotice(null);

      // Azure Speech when the user chose it and it can issue a token; otherwise the offline model.
      const settings = store.getState().settings;
      const wantsAzure = settings?.voice.sttEngine === 'azure' && settings.ai.useAzureSpeech;
      const azure = wantsAzure ? await prepareAzure() : null;
      let fallbackNotice: string | null = null;
      if (wantsAzure && !azure) {
        fallbackNotice = 'Azure Speech is not reachable, so I used offline recognition.';
      }

      let createRecognition: (handlers: RecognitionHandlers) => Recognition;
      if (azure) {
        createRecognition = (handlers) =>
          new AzureRecognitionSession(azure.sdk, azure.token, handlers);
      } else {
        const status = await bridge.invoke('voice:modelStatus');
        if (status.state !== 'ready' || !status.modelUrl) {
          showDownloadNotice(status);
          return;
        }
        const offlineUrl = status.modelUrl;
        createRecognition = (handlers) => new RecognitionSession(models, offlineUrl, handlers);
      }

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
      const recognition = createRecognition({
        onText: (text) => store.getState().setTranscript({ partial: text, final: '' }),
        onError: (message) => {
          store
            .getState()
            .setNotice({ text: `Speech recognition problem: ${message}`, tone: 'error' });
        },
      });
      mic.onSamples((samples, rate) => recognition.feed(samples, rate));

      const session: ListeningSession = {
        mic,
        recognition,
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

      if (voice.ttsEngine !== 'azure' || !settings?.ai.useAzureSpeech) {
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
      void finish(false);
      speaker.cancel();
      azureSpeaker.cancel();
      models.release();
      earcons.dispose();
    },
  };
}
