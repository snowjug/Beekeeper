import type { Announcement } from '../hooks/useAnnouncer';

/** Polite live region: step changes and status updates are spoken, never shown. */
export function LiveRegion({ announcement }: { announcement: Announcement }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={announcement.id}>{announcement.text}</span>
    </div>
  );
}
