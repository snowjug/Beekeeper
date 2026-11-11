/**
 * Worker thread that runs the on-device speech models (sherpa-onnx): the natural text-to-speech
 * model and Whisper recognition. It holds the models in memory; the main process terminates the
 * thread when it has been idle for a while, which returns all of that memory to the system.
 *
 * Bundled as its own entry (out/main/speechWorker.js). It must not import runtime code from other
 * modules, so that no shared chunk has to be unpacked next to it in the packaged app.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse, WorkerResult } from './protocol';

interface SherpaAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaTts {
  generate(request: {
    text: string;
    generationConfig: unknown;
    /** Electron forbids external buffers: the audio must be copied into a normal ArrayBuffer. */
    enableExternalBuffer: boolean;
  }): SherpaAudio;
}

interface SherpaStream {
  acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text: string; lang?: string };
  setConfig(config: unknown): void;
}

interface SherpaModule {
  OfflineTts: new (config: unknown) => SherpaTts;
  GenerationConfig: new (config: unknown) => unknown;
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
}

interface WhisperEntry {
  recognizer: SherpaRecognizer;
  size: 'small' | 'base';
  dir: string;
  threads: number;
  language: string;
}

const port = parentPort;
if (!port) throw new Error('The speech worker must run in a worker thread');

const nodeRequire = createRequire(__filename);
let sherpaModule: SherpaModule | null = null;
let tts: SherpaTts | null = null;
let whisper: WhisperEntry | null = null;

function sherpa(): SherpaModule {
  sherpaModule ??= nodeRequire('sherpa-onnx-node') as SherpaModule;
  return sherpaModule;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function whisperConfig(entry: Omit<WhisperEntry, 'recognizer'>): unknown {
  const { size, dir, threads, language } = entry;
  return {
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: join(dir, `${size}-encoder.int8.onnx`),
        decoder: join(dir, `${size}-decoder.int8.onnx`),
        language,
        task: 'transcribe',
        tailPaddings: 800,
      },
      tokens: join(dir, `${size}-tokens.txt`),
      numThreads: threads,
      provider: 'cpu',
      debug: false,
    },
  };
}

function generate(text: string, lang: 'en' | 'hi', sid: number, speed: number): SherpaAudio {
  if (!tts) throw new Error('The natural voice is not loaded');
  const generationConfig = new (sherpa().GenerationConfig)({ sid, speed, extra: { lang } });
  return tts.generate({ text, generationConfig, enableExternalBuffer: false });
}

/**
 * Silence added around every recording. Whisper decides where an utterance ends from what follows
 * it; without padding it often stops early on tightly trimmed audio (the last words are lost).
 */
const PAD_LEAD_SAMPLES = 6400;
const PAD_TAIL_SAMPLES = 19_200;

function decode(samples: Float32Array, language: '' | 'en' | 'hi'): { text: string; lang: string } {
  if (!whisper) throw new Error('The recognition model is not loaded');
  if (whisper.language !== language) {
    whisper.language = language;
    whisper.recognizer.setConfig(whisperConfig(whisper));
  }
  const padded = new Float32Array(samples.length + PAD_LEAD_SAMPLES + PAD_TAIL_SAMPLES);
  padded.set(samples, PAD_LEAD_SAMPLES);
  const stream = whisper.recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16_000, samples: padded });
  whisper.recognizer.decode(stream);
  const result = whisper.recognizer.getResult(stream);
  return {
    text: result.text.trim(),
    lang: result.lang && result.lang !== '' ? result.lang : language,
  };
}

function handle(request: WorkerRequest): { result: WorkerResult; transfer: ArrayBuffer[] } {
  const started = process.hrtime.bigint();
  switch (request.type) {
    case 'loadTts': {
      tts = new (sherpa().OfflineTts)({
        model: {
          supertonic: {
            durationPredictor: join(request.dir, 'duration_predictor.int8.onnx'),
            textEncoder: join(request.dir, 'text_encoder.int8.onnx'),
            vectorEstimator: join(request.dir, 'vector_estimator.int8.onnx'),
            vocoder: join(request.dir, 'vocoder.int8.onnx'),
            ttsJson: join(request.dir, 'tts.json'),
            unicodeIndexer: join(request.dir, 'unicode_indexer.bin'),
            voiceStyle: join(request.dir, 'voice.bin'),
          },
          debug: false,
          numThreads: request.threads,
          provider: 'cpu',
        },
      });
      // The first synthesis pays for lazy runtime start-up: do it now, off the critical path.
      generate('Hello.', 'en', 0, 1);
      return { result: { type: 'loaded', ms: elapsedMs(started) }, transfer: [] };
    }
    case 'loadStt': {
      const entry = {
        size: request.size,
        dir: request.dir,
        threads: request.threads,
        language: '',
      };
      whisper = {
        ...entry,
        recognizer: new (sherpa().OfflineRecognizer)(whisperConfig(entry)),
      };
      decode(new Float32Array(16_000), '');
      return { result: { type: 'loaded', ms: elapsedMs(started) }, transfer: [] };
    }
    case 'synthesize': {
      const audio = generate(request.text, request.lang, request.sid, request.speed);
      const samples = new Float32Array(audio.samples.length);
      samples.set(audio.samples);
      return {
        result: {
          type: 'synthesized',
          samples,
          sampleRate: audio.sampleRate,
          ms: elapsedMs(started),
        },
        transfer: [samples.buffer],
      };
    }
    case 'transcribe': {
      const { text, lang } = decode(request.samples, request.language);
      return { result: { type: 'transcribed', text, lang, ms: elapsedMs(started) }, transfer: [] };
    }
  }
}

port.on('message', (request: WorkerRequest) => {
  let response: WorkerResponse;
  let transfer: ArrayBuffer[] = [];
  try {
    const handled = handle(request);
    transfer = handled.transfer;
    response = { id: request.id, ok: true, result: handled.result };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(response, transfer);
});
