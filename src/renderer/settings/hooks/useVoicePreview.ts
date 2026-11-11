import { useCallback, useEffect, useRef, useState } from 'react';
import { Speaker } from '@renderer/assistant/voice/tts';

const PREVIEW_SENTENCE = "Hi, I'm Beekeeper. This is how I sound.";

export interface VoicePreview {
  speaking: boolean;
  /** Speaks the sample sentence with the given system voice URI ('' = automatic) and rate. */
  play: (voiceUri: string, rate: number) => void;
  stop: () => void;
}

/** Previews a system voice with the assistant's own text-to-speech wrapper; speech ends on unmount. */
export function useVoicePreview(): VoicePreview {
  const [speaking, setSpeaking] = useState(false);
  const speaker = useRef<Speaker | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      speaker.current?.cancel();
    };
  }, []);

  const play = useCallback((voiceUri: string, rate: number): void => {
    if (!speaker.current) speaker.current = new Speaker();
    const setState = (value: boolean): void => {
      if (alive.current) setSpeaking(value);
    };
    void speaker.current.speak(PREVIEW_SENTENCE, {
      voiceUri,
      rate,
      onStart: () => setState(true),
      onBoundary: () => undefined,
      onEnd: () => setState(false),
    });
  }, []);

  const stop = useCallback((): void => {
    speaker.current?.cancel();
  }, []);

  return { speaking, play, stop };
}
