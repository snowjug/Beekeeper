import captureWorkletUrl from './capture.worklet.js?url';

export type MicErrorKind = 'denied' | 'no-device' | 'busy' | 'unknown';

export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export function toMicError(error: unknown): MicError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new MicError('denied', 'Microphone access is blocked.');
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return new MicError('no-device', 'No microphone was found.');
    case 'NotReadableError':
    case 'AbortError':
      return new MicError('busy', 'The microphone is being used by another app.');
    default:
      return new MicError('unknown', error instanceof Error ? error.message : 'Microphone error.');
  }
}

export const MIC_ERROR_HELP: Record<MicErrorKind, string> = {
  denied:
    'Microphone access is turned off. Allow desktop apps to use the microphone in Windows Settings, then try again.',
  'no-device':
    'I cannot find a microphone. Plug one in or pick another device in Settings > Voice.',
  busy: 'Another app is using the microphone. Close it and try again.',
  unknown: 'Something went wrong while opening the microphone.',
};

export interface MicSession {
  /** Sample rate of the chunks delivered to `onSamples` (16 kHz). */
  readonly sampleRate: number;
  /** Current time-domain RMS, 0..1. Call once per animation frame. */
  readLevel(): number;
  onSamples(listener: (samples: Float32Array, sampleRate: number) => void): void;
  stop(): void;
}

const SAMPLE_RATE = 16_000;

/**
 * Opens the selected microphone (getUserMedia) and exposes (a) an analyser level for the orb and
 * waveform and (b) 100 ms Float32 chunks from an AudioWorklet for the recognizer. Everything is
 * released by `stop()` so the mic is only active while listening (spec 6).
 */
export async function openMic(deviceId: string): Promise<MicSession> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    throw toMicError(error);
  }

  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    context = new AudioContext({ latencyHint: 'interactive' });
  }

  try {
    await context.audioWorklet.addModule(captureWorkletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw new MicError('unknown', error instanceof Error ? error.message : 'Audio capture failed.');
  }
  if (context.state === 'suspended') await context.resume();

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  const worklet = new AudioWorkletNode(context, 'beekeeper-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  source.connect(worklet);
  worklet.connect(mute).connect(context.destination);

  const buffer = new Float32Array(analyser.fftSize);
  const listeners = new Set<(samples: Float32Array, sampleRate: number) => void>();
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    for (const listener of listeners) listener(event.data, context.sampleRate);
  };

  let stopped = false;
  return {
    sampleRate: context.sampleRate,
    readLevel() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      return Math.sqrt(sum / buffer.length);
    },
    onSamples(listener) {
      listeners.add(listener);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      listeners.clear();
      worklet.port.onmessage = null;
      source.disconnect();
      worklet.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
