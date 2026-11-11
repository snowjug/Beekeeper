import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, type MutableRefObject } from 'react';
import { IconButton } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { Orb } from '@renderer/components/Orb';
import { Waveform } from '@renderer/components/Waveform';
import { spring } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import type { DictationPhase } from '@shared/ipc/types';
import { describePill, languageBadge, languageName } from './copy';
import { usePillStore } from './store';

export interface PillController {
  levelRef: MutableRefObject<number>;
  /** The microphone button: finish and transcribe. */
  finishNow: () => void;
  /** The close button and Esc. */
  cancel: () => void;
}

interface LeadProps {
  phase: DictationPhase;
  levelRef: MutableRefObject<number>;
  onFinish: () => void;
}

/** The round control on the left: the live microphone while listening, then the outcome. */
function Lead({ phase, levelRef, onFinish }: LeadProps) {
  const base = 'grid h-10 w-10 shrink-0 place-items-center rounded-full';
  switch (phase) {
    case 'listening':
      return (
        <button
          type="button"
          aria-label="Finish dictation"
          title="Finish and type what I said"
          onClick={onFinish}
          className={`${base} border border-line bg-raised transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised-hover`}
        >
          <Orb state="listening" size={28} levelRef={levelRef} decorative />
        </button>
      );
    case 'transcribing':
    case 'typing':
      return (
        <span className={`${base} border border-line bg-raised`} aria-hidden>
          <Orb state="thinking" size={28} decorative />
        </span>
      );
    case 'done':
      return (
        <span className={`${base} bg-success/15 text-success`} aria-hidden>
          <Icon name="check" size={22} strokeWidth={2.2} />
        </span>
      );
    case 'error':
      return (
        <span className={`${base} bg-danger/15 text-danger`} aria-hidden>
          <Icon name="warning" size={20} />
        </span>
      );
    case 'cancelled':
      return (
        <span className={`${base} bg-raised text-fg-muted`} aria-hidden>
          <Icon name="close" size={20} />
        </span>
      );
  }
}

export function Pill({ controller }: { controller: PillController }) {
  const reduceMotion = useReduceMotion();
  const state = usePillStore();
  const copy = describePill(state);
  const listening = state.phase === 'listening';
  const showWave = listening && state.speaking && !reduceMotion;
  const cancellable = listening || state.phase === 'transcribing';

  // The pill never has the keyboard focus (the main process cancels on Esc); this covers a focused one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') controller.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  return (
    <div className="relative h-full w-full">
      <AnimatePresence>
        {state.visible ? (
          <motion.div
            key={state.session}
            data-testid="dictation-pill"
            data-phase={state.phase}
            role="status"
            aria-live="polite"
            className="absolute inset-[10px] flex items-center gap-2.5 rounded-[22px] border border-line bg-surface pr-1.5 pl-2 text-fg shadow-soft backdrop-blur-xl"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={spring.snappy}
          >
            <Lead
              phase={state.phase}
              levelRef={controller.levelRef}
              onFinish={() => controller.finishNow()}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p
                  data-testid="pill-title"
                  className={`text-[14px] leading-5 font-semibold ${
                    showWave ? 'shrink-0' : 'min-w-0 flex-1'
                  } ${state.phase === 'error' ? 'line-clamp-2' : 'truncate'}`}
                >
                  {copy.title}
                </p>
                {showWave ? (
                  <div className="min-w-0 flex-1">
                    <Waveform levelRef={controller.levelRef} active height={22} bars={14} />
                  </div>
                ) : null}
                {listening ? (
                  <span
                    data-testid="pill-language"
                    title={languageName(state.language)}
                    className="shrink-0 rounded-full border border-line bg-raised px-2 text-[11px] leading-5 font-semibold text-fg-muted"
                  >
                    {languageBadge(state.language)}
                  </span>
                ) : null}
              </div>
              {copy.subtitle ? (
                <p
                  data-testid="pill-subtitle"
                  className="line-clamp-2 text-[11px] leading-[14px] text-fg-muted"
                >
                  {copy.subtitle}
                </p>
              ) : null}
            </div>
            {cancellable ? (
              <IconButton
                icon="close"
                size="sm"
                label="Cancel dictation"
                onClick={() => controller.cancel()}
              />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
