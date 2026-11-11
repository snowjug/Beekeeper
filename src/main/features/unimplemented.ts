import type { InvokeChannel } from '@shared/ipc/channels';
import type { IpcRouter } from '../ipc/router';

/** Registers channels that have no implementation yet so the contract stays complete. */
export function registerUnimplemented(router: IpcRouter, channels: readonly InvokeChannel[]): void {
  for (const channel of channels) {
    router.handle(channel, () => {
      throw new Error(`${channel} is not available in this build`);
    });
  }
}
