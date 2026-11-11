/** A synthesised camera shutter: two short bursts of filtered noise. Original, no samples. */
interface Click {
  /** Seconds after the start. */
  at: number;
  duration: number;
  /** Centre of the band of noise, in Hz. */
  frequency: number;
  gain: number;
}

const CLICKS: readonly Click[] = [
  { at: 0, duration: 0.05, frequency: 3400, gain: 0.9 },
  { at: 0.09, duration: 0.075, frequency: 1900, gain: 0.7 },
];

const MASTER_GAIN = 0.22;

export interface ShutterSound {
  play(): void;
  dispose(): void;
}

/** Plays the shutter with the Web Audio API; a missing audio device is never an error. */
export class Shutter implements ShutterSound {
  private context: AudioContext | null = null;

  play(): void {
    try {
      const context = this.ensureContext();
      const start = context.currentTime + 0.005;
      for (const click of CLICKS) this.schedule(context, click, start);
    } catch {
      // Audio output unavailable: the shutter is a nicety.
    }
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  private schedule(context: AudioContext, click: Click, origin: number): void {
    const length = Math.max(1, Math.ceil(context.sampleRate * click.duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const decay = (1 - index / length) ** 2;
      samples[index] = (Math.random() * 2 - 1) * decay;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = click.frequency;
    band.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.value = click.gain * MASTER_GAIN;
    source.connect(band).connect(gain).connect(context.destination);
    source.start(origin + click.at);
  }
}
