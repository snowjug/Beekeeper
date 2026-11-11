import { describe, expect, it } from 'vitest';
import { openAppCommand } from '@main/commands/apps-web/open-app';
import { SystemError, type AppMatch, type InstalledApp } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from './support';

function hit(name: string, score: number, kind: InstalledApp['kind'] = 'shortcut'): AppMatch {
  return {
    app: { name, key: name.toLowerCase(), kind, target: `C:\\Start Menu\\${name}.lnk` },
    score,
  };
}

describe('open-app matching', () => {
  it.each(openAppCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(openAppCommand, example)).not.toBeNull();
  });

  it.each([
    ['open notepad', 'notepad'],
    ['launch chrome', 'chrome'],
    ['start spotify', 'spotify'],
    ['open vs code', 'vs code'],
    ['fire up calculator', 'calculator'],
    ['run task manager', 'task manager'],
    ['open the file explorer', 'file explorer'],
    ['Hey Beekeeper, please open Notepad', 'notepad'],
    ['could you open my calculator', 'calculator'],
    ['open up chrome', 'chrome'],
    ['load outlook', 'outlook'],
    ['boot up steam', 'steam'],
    ['bring up the calculator', 'calculator'],
    ['open visual studio code', 'visual studio code'],
    ['OPEN   Notepad!', 'notepad'],
  ])('extracts the app from "%s"', (text, query) => {
    expect(slotsOf(openAppCommand, text)).toEqual({ query });
  });

  it('is certain about well-known apps and sites, careful about unknown names', () => {
    expect(scoreOf(openAppCommand, 'open notepad')).toBe(0.93);
    expect(scoreOf(openAppCommand, 'open youtube')).toBe(0.93);
    expect(scoreOf(openAppCommand, 'open discord')).toBe(0.62);
    expect(scoreOf(openAppCommand, 'launch discord')).toBe(0.62);
    // "start" and "run" are used for many other things, so they lose against a better command
    expect(scoreOf(openAppCommand, 'start discord')).toBe(0.52);
    expect(scoreOf(openAppCommand, 'run discord')).toBe(0.52);
  });

  it('tolerates a typo in the verb only for names it knows', () => {
    expect(scoreOf(openAppCommand, 'opne notepad')).toBe(0.85);
    expect(scoreOf(openAppCommand, 'lanuch chrome')).toBe(0.85);
    expect(match(openAppCommand, 'opne frobnicator')).toBeNull();
  });

  it('opens Windows Settings by name, but leaves Beekeeper settings to command 27', () => {
    expect(slotsOf(openAppCommand, 'open the settings app')).toEqual({ query: 'settings app' });
    expect(slotsOf(openAppCommand, 'open windows settings')).toEqual({ query: 'windows settings' });
    for (const phrase of [
      'open settings',
      'open my settings',
      'open the settings',
      'open preferences',
      'launch settings',
    ]) {
      expect(match(openAppCommand, phrase), phrase).toBeNull();
    }
  });

  it.each([
    'open github.com',
    'launch example.org/page',
    'open the website bbc.co.uk',
    'open https://example.com',
    'open wifi settings',
    'open wi-fi settings',
    'open bluetooth',
    'open the display settings',
    'show me the sound settings',
    'open c:\\windows\\system32\\notepad.exe',
    'open ftp://example.com',
    'open',
    'open it',
    'launch that',
    'open everything',
    'what time is it',
    'set a timer for five minutes',
    'start a timer for five minutes',
    'run a marathon every morning before work',
    'open the thing you showed me yesterday please',
  ])('does not claim "%s"', (text) => {
    expect(match(openAppCommand, text)).toBeNull();
  });

  it('treats file-like names as app names, not websites', () => {
    expect(slotsOf(openAppCommand, 'open node.js')).toEqual({ query: 'node.js' });
  });
});

describe('open-app run', () => {
  it('launches the app that clearly matches', async () => {
    const notepad = hit('Notepad', 1, 'builtin');
    const harness = createHarness({
      system: {
        findApps: () => Promise.resolve([notepad, hit('Notepad++', 0.9)]),
        launchApp: () => Promise.resolve(),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'notepad' }, harness);

    expect(harness.system.launchApp).toHaveBeenCalledWith(notepad.app);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'app',
      title: 'Opening Notepad',
    });
    expect(result.speech).toBe('Opening Notepad.');
    expect(result.autoCloseMs).toBe(1500);
  });

  it('launches a good match that is clearly ahead of the runner-up', async () => {
    const harness = createHarness({
      system: {
        findApps: () => Promise.resolve([hit('Spotify', 0.8), hit('Spotify Lite', 0.62)]),
        launchApp: () => Promise.resolve(),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'spotfy' }, harness);
    expect(harness.system.launchApp).toHaveBeenCalledTimes(1);
    expect(result.cards[0]).toMatchObject({ title: 'Opening Spotify' });
  });

  it('asks which app was meant when several are equally close', async () => {
    const harness = createHarness({
      system: {
        findApps: () =>
          Promise.resolve([
            hit('Visual Studio Code', 0.9),
            hit('Visual Studio 2022', 0.88),
            hit('Visual Studio Installer', 0.86),
            hit('Visual Studio Tools', 0.8),
          ]),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'visual studio' }, harness);

    expect(harness.system.launchApp).not.toHaveBeenCalled();
    const [card] = result.cards;
    expect(card).toMatchObject({
      kind: 'status',
      tone: 'warning',
      title: 'Which one did you mean?',
    });
    expect(card).toHaveProperty('actions', [
      { type: 'command', label: 'Open Visual Studio Code', text: 'open visual studio code' },
      { type: 'command', label: 'Open Visual Studio 2022', text: 'open visual studio 2022' },
      {
        type: 'command',
        label: 'Open Visual Studio Installer',
        text: 'open visual studio installer',
      },
    ]);
    expect(result.pin).toBe(true);
  });

  it('suggests a single weak match instead of launching it', async () => {
    const harness = createHarness({
      system: { findApps: () => Promise.resolve([hit('Notepad', 0.62)]) },
    });
    const result = await runCommand(openAppCommand, { query: 'note' }, harness);
    expect(harness.system.launchApp).not.toHaveBeenCalled();
    expect(result.cards[0]).toMatchObject({ title: 'Did you mean Notepad?' });
    expect(result.speech).toBe('Did you mean Notepad?');
  });

  it('opens a well-known website when no app has that name', async () => {
    const harness = createHarness({ system: { findApps: () => Promise.resolve([]) } });
    const result = await runCommand(openAppCommand, { query: 'youtube' }, harness);

    expect(harness.ui.openExternal).toHaveBeenCalledWith('https://www.youtube.com/');
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'web',
      title: 'Opening YouTube',
      openUrl: 'https://www.youtube.com/',
    });
    expect(result.autoCloseMs).toBe(1500);
  });

  it('prefers an app with exactly that name over the website', async () => {
    const harness = createHarness({
      system: {
        findApps: () => Promise.resolve([hit('GitHub', 1)]),
        launchApp: () => Promise.resolve(),
      },
    });
    await runCommand(openAppCommand, { query: 'github' }, harness);
    expect(harness.system.launchApp).toHaveBeenCalledTimes(1);
    expect(harness.ui.openExternal).not.toHaveBeenCalled();
  });

  it('prefers the website over an app that only starts with the name', async () => {
    const harness = createHarness({
      system: { findApps: () => Promise.resolve([hit('GitHub Desktop', 0.9)]) },
    });
    await runCommand(openAppCommand, { query: 'github' }, harness);
    expect(harness.ui.openExternal).toHaveBeenCalledWith('https://github.com/');
    expect(harness.system.launchApp).not.toHaveBeenCalled();
  });

  it('still opens a known website when the app lookup fails', async () => {
    const harness = createHarness({
      system: { findApps: () => Promise.reject(new SystemError('timeout', 'too slow')) },
    });
    await runCommand(openAppCommand, { query: 'reddit' }, harness);
    expect(harness.ui.openExternal).toHaveBeenCalledWith('https://www.reddit.com/');
  });

  it('offers a web search when nothing matches', async () => {
    const harness = createHarness({ system: { findApps: () => Promise.resolve([]) } });
    const result = await runCommand(openAppCommand, { query: 'frobnicator' }, harness);

    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'warning',
      title: 'I couldn\'t find "frobnicator"',
      actions: [{ type: 'command', label: 'Search the web', text: 'search for frobnicator' }],
    });
    expect(result.speech).toBe("I couldn't find frobnicator.");
  });

  it('explains a failed app lookup', async () => {
    const harness = createHarness({
      system: {
        findApps: () => Promise.reject(new SystemError('timeout', 'PowerShell took too long.')),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'frobnicator' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'error',
      title: "I couldn't look through your apps",
      detail: 'PowerShell took too long.',
    });
  });

  it('reports an app that could not be started', async () => {
    const harness = createHarness({
      system: {
        findApps: () => Promise.resolve([hit('Notepad', 1)]),
        launchApp: () =>
          Promise.reject(new SystemError('not-found', 'The shortcut no longer exists.')),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'notepad' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'warning',
      title: "I couldn't open Notepad",
      detail: 'The shortcut no longer exists.',
    });
    expect(result.speech).toBe("Sorry, I couldn't open Notepad.");
  });

  it('survives unexpected errors with a generic message', async () => {
    const harness = createHarness({
      system: {
        findApps: () => Promise.resolve([hit('Notepad', 1)]),
        launchApp: () => Promise.reject(new Error('boom')),
      },
    });
    const result = await runCommand(openAppCommand, { query: 'notepad' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'error',
      detail: 'Something unexpected went wrong. Please try again.',
    });
  });

  it.each([
    ['returns false', false],
    ['throws', () => Promise.reject(new Error('no browser'))],
  ] as const)('explains a browser that %s', async (_label, openExternal) => {
    const harness = createHarness({
      system: { findApps: () => Promise.resolve([]) },
      openExternal,
    });
    const result = await runCommand(openAppCommand, { query: 'youtube' }, harness);
    expect(result.cards[0]).toMatchObject({ tone: 'error', title: "I couldn't open your browser" });
  });
});
