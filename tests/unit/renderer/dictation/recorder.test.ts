import { describe, expect, it } from 'vitest';
import {
  chunkRms,
  MAX_SUBMIT_SAMPLES,
  MIN_SUBMIT_SAMPLES,
  Recording,
  trimRange,
  voicedThreshold,
} from '@renderer/dictation/recorder';
import { chunk } from './testUtils';

/** Feeds `count` chunks of one kind and returns the last event that was not "none". */
function feed(recording: Recording, kind: 'speech' | 'silence', count: number, rate = 16_000) {
  const events: string[] = [];
  for (let index = 0; index < count; index += 1) {
    events.push(recording.push(chunk(kind, rate, 100), rate));
  }
  return events.filter((event) => event !== 'none');
}

describe('chunkRms', () => {
  it('is zero for silence and the amplitude over root two for a sine', () => {
    expect(chunkRms(new Float32Array(0))).toBe(0);
    expect(chunkRms(new Float32Array(100))).toBe(0);
    expect(chunkRms(chunk('speech'))).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });
});

describe('voicedThreshold', () => {
  it('is the lowest allowed level in a quiet room', () => {
    expect(voicedThreshold([])).toBe(0.012);
    expect(voicedThreshold([0, 0.001, 0.2])).toBe(0.012);
  });

  it('rises with the background noise', () => {
    expect(voicedThreshold([0.01, 0.2, 0.15])).toBeCloseTo(0.032, 5);
  });

  it('never rises above a soft voice, even when there was no pause at all', () => {
    expect(voicedThreshold([0.2, 0.3, 0.25])).toBe(0.05);
  });
});

describe('trimRange', () => {
  // Ten chunks of 1600 samples = 100 ms each.
  const chunkLengths = Array.from({ length: 10 }, () => 1600);

  it('keeps 300 ms before the first speech and 300 ms after the last', () => {
    expect(trimRange({ chunkLengths, firstVoiced: 4, lastVoiced: 5, sampleRate: 16_000 })).toEqual({
      start: 4 * 1600 - 4800,
      end: 6 * 1600 + 4800,
    });
  });

  it('never goes beyond the recording', () => {
    expect(trimRange({ chunkLengths, firstVoiced: 0, lastVoiced: 9, sampleRate: 16_000 })).toEqual({
      start: 0,
      end: 16_000,
    });
    expect(trimRange({ chunkLengths, firstVoiced: 1, lastVoiced: 8, sampleRate: 16_000 })).toEqual({
      start: 0,
      end: 16_000,
    });
  });

  it('honours other margins and sample rates', () => {
    expect(
      trimRange({
        chunkLengths: [4800, 4800, 4800, 4800],
        firstVoiced: 2,
        lastVoiced: 2,
        sampleRate: 48_000,
        preRollMs: 100,
        tailMs: 50,
      }),
    ).toEqual({ start: 9600 - 4800, end: 14_400 + 2400 });
  });

  it('copes with chunks of different lengths', () => {
    expect(
      trimRange({
        chunkLengths: [1000, 3000, 500],
        firstVoiced: 1,
        lastVoiced: 1,
        sampleRate: 16_000,
        preRollMs: 0,
        tailMs: 0,
      }),
    ).toEqual({ start: 1000, end: 4000 });
  });
});

describe('Recording', () => {
  it('ends after the silence that follows speech', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    expect(feed(recording, 'silence', 3)).toEqual([]);
    expect(feed(recording, 'speech', 5)).toEqual(['speech-start']);
    expect(recording.hasSpeech).toBe(true);
    expect(feed(recording, 'silence', 8)).toEqual(['speech-end']);
  });

  it('keeps 300 ms of pre-roll and drops the long silences around the speech', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'silence', 20); // 2 s of nothing
    feed(recording, 'speech', 10); // 1 s of speech
    feed(recording, 'silence', 8);

    const audio = recording.finish();
    // 300 ms before + 1 s of speech + 300 ms after = 1.6 s at 16 kHz.
    expect(audio?.length).toBe(25_600);
    // The first 300 ms are the quiet pre-roll, the speech starts right after it.
    expect(Math.max(...Array.from(audio?.subarray(0, 4800) ?? []).map(Math.abs))).toBe(0);
    expect(
      Math.max(...Array.from(audio?.subarray(4800, 6400) ?? []).map(Math.abs)),
    ).toBeGreaterThan(0.1);
  });

  it('does not clip the first word when speech starts at once', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'speech', 5);
    feed(recording, 'silence', 8);
    expect(recording.finish()?.length).toBe(8000 + 4800);
  });

  it('lifts a quiet recording to a comfortable level', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    // Barely above the detector's threshold: amplitude 0.03.
    const quietSpeech = chunk('speech').map((sample) => sample / 10);
    for (let index = 0; index < 5; index += 1) recording.push(quietSpeech, 16_000);
    feed(recording, 'silence', 8);
    const audio = recording.finish();
    expect(Math.max(...Array.from(audio ?? []).map(Math.abs))).toBeGreaterThan(0.2);
  });

  it('resamples a microphone that could not run at 16 kHz', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'speech', 5, 48_000);
    feed(recording, 'silence', 8, 48_000);
    // 0.5 s of speech + 0.3 s of tail, at 16 kHz.
    expect(recording.finish()?.length).toBe(Math.round(0.8 * 16_000));
  });

  it('reports nothing when nobody spoke', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'silence', 30);
    expect(recording.hasSpeech).toBe(false);
    expect(recording.finish()).toBeNull();
  });

  it('does not send a click as if it were speech', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'silence', 10);
    recording.push(chunk('speech'), 16_000);
    feed(recording, 'silence', 10);
    expect(recording.hasSpeech).toBe(false);
    expect(recording.finish()).toBeNull();
  });

  it('gives up after ten seconds of silence', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    expect(feed(recording, 'silence', 120)).toEqual(['no-speech']);
  });

  it('stops at the maximum length', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 2 });
    expect(feed(recording, 'speech', 30)).toEqual(['speech-start', 'max-duration']);
  });

  it('ignores chunks that arrive after it ended', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    feed(recording, 'speech', 5);
    expect(feed(recording, 'silence', 8)).toEqual(['speech-end']);
    const before = recording.finish()?.length;
    feed(recording, 'speech', 20);
    expect(recording.finish()?.length).toBe(before);
  });

  it('skips the audio of the start beep', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60, discardMs: 300 });
    // The beep (3 chunks) would count as speech if it were kept.
    expect(feed(recording, 'speech', 3)).toEqual([]);
    expect(recording.hasSpeech).toBe(false);
    feed(recording, 'silence', 5);
    expect(recording.finish()).toBeNull();
  });

  it('refuses a recording too short for the speech service', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    // 20 ms of sound.
    recording.push(chunk('speech', 16_000, 20), 16_000);
    expect(recording.finish()).toBeNull();
    expect(MIN_SUBMIT_SAMPLES).toBe(1600);
  });

  it('never hands over more than the speech service accepts', () => {
    // A detector allowed to run for 70 s: the audio is cut at 60 s. Natural speech pauses briefly
    // between phrases, here one quiet chunk in every twenty.
    const recording = new Recording({ silenceMs: 800, maxSeconds: 70 });
    for (let index = 0; index < 625; index += 1) {
      feed(recording, index % 20 === 19 ? 'silence' : 'speech', 1);
    }
    expect(recording.finish()?.length).toBe(MAX_SUBMIT_SAMPLES);
    expect(MAX_SUBMIT_SAMPLES).toBe(960_000);
  });

  it('keeps a long speech whole, the quiet gaps in it included', () => {
    const recording = new Recording({ silenceMs: 800, maxSeconds: 60 });
    for (let index = 0; index < 300; index += 1) {
      feed(recording, index % 20 === 19 ? 'silence' : 'speech', 1);
    }
    feed(recording, 'silence', 8);
    // The last chunk of the pattern is a quiet one: 29.9 s of speech and gaps, then 300 ms of tail.
    expect(recording.finish()?.length).toBe(299 * 1600 + 4800);
  });
});
