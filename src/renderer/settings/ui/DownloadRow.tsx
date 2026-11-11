import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { StatusPill } from '@renderer/components/forms';
import { useProgressAnnouncement } from '../hooks/useProgressAnnouncement';
import type { ModelSummary } from '../lib/describe';
import { formatPercent } from '../lib/format';
import { ChoiceRow, type ChoiceControl } from './ChoiceRow';
import { ConfirmButton } from './ConfirmButton';
import { InlineNotice } from './InlineNotice';
import { ProgressBar } from './ProgressBar';

const PRIMARY_LABEL = {
  download: 'Download',
  resume: 'Resume download',
  retry: 'Retry',
} as const;

export interface DownloadRowProps {
  title: string;
  description: ReactNode;
  badge?: ReactNode;
  /** Present when the row is one option of a radio group. */
  choice?: ChoiceControl;
  /** Null while the state is still being read. */
  summary: ModelSummary | null;
  /** Set when the state could not be read at all. */
  unavailable?: { message: string; onRetry: () => void } | null;
  /** Names the progress bar and the announcements, e.g. "Whisper accurate". */
  subject: string;
  /** What the main process answered to the last request it refused. */
  refusal?: string | null;
  onDownload: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRemove: () => Promise<void>;
}

/** Runs one async action and tells whether it is still running (to disable the button that started it). */
function useAction(): [boolean, (task: () => Promise<void>) => void] {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback((task: () => Promise<void>): void => {
    setBusy(true);
    void (async () => {
      try {
        await task();
      } finally {
        if (alive.current) setBusy(false);
      }
    })();
  }, []);

  return [busy, run];
}

/** A choice or setting backed by a download: state, live progress and Download / Cancel / Remove. */
export function DownloadRow({
  title,
  description,
  badge,
  choice,
  summary,
  unavailable = null,
  subject,
  refusal = null,
  onDownload,
  onCancel,
  onRemove,
}: DownloadRowProps) {
  const announcement = useProgressAnnouncement(summary, subject);
  const [starting, start] = useAction();
  const [cancelling, cancel] = useAction();

  let status: ReactNode = <StatusPill>Checking...</StatusPill>;
  let detail = 'Checking what is on this PC...';
  if (summary) {
    status = <StatusPill tone={summary.tone}>{summary.label}</StatusPill>;
    detail = summary.detail;
  } else if (unavailable) {
    status = <StatusPill tone="warning">Unavailable</StatusPill>;
    detail = unavailable.message;
  }

  const actions = summary ? (
    <>
      {summary.primary ? (
        <Button
          size="sm"
          variant="primary"
          icon="download"
          disabled={starting}
          onClick={() => start(onDownload)}
        >
          {PRIMARY_LABEL[summary.primary]}
        </Button>
      ) : null}
      {summary.canCancel ? (
        <Button size="sm" disabled={cancelling} onClick={() => cancel(onCancel)}>
          Cancel
        </Button>
      ) : null}
      {summary.canRemove ? (
        <ConfirmButton
          label="Remove"
          confirmLabel="Yes, remove"
          icon="trash-can"
          onConfirm={onRemove}
        />
      ) : null}
    </>
  ) : unavailable ? (
    <Button size="sm" icon="refresh" onClick={unavailable.onRetry}>
      Try again
    </Button>
  ) : null;

  const problem = summary?.error ?? refusal;
  const fraction = summary?.fraction ?? null;
  const hasBody = fraction !== null || Boolean(summary?.note) || Boolean(problem);

  return (
    <ChoiceRow
      title={title}
      description={
        <>
          {description}
          <span className="mt-1 block tabular-nums">{detail}</span>
        </>
      }
      badge={badge}
      status={status}
      choice={choice}
      actions={actions}
      announcement={announcement}
    >
      {hasBody ? (
        <div className="space-y-2">
          {fraction !== null ? (
            <div className="space-y-1.5">
              <ProgressBar value={fraction} label={`${subject} download`} />
              <div className="flex justify-between text-[12px] text-fg-muted">
                <span>{formatPercent(fraction)}</span>
                {summary?.attempt ? <span>{summary.attempt}</span> : null}
              </div>
            </div>
          ) : null}
          {summary?.note ? (
            <p className="text-[12.5px] leading-[18px] text-fg-muted">{summary.note}</p>
          ) : null}
          {problem ? <InlineNotice tone="danger">{problem}</InlineNotice> : null}
        </div>
      ) : null}
    </ChoiceRow>
  );
}
