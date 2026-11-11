export type EarconKind = 'start' | 'stop' | 'error' | 'chime';

interface Note {
  /** Hz */
  frequency: number;
  /** seconds after the start of the earcon */
  at: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

/** Note sequences for each earcon. Original, synthesised - no samples, no third-party sounds. */
export const EARCON_NOTES: Record<EarconKind, readonly Note[]> = {
  // Rising major sixth: "I'm listening".
  start: [
    { frequency: 659.25, at: 0, duration: 0.11, gain: 0.7 },
    { frequency: 987.77, at: 0.075, duration: 0.16, gain: 0.8 },
  ],
  // Falling: "got it".
  stop: [
    { frequency: 987.77, at: 0, duration: 0.1, gain: 0.7 },
    { frequency: 659.25, at: 0.07, duration: 0.16, gain: 0.7 },
  ],
  // Two soft low pulses: "something is off".
  error: [
    { frequency: 220, at: 0, duration: 0.16, gain: 0.8, type: 'triangle' },
    { frequency: 207.65, at: 0.18, duration: 0.24, gain: 0.8, type: 'triangle' },
  ],
  // Bell-like arpeggio, repeated three times: timers, alarms and reminders.
  chime: [0, 0.9, 1.8].flatMap((offset) => [
    { frequency: 1046.5, at: offset, duration: 0.5, gain: 0.8 },
    { frequency: 1318.51, at: offset + 0.14, duration: 0.5, gain: 0.7 },
    { frequency: 1567.98, at: offset + 0.28, duration: 0.55, gain: 0.7 },
    { frequency: 2093, at: offset + 0.42, duration: 0.7, gain: 0.6 },
  ]),
};

const MASTER_GAIN = 0.16;

/** Total length of an earcon in seconds (used by tests and to know when to release the context). */
export function earconLength(kind: EarconKind): number {
  return EARCON_NOTES[kind].reduce((end, note) => Math.max(end, note.at + note.duration), 0);
}

/** Plays short chimes with the Web Audio API. */
export class Earcons {
  private context: AudioContext | null = null;

  play(kind: EarconKind): void {
    try {
      const context = this.ensureContext();
      const start = context.currentTime + 0.01;
      for (const note of EARCON_NOTES[kind]) this.schedule(context, note, start);
    } catch {
      // Audio output unavailable: earcons are a nicety, never an error.
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

  private schedule(context: AudioContext, note: Note, origin: number): void {
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const envelope = context.createGain();
    const when = origin + note.at;
    const peak = (note.gain ?? 0.7) * MASTER_GAIN;

    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.value = note.frequency;
    overtone.type = 'sine';
    overtone.frequency.value = note.frequency * 2.01;

    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + note.duration);

    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.18;
    oscillator.connect(envelope);
    overtone.connect(overtoneGain).connect(envelope);
    envelope.connect(context.destination);

    oscillator.start(when);
    overtone.start(when);
    oscillator.stop(when + note.duration + 0.05);
    overtone.stop(when + note.duration + 0.05);
  }
}
