/** Minimal logger contract shared by main-process modules (electron-log satisfies it). */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const noop = (): void => undefined;

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
