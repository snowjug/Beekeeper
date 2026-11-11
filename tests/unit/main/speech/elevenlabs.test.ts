import { describe, expect, it, vi } from 'vitest';
import {
  describeElevenLabsStatus,
  ElevenLabsError,
  synthesizeElevenLabs,
} from '@main/speech/elevenlabs';

function audioResponse(bytes = 8000): Response {
  return new Response(new Uint8Array(bytes), { status: 200 });
}

describe('synthesizeElevenLabs', () => {
  it('posts the text with the key, model and (for Flash) the language', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(audioResponse(8000)));
    const audio = await synthesizeElevenLabs({
      fetch: fetchMock,
      apiKey: 'sk-test',
      voiceId: 'abc123',
      model: 'eleven_flash_v2_5',
      text: 'नमस्ते',
      lang: 'hi',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/abc123?output_format=mp3_44100_64',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'नमस्ते',
      model_id: 'eleven_flash_v2_5',
      language_code: 'hi',
    });
    expect(audio.data.byteLength).toBe(8000);
    expect(audio.durationMs).toBe(1000);
  });

  it('does not send a language to models that cannot enforce one', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(audioResponse()));
    await synthesizeElevenLabs({
      fetch: fetchMock,
      apiKey: 'k',
      voiceId: 'v',
      model: 'eleven_multilingual_v2',
      text: 'Hello',
      lang: 'en',
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Hello',
      model_id: 'eleven_multilingual_v2',
    });
  });

  it('encodes the voice id in the URL', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(audioResponse()));
    await synthesizeElevenLabs({
      fetch: fetchMock,
      apiKey: 'k',
      voiceId: 'a/b?c',
      model: 'eleven_flash_v2_5',
      text: 'x',
      lang: 'en',
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/a%2Fb%3Fc?');
  });

  it.each([
    [401, /rejected the API key/],
    [404, /voice ID/],
    [429, /quota/],
    [500, /problems/],
  ])('explains HTTP %i', async (status, pattern) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status })));
    const failure = await synthesizeElevenLabs({
      fetch: fetchMock,
      apiKey: 'k',
      voiceId: 'v',
      model: 'eleven_flash_v2_5',
      text: 'x',
      lang: 'en',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ElevenLabsError);
    expect((failure as ElevenLabsError).message).toMatch(pattern);
    expect((failure as ElevenLabsError).status).toBe(status);
  });

  it('reports a network failure and an empty answer', async () => {
    const offline = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    await expect(
      synthesizeElevenLabs({
        fetch: offline,
        apiKey: 'k',
        voiceId: 'v',
        model: 'eleven_flash_v2_5',
        text: 'x',
        lang: 'en',
      }),
    ).rejects.toThrow(/internet connection/);

    const empty = vi.fn(() => Promise.resolve(new Response(new Uint8Array(0), { status: 200 })));
    await expect(
      synthesizeElevenLabs({
        fetch: empty,
        apiKey: 'k',
        voiceId: 'v',
        model: 'eleven_flash_v2_5',
        text: 'x',
        lang: 'en',
      }),
    ).rejects.toThrow(/no audio/);
  });

  it('has a fallback message for unexpected statuses', () => {
    expect(describeElevenLabsStatus(418)).toBe('ElevenLabs answered with HTTP 418.');
  });
});
