import type { ModelSummary } from './describe';

const MILESTONES = [75, 50, 25] as const;

function percentOf(summary: ModelSummary): number {
  return Math.floor((summary.fraction ?? 0) * 100);
}

/**
 * What a screen reader should hear when a download changes: state changes and the 25 / 50 / 75 %
 * milestones (never every progress tick). The first snapshot is not announced.
 */
export function progressAnnouncement(
  previous: ModelSummary | null,
  next: ModelSummary,
  subject: string,
): string | null {
  if (!previous) return null;
  if (previous.phase !== next.phase) {
    switch (next.phase) {
      case 'downloading':
        return `Downloading ${subject}.`;
      case 'finishing':
        return `Checking ${subject}.`;
      case 'ready':
        return `${subject} is ready.`;
      case 'partial':
        return `${subject} download paused.`;
      case 'error':
        return next.error
          ? `${subject} download failed. ${next.error}`
          : `${subject} download failed.`;
      case 'missing':
        return null;
    }
  }
  if (next.phase !== 'downloading') return null;
  const before = percentOf(previous);
  const after = percentOf(next);
  const milestone = MILESTONES.find((value) => before < value && after >= value);
  return milestone === undefined ? null : `${subject}: ${milestone} percent downloaded.`;
}
