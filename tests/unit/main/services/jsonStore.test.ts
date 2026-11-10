import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '@main/services/jsonStore';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beekeeper-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('starts with defaults when the file is missing', () => {
    const store = new JsonStore({
      filePath: join(dir, 'a.json'),
      defaults: () => ({ items: [] as string[] }),
    });
    expect(store.get()).toEqual({ items: [] });
  });

  it('persists changes atomically and reloads them', async () => {
    const filePath = join(dir, 'nested', 'a.json');
    const store = new JsonStore({ filePath, defaults: () => ({ items: [] as string[] }) });
    store.update((draft) => {
      draft.items.push('one');
    });
    await store.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ items: ['one'] });
    expect(readdirSync(join(dir, 'nested'))).toEqual(['a.json']);

    const reloaded = new JsonStore({ filePath, defaults: () => ({ items: [] as string[] }) });
    expect(reloaded.get().items).toEqual(['one']);
  });

  it('supports replacing the value and debounced writes', async () => {
    const filePath = join(dir, 'b.json');
    const store = new JsonStore<number[]>({ filePath, defaults: () => [], debounceMs: 10 });
    store.set([1, 2]);
    store.update((current) => [...current, 3]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([1, 2, 3]);
  });

  it('quarantines corrupt files and falls back to defaults', () => {
    const filePath = join(dir, 'c.json');
    writeFileSync(filePath, '{ not json', 'utf8');
    const store = new JsonStore({ filePath, defaults: () => ({ ok: true }) });
    expect(store.get()).toEqual({ ok: true });
    expect(readdirSync(dir).some((name) => name.startsWith('c.json.corrupt-'))).toBe(true);
  });

  it('rejects values that fail the custom parser', () => {
    const filePath = join(dir, 'd.json');
    writeFileSync(filePath, JSON.stringify({ version: 'wrong' }), 'utf8');
    const store = new JsonStore({
      filePath,
      defaults: () => ({ version: 1 }),
      parse: (raw) => {
        if (
          typeof raw === 'object' &&
          raw !== null &&
          (raw as { version?: unknown }).version === 1
        ) {
          return raw as { version: number };
        }
        throw new Error('bad version');
      },
    });
    expect(store.get()).toEqual({ version: 1 });
  });

  it('flushes synchronously for process exit', () => {
    const filePath = join(dir, 'e.json');
    const store = new JsonStore<string[]>({ filePath, defaults: () => [] });
    store.set(['bye']);
    store.flushSync();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(['bye']);
    store.flushSync();
  });
});
