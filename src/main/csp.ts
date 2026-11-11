import type { WindowRole } from '@shared/windows';

export interface CspOptions {
  role: WindowRole;
  /** Vite dev server serves the pages: relax script/connect rules enough for HMR. */
  dev: boolean;
}

/** Azure AI Speech endpoints (optional cloud STT/TTS, only reachable from the assistant window). */
const AZURE_SPEECH_CONNECT = [
  'https://*.api.cognitive.microsoft.com',
  'https://*.stt.speech.microsoft.com',
  'wss://*.stt.speech.microsoft.com',
  'https://*.tts.speech.microsoft.com',
  'wss://*.tts.speech.microsoft.com',
  'https://*.cognitiveservices.azure.com',
  'wss://*.voice.speech.microsoft.com',
  'https://*.speech.microsoft.com',
  'wss://*.speech.microsoft.com',
];

/**
 * Strict per-window Content-Security-Policy (spec 6: no unsafe-eval, connect-src only to required
 * APIs). All network access (weather, dictionary, Azure OpenAI) happens in the main process, so
 * renderers only talk to their own origin - except the assistant, which streams audio to Azure Speech
 * when the user opts in.
 */
export function buildCsp({ role, dev }: CspOptions): string {
  const connect = ["'self'", 'blob:'];
  if (role === 'assistant') connect.push(...AZURE_SPEECH_CONNECT);
  if (dev) connect.push('ws://localhost:*', 'http://localhost:*', 'beekeeper://app');

  const script = ["'self'", "'wasm-unsafe-eval'"];
  // Dev only: the Vite dev server inlines scripts and Vosk's blob worker needs `new Function`.
  if (dev) script.push("'unsafe-inline'", "'unsafe-eval'");

  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': script,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...(dev ? ['beekeeper://app'] : [])],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'media-src': ["'self'", 'blob:', 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** Restrictive policy for non-document responses (scripts, workers) served by the app protocol. */
export const ASSET_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";

/**
 * Policy of the Vosk worker script only. Its Emscripten glue builds functions with `new Function`,
 * so this one dedicated worker (no DOM, no network beyond the app origin, no nested workers) is
 * allowed `unsafe-eval`; every document keeps a policy without it.
 */
export const VOSK_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'";
