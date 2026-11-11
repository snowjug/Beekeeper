import { describe, expect, it } from 'vitest';
import {
  BEST_PACKS,
  combinePacks,
  packAnnouncement,
  packsInMotion,
  packsToStart,
  type PackProgress,
} from '@renderer/onboarding/packFormat';
import { readyPack, speechState } from './testUtils';

const MIB = 1024 * 1024;

const running = (receivedBytes: number, extra = {}) => ({
  state: 'downloading' as const,
  receivedBytes,
  totalBytes: 100 * MIB,
  bytesPerSecond: 2 * MIB,
  etaSeconds: 10,
  ...extra,
});

describe('combinePacks', () => {
  it('is unknown until the status was read', () => {
    expect(combinePacks(null, BEST_PACKS)).toBeNull();
  });

  it('adds the bytes of every pack and the speed of the running ones', () => {
    const view = combinePacks(
      speechState({
        'whisper-small': running(50 * MIB),
        'supertonic-3': running(25 * MIB),
      }),
      BEST_PACKS,
    );
    expect(view).toMatchObject({
      phase: 'downloading',
      percent: 37,
      received: '75.0 MB',
      total: '200.0 MB',
      speed: '4.0 MB/s',
      name: 'Accurate recognition + Natural voice',
      attempt: null,
    });
    // 125 MiB left at 4 MiB/s
    expect(view?.eta).toBe('32 s');
    expect(view?.lines.map((line) => [line.name, line.percent, line.phase])).toEqual([
      ['Accurate recognition', 50, 'downloading'],
      ['Natural voice', 25, 'downloading'],
    ]);
  });

  it('uses the size from the catalogue while the main process reports no total yet', () => {
    const view = combinePacks(
      speechState({ 'whisper-small': { totalBytes: 0 }, 'supertonic-3': { totalBytes: 0 } }),
      BEST_PACKS,
    );
    expect(view).toMatchObject({ phase: 'missing', percent: 0, total: '480.9 MB' });
  });

  it('counts a ready pack as complete', () => {
    const view = combinePacks(speechState({ 'whisper-small': readyPack('whisper-small') }), [
      'whisper-small',
    ]);
    expect(view).toMatchObject({ phase: 'ready', percent: 100, received: view?.total });
    expect(view?.speed).toBeNull();
    expect(view?.eta).toBeNull();
  });

  it('is ready only when every pack is', () => {
    const view = combinePacks(
      speechState({
        'whisper-small': readyPack('whisper-small'),
        'supertonic-3': readyPack('supertonic-3'),
      }),
      BEST_PACKS,
    );
    expect(view).toMatchObject({ phase: 'ready', percent: 100, message: null });
    expect(view?.lines.every((line) => line.phase === 'ready' && line.percent === 100)).toBe(true);
  });

  it('is paused when a part is ready and the rest has not started, or has bytes saved', () => {
    expect(
      combinePacks(speechState({ 'whisper-small': readyPack('whisper-small') }), BEST_PACKS)?.phase,
    ).toBe('partial');
    expect(
      combinePacks(speechState({ 'supertonic-3': { receivedBytes: 10 * MIB } }), BEST_PACKS)?.phase,
    ).toBe('partial');
  });

  it('keeps a pack that has not begun yet "downloading" once the user started', () => {
    const state = speechState({ 'whisper-small': readyPack('whisper-small') });
    expect(combinePacks(state, BEST_PACKS, { started: true })?.phase).toBe('downloading');
    expect(combinePacks(state, BEST_PACKS, { started: true, paused: true })?.phase).toBe('partial');
  });

  it.each(['verifying', 'extracting'] as const)('treats %s as the checking step', (stage) => {
    const view = combinePacks(
      speechState({
        'whisper-small': readyPack('whisper-small'),
        'supertonic-3': { state: stage, receivedBytes: 128_774_318 },
      }),
      BEST_PACKS,
    );
    expect(view?.phase).toBe('verifying');
    expect(view?.speed).toBeNull();
  });

  it('reports the first failure with its message', () => {
    const view = combinePacks(
      speechState({
        'whisper-small': running(10 * MIB),
        'supertonic-3': { state: 'error', message: 'No internet connection' },
      }),
      BEST_PACKS,
    );
    expect(view).toMatchObject({ phase: 'error', message: 'No internet connection' });
  });

  it('turns a cancelled download into a pause, and keeps what was saved', () => {
    const cancelled = {
      state: 'error' as const,
      receivedBytes: 50 * MIB,
      totalBytes: 100 * MIB,
      message: 'The download was cancelled',
    };
    const state = speechState({ 'whisper-small': cancelled, 'supertonic-3': cancelled });
    expect(combinePacks(state, BEST_PACKS)).toMatchObject({
      phase: 'partial',
      percent: 50,
      message: null,
    });
    const failed = speechState({
      'whisper-small': { ...cancelled, message: 'Checksum mismatch' },
      'supertonic-3': cancelled,
    });
    expect(combinePacks(failed, BEST_PACKS)?.phase).toBe('error');
    expect(combinePacks(failed, BEST_PACKS, { paused: true })?.phase).toBe('partial');
  });

  it('shows the speed and time left only while data is flowing', () => {
    const idle = combinePacks(
      speechState({ 'whisper-small': running(10 * MIB, { bytesPerSecond: 0 }) }),
      ['whisper-small'],
    );
    expect(idle).toMatchObject({ phase: 'downloading', speed: null, eta: null });
  });
});

describe('what to start and what to pause', () => {
  it('starts the packs that are neither ready nor already moving', () => {
    const state = speechState({
      'whisper-small': { state: 'downloading' },
      'supertonic-3': { state: 'error' },
    });
    expect(packsToStart(state, BEST_PACKS)).toEqual(['supertonic-3']);
    expect(packsToStart(null, BEST_PACKS)).toEqual([...BEST_PACKS]);
    expect(
      packsToStart(speechState({ 'whisper-small': readyPack('whisper-small') }), BEST_PACKS),
    ).toEqual(['supertonic-3']);
  });

  it('pauses downloading, checking and unpacking packs only', () => {
    const state = speechState({
      'whisper-small': { state: 'verifying' },
      'supertonic-3': { state: 'extracting' },
      'whisper-base': { state: 'downloading' },
    });
    expect(packsInMotion(state, BEST_PACKS)).toEqual(['whisper-small', 'supertonic-3']);
    expect(packsInMotion(speechState(), BEST_PACKS)).toEqual([]);
    expect(packsInMotion(null, BEST_PACKS)).toEqual([]);
  });
});

describe('packAnnouncement', () => {
  const view = (phase: PackProgress['phase'], percent: number, message: string | null = null) =>
    ({ phase, percent, message }) as PackProgress;

  it('says nothing for the first snapshot or an unchanged phase', () => {
    expect(packAnnouncement(null, view('downloading', 50), 'Voice')).toBeNull();
    expect(packAnnouncement(view('ready', 100), view('ready', 100), 'Voice')).toBeNull();
    expect(packAnnouncement(view('missing', 0), view('verifying', 100), 'Voice')).toBeNull();
  });

  it.each([
    ['missing', 'downloading', 'Downloading Voice.'],
    ['downloading', 'ready', 'Voice ready.'],
    ['downloading', 'partial', 'Voice download paused.'],
  ] as const)('%s -> %s', (from, to, text) => {
    expect(packAnnouncement(view(from, 40), view(to, 100), 'Voice')).toBe(text);
  });

  it('includes the reason of a failure', () => {
    expect(
      packAnnouncement(view('downloading', 40), view('error', 40, 'No internet'), 'Voice'),
    ).toBe('Voice download failed. No internet');
    expect(packAnnouncement(view('downloading', 40), view('error', 40), 'Voice')).toBe(
      'Voice download failed.',
    );
  });

  it('announces only the highest milestone crossed', () => {
    const next = (before: number, after: number) =>
      packAnnouncement(view('downloading', before), view('downloading', after), 'Voice');
    expect(next(10, 20)).toBeNull();
    expect(next(20, 30)).toBe('Voice 25 percent downloaded.');
    expect(next(30, 80)).toBe('Voice 75 percent downloaded.');
  });
});
