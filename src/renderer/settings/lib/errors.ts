const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;
const MAX_LENGTH = 240;

/**
 * Electron prefixes a rejected invoke with the channel name. People only need the original
 * sentence; anything empty, huge or unhelpful ("Forbidden") falls back to `fallback`.
 */
export function friendlyError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw
    .replace(REMOTE_PREFIX, '')
    .replace(/^Error:\s*/, '')
    .trim();
  if (message.length === 0 || message.length > MAX_LENGTH || message === 'Forbidden') {
    return fallback;
  }
  return message;
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
