import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { getBridge } from '@renderer/lib/bridge';
import '../styles/index.css';
import { App } from './App';
import { SettingsProvider } from './context';
import { applyTheme, SettingsController, type SettingsBridge } from './controller';
import { parseSection } from './lib/nav';
import { createSettingsStore } from './store';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
const root = createRoot(container);

// Match the system theme before the first paint; app:info confirms it right after.
applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

let bridge: SettingsBridge | null = null;
try {
  bridge = getBridge('settings');
} catch (error) {
  root.render(
    <div role="alert" className="p-10 text-center text-[14px] text-fg">
      {error instanceof Error ? error.message : 'Settings can only be opened inside Beekeeper.'}
    </div>,
  );
}

if (bridge) {
  const controller = new SettingsController(
    bridge,
    createSettingsStore(parseSection(window.location.search)),
  );

  window.addEventListener('error', (event) =>
    controller.report('window.onerror', event.error ?? event.message, 'error'),
  );
  window.addEventListener('unhandledrejection', (event) =>
    controller.report('unhandledrejection', event.reason, 'error'),
  );
  controller.start();

  root.render(
    <StrictMode>
      <ErrorBoundary
        scope="settings"
        onError={(error) => controller.report('react', error, 'error')}
      >
        <MotionConfig reducedMotion="user">
          <SettingsProvider controller={controller}>
            <App />
          </SettingsProvider>
        </MotionConfig>
      </ErrorBoundary>
    </StrictMode>,
  );
}
