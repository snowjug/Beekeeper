import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  parseStoredSettings,
  SettingsPatchSchema,
  SettingsSchema,
} from '@shared/settings';

describe('defaults', () => {
  it('match the product spec', () => {
    expect(DEFAULT_SETTINGS.voice.wakeWord).toBe(false);
    expect(DEFAULT_SETTINGS.voice.ttsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.voice.pushToTalk).toBe(false);
    expect(DEFAULT_SETTINGS.hotkeys).toEqual({
      assistant: 'Ctrl+Shift+Space',
      circle: 'Alt+Shift+C',
      capture: 'Alt+Shift+S',
      dictation: 'Alt+Shift+D',
    });
    expect(DEFAULT_SETTINGS.general.theme).toBe('system');
    expect(DEFAULT_SETTINGS.general.language).toBe('en-US');
    expect(DEFAULT_SETTINGS.onboarding.completed).toBe(false);
    expect(DEFAULT_SETTINGS.ai.useAzureOpenAi).toBe(false);
    expect(DEFAULT_SETTINGS.ai.useAzureSpeech).toBe(false);
  });

  it('are a complete, valid settings object', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('SettingsPatchSchema', () => {
  it('accepts partial sections', () => {
    const patch = SettingsPatchSchema.parse({
      voice: { ttsRate: 1.5 },
      general: { theme: 'dark' },
    });
    expect(patch).toEqual({ voice: { ttsRate: 1.5 }, general: { theme: 'dark' } });
  });

  it.each([
    [{ voice: { ttsRate: 5 } }],
    [{ general: { theme: 'neon' } }],
    [{ hotkeys: { assistant: 'Ctrl+Shift+Space' } }],
    [{ unknown: {} }],
    [{ ai: { openAiEndpoint: 'http://insecure.example.com' } }],
    [{ ai: { openAiEndpoint: 'not a url' } }],
    [{ ai: { openAiDeployment: 'has spaces' } }],
    [{ general: { weatherLocation: { mode: 'manual', city: 'x'.repeat(200) } } }],
  ])('rejects %j', (patch) => {
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it('accepts a valid Azure configuration', () => {
    const result = SettingsPatchSchema.safeParse({
      ai: {
        openAiEndpoint: 'https://my-resource.openai.azure.com/',
        openAiDeployment: 'gpt-4o-mini',
        speechRegion: 'westeurope',
        useAzureOpenAi: true,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('applySettingsPatch', () => {
  it('merges section by section without touching the original', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      voice: { wakeWord: true },
      general: { weatherLocation: { mode: 'manual', city: 'Paris' } },
    });
    expect(next.voice.wakeWord).toBe(true);
    expect(next.voice.ttsEnabled).toBe(true);
    expect(next.general.weatherLocation).toEqual({ mode: 'manual', city: 'Paris' });
    expect(DEFAULT_SETTINGS.voice.wakeWord).toBe(false);
  });
});

describe('parseStoredSettings', () => {
  it('falls back to defaults for non-objects', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps good sections and resets only the corrupted one', () => {
    const restored = parseStoredSettings({
      voice: { ttsRate: 99 },
      general: { theme: 'dark', startWithWindows: true },
      hotkeys: { assistant: 'Ctrl+Alt+Space', circle: 'Alt+Shift+C' },
    });
    expect(restored.voice).toEqual(DEFAULT_SETTINGS.voice);
    expect(restored.general.theme).toBe('dark');
    expect(restored.general.startWithWindows).toBe(true);
    expect(restored.hotkeys.assistant).toBe('Ctrl+Alt+Space');
  });

  it('fills missing sections and new fields with defaults', () => {
    const restored = parseStoredSettings({ general: { theme: 'light' } });
    expect(restored.general.theme).toBe('light');
    expect(restored.privacy).toEqual(DEFAULT_SETTINGS.privacy);
    expect(restored.updates.autoUpdate).toBe(true);
  });
});
