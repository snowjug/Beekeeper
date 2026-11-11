import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';

const shortcuts = vi.hoisted(() => {
  const callbacks = new Map<string, () => void>();
  const taken = new Set<string>();
  return {
    callbacks,
    taken,
    register: vi.fn((accelerator: string, callback: () => void): boolean => {
      if (taken.has(accelerator) || callbacks.has(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string): void => {
      callbacks.delete(accelerator);
    }),
    unregisterAll: vi.fn((): void => {
      callbacks.clear();
    }),
  };
});

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, callback: () => void): boolean =>
      shortcuts.register(accelerator, callback),
    unregister: (accelerator: string): void => shortcuts.unregister(accelerator),
    unregisterAll: (): void => shortcuts.unregisterAll(),
  },
}));

const { HotkeyManager } = await import('@main/hotkeys');

const warn = vi.fn();
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };

function setup(
  hotkeys: Record<'assistant' | 'circle' | 'capture' | 'dictation', string> = {
    assistant: 'Ctrl+Shift+Space',
    circle: 'Alt+Shift+C',
    capture: 'Alt+Shift+S',
    dictation: 'Alt+Shift+D',
  },
) {
  const stored = { ...hotkeys };
  const setHotkey = vi.fn((id: keyof typeof stored, accelerator: string) => {
    stored[id] = accelerator;
  });
  const trigger = vi.fn();
  const settings = {
    get: () => ({ hotkeys: stored }),
    setHotkey,
  };
  const manager = new HotkeyManager({ settings: settings as never, logger, trigger });
  return { manager, trigger, setHotkey, stored };
}

describe('HotkeyManager', () => {
  beforeEach(() => {
    shortcuts.callbacks.clear();
    shortcuts.taken.clear();
    shortcuts.register.mockClear();
    shortcuts.unregister.mockClear();
    shortcuts.unregisterAll.mockClear();
    warn.mockClear();
  });

  it('registers both shortcuts in Electron syntax and triggers the matching action', () => {
    const { manager, trigger } = setup();
    const status = manager.registerAll();
    expect(status).toEqual({
      assistant: { accelerator: 'Ctrl+Shift+Space', registered: true },
      circle: { accelerator: 'Alt+Shift+C', registered: true },
      capture: { accelerator: 'Alt+Shift+S', registered: true },
      dictation: { accelerator: 'Alt+Shift+D', registered: true },
    });
    expect([...shortcuts.callbacks.keys()].sort()).toEqual([
      'Alt+Shift+C',
      'Alt+Shift+D',
      'Alt+Shift+S',
      'Control+Shift+Space',
    ]);

    shortcuts.callbacks.get('Control+Shift+Space')?.();
    shortcuts.callbacks.get('Alt+Shift+C')?.();
    expect(trigger.mock.calls).toEqual([['assistant'], ['circle']]);
  });

  it('reports a shortcut that another application owns, without giving up on the other one', () => {
    shortcuts.taken.add('Alt+Shift+C');
    const { manager } = setup();
    const status = manager.registerAll();
    expect(status.assistant.registered).toBe(true);
    expect(status.circle).toMatchObject({
      accelerator: 'Alt+Shift+C',
      registered: false,
      error: 'Already in use by another application',
    });
    expect(warn).toHaveBeenCalled();
  });

  it('survives Electron throwing while it registers', () => {
    shortcuts.register.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { manager } = setup();
    expect(manager.registerAll().assistant.registered).toBe(false);
  });

  it('re-registers everything after sleep or unlock', () => {
    const { manager } = setup();
    manager.registerAll();
    shortcuts.callbacks.clear();
    const status = manager.refresh();
    expect(shortcuts.unregisterAll).toHaveBeenCalled();
    expect(status.assistant.registered && status.circle.registered).toBe(true);
    expect(shortcuts.callbacks.size).toBe(4);
  });

  describe('changing a shortcut', () => {
    it('applies a free combination and stores it', () => {
      const { manager, setHotkey, trigger } = setup();
      manager.registerAll();
      const result = manager.set('assistant', 'ctrl+alt+b');
      expect(result).toEqual({ ok: true, accelerator: 'Ctrl+Alt+B' });
      expect(setHotkey).toHaveBeenCalledWith('assistant', 'Ctrl+Alt+B');
      expect(shortcuts.callbacks.has('Control+Shift+Space')).toBe(false);
      shortcuts.callbacks.get('Control+Alt+B')?.();
      expect(trigger).toHaveBeenCalledWith('assistant');
    });

    it('refuses text that is not a shortcut and combinations that would break typing', () => {
      const { manager } = setup();
      manager.registerAll();
      expect(manager.set('assistant', 'banana')).toMatchObject({ ok: false, reason: 'invalid' });
      expect(manager.set('assistant', 'Shift+A')).toMatchObject({ ok: false, reason: 'reserved' });
    });

    it("refuses the other action's combination, in any spelling, and suggests a free one", () => {
      const { manager } = setup();
      manager.registerAll();
      const result = manager.set('assistant', 'alt + shift + c');
      expect(result).toMatchObject({ ok: false, reason: 'conflict' });
      if (result.ok || result.reason !== 'conflict') throw new Error('expected a conflict');
      expect(result.message).toContain('Circle to Search');
      expect(result.suggestion).toBeDefined();
    });

    it('keeps the previous shortcut when the new one belongs to another application', () => {
      const { manager, setHotkey } = setup();
      manager.registerAll();
      shortcuts.taken.add('Control+Alt+K');
      const result = manager.set('assistant', 'Ctrl+Alt+K');
      expect(result).toMatchObject({ ok: false, reason: 'conflict' });
      expect(result.ok).toBe(false);
      expect(setHotkey).not.toHaveBeenCalled();
      // The old combination works again, so the user is never left without one.
      expect(shortcuts.callbacks.has('Control+Shift+Space')).toBe(true);
      expect(manager.status().assistant).toEqual({
        accelerator: 'Ctrl+Shift+Space',
        registered: true,
      });
    });

    it('probes suggestions so it never proposes a combination that is taken', () => {
      const { manager } = setup();
      manager.registerAll();
      shortcuts.taken.add('Control+Alt+K');
      const result = manager.set('assistant', 'Ctrl+Alt+K');
      if (result.ok || result.reason !== 'conflict') throw new Error('expected a conflict');
      expect(result.suggestion).not.toBe('Ctrl+Alt+K');
      // Probing registers and releases the candidate again.
      expect(shortcuts.callbacks.has(result.suggestion ?? '')).toBe(false);
    });
  });

  it('releases every shortcut on dispose', () => {
    const { manager } = setup();
    manager.registerAll();
    manager.dispose();
    expect(shortcuts.callbacks.size).toBe(0);
  });
});
