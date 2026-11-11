import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecureKeys, type SecretCipher } from '@main/services/secureKeys';
import { SettingsStore } from '@main/services/settingsStore';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beekeeper-svc-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('starts from defaults and persists patches', async () => {
    const filePath = join(dir, 'settings.json');
    const store = new SettingsStore({ filePath });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.update({ voice: { wakeWord: true }, general: { theme: 'dark' } });
    await store.flush();
    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as typeof DEFAULT_SETTINGS;
    expect(saved.voice.wakeWord).toBe(true);
    expect(saved.general.theme).toBe('dark');
    expect(new SettingsStore({ filePath }).get().voice.wakeWord).toBe(true);
  });

  it('notifies listeners once per real change and survives a throwing listener', () => {
    const store = new SettingsStore({ filePath: join(dir, 's.json') });
    const seen = vi.fn<(next: Settings, previous: Settings) => void>();
    store.onChange(() => {
      throw new Error('boom');
    });
    const unsubscribe = store.onChange(seen);
    store.update({ voice: { ttsRate: 1.25 } });
    store.update({ voice: { ttsRate: 1.25 } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0].voice.ttsRate).toBe(1.25);
    expect(seen.mock.calls[0]?.[1].voice.ttsRate).toBe(1);
    unsubscribe();
    store.update({ voice: { ttsRate: 1.5 } });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stores hotkeys separately and recovers from a corrupt file', () => {
    const filePath = join(dir, 'c.json');
    writeFileSync(filePath, '{ nope', 'utf8');
    const store = new SettingsStore({ filePath });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.setHotkey('circle', 'Ctrl+Alt+C').hotkeys.circle).toBe('Ctrl+Alt+C');
    store.flushSync();
    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Settings;
    expect(saved.hotkeys.circle).toBe('Ctrl+Alt+C');
  });

  it('rejects patches that break validation', () => {
    const store = new SettingsStore({ filePath: join(dir, 'v.json') });
    expect(() => store.update({ voice: { ttsRate: 99 } })).toThrow();
    expect(store.get().voice.ttsRate).toBe(1);
  });
});

function fakeCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain.split('').reverse().join('')}`),
    decryptString: (buffer) => {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('bad cipher text');
      return text.slice(4).split('').reverse().join('');
    },
  };
}

describe('SecureKeys', () => {
  it('encrypts at rest, decrypts on demand and masks for the UI', async () => {
    const filePath = join(dir, 'secrets.json');
    const keys = new SecureKeys({ filePath, cipher: fakeCipher() });
    expect(keys.has('speech')).toBe(false);
    await keys.set('speech', 'super-secret-key-1234');
    const onDisk = readFileSync(filePath, 'utf8');
    expect(onDisk).not.toContain('super-secret-key-1234');
    expect(keys.get('speech')).toBe('super-secret-key-1234');
    expect(keys.mask('speech')).toBe('••••••••1234');
    expect(new SecureKeys({ filePath, cipher: fakeCipher() }).get('speech')).toBe(
      'super-secret-key-1234',
    );
    await keys.delete('speech');
    expect(keys.get('speech')).toBeNull();
    expect(keys.mask('speech')).toBeNull();
  });

  it('refuses to store anything when encryption is unavailable', async () => {
    const keys = new SecureKeys({ filePath: join(dir, 's.json'), cipher: fakeCipher(false) });
    expect(keys.encryptionAvailable).toBe(false);
    await expect(keys.set('openai', 'abcdefgh')).rejects.toThrow(/not available/);
    expect(keys.has('openai')).toBe(false);
  });

  it('falls back to environment values without persisting them', async () => {
    const filePath = join(dir, 'f.json');
    const keys = new SecureKeys({
      filePath,
      cipher: fakeCipher(),
      fallbacks: { openai: 'from-env-9999' },
    });
    expect(keys.get('openai')).toBe('from-env-9999');
    expect(keys.mask('openai')).toBe('••••••••9999');
    await keys.set('openai', 'user-entered-0000');
    expect(keys.get('openai')).toBe('user-entered-0000');
    await keys.delete('openai');
    expect(keys.get('openai')).toBe('from-env-9999');
  });

  it('treats undecryptable entries as missing', () => {
    const filePath = join(dir, 'bad.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        entries: { speech: Buffer.from('garbage').toString('base64') },
      }),
      'utf8',
    );
    const warn = vi.fn();
    const keys = new SecureKeys({
      filePath,
      cipher: fakeCipher(),
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(keys.get('speech')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
