import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Size } from '@shared/geometry';
import type { StudioSession } from '@shared/ipc/types';
import type { SettingsView } from '@shared/settings';
import type { RedactionBox } from './edit/redaction';

export type StudioMode = 'view' | 'edit';
export type ActionId =
  'edit' | 'pin' | 'copy' | 'share' | 'save' | 'wallpaper' | 'assist' | 'delete';
export type ActionStatus = 'idle' | 'busy' | 'done' | 'error';
export type MenuId = 'assist' | 'share' | 'more';

export interface SheetState {
  open: boolean;
  status: 'idle' | 'loading' | 'done' | 'error';
  /** The text found in the picture ('' when there is none). */
  text: string;
  message: string;
  speaking: boolean;
  /** Reading aloud is offered until the first attempt fails (speech may not be installed). */
  readAloud: 'available' | 'unavailable';
}

export type RedactionStatus = 'idle' | 'loading' | 'review' | 'applying';

export interface RedactionState {
  status: RedactionStatus;
  boxes: RedactionBox[];
}

export interface StudioState {
  session: StudioSession | null;
  /** Mounted and visible: false plays the exit animation. */
  visible: boolean;
  /** The picture shown: the capture, or the edited version once the user pressed Done. */
  imageUrl: string | null;
  /** Native size of the picture shown. */
  imageSize: Size | null;
  edited: boolean;
  mode: StudioMode;
  menu: MenuId | null;
  actions: Record<ActionId, ActionStatus>;
  sheet: SheetState;
  redaction: RedactionState;
  settings: SettingsView | null;
  /** Spoken by screen readers (the visual feedback is a toast or an icon). */
  announcement: string;
}

export interface StudioActions {
  reset: () => void;
  setSession: (session: StudioSession) => void;
  setVisible: (visible: boolean) => void;
  setImage: (url: string, size: Size, edited: boolean) => void;
  setMode: (mode: StudioMode) => void;
  setMenu: (menu: MenuId | null) => void;
  setAction: (id: ActionId, status: ActionStatus) => void;
  setSheet: (sheet: Partial<SheetState>) => void;
  setRedaction: (redaction: Partial<RedactionState>) => void;
  setSettings: (settings: SettingsView) => void;
  announce: (message: string) => void;
}

export const IDLE_ACTIONS: Record<ActionId, ActionStatus> = {
  edit: 'idle',
  pin: 'idle',
  copy: 'idle',
  share: 'idle',
  save: 'idle',
  wallpaper: 'idle',
  assist: 'idle',
  delete: 'idle',
};

export const IDLE_SHEET: SheetState = {
  open: false,
  status: 'idle',
  text: '',
  message: '',
  speaking: false,
  readAloud: 'available',
};

export const IDLE_REDACTION: RedactionState = { status: 'idle', boxes: [] };

const initial: StudioState = {
  session: null,
  visible: false,
  imageUrl: null,
  imageSize: null,
  edited: false,
  mode: 'view',
  menu: null,
  actions: IDLE_ACTIONS,
  sheet: IDLE_SHEET,
  redaction: IDLE_REDACTION,
  settings: null,
  announcement: '',
};

export type StudioStore = UseBoundStore<StoreApi<StudioState & StudioActions>>;

/** One store per Studio page (tests create their own). */
export function createStudioStore(): StudioStore {
  return create<StudioState & StudioActions>()((set) => ({
    ...initial,
    reset: () =>
      set((state) => ({
        ...initial,
        // The settings outlive a screenshot; a screen reader keeps the last message.
        settings: state.settings,
        announcement: state.announcement,
      })),
    setSession: (session) => set({ session }),
    setVisible: (visible) => set({ visible }),
    setImage: (imageUrl, imageSize, edited) => set({ imageUrl, imageSize, edited }),
    setMode: (mode) => set({ mode }),
    setMenu: (menu) => set({ menu }),
    setAction: (id, status) => set((state) => ({ actions: { ...state.actions, [id]: status } })),
    setSheet: (sheet) => set((state) => ({ sheet: { ...state.sheet, ...sheet } })),
    setRedaction: (redaction) =>
      set((state) => ({ redaction: { ...state.redaction, ...redaction } })),
    setSettings: (settings) => set({ settings }),
    announce: (announcement) => set({ announcement }),
  }));
}

/** True while something needs the user's attention, so the preview must not close by itself. */
export function isBusy(state: StudioState): boolean {
  return (
    state.menu !== null ||
    state.sheet.open ||
    state.mode !== 'view' ||
    state.redaction.status !== 'idle' ||
    Object.values(state.actions).some((status) => status === 'busy')
  );
}
