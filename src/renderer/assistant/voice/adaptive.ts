import type { Bridge } from '@shared/ipc/bridge';
import type { Settings } from '@shared/settings';
import { NaturalSpeaker } from './natural';
import { Speaker, type SpeakOptions } from './tts';

export interface AdaptiveSpeakOptions extends SpeakOptions {
  /** Voice engine from settings: natural / ElevenLabs are tried first, then the Windows voice. */
  engine: Settings['voice']['ttsEngine'];
}

/** What a window needs to read text aloud (the Circle sheet, Capture Studio). */
export interface TextSpeaker {
  speak(text: string, options: AdaptiveSpeakOptions): Promise<void>;
  cancel(): void;
}

/**
 * Reads text with the natural voice when it is selected (Hindi and English parts each in their own
 * language) and falls back to the installed Windows voice when the natural voice is not available.
 */
export class AdaptiveSpeaker implements TextSpeaker {
  private readonly natural: NaturalSpeaker;

  constructor(
    bridge: Pick<Bridge<'circle'>, 'invoke'>,
    private readonly system: Speaker = new Speaker(),
  ) {
    this.natural = new NaturalSpeaker(bridge);
  }

  async speak(text: string, options: AdaptiveSpeakOptions): Promise<void> {
    this.cancel();
    if (options.engine === 'natural' || options.engine === 'elevenlabs') {
      try {
        await this.natural.speak(text, options);
        return;
      } catch {
        // The natural voice is not installed or failed: the Windows voice below takes over.
      }
    }
    await this.system.speak(text, options);
  }

  cancel(): void {
    this.natural.cancel();
    this.system.cancel();
  }
}
