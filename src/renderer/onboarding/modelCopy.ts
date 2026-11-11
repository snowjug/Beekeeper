import type { ModelView } from './modelFormat';

export interface ModelCopy {
  headline: string;
  detail: string;
}

/** Server messages are short fragments ("No internet connection"); make them proper sentences. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Headline and explanation for the voice-model card (`paused` = the user pressed Pause). */
export function describeModelCopy(view: ModelView | null, paused: boolean): ModelCopy {
  if (!view) return { headline: 'Checking the voice model…', detail: 'One moment.' };
  switch (view.phase) {
    case 'missing':
      return {
        headline: 'Not downloaded yet',
        detail: 'Download it now, or skip — you can always type your commands instead.',
      };
    case 'partial':
      return {
        headline: paused ? 'Paused' : 'Download not finished',
        detail: `${view.percent}% is already on your PC. Resume to pick up where it stopped.`,
      };
    case 'downloading':
      return {
        headline: 'Downloading…',
        detail: 'You can continue — the download keeps going in the background.',
      };
    case 'verifying':
      return {
        headline: 'Checking the download…',
        detail: 'Making sure the file is complete and unmodified.',
      };
    case 'ready':
      return {
        headline: 'Voice model ready',
        detail: 'Voice commands now work offline — no internet or keys needed.',
      };
    case 'error':
      return {
        headline: 'The download didn’t finish',
        detail: `${view.message ? `${sentence(view.message)} ` : ''}Your progress is kept — Retry continues where it stopped.`,
      };
  }
}
