import type { OcrService } from '../capture/ocr';
import type { CaptureStore } from '../capture/store';
import type { AppContext } from '../context';
import type { IpcRouter } from '../ipc/router';
import type { SpeechService } from '../speech/types';

/** What every feature module (speech, Capture Studio, dictation) needs from the application. */
export interface BaseFeatureDeps {
  ctx: AppContext;
  router: IpcRouter;
  /** In-memory blobs served as beekeeper://app/capture/<id>.png. */
  captures: CaptureStore;
  ocr: OcrService;
  /** fetch through Electron's network stack (proxy, certificates). */
  netFetch: typeof fetch;
  /** Screenshot of the display under the cursor without Beekeeper's own overlays. */
  captureScreen: () => Promise<{ png: Buffer; width: number; height: number }>;
}

/** Dependencies of the features that are created after the speech service. */
export interface FeatureDeps extends BaseFeatureDeps {
  speech: SpeechService;
}
