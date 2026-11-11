import { Button } from '@renderer/components/Button';
import { Sheet } from '@renderer/components/Sheet';
import { useController, useStudio } from './context';

function Skeleton() {
  return (
    <div className="space-y-2 py-1" aria-hidden data-testid="studio-text-loading">
      {[94, 80, 62].map((width) => (
        <div
          key={width}
          className="h-3.5 animate-pulse rounded-full bg-fg/10"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

/** The text Photo assist found in the screenshot, with Copy, Search web and Read aloud. */
export function AssistSheet() {
  const controller = useController();
  const sheet = useStudio((state) => state.sheet);
  const hasText = sheet.status === 'done' && sheet.text !== '';

  return (
    <Sheet
      open={sheet.open}
      onClose={() => controller.closeSheet()}
      label="Text in this screenshot"
      collapsedRatio={0.4}
      header={
        <div>
          <p className="text-[15px] font-semibold">Text in this screenshot</p>
          {hasText ? (
            <p className="text-[12.5px] text-fg-muted">{sheet.text.length} characters</p>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="studio-sheet">
        {sheet.status === 'loading' ? <Skeleton /> : null}
        {sheet.status === 'error' ? (
          <div className="flex items-center justify-between gap-3 text-[14px]" role="alert">
            <span className="text-fg-muted">{sheet.message}</span>
            <Button size="sm" icon="refresh" onClick={() => void controller.extractText()}>
              Try again
            </Button>
          </div>
        ) : null}
        {sheet.status === 'done' && !hasText ? (
          <p className="text-[14px] text-fg-muted" data-testid="studio-no-text">
            {sheet.message || 'No text found in this screenshot.'}
          </p>
        ) : null}
        {hasText ? (
          <p
            data-testid="studio-text"
            data-selectable="true"
            className="max-h-56 overflow-y-auto text-[15px] leading-relaxed whitespace-pre-wrap"
          >
            {sheet.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
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
            onClick={() => void controller.searchText()}
          >
            Search web
          </Button>
          {sheet.readAloud === 'available' ? (
            <Button
              size="sm"
              icon="speaker"
              disabled={!hasText}
              aria-pressed={sheet.speaking}
              onClick={() => void controller.toggleReadAloud()}
            >
              {sheet.speaking ? 'Stop' : 'Read aloud'}
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
