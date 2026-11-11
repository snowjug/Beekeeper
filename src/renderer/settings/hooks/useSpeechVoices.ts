import { useEffect, useState } from 'react';

export interface SpeechVoices {
  voices: readonly SpeechSynthesisVoice[];
  /** Voices load asynchronously; true until the first list (or a short timeout) arrives. */
  loading: boolean;
  supported: boolean;
}

const GIVE_UP_MS = 2000;

function canSpeak(): boolean {
  return typeof window.speechSynthesis?.getVoices === 'function';
}

/** Installed text-to-speech voices, kept current through the `voiceschanged` event. */
export function useSpeechVoices(): SpeechVoices {
  const supported = canSpeak();
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>(() =>
    supported ? window.speechSynthesis.getVoices() : [],
  );
  const [loading, setLoading] = useState(supported && voices.length === 0);

  useEffect(() => {
    if (!supported) return undefined;
    const synth = window.speechSynthesis;
    const read = (): void => {
      const list = synth.getVoices();
      setVoices(list);
      if (list.length > 0) setLoading(false);
    };
    read();
    synth.addEventListener('voiceschanged', read);
    const giveUp = window.setTimeout(() => setLoading(false), GIVE_UP_MS);
    return () => {
      synth.removeEventListener('voiceschanged', read);
      window.clearTimeout(giveUp);
    };
  }, [supported]);

  return { voices, loading, supported };
}
