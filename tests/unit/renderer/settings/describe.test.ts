import { describe, expect, it } from 'vitest';
import {
  describeHotkey,
  describeModel,
  describeUpdate,
  describeWake,
} from '@renderer/settings/lib/describe';
import {
  clamp01,
  formatEta,
  formatLatency,
  formatPercent,
  formatRate,
  formatSpeed,
  fractionOf,
  pluralize,
} from '@renderer/settings/lib/format';
import { makeModel } from './support';

describe('formatters', () => {
  it.each([
    [0, ''],
    [-5, ''],
    [Number.NaN, ''],
    [1_800_000, '1.72 MB/s'],
    [350_000, '342 KB/s'],
  ])('formatSpeed(%s) = %j', (bytes, expected) => {
    expect(formatSpeed(bytes)).toBe(expected);
  });

  it.each([
    [null, ''],
    [-1, ''],
    [2, 'a few seconds left'],
    [15, 'about 15 s left'],
    [60, 'about 1 min left'],
    [119.6, 'about 2 min left'],
    [95, 'about 1 min 35 s left'],
    [4000, 'about 1 hr 6 min left'],
  ])('formatEta(%s) = %j', (seconds, expected) => {
    expect(formatEta(seconds)).toBe(expected);
  });

  it('formats latency, percent, rate, fraction and plurals', () => {
    expect(formatLatency(182.4)).toBe('182 ms');
    expect(formatLatency(1500)).toBe('1.5 s');
    expect(formatLatency(undefined)).toBe('');
    expect(formatPercent(0.4567)).toBe('46%');
    expect(formatPercent(7)).toBe('100%');
    expect(formatRate(1)).toBe('1.0\u00d7');
    expect(fractionOf(50, 200)).toBe(0.25);
    expect(fractionOf(5, 0)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(pluralize(1, 'item')).toBe('1 item');
    expect(pluralize(3, 'note')).toBe('3 notes');
    expect(pluralize(0, 'saved conversation')).toBe('0 saved conversations');
  });
});

describe('describeModel', () => {
  const FALLBACK = 41_184_862;

  it('offers a download when the model is missing', () => {
    const summary = describeModel(
      makeModel({ state: 'missing', receivedBytes: 0, totalBytes: 0 }),
      FALLBACK,
    );
    expect(summary).toMatchObject({ tone: 'neutral', primary: 'download', canRemove: false });
    expect(summary.detail).toContain('39.3 MB');
  });

  it('shows live progress, speed, ETA and the attempt while downloading', () => {
    const summary = describeModel(
      makeModel({
        state: 'downloading',
        receivedBytes: 10_000_000,
        totalBytes: 40_000_000,
        bytesPerSecond: 2_000_000,
        etaSeconds: 15,
        attempt: 2,
        maxAttempts: 3,
        message: 'Retrying after a network error',
      }),
      FALLBACK,
    );
    expect(summary.downloading).toBe(true);
    expect(summary.fraction).toBe(0.25);
    expect(summary.canCancel).toBe(true);
    expect(summary.primary).toBeNull();
    expect(summary.attempt).toBe('Attempt 2 of 3');
    expect(summary.note).toBe('Retrying after a network error');
    expect(summary.detail).toBe('9.54 MB of 38.1 MB \u00b7 1.91 MB/s \u00b7 about 15 s left');
  });

  it('resumes a partial download and retries a failed one with the error message', () => {
    expect(
      describeModel(makeModel({ state: 'partial', receivedBytes: 1000 }), FALLBACK),
    ).toMatchObject({
      primary: 'resume',
      canRemove: true,
    });
    const failed = describeModel(
      makeModel({ state: 'error', receivedBytes: 0, message: 'Checksum did not match' }),
      FALLBACK,
    );
    expect(failed).toMatchObject({
      tone: 'danger',
      primary: 'retry',
      error: 'Checksum did not match',
    });
    expect(failed.canRemove).toBe(false);
  });

  it('can remove a ready model', () => {
    expect(describeModel(makeModel(), FALLBACK)).toMatchObject({
      tone: 'success',
      label: 'Ready',
      canRemove: true,
      primary: null,
    });
  });
});

describe('describeUpdate', () => {
  const auto = { autoUpdate: true };

  it.each([
    [{ status: 'disabled', message: 'Portable build' }, 'Updates off', false, false],
    [{ status: 'idle' }, 'Not checked yet', true, false],
    [{ status: 'checking' }, 'Checking', false, false],
    [{ status: 'available', version: '1.2.0' }, 'Update available', false, false],
    [{ status: 'downloading', version: '1.2.0', progress: 40 }, 'Downloading', false, false],
    [{ status: 'ready', version: '1.2.0' }, 'Ready to install', true, true],
    [{ status: 'none' }, 'Up to date', true, false],
    [{ status: 'error', message: 'Offline' }, 'Update problem', true, false],
  ] as const)('%j', (state, label, canCheck, canInstall) => {
    const summary = describeUpdate(state, auto);
    expect(summary.label).toBe(label);
    expect(summary.canCheck).toBe(canCheck);
    expect(summary.canInstall).toBe(canInstall);
  });

  it('reports download progress as a fraction and clamps it', () => {
    expect(describeUpdate({ status: 'downloading', progress: 40 }, auto).progress).toBe(0.4);
    expect(describeUpdate({ status: 'downloading', progress: 250 }, auto).progress).toBe(1);
    expect(describeUpdate({ status: 'ready', version: '2.0.0' }, auto).detail).toContain(
      'version 2.0.0',
    );
  });

  it('explains when automatic checks are off', () => {
    expect(describeUpdate({ status: 'idle' }, { autoUpdate: false }).detail).toContain(
      'Automatic checks are off',
    );
  });
});

describe('describeWake', () => {
  it('is off whenever the setting is off, and unknown until the worker reports', () => {
    expect(describeWake(null, false)).toMatchObject({ tone: 'neutral', label: 'Off' });
    expect(describeWake({ state: 'armed' }, false)).toMatchObject({ label: 'Off' });
    expect(describeWake(null, true)).toBeNull();
  });

  it.each([
    ['loading', 'info'],
    ['armed', 'success'],
    ['paused', 'warning'],
    ['error', 'danger'],
  ] as const)('maps the worker state %s to tone %s', (state, tone) => {
    expect(describeWake({ state, message: 'why' }, true)).toMatchObject({ tone, detail: 'why' });
  });
});

describe('describeHotkey', () => {
  it('says registered, or "Taken by another app" with the error text', () => {
    expect(
      describeHotkey({ accelerator: 'Ctrl+Shift+Space', registered: true }, 'Ctrl+Shift+Space'),
    ).toMatchObject({
      tone: 'success',
      label: 'Registered',
    });
    expect(
      describeHotkey(
        { accelerator: 'Alt+Shift+C', registered: false, error: 'Already in use' },
        'alt+shift+c',
      ),
    ).toMatchObject({ tone: 'danger', label: 'Taken by another app', detail: 'Already in use' });
  });

  it('ignores missing or stale status', () => {
    expect(describeHotkey(undefined, 'Ctrl+Shift+Space')).toBeNull();
    expect(
      describeHotkey({ accelerator: 'Ctrl+Alt+K', registered: true }, 'Ctrl+Shift+Space'),
    ).toBeNull();
  });
});
