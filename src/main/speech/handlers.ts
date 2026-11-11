import type { IpcRouter } from '../ipc/router';
import type { SpeechService } from './types';

/** Registers the speech IPC channels. */
export function registerSpeechHandlers(router: IpcRouter, speech: SpeechService): void {
  router.handle('speech:status', () => speech.status());
  router.handle('speech:ensurePack', ({ pack }) => speech.ensurePack(pack));
  router.handle('speech:cancelPack', ({ pack }) => speech.cancelPack(pack));
  router.handle('speech:removePack', ({ pack }) => speech.removePack(pack));
  router.handle('speech:preload', (options) => {
    // Warm-up must never block (or fail) the window that asked for it.
    void speech.preload({
      ...(options.tts === undefined ? {} : { tts: options.tts }),
      ...(options.stt === undefined ? {} : { stt: options.stt }),
    });
  });
  router.handle('speech:synthesize', (input) =>
    speech.synthesize({
      text: input.text,
      lang: input.lang,
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      ...(input.speed === undefined ? {} : { speed: input.speed }),
    }),
  );
  router.handle('speech:transcribe', (input) =>
    speech.transcribe({
      samples: input.samples,
      ...(input.language === undefined ? {} : { language: input.language }),
    }),
  );
}
