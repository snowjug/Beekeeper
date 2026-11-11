import type { BatteryCard, DefinitionCard, SystemInfoCard } from '@shared/cards';
import { Icon } from '@renderer/components/Icon';
import { formatBytes, formatUptime, percent } from '@renderer/lib/format';
import { CardShell } from './CardShell';

export function BatteryCardView({ card, index }: { card: BatteryCard; index: number }) {
  const level = percent(card.percent ?? 0);
  const low = !card.charging && level <= 20;
  const fill = card.charging ? 'bg-accent' : low ? 'bg-danger' : 'bg-success';
  const status = !card.hasBattery
    ? 'No battery detected'
    : card.charging
      ? 'Charging'
      : card.onAc
        ? 'Plugged in'
        : 'On battery';

  return (
    <CardShell card={card} index={index} icon="battery" title="Battery">
      {card.hasBattery ? (
        <div className="flex items-center gap-4">
          <div
            className="relative h-12 w-24 shrink-0 rounded-[14px] border-2 border-fg-muted/70 p-1"
            role="img"
            aria-label={`${level} percent`}
          >
            <div
              className={`h-full rounded-[9px] ${fill}`}
              style={{ width: `${Math.max(8, level)}%` }}
            />
            {card.charging ? (
              <span className="absolute inset-0 flex items-center justify-center text-accent-contrast">
                <Icon name="bolt" size={22} strokeWidth={2.2} />
              </span>
            ) : null}
            <span className="absolute top-1/2 -right-[9px] h-4 w-1.5 -translate-y-1/2 rounded-r-sm bg-fg-muted/70" />
          </div>
          <div data-selectable="true">
            <p className="font-display text-4xl font-semibold tabular-nums">{level}%</p>
            <p className="text-[14px] text-fg-muted">
              {status}
              {card.minutesRemaining !== undefined && !card.charging
                ? ` - about ${Math.floor(card.minutesRemaining / 60)} h ${card.minutesRemaining % 60} min left`
                : ''}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[15px]">{status}. This PC runs on mains power.</p>
      )}
    </CardShell>
  );
}

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const level = percent(value);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="text-fg-muted tabular-nums">{detail}</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
      >
        <div
          className={`h-full rounded-full ${level > 90 ? 'bg-danger' : 'bk-brand-gradient'}`}
          style={{ width: `${level}%`, transition: 'width 500ms var(--bk-ease)' }}
        />
      </div>
    </div>
  );
}

export function SystemInfoCardView({ card, index }: { card: SystemInfoCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="cpu" title="This PC">
      <div className="space-y-3" data-selectable="true">
        <Meter
          label={`CPU - ${card.cpu.name}`}
          value={card.cpu.usagePercent}
          detail={`${percent(card.cpu.usagePercent)}% of ${card.cpu.cores} threads`}
        />
        <Meter
          label="Memory"
          value={card.memory.usagePercent}
          detail={`${formatBytes(card.memory.usedBytes)} of ${formatBytes(card.memory.totalBytes)}`}
        />
        <Meter
          label={`Disk ${card.disk.drive}`}
          value={card.disk.usagePercent}
          detail={`${formatBytes(card.disk.freeBytes)} free of ${formatBytes(card.disk.totalBytes)}`}
        />
        <p className="text-[13px] text-fg-muted">
          {card.os} - up {formatUptime(card.uptimeSeconds)}
        </p>
      </div>
    </CardShell>
  );
}

export function DefinitionCardView({ card, index }: { card: DefinitionCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="book" title="Dictionary">
      <div data-selectable="true">
        <p className="flex items-baseline gap-3">
          <span className="font-display text-3xl font-semibold tracking-tight">{card.word}</span>
          {card.phonetic ? (
            <span className="text-[15px] text-fg-muted">{card.phonetic}</span>
          ) : null}
        </p>
        <div className="mt-2 space-y-3">
          {card.meanings.slice(0, 3).map((meaning) => (
            <div key={meaning.partOfSpeech}>
              <p className="text-[12px] font-semibold tracking-wide text-accent-text uppercase">
                {meaning.partOfSpeech}
              </p>
              <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-[15px]">
                {meaning.definitions.slice(0, 3).map((definition) => (
                  <li key={definition.definition}>
                    {definition.definition}
                    {definition.example ? (
                      <span className="mt-0.5 block text-[13px] text-fg-muted italic">
                        &ldquo;{definition.example}&rdquo;
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {meaning.synonyms && meaning.synonyms.length > 0 ? (
                <p className="mt-1 text-[13px] text-fg-muted">
                  Synonyms: {meaning.synonyms.slice(0, 5).join(', ')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}
