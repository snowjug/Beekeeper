import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { canInvoke, canReceive, EVENT_CHANNELS } from '@shared/ipc/channels';
import type { WindowRole } from '@shared/windows';

type Listener = (payload: unknown) => void;

/** Upper bound of events kept for a channel while no one listens yet. */
const BACKLOG_LIMIT = 32;

/**
 * Exposes the typed bridge as `window.beekeeper`. Only channels allowed for the window's role can be
 * invoked or subscribed to; everything else is rejected here and, independently, in the main process.
 *
 * The preload starts listening at once, but a renderer only subscribes after its first React commit
 * (later than `did-finish-load`). Events that arrive in that gap are kept and replayed to the first
 * subscriber, so a hotkey pressed during start-up is never lost.
 */
export function exposeBridge(role: WindowRole): void {
  const listeners = new Map<string, Set<Listener>>();
  const backlog = new Map<string, unknown[]>();
  const everSubscribed = new Set<string>();

  const deliver = (channel: string, payload: unknown): void => {
    for (const listener of [...(listeners.get(channel) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Listener for ${channel} failed`, error);
      }
    }
  };

  for (const channel of Object.keys(EVENT_CHANNELS)) {
    if (!canReceive(role, channel)) continue;
    ipcRenderer.on(channel, (_event: IpcRendererEvent, payload: unknown) => {
      if ((listeners.get(channel)?.size ?? 0) > 0) {
        deliver(channel, payload);
        return;
      }
      if (everSubscribed.has(channel)) return;
      const queue = backlog.get(channel) ?? [];
      queue.push(payload);
      if (queue.length > BACKLOG_LIMIT) queue.shift();
      backlog.set(channel, queue);
    });
  }

  const bridge = {
    role,
    invoke(channel: string, input?: unknown): Promise<unknown> {
      if (!canInvoke(role, channel)) {
        return Promise.reject(new Error(`IPC channel not permitted for ${role}: ${channel}`));
      }
      return ipcRenderer.invoke(channel, input);
    },
    on(channel: string, listener: Listener): () => void {
      if (!canReceive(role, channel)) {
        throw new Error(`IPC event not permitted for ${role}: ${channel}`);
      }
      const set = listeners.get(channel) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(channel, set);
      everSubscribed.add(channel);

      const pending = backlog.get(channel);
      if (pending && pending.length > 0) {
        backlog.delete(channel);
        // A microtask lets a synchronous unsubscribe/resubscribe (React strict mode) settle first.
        queueMicrotask(() => {
          for (const payload of pending) deliver(channel, payload);
        });
      }
      return () => {
        set.delete(listener);
      };
    },
  };
  contextBridge.exposeInMainWorld('beekeeper', bridge);
}
