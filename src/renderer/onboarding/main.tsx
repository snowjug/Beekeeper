import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import './onboarding.css';
import { App } from './App';
import { createErrorReporter } from './bridge';
import { applyTheme, systemTheme } from './theme';

const bridge = getBridge('onboarding');
const report = createErrorReporter(bridge);

window.addEventListener('error', (event) =>
  report(event.error instanceof Error ? event.error : new Error(event.message), 'window.onerror'),
);
window.addEventListener('unhandledrejection', (event) =>
  report(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
    'unhandledrejection',
  ),
);

// Paint with the right colours from the first frame; the App refines it from app:info.
applyTheme(systemTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="onboarding" onError={(error) => report(error, 'react')}>
      <MotionConfig reducedMotion="user">
        <App bridge={bridge} />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
