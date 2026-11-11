import { join } from 'node:path';
import { unpackAsarPath } from '../capture/ocr-assets';

export const SPEECH_WORKER_FILE = 'speechWorker.js';

/**
 * Path of the worker script. A worker thread is started from a real file, so in the packaged app
 * the script (and the native speech runtime next to it) lives in app.asar.unpacked.
 */
export function resolveSpeechWorker(rendererRoot: string, packaged: boolean): string {
  const file = join(rendererRoot, '..', 'main', SPEECH_WORKER_FILE);
  return packaged ? unpackAsarPath(file) : file;
}

/** Glob patterns for electron-builder's `asarUnpack`. */
export const SPEECH_ASAR_UNPACK: readonly string[] = [
  `out/main/${SPEECH_WORKER_FILE}`,
  'node_modules/sherpa-onnx-node/**',
  'node_modules/sherpa-onnx-win-x64/**',
];
