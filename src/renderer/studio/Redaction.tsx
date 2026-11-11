import { Icon } from '@renderer/components/Icon';
import { activeBoxes } from './edit/redaction';
import { useController, useStudio } from './context';

/** Replaces the pills while Photo assist looks for, or lets the user review, sensitive areas. */
export function RedactionBar() {
  const controller = useController();
  const redaction = useStudio((state) => state.redaction);
  const selected = activeBoxes(redaction.boxes).length;
  const working = redaction.status === 'loading' || redaction.status === 'applying';

  return (
    <div
      className="bk-glass flex min-h-10 items-center justify-between gap-3 rounded-full py-1 pr-1.5 pl-4"
      data-testid="redaction-bar"
    >
      <p className="flex items-center gap-2 text-[14px] font-semibold" role="status">
        <span className={`text-accent-text ${working ? 'animate-spin' : ''}`}>
          <Icon name={working ? 'refresh' : 'shield'} size={18} />
        </span>
        {redaction.status === 'loading'
          ? 'Looking for sensitive info…'
          : redaction.status === 'applying'
            ? 'Hiding sensitive info…'
            : `${redaction.boxes.length} sensitive ${redaction.boxes.length === 1 ? 'area' : 'areas'} found`}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="h-8 rounded-full px-3.5 text-[13px] font-semibold text-fg-muted hover:bg-raised-hover hover:text-fg"
          onClick={() => controller.cancelRedaction()}
        >
          Cancel
        </button>
        {redaction.status === 'review' ? (
          <button
            type="button"
            data-testid="redaction-apply"
            disabled={selected === 0}
            className="h-8 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-contrast disabled:opacity-50"
            onClick={() => void controller.applyRedaction()}
          >
            {selected === 0 ? 'Nothing selected' : `Blur ${selected}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The boxes over the picture: click one to keep or blur it, ✕ removes it. */
export function RedactionLayer({ scale }: { scale: number }) {
  const controller = useController();
  const redaction = useStudio((state) => state.redaction);
  if (redaction.status === 'idle' || redaction.status === 'loading') return null;

  return (
    <div className="absolute inset-0" data-testid="redaction-layer">
      {redaction.boxes.map((box) => (
        <div
          key={box.id}
          className="absolute"
          data-testid="redaction-box"
          data-active={box.active}
          style={{
            left: box.rect.x * scale,
            top: box.rect.y * scale,
            width: box.rect.width * scale,
            height: box.rect.height * scale,
          }}
        >
          <button
            type="button"
            aria-pressed={box.active}
            aria-label={`${box.label}: ${box.active ? 'will be blurred' : 'will stay visible'}`}
            className={`absolute inset-0 rounded-md border-2 transition-colors duration-[var(--bk-dur-fast)] ${
              box.active
                ? 'border-honey bg-violet/25 backdrop-blur-md'
                : 'border-dashed border-white/70 bg-transparent'
            }`}
            onClick={() => controller.toggleRedaction(box.id)}
          />
          <button
            type="button"
            aria-label={`Remove ${box.label}`}
            className="absolute -top-3 -right-3 grid h-6 w-6 place-items-center rounded-full bg-surface-solid text-fg shadow-soft"
            onClick={() => controller.removeRedaction(box.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
