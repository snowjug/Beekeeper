import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_HOTKEYS } from '@shared/constants';
import type { HotkeyId } from '@shared/ipc/types';
import type { SettingsView } from '@shared/settings';
import { logFailure, type OnboardingBridge } from '../bridge';

export interface VoicePrefs {
  micDeviceId: string;
  wakeWord: boolean;
  pushToTalk: boolean;
  ttsEnabled: boolean;
}

export type VoicePrefsPatch = Partial<Pick<VoicePrefs, 'wakeWord' | 'pushToTalk' | 'ttsEnabled'>>;

/** Same defaults as the settings schema; shown until (or if) the real values cannot be read. */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  micDeviceId: 'default',
  wakeWord: false,
  pushToTalk: false,
  ttsEnabled: true,
};

const SAVE_ERROR = 'Couldn’t save that setting. Please try again.';

export interface SettingsController {
  voice: VoicePrefs;
  hotkeys: Record<HotkeyId, string>;
  /** Friendly text of the last failed save; cleared by the next one. */
  error: string | null;
  /** Applies a voice preference at once; it rolls back (with `error` set) if saving fails. */
  setVoicePref: (patch: VoicePrefsPatch) => void;
}

function withoutKeys(patch: VoicePrefsPatch, remove: VoicePrefsPatch): VoicePrefsPatch {
  const next = { ...patch };
  for (const key of Object.keys(remove) as Array<keyof VoicePrefsPatch>) delete next[key];
  return next;
}

/** Live view of the settings this window shows (voice preferences and hotkeys). */
export function useSettings(bridge: OnboardingBridge): SettingsController {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [pending, setPending] = useState<VoicePrefsPatch>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let changedEvents = 0;
    const off = bridge.on('settings:changed', (view) => {
      changedEvents += 1;
      if (alive) setSettings(view);
    });
    bridge
      .invoke('settings:get')
      .then((view) => {
        if (alive && changedEvents === 0) setSettings(view);
      })
      .catch((failure: unknown) => logFailure(bridge, 'settings:get', failure));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const setVoicePref = useCallback(
    (patch: VoicePrefsPatch) => {
      setPending((current) => ({ ...current, ...patch }));
      setError(null);
      bridge
        .invoke('settings:update', { voice: patch })
        .then((view) => setSettings(view))
        .catch((failure: unknown) => {
          logFailure(bridge, 'settings:update', failure);
          setError(SAVE_ERROR);
        })
        .finally(() => setPending((current) => withoutKeys(current, patch)));
    },
    [bridge],
  );

  const saved = settings?.voice;
  const voice: VoicePrefs = {
    micDeviceId: saved?.micDeviceId ?? DEFAULT_VOICE_PREFS.micDeviceId,
    wakeWord: pending.wakeWord ?? saved?.wakeWord ?? DEFAULT_VOICE_PREFS.wakeWord,
    pushToTalk: pending.pushToTalk ?? saved?.pushToTalk ?? DEFAULT_VOICE_PREFS.pushToTalk,
    ttsEnabled: pending.ttsEnabled ?? saved?.ttsEnabled ?? DEFAULT_VOICE_PREFS.ttsEnabled,
  };
  const hotkeys: Record<HotkeyId, string> = {
    assistant: settings?.hotkeys.assistant ?? DEFAULT_HOTKEYS.assistant,
    circle: settings?.hotkeys.circle ?? DEFAULT_HOTKEYS.circle,
  };

  return { voice, hotkeys, error, setVoicePref };
}
