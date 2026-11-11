/**
 * Secret redaction used by the logger (spec 6: "keys never logged, redact in logger").
 * Pure so it can be unit-tested; main wires it into electron-log hooks.
 */

const REDACTED = '[redacted]';

const SENSITIVE_KEY = /key|token|secret|password|passwd|authorization|credential|subscription/i;

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const KEY_VALUE =
  /\b(api[-_]?key|apikey|subscription[-_]?key|ocp-apim-subscription-key|access[-_]?token|secret|password)\s*[=:]\s*["']?[^\s"',;&]{6,}["']?/gi;
const OPENAI_STYLE = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const ACCOUNT_KEY = /AccountKey=[A-Za-z0-9+/=]{20,}/g;
// Azure Cognitive Services keys are 32 hex characters.
const HEX_KEY = /\b[a-f0-9]{32}\b/gi;

export function redactString(input: string): string {
  return input
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KEY_VALUE, (_match, name: string) => `${name}=${REDACTED}`)
    .replace(OPENAI_STYLE, REDACTED)
    .replace(ACCOUNT_KEY, `AccountKey=${REDACTED}`)
    .replace(HEX_KEY, REDACTED);
}

/** Deeply redacts strings and values stored under sensitive keys. Never mutates the input. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactString(value.stack);
    return copy;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] =
        SENSITIVE_KEY.test(key) && entry !== null && entry !== undefined && entry !== ''
          ? REDACTED
          : redactValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

/** Shows only the last 4 characters of a secret ("••••••••abcd"). */
export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '••••';
  return `${'•'.repeat(8)}${secret.slice(-4)}`;
}
