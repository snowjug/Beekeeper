import { describe, expect, it } from 'vitest';
import {
  settingsPageFromText,
  settingsPagesCommand,
} from '@main/commands/system-control/settings-pages';
import { recycleBinCommand } from '@main/commands/system-control/recycle-bin';
import { SystemError, type SettingsPage } from '@main/system/types';
import { createHarness, match, runCommand, scoreOf, slotsOf } from '../apps-web/support';

describe('settings pages matching', () => {
  it.each(settingsPagesCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(settingsPagesCommand, example)).not.toBeNull();
  });

  it.each([
    ['open wifi settings', 'wifi'],
    ['wi-fi settings', 'wifi'],
    ['wifi settings', 'wifi'],
    ['open wi fi settings', 'wifi'],
    ['open network settings', 'wifi'],
    ['open the internet settings', 'wifi'],
    ['show me my wireless settings', 'wifi'],
    ['wireless network settings', 'wifi'],
    ['network and internet settings', 'wifi'],
    ['open the wifi page', 'wifi'],
    ['bluetooth settings', 'bluetooth'],
    ['open bluetooth settings', 'bluetooth'],
    ['open bluetooth and devices settings', 'bluetooth'],
    ['go to the bluetooth options', 'bluetooth'],
    ['bluetoth settings', 'bluetooth'],
    ['open display settings', 'display'],
    ['display settings', 'display'],
    ['open screen settings', 'display'],
    ['monitor settings', 'display'],
    ['brightness settings', 'display'],
    ['screen resolution settings', 'display'],
    ['change the display settings', 'display'],
    ['sound settings', 'sound'],
    ['show me the sound settings', 'sound'],
    ['open audio settings', 'sound'],
    ['volume settings', 'sound'],
    ['speaker settings', 'sound'],
    ['launch the sound settings', 'sound'],
    ['take me to the sound settings', 'sound'],
    ['open windows sound settings', 'sound'],
    ['Hey Beekeeper, open the Wi-Fi settings please', 'wifi'],
  ] as const)('"%s" opens the %s page', (text, page) => {
    expect(slotsOf(settingsPagesCommand, text)).toEqual({ page });
    expect(scoreOf(settingsPagesCommand, text)).toBe(0.95);
  });

  it.each([
    ['open wifi', 'wifi'],
    ['open wi-fi', 'wifi'],
    ['show me bluetooth', 'bluetooth'],
    ['go to the bluetooth', 'bluetooth'],
  ] as const)('"%s" opens the %s page with less certainty', (text, page) => {
    expect(slotsOf(settingsPagesCommand, text)).toEqual({ page });
    expect(scoreOf(settingsPagesCommand, text)).toBe(0.9);
  });

  it.each([
    'open settings',
    'open my settings',
    'settings',
    'open sound recorder',
    'open display',
    'open sound',
    'open notepad',
    'open github.com',
    'wifi',
    'bluetooth',
    'turn on wifi',
    'turn off bluetooth',
    'what is bluetooth',
    'open the keyboard settings',
    'open privacy settings',
    'volume up',
    'lock screen settings',
  ])('does not claim "%s"', (text) => {
    expect(match(settingsPagesCommand, text)).toBeNull();
    expect(settingsPageFromText(text)).toBeNull();
  });
});

describe('settings pages run', () => {
  it.each([
    ['wifi', 'Wi-Fi', 'wifi'],
    ['bluetooth', 'Bluetooth', 'bluetooth'],
    ['display', 'Display', 'display'],
    ['sound', 'Sound', 'sound'],
  ] as const)('opens the %s page', async (page: SettingsPage, label, icon) => {
    const harness = createHarness({ system: { openSettingsPage: () => Promise.resolve() } });
    const result = await runCommand(settingsPagesCommand, { page }, harness);

    expect(harness.system.openSettingsPage).toHaveBeenCalledWith(page);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon,
      title: `Opening ${label} settings`,
    });
    expect(result.speech).toBe(`Opening ${label} settings.`);
    expect(result.autoCloseMs).toBe(1500);
  });

  it('explains a failure', async () => {
    const harness = createHarness({
      system: {
        openSettingsPage: () =>
          Promise.reject(new SystemError('failed', 'Opening Settings failed.')),
      },
    });
    const result = await runCommand(settingsPagesCommand, { page: 'wifi' }, harness);
    expect(result.cards[0]).toMatchObject({
      tone: 'error',
      title: "I couldn't open the Wi-Fi settings",
    });
  });
});

describe('recycle bin matching', () => {
  it.each(recycleBinCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(recycleBinCommand, example)).not.toBeNull();
  });

  it.each([
    'empty the recycle bin',
    'empty recycle bin',
    'empty my recycle bin',
    'empty the recycling bin',
    'clear the trash',
    'clear trash',
    'empty trash',
    'empty the trash can',
    'empty the bin',
    'clean out the recycle bin',
    'clean up the trash',
    'clear my recycle bin',
    'purge the recycle bin',
    'flush the trash',
    'wipe the recycle bin',
    'delete everything in the recycle bin',
    'delete all the files in the trash',
    'delete all from the bin',
    'empty the garbage',
    'Hey Beekeeper, please empty the recycle bin',
  ])('recognises "%s"', (text) => {
    expect(scoreOf(recycleBinCommand, text)).toBe(0.95);
  });

  it('tolerates typos with less confidence', () => {
    expect(scoreOf(recycleBinCommand, 'empty the recyle bin')).toBe(0.95);
    expect(scoreOf(recycleBinCommand, 'emtpy the recycle bin')).toBe(0.85);
  });

  it.each([
    'delete the recycle bin',
    'open the recycle bin',
    'empty the dishwasher',
    'empty my inbox',
    'empty the downloads folder',
    'clear the screen',
    'clear history',
    'recycle bin',
    'empty',
    'delete everything',
    'what is in the recycle bin',
  ])('does not claim "%s"', (text) => {
    expect(match(recycleBinCommand, text)).toBeNull();
  });
});

describe('recycle bin run', () => {
  it('asks for confirmation first and empties only after the user confirmed', async () => {
    const harness = createHarness({ system: { emptyRecycleBin: () => Promise.resolve() } });
    const result = await runCommand(recycleBinCommand, {}, harness);

    expect(harness.system.emptyRecycleBin).not.toHaveBeenCalled();
    expect(harness.confirmations).toHaveLength(1);
    const [request] = harness.confirmations;
    expect(request).toMatchObject({
      action: 'empty-recycle-bin',
      title: 'Empty the Recycle Bin?',
      confirmLabel: 'Empty Recycle Bin',
      danger: true,
    });
    expect(request?.countdownSeconds).toBeUndefined();
    expect(result.cards[0]).toMatchObject({
      kind: 'confirm',
      action: 'empty-recycle-bin',
      danger: true,
    });
    expect(result.pin).toBe(true);
    expect(result.speech).toContain('Empty the Recycle Bin?');

    await request?.run();
    expect(harness.system.emptyRecycleBin).toHaveBeenCalledTimes(1);
  });
});
