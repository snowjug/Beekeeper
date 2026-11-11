import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import { DictationPillController } from './controller';
import { Pill } from './Pill';

const bridge = getBridge('dictation');

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

const controller = new DictationPillController({ bridge });
const stop = controller.start();
// Closing the window must release the microphone with it.
window.addEventListener('beforeunload', stop);

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="dictation" onError={(error) => report(error, 'react')}>
      <MotionConfig reducedMotion="user">
        <Pill controller={controller} />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
