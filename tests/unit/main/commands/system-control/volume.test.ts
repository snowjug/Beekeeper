import { describe, expect, it } from 'vitest';
import { volumeCommand, type VolumeSlots } from '@main/commands/system-control/volume';
import { SystemError, type VolumeState } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from '../apps-web/support';

const up = (amount = 10): VolumeSlots => ({ action: 'step', direction: 'up', amount });
const down = (amount = 10): VolumeSlots => ({ action: 'step', direction: 'down', amount });
const set = (percent: number): VolumeSlots => ({ action: 'set', percent });

describe('volume matching', () => {
  it.each(volumeCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(volumeCommand, example)).not.toBeNull();
  });

  it.each([
    ['volume up', up()],
    ['volume down', down()],
    ['turn the volume up', up()],
    ['turn up the volume', up()],
    ['turn the volume down', down()],
    ['turn down the volume', down()],
    ['raise the volume', up()],
    ['increase the volume', up()],
    ['crank up the volume', up()],
    ['bump up the volume', up()],
    ['lower the volume', down()],
    ['decrease volume', down()],
    ['reduce the volume', down()],
    ['volume higher', up()],
    ['volume lower', down()],
    ['make the volume higher', up()],
    ['louder', up()],
    ['quieter', down()],
    ['softer', down()],
    ['make it louder', up()],
    ['make it quieter', down()],
    ['a bit louder', up()],
    ['a little bit quieter', down()],
    ['much louder', up()],
    ['slightly quieter', down()],
    ['louder please', up()],
    ['turn it up', up()],
    ['turn it down', down()],
    ['turn it up a bit', up()],
    ['bring it down a little', down()],
    ['turn this down', down()],
    ['increase volume by 10', up(10)],
    ['lower the volume by 20', down(20)],
    ['volume up by 5', up(5)],
    ['volume down 15', down(15)],
    ['turn the volume up by 30 percent', up(30)],
    ['decrease the volume by twenty', down(20)],
    ['raise volume by 5 points', up(5)],
    ['turn up the volume a bit', up()],
  ] as const)('"%s" changes the volume by steps', (text, slots) => {
    expect(slotsOf(volumeCommand, text)).toEqual(slots);
  });

  it.each([
    ['set volume to 40%', set(40)],
    ['set the volume to 40', set(40)],
    ['volume 40', set(40)],
    ['volume to 25 percent', set(25)],
    ['volume at fifty percent', set(50)],
    ['make the volume 70', set(70)],
    ['turn the volume to 30', set(30)],
    ['put the volume at 20 percent', set(20)],
    ['set my volume to one hundred', set(100)],
    ['set volume to forty five', set(45)],
    ['set volume to 150', set(100)],
    ['set volume to 0', set(0)],
    ['volume zero', set(0)],
    ['turn the volume up to 80', set(80)],
    ['volume level 35', set(35)],
    ['max volume', set(100)],
    ['full volume', set(100)],
    ['half volume', set(50)],
    ['minimum volume', set(0)],
    ['set the volume to max', set(100)],
    ['volume to maximum', set(100)],
    ['set volume to half', set(50)],
  ] as const)('"%s" sets the volume', (text, slots) => {
    expect(slotsOf(volumeCommand, text)).toEqual(slots);
  });

  it.each([
    ['mute', 'mute'],
    ['mute the volume', 'mute'],
    ['mute my pc', 'mute'],
    ['mute sound', 'mute'],
    ['mute the audio', 'mute'],
    ['mute the speakers', 'mute'],
    ['turn off the sound', 'mute'],
    ['turn the volume off', 'mute'],
    ['switch off the sound', 'mute'],
    ['unmute', 'unmute'],
    ['un mute', 'unmute'],
    ['unmute the volume', 'unmute'],
    ['unmute my pc', 'unmute'],
    ['turn on the sound', 'unmute'],
    ['turn the sound on', 'unmute'],
  ] as const)('"%s" is %s', (text, action) => {
    expect(slotsOf(volumeCommand, text)).toEqual({ action });
  });

  it.each([
    "what's the volume",
    'what is the volume',
    'what is the current volume',
    'whats the volume right now',
    'check the volume',
    'volume level',
    'volume',
  ])('"%s" asks for the volume', (text) => {
    expect(slotsOf(volumeCommand, text)).toEqual({ action: 'get' });
  });

  it('is surest for explicit levels and unmute, less for bare words', () => {
    expect(scoreOf(volumeCommand, 'set volume to 40')).toBe(0.95);
    expect(scoreOf(volumeCommand, 'volume up')).toBe(0.95);
    expect(scoreOf(volumeCommand, 'unmute')).toBe(0.95);
    expect(scoreOf(volumeCommand, 'louder')).toBe(0.92);
    expect(scoreOf(volumeCommand, 'mute')).toBe(0.92);
    expect(scoreOf(volumeCommand, "what's the volume")).toBe(0.9);
    expect(scoreOf(volumeCommand, 'volume')).toBe(0.7);
  });

  it.each([
    'what is the volume of a sphere with radius 3',
    'calculate the volume of a cube with side 3',
    'volume of a cylinder',
    'convert 5 liters to milliliters',
    'volume settings',
    'sound settings',
    'open the volume mixer',
    'turn off my pc',
    'turn off the lights',
    'turn on the lights',
    'mute the microphone',
    'mute mic',
    'volume 40 50',
    'volume up to eleven please and thank you very much',
    'increase the brightness',
    'brightness up',
    'dim the screen',
    'set a timer for 5 minutes',
    'up',
    'make it up',
    'turn up the heat',
    'what is the weather',
  ])('does not claim "%s"', (text) => {
    expect(match(volumeCommand, text)).toBeNull();
  });
});

describe('volume run', () => {
  const state = (percent: number, muted = false): VolumeState => ({ percent, muted });

  it('steps the volume up and reports the new level', async () => {
    const harness = createHarness({ system: { adjustVolume: () => Promise.resolve(state(50)) } });
    const result = await runCommand(volumeCommand, up(), harness);

    expect(harness.system.adjustVolume).toHaveBeenCalledWith(10);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'volume',
      title: 'Volume 50%',
    });
    expect(result.speech).toBe('Volume 50 percent.');
    expect(result.autoCloseMs).toBe(2500);
  });

  it('steps down with a negative delta', async () => {
    const harness = createHarness({ system: { adjustVolume: () => Promise.resolve(state(30)) } });
    await runCommand(volumeCommand, down(20), harness);
    expect(harness.system.adjustVolume).toHaveBeenCalledWith(-20);
  });

  it('sets an exact level', async () => {
    const harness = createHarness({ system: { setVolume: () => Promise.resolve(state(40)) } });
    const result = await runCommand(volumeCommand, set(40), harness);
    expect(harness.system.setVolume).toHaveBeenCalledWith(40);
    expect(result.speech).toBe('Volume 40 percent.');
  });

  it('shows the mute icon for a silent level', async () => {
    const harness = createHarness({ system: { setVolume: () => Promise.resolve(state(0)) } });
    const result = await runCommand(volumeCommand, set(0), harness);
    expect(result.cards[0]).toMatchObject({ icon: 'mute', title: 'Volume 0%' });
  });

  it('mutes and says so', async () => {
    const harness = createHarness({ system: { setMuted: () => Promise.resolve(state(35, true)) } });
    const result = await runCommand(volumeCommand, { action: 'mute' }, harness);
    expect(harness.system.setMuted).toHaveBeenCalledWith(true);
    expect(result.cards[0]).toMatchObject({
      icon: 'mute',
      title: 'Muted',
      detail: 'The volume is at 35%',
    });
    expect(result.speech).toBe('Muted.');
  });

  it('unmutes and reads the level', async () => {
    const harness = createHarness({ system: { setMuted: () => Promise.resolve(state(35)) } });
    const result = await runCommand(volumeCommand, { action: 'unmute' }, harness);
    expect(harness.system.setMuted).toHaveBeenCalledWith(false);
    expect(result.cards[0]).toMatchObject({ icon: 'volume', detail: 'Sound is back on' });
    expect(result.speech).toBe('Unmuted. Volume 35 percent.');
  });

  it('answers a question without changing anything', async () => {
    const harness = createHarness({ system: { getVolume: () => Promise.resolve(state(64)) } });
    const result = await runCommand(volumeCommand, { action: 'get' }, harness);
    expect(result.cards[0]).toMatchObject({ tone: 'neutral', title: 'Volume 64%' });
    expect(harness.system.adjustVolume).not.toHaveBeenCalled();
  });

  it.each([
    [
      { action: 'get' } as const,
      "I couldn't read the volume",
      "Sorry, I couldn't read the volume.",
    ],
    [up(), "I couldn't change the volume", "Sorry, I couldn't change the volume."],
  ])('explains a failure for %j', async (slots, title, speech) => {
    const harness = createHarness({
      system: {
        getVolume: () =>
          Promise.reject(new SystemError('unsupported', 'No audio output device is available.')),
        adjustVolume: () => Promise.reject(new SystemError('failed', 'The audio helper failed.')),
      },
    });
    const result = await runCommand(volumeCommand, slots, harness);
    expect(result.cards[0]).toMatchObject({ kind: 'status', title });
    expect(result.speech).toBe(speech);
  });

  it('uses a warning for a PC without audio and an error for real failures', async () => {
    const noDevice = createHarness({
      system: {
        getVolume: () =>
          Promise.reject(new SystemError('unsupported', 'No audio output device is available.')),
      },
    });
    const warning = await runCommand(volumeCommand, { action: 'get' }, noDevice);
    expect(warning.cards[0]).toMatchObject({
      tone: 'warning',
      detail: 'No audio output device is available.',
    });

    const broken = createHarness({
      system: { getVolume: () => Promise.reject(new Error('boom')) },
    });
    const error = await runCommand(volumeCommand, { action: 'get' }, broken);
    expect(error.cards[0]).toMatchObject({ tone: 'error' });
  });
});
