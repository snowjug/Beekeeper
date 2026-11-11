import type { SelectOption } from '@renderer/components/forms';

export interface DeviceLike {
  deviceId: string;
  kind: string;
  label: string;
}

export interface MicChoices {
  options: SelectOption[];
  /** True when the browser hides device names until microphone permission was granted. */
  labelsHidden: boolean;
  /** The saved device is not plugged in (so the saved choice is shown as unavailable). */
  savedMissing: boolean;
  hasInputs: boolean;
}

export const SAVED_MIC_MISSING_LABEL = 'Saved microphone (not connected)';

/** Windows exposes the default device twice ("Default - X"); show the real name once. */
function cleanDefaultName(label: string): string {
  return label.replace(/^default\s*-\s*/i, '').trim();
}

/**
 * Shapes `enumerateDevices()` output into select options: "System default" (value `default`),
 * every real input, and the saved choice when it is currently unplugged.
 */
export function shapeMicChoices(
  devices: readonly DeviceLike[],
  savedId: string,
  loaded: boolean,
): MicChoices {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const real = inputs.filter(
    (device) => device.deviceId !== 'default' && device.deviceId !== 'communications',
  );
  const systemDefault = inputs.find((device) => device.deviceId === 'default');
  const defaultName = systemDefault ? cleanDefaultName(systemDefault.label) : '';
  const labelsHidden = inputs.length > 0 && inputs.every((device) => device.label === '');

  const options: SelectOption[] = [
    {
      value: 'default',
      label: defaultName ? `System default (${defaultName})` : 'System default',
    },
    ...real.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    })),
  ];

  const savedMissing =
    loaded && savedId !== 'default' && !real.some((device) => device.deviceId === savedId);
  if (savedId !== 'default' && (!loaded || savedMissing)) {
    options.push({ value: savedId, label: loaded ? SAVED_MIC_MISSING_LABEL : 'Saved microphone' });
  }
  return { options, labelsHidden, savedMissing, hasInputs: inputs.length > 0 };
}

export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface VoiceChoices {
  options: SelectOption[];
  /** Value to show: the saved voice when installed, otherwise "automatic" (empty string). */
  value: string;
}

export const AUTO_VOICE_LABEL = 'Automatic (best English voice)';

function languageRank(lang: string): number {
  const lower = lang.toLowerCase();
  if (lower.startsWith('en-us')) return 0;
  if (lower.startsWith('en')) return 1;
  return 2;
}

export function shapeVoiceChoices(voices: readonly VoiceLike[], savedUri: string): VoiceChoices {
  const sorted = [...voices].sort(
    (a, b) =>
      languageRank(a.lang) - languageRank(b.lang) ||
      a.name.localeCompare(b.name, 'en') ||
      a.lang.localeCompare(b.lang, 'en'),
  );
  const nameCount = new Map<string, number>();
  for (const voice of sorted) nameCount.set(voice.name, (nameCount.get(voice.name) ?? 0) + 1);

  const options: SelectOption[] = [
    { value: '', label: AUTO_VOICE_LABEL },
    ...sorted.map((voice) => ({
      value: voice.voiceURI,
      label: (nameCount.get(voice.name) ?? 0) > 1 ? `${voice.name} (${voice.lang})` : voice.name,
    })),
  ];
  const installed = sorted.some((voice) => voice.voiceURI === savedUri);
  return { options, value: installed ? savedUri : '' };
}
