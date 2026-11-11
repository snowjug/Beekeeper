import { getBridge } from '@renderer/lib/bridge';
import { WakeWorker } from './WakeWorker';

const bridge = getBridge('worker');
const worker = new WakeWorker(bridge);

function report(error: Error, scope: string): void {
  void bridge
    .invoke('app:log', {
      level: 'error',
      scope,
      message: error.message.slice(0, 3900),
      ...(error.stack ? { stack: error.stack.slice(0, 7900) } : {}),
    })
    .catch(() => undefined);
}

window.addEventListener('error', (event) =>
  report(event.error instanceof Error ? event.error : new Error(event.message), 'window.onerror'),
);
window.addEventListener('unhandledrejection', (event) =>
  report(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
    'unhandledrejection',
  ),
);

bridge.on('worker:config', (config) => worker.setConfig(config));
bridge.on('worker:setPaused', ({ paused }) => worker.setPaused(paused));
window.addEventListener('beforeunload', () => worker.dispose());
