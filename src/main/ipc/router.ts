import { ipcMain, type WebContents } from 'electron';
import type { Logger } from '@shared/logger';
import { canInvoke, INVOKE_CHANNELS, type InvokeChannel } from '@shared/ipc/channels';
import type { InvokeOutput, InvokeParsed } from '@shared/ipc/schemas';
import type { WindowRole } from '@shared/windows';
import { validateInvoke } from './validate';

export interface IpcContext {
  role: WindowRole;
  sender: WebContents;
}

export type InvokeHandler<C extends InvokeChannel> = (
  input: InvokeParsed<C>,
  context: IpcContext,
) => Promise<InvokeOutput<C>> | InvokeOutput<C>;

export interface IpcRouterDeps {
  roleOf(contents: WebContents): WindowRole | null;
  /** True when the frame that sent the message is the top-level page of one of our windows. */
  isTrustedSender(url: string, isMainFrame: boolean): boolean;
  logger: Logger;
}

/**
 * Typed `ipcMain.handle` registration. Every call is checked three times before a handler runs:
 * the channel exists in the contract, the sender window's role may use it, and the payload passes
 * its zod schema. Unknown channels have no handler at all, so Electron rejects them.
 */
export class IpcRouter {
  private readonly registered = new Set<InvokeChannel>();

  constructor(private readonly deps: IpcRouterDeps) {}

  handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
    if (this.registered.has(channel)) throw new Error(`IPC handler already registered: ${channel}`);
    this.registered.add(channel);

    ipcMain.handle(channel, async (event, raw: unknown) => {
      const role = this.deps.roleOf(event.sender);
      const frame = event.senderFrame;
      const trusted =
        frame !== null && this.deps.isTrustedSender(frame.url, frame === event.sender.mainFrame);
      if (!role || !trusted || !canInvoke(role, channel)) {
        this.deps.logger.warn(`Rejected IPC call ${channel} from ${role ?? 'unknown window'}`);
        throw new Error('Forbidden');
      }

      const validation = validateInvoke(channel, raw);
      if (!validation.ok) {
        this.deps.logger.warn(validation.message, `from ${role}`);
        throw new Error(validation.message);
      }

      try {
        return await handler(validation.data, { role, sender: event.sender });
      } catch (error) {
        this.deps.logger.error(`IPC handler failed: ${channel}`, error);
        throw new Error(error instanceof Error ? error.message : 'Unexpected error');
      }
    });
  }

  /** Channels that exist in the contract but have no handler yet. */
  missing(): InvokeChannel[] {
    return (Object.keys(INVOKE_CHANNELS) as InvokeChannel[]).filter(
      (channel) => !this.registered.has(channel),
    );
  }
}
