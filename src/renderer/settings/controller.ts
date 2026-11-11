import type { Bridge } from '@shared/ipc/bridge';
import type { InvokeInput } from '@shared/ipc/schemas';
import type { AiTestResult, HotkeyId, HotkeySetResult, ToastEvent } from '@shared/ipc/types';
import type { SettingsPatch, SettingsView } from '@shared/settings';
import { showToast } from '@renderer/components/Toast';
import { friendlyError, toError } from './lib/errors';
import type { SettingsPage } from './lib/nav';
import { deepEqual, isNoopPatch } from './lib/patch';
import { createSettingsStore, reconcile, type SettingsState, type SettingsStore } from './store';

export type SettingsBridge = Bridge<'settings'>;
export type SecretName = InvokeInput<'ai:setKey'>['name'];

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * Everything the settings window does with the main process. Sections only talk to this class (and
 * read its store), which keeps them thin and lets tests drive the whole window with a fake bridge.
 */
export class SettingsController {
  readonly store: SettingsStore;
  private nextPatchId = 1;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    readonly bridge: SettingsBridge,
    store: SettingsStore = createSettingsStore(),
  ) {
    this.store = store;
  }

  /** Subscribes to main-process events and loads the first data. Returns the cleanup function. */
  start(): () => void {
    const { bridge, store } = this;
    const offs = [
      bridge.on('settings:changed', (view) => this.confirm(view)),
      bridge.on('theme:changed', ({ theme }) => applyTheme(theme)),
      bridge.on('settings:navigate', ({ section }) => this.navigate(section)),
      bridge.on('updates:state', (updates) => store.setState({ updates })),
      bridge.on('voice:modelProgress', (model) => store.setState({ model })),
      bridge.on('voice:wakeStatus', (wake) => store.setState({ wake })),
      bridge.on('toast:show', (toast) => this.showMainToast(toast)),
    ];
    const onFocus = (): void => void this.refreshHotkeys();
    window.addEventListener('focus', onFocus);
    void this.load();
    return () => {
      for (const off of offs) off();
      window.removeEventListener('focus', onFocus);
    };
  }

  /** Loads the settings (blocking the page) and everything else (filling in as it arrives). */
  async load(): Promise<void> {
    const { bridge, store } = this;
    store.setState({ phase: 'loading', loadError: null });
    void this.syncInfo();
    void this.refreshHotkeys();
    void bridge
      .invoke('voice:modelStatus')
      .then((model) => store.setState({ model }))
      .catch((error: unknown) => this.report('voice:modelStatus', error));
    void bridge
      .invoke('updates:state')
      .then((updates) => store.setState({ updates }))
      .catch((error: unknown) => this.report('updates:state', error));
    try {
      const view = await bridge.invoke('settings:get');
      store.setState((state) => ({
        phase: 'ready',
        loadError: null,
        committed: view,
        view: reconcile(view, state.inflight),
      }));
    } catch (error) {
      this.report('settings:get', error, 'error');
      store.setState({
        phase: 'error',
        loadError: friendlyError(error, 'Beekeeper could not read your settings.'),
      });
    }
  }

  navigate(section: SettingsPage): void {
    this.store.setState({ section });
  }

  /**
   * Applies a minimal patch at once (optimistic) and reconciles with the confirmed view. When the
   * main process rejects it the change is rolled back and an error toast explains why.
   */
  async update(patch: SettingsPatch): Promise<boolean> {
    const current = this.store.getState().view;
    if (current === null) return false;
    if (isNoopPatch(current, patch)) return true;

    const id = this.nextPatchId++;
    this.store.setState((state) =>
      this.withInflight(state.committed, [...state.inflight, { id, patch }]),
    );
    const request = this.track(this.bridge.invoke('settings:update', patch));
    try {
      this.settle(id, await request);
      if (patch.general?.theme !== undefined) void this.syncInfo();
      return true;
    } catch (error) {
      this.settle(id);
      this.report('settings:update', error);
      showToast({
        title: 'Could not save that setting',
        message: friendlyError(error, 'Your previous value was kept. Try again in a moment.'),
        tone: 'error',
      });
      return false;
    }
  }

  /** Resolves once every change made so far has been confirmed or rolled back. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** Runs `task`; a failure becomes an error toast (never an unhandled rejection). */
  async run<T>(
    failure: string,
    task: (bridge: SettingsBridge) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await task(this.bridge);
    } catch (error) {
      this.report(failure, error);
      showToast({
        title: failure,
        message: friendlyError(error, 'Try again in a moment.'),
        tone: 'error',
      });
      return undefined;
    }
  }

  async setHotkey(id: HotkeyId, accelerator: string): Promise<HotkeySetResult> {
    const result = await this.bridge.invoke('hotkeys:set', { id, accelerator });
    void this.refreshHotkeys();
    return result;
  }

  async refreshHotkeys(): Promise<void> {
    try {
      this.store.setState({ hotkeys: await this.bridge.invoke('hotkeys:status') });
    } catch (error) {
      this.report('hotkeys:status', error);
    }
  }

  /** Stores an API key in the main process. Rejects with the main process' explanation. */
  async setKey(name: SecretName, value: string): Promise<void> {
    this.confirm(await this.bridge.invoke('ai:setKey', { name, value }));
  }

  async clearKey(name: SecretName): Promise<void> {
    this.confirm(await this.bridge.invoke('ai:clearKey', { name }));
  }

  /** Tests the saved Azure settings. A failing handler becomes a friendly "could not run" result. */
  async testService(service: SecretName): Promise<AiTestResult> {
    await this.flush();
    try {
      return await this.bridge.invoke('ai:test', { service });
    } catch (error) {
      this.report(`ai:test:${service}`, error);
      return { ok: false, message: 'Could not run the test. Please try again in a moment.' };
    }
  }

  async checkForUpdates(): Promise<void> {
    this.store.setState({ updates: { status: 'checking' } });
    try {
      this.store.setState({ updates: await this.bridge.invoke('updates:check') });
    } catch (error) {
      this.report('updates:check', error);
      this.store.setState({
        updates: {
          status: 'error',
          message: friendlyError(error, 'Could not check for updates. Are you online?'),
        },
      });
    }
  }

  async ensureModel(): Promise<void> {
    const model = await this.run('Could not start the download', (bridge) =>
      bridge.invoke('voice:modelEnsure'),
    );
    if (model) this.store.setState({ model });
  }

  async cancelModel(): Promise<void> {
    const model = await this.run('Could not cancel the download', (bridge) =>
      bridge.invoke('voice:modelCancel'),
    );
    if (model) this.store.setState({ model });
  }

  async removeModel(): Promise<void> {
    const model = await this.run('Could not remove the voice model', (bridge) =>
      bridge.invoke('voice:modelRemove'),
    );
    if (model) this.store.setState({ model });
  }

  /** Opens an https link in the default browser (the main process validates it). */
  async openExternal(url: string): Promise<void> {
    const opened = await this.run('Could not open the link', (bridge) =>
      bridge.invoke('app:openExternal', { url }),
    );
    if (opened === false) {
      showToast({ title: 'Could not open the link', message: url, tone: 'error' });
    }
  }

  async copyText(text: string, what: string): Promise<void> {
    const copied = await this.run('Could not copy to the clipboard', async (bridge) => {
      await bridge.invoke('app:copyText', { text });
      return true;
    });
    if (copied) showToast({ title: `${what} copied`, tone: 'success', durationMs: 2500 });
  }

  /** Writes a line to the main-process log (never include secrets). */
  report(scope: string, error: unknown, level: 'warn' | 'error' = 'warn'): void {
    const failure = toError(error);
    void this.bridge
      .invoke('app:log', {
        level,
        scope: `settings:${scope}`.slice(0, 40),
        message: failure.message.slice(0, 3900),
        ...(failure.stack ? { stack: failure.stack.slice(0, 7900) } : {}),
      })
      .catch(() => undefined);
  }

  private async syncInfo(): Promise<void> {
    try {
      const info = await this.bridge.invoke('app:info');
      this.store.setState({ info });
      applyTheme(info.theme);
    } catch (error) {
      this.report('app:info', error);
    }
  }

  /** A confirmed view from the main process (event or response). */
  private confirm(view: SettingsView): void {
    const previous = this.store.getState().committed;
    this.store.setState((state) => ({
      committed: view,
      view: reconcile(view, state.inflight),
    }));
    if (previous && !deepEqual(previous.hotkeys, view.hotkeys)) void this.refreshHotkeys();
  }

  private withInflight(
    committed: SettingsView | null,
    inflight: SettingsState['inflight'],
  ): Pick<SettingsState, 'inflight' | 'view'> {
    return { inflight, view: reconcile(committed, inflight) };
  }

  private settle(id: number, confirmed?: SettingsView): void {
    this.store.setState((state) => {
      const committed = confirmed ?? state.committed;
      const inflight = state.inflight.filter((entry) => entry.id !== id);
      return { committed, ...this.withInflight(committed, inflight) };
    });
  }

  private track<T>(request: Promise<T>): Promise<T> {
    const settled = request.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled));
    return request;
  }

  private showMainToast(toast: ToastEvent): void {
    const installs = toast.action?.id === 'install-update';
    showToast({
      title: toast.title,
      tone: toast.tone,
      durationMs: installs ? 0 : 5000,
      ...(toast.message ? { message: toast.message } : {}),
      ...(installs && toast.action
        ? {
            action: {
              label: toast.action.label,
              onClick: () => {
                void this.run('Could not restart Beekeeper', (bridge) =>
                  bridge.invoke('updates:install'),
                );
              },
            },
          }
        : {}),
    });
  }
}
