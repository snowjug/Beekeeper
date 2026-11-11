import { Button } from '@renderer/components/Button';
import { Card } from '@renderer/components/Card';
import { Icon } from '@renderer/components/Icon';
import { ProgressRing } from '@renderer/components/ProgressRing';
import { Notice } from '../components/Notice';
import { ScreenFrame } from '../components/ScreenFrame';
import { SuccessMark } from '../components/SuccessMark';
import type { VoiceModelController } from '../hooks/useVoiceModel';
import { describeModelCopy } from '../modelCopy';
import { describeModel, type ModelView } from '../modelFormat';
import type { Direction } from '../navigation';

const RING_SIZE = 148;

function ringColor(view: ModelView | null): string | undefined {
  if (view?.phase === 'ready') return 'var(--bk-success)';
  if (view?.phase === 'error') return 'var(--bk-danger)';
  return undefined;
}

function RingCenter({ view }: { view: ModelView | null }) {
  if (view?.phase === 'ready') return <SuccessMark size={64} />;
  if (view?.phase === 'error') {
    return (
      <span className="text-danger">
        <Icon name="error" size={44} />
      </span>
    );
  }
  if (!view || view.phase === 'missing') {
    return (
      <span className="text-accent-text">
        <Icon name="download" size={40} />
      </span>
    );
  }
  return (
    <span className="font-display text-[34px] font-semibold text-fg tabular-nums">
      {view.percent}
      <span className="text-[18px] font-medium text-fg-muted">%</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[12px] text-fg-faint">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold text-fg tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

export interface VoiceModelScreenProps {
  direction: Direction;
  model: VoiceModelController;
}

export function VoiceModelScreen({ direction, model }: VoiceModelScreenProps) {
  const view = model.state ? describeModel(model.state) : null;
  const copy = describeModelCopy(view, model.paused);
  const downloading = view?.phase === 'downloading';
  const ringLabel = !view
    ? 'Voice model download'
    : view.phase === 'ready'
      ? 'Voice model ready'
      : `Voice model download, ${view.percent} percent`;

  return (
    <ScreenFrame
      direction={direction}
      title={
        <>
          Get the <span className="bk-brand-text">voice model</span>
        </>
      }
      description={
        view
          ? `Beekeeper recognises your voice right on this PC. It’s a one-time download of about ${view.total}, stored on your PC — after that, voice works with no internet and no keys.`
          : 'Beekeeper recognises your voice right on this PC. It’s a one-time download, stored on your PC — after that, voice works with no internet and no keys.'
      }
    >
      <Card index={1} lift={false} className="mt-6 w-full max-w-[620px] text-left">
        <div className="flex items-center gap-7 p-5">
          <ProgressRing
            value={(view?.percent ?? 0) / 100}
            size={RING_SIZE}
            stroke={10}
            label={ringLabel}
            color={ringColor(view)}
          >
            <RingCenter view={view} />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-fg">{copy.headline}</h2>
            <p className="mt-1 text-[14px] leading-snug text-fg-muted">{copy.detail}</p>
            {view ? (
              <p className="mt-2 text-[12.5px] text-fg-faint">
                {view.name} · {view.received} of {view.total}
              </p>
            ) : null}
            {downloading && view ? (
              <>
                <dl className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label="Speed" value={view.speed} />
                  <Stat label="Time left" value={view.eta} />
                  <Stat label="Attempt" value={view.attempt} />
                </dl>
                {view.message ? (
                  <p className="mt-2 text-[12.5px] text-fg-faint">{view.message}</p>
                ) : null}
                <Button size="sm" className="mt-3" onClick={model.pause}>
                  Pause
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </Card>
      {model.error ? (
        <Notice tone="bad" role="alert" className="mt-3">
          {model.error}
        </Notice>
      ) : null}
    </ScreenFrame>
  );
}
