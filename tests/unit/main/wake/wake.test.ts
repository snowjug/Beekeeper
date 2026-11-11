import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@shared/logger';
import { SettingsSchema, type Settings } from '@shared/settings';
import { isBatterySaverOn, parseEnergySaver } from '@main/wake/batterySaver';
import { WakeWordController, type WakeWordDeps } from '@main/wake/controller';

function setup(
  voice: Partial<Settings['voice']> = {},
  options: { modelUrl?: string | null; saver?: boolean } = {},
) {
  let current = SettingsSchema.parse({ voice: { wakeWord: true, ...voice } });
  const run = vi.fn();
  const stop = vi.fn();
  const publish = vi.fn();
  const setArmed = vi.fn();
  const wake = vi.fn();
  const deps: WakeWordDeps = {
    getSettings: () => current,
    modelUrl: () =>
      options.modelUrl === undefined ? 'beekeeper://app/models/m.tar.gz' : options.modelUrl,
    worker: { run, stop },
    publish,
    setArmed,
    wake,
    batterySaverOn: () => Promise.resolve(options.saver ?? false),
    logger: silentLogger,
  };
  const controller = new WakeWordController(deps);
  return {
    controller,
    run,
    stop,
    publish,
    setArmed,
    wake,
    update: (voiceChange: Partial<Settings['voice']>) => {
      current = SettingsSchema.parse({ ...current, voice: { ...current.voice, ...voiceChange } });
    },
  };
}

describe('WakeWordController.evaluate', () => {
  it('runs the worker when enabled and the model is ready', () => {
    const { controller, run } = setup({ micDeviceId: 'mic-1' });
    controller.evaluate();
    expect(run).toHaveBeenCalledWith(
      {
        enabled: true,
        micDeviceId: 'mic-1',
        modelUrl: 'beekeeper://app/models/m.tar.gz',
        phrases: ['hey beekeeper'],
      },
      false,
    );
  });

  it('stays off when the setting is off (the default)', () => {
    const { controller, run, stop, publish } = setup({ wakeWord: false });
    controller.evaluate();
    expect(run).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(controller.status.state).toBe('off');
  });

  it('explains a missing voice model instead of starting', () => {
    const { controller, run, publish } = setup({}, { modelUrl: null });
    controller.evaluate();
    expect(run).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith({
      state: 'off',
      message: 'Download the voice model to use the wake word.',
    });
  });

  it('pauses the worker while the assistant bar is open', () => {
    const { controller, run } = setup();
    controller.setAssistantOpen(true);
    expect(run).toHaveBeenLastCalledWith(expect.anything(), true);
    controller.setAssistantOpen(false);
    expect(run).toHaveBeenLastCalledWith(expect.anything(), false);
  });
});

describe('Battery Saver', () => {
  it('pauses on Battery Saver only when the option is on', async () => {
    const on = setup({ wakeWordPauseOnBatterySaver: true }, { saver: true });
    await on.controller.refreshPower();
    expect(on.run).toHaveBeenLastCalledWith(expect.anything(), true);

    const off = setup({ wakeWordPauseOnBatterySaver: false }, { saver: true });
    await off.controller.refreshPower();
    expect(off.run).not.toHaveBeenCalled();
  });

  it('parses the WinRT status and treats failures as "off"', async () => {
    expect(parseEnergySaver('On\r\n')).toBe(true);
    expect(parseEnergySaver('Off')).toBe(false);
    expect(parseEnergySaver('Disabled')).toBe(false);
    expect(await isBatterySaverOn(() => Promise.resolve('On\n'), 'C:\\Windows')).toBe(true);
    expect(
      await isBatterySaverOn(() => Promise.reject(new Error('no powershell')), 'C:\\Windows'),
    ).toBe(false);
  });

  it('runs powershell.exe from System32 with a fixed script and no shell', async () => {
    const run = vi.fn(() => Promise.resolve('Off'));
    await isBatterySaverOn(run, 'C:\\Windows');
    const [file, args] = run.mock.calls[0] as unknown as [string, string[]];
    expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
  });
});

describe('worker reports', () => {
  it('relays status, updates the tray and wakes the assistant', () => {
    const { controller, publish, setArmed, wake } = setup();
    controller.handleStatus({ state: 'armed' });
    expect(publish).toHaveBeenCalledWith({ state: 'armed' });
    expect(setArmed).toHaveBeenLastCalledWith(true);
    controller.handleStatus({ state: 'armed' });
    expect(publish).toHaveBeenCalledTimes(1);

    controller.handleDetected();
    expect(wake).toHaveBeenCalledOnce();
    controller.setAssistantOpen(true);
    controller.handleDetected();
    expect(wake).toHaveBeenCalledOnce();
  });

  it('ignores reports and detections when the wake word is off', () => {
    const { controller, publish, wake } = setup({ wakeWord: false });
    controller.handleStatus({ state: 'armed' });
    controller.handleDetected();
    expect(publish).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });

  it('dispose stops the worker and clears the armed state', () => {
    const { controller, stop, setArmed, update } = setup();
    update({ wakeWord: true });
    controller.dispose();
    expect(stop).toHaveBeenCalled();
    expect(setArmed).toHaveBeenLastCalledWith(false);
    controller.evaluate();
  });
});
