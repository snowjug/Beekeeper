import { create } from 'zustand';
import type { Rect } from '@shared/geometry';
import type { CircleSession, OcrResultDto } from '@shared/ipc/types';
import type { SettingsView } from '@shared/settings';

export type CirclePhase = 'idle' | 'drawing' | 'selected' | 'closing';
export type SelectionSource = 'lasso' | 'rect' | 'tap' | 'keyboard';

export interface OcrState {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: OcrResultDto | null;
  /** Trimmed text of the selection ('' when nothing was found). */
  text: string;
  message?: string;
}

export interface AiState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  streamId: string | null;
  question: string;
  message?: string;
}

export interface CircleState {
  session: CircleSession | null;
  /** Mounted and visible (drives the exit animation). */
  visible: boolean;
  phase: CirclePhase;
  selection: Rect | null;
  selectionSource: SelectionSource | null;
  /** Increments with every new selection so animations restart. */
  selectionId: number;
  /** A tap is being resolved by OCR; where it happened (for the pulse). */
  tapPoint: { x: number; y: number } | null;
  hintVisible: boolean;
  sheetOpen: boolean;
  /** Shift applied to the frozen screen so the selection stays above the results sheet. */
  sceneOffset: number;
  ocr: OcrState;
  ai: AiState;
  speaking: boolean;
  settings: SettingsView | null;
}

export interface CircleStoreActions {
  reset: () => void;
  setSession: (session: CircleSession) => void;
  setVisible: (visible: boolean) => void;
  setPhase: (phase: CirclePhase) => void;
  setSelection: (selection: Rect | null, source?: SelectionSource | null) => void;
  setTapPoint: (point: { x: number; y: number } | null) => void;
  setHintVisible: (visible: boolean) => void;
  setSheetOpen: (open: boolean) => void;
  setSceneOffset: (offset: number) => void;
  setOcr: (ocr: OcrState) => void;
  setAi: (ai: Partial<AiState>) => void;
  setSpeaking: (speaking: boolean) => void;
  setSettings: (settings: SettingsView) => void;
}

export const IDLE_OCR: OcrState = { status: 'idle', result: null, text: '' };
export const IDLE_AI: AiState = { status: 'idle', text: '', streamId: null, question: '' };

const initial: CircleState = {
  session: null,
  visible: false,
  phase: 'idle',
  selection: null,
  selectionSource: null,
  selectionId: 0,
  tapPoint: null,
  hintVisible: true,
  sheetOpen: false,
  sceneOffset: 0,
  ocr: IDLE_OCR,
  ai: IDLE_AI,
  speaking: false,
  settings: null,
};

export const useCircleStore = create<CircleState & CircleStoreActions>()((set) => ({
  ...initial,
  reset: () => set((state) => ({ ...initial, settings: state.settings })),
  setSession: (session) => set({ session }),
  setVisible: (visible) => set({ visible }),
  setPhase: (phase) => set({ phase }),
  setSelection: (selection, source = null) =>
    set((state) => ({
      selection,
      selectionSource: selection ? (source ?? state.selectionSource) : null,
      selectionId: selection && source ? state.selectionId + 1 : state.selectionId,
    })),
  setTapPoint: (tapPoint) => set({ tapPoint }),
  setHintVisible: (hintVisible) => set({ hintVisible }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  setSceneOffset: (sceneOffset) => set({ sceneOffset }),
  setOcr: (ocr) => set({ ocr }),
  setAi: (ai) => set((state) => ({ ai: { ...state.ai, ...ai } })),
  setSpeaking: (speaking) => set({ speaking }),
  setSettings: (settings) => set({ settings }),
}));

/** Keeps the selection above the results sheet by shifting the frozen screen upwards. */
export function sceneOffsetFor(
  selection: Rect | null,
  viewportHeight: number,
  sheetHeight: number,
  margin = 24,
): number {
  if (!selection) return 0;
  const visibleBottom = viewportHeight - sheetHeight - margin;
  const overflow = selection.y + selection.height - visibleBottom;
  if (overflow <= 0) return 0;
  const room = Math.max(0, selection.y - margin);
  return -Math.min(overflow, room);
}
