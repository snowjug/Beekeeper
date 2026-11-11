import { describe, expect, it } from 'vitest';
import { screenshotCommand } from '@main/commands/system-control/screenshot';
import { lockCommand } from '@main/commands/system-control/lock';
import { SystemError } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf } from '../apps-web/support';

describe('screenshot matching', () => {
  it.each(screenshotCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(screenshotCommand, example)).not.toBeNull();
  });

  it.each([
    'take a screenshot',
    'take screenshot',
    'screenshot',
    'screenshots',
    'take a screen shot',
    'screen shot',
    'grab a screenshot',
    'make a screenshot',
    'take me a screenshot',
    'get a screenshot',
    'do a screen capture',
    'take a screen capture',
    'screen capture',
    'screen grab',
    'capture the screen',
    'capture my screen',
    'capture the whole screen',
    'capture the entire display',
    'snap my screen',
    'snap the screen',
    'grab the desktop',
    'take a screenshot of my screen',
    'take a screenshot of the whole desktop',
    'take a picture of the screen',
    'take a photo of my display',
    'take a snapshot of the monitor',
    'screenshot the screen',
    'Hey Beekeeper, take a screenshot please',
  ])('recognises "%s"', (text) => {
    expect(scoreOf(screenshotCommand, text)).toBe(0.95);
  });

  it.each(['take a screnshot', 'print screen', 'grab a screnshot', 'capture the scren'])(
    'tolerates the garbled "%s" with less confidence',
    (text) => {
      expect(scoreOf(screenshotCommand, text)).toBeGreaterThanOrEqual(0.85);
      expect(scoreOf(screenshotCommand, text)).toBeLessThan(0.95);
    },
  );

  it.each([
    'take a picture',
    'take a note',
    'take a screenshot settings',
    'what is a screenshot',
    'search my screen',
    'circle to search',
    'record my screen',
    'screen',
    'lock screen',
    'open the screen',
    'how do i take a screenshot on a mac',
  ])('does not claim "%s"', (text) => {
    expect(match(screenshotCommand, text)).toBeNull();
  });
});

describe('screenshot run', () => {
  it('shows the saved file with open and reveal buttons', async () => {
    const path = 'C:\\Users\\me\\Pictures\\Beekeeper\\Screenshot 2026-11-10 16-20-53.png';
    const harness = createHarness({
      system: { takeScreenshot: () => Promise.resolve({ path, width: 1920, height: 1080 }) },
    });
    const result = await runCommand(screenshotCommand, {}, harness);

    expect(result.cards).toEqual([
      {
        kind: 'screenshot',
        id: 'card-1',
        createdAt: harness.ctx.now.getTime(),
        path,
        width: 1920,
        height: 1080,
        copyText: path,
        actions: [
          { type: 'path', label: 'Open', path, mode: 'open' },
          { type: 'path', label: 'Show in folder', path, mode: 'reveal' },
        ],
      },
    ]);
    expect(result.speech).toBe('Screenshot saved.');
  });

  it('explains a failed capture', async () => {
    const harness = createHarness({
      system: {
        takeScreenshot: () =>
          Promise.reject(new SystemError('failed', 'Could not capture the screen.')),
      },
    });
    const result = await runCommand(screenshotCommand, {}, harness);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'error',
      title: "I couldn't take a screenshot",
      detail: 'Could not capture the screen.',
    });
    expect(result.speech).toBe("Sorry, I couldn't take a screenshot.");
  });
});

describe('lock matching', () => {
  it.each(lockCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(lockCommand, example)).not.toBeNull();
  });

  it.each([
    'lock my pc',
    'lock the computer',
    'lock screen',
    'lock the screen',
    'lock workstation',
    'lock my laptop',
    'lock this computer',
    'lock my machine',
    'lock windows',
    'lock the system',
    'lock my desktop',
    'lock the pc now',
    'lock my pc please',
    'Hey Beekeeper, lock my computer',
  ])('recognises "%s"', (text) => {
    expect(scoreOf(lockCommand, text)).toBe(0.95);
  });

  it('accepts a bare "lock" with less certainty and tolerates a typo in the verb', () => {
    expect(scoreOf(lockCommand, 'lock')).toBe(0.8);
    expect(scoreOf(lockCommand, 'lcok my pc')).toBe(0.85);
    expect(match(lockCommand, 'lcok')).toBeNull();
  });

  it.each([
    'lock the door',
    'lock my notes',
    'lock screen settings',
    'unlock my pc',
    'open the lock screen settings',
    'block my pc',
    'what is a lock screen',
    'shut down my pc',
  ])('does not claim "%s"', (text) => {
    expect(match(lockCommand, text)).toBeNull();
  });
});

describe('lock run', () => {
  it('locks the PC', async () => {
    const harness = createHarness({ system: { lockWorkstation: () => Promise.resolve() } });
    const result = await runCommand(lockCommand, {}, harness);
    expect(harness.system.lockWorkstation).toHaveBeenCalledTimes(1);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'lock',
      title: 'Locking your PC',
    });
    expect(result.speech).toBe('Locking your PC.');
    expect(result.autoCloseMs).toBe(1000);
  });

  it('explains a failure', async () => {
    const harness = createHarness({
      system: {
        lockWorkstation: () => Promise.reject(new SystemError('failed', 'rundll32 failed.')),
      },
    });
    const result = await runCommand(lockCommand, {}, harness);
    expect(result.cards[0]).toMatchObject({ tone: 'error', title: "I couldn't lock your PC" });
  });
});
