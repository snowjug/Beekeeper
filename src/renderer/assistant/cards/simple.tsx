import { motion } from 'framer-motion';
import type {
  AnswerCard,
  CalculationCard,
  ConversionCard,
  ScreenshotCard,
  SearchCard,
  StatusCard,
  TextCard,
  TimeCard,
} from '@shared/cards';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { cardVariants } from '@renderer/motion/variants';
import { useController } from '../context';
import { Markdown } from '../Markdown';
import { CardShell } from './CardShell';

const TONE_STYLES: Record<StatusCard['tone'], string> = {
  neutral: 'bg-raised text-accent-text',
  success: 'bg-success/15 text-success',
  warning: 'bg-accent/15 text-accent-text',
  error: 'bg-danger/15 text-danger',
};

/** Compact result of an action ("Opening Notepad", "Volume 40 percent", errors). */
export function StatusCardView({ card, index }: { card: StatusCard; index: number }) {
  const controller = useController();
  return (
    <motion.div
      layout="position"
      variants={cardVariants}
      custom={index}
      initial="hidden"
      animate="visible"
      exit="exit"
      role={card.tone === 'error' ? 'alert' : undefined}
      className="bk-glass-card flex items-center gap-3 rounded-card px-4 py-3 text-fg"
      data-card-kind="status"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_STYLES[card.tone]}`}
      >
        <Icon name={card.icon} size={19} />
      </span>
      <div className="min-w-0 flex-1" data-selectable="true">
        <p className="text-[15px] font-semibold">{card.title}</p>
        {card.detail ? <p className="mt-0.5 text-[13px] text-fg-muted">{card.detail}</p> : null}
      </div>
      {(card.actions ?? []).map((action) => (
        <Button
          key={`${action.type}-${action.label}`}
          size="sm"
          variant="secondary"
          onClick={() => void controller.runAction(action)}
        >
          {action.label}
        </Button>
      ))}
    </motion.div>
  );
}

export function TextCardView({ card, index }: { card: TextCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="info" title={card.title ?? 'Beekeeper'}>
      <Markdown text={card.markdown} />
    </CardShell>
  );
}

/** Streaming Azure OpenAI answer: markdown grows token by token with a soft caret. */
export function AnswerCardView({ card, index }: { card: AnswerCard; index: number }) {
  const controller = useController();
  return (
    <CardShell
      card={card}
      index={index}
      icon="sparkle"
      title={card.model ? `Answer - ${card.model}` : 'Answer'}
      headerExtra={
        card.streaming ? (
          <Button
            size="sm"
            variant="ghost"
            icon="stop"
            onClick={() => void controller.stopStream(card.id)}
          >
            Stop
          </Button>
        ) : null
      }
    >
      <div aria-live="polite" aria-busy={card.streaming}>
        {card.markdown ? (
          <Markdown text={card.markdown} />
        ) : card.streaming ? (
          <p className="text-sm text-fg-muted">Thinking...</p>
        ) : null}
        {card.streaming ? (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-accent"
          />
        ) : null}
        {card.error ? <p className="mt-2 text-[13px] text-danger">{card.error}</p> : null}
      </div>
    </CardShell>
  );
}

export function TimeCardView({ card, index }: { card: TimeCard; index: number }) {
  const emphasis = (focus: TimeCard['focus']): string =>
    card.focus === focus ? 'text-fg' : 'text-fg-muted';
  return (
    <CardShell
      card={card}
      index={index}
      icon={card.focus === 'time' ? 'clock' : 'calendar'}
      title={card.focus === 'time' ? 'Time' : 'Date'}
    >
      <p
        className={`font-display text-5xl font-semibold tracking-tight tabular-nums ${emphasis('time')}`}
      >
        {card.timeText}
      </p>
      <p className={`mt-1 text-lg ${emphasis('date')}`}>{card.dateText}</p>
      <p className="mt-1 text-[13px] text-fg-faint">{card.zone.replace(/_/g, ' ')}</p>
    </CardShell>
  );
}

export function CalculationCardView({ card, index }: { card: CalculationCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="calculator" title="Calculator">
      <p className="text-[15px] text-fg-muted" data-selectable="true">
        {card.expression}
      </p>
      <p
        className="bk-brand-text mt-1 font-display text-5xl font-semibold tracking-tight tabular-nums"
        data-selectable="true"
      >
        {card.resultText}
      </p>
    </CardShell>
  );
}

export function ConversionCardView({ card, index }: { card: ConversionCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="convert" title={`Convert - ${card.category}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-selectable="true">
        <span className="text-lg text-fg-muted">{card.fromText}</span>
        <Icon name="chevron-right" size={18} className="self-center text-fg-faint" />
        <span className="bk-brand-text font-display text-4xl font-semibold tracking-tight">
          {card.toText}
        </span>
      </div>
    </CardShell>
  );
}

export function SearchCardView({ card, index }: { card: SearchCard; index: number }) {
  const label = { google: 'Google', bing: 'Bing', youtube: 'YouTube', web: 'the web' }[card.engine];
  return (
    <CardShell
      card={card}
      index={index}
      icon={card.engine === 'youtube' ? 'youtube' : 'search'}
      title={card.engine === 'youtube' ? 'YouTube' : 'Web search'}
    >
      <p className="text-[15px]" data-selectable="true">
        Searching {label} for <span className="font-semibold">&ldquo;{card.query}&rdquo;</span>
      </p>
      <p className="mt-1 text-[13px] text-fg-muted">Opened in your default browser.</p>
    </CardShell>
  );
}

export function ScreenshotCardView({ card, index }: { card: ScreenshotCard; index: number }) {
  const name = card.path.split(/[\\/]/).pop() ?? card.path;
  return (
    <CardShell card={card} index={index} icon="screenshot" title="Screenshot saved">
      <p className="text-[15px] font-semibold" data-selectable="true">
        {name}
      </p>
      <p className="mt-0.5 text-[13px] text-fg-muted">
        {card.width} x {card.height} px - saved to Pictures\Beekeeper
      </p>
    </CardShell>
  );
}
