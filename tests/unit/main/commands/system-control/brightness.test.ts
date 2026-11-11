import { describe, expect, it } from 'vitest';
import { brightnessCommand, type BrightnessSlots } from '@main/commands/system-control/brightness';
import { SystemError } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from '../apps-web/support';

const up = (amount = 10): BrightnessSlots => ({ action: 'step', direction: 'up', amount });
const down = (amount = 10): BrightnessSlots => ({ action: 'step', direction: 'down', amount });
const set = (percent: number): BrightnessSlots => ({ action: 'set', percent });

describe('brightness matching', () => {
  it.each(brightnessCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(brightnessCommand, example)).not.toBeNull();
  });

  it.each([
    ['brightness up', up()],
    ['brightness down', down()],
    ['increase the brightness', up()],
    ['decrease brightness by 20', down(20)],
    ['turn the brightness up', up()],
    ['turn up the brightness', up()],
    ['turn the brightness down', down()],
    ['lower the brightness', down()],
    ['raise the brightness by 15', up(15)],
    ['reduce the screen brightness', down()],
    ['display brightness up', up()],
    ['dim the screen', down()],
    ['dim my display', down()],
    ['dim the monitor', down()],
    ['dim it', down()],
    ['dim', down()],
    ['dim the screen by 20', down(20)],
    ['dim the laptop screen a bit', down()],
    ['brighten the screen', up()],
    ['brighten my display by 30', up(30)],
    ['make the screen brighter', up()],
    ['make the screen dimmer', down()],
    ['make the display darker', down()],
    ['make it brighter', up()],
    ['brighter', up()],
    ['dimmer', down()],
    ['darker', down()],
    ['a bit brighter', up()],
    ['a little dimmer', down()],
  ] as const)('"%s" changes the brightness by steps', (text, slots) => {
    expect(slotsOf(brightnessCommand, text)).toEqual(slots);
  });

  it.each([
    ['set brightness to 70%', set(70)],
    ['brightness 70', set(70)],
    ['set the screen brightness to 50 percent', set(50)],
    ['brightness at forty', set(40)],
    ['make the brightness 80', set(80)],
    ['set my display brightness to 0', set(0)],
    ['turn the brightness to 30', set(30)],
    ['max brightness', set(100)],
    ['half brightness', set(50)],
    ['minimum brightness', set(0)],
    ['set brightness to maximum', set(100)],
    ['set brightness to 120', set(100)],
  ] as const)('"%s" sets the brightness', (text, slots) => {
    expect(slotsOf(brightnessCommand, text)).toEqual(slots);
  });

  it.each([
    "what's the brightness",
    'what is the screen brightness',
    'check the brightness',
    'brightness level',
    'brightness',
  ])('"%s" asks for the brightness', (text) => {
    expect(slotsOf(brightnessCommand, text)).toEqual({ action: 'get' });
  });

  it('is surest for explicit levels and steps', () => {
    expect(scoreOf(brightnessCommand, 'set brightness to 70%')).toBe(0.95);
    expect(scoreOf(brightnessCommand, 'brightness up')).toBe(0.95);
    expect(scoreOf(brightnessCommand, 'dim the screen')).toBe(0.92);
    expect(scoreOf(brightnessCommand, "what's the brightness")).toBe(0.9);
    expect(scoreOf(brightnessCommand, 'brightness')).toBe(0.7);
  });

  it.each([
    'brightness settings',
    'display settings',
    'open display settings',
    'turn it down',
    'turn it up',
    'louder',
    'volume up',
    'dim the lights',
    'make it brighter in here please and quickly',
    'brightness 20 30',
    'what is the brightness of the sun',
    'set a timer for 5 minutes',
  ])('does not claim "%s"', (text) => {
    expect(match(brightnessCommand, text)).toBeNull();
  });
});

describe('brightness run', () => {
  it('steps up from the current level', async () => {
    const harness = createHarness({
      system: {
        getBrightness: () => Promise.resolve(50),
        setBrightness: (percent) => Promise.resolve(percent),
      },
    });
    const result = await runCommand(brightnessCommand, up(20), harness);

    expect(harness.system.setBrightness).toHaveBeenCalledWith(70);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'brightness',
      title: 'Brightness 70%',
    });
    expect(result.speech).toBe('Brightness 70 percent.');
    expect(result.autoCloseMs).toBe(2500);
  });

  it('never goes below 0 or above 100', async () => {
    const harness = createHarness({
      system: {
        getBrightness: () => Promise.resolve(5),
        setBrightness: (percent) => Promise.resolve(percent),
      },
    });
    await runCommand(brightnessCommand, down(30), harness);
    expect(harness.system.setBrightness).toHaveBeenLastCalledWith(0);

    harness.system.getBrightness.mockResolvedValue(95);
    await runCommand(brightnessCommand, up(30), harness);
    expect(harness.system.setBrightness).toHaveBeenLastCalledWith(100);
  });

  it('shows the level the panel really applied', async () => {
    const harness = createHarness({
      system: { setBrightness: () => Promise.resolve(68) },
    });
    const result = await runCommand(brightnessCommand, set(70), harness);
    expect(harness.system.setBrightness).toHaveBeenCalledWith(70);
    expect(result.cards[0]).toMatchObject({ title: 'Brightness 68%' });
  });

  it('answers a question without changing anything', async () => {
    const harness = createHarness({ system: { getBrightness: () => Promise.resolve(80) } });
    const result = await runCommand(brightnessCommand, { action: 'get' }, harness);
    expect(result.cards[0]).toMatchObject({ tone: 'neutral', title: 'Brightness 80%' });
    expect(harness.system.setBrightness).not.toHaveBeenCalled();
  });

  it.each([
    ['a step', up()],
    ['a question', { action: 'get' } as const],
  ])('explains displays without brightness control for %s', async (_label, slots) => {
    const harness = createHarness({ system: { getBrightness: () => Promise.resolve(null) } });
    const result = await runCommand(brightnessCommand, slots, harness);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'warning',
      icon: 'brightness',
      title: "Brightness can't be changed here",
    });
    expect(harness.system.setBrightness).not.toHaveBeenCalled();
    expect(result.speech).toBe("This display doesn't support brightness control.");
  });

  it('explains an unsupported display when setting directly', async () => {
    const harness = createHarness({
      system: {
        setBrightness: () =>
          Promise.reject(new SystemError('unsupported', 'No brightness control.')),
      },
    });
    const result = await runCommand(brightnessCommand, set(70), harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'warning',
      title: "Brightness can't be changed here",
    });
  });

  it('reports real failures', async () => {
    const harness = createHarness({
      system: { getBrightness: () => Promise.reject(new SystemError('timeout', 'Too slow.')) },
    });
    const change = await runCommand(brightnessCommand, up(), harness);
    expect(change.cards[0]).toMatchObject({
      tone: 'error',
      title: "I couldn't change the brightness",
      detail: 'Too slow.',
    });
    const read = await runCommand(brightnessCommand, { action: 'get' }, harness);
    expect(read.cards[0]).toMatchObject({ title: "I couldn't read the brightness" });
  });
});
