import type { SynthesizeResult } from '@shared/ipc/types';

/** Length of the fade applied to the start and end of every clip to avoid clicks. */
const FADE_SECONDS = 0.008;

interface ScheduledClip {
  source: AudioBufferSourceNode;
  gain: GainNode;
  finish: () => void;
}

/**
 * Plays synthesised speech (float PCM from the on-device voice, mp3 from ElevenLabs) through one
 * AudioContext. Clips are scheduled back to back, so a reply that is rendered sentence by sentence
 * sounds continuous while the next sentence is still being synthesised.
 */
export class SpeechPlayer {
  private context: AudioContext | null = null;
  private readonly clips = new Set<ScheduledClip>();
  private nextStart = 0;

  /** True while anything is playing or scheduled. */
  get speaking(): boolean {
    return this.clips.size > 0;
  }

  /**
   * Schedules a clip after everything already queued. Resolves when this clip has finished playing
   * (or was stopped), and rejects when the audio cannot be decoded.
   */
  async enqueue(result: SynthesizeResult, volume = 1): Promise<void> {
    const context = await this.ensureContext();
    const buffer = await this.decode(context, result);

    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.02, this.nextStart);
    const endAt = startAt + buffer.duration;
    this.nextStart = endAt;
    const level = Math.min(Math.max(volume, 0), 1.5);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(level, startAt + FADE_SECONDS);
    gain.gain.setValueAtTime(level, Math.max(startAt + FADE_SECONDS, endAt - FADE_SECONDS));
    gain.gain.linearRampToValueAtTime(0, endAt);

    return new Promise<void>((resolve) => {
      let done = false;
      const clip: ScheduledClip = {
        source,
        gain,
        finish: () => {
          if (done) return;
          done = true;
          this.clips.delete(clip);
          if (this.clips.size === 0) this.nextStart = 0;
          source.disconnect();
          gain.disconnect();
          resolve();
        },
      };
      this.clips.add(clip);
      source.onended = clip.finish;
      source.start(startAt);
    });
  }

  /** Plays one clip now (everything queued before it is stopped). */
  async play(result: SynthesizeResult, volume = 1): Promise<void> {
    this.stop();
    await this.enqueue(result, volume);
  }

  /** Stops everything that is playing or queued; pending `enqueue` promises resolve. */
  stop(): void {
    for (const clip of [...this.clips]) {
      try {
        clip.source.stop();
      } catch {
        // Already stopped or never started.
      }
      clip.finish();
    }
    this.nextStart = 0;
  }

  /** Releases the audio device (the next clip creates a new context). */
  async dispose(): Promise<void> {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }

  private async ensureContext(): Promise<AudioContext> {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  private async decode(context: AudioContext, result: SynthesizeResult): Promise<AudioBuffer> {
    if (result.format === 'mp3') {
      // decodeAudioData detaches the buffer it is given.
      return context.decodeAudioData(result.data.slice(0));
    }
    const samples = new Float32Array(result.data);
    const buffer = context.createBuffer(1, samples.length, result.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }
}
