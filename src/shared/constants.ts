export const APP_NAME = 'Beekeeper';
export const APP_ID = 'com.atharv.beekeeper';

/** The Vosk WebAssembly worker, extracted at build time and served with its own CSP (see csp.ts). */
export const VOSK_WORKER_FILE = 'vosk/vosk-worker.js';

export const BRAND_COLORS = {
  honey: '#FFB300',
  coral: '#FF5A5F',
  violet: '#7C4DFF',
  cyan: '#00BCD4',
} as const;

export const DEFAULT_HOTKEYS = {
  assistant: 'Ctrl+Shift+Space',
  circle: 'Alt+Shift+C',
} as const;
