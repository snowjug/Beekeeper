import type { SettingsView } from '@shared/settings';

/** Region and key are saved (what a connection test needs), whether or not the feature is on. */
export function speechFieldsSet(view: SettingsView): boolean {
  return view.ai.speechRegion !== '' && view.secrets.speechKey !== null;
}

/** Azure Speech is usable once it is switched on and its region and key are saved. */
export function speechConfigured(view: SettingsView): boolean {
  return view.ai.useAzureSpeech && speechFieldsSet(view);
}

/** Endpoint, deployment name and key are saved (the API version has a default). */
export function openAiFieldsSet(view: SettingsView): boolean {
  return (
    view.ai.openAiEndpoint !== '' &&
    view.ai.openAiDeployment !== '' &&
    view.secrets.openAiKey !== null
  );
}
