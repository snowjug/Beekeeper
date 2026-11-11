import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Icon, type IconName } from '@renderer/components/Icon';
import { Sheet } from '@renderer/components/Sheet';
import type { Rect } from '@shared/geometry';
import { detectSmartActions, type SmartActionType } from '@shared/smartActions';
import { AnswerMarkdown } from './AnswerMarkdown';
import { useController } from './context';
import { useCircleStore } from './store';

const SMART_ICONS: Record<SmartActionType, IconName> = {
  url: 'link',
  email: 'mail',
  phone: 'phone',
  date: 'calendar',
  math: 'calculator',
};

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 64;

function Thumbnail({ selection }: { selection: Rect }) {
  const controller = useController();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const image = controller.screenshot;
    const context = element?.getContext('2d');
    if (!element || !image || !context) return;
    const scale = image.naturalWidth / Math.max(1, window.innerWidth);
    const fit = Math.min(THUMB_WIDTH / selection.width, THUMB_HEIGHT / selection.height);
    const width = Math.max(1, Math.round(selection.width * fit));
    const height = Math.max(1, Math.round(selection.height * fit));
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      selection.x * scale,
      selection.y * scale,
      selection.width * scale,
      selection.height * scale,
      0,
      0,
      element.width,
      element.height,
    );
  }, [controller, selection]);

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-sunken"
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
    >
      <canvas ref={canvas} aria-hidden />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 py-1" aria-hidden>
      {[92, 76, 58].map((width) => (
        <div
          key={width}
          className="h-3.5 animate-pulse rounded-full bg-fg/10"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: IconName; children: string }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
      <span className="text-accent-text">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  );
}

function TextSection() {
  const controller = useController();
  const ocr = useCircleStore((state) => state.ocr);
  const speaking = useCircleStore((state) => state.speaking);
  const hasText = ocr.status === 'done' && ocr.text !== '';

  return (
    <section className="bk-glass-card rounded-card p-4" aria-label="Extracted text">
      <SectionTitle icon="note">Text in this area</SectionTitle>
      {ocr.status === 'loading' || ocr.status === 'idle' ? <Skeleton /> : null}
      {ocr.status === 'error' ? (
        <div className="flex items-center justify-between gap-3 text-[14px]">
          <span className="text-fg-muted">{ocr.message ?? 'The text could not be read.'}</span>
          <Button size="sm" icon="refresh" onClick={() => controller.retryOcr()}>
            Try again
          </Button>
        </div>
      ) : null}
      {ocr.status === 'done' && !hasText ? (
        <p className="text-[14px] text-fg-muted" data-testid="circle-no-text">
          No text found here. Try a tighter selection around the words, or search the image.
        </p>
      ) : null}
      {hasText ? (
        <p
          data-testid="circle-text"
          data-selectable="true"
          className="max-h-48 overflow-y-auto text-[15px] leading-relaxed whitespace-pre-wrap"
        >
          {ocr.text}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon="copy"
          disabled={!hasText}
          onClick={() => void controller.copyText()}
        >
          Copy
        </Button>
        <Button
          size="sm"
          icon="search"
          disabled={!hasText}
          onClick={() => void controller.openText('search')}
        >
          Search
        </Button>
        <Button
          size="sm"
          icon="translate"
          disabled={!hasText}
          onClick={() => void controller.openText('translate')}
        >
          Translate
        </Button>
        <Button
          size="sm"
          icon="speaker"
          disabled={!hasText}
          aria-pressed={speaking}
          onClick={() => void controller.toggleSpeak()}
        >
          {speaking ? 'Stop' : 'Speak'}
        </Button>
      </div>
    </section>
  );
}

function SmartActionsSection({ text }: { text: string }) {
  const controller = useController();
  const actions = useMemo(() => detectSmartActions(text), [text]);
  if (actions.length === 0) return null;
  return (
    <section className="bk-glass-card rounded-card p-4" aria-label="Smart actions">
      <SectionTitle icon="sparkle">Smart actions</SectionTitle>
      <ul className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <li key={action.id}>
            <Button
              size="sm"
              icon={SMART_ICONS[action.type]}
              title={action.display}
              onClick={() => void controller.runSmartAction(action)}
            >
              <span className="font-semibold">{action.label}</span>
              <span className="max-w-[220px] truncate text-fg-muted">{action.display}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImageSection() {
  const controller = useController();
  return (
    <section className="bk-glass-card rounded-card p-4" aria-label="Image actions">
      <SectionTitle icon="image">This image</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          icon="search"
          onClick={() => void controller.searchImage()}
        >
          Search this image
        </Button>
        <Button size="sm" icon="copy" onClick={() => void controller.copyImage()}>
          Copy image
        </Button>
        <Button size="sm" icon="download" onClick={() => void controller.saveImage()}>
          Save image
        </Button>
      </div>
    </section>
  );
}

function AskSection() {
  const controller = useController();
  const ai = useCircleStore((state) => state.ai);
  const [question, setQuestion] = useState('');
  const streaming = ai.status === 'streaming';

  const submit = (): void => {
    void controller.askAi(question);
    setQuestion('');
  };

  return (
    <section className="bk-glass-card rounded-card p-4" aria-label="Ask about this">
      <SectionTitle icon="sparkle">Ask about this</SectionTitle>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!streaming) submit();
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Question about the selected area"
          placeholder="What is this? (or ask your own question)"
          maxLength={500}
          className="h-9 min-w-0 flex-1 rounded-control border border-line bg-sunken px-3 text-[14px] text-fg placeholder:text-fg-faint"
        />
        {streaming ? (
          <Button size="md" icon="stop" onClick={() => controller.stopAi()}>
            Stop
          </Button>
        ) : (
          <Button size="md" variant="primary" icon="sparkle" type="submit">
            Ask
          </Button>
        )}
      </form>
      {ai.status !== 'idle' ? (
        <div className="mt-3" aria-live="polite">
          {ai.question ? (
            <p className="mb-1 text-[13px] text-fg-muted">&ldquo;{ai.question}&rdquo;</p>
          ) : null}
          {ai.text === '' && streaming ? <Skeleton /> : null}
          {ai.text !== '' ? <AnswerMarkdown text={ai.text} /> : null}
          {ai.status === 'error' ? (
            <p className="text-[14px] text-danger" role="alert">
              {ai.message ?? 'The answer could not be completed.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function announcement(status: string, text: string): string {
  if (status === 'loading') return 'Reading the text in your selection';
  if (status === 'done')
    return text === '' ? 'No text found' : `Found ${text.length} characters of text`;
  if (status === 'error') return 'The text could not be read';
  return '';
}

/** Bottom sheet with the results of a selection: text, smart actions, image actions and Ask AI. */
export function ResultsSheet() {
  const controller = useController();
  const open = useCircleStore((state) => state.sheetOpen);
  const selection = useCircleStore((state) => state.selection);
  const ocr = useCircleStore((state) => state.ocr);
  const aiAvailable = useCircleStore((state) => state.session?.aiAvailable ?? false);

  return (
    <>
      <Sheet
        open={open && selection !== null}
        onClose={() => controller.closeSheet()}
        label="Circle to Search results"
        collapsedRatio={0.42}
        header={
          selection ? (
            <div className="flex items-center gap-3">
              <Thumbnail selection={selection} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">Selected area</p>
                <p className="text-[12.5px] text-fg-muted">
                  {Math.round(selection.width)} &times; {Math.round(selection.height)} px
                </p>
              </div>
            </div>
          ) : null
        }
      >
        <div data-testid="circle-results" className="flex flex-col gap-3">
          <TextSection />
          <SmartActionsSection text={ocr.text} />
          <ImageSection />
          {aiAvailable ? <AskSection /> : null}
        </div>
      </Sheet>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement(ocr.status, ocr.text)}
      </div>
    </>
  );
}
