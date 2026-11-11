import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechPlayer } from '@renderer/lib/voice/player';
import type { NaturalVoiceId } from '@shared/speech/voices';
import { useController } from '../context';
import { friendlyError } from '../lib/errors';
import { SAMPLE_TEXT, type SampleLanguage } from '../lib/samples';

const SAMPLE_FAILED =
  'Could not play the sample. Make sure the natural voice has finished downloading, then try again.';

export type SamplePhase = 'idle' | 'preparing' | 'playing';

export interface VoiceSample {
  phase: SamplePhase;
  /** Voice of the sample that is being prepared or played; null when idle. */
  voice: NaturalVoiceId | null;
  /** Friendly reason the last sample could not be played. */
  error: string | null;
  play: (voice: NaturalVoiceId, language: SampleLanguage, speed: number) => void;
  stop: () => void;
}

interface SampleState {
  phase: SamplePhase;
  voice: NaturalVoiceId | null;
  error: string | null;
}

const IDLE: SampleState = { phase: 'idle', voice: null, error: null };

/**
 * Plays a sentence with one of the natural voices: the main process renders it (`speech:synthesize`)
 * and the player speaks it. Pressing another voice replaces the sample; leaving the page stops it.
 */
export function useVoiceSample(): VoiceSample {
  const controller = useController();
  const [state, setState] = useState<SampleState>(IDLE);
  const player = useRef<SpeechPlayer | null>(null);
  const run = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current += 1;
      const current = player.current;
      player.current = null;
      if (current) void current.dispose();
    };
  }, []);

  const stop = useCallback((): void => {
    run.current += 1;
    player.current?.stop();
    setState(IDLE);
  }, []);

  const play = useCallback(
    (voice: NaturalVoiceId, language: SampleLanguage, speed: number): void => {
      run.current += 1;
      const mine = run.current;
      player.current?.stop();
      setState({ phase: 'preparing', voice, error: null });
      void (async () => {
        try {
          const result = await controller.bridge.invoke('speech:synthesize', {
            text: SAMPLE_TEXT[language],
            lang: language,
            voice,
            speed,
          });
          if (!alive.current || run.current !== mine) return;
          setState({ phase: 'playing', voice, error: null });
          player.current ??= new SpeechPlayer();
          await player.current.play(result);
        } catch (error) {
          if (!alive.current || run.current !== mine) return;
          controller.report('speech:synthesize', error);
          setState({ phase: 'idle', voice: null, error: friendlyError(error, SAMPLE_FAILED) });
          return;
        }
        if (alive.current && run.current === mine) setState(IDLE);
      })();
    },
    [controller],
  );

  return { phase: state.phase, voice: state.voice, error: state.error, play, stop };
}
