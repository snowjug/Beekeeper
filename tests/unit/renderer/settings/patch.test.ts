import { describe, expect, it } from 'vitest';
import { applyPatch, deepEqual, isNoopPatch, patchOf } from '@renderer/settings/lib/patch';
import { makeView } from './support';

describe('patchOf', () => {
  it('builds a patch with exactly one key of one section', () => {
    expect(patchOf('general', 'theme', 'dark')).toEqual({ general: { theme: 'dark' } });
    expect(patchOf('voice', 'ttsRate', 1.4)).toEqual({ voice: { ttsRate: 1.4 } });
  });
});

describe('applyPatch', () => {
  it('overlays the patch without mutating the original or touching other sections', () => {
    const view = makeView((draft) => {
      draft.secrets.speechKey = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b';
    });
    const next = applyPatch(view, { general: { theme: 'light' }, privacy: { saveHistory: false } });

    expect(next.general.theme).toBe('light');
    expect(next.general.units).toBe(view.general.units);
    expect(next.privacy.saveHistory).toBe(false);
    expect(next.secrets).toBe(view.secrets);
    expect(next.hotkeys).toBe(view.hotkeys);
    expect(view.general.theme).toBe('system');
    expect(view.privacy.saveHistory).toBe(true);
  });

  it('replaces a nested object as a whole, exactly like the main process does', () => {
    const next = applyPatch(makeView(), {
      general: { weatherLocation: { mode: 'manual', city: 'Oslo' } },
    });
    expect(next.general.weatherLocation).toEqual({ mode: 'manual', city: 'Oslo' });
  });
});

describe('isNoopPatch', () => {
  const view = makeView((draft) => {
    draft.general.weatherLocation = { mode: 'manual', city: 'Oslo' };
  });

  it.each([
    ['an unchanged primitive', { general: { theme: 'system' } }, true],
    ['a changed primitive', { general: { theme: 'dark' } }, false],
    [
      'an equal nested object',
      { general: { weatherLocation: { city: 'Oslo', mode: 'manual' } } },
      true,
    ],
    [
      'a changed nested object',
      { general: { weatherLocation: { mode: 'manual', city: 'Rome' } } },
      false,
    ],
    ['an empty patch', {}, true],
    ['an empty section', { voice: {} }, true],
  ] as const)('%s', (_name, patch, expected) => {
    expect(isNoopPatch(view, patch)).toBe(expected);
  });
});

describe('deepEqual', () => {
  it('compares primitives, arrays and plain objects structurally', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});
