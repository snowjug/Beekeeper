import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type KeyboardEvent, type MutableRefObject } from 'react';
import { IconButton } from '@renderer/components/Button';
import { Orb } from '@renderer/components/Orb';
import { Waveform } from '@renderer/components/Waveform';
import { spring } from '@renderer/motion/tokens';
import { useController } from './context';
import { useAssistantStore } from './store';
import { Transcript } from './Transcript';

export interface InputBarProps {
  /** Smoothed microphone level driving the orb and waveform. */
  levelRef: MutableRefObject<number>;
  onToggleListening: () => void;
}

/** Orb + text field + mic / history / settings / pin buttons (spec 4.1: text input always available). */
export function InputBar({ levelRef, onToggleListening }: InputBarProps) {
  const controller = useController();
  const input = useAssistantStore((state) => state.input);
  const setInput = useAssistantStore((state) => state.setInput);
  const orb = useAssistantStore((state) => state.orb);
  const pulse = useAssistantStore((state) => state.pulse);
  const listening = useAssistantStore((state) => state.listening);
  const pending = useAssistantStore((state) => state.pending);
  const pinned = useAssistantStore((state) => state.pinned);
  const transcript = useAssistantStore((state) => state.transcript);
  const view = useAssistantStore((state) => state.view);
  const showCount = useAssistantStore((state) => state.showCount);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCount > 0) field.current?.focus();
  }, [showCount]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void controller.submitInput();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void controller.recallPrevious();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      void controller.recallNext();
    }
  };

  return (
    <div className="border-t border-line/70">
      <AnimatePresence initial={false}>
        {listening ? (
          <motion.div
            key="listening"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden px-5 pt-3"
          >
            <Waveform levelRef={levelRef} active={listening} height={44} />
            <div className="min-h-[30px] pt-1 pb-1">
              <Transcript
                partial={transcript.partial}
                final={transcript.final}
                listening={listening}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button
          type="button"
          onClick={onToggleListening}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          className="rounded-full p-1 outline-offset-4"
        >
          <Orb state={orb} size={40} levelRef={levelRef} pulseSignal={pulse} decorative />
        </button>

        <label className="min-w-0 flex-1">
          <span className="sr-only">Ask Beekeeper</span>
          <input
            ref={field}
            value={input}
            onChange={(event) => {
              if (listening) onToggleListening();
              setInput(event.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              listening
                ? 'Listening - or just type'
                : pending
                  ? 'Working on it...'
                  : 'Ask Beekeeper, or press the orb to talk'
            }
            aria-label="Ask Beekeeper"
            autoComplete="off"
            spellCheck={false}
            maxLength={2000}
            className="h-11 w-full bg-transparent text-[17px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </label>

        <IconButton
          icon={listening ? 'stop' : 'mic'}
          label={listening ? 'Stop listening' : 'Start listening'}
          active={listening}
          onClick={onToggleListening}
        />
        <IconButton
          icon="history"
          label="History"
          active={view === 'history'}
          onClick={() =>
            void (view === 'history' ? controller.closeHistory() : controller.openHistory())
          }
        />
        <IconButton
          icon={pinned ? 'pin-filled' : 'pin'}
          label={pinned ? 'Unpin (close when focus is lost)' : 'Keep open'}
          active={pinned}
          aria-pressed={pinned}
          onClick={() => void controller.togglePinned()}
        />
        <IconButton icon="settings" label="Settings" onClick={() => controller.openSettings()} />
      </div>
    </div>
  );
}
