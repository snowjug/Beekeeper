import { useCallback, useState } from 'react';

export interface Announcement {
  /** Changes on every announcement so identical messages are spoken again. */
  id: number;
  text: string;
}

export interface Announcer {
  announcement: Announcement;
  announce: (text: string) => void;
}

/** State behind the polite live region that tells screen-reader users what just happened. */
export function useAnnouncer(): Announcer {
  const [announcement, setAnnouncement] = useState<Announcement>({ id: 0, text: '' });
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ id: previous.id + 1, text }));
  }, []);
  return { announcement, announce };
}
