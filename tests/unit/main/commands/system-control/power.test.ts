import { describe, expect, it } from 'vitest';
import { powerCommand, type PowerAction } from '@main/commands/system-control/power';
import { createHarness, match, runCommand, scoreOf, slotsOf } from '../apps-web/support';

describe('power matching', () => {
  it.each(powerCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(powerCommand, example)).not.toBeNull();
  });

  it.each([
    ['shut down', 'shutdown'],
    ['shutdown', 'shutdown'],
    ['shut down now', 'shutdown'],
    ['shut down my pc', 'shutdown'],
    ['shut down the computer', 'shutdown'],
    ['shut down my laptop', 'shutdown'],
    ['shutdown the system', 'shutdown'],
    ['turn off my computer', 'shutdown'],
    ['turn off the pc', 'shutdown'],
    ['turn off this machine', 'shutdown'],
    ['turn off windows', 'shutdown'],
    ['power off the pc', 'shutdown'],
    ['power off my computer right now', 'shutdown'],
    ['power down', 'shutdown'],
    ['power off', 'shutdown'],
    ['switch off my laptop', 'shutdown'],
    ['shut it down', 'shutdown'],
    ['restart', 'restart'],
    ['reboot', 'restart'],
    ['re-boot', 'restart'],
    ['restart now', 'restart'],
    ['restart my computer', 'restart'],
    ['reboot the pc', 'restart'],
    ['restart this laptop', 'restart'],
    ['power cycle the machine', 'restart'],
    ['put the computer to sleep', 'sleep'],
    ['put my pc to sleep', 'sleep'],
    ['put this laptop in sleep mode', 'sleep'],
    ['put the computer into standby', 'sleep'],
    ['put it to sleep', 'sleep'],
    ['go to sleep', 'sleep'],
    ['go into sleep mode', 'sleep'],
    ['enter sleep mode', 'sleep'],
    ['sleep mode', 'sleep'],
    ['sleep', 'sleep'],
    ['sleep my pc', 'sleep'],
    ['sleep the computer', 'sleep'],
    ['hibernate', 'sleep'],
    ['hibernate my laptop', 'sleep'],
    ['put the computer in hibernation', 'sleep'],
    ['suspend', 'sleep'],
    ['Hey Beekeeper, please shut down my computer', 'shutdown'],
  ] as const)('"%s" means %s', (text, action) => {
    expect(slotsOf(powerCommand, text)).toEqual({ action });
  });

  it('is surest when the computer is named', () => {
    expect(scoreOf(powerCommand, 'shut down my pc')).toBe(0.97);
    expect(scoreOf(powerCommand, 'restart my computer')).toBe(0.97);
    expect(scoreOf(powerCommand, 'put the computer to sleep')).toBe(0.97);
    expect(scoreOf(powerCommand, 'shutdown')).toBe(0.9);
    expect(scoreOf(powerCommand, 'sleep')).toBe(0.88);
  });

  it.each([
    'shut down notepad',
    'shut down chrome',
    'turn off dark mode',
    'turn off the lights',
    'turn off the sound',
    'turn off wifi',
    'turn on my computer',
    'restart notepad',
    'restart the timer',
    'restart the router',
    'reboot the server',
    'sleep timer',
    'set a sleep timer for 10 minutes',
    'put the baby to sleep',
    'go to bed',
    'how do i shut down windows 11',
    'what does hibernate do',
    'power',
    'power on',
    'off',
    'close my pc',
    'log off',
    'sign out',
  ])('does not claim "%s"', (text) => {
    expect(match(powerCommand, text)).toBeNull();
  });
});

describe('power run', () => {
  const copy: ReadonlyArray<readonly [PowerAction, string, string, string]> = [
    ['shutdown', 'Shut down this PC?', 'Shut down', 'Shut down your PC? Please confirm.'],
    ['restart', 'Restart this PC?', 'Restart', 'Restart your PC? Please confirm.'],
    ['sleep', 'Put this PC to sleep?', 'Sleep', 'Put your PC to sleep? Please confirm.'],
  ];

  it.each(copy)(
    '%s always needs a confirmation with a 10 second countdown',
    async (action, title, label, speech) => {
      const harness = createHarness({ system: { power: () => Promise.resolve() } });
      const result = await runCommand(powerCommand, { action }, harness);

      // The command itself never touches the power state.
      expect(harness.system.power).not.toHaveBeenCalled();
      expect(harness.confirmations).toHaveLength(1);
      const [request] = harness.confirmations;
      expect(request).toMatchObject({
        action,
        title,
        confirmLabel: label,
        danger: true,
        countdownSeconds: 10,
      });
      expect(request?.detail).toContain('10 seconds after you confirm');
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        kind: 'confirm',
        action,
        danger: true,
        countdownSeconds: 10,
      });
      expect(result.speech).toBe(speech);
      expect(result.pin).toBe(true);

      // The confirmation service calls run() after the user confirmed and the countdown elapsed.
      await request?.run();
      expect(harness.system.power).toHaveBeenCalledExactlyOnceWith(action);
    },
  );
});
