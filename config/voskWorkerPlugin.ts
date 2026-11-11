import type { Plugin } from 'vite';
import { VOSK_WORKER_FILE } from '../src/shared/constants';

const FACTORY = /var WorkerFactory = createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'[^)]*\);/;

/**
 * vosk-browser embeds its WebAssembly worker as a base64 string and starts it from a blob: URL.
 * A blob worker inherits the page's Content-Security-Policy, and the Emscripten glue inside it needs
 * `new Function`, which the strict document CSP rightly forbids. This plugin extracts the worker
 * into a real file (`vosk/vosk-worker.js`) that the app protocol serves with a dedicated, worker-only
 * CSP; the pages themselves keep `script-src 'self' 'wasm-unsafe-eval'` without `unsafe-eval`.
 */
export function voskWorkerPlugin(): Plugin {
  return {
    name: 'beekeeper-vosk-worker',
    apply: 'build',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/vosk-browser/dist/vosk.js')) return null;
      const match = FACTORY.exec(code);
      const payload = match?.[1];
      if (!match || !payload) {
        throw new Error('vosk-browser changed: the embedded worker could not be located.');
      }
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      // The first line is a loader banner that vosk-browser strips before starting the worker.
      const worker = decoded.slice(decoded.indexOf('\n', 10) + 1);
      this.emitFile({ type: 'asset', fileName: VOSK_WORKER_FILE, source: worker });
      const replacement = `var WorkerFactory = function WorkerFactory(options) { return new Worker(new URL('/${VOSK_WORKER_FILE}', self.location.href), options); };`;
      return { code: code.replace(match[0], replacement), map: null };
    },
  };
}
