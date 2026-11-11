import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ToastHost } from '@renderer/components/Toast';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import { App } from './App';
import { ControllerContext } from './context';
import { AssistantController } from './controller';
import { createVoiceSystem } from './voice/system';

const bridge = getBridge('assistant');

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

// Voice submits recognised text through the controller; the controller drives voice (speak, listen).
const voice = createVoiceSystem({
  bridge,
  submit: (text) => controller.submit(text, 'voice'),
});
const controller: AssistantController = new AssistantController(bridge, voice.hooks);
void controller.start();
window.addEventListener('beforeunload', () => voice.dispose());

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="assistant" onError={(error) => report(error, 'react')}>
      <MotionConfig reducedMotion="user">
        <ControllerContext.Provider value={controller}>
          <App levelRef={voice.levelRef} onToggleListening={voice.toggleListening} />
          <ToastHost className="fixed bottom-[104px] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" />
        </ControllerContext.Provider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
