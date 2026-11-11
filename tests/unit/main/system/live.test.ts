import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSystemApi } from '@main/system';
import { silentLogger } from '@shared/logger';

/**
 * Opt-in probes against the real machine: set BEEKEEPER_LIVE=1 and run this file with vitest.
 * Everything here is read-only; volume and brightness are only set to the value they already have.
 * Nothing is launched, closed, locked, put to sleep, shut down, emptied or toggled.
 *
 * The probes run one after the other on purpose: the packaged-app list is loaded by a background
 * PowerShell process that would otherwise compete with the latency measurements.
 */
const LIVE = process.env['BEEKEEPER_LIVE'] === '1';
const SLOW_MS = 120_000;
const WARM_RUNS = 5;

function createLiveSystem() {
  return createSystemApi({
    resourcesDir: join(process.cwd(), 'resources'),
    picturesDir: join(process.cwd(), 'resources', '.unused'),
    capture: () => Promise.reject(new Error('screenshots are not part of the live probes')),
    logger: silentLogger,
  });
}

describe.skipIf(!LIVE)('live Windows probes', () => {
  const system = createLiveSystem();
  const timings: string[] = [];

  async function timed<T>(label: string, action: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const value = await action();
    timings.push(`${label.padEnd(40)} ${Math.round(performance.now() - start)} ms`);
    return value;
  }

  /** Runs `action` a few times and records the median, the way a user would feel repeated commands. */
  async function medianOf<T>(label: string, action: () => Promise<T>): Promise<T> {
    const durations: number[] = [];
    let value!: T;
    for (let run = 0; run < WARM_RUNS; run += 1) {
      const start = performance.now();
      value = await action();
      durations.push(Math.round(performance.now() - start));
    }
    durations.sort((a, b) => a - b);
    timings.push(
      `${label.padEnd(40)} median ${durations[Math.floor(WARM_RUNS / 2)]} ms (min ${durations[0]}, max ${durations.at(-1)})`,
    );
    return value;
  }

  it('reads the battery', { timeout: SLOW_MS }, async () => {
    const battery = await medianOf('getBattery', () => system.getBattery());
    expect(typeof battery.hasBattery).toBe('boolean');
    expect(typeof battery.charging).toBe('boolean');
    expect(typeof battery.onAc).toBe('boolean');
    if (battery.hasBattery) {
      expect(battery.percent).toBeGreaterThanOrEqual(0);
      expect(battery.percent).toBeLessThanOrEqual(100);
    }
  });

  it('reads system information', { timeout: SLOW_MS }, async () => {
    const info = await medianOf('getSystemInfo (samples CPU for 0.4 s)', () =>
      system.getSystemInfo(),
    );
    expect(info.os).toMatch(/^Windows/);
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(info.memory.totalBytes).toBeGreaterThan(info.memory.usedBytes);
    expect(info.disk.totalBytes).toBeGreaterThan(info.disk.freeBytes);
    expect(info.uptimeSeconds).toBeGreaterThan(0);
  });

  it('reads the volume and sets it to the value it already has', { timeout: SLOW_MS }, async () => {
    const before = await timed('getVolume (first call: compiles helper)', () => system.getVolume());
    expect(before.percent).toBeGreaterThanOrEqual(0);
    expect(before.percent).toBeLessThanOrEqual(100);
    expect(typeof before.muted).toBe('boolean');

    await medianOf('getVolume (warm)', () => system.getVolume());
    const same = await medianOf('setVolume <current> (warm)', () =>
      system.setVolume(before.percent),
    );
    expect(same.percent).toBe(before.percent);
    expect(same.muted).toBe(before.muted);
    const unchanged = await medianOf('adjustVolume 0 (warm)', () => system.adjustVolume(0));
    expect(unchanged.percent).toBe(before.percent);
  });

  it(
    'reads the brightness and sets it to the value it already has',
    { timeout: SLOW_MS },
    async () => {
      const before = await medianOf('getBrightness', () => system.getBrightness());
      if (before === null) {
        await expect(system.setBrightness(50)).rejects.toMatchObject({ code: 'unsupported' });
        return;
      }
      expect(before).toBeGreaterThanOrEqual(0);
      expect(before).toBeLessThanOrEqual(100);
      expect(await medianOf('setBrightness <current>', () => system.setBrightness(before))).toBe(
        before,
      );
    },
  );

  it(
    'finds built-in apps without waiting for the slow package list',
    { timeout: SLOW_MS },
    async () => {
      const [first] = await timed('findApps notepad (cold index)', () =>
        system.findApps('notepad'),
      );
      expect(first?.app).toMatchObject({ name: 'Notepad', kind: 'builtin' });
      expect(first?.score).toBe(1);
      await timed('findApps notepad (warm)', () => system.findApps('notepad'));
      const [code] = await system.findApps('vs code');
      // Visual Studio Code is a Start menu shortcut when installed.
      if (code?.score !== undefined && code.score >= 0.9)
        expect(code.app.name).toBe('Visual Studio Code');
    },
  );

  it(
    'finds packaged apps (a fresh index waits for the slow Start menu list)',
    { timeout: SLOW_MS },
    async () => {
      const fresh = createLiveSystem();
      // "Maps" is a packaged app on Windows 11 and has no Start menu shortcut, so the fast index
      // cannot answer and the lookup has to wait for the packaged-app list.
      const found = await timed('findApps maps (cold, waits for UWP)', () =>
        fresh.findApps('maps'),
      );
      if (found[0]?.app.name === 'Maps') expect(found[0].app.kind).toBe('uwp');
      expect(found.every((match) => match.score >= 0.5 && match.score <= 1)).toBe(true);

      const count = await timed('refreshApps (shortcuts + packaged apps)', () =>
        fresh.refreshApps(),
      );
      expect(count).toBeGreaterThan(20);
    },
  );

  it('reports the timings', () => {
    process.stdout.write(
      `\nLive probe timings\n${timings.map((line) => `  ${line}`).join('\n')}\n`,
    );
    expect(timings.length).toBeGreaterThan(0);
  });
});
