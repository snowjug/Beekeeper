import type { WindowRole } from '../windows';
import type { EventChannelFor, InvokeChannel, InvokeChannelFor } from './channels';
import type { EventPayload, InvokeInput, InvokeOutput } from './schemas';

type InvokeArgs<C extends InvokeChannel> = [InvokeInput<C>] extends [void]
  ? []
  : [input: InvokeInput<C>];

/**
 * The typed API every renderer gets as `window.beekeeper`. Channel names are restricted at compile
 * time to the ones the window's role may use (and the preload enforces the same list at runtime).
 */
export interface Bridge<R extends WindowRole> {
  readonly role: R;
  invoke<C extends InvokeChannelFor<R>>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<InvokeOutput<C>>;
  on<C extends EventChannelFor<R>>(
    channel: C,
    listener: (payload: EventPayload<C>) => void,
  ): () => void;
}
