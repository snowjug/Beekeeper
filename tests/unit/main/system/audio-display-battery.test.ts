import { describe, expect, it, vi } from 'vitest';
import { createAudioApi, parseVolumeState } from '@main/system/audio';
import { createBatteryApi, parseBattery } from '@main/system/battery';
import { createDisplayApi, parseBrightness } from '@main/system/display';
import { SystemError } from '@main/system/types';
import { fakeRunner } from './support';

describe('audio', () => {
  it('parses and clamps the helper reply', () => {
    expect(parseVolumeState({ percent: 42, muted: false })).toEqual({ percent: 42, muted: false });
    expect(parseVolumeState({ percent: 41.6, muted: true })).toEqual({ percent: 42, muted: true });
    expect(parseVolumeState({ percent: 140, muted: false }).percent).toBe(100);
    expect(parseVolumeState({ percent: -5, muted: false }).percent).toBe(0);
  });

  it.each([
    null,
    undefined,
    'x',
    {},
    { percent: '40', muted: false },
    { percent: 40 },
    { muted: true },
  ])('rejects the reply %j', (reply) => {
    expect(() => parseVolumeState(reply)).toThrowError(/unexpected reply/);
  });

  it('reads, sets, adjusts and mutes through audio.ps1', async () => {
    const { runner, calls } = fakeRunner(() => ({ percent: 33, muted: false }));
    const audio = createAudioApi(runner);

    expect(await audio.getVolume()).toEqual({ percent: 33, muted: false });
    await audio.setVolume(40.4);
    await audio.setVolume(250);
    await audio.setVolume(-3);
    await audio.adjustVolume(-15);
    await audio.adjustVolume(500);
    await audio.setMuted(true);
    await audio.setMuted(false);

    expect(calls.map((call) => [call.script, call.args])).toEqual([
      ['audio', { Action: 'get' }],
      ['audio', { Action: 'set', Percent: 40 }],
      ['audio', { Action: 'set', Percent: 100 }],
      ['audio', { Action: 'set', Percent: 0 }],
      ['audio', { Action: 'adjust', Delta: -15 }],
      ['audio', { Action: 'adjust', Delta: 100 }],
      ['audio', { Action: 'mute' }],
      ['audio', { Action: 'unmute' }],
    ]);
  });

  it('rejects numbers that are not numbers before running anything', async () => {
    const { runner, calls } = fakeRunner(() => ({ percent: 1, muted: false }));
    const audio = createAudioApi(runner);
    await expect(audio.setVolume(Number.NaN)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(audio.setVolume(Number.POSITIVE_INFINITY)).rejects.toBeInstanceOf(SystemError);
    await expect(audio.adjustVolume(Number.NaN)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(calls).toHaveLength(0);
  });

  it('passes helper failures on', async () => {
    const { runner } = fakeRunner(() => {
      throw new SystemError('unsupported', 'No audio output device is available.');
    });
    await expect(createAudioApi(runner).getVolume()).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('brightness', () => {
  it('parses the helper reply', () => {
    expect(parseBrightness({ supported: true, percent: 80 })).toBe(80);
    expect(parseBrightness({ supported: true, percent: 80.4 })).toBe(80);
    expect(parseBrightness({ supported: true, percent: 130 })).toBe(100);
    expect(parseBrightness({ supported: false, percent: null })).toBeNull();
    expect(parseBrightness({ supported: true, percent: null })).toBeNull();
  });

  it.each([null, {}, { supported: 'yes' }, 'x', 7])('rejects the reply %j', (reply) => {
    expect(() => parseBrightness(reply)).toThrowError(/unexpected reply/);
  });

  it('reads the level, or null on displays without software brightness', async () => {
    const supported = createDisplayApi(fakeRunner(() => ({ supported: true, percent: 55 })).runner);
    expect(await supported.getBrightness()).toBe(55);

    const desktop = createDisplayApi(
      fakeRunner(() => ({ supported: false, percent: null })).runner,
    );
    expect(await desktop.getBrightness()).toBeNull();

    const reported = createDisplayApi(
      fakeRunner(() => {
        throw new SystemError('unsupported', 'No brightness control.');
      }).runner,
    );
    expect(await reported.getBrightness()).toBeNull();

    const broken = createDisplayApi(
      fakeRunner(() => {
        throw new SystemError('timeout', 'Too slow.');
      }).runner,
    );
    await expect(broken.getBrightness()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('sets a clamped, rounded level and returns what the panel applied', async () => {
    const { runner, calls } = fakeRunner(() => ({ supported: true, percent: 69 }));
    const display = createDisplayApi(runner);
    expect(await display.setBrightness(70.2)).toBe(69);
    await display.setBrightness(300);
    await display.setBrightness(-10);
    expect(calls.map((call) => call.args)).toEqual([
      { Action: 'set', Percent: 70 },
      { Action: 'set', Percent: 100 },
      { Action: 'set', Percent: 0 },
    ]);
  });

  it('throws unsupported when the display cannot be controlled', async () => {
    const display = createDisplayApi(
      fakeRunner(() => ({ supported: false, percent: null })).runner,
    );
    await expect(display.setBrightness(50)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(display.setBrightness(Number.NaN)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('battery', () => {
  it('reports a PC without a battery as always on AC', () => {
    expect(parseBattery({ hasBattery: false })).toEqual({
      hasBattery: false,
      charging: false,
      onAc: true,
    });
  });

  it.each([
    // plugged in and charging, flags from the ACPI class
    [
      {
        hasBattery: true,
        percent: 80,
        status: 2,
        charging: true,
        powerOnline: true,
        runTimeMinutes: 71582788,
      },
      { hasBattery: true, percent: 80, charging: true, onAc: true },
    ],
    // plugged in, not charging (battery protection or full)
    [
      {
        hasBattery: true,
        percent: 99,
        status: 2,
        charging: false,
        powerOnline: true,
        runTimeMinutes: 71582788,
      },
      { hasBattery: true, percent: 99, charging: false, onAc: true },
    ],
    // on battery with an estimate
    [
      {
        hasBattery: true,
        percent: 54,
        status: 1,
        charging: false,
        powerOnline: false,
        runTimeMinutes: 123,
      },
      { hasBattery: true, percent: 54, charging: false, onAc: false, minutesRemaining: 123 },
    ],
    // no ACPI flags: derive from the BatteryStatus code
    [
      {
        hasBattery: true,
        percent: 40,
        status: 6,
        charging: null,
        powerOnline: null,
        runTimeMinutes: 71582788,
      },
      { hasBattery: true, percent: 40, charging: true, onAc: true },
    ],
    [
      {
        hasBattery: true,
        percent: 15,
        status: 4,
        charging: null,
        powerOnline: null,
        runTimeMinutes: 20,
      },
      { hasBattery: true, percent: 15, charging: false, onAc: false, minutesRemaining: 20 },
    ],
    [
      { hasBattery: true, percent: 100, status: 3, runTimeMinutes: null },
      { hasBattery: true, percent: 100, charging: false, onAc: true },
    ],
    [
      { hasBattery: true, percent: 70, status: 2 },
      { hasBattery: true, percent: 70, charging: false, onAc: true },
    ],
    // unknown status and values out of range
    [
      { hasBattery: true, percent: 120, status: 10, runTimeMinutes: 0 },
      { hasBattery: true, percent: 100, charging: false, onAc: true },
    ],
    [
      { hasBattery: true, percent: null, status: null },
      { hasBattery: true, charging: false, onAc: true },
    ],
    [
      { hasBattery: true, percent: 33.4, status: 1, runTimeMinutes: -5 },
      { hasBattery: true, percent: 33, charging: false, onAc: false },
    ],
  ])('interprets %j', (raw, expected) => {
    expect(parseBattery(raw)).toEqual(expected);
  });

  it.each([null, {}, { hasBattery: 'yes' }, [], 'x'])('rejects the reply %j', (reply) => {
    expect(() => parseBattery(reply)).toThrowError(/unexpected reply/);
  });

  it('reads the battery through battery.ps1', async () => {
    const { runner, calls } = fakeRunner(() => ({ hasBattery: false }));
    expect(await createBatteryApi(runner).getBattery()).toMatchObject({ hasBattery: false });
    expect(calls).toEqual([{ script: 'battery', args: {}, options: {} }]);
  });

  it('does not hide helper failures', async () => {
    const run = vi.fn(() => Promise.reject(new SystemError('failed', 'WMI is broken.')));
    await expect(createBatteryApi({ run }).getBattery()).rejects.toMatchObject({
      message: 'WMI is broken.',
    });
  });
});
