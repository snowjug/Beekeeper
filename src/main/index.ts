import { app } from 'electron';
import { bootstrap } from './app';
import { configureUserData } from './paths';
import { registerAppScheme } from './protocol';

// Must happen before the app is ready.
configureUserData();
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let bootstrapped: ReturnType<typeof bootstrap> | null = null;

  app.on('second-instance', () => {
    bootstrapped?.assistant.show({ listen: false, source: 'second-instance' });
  });

  void app.whenReady().then(() => {
    bootstrapped = bootstrap(__dirname);
  });
}
