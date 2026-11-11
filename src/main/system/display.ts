import { clamp, isRecord, toPercent } from './guards';
import type { PowerShellRunner } from './powershell';
import { SystemError, type SystemApi } from './types';

export type DisplayApi = Pick<SystemApi, 'getBrightness' | 'setBrightness'>;

/** Validates the reply of brightness.ps1: the level, or null when the display has no software brightness. */
export function parseBrightness(data: unknown): number | null {
  if (!isRecord(data) || typeof data.supported !== 'boolean') {
    throw new SystemError('failed', 'The brightness helper returned an unexpected reply.');
  }
  if (!data.supported || typeof data.percent !== 'number') return null;
  return clamp(Math.round(data.percent), 0, 100);
}

/** Software brightness through WMI (laptop panels). Desktop monitors report "unsupported". */
export function createDisplayApi(runner: PowerShellRunner): DisplayApi {
  return {
    async getBrightness() {
      try {
        return parseBrightness(await runner.run('brightness', { Action: 'get' }));
      } catch (error) {
        if (error instanceof SystemError && error.code === 'unsupported') return null;
        throw error;
      }
    },
    async setBrightness(percent) {
      const level = toPercent(percent, 'Brightness');
      const applied = parseBrightness(
        await runner.run('brightness', { Action: 'set', Percent: level }),
      );
      if (applied === null) {
        throw new SystemError('unsupported', 'This display does not support brightness control.');
      }
      return applied;
    },
  };
}
