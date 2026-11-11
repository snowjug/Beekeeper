import { describe, expect, it } from 'vitest';
import {
  AUTO_VOICE_LABEL,
  SAVED_MIC_MISSING_LABEL,
  shapeMicChoices,
  shapeVoiceChoices,
  type DeviceLike,
} from '@renderer/settings/lib/devices';

const input = (deviceId: string, label: string): DeviceLike => ({
  deviceId,
  kind: 'audioinput',
  label,
});

describe('shapeMicChoices', () => {
  const devices: DeviceLike[] = [
    input('default', 'Default - Microphone (Realtek Audio)'),
    input('communications', 'Communications - Microphone (Realtek Audio)'),
    input('abc123', 'Microphone (Realtek Audio)'),
    input('usb9', 'Headset (USB)'),
    { deviceId: 'cam', kind: 'videoinput', label: 'Camera' },
    { deviceId: 'spk', kind: 'audiooutput', label: 'Speakers' },
  ];

  it('lists the system default once with its real name, then every real input', () => {
    const choices = shapeMicChoices(devices, 'default', true);
    expect(choices.options).toEqual([
      { value: 'default', label: 'System default (Microphone (Realtek Audio))' },
      { value: 'abc123', label: 'Microphone (Realtek Audio)' },
      { value: 'usb9', label: 'Headset (USB)' },
    ]);
    expect(choices).toMatchObject({ labelsHidden: false, savedMissing: false, hasInputs: true });
  });

  it('falls back to numbered names and flags hidden labels before permission is granted', () => {
    const choices = shapeMicChoices(
      [input('default', ''), input('abc123', ''), input('usb9', '')],
      'default',
      true,
    );
    expect(choices.labelsHidden).toBe(true);
    expect(choices.options.map((option) => option.label)).toEqual([
      'System default',
      'Microphone 1',
      'Microphone 2',
    ]);
  });

  it('keeps an unplugged saved device visible and says so', () => {
    const choices = shapeMicChoices(devices, 'gone', true);
    expect(choices.savedMissing).toBe(true);
    expect(choices.options.at(-1)).toEqual({ value: 'gone', label: SAVED_MIC_MISSING_LABEL });
  });

  it('does not call the saved device missing before the first enumeration finished', () => {
    const choices = shapeMicChoices([], 'gone', false);
    expect(choices.savedMissing).toBe(false);
    expect(choices.options.at(-1)).toEqual({ value: 'gone', label: 'Saved microphone' });
  });

  it('reports when there is no input at all', () => {
    expect(shapeMicChoices([], 'default', true)).toMatchObject({
      hasInputs: false,
      labelsHidden: false,
    });
  });
});

describe('shapeVoiceChoices', () => {
  const voices = [
    { voiceURI: 'de', name: 'Microsoft Katja', lang: 'de-DE' },
    { voiceURI: 'gb', name: 'Microsoft Hazel', lang: 'en-GB' },
    { voiceURI: 'zira', name: 'Microsoft Zira', lang: 'en-US' },
    { voiceURI: 'david', name: 'Microsoft David', lang: 'en-US' },
  ];

  it('puts automatic first, then en-US, other English and the rest, each sorted by name', () => {
    const { options } = shapeVoiceChoices(voices, '');
    expect(options.map((option) => option.value)).toEqual(['', 'david', 'zira', 'gb', 'de']);
    expect(options[0]?.label).toBe(AUTO_VOICE_LABEL);
  });

  it('selects the saved voice when installed and automatic when it is gone', () => {
    expect(shapeVoiceChoices(voices, 'zira').value).toBe('zira');
    expect(shapeVoiceChoices(voices, 'removed-voice').value).toBe('');
  });

  it('adds the language to voices that share a name', () => {
    const { options } = shapeVoiceChoices(
      [
        { voiceURI: 'a', name: 'Alex', lang: 'en-US' },
        { voiceURI: 'b', name: 'Alex', lang: 'en-GB' },
      ],
      '',
    );
    expect(options.map((option) => option.label)).toEqual([
      AUTO_VOICE_LABEL,
      'Alex (en-US)',
      'Alex (en-GB)',
    ]);
  });
});
