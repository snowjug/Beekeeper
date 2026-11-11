import { describe, expect, it, vi } from 'vitest';
import type { TranscribeResult } from '@shared/ipc/types';
import { isPhantomTranscript, WhisperRecognitionSession } from '@renderer/lib/voice/whisperSession';

function result(text: string): TranscribeResult {
  return { text, lang: 'en', model: 'small', durationMs: 100, audioMs: 1000 };
}

const handlers = () => ({ onText: vi.fn(), onError: vi.fn() });

function feedSeconds(session: WhisperRecognitionSession, seconds: number, rate = 16_000): void {
  const chunk = new Float32Array(rate / 10).fill(0.3);
  for (let index = 0; index < seconds * 10; index += 1) session.feed(chunk, rate);
}

function sentSamples(transcribe: ReturnType<typeof vi.fn>): Float32Array {
  return (transcribe.mock.calls[0] as unknown as [Float32Array])[0];
}

describe('WhisperRecognitionSession', () => {
  it('sends the buffered utterance once and returns the transcript', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('  what is the weather  ')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    feedSeconds(session, 2);

    expect(session.text).toBe('');
    expect(await session.finish()).toBe('what is the weather');
    expect(session.text).toBe('what is the weather');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(sentSamples(transcribe).length).toBe(32_000);
  });

  it('resamples audio that was not captured at 16 kHz', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('open chrome')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    feedSeconds(session, 1, 48_000);
    await session.finish();
    expect(sentSamples(transcribe).length).toBe(16_000);
  });

  it('copies fed chunks so the microphone can reuse its buffer', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('hello')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    const reused = new Float32Array(16_000).fill(0.4);
    session.feed(reused, 16_000);
    reused.fill(0);
    await session.finish();
    expect(sentSamples(transcribe)[100]).toBeCloseTo(0.4);
  });

  it('does not send recordings that are too short to contain a command', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('hmm')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    session.feed(new Float32Array(1600), 16_000);
    expect(await session.finish()).toBe('');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('ignores audio beyond the length the engine accepts', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('long')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    feedSeconds(session, 70);
    await session.finish();
    expect(sentSamples(transcribe).length).toBeLessThanOrEqual(60 * 16_000);
  });

  it('drops a phantom phrase that follows a very short burst of sound', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('Thank you.')));
    const noise = new WhisperRecognitionSession(transcribe, handlers(), () => 0.3);
    feedSeconds(noise, 1);
    expect(await noise.finish()).toBe('');

    const spoken = new WhisperRecognitionSession(transcribe, handlers(), () => 2.5);
    feedSeconds(spoken, 3);
    expect(await spoken.finish()).toBe('Thank you.');
  });

  it('reports a recognition failure and returns nothing', async () => {
    const failing = handlers();
    const session = new WhisperRecognitionSession(
      () => Promise.reject(new Error('model missing')),
      failing,
    );
    feedSeconds(session, 1);
    expect(await session.finish()).toBe('');
    expect(failing.onError).toHaveBeenCalledWith('model missing');
  });

  it('ignores audio after it was closed', async () => {
    const transcribe = vi.fn(() => Promise.resolve(result('x')));
    const session = new WhisperRecognitionSession(transcribe, handlers());
    session.close();
    feedSeconds(session, 1);
    expect(await session.finish()).toBe('');
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe('isPhantomTranscript', () => {
  it.each([
    '',
    '.',
    'You',
    'Thank you.',
    'Thanks for watching!',
    '[Music]',
    '(applause)',
    'धन्यवाद।',
  ])('treats %j as a phantom', (text) => {
    expect(isPhantomTranscript(text)).toBe(true);
  });

  it.each(['what time is it', 'thank you for the reminder', 'मौसम कैसा है', 'ok google'])(
    'keeps %j',
    (text) => {
      expect(isPhantomTranscript(text)).toBe(false);
    },
  );
});
