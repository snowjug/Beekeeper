import { SystemError } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds and clamps to 0-100. Rejects NaN and infinities instead of guessing. */
export function toPercent(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new SystemError('invalid-argument', `${label} must be a number.`);
  }
  return clamp(Math.round(value), 0, 100);
}
