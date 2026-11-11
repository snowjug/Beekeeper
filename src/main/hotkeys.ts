import { globalShortcut } from 'electron';
import {
  formatAccelerator,
  isTypingCombo,
  parseAccelerator,
  suggestAlternative,
  toElectronAccelerator,
} from '@shared/hotkeys';
import type { HotkeyId, HotkeySetResult, HotkeyStatus } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import type { SettingsStore } from './services/settingsStore';

const IDS: readonly HotkeyId[] = ['assistant', 'circle', 'capture', 'dictation'];

const LABELS: Record<HotkeyId, string> = {
  assistant: 'the assistant',
  circle: 'Circle to Search',
  capture: 'Capture Studio',
  dictation: 'dictation',
};

export interface HotkeyManagerDeps {
  settings: SettingsStore;
  logger: Logger;
  trigger: (id: HotkeyId) => void;
}

interface Entry {
  accelerator: string;
  registered: boolean;
  error?: string;
}

/**
 * Registers the global hotkeys (spec 4.1 / 4.5 / 4.7): detects conflicts with other apps, suggests
 * a free alternative, restores the previous binding when a change fails, and re-registers after
 * sleep/resume or screen unlock.
 */
export class HotkeyManager {
  private readonly entries = new Map<HotkeyId, Entry>();

  constructor(private readonly deps: HotkeyManagerDeps) {}

  /** Registers both hotkeys from settings and reports the outcome. */
  registerAll(): HotkeyStatus {
    const configured = this.deps.settings.get().hotkeys;
    for (const id of IDS) this.apply(id, configured[id]);
    return this.status();
  }

  status(): HotkeyStatus {
    const configured = this.deps.settings.get().hotkeys;
    const read = (id: HotkeyId): HotkeyStatus[HotkeyId] => {
      const entry = this.entries.get(id);
      const accelerator = entry?.accelerator ?? configured[id];
      return {
        accelerator,
        registered: entry?.registered ?? false,
        ...(entry?.error ? { error: entry.error } : {}),
      };
    };
    return Object.fromEntries(IDS.map((id) => [id, read(id)])) as HotkeyStatus;
  }

  /** Re-registers everything (resume from sleep, session unlock, display changes). */
  refresh(): HotkeyStatus {
    globalShortcut.unregisterAll();
    this.entries.clear();
    return this.registerAll();
  }

  set(id: HotkeyId, requested: string): HotkeySetResult {
    const parsed = parseAccelerator(requested);
    if (!parsed) {
      return {
        ok: false,
        reason: 'invalid',
        message: 'Use at least one modifier (Ctrl, Alt, Shift or Win) plus one key.',
      };
    }
    if (isTypingCombo(parsed)) {
      return {
        ok: false,
        reason: 'reserved',
        message: 'Shift plus a letter or digit would interfere with typing. Add Ctrl or Alt.',
      };
    }

    const accelerator = formatAccelerator(parsed);
    const current = this.status();
    const taken = IDS.map((other) => current[other].accelerator);
    const clash = IDS.find(
      (other) =>
        other !== id && current[other].accelerator.toLowerCase() === accelerator.toLowerCase(),
    );
    if (clash) {
      return this.conflict(`${accelerator} is already used for ${LABELS[clash]}.`, taken);
    }

    const previous = this.entries.get(id);
    this.unregister(id);
    if (this.apply(id, accelerator)) {
      this.deps.settings.setHotkey(id, accelerator);
      return { ok: true, accelerator };
    }

    // Restore what worked before so the user is never left without a hotkey.
    if (previous?.registered) this.apply(id, previous.accelerator);
    return this.conflict(`${accelerator} is already in use by another application.`, [
      accelerator,
      ...taken,
    ]);
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.entries.clear();
  }

  private conflict(message: string, taken: string[]): HotkeySetResult {
    const suggestion = this.firstFreeAlternative(taken);
    return {
      ok: false,
      reason: 'conflict',
      message: suggestion ? `${message} Try ${suggestion}.` : message,
      ...(suggestion ? { suggestion } : {}),
    };
  }

  private firstFreeAlternative(taken: string[]): string | undefined {
    const skip = [...taken];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = suggestAlternative(skip);
      if (!candidate) return undefined;
      if (this.probe(candidate)) return candidate;
      skip.push(candidate);
    }
    return undefined;
  }

  /** True when the combination is currently free (registers and immediately releases it). */
  private probe(accelerator: string): boolean {
    const electronAccelerator = toElectronAccelerator(accelerator);
    if (!electronAccelerator) return false;
    try {
      const free = globalShortcut.register(electronAccelerator, () => undefined);
      if (free) globalShortcut.unregister(electronAccelerator);
      return free;
    } catch {
      return false;
    }
  }

  private apply(id: HotkeyId, accelerator: string): boolean {
    const electronAccelerator = toElectronAccelerator(accelerator);
    if (!electronAccelerator) {
      this.entries.set(id, { accelerator, registered: false, error: 'Invalid shortcut' });
      return false;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(electronAccelerator, () => this.deps.trigger(id));
    } catch (error) {
      this.deps.logger.warn(`Hotkey ${accelerator} threw while registering`, error);
    }
    this.entries.set(id, {
      accelerator,
      registered: ok,
      ...(ok ? {} : { error: 'Already in use by another application' }),
    });
    if (!ok) this.deps.logger.warn(`Hotkey ${accelerator} (${id}) could not be registered`);
    return ok;
  }

  private unregister(id: HotkeyId): void {
    const entry = this.entries.get(id);
    if (!entry?.registered) return;
    const electronAccelerator = toElectronAccelerator(entry.accelerator);
    if (electronAccelerator) globalShortcut.unregister(electronAccelerator);
    this.entries.delete(id);
  }
}
