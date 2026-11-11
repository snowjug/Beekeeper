import type { Bridge } from '@shared/ipc/bridge';
import type { WindowRole } from '@shared/windows';

declare global {
  interface Window {
    /** Injected by the preload script of the window's role. */
    beekeeper?: Bridge<WindowRole>;
  }
}

export {};
