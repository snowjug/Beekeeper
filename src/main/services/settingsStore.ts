import {
  applySettingsPatch,
  parseStoredSettings,
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
} from '@shared/settings';
import { silentLogger, type Logger } from '@shared/logger';
import { JsonStore } from './jsonStore';

export type SettingsListener = (next: Settings, previous: Settings) => void;

export interface SettingsStoreOptions {
  filePath: string;
  logger?: Logger;
  debounceMs?: number;
}

/** Validated, persisted settings with change notifications ("apply live without restart"). */
export class SettingsStore {
  private readonly store: JsonStore<Settings>;
  private readonly listeners = new Set<SettingsListener>();

  constructor(options: SettingsStoreOptions) {
    this.store = new JsonStore<Settings>({
      filePath: options.filePath,
      defaults: () => structuredClone(DEFAULT_SETTINGS),
      parse: parseStoredSettings,
      logger: options.logger ?? silentLogger,
      ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    });
  }

  get(): Settings {
    return this.store.get();
  }

  /** Merges a validated patch, persists it and notifies listeners once. */
  update(patch: SettingsPatch): Settings {
    const previous = this.store.get();
    const next = applySettingsPatch(previous, patch);
    this.commit(next, previous);
    return next;
  }

  /** Replaces one hotkey after the HotkeyManager registered it successfully. */
  setHotkey(id: keyof Settings['hotkeys'], accelerator: string): Settings {
    const previous = this.store.get();
    const next: Settings = { ...previous, hotkeys: { ...previous.hotkeys, [id]: accelerator } };
    this.commit(next, previous);
    return next;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  flushSync(): void {
    this.store.flushSync();
  }

  private commit(next: Settings, previous: Settings): void {
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    this.store.set(next);
    for (const listener of this.listeners) {
      try {
        listener(next, previous);
      } catch {
        // A failing listener must not block the others or the save.
      }
    }
  }
}
