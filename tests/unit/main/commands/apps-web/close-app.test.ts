import { describe, expect, it, vi } from 'vitest';
import { closeAppCommand } from '@main/commands/apps-web/close-app';
import { SystemError, type CloseAppResult } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from './support';

const process = (name: string, pid = 100) => ({ pid, name, title: `${name} window` });

describe('close-app matching', () => {
  it.each(closeAppCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(closeAppCommand, example)).not.toBeNull();
  });

  it.each([
    ['close notepad', 'notepad'],
    ['quit chrome', 'chrome'],
    ['exit spotify', 'spotify'],
    ['kill task manager', 'task manager'],
    ['shut down notepad', 'notepad'],
    ['terminate chrome', 'chrome'],
    ['force quit chrome', 'chrome'],
    ['force close vs code', 'vs code'],
    ['close the calculator', 'calculator'],
    ['close down spotify', 'spotify'],
    ['close the chrome window', 'chrome'],
    ['end task chrome', 'chrome'],
    ['end task manager', 'task manager'],
    ['please quit the Spotify app', 'spotify'],
    ['Hey Beekeeper, close Notepad', 'notepad'],
  ])('extracts the app from "%s"', (text, query) => {
    expect(slotsOf(closeAppCommand, text)).toEqual({ query });
  });

  it('is more careful with unknown names and blunt verbs', () => {
    expect(scoreOf(closeAppCommand, 'close notepad')).toBe(0.93);
    expect(scoreOf(closeAppCommand, 'close discord')).toBe(0.62);
    expect(scoreOf(closeAppCommand, 'kill discord')).toBe(0.58);
    expect(scoreOf(closeAppCommand, 'clsoe notepad')).toBe(0.85);
  });

  it('forgives typos only in the everyday verbs and for known apps', () => {
    expect(match(closeAppCommand, 'clsoe frobnicator')).toBeNull();
    expect(match(closeAppCommand, 'edit notepad')).toBeNull();
    expect(match(closeAppCommand, 'exti notepad')).toBeNull();
  });

  it.each([
    'shut down',
    'shutdown',
    'shut down my pc',
    'shut down the computer',
    'shut down my laptop',
    'shut down now',
    'close',
    'close it',
    'close that',
    'close this window',
    'close the window',
    'close all windows',
    'close everything',
    'close this tab',
    'close the assistant',
    'close beekeeper',
    'quit',
    'exit',
    'stop notepad',
    'open notepad',
    'close the door and turn off all the lights in the house',
  ])('does not claim "%s"', (text) => {
    expect(match(closeAppCommand, text)).toBeNull();
  });
});

describe('close-app run', () => {
  it('reports a closed app', async () => {
    const closeApp = vi.fn(() =>
      Promise.resolve<CloseAppResult>({ status: 'closed', processes: [process('notepad')] }),
    );
    const harness = createHarness({ system: { closeApp } });
    const result = await runCommand(closeAppCommand, { query: 'notepad' }, harness);

    expect(closeApp).toHaveBeenCalledWith('notepad');
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      title: 'Closed Notepad',
    });
    expect(result.speech).toBe('Closed Notepad.');
    expect(result.autoCloseMs).toBe(1500);
  });

  it('uses the friendly app name from the alias table', async () => {
    const harness = createHarness({
      system: {
        closeApp: () => Promise.resolve({ status: 'closed', processes: [process('code')] }),
      },
    });
    const result = await runCommand(closeAppCommand, { query: 'vs code' }, harness);
    expect(result.cards[0]).toMatchObject({ title: 'Closed Visual Studio Code' });
  });

  it('says so when the app is not running', async () => {
    const harness = createHarness({
      system: { closeApp: () => Promise.resolve({ status: 'not-running', processes: [] }) },
    });
    const result = await runCommand(closeAppCommand, { query: 'chrome' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'neutral',
      title: "Google Chrome isn't running",
    });
    expect(result.speech).toBe("Google Chrome isn't running.");
  });

  it('asks before force closing and only then kills', async () => {
    const closeApp = vi.fn((_query: string, options?: { force?: boolean }) =>
      Promise.resolve<CloseAppResult>(
        options?.force === true
          ? { status: 'closed', processes: [process('notepad')] }
          : { status: 'needs-force', processes: [process('notepad')] },
      ),
    );
    const harness = createHarness({ system: { closeApp } });
    const result = await runCommand(closeAppCommand, { query: 'notepad' }, harness);

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(harness.confirmations).toHaveLength(1);
    const [request] = harness.confirmations;
    expect(request).toMatchObject({
      action: 'force-close',
      title: "Notepad didn't close",
      confirmLabel: 'Force close',
      danger: true,
    });
    expect(result.cards[0]).toMatchObject({ kind: 'confirm', action: 'force-close', danger: true });
    expect(result.pin).toBe(true);

    await request?.run();
    expect(closeApp).toHaveBeenLastCalledWith('notepad', { force: true });
  });

  it('explains protected processes and other failures without throwing', async () => {
    const protectedProcess = createHarness({
      system: {
        closeApp: () =>
          Promise.reject(
            new SystemError(
              'unsupported',
              "File Explorer is part of Windows, so I won't close it.",
            ),
          ),
      },
    });
    const refused = await runCommand(closeAppCommand, { query: 'explorer' }, protectedProcess);
    expect(refused.cards[0]).toMatchObject({
      tone: 'warning',
      title: "I couldn't close File Explorer",
      detail: "File Explorer is part of Windows, so I won't close it.",
    });

    const broken = createHarness({ system: { closeApp: () => Promise.reject(new Error('boom')) } });
    const failed = await runCommand(closeAppCommand, { query: 'notepad' }, broken);
    expect(failed.cards[0]).toMatchObject({ tone: 'error' });
  });
});
