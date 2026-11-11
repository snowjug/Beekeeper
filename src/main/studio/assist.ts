import type { Size } from '@shared/geometry';
import type { Logger } from '@shared/logger';
import type { StudioAssistResult, StudioAssistTask } from '@shared/ipc/types';
import type { OcrService } from '../capture/ocr';
import { detectSensitiveRegions } from './sensitive';

export interface Assist {
  /** Reads the image and answers the Photo assist task; a newer request cancels the previous one. */
  run(task: StudioAssistTask, png: Buffer, size: Size): Promise<StudioAssistResult>;
  cancel(): void;
}

export interface AssistDeps {
  ocr: Pick<OcrService, 'warmUp' | 'recognize'>;
  logger: Logger;
}

const MESSAGES: Record<string, string> = {
  'assets-missing': 'Text recognition is not available in this build.',
  timeout: 'Reading the screenshot took too long. Try again.',
  aborted: 'Cancelled.',
  superseded: 'Cancelled.',
  'invalid-image': 'This image cannot be read.',
};

function friendly(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    (typeof code === 'string' ? MESSAGES[code] : undefined) ??
    'The text could not be read. Try again.'
  );
}

/** Photo assist: the offline OCR engine finds text, and the places that hold personal data. */
export function createAssist(deps: AssistDeps): Assist {
  let pending: AbortController | null = null;

  return {
    async run(task, png, size) {
      pending?.abort();
      const abort = new AbortController();
      pending = abort;
      try {
        // The engine sleeps when idle: wake it first so the first request does not pay for it twice.
        await deps.ocr.warmUp().catch(() => undefined);
        const result = await deps.ocr.recognize(png, {
          signal: abort.signal,
          supersedePending: true,
        });
        if (task === 'text') {
          const text = result.text.trim();
          return {
            ok: true,
            task,
            text,
            ...(text === '' ? { message: 'No text found in this screenshot.' } : {}),
          };
        }
        const regions = detectSensitiveRegions(result.lines, { bounds: size });
        return {
          ok: true,
          task,
          regions,
          ...(regions.length === 0 ? { message: 'No sensitive info found.' } : {}),
        };
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code !== 'aborted' && code !== 'superseded') {
          deps.logger.warn(
            `Photo assist (${task}) failed`,
            typeof code === 'string' ? code : 'unknown',
          );
        }
        return { ok: false, task, message: friendly(error) };
      } finally {
        if (pending === abort) pending = null;
      }
    },
    cancel() {
      pending?.abort();
      pending = null;
    },
  };
}
