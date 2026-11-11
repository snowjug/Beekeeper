import { AnimatePresence } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { openMic as openSystemMic } from '@renderer/lib/voice/mic';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import type { VoiceModelState } from '@shared/ipc/types';
import { logFailure, type OnboardingBridge } from './bridge';
import { AmbientBackground } from './components/AmbientBackground';
import { Footer } from './components/Footer';
import { LiveRegion } from './components/LiveRegion';
import { TitleBar } from './components/TitleBar';
import { footerFor, type FooterActionId } from './footer';
import { useActionGuard } from './hooks/useActionGuard';
import { useAnnouncer } from './hooks/useAnnouncer';
import { useAppearance } from './hooks/useAppearance';
import { useHotkeyStatus } from './hooks/useHotkeyStatus';
import { useLatest } from './hooks/useLatest';
import { useMicTest } from './hooks/useMicTest';
import { useSettings } from './hooks/useSettings';
import { useSpeechPacks } from './hooks/useSpeechPacks';
import { useVoiceModel } from './hooks/useVoiceModel';
import { useWakeStatus } from './hooks/useWakeStatus';
import { shouldRunPrimaryOnEnter } from './keys';
import type { OpenMic } from './micOpen';
import { describeModel, modelAnnouncement } from './modelFormat';
import { INITIAL_NAV, navReducer, stepAnnouncement, stepAt } from './navigation';
import { BEST_PACKS, combinePacks, packAnnouncement, type PackProgress } from './packFormat';
import { DoneScreen } from './screens/DoneScreen';
import { HotkeysScreen } from './screens/HotkeysScreen';
import { LanguageVoiceScreen, qualityOf } from './screens/LanguageVoiceScreen';
import { MicrophoneScreen } from './screens/MicrophoneScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { summarizeSetup } from './summary';

const FINISH_ERROR = 'Couldn’t finish setup just now. Please try again.';
const PACKS_SUBJECT = 'Natural voice and recognition';

export interface AppProps {
  bridge: OnboardingBridge;
  /** Microphone opener; the real one unless a test injects a fake. */
  openMic?: OpenMic;
  /** Minimum gap between two footer actions, which absorbs double clicks. */
  actionCooldownMs?: number;
}

/**
 * First-run tour (spec 4.6): Welcome -> Language & voice -> Microphone -> Hotkeys & wake word ->
 * Done. All state (language and voice choice, downloads, mic test, settings) lives here so it
 * survives screen changes and the last screen can summarise it; the screens themselves are
 * presentational.
 */
export function App({ bridge, openMic = openSystemMic, actionCooldownMs = 450 }: AppProps) {
  const reduceMotion = useReduceMotion();
  const appearance = useAppearance(bridge);
  const { announcement, announce } = useAnnouncer();
  const settings = useSettings(bridge);
  const hotkeyStatus = useHotkeyStatus(bridge, settings.hotkeys.assistant, settings.hotkeys.circle);
  const worker = useWakeStatus(bridge);
  const model = useVoiceModel(bridge);
  const packs = useSpeechPacks(bridge, BEST_PACKS);
  const mic = useMicTest({ openMic, deviceId: settings.voice.micDeviceId, announce });
  const [nav, dispatch] = useReducer(navReducer, INITIAL_NAV);
  const [intro, setIntro] = useState(true);
  const [finishError, setFinishError] = useState<string | null>(null);
  const guard = useActionGuard(actionCooldownMs);
  const previousModel = useRef<VoiceModelState | null>(null);
  const previousBest = useRef<PackProgress | null>(null);

  const step = stepAt(nav.index);
  const { start: startMic, stop: stopMic } = mic;
  const { start: startDownload, state: modelState } = model;
  const { start: startPacks, state: packState, paused: packsPaused, started: packsStarted } = packs;
  const modelReady = modelState?.state === 'ready';
  const quality = qualityOf(settings.voice);
  const best = useMemo(
    () => combinePacks(packState, BEST_PACKS, { paused: packsPaused, started: packsStarted }),
    [packState, packsPaused, packsStarted],
  );
  const modelView = useMemo(() => (modelState ? describeModel(modelState) : null), [modelState]);
  const voicePhase = (quality === 'best' ? best : modelView)?.phase ?? null;

  useEffect(() => {
    announce(stepAnnouncement(nav.index));
    if (nav.index > 0) setIntro(false);
  }, [nav.index, announce]);

  // The microphone is only ever open on its own screen.
  useEffect(() => {
    if (step.id !== 'microphone') stopMic();
  }, [step.id, stopMic]);

  useEffect(() => {
    const message = modelState ? modelAnnouncement(previousModel.current, modelState) : null;
    previousModel.current = modelState;
    if (message) announce(message);
  }, [modelState, announce]);

  useEffect(() => {
    const message = best ? packAnnouncement(previousBest.current, best, PACKS_SUBJECT) : null;
    previousBest.current = best;
    if (message) announce(message);
  }, [best, announce]);

  const finish = useCallback(() => {
    stopMic();
    setFinishError(null);
    bridge.invoke('onboarding:finish').catch((error: unknown) => {
      logFailure(bridge, 'onboarding:finish', error);
      setFinishError(FINISH_ERROR);
    });
  }, [bridge, stopMic]);

  const runAction = useCallback(
    (id: FooterActionId) => {
      guard(() => {
        switch (id) {
          case 'next':
            dispatch({ type: 'next' });
            break;
          case 'start-mic':
            startMic();
            break;
          case 'download':
          case 'resume':
          case 'retry-download':
            if (quality === 'best') startPacks();
            else startDownload();
            break;
          case 'finish':
            finish();
            break;
        }
      });
    },
    [guard, startMic, startDownload, startPacks, quality, finish],
  );

  const footer = footerFor({ step: step.id, mic: mic.state, voice: voicePhase });

  // Enter activates the primary action while focus is not on a control of its own.
  const runPrimary = useLatest(() => runAction(footer.primary.id));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!shouldRunPrimaryOnEnter(event)) return;
      event.preventDefault();
      runPrimary.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runPrimary]);

  const screen = (): ReactElement => {
    switch (step.id) {
      case 'welcome':
        return <WelcomeScreen key="welcome" direction={nav.direction} intro={intro} />;
      case 'language':
        return (
          <LanguageVoiceScreen
            key="language"
            direction={nav.direction}
            voice={settings.voice}
            onVoicePref={settings.setVoicePref}
            saveError={settings.error}
            quality={quality}
            download={
              quality === 'best'
                ? {
                    view: best,
                    paused: packsPaused,
                    error: packs.error,
                    onPause: packs.pause,
                    lines: best?.lines,
                  }
                : {
                    view: modelView,
                    paused: model.paused,
                    error: model.error,
                    onPause: model.pause,
                  }
            }
          />
        );
      case 'microphone':
        return (
          <MicrophoneScreen key="microphone" direction={nav.direction} mic={mic} bridge={bridge} />
        );
      case 'hotkeys':
        return (
          <HotkeysScreen
            key="hotkeys"
            direction={nav.direction}
            hotkeys={settings.hotkeys}
            status={hotkeyStatus}
            voice={settings.voice}
            onVoicePref={settings.setVoicePref}
            saveError={settings.error}
            modelReady={modelReady}
            modelDownloading={modelState?.state === 'downloading'}
            worker={worker}
          />
        );
      case 'done':
        return (
          <DoneScreen
            key="done"
            direction={nav.direction}
            hotkeys={settings.hotkeys}
            summary={summarizeSetup({
              mic: mic.outcome,
              language: settings.voice.language,
              quality,
              best,
              model: modelState,
              wakeWord: settings.voice.wakeWord,
            })}
          />
        );
    }
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden text-fg ${
        appearance.material === 'none' ? 'bg-surface-solid' : ''
      }`}
    >
      <AmbientBackground animated={!reduceMotion} />
      <TitleBar stepIndex={nav.index} canSkip={step.id !== 'done'} onSkip={() => guard(finish)} />
      <main className="absolute inset-x-0 top-10 bottom-[80px] z-10">
        <AnimatePresence mode="wait" custom={nav.direction}>
          {screen()}
        </AnimatePresence>
      </main>
      <Footer
        spec={footer}
        error={finishError}
        onAction={runAction}
        onBack={() => guard(() => dispatch({ type: 'back' }))}
      />
      <LiveRegion announcement={announcement} />
    </div>
  );
}
