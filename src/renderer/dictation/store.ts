import { create } from 'zustand';
import type { DictationPhase, DictationStart, DictationStatus } from '@shared/ipc/types';

export interface PillState {
  /** Mounted and visible (drives the enter and exit animation). */
  visible: boolean;
  phase: DictationPhase;
  /** The microphone is still opening: words said now would not be heard. */
  preparing: boolean;
  /** The speaker has said something: the waveform replaces the "speak now" prompt. */
  speaking: boolean;
  language: DictationStart['language'];
  hotkey: string | null;
  /** The transcript (typing / done) or the part of it to show. */
  text: string;
  message: string;
  /** Counts the dictations: a new one restarts the enter animation. */
  session: number;
}

export interface PillActions {
  begin: (start: Pick<DictationStart, 'language' | 'hotkey'>) => void;
  setPreparing: (preparing: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setStatus: (status: DictationStatus) => void;
  /** Starts the exit animation (the main process hides the window a moment later). */
  dismiss: () => void;
}

const initial: PillState = {
  visible: false,
  phase: 'listening',
  preparing: false,
  speaking: false,
  language: 'auto',
  hotkey: null,
  text: '',
  message: '',
  session: 0,
};

export const usePillStore = create<PillState & PillActions>((set) => ({
  ...initial,
  begin: ({ language, hotkey }) =>
    set((state) => ({
      visible: true,
      phase: 'listening',
      preparing: true,
      speaking: false,
      language,
      hotkey,
      text: '',
      message: '',
      session: state.session + 1,
    })),
  setPreparing: (preparing) =>
    set((state) => (state.preparing === preparing ? state : { preparing })),
  setSpeaking: (speaking) => set((state) => (state.speaking === speaking ? state : { speaking })),
  setStatus: (status) =>
    set({
      visible: status.phase !== 'cancelled',
      phase: status.phase,
      preparing: false,
      text: status.text ?? '',
      message: status.message ?? '',
    }),
  dismiss: () => set({ visible: false }),
}));

export function resetPillStore(): void {
  usePillStore.setState({ ...initial });
}
