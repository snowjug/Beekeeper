import { describe, expect, it } from 'vitest';
import { SETTINGS_PAGES } from '@shared/ipc/schemas';
import {
  DEFAULT_SECTION,
  isSettingsPage,
  nextTabIndex,
  parseSection,
  SECTIONS,
  sectionMeta,
} from '@renderer/settings/lib/nav';
import { friendlyError } from '@renderer/settings/lib/errors';

describe('sections', () => {
  it('cover exactly the pages the main process knows about, in order', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual([...SETTINGS_PAGES]);
    expect(sectionMeta('ai').title).toContain('Azure');
  });

  it.each([
    ['?section=voice', 'voice'],
    ['?section=about&x=1', 'about'],
    ['?section=nope', DEFAULT_SECTION],
    ['', DEFAULT_SECTION],
    ['?section=', DEFAULT_SECTION],
  ])('parseSection(%j) = %s', (search, expected) => {
    expect(parseSection(search)).toBe(expected);
  });

  it('isSettingsPage only accepts known ids', () => {
    expect(isSettingsPage('hotkeys')).toBe(true);
    expect(isSettingsPage('Hotkeys')).toBe(false);
    expect(isSettingsPage(3)).toBe(false);
  });
});

describe('nextTabIndex (roving focus)', () => {
  it.each([
    [0, 'ArrowDown', 1],
    [7, 'ArrowDown', 0],
    [0, 'ArrowUp', 7],
    [3, 'ArrowRight', 4],
    [3, 'ArrowLeft', 2],
    [5, 'Home', 0],
    [2, 'End', 7],
    [2, 'Enter', null],
    [2, 'a', null],
  ])('index %i + %s -> %s', (index, key, expected) => {
    expect(nextTabIndex(index, key, 8)).toBe(expected);
  });

  it('does nothing for an empty list', () => {
    expect(nextTabIndex(0, 'ArrowDown', 0)).toBeNull();
  });
});

describe('friendlyError', () => {
  it.each([
    [
      "Error invoking remote method 'ai:setKey': Error: Secure storage is not available.",
      'Secure storage is not available.',
    ],
    ['Error: Plain failure', 'Plain failure'],
    ["Error invoking remote method 'x': Forbidden", 'fallback'],
    ['', 'fallback'],
    ['z'.repeat(300), 'fallback'],
  ])('%j', (message, expected) => {
    expect(friendlyError(new Error(message), 'fallback')).toBe(expected);
  });

  it('copes with non-errors', () => {
    expect(friendlyError('text only', 'fallback')).toBe('text only');
    expect(friendlyError(undefined, 'fallback')).toBe('fallback');
  });
});
