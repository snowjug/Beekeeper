import { describe, expect, it, vi } from 'vitest';
import {
  AzureRecognitionSession,
  AzureSpeaker,
  buildSsml,
  escapeXml,
  toPcm16,
  type SpeechSdk,
} from '@renderer/assistant/voice/azure';

const TOKEN = { token: 'tok', region: 'westeurope', expiresAt: 123 };

describe('toPcm16', () => {
  it('converts floats to clamped little-endian 16-bit samples', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]), 16_000));
    expect(Array.from(pcm)).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
  });

  it('resamples other rates to 16 kHz', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array(480).fill(0.25), 48_000));
    expect(pcm).toHaveLength(160);
    expect(Math.abs((pcm[10] ?? 0) - 8191)).toBeLessThanOrEqual(1);
  });
});

describe('SSML', () => {
  it('escapes markup and maps the speaking rate to a percentage', () => {
    expect(escapeXml(`a<b>&"c"'d'`)).toBe('a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;');
    const ssml = buildSsml('Tom & <Jerry>', 'en-US-AriaNeural', 1.25);
    expect(ssml).toContain('<voice name="en-US-AriaNeural">');
    expect(ssml).toContain('rate="+25%"');
    expect(ssml).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(buildSsml('x', 'v', 0.5)).toContain('rate="-50%"');
    expect(buildSsml('x', 'v', 9)).toContain('rate="+100%"');
  });

  it('escapes a hostile voice name', () => {
    expect(buildSsml('x', '"><script>', 1)).not.toContain('<script>');
  });
});

function fakeSdk() {
  const recognizer = {
    recognizing: undefined as unknown as (s: unknown, e: unknown) => void,
    recognized: undefined as unknown as (s: unknown, e: unknown) => void,
    canceled: undefined as unknown as (s: unknown, e: unknown) => void,
    sessionStopped: undefined as unknown as () => void,
    startContinuousRecognitionAsync: vi.fn((ok: () => void) => ok()),
    close: vi.fn(),
  };
  const push = { write: vi.fn(), close: vi.fn() };
  const config: Record<string, unknown> = {};
  const player = {
    onAudioStart: undefined as unknown as () => void,
    onAudioEnd: undefined as unknown as () => void,
    pause: vi.fn(),
    close: vi.fn(),
  };
  const synthesizer = {
    wordBoundary: undefined as unknown as () => void,
    speakSsmlAsync: vi.fn(),
    close: vi.fn(),
  };
  const sdk = {
    SpeechConfig: { fromAuthorizationToken: vi.fn(() => config) },
    AudioStreamFormat: { getWaveFormatPCM: vi.fn(() => 'format') },
    AudioInputStream: { createPushStream: vi.fn(() => push) },
    AudioConfig: {
      fromStreamInput: vi.fn(() => 'audio'),
      fromSpeakerOutput: vi.fn(() => 'speaker'),
    },
    SpeechRecognizer: function () {
      return recognizer;
    },
    SpeakerAudioDestination: function () {
      return player;
    },
    SpeechSynthesizer: function () {
      return synthesizer;
    },
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 1 },
    SpeechSynthesisOutputFormat: { Raw24Khz16BitMonoPcm: 'pcm' },
  } as unknown as SpeechSdk;
  return { sdk, recognizer, push, config, player, synthesizer };
}

describe('AzureRecognitionSession', () => {
  it('streams PCM into the service and reports partial and final phrases', async () => {
    const { sdk, recognizer, push, config } = fakeSdk();
    const onText = vi.fn();
    const session = new AzureRecognitionSession(sdk, TOKEN, { onText, onError: vi.fn() });
    expect(config['speechRecognitionLanguage']).toBe('en-US');
    expect(recognizer.startContinuousRecognitionAsync).toHaveBeenCalled();

    session.feed(new Float32Array([0.1, 0.2]), 16_000);
    expect(push.write).toHaveBeenCalledOnce();

    recognizer.recognizing({}, { result: { text: ' what time ' } });
    expect(onText).toHaveBeenLastCalledWith('what time');
    recognizer.recognized({}, { result: { text: 'what time is it', reason: 3 } });
    expect(session.text).toBe('what time is it');

    const done = session.finish(500);
    expect(push.close).toHaveBeenCalled();
    recognizer.sessionStopped();
    expect(await done).toBe('what time is it');
  });

  it('ignores unrecognised results, reports service errors and stops on cancel', async () => {
    const { sdk, recognizer } = fakeSdk();
    const onError = vi.fn();
    const session = new AzureRecognitionSession(sdk, TOKEN, { onText: vi.fn(), onError });
    recognizer.recognized({}, { result: { text: 'noise', reason: 0 } });
    expect(session.text).toBe('');
    recognizer.canceled({}, { reason: 1, errorDetails: 'Authentication failed' });
    expect(onError).toHaveBeenCalledWith('Authentication failed');
    expect(await session.finish(20)).toBe('');
  });

  it('close() is idempotent and stops feeding', () => {
    const { sdk, recognizer, push } = fakeSdk();
    const session = new AzureRecognitionSession(sdk, TOKEN, { onText: vi.fn(), onError: vi.fn() });
    session.close();
    session.close();
    session.feed(new Float32Array(10), 16_000);
    expect(push.write).not.toHaveBeenCalled();
    expect(recognizer.close).toHaveBeenCalledTimes(1);
  });
});

describe('AzureSpeaker', () => {
  it('synthesizes SSML with raw PCM output and reports start, boundaries and end', () => {
    const { sdk, synthesizer, player, config } = fakeSdk();
    const speaker = new AzureSpeaker();
    const callbacks = { onStart: vi.fn(), onBoundary: vi.fn(), onEnd: vi.fn() };
    speaker.speak(sdk, TOKEN, 'Hello', { voice: 'en-US-AriaNeural', rate: 1, ...callbacks });
    expect(config['speechSynthesisOutputFormat']).toBe('pcm');
    expect(speaker.speaking).toBe(true);
    expect(String(synthesizer.speakSsmlAsync.mock.calls[0]?.[0])).toContain('Hello');

    player.onAudioStart();
    synthesizer.wordBoundary();
    player.onAudioEnd();
    expect(callbacks.onStart).toHaveBeenCalledOnce();
    expect(callbacks.onBoundary).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(speaker.speaking).toBe(false);
  });

  it('cancel interrupts playback and reports the end exactly once', () => {
    const { sdk, synthesizer, player } = fakeSdk();
    const speaker = new AzureSpeaker();
    const onEnd = vi.fn();
    speaker.speak(sdk, TOKEN, 'Hello', {
      voice: 'v',
      rate: 1,
      onStart: vi.fn(),
      onBoundary: vi.fn(),
      onEnd,
    });
    speaker.cancel();
    player.onAudioEnd();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalled();
    expect(synthesizer.close).toHaveBeenCalled();
  });

  it('a synthesis error ends the utterance', () => {
    const { sdk, synthesizer } = fakeSdk();
    const speaker = new AzureSpeaker();
    const onEnd = vi.fn();
    synthesizer.speakSsmlAsync.mockImplementation((_ssml: string, _ok: unknown, fail: () => void) =>
      fail(),
    );
    speaker.speak(sdk, TOKEN, 'x', {
      voice: 'v',
      rate: 1,
      onStart: vi.fn(),
      onBoundary: vi.fn(),
      onEnd,
    });
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
