import type * as Sdk from 'microsoft-cognitiveservices-speech-sdk';
import type { SpeechTokenResult } from '@shared/ipc/types';
import type { RecognitionHandlers } from '@renderer/lib/voice/recognizer';

/** What the voice pipeline needs from a speech recognizer (offline Vosk or Azure Speech). */
export interface Recognition {
  /** Everything recognised so far (finished phrases + the live partial). */
  readonly text: string;
  feed(samples: Float32Array, sampleRate: number): void;
  /** Flushes the recognizer and returns the final text. */
  finish(timeoutMs?: number): Promise<string>;
  close(): void;
}

export type SpeechSdk = typeof Sdk;

let sdkPromise: Promise<SpeechSdk> | null = null;

/** The Speech SDK is large: it is only imported the first time Azure Speech is used. */
export function loadSpeechSdk(): Promise<SpeechSdk> {
  sdkPromise ??= import('microsoft-cognitiveservices-speech-sdk').catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

const TARGET_RATE = 16_000;

/** 16-bit little-endian PCM at 16 kHz from float samples at any rate (linear resampling). */
export function toPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const ratio = sampleRate / TARGET_RATE;
  const length = ratio === 1 ? samples.length : Math.floor(samples.length / ratio);
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    let value: number;
    if (ratio === 1) {
      value = samples[index] ?? 0;
    } else {
      const position = index * ratio;
      const low = Math.floor(position);
      const a = samples[low] ?? 0;
      const b = samples[Math.min(samples.length - 1, low + 1)] ?? a;
      value = a + (b - a) * (position - low);
    }
    const clamped = Math.max(-1, Math.min(1, value));
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm.buffer;
}

/** Escapes text for use inside SSML. */
export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

/** SSML for one utterance with the chosen neural voice and speaking rate (1 = normal). */
export function buildSsml(text: string, voice: string, rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  const signed = `${percent >= 0 ? '+' : ''}${percent}%`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${escapeXml(voice)}"><prosody rate="${signed}">${escapeXml(text)}</prosody></voice></speak>`
  );
}

/**
 * One utterance recognised by Azure Speech. Audio comes from the same microphone pipeline as the
 * offline recognizer (so the level meter, VAD and device choice are unchanged) and is pushed into
 * the service as PCM; partial and final phrases arrive through the SDK events.
 */
export class AzureRecognitionSession implements Recognition {
  private readonly finished: string[] = [];
  private partial = '';
  private readonly push: Sdk.PushAudioInputStream;
  private readonly recognizer: Sdk.SpeechRecognizer;
  private waiter: (() => void) | null = null;
  private closed = false;

  constructor(
    sdk: SpeechSdk,
    token: SpeechTokenResult,
    private readonly handlers: RecognitionHandlers,
    language = 'en-US',
  ) {
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
    config.speechRecognitionLanguage = language;
    this.push = sdk.AudioInputStream.createPushStream(
      sdk.AudioStreamFormat.getWaveFormatPCM(TARGET_RATE, 16, 1),
    );
    this.recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromStreamInput(this.push));

    this.recognizer.recognizing = (_sender, event) => {
      this.partial = event.result.text.trim();
      this.handlers.onText(this.text);
    };
    this.recognizer.recognized = (_sender, event) => {
      const text = event.result.text.trim();
      if (event.result.reason === sdk.ResultReason.RecognizedSpeech && text)
        this.finished.push(text);
      this.partial = '';
      this.handlers.onText(this.text);
    };
    this.recognizer.canceled = (_sender, event) => {
      if (event.reason === sdk.CancellationReason.Error) {
        this.handlers.onError(event.errorDetails || 'Azure Speech stopped unexpectedly.');
      }
      this.waiter?.();
    };
    this.recognizer.sessionStopped = () => this.waiter?.();
    this.recognizer.startContinuousRecognitionAsync(
      () => undefined,
      (error) => this.handlers.onError(String(error)),
    );
  }

  get text(): string {
    return [...this.finished, this.partial].filter(Boolean).join(' ').trim();
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (this.closed) return;
    this.push.write(toPcm16(samples, sampleRate));
  }

  async finish(timeoutMs = 4000): Promise<string> {
    if (this.closed) return this.text;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, timeoutMs);
      this.waiter = () => {
        window.clearTimeout(timer);
        resolve();
      };
      this.push.close();
    });
    this.waiter = null;
    return this.text;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.push.close();
      this.recognizer.close();
    } catch {
      // The SDK may already have torn the session down.
    }
  }
}

export interface AzureSpeakOptions {
  voice: string;
  rate: number;
  onStart: () => void;
  onBoundary: () => void;
  onEnd: () => void;
}

/** Azure neural text-to-speech with word-boundary callbacks (drives the orb pulse). */
export class AzureSpeaker {
  private synthesizer: Sdk.SpeechSynthesizer | null = null;
  private player: Sdk.SpeakerAudioDestination | null = null;
  private endHandler: (() => void) | null = null;

  get speaking(): boolean {
    return this.synthesizer !== null;
  }

  speak(sdk: SpeechSdk, token: SpeechTokenResult, text: string, options: AzureSpeakOptions): void {
    this.cancel();
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
    // Raw PCM plays through Web Audio, which needs no MediaSource (and no extra CSP allowances).
    config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
    const player = new sdk.SpeakerAudioDestination();
    const synthesizer = new sdk.SpeechSynthesizer(
      config,
      sdk.AudioConfig.fromSpeakerOutput(player),
    );
    this.player = player;
    this.synthesizer = synthesizer;
    this.endHandler = options.onEnd;

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (this.synthesizer === synthesizer) this.release();
      options.onEnd();
    };
    player.onAudioStart = () => options.onStart();
    player.onAudioEnd = finish;
    synthesizer.wordBoundary = () => options.onBoundary();
    synthesizer.speakSsmlAsync(
      buildSsml(text, options.voice, options.rate),
      () => undefined,
      () => finish(),
    );
  }

  /** Stops playback at once; the end callback of the interrupted utterance still fires once. */
  cancel(): void {
    const handler = this.endHandler;
    this.release();
    handler?.();
  }

  private release(): void {
    this.endHandler = null;
    const { player, synthesizer } = this;
    this.player = null;
    this.synthesizer = null;
    try {
      // Closing the player fires its end callback; the interrupted utterance reports end once.
      if (player) {
        player.onAudioStart = () => undefined;
        player.onAudioEnd = () => undefined;
      }
      if (synthesizer) synthesizer.wordBoundary = () => undefined;
      player?.pause();
      player?.close();
      synthesizer?.close();
    } catch {
      // Already closed.
    }
  }
}
