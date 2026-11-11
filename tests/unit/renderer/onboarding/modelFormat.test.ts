import { describe, expect, it } from 'vitest';
import {
  describeModel,
  formatEta,
  formatMegabytes,
  formatSpeed,
  modelAnnouncement,
  percentOf,
  settleModelState,
} from '@renderer/onboarding/modelFormat';
import { modelState } from './testUtils';

describe('formatMegabytes', () => {
  it.each([
    [41_184_862, '39.3 MB'],
    [12_900_000, '12.3 MB'],
    [0, '0.0 MB'],
    [-5, '0.0 MB'],
    [Number.NaN, '0.0 MB'],
  ])('formats %s as %s', (bytes, text) => {
    expect(formatMegabytes(bytes)).toBe(text);
  });
});

describe('formatSpeed', () => {
  it.each([
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [2_621_440, '2.5 MB/s'],
    [51_200, '50 KB/s'],
    [10, '1 KB/s'],
  ])('formats %s as %s', (bytesPerSecond, text) => {
    expect(formatSpeed(bytesPerSecond)).toBe(text);
  });
});

describe('formatEta', () => {
  it.each([
    [null, null],
    [-1, null],
    [Number.NaN, null],
    [0, '1 s'],
    [0.2, '1 s'],
    [42, '42 s'],
    [60, '1 min'],
    [75, '1 min 15 s'],
    [640, '11 min'],
    [3600, '1 hr'],
    [5400, '1 hr 30 min'],
  ])('formats %s as %s', (seconds, text) => {
    expect(formatEta(seconds)).toBe(text);
  });
});

describe('percentOf', () => {
  it.each([
    [0, 100, 0],
    [50, 100, 50],
    [999, 1000, 99],
    [1000, 1000, 100],
    [2000, 1000, 100],
    [-10, 100, 0],
    [10, 0, 0],
    [Number.NaN, 100, 0],
    [10, Number.NaN, 0],
  ])('%s of %s is %s%%', (received, total, expected) => {
    expect(percentOf(received, total)).toBe(expected);
  });
});

describe('settleModelState', () => {
  const cancelled = modelState({
    state: 'error',
    receivedBytes: 9_000_000,
    message: 'The download was cancelled — it will resume next time',
  });

  it('shows the replayed cancellation as a paused download, keeping the progress', () => {
    const settled = settleModelState(cancelled, false);
    expect(settled.state).toBe('partial');
    expect(settled.receivedBytes).toBe(9_000_000);
    expect(settled.message).toBeUndefined();
  });

  it('is a missing download when nothing was received before the pause', () => {
    expect(settleModelState({ ...cancelled, receivedBytes: 0 }, false).state).toBe('missing');
  });

  it('keeps real errors, unless the user just paused', () => {
    const offline = modelState({ state: 'error', message: 'No internet connection' });
    expect(settleModelState(offline, false)).toBe(offline);
    expect(settleModelState({ ...offline, receivedBytes: 5 }, true).state).toBe('partial');
  });

  it('leaves every other state alone', () => {
    const downloading = modelState({ state: 'downloading', receivedBytes: 1 });
    expect(settleModelState(downloading, true)).toBe(downloading);
  });
});

describe('describeModel', () => {
  it('reads every number and the name from the state', () => {
    const view = describeModel(
      modelState({
        state: 'downloading',
        receivedBytes: 10_485_760,
        totalBytes: 41_943_040,
        bytesPerSecond: 2_097_152,
        etaSeconds: 15,
        attempt: 2,
        maxAttempts: 5,
        displayName: 'Tiny test model',
      }),
    );
    expect(view).toMatchObject({
      phase: 'downloading',
      percent: 25,
      received: '10.0 MB',
      total: '40.0 MB',
      speed: '2.0 MB/s',
      eta: '15 s',
      attempt: '2 of 5',
      name: 'Tiny test model',
    });
  });

  it('reports verifying once every byte has arrived, without speed or ETA', () => {
    const view = describeModel(
      modelState({
        state: 'downloading',
        receivedBytes: 41_184_862,
        bytesPerSecond: 1_000_000,
        etaSeconds: 0,
      }),
    );
    expect(view.phase).toBe('verifying');
    expect(view.percent).toBe(100);
    expect(view.speed).toBeNull();
    expect(view.eta).toBeNull();
  });

  it('shows a finished model as 100 % with no leftover message or attempts', () => {
    const view = describeModel(modelState({ state: 'ready', message: 'stale', maxAttempts: 1 }));
    expect(view).toMatchObject({ phase: 'ready', percent: 100, message: null, attempt: null });
    expect(view.received).toBe(view.total);
  });

  it('keeps the message of a failed download and shows partial progress', () => {
    const error = describeModel(modelState({ state: 'error', message: 'Not enough disk space' }));
    expect(error.message).toBe('Not enough disk space');
    const partial = describeModel(modelState({ state: 'partial', receivedBytes: 20_592_431 }));
    expect(partial).toMatchObject({ phase: 'partial', percent: 50, speed: null, attempt: null });
  });
});

describe('modelAnnouncement', () => {
  const downloading = (receivedBytes: number) =>
    modelState({ state: 'downloading', receivedBytes, totalBytes: 1000 });

  it('does not announce the first snapshot', () => {
    expect(modelAnnouncement(null, modelState({ state: 'ready' }))).toBeNull();
  });

  it.each([
    ['missing', 'downloading', 'Downloading the voice model.'],
    ['downloading', 'ready', 'Voice model ready.'],
    ['downloading', 'partial', 'Voice model download paused.'],
    ['downloading', 'error', 'Voice model download failed.'],
  ] as const)('announces %s -> %s', (from, to, text) => {
    expect(modelAnnouncement(modelState({ state: from }), modelState({ state: to }))).toBe(text);
  });

  it('adds the reason to a failure and stays quiet when it disappears', () => {
    const failed = modelState({ state: 'error', message: 'No internet connection' });
    expect(modelAnnouncement(modelState({ state: 'downloading' }), failed)).toBe(
      'Voice model download failed. No internet connection',
    );
    expect(modelAnnouncement(failed, modelState({ state: 'missing' }))).toBeNull();
  });

  it('announces the 25, 50 and 75 percent milestones once, not every tick', () => {
    expect(modelAnnouncement(downloading(240), downloading(260))).toBe(
      'Voice model 25 percent downloaded.',
    );
    expect(modelAnnouncement(downloading(260), downloading(270))).toBeNull();
    expect(modelAnnouncement(downloading(490), downloading(510))).toBe(
      'Voice model 50 percent downloaded.',
    );
    expect(modelAnnouncement(downloading(0), downloading(10))).toBeNull();
  });

  it('announces only the highest milestone when one update crosses several', () => {
    expect(modelAnnouncement(downloading(0), downloading(510))).toBe(
      'Voice model 50 percent downloaded.',
    );
    expect(modelAnnouncement(downloading(490), downloading(760))).toBe(
      'Voice model 75 percent downloaded.',
    );
  });
});
