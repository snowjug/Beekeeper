import { formatBytes } from '@renderer/lib/format';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function fractionOf(received: number, total: number): number {
  return total > 0 ? clamp01(received / total) : 0;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(clamp01(fraction) * 100)}%`;
}

/** 1_800_000 -> "1.7 MB/s"; empty when nothing is moving. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 95 -> "about 1 min 35 s left". Empty when the estimate is unknown. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 5) return 'a few seconds left';
  const total = Math.round(seconds);
  if (total < 60) return `about ${total} s left`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) {
    return rest === 0 ? `about ${minutes} min left` : `about ${minutes} min ${rest} s left`;
  }
  return `about ${Math.floor(minutes / 60)} hr ${minutes % 60} min left`;
}

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** 1 -> "1.0×" for the speaking-rate slider. */
export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}\u00d7`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
