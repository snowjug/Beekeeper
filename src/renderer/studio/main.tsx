import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import './studio.css';
import { App } from './App';
import { ControllerContext } from './context';
import { StudioController } from './controller';

const bridge = getBridge('studio');

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

// Follow the system theme until the first capture says which theme to use.
document.documentElement.dataset['theme'] = window.matchMedia('(prefers-color-scheme: light)')
  .matches
  ? 'light'
  : 'dark';

const controller = new StudioController(bridge);
void controller.start();

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="studio" onError={(error) => report(error, 'react')}>
      <MotionConfig reducedMotion="user">
        <ControllerContext.Provider value={controller}>
          <App />
        </ControllerContext.Provider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
