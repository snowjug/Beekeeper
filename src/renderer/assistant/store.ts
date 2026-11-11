import { create } from 'zustand';
import type { Card, HistoryEntry } from '@shared/cards';
import type { AssistantShowEvent } from '@shared/ipc/types';
import type { SettingsView } from '@shared/settings';
import type { OrbState } from '@renderer/components/orbMath';

export type AssistantView = 'home' | 'history';

export interface TranscriptState {
  /** Words still being recognised (live, replaced on every partial result). */
  partial: string;
  /** Locked-in text of the last finished utterance. */
  final: string;
}

export interface Notice {
  text: string;
  tone?: 'info' | 'warning' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

export interface AssistantState {
  /** Drives the enter/exit animation of the bar. */
  visible: boolean;
  view: AssistantView;
  orb: OrbState;
  input: string;
  listening: boolean;
  speaking: boolean;
  pending: boolean;
  pinned: boolean;
  transcript: TranscriptState;
  cards: Card[];
  history: HistoryEntry[];
  historyQuery: string;
  settings: SettingsView | null;
  theme: 'light' | 'dark';
  /** Notice shown under the cards (mic problems, model download hints). */
  notice: Notice | null;
  /** Increments on every TTS word boundary; the orb pulses on change. */
  pulse: number;
  /** Increments whenever the bar is shown; used to refocus the input. */
  showCount: number;
  lastShow: AssistantShowEvent | null;
}

export interface AssistantActions {
  setVisible: (visible: boolean) => void;
  setView: (view: AssistantView) => void;
  setOrb: (orb: OrbState) => void;
  setInput: (input: string) => void;
  setListening: (listening: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setPending: (pending: boolean) => void;
  setPinned: (pinned: boolean) => void;
  setTranscript: (transcript: Partial<TranscriptState>) => void;
  setSettings: (settings: SettingsView) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setNotice: (notice: Notice | null) => void;
  addCards: (cards: Card[]) => void;
  replaceCard: (match: (card: Card) => boolean, replacement: Card | null) => void;
  appendAnswer: (cardId: string, delta: string) => void;
  finishAnswer: (cardId: string, error?: string) => void;
  clearCards: () => void;
  removeCard: (cardId: string) => void;
  setHistory: (entries: HistoryEntry[]) => void;
  setHistoryQuery: (query: string) => void;
  pulseOrb: () => void;
  noteShown: (event: AssistantShowEvent) => void;
  reset: () => void;
}

const MAX_CARDS = 12;

const initial: AssistantState = {
  visible: false,
  view: 'home',
  orb: 'idle',
  input: '',
  listening: false,
  speaking: false,
  pending: false,
  pinned: false,
  transcript: { partial: '', final: '' },
  cards: [],
  history: [],
  historyQuery: '',
  settings: null,
  theme: 'dark',
  notice: null,
  pulse: 0,
  showCount: 0,
  lastShow: null,
};

export const useAssistantStore = create<AssistantState & AssistantActions>()((set) => ({
  ...initial,
  setVisible: (visible) => set({ visible }),
  setView: (view) => set({ view }),
  setOrb: (orb) => set({ orb }),
  setInput: (input) => set({ input }),
  setListening: (listening) => set({ listening }),
  setSpeaking: (speaking) => set({ speaking }),
  setPending: (pending) => set({ pending }),
  setPinned: (pinned) => set({ pinned }),
  setTranscript: (transcript) =>
    set((state) => ({ transcript: { ...state.transcript, ...transcript } })),
  setSettings: (settings) => set({ settings }),
  setTheme: (theme) => set({ theme }),
  setNotice: (notice) => set({ notice }),
  addCards: (cards) =>
    set((state) => ({ cards: [...state.cards, ...cards].slice(-MAX_CARDS), view: 'home' })),
  replaceCard: (match, replacement) =>
    set((state) => ({
      cards: replacement
        ? state.cards.map((card) => (match(card) ? replacement : card))
        : state.cards.filter((card) => !match(card)),
    })),
  appendAnswer: (cardId, delta) =>
    set((state) => ({
      cards: state.cards.map((card) =>
        card.id === cardId && card.kind === 'answer'
          ? { ...card, markdown: card.markdown + delta }
          : card,
      ),
    })),
  finishAnswer: (cardId, error) =>
    set((state) => ({
      cards: state.cards.map((card) =>
        card.id === cardId && card.kind === 'answer'
          ? { ...card, streaming: false, ...(error ? { error } : {}) }
          : card,
      ),
    })),
  clearCards: () => set({ cards: [] }),
  removeCard: (cardId) =>
    set((state) => ({ cards: state.cards.filter((card) => card.id !== cardId) })),
  setHistory: (history) => set({ history }),
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  pulseOrb: () => set((state) => ({ pulse: state.pulse + 1 })),
  noteShown: (event) =>
    set((state) => ({ showCount: state.showCount + 1, lastShow: event, visible: true })),
  reset: () =>
    set((state) => ({
      ...initial,
      settings: state.settings,
      theme: state.theme,
      history: state.history,
      showCount: state.showCount,
    })),
}));

/** Plain text of a card for the "copy that" fallback and accessibility announcements. */
export function describeCard(card: Card): string {
  if (card.copyText) return card.copyText;
  switch (card.kind) {
    case 'text':
      return card.markdown;
    case 'answer':
      return card.markdown;
    case 'status':
      return card.detail ? `${card.title}. ${card.detail}` : card.title;
    default:
      return card.kind;
  }
}
