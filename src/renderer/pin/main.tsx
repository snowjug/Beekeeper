import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import './pin.css';
import { App } from './App';
import { PinControllerContext } from './context';
import { PinController } from './controller';

const bridge = getBridge('pin');

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

// Follow the system theme until the app says which theme it uses.
document.documentElement.dataset['theme'] = window.matchMedia('(prefers-color-scheme: light)')
  .matches
  ? 'light'
  : 'dark';

const controller = new PinController(bridge);
void controller.start();
window.addEventListener('pagehide', () => controller.dispose());

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="pin" onError={(error) => report(error, 'react')}>
      <PinControllerContext.Provider value={controller}>
        <App />
      </PinControllerContext.Provider>
    </ErrorBoundary>
  </StrictMode>,
);
