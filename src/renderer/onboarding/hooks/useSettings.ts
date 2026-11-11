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
  language: SettingsView['voice']['language'];
  sttEngine: SettingsView['voice']['sttEngine'];
  ttsEngine: SettingsView['voice']['ttsEngine'];
  whisperModel: SettingsView['voice']['whisperModel'];
}

export type VoicePrefsPatch = Partial<Omit<VoicePrefs, 'micDeviceId'>>;

/** Same defaults as the settings schema; shown until (or if) the real values cannot be read. */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  micDeviceId: 'default',
  wakeWord: false,
  pushToTalk: false,
  ttsEnabled: true,
  language: 'auto',
  sttEngine: 'whisper',
  ttsEngine: 'natural',
  whisperModel: 'small',
};

const SAVE_ERROR = 'Couldn’t save that setting. Please try again.';

export interface SettingsController {
  voice: VoicePrefs;
  hotkeys: Record<HotkeyId, string>;
  /** Friendly text of the last failed save; cleared by the next one. */
  error: string | null;
  /** Applies voice preferences at once (one save); they roll back (with `error` set) if it fails. */
  setVoicePref: (patch: VoicePrefsPatch) => void;
}

function withoutKeys(patch: VoicePrefsPatch, remove: VoicePrefsPatch): VoicePrefsPatch {
  const next = { ...patch };
  for (const key of Object.keys(remove) as Array<keyof VoicePrefsPatch>) delete next[key];
  return next;
}

function prefsOf(voice: SettingsView['voice']): VoicePrefs {
  return {
    micDeviceId: voice.micDeviceId,
    wakeWord: voice.wakeWord,
    pushToTalk: voice.pushToTalk,
    ttsEnabled: voice.ttsEnabled,
    language: voice.language,
    sttEngine: voice.sttEngine,
    ttsEngine: voice.ttsEngine,
    whisperModel: voice.whisperModel,
  };
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

  const saved = settings ? prefsOf(settings.voice) : DEFAULT_VOICE_PREFS;
  const voice: VoicePrefs = { ...saved, ...pending };
  const hotkeys: Record<HotkeyId, string> = {
    assistant: settings?.hotkeys.assistant ?? DEFAULT_HOTKEYS.assistant,
    circle: settings?.hotkeys.circle ?? DEFAULT_HOTKEYS.circle,
    capture: settings?.hotkeys.capture ?? DEFAULT_HOTKEYS.capture,
    dictation: settings?.hotkeys.dictation ?? DEFAULT_HOTKEYS.dictation,
  };

  return { voice, hotkeys, error, setVoicePref };
}
