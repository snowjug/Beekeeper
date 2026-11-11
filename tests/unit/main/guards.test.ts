import { describe, expect, it, vi } from 'vitest';
import type { ModelProgress, ModelStatus } from '@shared/models';
import { VOSK_WORKER_FILE } from '@shared/constants';
import { ASSET_CSP, VOSK_WORKER_CSP, buildCsp } from '@main/csp';
import { toVoiceModelState } from '@main/ipc/modelState';
import { isAllowedUserPath, isPathInside } from '@main/pathGuard';
import { resolveRoute } from '@main/routes';
import { TrayStateMachine } from '@main/trayState';

describe('pathGuard', () => {
  it('accepts the root itself and anything below it', () => {
    expect(isPathInside('C:\\Users\\me\\Pictures', 'C:\\Users\\me\\Pictures')).toBe(true);
    expect(isPathInside('C:\\Users\\me\\Pictures', 'C:\\Users\\me\\Pictures\\a\\b.png')).toBe(true);
    expect(isPathInside('C:\\Users\\me\\Pictures', 'c:\\users\\ME\\pictures\\B.PNG')).toBe(true);
  });

  it('refuses siblings, parents, other drives and traversal', () => {
    const root = 'C:\\Users\\me\\Pictures';
    expect(isPathInside(root, 'C:\\Users\\me\\Pictures2\\a.png')).toBe(false);
    expect(isPathInside(root, 'C:\\Users\\me')).toBe(false);
    expect(isPathInside(root, 'D:\\Users\\me\\Pictures\\a.png')).toBe(false);
    expect(isPathInside(root, `${root}\\..\\Documents\\secret.docx`)).toBe(false);
    expect(isPathInside(root, '\\\\server\\share\\Pictures\\a.png')).toBe(false);
  });

  it('allows a path when any root contains it', () => {
    const roots = ['C:\\Users\\me\\Pictures', 'C:\\Users\\me\\AppData\\Roaming\\Beekeeper\\logs'];
    expect(
      isAllowedUserPath('C:\\Users\\me\\AppData\\Roaming\\Beekeeper\\logs\\main.log', roots),
    ).toBe(true);
    expect(isAllowedUserPath('C:\\Windows\\System32\\cmd.exe', roots)).toBe(false);
    expect(isAllowedUserPath('C:\\Users\\me\\Pictures\\a.png', [])).toBe(false);
  });
});

describe('TrayStateMachine', () => {
  function setup() {
    const setState = vi.fn<(state: string) => void>();
    return { machine: new TrayStateMachine({ setState }), setState };
  }

  it('shows listening above armed above idle', () => {
    const { machine, setState } = setup();
    expect(machine.state).toBe('idle');
    machine.setWakeArmed(true);
    expect(machine.state).toBe('armed');
    machine.setMicActive(true);
    expect(machine.state).toBe('listening');
    machine.setMicActive(false);
    expect(machine.state).toBe('armed');
    machine.setWakeArmed(false);
    expect(machine.state).toBe('idle');
    expect(setState.mock.calls.map(([state]) => state)).toEqual([
      'armed',
      'listening',
      'armed',
      'idle',
    ]);
  });
});

describe('toVoiceModelState', () => {
  const TOTAL = 40_000_000;
  const progress = (patch: Partial<ModelProgress> = {}): ModelProgress => ({
    phase: 'downloading',
    receivedBytes: 10_000_000,
    totalBytes: TOTAL,
    bytesPerSecond: 2_000_000,
    etaSeconds: 15,
    attempt: 2,
    maxAttempts: 3,
    ...patch,
  });
  const status = (patch: Partial<ModelStatus>): ModelStatus => ({
    state: 'missing',
    receivedBytes: 0,
    totalBytes: TOTAL,
    ...patch,
  });

  it('reports speed, ETA and the retry message while downloading', () => {
    const state = toVoiceModelState(
      status({ state: 'downloading', receivedBytes: 10_000_000 }),
      progress({ message: 'Connection lost - retrying' }),
    );
    expect(state).toMatchObject({
      state: 'downloading',
      bytesPerSecond: 2_000_000,
      etaSeconds: 15,
      attempt: 2,
      maxAttempts: 3,
      message: 'Connection lost - retrying',
      modelUrl: null,
    });
  });

  it('shows a failed download as an error with its message', () => {
    // The failure is reported while the run is still active, then the status itself turns 'error'.
    const during = toVoiceModelState(
      status({ state: 'downloading' }),
      progress({ phase: 'error', message: 'No internet connection' }),
    );
    expect(during).toMatchObject({ state: 'error', message: 'No internet connection' });
    const after = toVoiceModelState(
      status({ state: 'error', message: 'No internet connection' }),
      progress({ phase: 'error' }),
    );
    expect(after).toMatchObject({ state: 'error', message: 'No internet connection' });
  });

  it('treats a cancelled download as a resumable pause, not an error', () => {
    const cancelled = progress({
      phase: 'error',
      message: 'The download was cancelled - it will resume next time',
    });
    const partial = toVoiceModelState(
      status({ state: 'partial', receivedBytes: 12_000_000 }),
      cancelled,
    );
    expect(partial.state).toBe('partial');
    expect(partial.message).toBeUndefined();
    expect(partial.bytesPerSecond).toBe(0);
    expect(toVoiceModelState(status({ state: 'missing' }), cancelled).state).toBe('missing');
  });

  it('exposes the model URL only once the model is ready', () => {
    const ready = toVoiceModelState(status({ state: 'ready', receivedBytes: TOTAL }), null);
    expect(ready.state).toBe('ready');
    expect(ready.modelUrl).toMatch(/^beekeeper:\/\/app\/models\/.+\.tar\.gz$/);
    expect(toVoiceModelState(status({ state: 'partial' }), null).modelUrl).toBeNull();
  });
});

describe('Vosk worker policy', () => {
  const roots = { rendererRoot: 'C:\\app\\renderer', modelsDir: 'C:\\data\\models' };

  it('marks only the extracted worker script for its own CSP', () => {
    expect(resolveRoute(`/${VOSK_WORKER_FILE}`, roots)).toMatchObject({
      kind: 'file',
      voskWorker: true,
    });
    expect(resolveRoute('/assets/vosk-worker.js', roots)).toMatchObject({ voskWorker: false });
    expect(resolveRoute('/vosk/other.js', roots)).toMatchObject({ voskWorker: false });
    expect(resolveRoute('/worker/index.html', roots)).toMatchObject({ voskWorker: false });
  });

  it('grants unsafe-eval to that one worker policy and to nothing else', () => {
    expect(VOSK_WORKER_CSP).toContain("'unsafe-eval'");
    // The worker has no DOM, no nested workers and no network beyond the app origin.
    expect(VOSK_WORKER_CSP).toContain("worker-src 'none'");
    expect(VOSK_WORKER_CSP).toContain("connect-src 'self'");
    expect(ASSET_CSP).not.toContain("'unsafe-eval'");
    for (const role of [
      'assistant',
      'worker',
      'settings',
      'onboarding',
      'circle',
      'edgeGlow',
    ] as const) {
      expect(buildCsp({ role, dev: false })).not.toContain("'unsafe-eval'");
    }
  });
});
