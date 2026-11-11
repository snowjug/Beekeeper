import { useEffect, useRef, useState } from 'react';
import { progressAnnouncement } from '../lib/announce';
import type { ModelSummary } from '../lib/describe';

/** Text for a polite live region: what changed in a download, without a message per progress tick. */
export function useProgressAnnouncement(summary: ModelSummary | null, subject: string): string {
  const [text, setText] = useState('');
  const previous = useRef<ModelSummary | null>(null);

  useEffect(() => {
    const message = summary ? progressAnnouncement(previous.current, summary, subject) : null;
    previous.current = summary;
    if (message) setText(message);
  }, [summary, subject]);

  return text;
}
