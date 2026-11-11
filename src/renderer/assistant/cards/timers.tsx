import { useEffect, useRef } from 'react';
import type { CountdownCard, TimerCard } from '@shared/cards';
import { Button } from '@renderer/components/Button';
import { ProgressRing, ringCircumference } from '@renderer/components/ProgressRing';
import { formatRemaining } from '@renderer/lib/format';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { useController } from '../context';
import { CardShell } from './CardShell';

const RING_SIZE = 84;
const RING_STROKE = 7;

interface CountdownRingProps {
  startedAt: number;
  endsAt: number;
  running: boolean;
  color?: string;
  label: string;
}

/**
 * Smooth countdown ring: stroke-dashoffset is written straight to the SVG every frame (no React
 * re-renders) and the digits update once per second.
 */
function CountdownRing({ startedAt, endsAt, running, color, label }: CountdownRingProps) {
  const reduceMotion = useReduceMotion();
  const ring = useRef<SVGCircleElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const shown = useRef('');
  const circumference = ringCircumference(RING_SIZE, RING_STROKE);
  const total = Math.max(1, endsAt - startedAt);

  const paint = (): void => {
    const remaining = Math.max(0, endsAt - Date.now());
    const label = formatRemaining(remaining);
    if (text.current && label !== shown.current) {
      shown.current = label;
      text.current.textContent = label;
    }
    ring.current?.setAttribute(
      'stroke-dashoffset',
      String(circumference * (1 - remaining / total)),
    );
  };

  // First paint before the loop starts (and for reduced motion, once per second).
  useEffect(() => {
    paint();
    if (!running || !reduceMotion) return undefined;
    const interval = window.setInterval(paint, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, reduceMotion, startedAt, endsAt]);

  useAnimationLoop(paint, running && !reduceMotion);

  return (
    <ProgressRing
      ref={ring}
      value={running ? 1 : 0}
      size={RING_SIZE}
      stroke={RING_STROKE}
      color={color ?? 'var(--bk-honey)'}
      label={label}
      className="[&_circle:last-of-type]:!transition-none"
    >
      <span ref={text} className="font-display text-lg font-semibold tabular-nums" />
    </ProgressRing>
  );
}

export function TimerCardView({ card, index }: { card: TimerCard; index: number }) {
  const controller = useController();
  const running = card.state === 'running';
  const done = card.state === 'done';
  const title =
    card.timerType === 'alarm' ? 'Alarm' : card.timerType === 'reminder' ? 'Reminder' : 'Timer';

  return (
    <CardShell
      card={card}
      index={index}
      icon={card.timerType === 'timer' ? 'timer' : 'alarm'}
      title={title}
    >
      <div className="flex items-center gap-4">
        {done ? (
          <div className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center">
            <span
              className="bk-pulse-ring absolute inset-0 rounded-full bg-accent/40"
              aria-hidden
            />
            <span className="relative flex h-full w-full items-center justify-center rounded-full bg-accent text-accent-contrast">
              <span className="font-display text-2xl font-bold">0:00</span>
            </span>
          </div>
        ) : (
          <CountdownRing
            startedAt={card.startedAt}
            endsAt={card.endsAt}
            running={running}
            label={`${title} countdown`}
            {...(running ? {} : { color: 'var(--bk-border)' })}
          />
        )}
        <div className="min-w-0 flex-1" data-selectable="true">
          <p className="truncate text-lg font-semibold">{card.label}</p>
          <p className="text-[13px] text-fg-muted">
            {done
              ? title === 'Timer'
                ? "Time's up"
                : `${title} - now`
              : card.state === 'cancelled'
                ? 'Cancelled'
                : `Ends at ${new Date(card.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => void controller.cancelTimer(card)}>
            Cancel
          </Button>
        ) : null}
        {done ? (
          <Button size="sm" variant="primary" onClick={() => void controller.close('command')}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </CardShell>
  );
}

/** Power actions: a 10 second cancellable countdown after the user confirmed. */
export function CountdownCardView({ card, index }: { card: CountdownCard; index: number }) {
  const controller = useController();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <CardShell card={card} index={index} icon="power" title={card.title}>
      <div className="flex items-center gap-4">
        <CountdownRing
          startedAt={card.startedAt}
          endsAt={card.endsAt}
          running
          color="var(--bk-coral)"
          label="Seconds until the action runs"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{card.detail ?? 'Starting soon'}</p>
          <p className="mt-0.5 text-[13px] text-fg-muted">Press Cancel to stop it.</p>
        </div>
        <Button
          ref={cancel}
          variant="primary"
          onClick={() => void controller.cancelConfirm(card.confirmId)}
        >
          Cancel
        </Button>
      </div>
    </CardShell>
  );
}
