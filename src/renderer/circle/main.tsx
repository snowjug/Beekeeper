import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ToastHost } from '@renderer/components/Toast';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import './circle.css';
import { App } from './App';
import { ControllerContext } from './context';
import { CircleController } from './controller';

const bridge = getBridge('circle');

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

const controller = new CircleController(bridge);
void controller.start();

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="circle" onError={(error) => report(error, 'react')}>
      <MotionConfig reducedMotion="user">
        <ControllerContext.Provider value={controller}>
          <App />
          <ToastHost className="fixed top-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" />
        </ControllerContext.Provider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
