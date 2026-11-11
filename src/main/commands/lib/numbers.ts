import { formatNumber, findNumber } from '../text';
import type { NumberMatch } from '../text';

/**
 * findNumber (text.ts) looks words up in plain objects, so Object.prototype names such as
 * "constructor" would be read as numbers. Those tokens are masked before the lookup.
 */
export function findNumberSafe(tokens: readonly string[], from = 0): NumberMatch | null {
  return findNumber(
    tokens.map((token) => (token in Object.prototype ? '?' : token)),
    from,
  );
}

/**
 * Formats a result without float noise: up to `fractionDigits` decimals (more for numbers
 * below 1 so they keep their significant digits) and exponent notation at the extremes.
 */
export function formatValue(value: number, fractionDigits = 6): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-9) {
    return value
      .toExponential(6)
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  }
  const extra = magnitude < 1 ? Math.max(0, -Math.floor(Math.log10(magnitude)) - 1) : 0;
  return formatNumber(value, Math.min(12, fractionDigits + extra));
}
