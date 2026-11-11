import { Button } from '@renderer/components/Button';
import { Card } from '@renderer/components/Card';
import { Icon } from '@renderer/components/Icon';
import { ProgressRing } from '@renderer/components/ProgressRing';
import type { ModelCopy } from '../modelCopy';
import type { ModelPhase, ModelView } from '../modelFormat';
import type { PackLine } from '../packFormat';
import { SuccessMark } from './SuccessMark';

const RING_SIZE = 92;

function ringColor(view: ModelView | null): string | undefined {
  if (view?.phase === 'ready') return 'var(--bk-success)';
  if (view?.phase === 'error') return 'var(--bk-danger)';
  return undefined;
}

function RingCenter({ view }: { view: ModelView | null }) {
  if (view?.phase === 'ready') return <SuccessMark size={44} />;
  if (view?.phase === 'error') {
    return (
      <span className="text-danger">
        <Icon name="error" size={32} />
      </span>
    );
  }
  if (!view || view.phase === 'missing') {
    return (
      <span className="text-accent-text">
        <Icon name="download" size={28} />
      </span>
    );
  }
  return (
    <span className="font-display text-[24px] font-semibold text-fg tabular-nums">
      {view.percent}
      <span className="text-[14px] font-medium text-fg-muted">%</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[12px] text-fg-faint">{label}</dt>
      <dd className="text-[13px] font-semibold text-fg tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

const LINE_LABEL: Record<ModelPhase, string> = {
  missing: 'Not downloaded',
  partial: 'Paused',
  downloading: 'Downloading',
  verifying: 'Checking',
  ready: 'Ready',
  error: 'Failed',
};

function Lines({ lines }: { lines: readonly PackLine[] }) {
  return (
    <ul aria-label="Downloads" className="mt-2 space-y-0.5">
      {lines.map((line) => (
        <li key={line.id} className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span className={line.phase === 'ready' ? 'text-success' : 'text-fg-faint'}>
            <Icon name={line.phase === 'ready' ? 'check' : 'download'} size={14} />
          </span>
          <span className="font-medium text-fg">{line.name}</span>
          <span className="text-fg-faint">{line.size}</span>
          <span className="ml-auto tabular-nums">
            {line.phase === 'downloading' ? `${line.percent}%` : LINE_LABEL[line.phase]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface DownloadCardProps {
  /** Null while the state has not been read. */
  view: ModelView | null;
  copy: ModelCopy;
  /** Accessible name of the progress ring, e.g. "Voice model download". */
  subject: string;
  onPause: () => void;
  /** One line per file set when several are downloaded together. */
  lines?: readonly PackLine[];
}

/** The download card of the "Language & voice" step: progress ring, plain-language state and stats. */
export function DownloadCard({ view, copy, subject, onPause, lines }: DownloadCardProps) {
  const downloading = view?.phase === 'downloading';
  const ringLabel = !view
    ? `${subject} download`
    : view.phase === 'ready'
      ? `${subject} ready`
      : `${subject} download, ${view.percent} percent`;

  return (
    <Card index={3} lift={false} className="mt-3 w-full text-left">
      <div className="flex items-center gap-4 px-4 py-3">
        <ProgressRing
          value={(view?.percent ?? 0) / 100}
          size={RING_SIZE}
          stroke={8}
          label={ringLabel}
          color={ringColor(view)}
        >
          <RingCenter view={view} />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[16px] leading-6 font-semibold text-fg">{copy.headline}</h2>
            {downloading ? (
              <Button size="sm" onClick={onPause}>
                Pause
              </Button>
            ) : null}
          </div>
          <p className="text-[13px] leading-snug text-fg-muted">{copy.detail}</p>
          {view ? (
            <p className="mt-1 text-[12.5px] text-fg-faint">
              {view.name} · {view.received} of {view.total}
            </p>
          ) : null}
          {lines && lines.length > 0 ? <Lines lines={lines} /> : null}
          {downloading && view ? (
            <>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                <Stat label="Speed" value={view.speed} />
                <Stat label="Time left" value={view.eta} />
                {view.attempt ? <Stat label="Attempt" value={view.attempt} /> : null}
              </dl>
              {view.message ? (
                <p className="mt-1 text-[12.5px] text-fg-faint">{view.message}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
