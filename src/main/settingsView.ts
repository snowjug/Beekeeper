import type { SecretsView, Settings, SettingsView } from '@shared/settings';

export interface SecretsSource {
  mask: (name: 'speech' | 'openai') => string | null;
}

/** Settings plus masked key hints: raw secrets never leave the main process. */
export function buildSettingsView(settings: Settings, keys: SecretsSource): SettingsView {
  const secrets: SecretsView = {
    speechKey: keys.mask('speech'),
    openAiKey: keys.mask('openai'),
  };
  return { ...structuredClone(settings), secrets };
}
