import { describe, expect, it } from 'vitest';
import { darkModeCommand, type DarkModeSlots } from '@main/commands/system-control/dark-mode';
import { SystemError } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from '../apps-web/support';

describe('dark mode matching', () => {
  it.each(darkModeCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(darkModeCommand, example)).not.toBeNull();
  });

  it.each([
    ['toggle dark mode', 'toggle'],
    ['toggle the dark mode', 'toggle'],
    ['toggle light mode', 'toggle'],
    ['toggle theme', 'toggle'],
    ['toggle the theme', 'toggle'],
    ['switch theme', 'toggle'],
    ['switch dark mode', 'toggle'],
    ['flip dark mode', 'toggle'],
    ['change the theme', 'toggle'],
    ['swap the theme', 'toggle'],
    ['switch to dark mode', 'dark'],
    ['switch to the dark theme', 'dark'],
    ['change to dark mode', 'dark'],
    ['go to dark mode', 'dark'],
    ['enable dark mode', 'dark'],
    ['enable the dark theme', 'dark'],
    ['turn on dark mode', 'dark'],
    ['turn on the dark theme', 'dark'],
    ['switch on dark mode', 'dark'],
    ['activate dark mode', 'dark'],
    ['use dark mode', 'dark'],
    ['use the dark theme', 'dark'],
    ['set to dark mode', 'dark'],
    ['put it in dark mode', 'dark'],
    ['put windows in dark mode', 'dark'],
    ['turn off light mode', 'dark'],
    ['disable light mode', 'dark'],
    ['disable the light theme', 'dark'],
    ['dark mode', 'dark'],
    ['dark theme', 'dark'],
    ['dark mode on', 'dark'],
    ['light mode off', 'dark'],
    ['switch to light mode', 'light'],
    ['switch to the light theme', 'light'],
    ['change to light mode', 'light'],
    ['enable light mode', 'light'],
    ['turn on light mode', 'light'],
    ['use the light theme', 'light'],
    ['go to light mode', 'light'],
    ['turn off dark mode', 'light'],
    ['disable dark mode', 'light'],
    ['disable the dark theme', 'light'],
    ['stop using dark mode', 'light'],
    ['light mode', 'light'],
    ['light theme', 'light'],
    ['light mode on', 'light'],
    ['dark mode off', 'light'],
    ['Hey Beekeeper, please switch to dark mode', 'dark'],
  ] as const)('"%s" means %s', (text, mode) => {
    expect(slotsOf(darkModeCommand, text)).toEqual({ mode });
  });

  it('is surer about explicit requests than about a bare "dark mode"', () => {
    expect(scoreOf(darkModeCommand, 'toggle dark mode')).toBe(0.95);
    expect(scoreOf(darkModeCommand, 'switch to dark mode')).toBe(0.97);
    expect(scoreOf(darkModeCommand, 'turn off dark mode')).toBe(0.97);
    expect(scoreOf(darkModeCommand, 'dark mode')).toBe(0.85);
  });

  it.each([
    'dark',
    'mode',
    'theme',
    'toggle',
    'toggle the lights',
    'switch apps',
    'switch to notepad',
    'turn off the lights',
    'turn off my computer',
    'turn on the sound',
    'what is dark mode',
    'how do i enable dark mode on my phone please tell me',
    'night mode',
    'enable night light',
    'open display settings',
    'change my wallpaper',
  ])('does not claim "%s"', (text) => {
    expect(match(darkModeCommand, text)).toBeNull();
  });
});

describe('dark mode run', () => {
  it.each([
    [{ mode: 'dark' }, 'dark', 'Dark mode on'],
    [{ mode: 'light' }, 'light', 'Light mode on'],
    [{ mode: 'toggle' }, 'light', 'Light mode on'],
    [{ mode: 'toggle' }, 'dark', 'Dark mode on'],
  ] as const satisfies ReadonlyArray<readonly [DarkModeSlots, 'dark' | 'light', string]>)(
    'asks for %j and reports the theme that is active (%s)',
    async (slots, applied, title) => {
      const harness = createHarness({ system: { setDarkMode: () => Promise.resolve(applied) } });
      const result = await runCommand(darkModeCommand, slots, harness);

      expect(harness.system.setDarkMode).toHaveBeenCalledWith(slots.mode);
      expect(result.cards[0]).toMatchObject({
        kind: 'status',
        tone: 'success',
        icon: 'moon',
        title,
      });
      expect(result.speech).toBe(`${title}.`);
      expect(result.autoCloseMs).toBe(1800);
    },
  );

  it('explains a failure', async () => {
    const harness = createHarness({
      system: {
        setDarkMode: () => Promise.reject(new SystemError('failed', 'Registry access denied.')),
      },
    });
    const result = await runCommand(darkModeCommand, { mode: 'toggle' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'error',
      title: "I couldn't change the theme",
      detail: 'Registry access denied.',
    });
  });
});
