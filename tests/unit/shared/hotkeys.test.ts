import { describe, expect, it } from 'vitest';
import {
  captureAccelerator,
  formatAccelerator,
  isTypingCombo,
  keyCodeFor,
  normalizeAccelerator,
  parseAccelerator,
  releasesAccelerator,
  suggestAlternative,
  toElectronAccelerator,
} from '@shared/hotkeys';

describe('parseAccelerator', () => {
  it.each([
    ['Ctrl+Shift+Space', ['Ctrl', 'Shift'], 'Space'],
    ['control+alt+b', ['Ctrl', 'Alt'], 'B'],
    ['CommandOrControl+Shift+F9', ['Ctrl', 'Shift'], 'F9'],
    ['alt + shift + c', ['Alt', 'Shift'], 'C'],
    ['Win+Escape', ['Win'], 'Escape'],
    ['Super+1', ['Win'], '1'],
    ['Shift+Ctrl+Alt+Up', ['Ctrl', 'Alt', 'Shift'], 'Up'],
    ['Ctrl+,', ['Ctrl'], ','],
  ])('parses %s', (input, modifiers, key) => {
    expect(parseAccelerator(input)).toEqual({ modifiers, key });
  });

  it.each([
    '',
    'Space',
    'Ctrl',
    'Ctrl+Shift',
    'Ctrl+A+B',
    'Ctrl+Banana',
    'Ctrl++',
    '+Ctrl+A',
    'F5',
    // Names that exist on every JavaScript object are not keys or modifiers.
    'Ctrl+constructor',
    'Ctrl+__proto__',
    'constructor+A',
    'Ctrl+Space+constructor',
  ])('rejects %j', (input) => {
    expect(parseAccelerator(input)).toBeNull();
  });
});

describe('accelerator formatting', () => {
  it('normalises to a canonical modifier order', () => {
    expect(normalizeAccelerator('shift+ctrl+space')).toBe('Ctrl+Shift+Space');
    expect(normalizeAccelerator('nope')).toBeNull();
    const parsed = parseAccelerator('alt+ctrl+q');
    expect(parsed && formatAccelerator(parsed)).toBe('Ctrl+Alt+Q');
  });

  it('converts to Electron syntax', () => {
    expect(toElectronAccelerator('Ctrl+Shift+Space')).toBe('Control+Shift+Space');
    expect(toElectronAccelerator('Win+Alt+K')).toBe('Alt+Super+K');
    expect(toElectronAccelerator('bad')).toBeNull();
  });

  it('flags combos that would break typing', () => {
    expect(isTypingCombo({ modifiers: ['Shift'], key: 'A' })).toBe(true);
    expect(isTypingCombo({ modifiers: ['Shift'], key: 'Space' })).toBe(false);
    expect(isTypingCombo({ modifiers: ['Ctrl', 'Shift'], key: 'A' })).toBe(false);
  });
});

describe('push-to-talk key release', () => {
  const parsed = parseAccelerator('Ctrl+Shift+Space');
  if (!parsed) throw new Error('fixture must parse');

  it('ends on releasing the main key or any modifier', () => {
    expect(releasesAccelerator({ code: 'Space', key: ' ' }, parsed)).toBe(true);
    expect(releasesAccelerator({ code: 'ControlLeft', key: 'Control' }, parsed)).toBe(true);
    expect(releasesAccelerator({ code: 'ShiftRight', key: 'Shift' }, parsed)).toBe(true);
  });

  it('ignores unrelated keys', () => {
    expect(releasesAccelerator({ code: 'KeyA', key: 'a' }, parsed)).toBe(false);
    expect(releasesAccelerator({ code: 'AltLeft', key: 'Alt' }, parsed)).toBe(false);
  });

  it('maps letters, digits, function and arrow keys to key codes', () => {
    expect(keyCodeFor('C')).toBe('KeyC');
    expect(keyCodeFor('7')).toBe('Digit7');
    expect(keyCodeFor('F9')).toBe('F9');
    expect(keyCodeFor('Up')).toBe('ArrowUp');
    expect(keyCodeFor('Banana')).toBeNull();
    const circle = parseAccelerator('Alt+Shift+C');
    expect(circle && releasesAccelerator({ code: 'KeyC', key: 'c' }, circle)).toBe(true);
  });
});

describe('captureAccelerator', () => {
  const keys = (
    code: string,
    mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
  ) =>
    captureAccelerator({
      code,
      ctrlKey: mods.ctrl ?? false,
      altKey: mods.alt ?? false,
      shiftKey: mods.shift ?? false,
      metaKey: mods.meta ?? false,
    });

  it.each([
    ['Space', { ctrl: true, shift: true }, ['Ctrl', 'Shift'], 'Space'],
    ['KeyC', { alt: true, shift: true }, ['Alt', 'Shift'], 'C'],
    ['Digit7', { ctrl: true }, ['Ctrl'], '7'],
    ['F9', { ctrl: true, alt: true }, ['Ctrl', 'Alt'], 'F9'],
    ['ArrowUp', { meta: true }, ['Win'], 'Up'],
    ['Comma', { ctrl: true }, ['Ctrl'], ','],
  ])('reads %s', (code, mods, modifiers, key) => {
    expect(keys(code, mods)).toEqual({ modifiers, key });
  });

  it('reports held modifiers without a main key yet', () => {
    expect(keys('ControlLeft', { ctrl: true })).toEqual({ modifiers: ['Ctrl'], key: null });
    expect(keys('ShiftRight', { ctrl: true, shift: true })).toEqual({
      modifiers: ['Ctrl', 'Shift'],
      key: null,
    });
  });

  it('ignores unsupported keys and produces parseable accelerators', () => {
    expect(keys('Numpad5', { ctrl: true }).key).toBeNull();
    const captured = keys('KeyB', { ctrl: true, alt: true });
    expect(parseAccelerator([...captured.modifiers, captured.key ?? ''].join('+'))).toEqual(
      captured,
    );
  });
});

describe('suggestAlternative', () => {
  it('skips taken combinations in any spelling', () => {
    expect(suggestAlternative([])).toBe('Ctrl+Alt+Space');
    expect(suggestAlternative(['ctrl+alt+space'])).toBe('Ctrl+Shift+B');
    expect(suggestAlternative(['Ctrl+Alt+Space', 'Ctrl+Shift+B', 'alt+shift+space'])).toBe(
      'Ctrl+Alt+B',
    );
  });

  it('returns null when everything is taken', () => {
    const all = [
      'Ctrl+Alt+Space',
      'Ctrl+Shift+B',
      'Alt+Shift+Space',
      'Ctrl+Alt+B',
      'Ctrl+Shift+F9',
      'Ctrl+Alt+F10',
    ];
    expect(suggestAlternative(all)).toBeNull();
  });
});
