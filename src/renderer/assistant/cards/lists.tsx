import { useEffect, useRef } from 'react';
import type { ConfirmCard, GalleryCard, NotesCard } from '@shared/cards';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { formatRelativeTime } from '@renderer/lib/format';
import { useController } from '../context';
import { CardShell } from './CardShell';

export function NotesCardView({ card, index }: { card: NotesCard; index: number }) {
  return (
    <CardShell card={card} index={index} icon="note" title={card.title}>
      {card.notes.length === 0 ? (
        <p className="text-[15px] text-fg-muted">
          {card.query
            ? `No notes match "${card.query}".`
            : 'You have no notes yet. Say "take a note ...".'}
        </p>
      ) : (
        <ul className="space-y-2" data-selectable="true">
          {card.notes.map((note) => (
            <li key={note.id} className="rounded-control bg-sunken px-3 py-2">
              <p className="text-[15px] break-words">{note.text}</p>
              <p className="mt-0.5 text-[12px] text-fg-faint">
                {formatRelativeTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {card.total > card.notes.length ? (
        <p className="mt-2 text-[12px] text-fg-faint">
          Showing {card.notes.length} of {card.total} notes
        </p>
      ) : null}
    </CardShell>
  );
}

/** "What can you do": every command group with clickable example phrases. */
export function GalleryCardView({ card, index }: { card: GalleryCard; index: number }) {
  const controller = useController();
  return (
    <CardShell card={card} index={index} icon="help" title="What I can do">
      <div className="space-y-4">
        {card.groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-fg-muted uppercase">
              {group.title}
            </h3>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {group.commands.map((command) => {
                const example = command.examples[0];
                return (
                  <li key={command.title}>
                    <button
                      type="button"
                      disabled={!example}
                      onClick={() => example && void controller.submit(example, 'chip')}
                      className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-raised-hover"
                    >
                      <span className="mt-0.5 text-accent-text">
                        <Icon name={command.icon} size={17} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium">{command.title}</span>
                        {example ? (
                          <span className="block truncate text-[12.5px] text-fg-muted">
                            &ldquo;{example}&rdquo;
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </CardShell>
  );
}

/** Risky actions always ask first. Focus starts on "Cancel" so Enter can never confirm by accident. */
export function ConfirmCardView({ card, index }: { card: ConfirmCard; index: number }) {
  const controller = useController();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const icon =
    card.action === 'restart'
      ? 'restart'
      : card.action === 'sleep'
        ? 'sleep'
        : card.action === 'empty-recycle-bin'
          ? 'trash'
          : card.action === 'force-close'
            ? 'close'
            : 'power';

  return (
    <CardShell
      card={card}
      index={index}
      icon={icon}
      title="Please confirm"
      className="ring-1 ring-accent/30"
    >
      <p className="text-lg font-semibold">{card.title}</p>
      {card.detail ? <p className="mt-0.5 text-[14px] text-fg-muted">{card.detail}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          ref={cancel}
          variant="secondary"
          onClick={() => void controller.cancelConfirm(card.confirmId)}
        >
          Cancel
        </Button>
        <Button
          variant={card.danger ? 'danger' : 'primary'}
          onClick={() => void controller.confirm(card.confirmId)}
        >
          {card.confirmLabel}
        </Button>
      </div>
      {card.countdownSeconds ? (
        <p className="mt-2 text-[12px] text-fg-faint">
          You will have {card.countdownSeconds} seconds to cancel after confirming.
        </p>
      ) : null}
    </CardShell>
  );
}
