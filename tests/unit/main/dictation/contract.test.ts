import { describe, expect, it } from 'vitest';
import { canInvoke, canReceive, INVOKE_CHANNELS } from '@shared/ipc/channels';
import { contractIsConsistent } from '@shared/ipc/schemas';
import { validateInvoke } from '@main/ipc/validate';
import { WINDOW_ROLES } from '@shared/windows';

describe('the dictation IPC contract', () => {
  it('is complete: every channel has a schema', () => {
    expect(contractIsConsistent()).toBe(true);
  });

  it('lets only the pill talk to the dictation handlers', () => {
    const channels = ['dictation:ready', 'dictation:submit', 'dictation:cancel', 'dictation:abort'];
    for (const channel of channels) {
      expect(canInvoke('dictation', channel)).toBe(true);
      for (const role of WINDOW_ROLES.filter((candidate) => candidate !== 'dictation')) {
        expect(canInvoke(role, channel)).toBe(false);
      }
    }
    expect(Object.keys(INVOKE_CHANNELS)).toEqual(expect.arrayContaining(channels));
  });

  it('sends the start, stop and status events to the pill only', () => {
    for (const channel of ['dictation:start', 'dictation:stop', 'dictation:status']) {
      expect(canReceive('dictation', channel)).toBe(true);
      for (const role of WINDOW_ROLES.filter((candidate) => candidate !== 'dictation')) {
        expect(canReceive(role, channel)).toBe(false);
      }
    }
  });

  it('lets the pill read the settings and the theme it needs', () => {
    expect(canInvoke('dictation', 'app:log')).toBe(true);
    expect(canReceive('dictation', 'theme:changed')).toBe(true);
    // The microphone indicator and the settings are the main process's business.
    expect(canInvoke('dictation', 'voice:micActive')).toBe(false);
    expect(canInvoke('dictation', 'settings:update')).toBe(false);
  });

  describe('dictation:submit', () => {
    it('accepts between 100 ms and 60 s of audio', () => {
      expect(validateInvoke('dictation:submit', { samples: new Float32Array(1600) }).ok).toBe(true);
      expect(validateInvoke('dictation:submit', { samples: new Float32Array(960_000) }).ok).toBe(
        true,
      );
    });

    it.each([
      ['too short', { samples: new Float32Array(1599) }],
      ['too long', { samples: new Float32Array(960_001) }],
      ['not audio', { samples: [0, 1, 2] }],
      ['missing', {}],
    ])('rejects a recording that is %s', (_name, payload) => {
      const result = validateInvoke('dictation:submit', payload);
      expect(result.ok).toBe(false);
    });
  });

  describe('dictation:abort', () => {
    it.each(['no-speech', 'mic-denied', 'mic-missing', 'mic-busy', 'error'])(
      'accepts the reason %s',
      (reason) => {
        expect(validateInvoke('dictation:abort', { reason }).ok).toBe(true);
        expect(validateInvoke('dictation:abort', { reason, message: 'detail' }).ok).toBe(true);
      },
    );

    it.each([
      ['an unknown reason', { reason: 'because' }],
      ['no reason', {}],
      ['an overlong message', { reason: 'error', message: 'x'.repeat(301) }],
    ])('rejects %s', (_name, payload) => {
      expect(validateInvoke('dictation:abort', payload).ok).toBe(false);
    });
  });
});
