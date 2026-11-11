import type {
  HotkeyStatusEntry,
  UpdateState,
  VoiceModelState,
  WorkerStatus,
} from '@shared/ipc/types';
import type { PillTone } from '@renderer/components/forms';
import { formatBytes } from '@renderer/lib/format';
import { formatEta, formatSpeed, fractionOf } from './format';

export interface ModelSummary {
  tone: PillTone;
  label: string;
  detail: string;
  /** 0..1 while a download exists (partial or running); null otherwise. */
  fraction: number | null;
  downloading: boolean;
  attempt: string | null;
  /** Friendly status text from the downloader (why it is retrying, ...). */
  note: string | null;
  error: string | null;
  primary: 'download' | 'resume' | 'retry' | null;
  canCancel: boolean;
  canRemove: boolean;
}

const NO_ACTIONS = {
  fraction: null,
  downloading: false,
  attempt: null,
  note: null,
  error: null,
  primary: null,
  canCancel: false,
  canRemove: false,
} as const;

/** Turns the voice-model state into the labels and actions the card shows. */
export function describeModel(state: VoiceModelState, fallbackTotal: number): ModelSummary {
  const total = state.totalBytes > 0 ? state.totalBytes : fallbackTotal;
  const fraction = fractionOf(state.receivedBytes, total);
  switch (state.state) {
    case 'missing':
      return {
        ...NO_ACTIONS,
        tone: 'neutral',
        label: 'Not downloaded',
        detail: `About ${formatBytes(total)}. Downloaded once, then speech recognition works offline.`,
        primary: 'download',
      };
    case 'partial':
      return {
        ...NO_ACTIONS,
        tone: 'warning',
        label: 'Partly downloaded',
        detail: `${formatBytes(state.receivedBytes)} of ${formatBytes(total)} saved so far.`,
        fraction,
        primary: 'resume',
        canRemove: true,
      };
    case 'downloading':
      return {
        ...NO_ACTIONS,
        tone: 'info',
        label: 'Downloading',
        detail: [
          `${formatBytes(state.receivedBytes)} of ${formatBytes(total)}`,
          formatSpeed(state.bytesPerSecond),
          formatEta(state.etaSeconds),
        ]
          .filter((part) => part !== '')
          .join(' \u00b7 '),
        fraction,
        downloading: true,
        attempt: state.maxAttempts > 1 ? `Attempt ${state.attempt} of ${state.maxAttempts}` : null,
        note: state.message ?? null,
        canCancel: true,
      };
    case 'ready':
      return {
        ...NO_ACTIONS,
        tone: 'success',
        label: 'Ready',
        detail: `${formatBytes(total)} stored on this PC. Speech recognition works offline.`,
        canRemove: true,
      };
    case 'error':
      return {
        ...NO_ACTIONS,
        tone: 'danger',
        label: 'Download failed',
        detail: 'Nothing was lost: the download resumes where it stopped.',
        error: state.message ?? 'The download did not finish. Check your connection and try again.',
        primary: 'retry',
        canRemove: state.receivedBytes > 0,
      };
  }
}

export interface UpdateSummary {
  tone: PillTone;
  label: string;
  detail: string;
  /** 0..1 while downloading. */
  progress: number | null;
  canCheck: boolean;
  canInstall: boolean;
}

export function describeUpdate(
  state: UpdateState,
  options: { autoUpdate: boolean },
): UpdateSummary {
  const version = state.version ? `version ${state.version}` : 'the new version';
  const base = { progress: null, canCheck: true, canInstall: false } as const;
  switch (state.status) {
    case 'disabled':
      return {
        ...base,
        tone: 'neutral',
        label: 'Updates off',
        detail: state.message ?? 'Updates are turned off for this build.',
        canCheck: false,
      };
    case 'idle':
      return {
        ...base,
        tone: 'neutral',
        label: 'Not checked yet',
        detail: options.autoUpdate
          ? 'Beekeeper checks for updates in the background.'
          : 'Automatic checks are off. Use Check for updates whenever you like.',
      };
    case 'checking':
      return {
        ...base,
        tone: 'info',
        label: 'Checking',
        detail: 'Looking for a newer version...',
        canCheck: false,
      };
    case 'available':
      return {
        ...base,
        tone: 'info',
        label: 'Update available',
        detail: `Beekeeper ${version} is available and starts downloading.`,
        canCheck: false,
      };
    case 'downloading': {
      const percent = Math.min(100, Math.max(0, state.progress ?? 0));
      return {
        ...base,
        tone: 'info',
        label: 'Downloading',
        detail: `Downloading ${version} (${Math.round(percent)}%).`,
        progress: percent / 100,
        canCheck: false,
      };
    }
    case 'ready':
      return {
        ...base,
        tone: 'success',
        label: 'Ready to install',
        detail: `Beekeeper ${version} is downloaded. Restart to finish updating.`,
        canInstall: true,
      };
    case 'none':
      return {
        ...base,
        tone: 'success',
        label: 'Up to date',
        detail: 'You are running the latest version.',
      };
    case 'error':
      return {
        ...base,
        tone: 'danger',
        label: 'Update problem',
        detail: state.message ?? 'Could not check for updates. Are you online?',
      };
  }
}

export interface WakeSummary {
  tone: PillTone;
  label: string;
  detail: string | null;
}

/** Wake-word worker state; null while the worker has not reported yet. */
export function describeWake(status: WorkerStatus | null, enabled: boolean): WakeSummary | null {
  if (!enabled) return { tone: 'neutral', label: 'Off', detail: null };
  if (!status) return null;
  const detail = status.message ?? null;
  switch (status.state) {
    case 'off':
      return { tone: 'neutral', label: 'Off', detail };
    case 'loading':
      return { tone: 'info', label: 'Loading', detail };
    case 'armed':
      return { tone: 'success', label: 'Listening for \u201cHey Beekeeper\u201d', detail };
    case 'paused':
      return { tone: 'warning', label: 'Paused', detail };
    case 'error':
      return { tone: 'danger', label: 'Problem', detail };
  }
}

export interface HotkeySummary {
  tone: PillTone;
  label: string;
  detail: string | null;
}

/** Registration status of one hotkey; null when it is unknown or belongs to an older binding. */
export function describeHotkey(
  entry: HotkeyStatusEntry | undefined,
  configured: string,
): HotkeySummary | null {
  if (!entry || entry.accelerator.toLowerCase() !== configured.toLowerCase()) return null;
  if (entry.registered) return { tone: 'success', label: 'Registered', detail: null };
  return {
    tone: 'danger',
    label: 'Taken by another app',
    detail: entry.error ?? 'Another app is using this shortcut.',
  };
}
