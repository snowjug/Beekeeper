import { clamp, isRecord, toPercent } from './guards';
import type { PowerShellRunner } from './powershell';
import { SystemError, type SystemApi, type VolumeState } from './types';

export type AudioApi = Pick<SystemApi, 'getVolume' | 'setVolume' | 'adjustVolume' | 'setMuted'>;

/** Validates the reply of audio.ps1. */
export function parseVolumeState(data: unknown): VolumeState {
  if (isRecord(data) && typeof data.percent === 'number' && typeof data.muted === 'boolean') {
    return { percent: clamp(Math.round(data.percent), 0, 100), muted: data.muted };
  }
  throw new SystemError('failed', 'The audio helper returned an unexpected reply.');
}

/**
 * Master volume of the default playback device (Core Audio). Raising the level above zero also
 * unmutes, like the hardware volume keys.
 */
export function createAudioApi(runner: PowerShellRunner): AudioApi {
  return {
    async getVolume() {
      return parseVolumeState(await runner.run('audio', { Action: 'get' }));
    },
    async setVolume(percent) {
      const level = toPercent(percent, 'Volume');
      return parseVolumeState(await runner.run('audio', { Action: 'set', Percent: level }));
    },
    async adjustVolume(deltaPercent) {
      if (!Number.isFinite(deltaPercent)) {
        throw new SystemError('invalid-argument', 'The volume change must be a number.');
      }
      const delta = clamp(Math.round(deltaPercent), -100, 100);
      return parseVolumeState(await runner.run('audio', { Action: 'adjust', Delta: delta }));
    },
    async setMuted(muted) {
      return parseVolumeState(await runner.run('audio', { Action: muted ? 'mute' : 'unmute' }));
    },
  };
}
