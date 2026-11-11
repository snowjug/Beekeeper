import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, type MutableRefObject } from 'react';
import { parseAccelerator, releasesAccelerator } from '@shared/hotkeys';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { barVariants } from '@renderer/motion/variants';
import { AutoHeight } from './AutoHeight';
import { CardView } from './cards/CardView';
import { useController } from './context';
import { HistoryPanel } from './HistoryPanel';
import { InputBar } from './InputBar';
import { describeCard, useAssistantStore } from './store';
import { Suggestions } from './Suggestions';

export interface AppProps {
  levelRef: MutableRefObject<number>;
  onToggleListening: () => void;
}

const CONTENT_MAX_HEIGHT = 'calc(100vh - 72px - 140px)';

/**
 * Push-to-talk (spec 4.2): when enabled and listening started from the hotkey, letting go of the
 * hotkey sends the utterance. Windows only delivers key-up to the focused window, which the bar is
 * while it is open; the silence timeout remains the fallback if the key was already released.
 */
function usePushToTalk(onRelease: () => void): void {
  const pushToTalk = useAssistantStore((state) => state.settings?.voice.pushToTalk ?? false);
  const accelerator = useAssistantStore((state) => state.settings?.hotkeys.assistant ?? '');
  const listening = useAssistantStore((state) => state.listening);
  const source = useAssistantStore((state) => state.lastShow?.source);

  useEffect(() => {
    if (!pushToTalk || !listening || source !== 'hotkey') return undefined;
    const parsed = parseAccelerator(accelerator);
    if (!parsed) return undefined;
    const onKeyUp = (event: KeyboardEvent): void => {
      if (releasesAccelerator(event, parsed)) onRelease();
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, [pushToTalk, listening, source, accelerator, onRelease]);
}

export function App({ levelRef, onToggleListening }: AppProps) {
  const controller = useController();
  const visible = useAssistantStore((state) => state.visible);
  const view = useAssistantStore((state) => state.view);
  const cards = useAssistantStore((state) => state.cards);
  const listening = useAssistantStore((state) => state.listening);
  const input = useAssistantStore((state) => state.input);
  const notice = useAssistantStore((state) => state.notice);
  const pending = useAssistantStore((state) => state.pending);

  usePushToTalk(onToggleListening);

  // Esc closes everything (back out of History first); it also stops speech and listening.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !visible) return;
      event.preventDefault();
      if (useAssistantStore.getState().view === 'history') controller.closeHistory();
      else void controller.close('escape');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, visible]);

  const announcement = useMemo(() => {
    const latest = cards[cards.length - 1];
    return latest ? describeCard(latest) : '';
  }, [cards]);

  const showSuggestions =
    view === 'home' && cards.length === 0 && !listening && input === '' && !pending;

  return (
    <div
      className="flex h-full items-end justify-center p-9"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) void controller.close('backdrop');
      }}
    >
      <AnimatePresence onExitComplete={() => void controller.acknowledgeHidden()}>
        {visible ? (
          <motion.div
            key="bar"
            role="dialog"
            aria-label="Beekeeper assistant"
            variants={barVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bk-glass flex max-h-full w-full max-w-[720px] origin-bottom flex-col overflow-hidden rounded-bar"
          >
            {view === 'history' ? (
              <div
                className="flex min-h-0 flex-1 flex-col"
                style={{ maxHeight: CONTENT_MAX_HEIGHT }}
              >
                <HistoryPanel />
              </div>
            ) : (
              <AutoHeight
                maxHeight={CONTENT_MAX_HEIGHT}
                followCount={cards.length}
                followSelector="[data-card-kind]"
              >
                <div className="flex flex-col gap-2.5 px-3 pt-3 pb-3 empty:hidden">
                  <AnimatePresence initial={false} mode="popLayout">
                    {cards.map((card, index) => (
                      <CardView key={card.id} card={card} index={index} />
                    ))}
                  </AnimatePresence>
                  {notice ? (
                    <div
                      role="status"
                      className="flex items-center gap-3 rounded-control bg-accent/12 px-3.5 py-2.5 text-[14px]"
                    >
                      <span className="text-accent-text">
                        <Icon name={notice.tone === 'error' ? 'error' : 'info'} size={18} />
                      </span>
                      <span className="flex-1">{notice.text}</span>
                      {notice.actionLabel && notice.onAction ? (
                        <Button size="sm" variant="primary" onClick={notice.onAction}>
                          {notice.actionLabel}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {showSuggestions ? <Suggestions /> : null}
              </AutoHeight>
            )}
            <InputBar levelRef={levelRef} onToggleListening={onToggleListening} />
            <div className="sr-only" role="status" aria-live="polite" aria-atomic>
              {announcement}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
