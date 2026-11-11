import { performance } from 'node:perf_hooks';
import type {
  AiTestResult,
  SpeechState,
  SynthesizeResult,
  TranscribeResult,
} from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import type { Settings } from '@shared/settings';
import { whisperPackFor, type SpeechPackId } from '@shared/speech/packs';
import { cleanForSpeech, detectLanguage } from '@shared/speech/text';
import { naturalVoiceSid } from '@shared/speech/voices';
import {
  pcmDurationMs,
  splitForWhisper,
  toArrayBuffer,
  trimSilence,
  WHISPER_SAMPLE_RATE,
} from './audio';
import { ElevenLabsError, synthesizeElevenLabs } from './elevenlabs';
import type { SpeechPackManager } from './packManager';
import type { WhisperSize } from './protocol';
import type { SpeechService, SynthesizeRequest, TranscribeRequest } from './types';
import type { SpeechWorker, SpeechWorkerFactory } from './workerClient';

const DEFAULT_IDLE_MS = 3 * 60_000;
const NOT_INSTALLED_VOICE = 'The natural voice is not installed. Download it in Settings > Voice.';
const NOT_INSTALLED_STT =
  'The speech recognition model is not installed. Download it in Settings > Voice.';

export interface SpeechEngineDeps {
  packs: SpeechPackManager;
  createWorker: SpeechWorkerFactory;
  settings: () => Settings;
  keys: { get(name: 'elevenlabs'): string | null };
  fetch: typeof fetch;
  logger: Logger;
  /** Models are released after this long without a request. */
  idleMs?: number;
  threads?: number;
}

interface Slot<T> {
  worker: SpeechWorker;
  ready: Promise<void>;
  loaded: boolean;
  detail: T;
  inflight: number;
  timer: NodeJS.Timeout | null;
}

type TtsSlot = Slot<null>;
type SttSlot = Slot<WhisperSize>;

/**
 * On-device speech with a lifecycle: models load lazily in worker threads, stay in memory while in
 * use and are released (the thread is terminated) after a few idle minutes, so an idle Beekeeper
 * costs no model memory.
 */
export class SpeechEngine implements SpeechService {
  private tts: TtsSlot | null = null;
  private stt: SttSlot | null = null;
  private loading = 0;
  private lastError: string | undefined;
  private readonly listeners = new Set<(state: SpeechState) => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: SpeechEngineDeps) {
    this.unsubscribe = deps.packs.onChange(() => this.emit());
  }

  status(): SpeechState {
    const engine: SpeechState['engine'] =
      this.loading > 0
        ? 'loading'
        : this.lastError
          ? 'error'
          : this.tts || this.stt
            ? 'ready'
            : 'idle';
    return {
      packs: this.deps.packs.status(),
      engine,
      ...(this.lastError ? { engineMessage: this.lastError } : {}),
      loaded: {
        tts: this.tts?.loaded ?? false,
        stt: this.stt?.loaded ? this.stt.detail : null,
      },
    };
  }

  onState(listener: (state: SpeechState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensurePack(id: SpeechPackId): Promise<SpeechState> {
    void this.deps.packs.ensure(id);
    return Promise.resolve(this.status());
  }

  cancelPack(id: SpeechPackId): SpeechState {
    this.deps.packs.cancel(id);
    return this.status();
  }

  async removePack(id: SpeechPackId): Promise<SpeechState> {
    if (id === 'supertonic-3') await this.releaseTts();
    else await this.releaseStt();
    await this.deps.packs.remove(id);
    return this.status();
  }

  async preload(options: { tts?: boolean; stt?: boolean }): Promise<void> {
    const jobs: Array<Promise<unknown>> = [];
    if (options.tts && this.deps.packs.isReady('supertonic-3')) jobs.push(this.ensureTts());
    const model = this.pickWhisper();
    if (options.stt && model) jobs.push(this.ensureStt(model));
    await Promise.allSettled(jobs);
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    const started = performance.now();
    const voice = this.deps.settings().voice;
    const lang = request.lang === 'auto' ? detectLanguage(request.text) : request.lang;
    const text = cleanForSpeech(request.text, lang);
    if (text === '') throw new Error('There is nothing to say.');

    const key = this.deps.keys.get('elevenlabs');
    if (voice.ttsEngine === 'elevenlabs' && key && voice.elevenLabsVoiceId) {
      const audio = await synthesizeElevenLabs({
        fetch: this.deps.fetch,
        apiKey: key,
        voiceId: voice.elevenLabsVoiceId,
        model: voice.elevenLabsModel,
        text,
        lang,
      });
      return {
        format: 'mp3',
        sampleRate: 44_100,
        data: audio.data,
        durationMs: audio.durationMs,
        engine: 'elevenlabs',
        lang,
        elapsedMs: Math.round(performance.now() - started),
      };
    }

    const slot = await this.ensureTts();
    slot.inflight += 1;
    try {
      const result = await slot.worker.request(
        {
          type: 'synthesize',
          text,
          lang,
          sid: naturalVoiceSid(request.voice ?? voice.naturalVoice),
          speed: request.speed ?? voice.naturalSpeed,
        },
        'synthesized',
      );
      const samples = trimSilence(result.samples, result.sampleRate);
      return {
        format: 'f32',
        sampleRate: result.sampleRate,
        data: toArrayBuffer(samples),
        durationMs: pcmDurationMs(samples.length, result.sampleRate),
        engine: 'natural',
        lang,
        elapsedMs: Math.round(performance.now() - started),
      };
    } finally {
      this.finish(slot, () => this.releaseTts(slot));
    }
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    const started = performance.now();
    const size = this.pickWhisper();
    if (!size) throw new Error(NOT_INSTALLED_STT);
    const requested = request.language ?? this.deps.settings().voice.language;

    const slot = await this.ensureStt(size);
    slot.inflight += 1;
    try {
      let language: '' | 'en' | 'hi' = requested === 'auto' ? '' : requested;
      let detected = requested === 'auto' ? '' : requested;
      const parts: string[] = [];
      for (const chunk of splitForWhisper(request.samples, WHISPER_SAMPLE_RATE)) {
        const copy = new Float32Array(chunk.length);
        copy.set(chunk);
        let result = await slot.worker.request(
          { type: 'transcribe', samples: copy, language },
          'transcribed',
          [copy.buffer],
        );
        if (language === '' && result.lang !== 'en' && result.lang !== 'hi') {
          // Detection picked a language Beekeeper does not serve: an accent is the usual cause.
          const again = new Float32Array(chunk.length);
          again.set(chunk);
          result = await slot.worker.request(
            { type: 'transcribe', samples: again, language: 'en' },
            'transcribed',
            [again.buffer],
          );
        }
        if (detected === '') detected = result.lang;
        if (language === '') language = result.lang === 'hi' ? 'hi' : 'en';
        if (result.text) parts.push(result.text);
      }
      return {
        text: parts.join(' ').replace(/\s+/g, ' ').trim(),
        lang: detected || 'en',
        model: size,
        durationMs: Math.round(performance.now() - started),
        audioMs: pcmDurationMs(request.samples.length, WHISPER_SAMPLE_RATE),
      };
    } finally {
      this.finish(slot, () => this.releaseStt(slot));
    }
  }

  async testElevenLabs(): Promise<AiTestResult> {
    const voice = this.deps.settings().voice;
    const key = this.deps.keys.get('elevenlabs');
    if (!key) return { ok: false, message: 'Enter your ElevenLabs API key first.' };
    if (!voice.elevenLabsVoiceId) {
      return { ok: false, message: 'Paste a voice ID from your ElevenLabs Voice Library first.' };
    }
    const started = performance.now();
    try {
      await synthesizeElevenLabs({
        fetch: this.deps.fetch,
        apiKey: key,
        voiceId: voice.elevenLabsVoiceId,
        model: voice.elevenLabsModel,
        text: 'Hello.',
        lang: 'en',
      });
      return {
        ok: true,
        message: 'Connected to ElevenLabs. The voice works.',
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof ElevenLabsError ? error.message : 'The test could not be completed.',
      };
    }
  }

  async dispose(): Promise<void> {
    this.unsubscribe();
    this.listeners.clear();
    this.deps.packs.dispose();
    await Promise.all([this.releaseTts(), this.releaseStt()]);
  }

  /** Preferred Whisper model when installed, otherwise the other one, otherwise null. */
  private pickWhisper(): WhisperSize | null {
    const preferred = this.deps.settings().voice.whisperModel;
    const other: WhisperSize = preferred === 'small' ? 'base' : 'small';
    if (this.deps.packs.isReady(whisperPackFor(preferred))) return preferred;
    if (this.deps.packs.isReady(whisperPackFor(other))) return other;
    return null;
  }

  private get threads(): number {
    return this.deps.threads ?? 4;
  }

  private async ensureTts(): Promise<TtsSlot> {
    if (!this.deps.packs.isReady('supertonic-3')) throw new Error(NOT_INSTALLED_VOICE);
    const existing = this.tts;
    if (existing?.worker.alive) {
      await this.awaitSlot(existing, () => this.releaseTts(existing));
      return existing;
    }
    const worker = this.deps.createWorker();
    const slot: TtsSlot = {
      worker,
      ready: Promise.resolve(),
      loaded: false,
      detail: null,
      inflight: 0,
      timer: null,
    };
    this.tts = slot;
    slot.ready = this.load(slot, () =>
      worker.request(
        { type: 'loadTts', dir: this.deps.packs.dir('supertonic-3'), threads: this.threads },
        'loaded',
      ),
    );
    await this.awaitSlot(slot, () => this.releaseTts(slot));
    return slot;
  }

  private async ensureStt(size: WhisperSize): Promise<SttSlot> {
    const pack = whisperPackFor(size);
    if (!this.deps.packs.isReady(pack)) throw new Error(NOT_INSTALLED_STT);
    if (this.stt && this.stt.detail !== size) await this.releaseStt(this.stt);
    const existing = this.stt;
    if (existing?.worker.alive) {
      await this.awaitSlot(existing, () => this.releaseStt(existing));
      return existing;
    }
    const worker = this.deps.createWorker();
    const slot: SttSlot = {
      worker,
      ready: Promise.resolve(),
      loaded: false,
      detail: size,
      inflight: 0,
      timer: null,
    };
    this.stt = slot;
    slot.ready = this.load(slot, () =>
      worker.request(
        { type: 'loadStt', size, dir: this.deps.packs.dir(pack), threads: this.threads },
        'loaded',
      ),
    );
    await this.awaitSlot(slot, () => this.releaseStt(slot));
    return slot;
  }

  private load<T>(slot: Slot<T>, run: () => Promise<unknown>): Promise<void> {
    this.loading += 1;
    this.lastError = undefined;
    this.emit();
    return run()
      .then(() => {
        slot.loaded = true;
      })
      .finally(() => {
        this.loading -= 1;
        this.emit();
      });
  }

  /** Waits for a slot to load; on failure stops its worker and reports the problem. */
  private async awaitSlot<T>(slot: Slot<T>, release: () => Promise<void>): Promise<void> {
    try {
      await slot.ready;
    } catch (error) {
      this.deps.logger.error('Loading a speech model failed', error);
      this.lastError = 'The speech engine could not start. Reinstall the voice pack in Settings.';
      await release();
      throw new Error(this.lastError);
    }
    this.touch(slot, release);
    this.emit();
  }

  private finish<T>(slot: Slot<T>, release: () => Promise<void>): void {
    slot.inflight = Math.max(0, slot.inflight - 1);
    this.touch(slot, release);
  }

  /** (Re)starts the idle timer: the models go away after `idleMs` without a request. */
  private touch<T>(slot: Slot<T>, release: () => Promise<void>): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      if (slot.inflight > 0) {
        this.touch(slot, release);
        return;
      }
      this.deps.logger.info('Releasing the speech models after a period of inactivity');
      void release();
    }, this.deps.idleMs ?? DEFAULT_IDLE_MS);
    slot.timer.unref();
  }

  private async releaseTts(slot: TtsSlot | null = this.tts): Promise<void> {
    if (slot && this.tts === slot) this.tts = null;
    await this.stop(slot);
  }

  private async releaseStt(slot: SttSlot | null = this.stt): Promise<void> {
    if (slot && this.stt === slot) this.stt = null;
    await this.stop(slot);
  }

  private async stop<T>(slot: Slot<T> | null): Promise<void> {
    if (!slot) return;
    if (slot.timer) clearTimeout(slot.timer);
    slot.ready.catch(() => undefined);
    await slot.worker.terminate().catch(() => undefined);
    this.emit();
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const state = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch (error) {
        this.deps.logger.warn('Speech listener failed', error);
      }
    }
  }
}
