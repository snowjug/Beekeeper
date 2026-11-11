import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  shell,
} from 'electron';
import type { Card, StatusCard } from '@shared/cards';
import type { UpdateState } from '@shared/ipc/types';
import { APP_ID } from '@shared/constants';
import { getModelUrlPath } from '@shared/models';
import { APP_ORIGIN } from '@shared/windows';
import { AiService } from './ai/aiService';
import { AzureOpenAiClient } from './ai/azureOpenAi';
import { buildSettingsView } from './settingsView';
import { AssistantService } from './assistant/assistantService';
import { createUiBridge } from './assistant/uiBridge';
import { createOcrService } from './capture/ocr';
import { resolveOcrAssets } from './capture/ocr-assets';
import { withIdleRelease } from './capture/ocrIdle';
import { CaptureStore } from './capture/store';
import { captureDisplay, loadScreenGrabber, nativeSize } from './capture/screen';
import { createCircleActions } from './circle/actions';
import { CircleService } from './circle/service';
import { CircleWindowController } from './circle/windowController';
import { allCommands, createCommandEngine } from './commands';
import type { CommandServices } from './commands/types';
import type { AppContext } from './context';
import { loadDotEnvFiles, readAzureEnv } from './env';
import { HotkeyManager } from './hotkeys';
import { createFeatures, type Features } from './features';
import { registerAiHandlers, registerCircleHandlers } from './ipc/circleHandlers';
import { registerCoreHandlers } from './ipc/handlers';
import { IpcRouter } from './ipc/router';
import { initLogging } from './logging';
import { resolveAppPaths } from './paths';
import { registerAppProtocol } from './protocol';
import { installSecurity, isTrustedUrl } from './security';
import { createConfirmationService } from './services/confirmation';
import { createDictionaryService } from './services/dictionary';
import { createGeolocationService } from './services/geolocation';
import { createHistoryService, openHistoryStore } from './services/history';
import { ModelManager } from './services/modelManager';
import { createNotesService, openNotesStore } from './services/notes';
import { SecureKeys } from './services/secureKeys';
import { SettingsStore } from './services/settingsStore';
import { createTimersService, openTimersStore } from './services/timers';
import { createWeatherService } from './services/weather';
import { createSystemApi } from './system';
import { readTaskbarTheme, TrayController } from './tray';
import { TrayStateMachine } from './trayState';
import { UpdateController } from './updater';
import { isBatterySaverOn } from './wake/batterySaver';
import { WakeWordController } from './wake/controller';
import { AssistantController, displayUnderCursor } from './windows/assistantController';
import { EdgeGlowController } from './windows/edgeGlow';
import { WindowManager } from './windows/manager';
import { WindowOpeners } from './windows/openers';

const STARTED_AT = Date.now();

/** The OCR engine (WebAssembly, tens of MB) is released after this long without Circle to Search. */
const OCR_IDLE_RELEASE_MS = 60_000;

/** Wraps Electron's network stack (system proxy, certificates) in the standard fetch signature. */
const netFetch: typeof fetch = (input, init) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return net.fetch(target, init);
};

function statusCard(
  tone: StatusCard['tone'],
  icon: StatusCard['icon'],
  title: string,
  detail?: string,
): StatusCard {
  return {
    kind: 'status',
    id: randomUUID(),
    createdAt: Date.now(),
    tone,
    icon,
    title,
    ...(detail ? { detail } : {}),
  };
}

function updateNotification(state: UpdateState): { title: string; body: string } | null {
  switch (state.status) {
    case 'none':
      return {
        title: "You're up to date",
        body: `Beekeeper ${app.getVersion()} is the latest version.`,
      };
    case 'available':
    case 'downloading':
      return {
        title: 'Update found',
        body: `Version ${state.version ?? ''} is downloading in the background.`.replace('  ', ' '),
      };
    case 'ready':
      return { title: 'Update ready', body: 'Restart Beekeeper to install it.' };
    case 'error':
      return { title: 'Update check failed', body: state.message ?? 'Try again later.' };
    case 'disabled':
      return {
        title: 'Updates are off',
        body: state.message ?? 'This build does not update itself.',
      };
    default:
      return null;
  }
}

/** Builds the whole application: services, windows, tray, hotkeys and IPC. */
export function bootstrap(mainDir: string): AppContext {
  const dev = !app.isPackaged;
  const devOrigin = process.env['ELECTRON_RENDERER_URL'] ?? null;
  const portable = Boolean(process.env['PORTABLE_EXECUTABLE_DIR']);
  const e2e = process.env['BEEKEEPER_E2E'] === '1';

  app.setAppUserModelId(APP_ID);
  const paths = resolveAppPaths(mainDir);
  for (const folder of [paths.userData, paths.logsDir, paths.modelsDir])
    mkdirSync(folder, { recursive: true });
  const logger = initLogging(paths.logsDir, dev);
  logger.info(
    `Starting Beekeeper ${app.getVersion()} (electron ${process.versions.electron}, ${dev ? 'dev' : 'packaged'}${portable ? ', portable' : ''})`,
  );

  // ---- configuration --------------------------------------------------------------------------
  const dotenv = loadDotEnvFiles([
    join(paths.userData, '.env'),
    ...(dev ? [join(paths.appRoot, '.env')] : []),
  ]);
  const azureEnv = readAzureEnv({ ...dotenv, ...process.env });
  const settings = new SettingsStore({ filePath: join(paths.userData, 'settings.json'), logger });
  nativeTheme.themeSource = settings.get().general.theme;
  const keys = new SecureKeys({
    filePath: join(paths.userData, 'secrets.json'),
    cipher: safeStorage,
    fallbacks: {
      ...(azureEnv.speechKey ? { speech: azureEnv.speechKey } : {}),
      ...(azureEnv.openAiKey ? { openai: azureEnv.openAiKey } : {}),
    },
    logger,
  });
  const settingsView = () => buildSettingsView(settings.get(), keys);

  // ---- protocol, security, windows --------------------------------------------------------------
  const captures = new CaptureStore();
  registerAppProtocol({
    rendererRoot: paths.rendererRoot,
    modelsDir: paths.modelsDir,
    dev,
    captures,
    logger,
  });
  installSecurity({ dev, devOrigin, logger });
  const windows = new WindowManager({ paths, logger, dev, devOrigin });
  // A window opened after the worker reported must still learn the wake-word status.
  const openers = new WindowOpeners(windows, (role) => {
    windows.send(role, 'voice:wakeStatus', wake.status);
  });
  const assistant = new AssistantController({ windows, logger, hideOnBlur: !e2e });
  const edgeGlow = new EdgeGlowController(windows);

  // ---- services ---------------------------------------------------------------------------------
  const historyStore = openHistoryStore(join(paths.userData, 'history.json'), logger);
  const notesStore = openNotesStore(join(paths.userData, 'notes.json'), logger);
  const timersStore = openTimersStore(join(paths.userData, 'timers.json'), logger);
  const history = createHistoryService({ store: historyStore });
  const notes = createNotesService({ store: notesStore });
  const timers = createTimersService({ store: timersStore, logger });
  const geolocation = createGeolocationService({ fetch: netFetch, now: () => new Date(), logger });
  const weather = createWeatherService({
    fetch: netFetch,
    geolocation,
    now: () => new Date(),
    logger,
    settings: () => settings.get().general.weatherLocation,
  });
  const dictionary = createDictionaryService({ fetch: netFetch, logger });
  const confirmations = createConfirmationService({
    logger,
    onSettled: (event) => {
      if (event.status === 'cancelled') return;
      const replacement: Card =
        event.status === 'executed'
          ? statusCard('success', 'check', 'Done')
          : event.status === 'expired'
            ? statusCard(
                'warning',
                'info',
                'That request expired',
                'Ask me again if you still want it.',
              )
            : statusCard('error', 'error', 'That did not work', event.message);
      windows.send('assistant', 'assistant:cardUpdate', {
        confirmId: event.confirmId,
        replacement,
      });
    },
  });
  const models = new ModelManager({ modelsDir: paths.modelsDir, fetch: netFetch, logger });

  // The assistant bar and the listening glow are on screen when a command asks for a screenshot:
  // take them off for the capture and bring the bar back afterwards.
  const SCREEN_SETTLE_MS = 70;
  const captureWithoutOverlays = async (): Promise<{
    png: Buffer;
    width: number;
    height: number;
  }> => {
    const barHidden = assistant.suspend();
    const glowHidden = edgeGlow.hideImmediately();
    try {
      // DWM needs a frame or two before the hidden windows are gone from the desktop composition.
      if (barHidden || glowHidden) await new Promise((done) => setTimeout(done, SCREEN_SETTLE_MS));
      const capture = await captureDisplay(displayUnderCursor(), screen.getAllDisplays(), logger);
      return { png: capture.image.toPNG(), width: capture.width, height: capture.height };
    } finally {
      assistant.resume();
    }
  };
  const system = createSystemApi({
    resourcesDir: paths.resourcesDir,
    picturesDir: paths.picturesDir,
    capture: captureWithoutOverlays,
    logger,
  });

  // ---- optional cloud features, OCR and Circle to Search --------------------------------------------
  const ai = new AiService({
    client: new AzureOpenAiClient({ fetch: netFetch, logger }),
    fetch: netFetch,
    settings: () => settings.get(),
    keys,
    env: azureEnv,
    logger,
  });

  const requireHere = createRequire(__filename);
  const ocrAssets = resolveOcrAssets({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: paths.appRoot,
    resolveModule: (id) => requireHere.resolve(id),
  });
  const ocr = withIdleRelease(
    createOcrService({
      langPath: ocrAssets.langPath,
      cachePath: paths.tempDir,
      workerPath: ocrAssets.workerPath,
      corePath: ocrAssets.corePath,
      logger,
    }),
    OCR_IDLE_RELEASE_MS,
  );

  const circleService = new CircleService({
    ocr,
    store: captures,
    ai,
    settings: () => settings.get(),
    newId: randomUUID,
    logger,
    actions: createCircleActions({
      writeClipboardImage: (png) =>
        clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
        ]),
      writeClipboardText: (text) => clipboard.writeText(text),
      openUrl: (url) => shell.openExternal(url),
      writeFile,
      ensureDir: (path) => mkdirSync(path, { recursive: true }),
      scheduleReminder: (at, label) => {
        timers.schedule({ at, label, type: 'reminder' });
      },
      picturesDir: paths.picturesDir,
      now: () => new Date(),
    }),
  });
  const circle = new CircleWindowController({
    windows,
    service: circleService,
    logger,
    clearScreen: () => {
      const hadBar = assistant.hideImmediately();
      const hadGlow = edgeGlow.hideImmediately();
      return hadBar || hadGlow;
    },
    notify: ({ title, message }) => {
      if (Notification.isSupported()) {
        new Notification({ title, body: message ?? '', silent: true }).show();
      }
    },
    cancelOnBlur: !e2e,
  });
  const startCircle = (source: string): void => {
    // The OCR engine sleeps when idle: wake it while the screen is being captured.
    ocr.warmUp().catch((error: unknown) => logger.warn('OCR warm-up failed', error));
    void circle.toggle(source);
  };
  // Feature modules (speech, Capture Studio, dictation) are created after the IPC router exists.
  let features: Features | null = null;

  const assistantService: AssistantService = new AssistantService({
    engine: createCommandEngine({ modules: allCommands, logger }),
    // Late-bound: the services (UI bridge) need the assistant service and vice versa.
    getServices: () => services,
    getSettings: () => settings.get(),
    logger,
    streamer: ai,
    emitStream: (event) => windows.send('assistant', 'assistant:stream', event),
    newId: randomUUID,
  });
  const services: CommandServices = {
    system,
    weather,
    dictionary,
    notes,
    timers,
    history,
    confirm: confirmations,
    ui: createUiBridge({
      windows,
      openers,
      confirmations,
      getAssistant: () => assistantService,
      startCircle: () => startCircle('voice'),
      // Late-bound: the feature modules are created once the IPC router exists.
      startCapture: (source) => void features?.studio.capture(source),
      openCaptureStudio: (shot) => void features?.studio.openFile(shot, 'voice'),
      startDictation: () => features?.dictation.toggle('voice'),
      logger,
    }),
    listCommands: () => allCommands,
  };

  // ---- tray, hotkeys, updates -------------------------------------------------------------------
  const quit = (): void => app.quit();

  const updates = new UpdateController({
    enabled: !dev && !portable,
    disabledReason: portable
      ? 'The portable build does not update itself. Download a new version from GitHub.'
      : 'Updates are disabled in development builds.',
    autoUpdate: () => settings.get().updates.autoUpdate,
    logger,
    onState: (state) => {
      windows.broadcast('updates:state', state);
      if (state.status === 'ready') {
        windows.send('assistant', 'toast:show', {
          title: 'Update ready',
          message: `Beekeeper ${state.version ?? ''} is downloaded.`.replace('  ', ' '),
          tone: 'success',
          action: { label: 'Restart', id: 'install-update' },
        });
      }
    },
  });

  const hotkeys = new HotkeyManager({
    settings,
    logger,
    trigger: (id) => {
      if (features?.onHotkey(id)) return;
      if (id === 'assistant') assistant.toggle('hotkey');
      else startCircle('hotkey');
    },
  });

  const tray = new TrayController({
    assetsDir: paths.assetsDir,
    version: app.getVersion(),
    logger,
    assistantHotkey: () => settings.get().hotkeys.assistant,
    startWithWindows: () => settings.get().general.startWithWindows,
    actions: {
      toggleAssistant: () => assistant.toggle('tray'),
      openCircle: () => startCircle('tray'),
      captureScreen: () => void features?.studio.capture('tray'),
      startDictation: () => features?.dictation.toggle('tray'),
      openNotes: () => assistant.show({ listen: false, source: 'tray', view: 'notes' }),
      openTimers: () => assistant.show({ listen: false, source: 'tray', view: 'timers' }),
      openSettings: () => openers.openSettings(),
      setStartWithWindows: (enabled) => settings.update({ general: { startWithWindows: enabled } }),
      checkForUpdates: () => {
        void updates.check(true).then((state) => {
          const message = updateNotification(state);
          if (message && Notification.isSupported())
            new Notification({ ...message, silent: true }).show();
        });
      },
      quit,
    },
  });
  const trayState = new TrayStateMachine(tray);

  const wake = new WakeWordController({
    getSettings: () => settings.get(),
    modelUrl: () => (models.isReady() ? `${APP_ORIGIN}${getModelUrlPath()}` : null),
    worker: {
      run: (config, paused) => {
        windows.ensure('worker');
        windows.send('worker', 'worker:config', config);
        windows.send('worker', 'worker:setPaused', { paused });
      },
      stop: () => windows.destroy('worker'),
    },
    publish: (status) => windows.broadcast('voice:wakeStatus', status),
    setArmed: (armed) => trayState.setWakeArmed(armed),
    wake: () => assistant.show({ listen: true, source: 'wake' }),
    batterySaverOn: () => isBatterySaverOn(),
    logger,
  });
  assistant.onVisibility((visible) => wake.setAssistantOpen(visible));

  const ctx: AppContext = {
    paths,
    logger,
    dev,
    packaged: app.isPackaged,
    portable,
    settings,
    keys,
    windows,
    openers,
    assistant,
    assistantService,
    edgeGlow,
    circle,
    ai,
    wake,
    tray,
    trayState,
    hotkeys,
    history,
    notes,
    timers,
    confirmations,
    models,
    updates,
    settingsView,
    quit,
  };

  // ---- IPC ----------------------------------------------------------------------------------------
  const router = new IpcRouter({
    roleOf: (contents) => windows.roleOf(contents),
    isTrustedSender: (url, isMainFrame) => isMainFrame && isTrustedUrl(url, devOrigin),
    logger,
  });
  registerCoreHandlers(router, ctx);
  registerCircleHandlers(router, { service: circleService, controller: circle, windows });
  registerAiHandlers(router, {
    ai,
    keys,
    settingsView,
    windows,
    testElevenLabs: () =>
      features?.speech.testElevenLabs() ??
      Promise.resolve({ ok: false, message: 'Speech is not ready yet.' }),
  });
  features = createFeatures({
    ctx,
    router,
    captures,
    ocr,
    netFetch,
    captureScreen: captureWithoutOverlays,
  });

  // ---- tray first (spec 7: cold start to tray ready < 2.5 s) -----------------------------------------
  tray.create();
  void readTaskbarTheme().then((theme) => tray.setTaskbarTheme(theme));
  logger.info(`Tray ready ${Date.now() - STARTED_AT} ms after launch`);

  // ---- live settings ------------------------------------------------------------------------------
  const applyLoginItem = (enabled: boolean): void => {
    if (!app.isPackaged || portable) return;
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  };
  settings.onChange((next, previous) => {
    if (next.general.theme !== previous.general.theme) nativeTheme.themeSource = next.general.theme;
    if (next.general.startWithWindows !== previous.general.startWithWindows) {
      applyLoginItem(next.general.startWithWindows);
    }
    windows.broadcast('settings:changed', settingsView());
    tray.refresh();
    if (JSON.stringify(next.voice) !== JSON.stringify(previous.voice)) {
      wake.evaluate();
      void wake.refreshPower();
    }
  });
  applyLoginItem(settings.get().general.startWithWindows);

  // The wake word needs the offline model: start it as soon as the download finishes.
  let modelWasReady = models.isReady();
  models.onProgress(() => {
    const ready = models.isReady();
    if (ready !== modelWasReady) {
      modelWasReady = ready;
      wake.evaluate();
    }
  });

  nativeTheme.on('updated', () => {
    windows.broadcast('theme:changed', {
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    });
    windows.updateTitleBarOverlays();
    void readTaskbarTheme().then((theme) => tray.setTaskbarTheme(theme));
  });

  // ---- timers -------------------------------------------------------------------------------------
  timers.onFire((record, info) => {
    const title =
      record.type === 'timer' ? "Time's up" : record.type === 'alarm' ? 'Alarm' : 'Reminder';
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body: record.label, silent: true });
      notification.on('click', () => assistant.show({ listen: false, source: 'api' }));
      notification.show();
    }
    assistant.show({ listen: false, source: 'api' });
    windows.send('assistant', 'assistant:timerFired', { timer: record, missed: info.missed });
  });
  timers.start();

  // ---- resilience: sleep/resume, display changes, crashes -------------------------------------------
  const recover = (reason: string): void => {
    logger.info(`Re-registering hotkeys and timers after ${reason}`);
    hotkeys.refresh();
    timers.start();
    assistant.reposition();
  };
  powerMonitor.on('resume', () => recover('resume'));
  powerMonitor.on('unlock-screen', () => recover('unlock'));
  const refreshPower = (): void => void wake.refreshPower();
  powerMonitor.on('on-battery', refreshPower);
  powerMonitor.on('on-ac', refreshPower);
  powerMonitor.on('resume', refreshPower);
  const saverPoll = setInterval(refreshPower, 5 * 60_000);
  saverPoll.unref();
  screen.on('display-added', () => assistant.reposition());
  screen.on('display-removed', () => assistant.reposition());
  screen.on('display-metrics-changed', () => assistant.reposition());
  process.on('uncaughtException', (error) => logger.error('Uncaught exception (recovered)', error));
  process.on('unhandledRejection', (reason) =>
    logger.error('Unhandled rejection (recovered)', reason),
  );
  app.on('window-all-closed', () => {
    // Beekeeper lives in the tray: closing windows must not quit the app.
  });
  app.on('before-quit', () => {
    hotkeys.dispose();
    updates.stop();
    timers.dispose();
    wake.dispose();
    circleService.end();
    void ocr.dispose();
    void features?.dispose();
    settings.flushSync();
    historyStore.flushSync();
    notesStore.flushSync();
    timersStore.flushSync();
    for (const win of BrowserWindow.getAllWindows()) win.removeAllListeners('close');
    tray.destroy();
  });

  // ---- hotkeys, pre-created windows, first run -------------------------------------------------------
  const status = hotkeys.registerAll();
  if (Object.values(status).some((entry) => !entry.registered)) {
    logger.warn(
      'Some hotkeys could not be registered; the user can pick others in Settings > Hotkeys',
    );
  }
  setTimeout(() => {
    assistant.preload();
    wake.evaluate();
    void wake.refreshPower();
  }, 150);
  setTimeout(() => void loadScreenGrabber(logger), 1000);
  // Index the installed (Start menu and packaged) apps so "open <app>" answers instantly.
  setTimeout(() => {
    system
      .refreshApps()
      .catch((error: unknown) => logger.warn('Indexing the installed apps failed', error));
  }, 3000);
  if (!settings.get().onboarding.completed) openers.openOnboarding();
  updates.start();

  if (e2e) {
    (globalThis as Record<string, unknown>)['__beekeeper'] = {
      ctx,
      services,
      router,
      features,
      circle,
      circleService,
      ocr,
      // Summary of a real screenshot of the display under the cursor (no pixels leave the process).
      captureStats: async () => {
        const display = displayUnderCursor();
        const started = performance.now();
        const capture = await captureDisplay(display, screen.getAllDisplays(), logger);
        const elapsedMs = Math.round(performance.now() - started);
        const pixels = capture.image.toBitmap();
        let opaque = true;
        let lit = 0;
        let samples = 0;
        for (let offset = 0; offset + 3 < pixels.length; offset += 4 * 997) {
          samples += 1;
          if (pixels[offset + 3] !== 255) opaque = false;
          if (pixels[offset] || pixels[offset + 1] || pixels[offset + 2]) lit += 1;
        }
        return {
          elapsedMs,
          width: capture.width,
          height: capture.height,
          expected: nativeSize(display),
          opaque,
          litFraction: samples === 0 ? 0 : lit / samples,
        };
      },
      // Saves a screenshot of the display under the cursor, or of a rectangle of it (in DIPs).
      captureRegion: async (
        savePath: string,
        rect?: { x: number; y: number; width: number; height: number },
      ) => {
        const display = displayUnderCursor();
        const capture = await captureDisplay(display, screen.getAllDisplays(), logger);
        let image = capture.image;
        if (rect) {
          const origin = screen.dipToScreenRect(null, display.bounds);
          const target = screen.dipToScreenRect(null, rect);
          const x = Math.max(0, target.x - origin.x);
          const y = Math.max(0, target.y - origin.y);
          image = image.crop({
            x,
            y,
            width: Math.min(capture.width - x, target.width),
            height: Math.min(capture.height - y, target.height),
          });
        }
        await writeFile(savePath, image.toPNG());
      },
    };
  }
  return ctx;
}
