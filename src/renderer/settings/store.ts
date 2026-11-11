import { createStore, type StoreApi } from 'zustand';
import type {
  AppInfo,
  HotkeyStatus,
  UpdateState,
  VoiceModelState,
  WorkerStatus,
} from '@shared/ipc/types';
import type { SettingsPatch, SettingsView } from '@shared/settings';
import { DEFAULT_SECTION, type SettingsPage } from './lib/nav';
import { applyPatch } from './lib/patch';

export type LoadPhase = 'loading' | 'ready' | 'error';

/** A change the user made that the main process has not confirmed yet. */
export interface InflightPatch {
  id: number;
  patch: SettingsPatch;
}

export interface SettingsState {
  phase: LoadPhase;
  loadError: string | null;
  /** What the main process last confirmed. */
  committed: SettingsView | null;
  inflight: readonly InflightPatch[];
  /** `committed` with every in-flight patch applied on top: what the UI renders (optimistic). */
  view: SettingsView | null;
  info: AppInfo | null;
  hotkeys: HotkeyStatus | null;
  updates: UpdateState;
  model: VoiceModelState | null;
  /** Latest report of the wake-word worker; null until it has reported once. */
  wake: WorkerStatus | null;
  section: SettingsPage;
}

export type SettingsStore = StoreApi<SettingsState>;

export function reconcile(
  committed: SettingsView | null,
  inflight: readonly InflightPatch[],
): SettingsView | null {
  if (committed === null) return null;
  return inflight.reduce((view, entry) => applyPatch(view, entry.patch), committed);
}

export function createSettingsStore(section: SettingsPage = DEFAULT_SECTION): SettingsStore {
  return createStore<SettingsState>()(() => ({
    phase: 'loading',
    loadError: null,
    committed: null,
    inflight: [],
    view: null,
    info: null,
    hotkeys: null,
    updates: { status: 'idle' },
    model: null,
    wake: null,
    section,
  }));
}
