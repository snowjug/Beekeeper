/** ElevenLabs text-to-speech (optional cloud voice; the API key stays in the main process). */

export type ElevenLabsModel = 'eleven_flash_v2_5' | 'eleven_multilingual_v2';

export interface ElevenLabsRequest {
  fetch: typeof fetch;
  apiKey: string;
  voiceId: string;
  model: ElevenLabsModel;
  text: string;
  lang: 'en' | 'hi';
  timeoutMs?: number;
}

export interface ElevenLabsAudio {
  data: ArrayBuffer;
  /** Estimated from the 64 kbit/s stream; the player knows the real length after decoding. */
  durationMs: number;
}

const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_64';
const BITRATE = 64_000;

/** Only the Flash and Turbo models accept an explicit language. */
function supportsLanguageCode(model: ElevenLabsModel): boolean {
  return model === 'eleven_flash_v2_5';
}

export function describeElevenLabsStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'ElevenLabs did not accept the request. Check the voice ID and model.';
    case 401:
    case 403:
      return 'ElevenLabs rejected the API key. Check that it is correct and has text-to-speech access.';
    case 404:
      return 'ElevenLabs could not find that voice ID. Copy it again from your Voice Library.';
    case 402:
    case 429:
      return 'Your ElevenLabs quota or rate limit has been reached.';
    default:
      return status >= 500
        ? 'ElevenLabs is having problems right now. Try again later.'
        : `ElevenLabs answered with HTTP ${status}.`;
  }
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}

/** Returns MP3 audio for `text`. Throws ElevenLabsError with a message fit for the user. */
export async function synthesizeElevenLabs(request: ElevenLabsRequest): Promise<ElevenLabsAudio> {
  const url = `${ENDPOINT}/${encodeURIComponent(request.voiceId)}?output_format=${OUTPUT_FORMAT}`;
  let response: Response;
  try {
    response = await request.fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': request.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: request.model,
        ...(supportsLanguageCode(request.model) ? { language_code: request.lang } : {}),
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
    });
  } catch {
    throw new ElevenLabsError(
      'Beekeeper could not reach ElevenLabs. Check your internet connection.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ElevenLabsError(describeElevenLabsStatus(response.status), response.status);
  }
  const data = await response.arrayBuffer();
  if (data.byteLength === 0) throw new ElevenLabsError('ElevenLabs returned no audio.');
  return { data, durationMs: Math.round(((data.byteLength * 8) / BITRATE) * 1000) };
}
