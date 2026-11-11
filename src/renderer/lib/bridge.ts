import type { Bridge } from '@shared/ipc/bridge';
import type { WindowRole } from '@shared/windows';

/** Returns the typed bridge for this window, or throws a clear error when the preload is missing. */
export function getBridge<R extends WindowRole>(role: R): Bridge<R> {
  const bridge = window.beekeeper;
  if (!bridge || bridge.role !== role) {
    throw new Error(
      `The Beekeeper bridge for "${role}" is unavailable. Open this page inside the app.`,
    );
  }
  return bridge as unknown as Bridge<R>;
}
