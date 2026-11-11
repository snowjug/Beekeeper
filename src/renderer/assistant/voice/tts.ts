export interface SpeakOptions {
  voiceUri: string;
  rate: number;
  onStart: () => void;
  onBoundary: () => void;
  onEnd: () => void;
}

/** Picks the configured voice, else an installed local en-US voice, else the browser default. */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  voiceUri: string,
): SpeechSynthesisVoice | null {
  if (voiceUri) {
    const exact = voices.find((voice) => voice.voiceURI === voiceUri);
    if (exact) return exact;
  }
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en-us'));
  return (
    english.find((voice) => voice.localService && /natural|online/i.test(voice.name)) ??
    english.find((voice) => voice.localService) ??
    english[0] ??
    null
  );
}

/** Web speechSynthesis with the installed Windows voices; interruptible (spec 4.2). */
export class Speaker {
  private active: SpeechSynthesisUtterance | null = null;
  private endHandler: (() => void) | null = null;

  get speaking(): boolean {
    return this.active !== null;
  }

  voices(): Promise<SpeechSynthesisVoice[]> {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length > 0) return Promise.resolve(now);
    return new Promise((resolve) => {
      const done = (): void => {
        synth.removeEventListener('voiceschanged', done);
        resolve(synth.getVoices());
      };
      synth.addEventListener('voiceschanged', done);
      window.setTimeout(done, 1500);
    });
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    const synth = window.speechSynthesis;
    this.cancel();
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length === 0) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice(await this.voices(), options.voiceUri);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = Math.min(2, Math.max(0.5, options.rate));
    utterance.onstart = () => options.onStart();
    utterance.onboundary = () => options.onBoundary();
    const finish = (): void => {
      if (this.active === utterance) this.active = null;
      this.endHandler = null;
      options.onEnd();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.active = utterance;
    this.endHandler = options.onEnd;
    synth.speak(utterance);
  }

  /** Stops speaking at once; the end callback of the interrupted utterance still fires once. */
  cancel(): void {
    if (!this.active) return;
    const utterance = this.active;
    const handler = this.endHandler;
    this.active = null;
    this.endHandler = null;
    utterance.onend = null;
    utterance.onerror = null;
    window.speechSynthesis.cancel();
    handler?.();
  }
}
