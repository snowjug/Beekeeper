import type { IconName } from '@renderer/components/Icon';
import type { ModelPhase } from './modelFormat';
import type { StepId } from './navigation';
import type { MicTestState } from './types';

export type FooterActionId =
  'next' | 'start-mic' | 'download' | 'resume' | 'retry-download' | 'finish';

export interface FooterAction {
  id: FooterActionId;
  label: string;
  icon?: IconName;
}

/** What the persistent footer offers on the current screen. */
export interface FooterSpec {
  /** The one primary button; Enter activates it while focus is not on a control. */
  primary: FooterAction;
  /** Quiet "Skip for now" next to it, shown while the step still has pending work. */
  skip: FooterAction | null;
  canGoBack: boolean;
}

export interface FooterInput {
  step: StepId;
  mic: MicTestState;
  /** Where the download behind the chosen quality is; null while it is still being read. */
  voice: ModelPhase | null;
}

type Actions = Pick<FooterSpec, 'primary' | 'skip'>;

const CONTINUE: FooterAction = { id: 'next', label: 'Continue' };
const SKIP_FOR_NOW: FooterAction = { id: 'next', label: 'Skip for now' };

function microphoneActions(mic: MicTestState): Actions {
  switch (mic.status) {
    case 'idle':
    case 'requesting':
      return {
        primary: { id: 'start-mic', label: 'Allow & test microphone', icon: 'mic' },
        skip: SKIP_FOR_NOW,
      };
    case 'listening':
    case 'heard':
      return { primary: CONTINUE, skip: null };
    case 'silent':
    case 'error':
      return {
        primary: { id: 'start-mic', label: 'Try again', icon: 'refresh' },
        skip: SKIP_FOR_NOW,
      };
  }
}

/** Downloads keep going in the background, so Continue is offered as soon as one is under way. */
function voiceActions(voice: ModelPhase | null): Actions {
  switch (voice) {
    case 'downloading':
    case 'verifying':
    case 'ready':
      return { primary: CONTINUE, skip: null };
    case 'partial':
      return { primary: { id: 'resume', label: 'Resume', icon: 'download' }, skip: SKIP_FOR_NOW };
    case 'error':
      return {
        primary: { id: 'retry-download', label: 'Retry', icon: 'refresh' },
        skip: SKIP_FOR_NOW,
      };
    case 'missing':
    case null:
      return {
        primary: { id: 'download', label: 'Download', icon: 'download' },
        skip: SKIP_FOR_NOW,
      };
  }
}

export function footerFor({ step, mic, voice }: FooterInput): FooterSpec {
  const canGoBack = step !== 'welcome';
  switch (step) {
    case 'welcome':
      return { primary: { id: 'next', label: 'Get started' }, skip: null, canGoBack };
    case 'language':
      return { ...voiceActions(voice), canGoBack };
    case 'microphone':
      return { ...microphoneActions(mic), canGoBack };
    case 'hotkeys':
      return { primary: CONTINUE, skip: null, canGoBack };
    case 'done':
      return {
        primary: { id: 'finish', label: 'Start using Beekeeper', icon: 'sparkle' },
        skip: null,
        canGoBack,
      };
  }
}
