import type { Logger } from '@shared/logger';
import type { DictationStart, DictationStatus } from '@shared/ipc/types';
import type { Settings } from '@shared/settings';
import type { SpeechService } from '../speech/types';
import type { ForegroundApi, WindowRef } from '../system/foreground';
import type { InputInjector } from '../system/inputInjector';

export type DictationSource = 'hotkey' | 'tray' | 'voice';

/** Where a dictation is. `finishing` = the result is on the pill and it is about to hide. */
export type DictationState =
  'idle' | 'starting' | 'listening' | 'transcribing' | 'typing' | 'finishing';

export interface DictationFeature {
  /** Starts dictation, or finishes it when it is already listening. */
  toggle(source: DictationSource): void;
  readonly active: boolean;
  /** For diagnostics and automated tests. */
  readonly phase: DictationState;
  dispose(): void;
}

/** The Win32 helpers, loaded on first use (null when the native module cannot be loaded). */
export interface Win32Services {
  foreground: ForegroundApi;
  injector: InputInjector;
}

/** The pill window as the controller sees it. */
export interface DictationPill {
  /** Shows the pill next to `target` without taking the focus; resolves when its page is ready. */
  show(target: WindowRef | null): Promise<void>;
  start(payload: DictationStart): void;
  /** Asks the pill to stop recording (`submit`: hand the audio over first). */
  stop(submit: boolean): void;
  status(status: DictationStatus): void;
  hide(): void;
  /** Closes the window, and with it the microphone. */
  destroy(): void;
}

/** A temporary global Esc shortcut: the pill never has the keyboard focus. */
export interface EscapeKey {
  arm(onPress: () => void): boolean;
  disarm(): void;
}

export interface DictationTimings {
  /** Longest recording. */
  maxSeconds: number;
  /** The pill page must be ready within this time. */
  startMs: number;
  /** Time allowed per phase before the watchdog resets everything. */
  listenMs: number;
  transcribeMs: number;
  typeMs: number;
  /** How long the pill may take to hand over audio after a stop request. */
  stopMs: number;
  /** How long to wait for another app to get the focus back. */
  settleMs: number;
  /** The result stays on the pill this long (the cancelled / message variants likewise). */
  doneMs: number;
  messageMs: number;
  cancelMs: number;
  /** A follow-up dictation into the same window within this time continues the sentence. */
  continueMs: number;
}

export interface DictationControllerDeps {
  logger: Logger;
  settings: () => Settings;
  /** Called at the moment of use: automated tests replace `transcribe` on the live object. */
  speech: Pick<SpeechService, 'transcribe'>;
  services: () => Promise<Win32Services | null>;
  pill: DictationPill;
  escape: EscapeKey;
  /** Windows of Beekeeper itself: dictation never types into them. */
  isOwnWindow: (handle: number) => boolean;
  /** Process id of Beekeeper (the tray menu is a window of this process). */
  ownPid: number;
  /** Takes Beekeeper's own focused window (the assistant bar) out of the way. */
  releaseOwnFocus: () => void;
  stopAssistantListening: () => void;
  setWakePaused: (paused: boolean) => void;
  setMicActive: (active: boolean) => void;
  /** The accelerator that works for dictation right now, null when it is not registered. */
  hotkey: () => string | null;
  theme: () => 'light' | 'dark';
  clipboard: { writeText: (text: string) => Promise<void> };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timings?: Partial<DictationTimings>;
}
