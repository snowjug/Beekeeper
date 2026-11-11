/**
 * Locates the offline OCR assets (tesseract worker script, tesseract core and the English
 * traineddata) for development and for the packaged app.
 *
 * Packaging contract (electron-builder):
 *  - `extraResources`: `node_modules/@tesseract.js-data/eng/4.0.0_best_int` -> `tessdata`
 *  - `asarUnpack`: the worker script, the WebAssembly cores and the few modules the worker
 *    script requires, because a worker thread is started from a real file and resolves its
 *    `require()` calls next to it (see OCR_ASAR_UNPACK).
 */
import { dirname, join } from 'node:path';

export interface OcrAssetOptions {
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `process.resourcesPath` (only used when packaged). */
  resourcesPath: string;
  /** Directory that contains `node_modules` (development, or the fallback when resolving fails). */
  projectRoot: string;
  /** `require.resolve`: absolute path of a module file; throws when it cannot be found. */
  resolveModule: (id: string) => string;
}

export interface OcrAssets {
  /** Directory that contains `eng.traineddata.gz`. */
  langPath: string;
  /** Script that tesseract.js runs inside the worker thread. */
  workerPath: string;
  /** Directory of the tesseract.js-core files. */
  corePath: string;
}

/**
 * Glob patterns for electron-builder's `asarUnpack`: the worker script of tesseract.js, the
 * LSTM-only WebAssembly cores and the modules the worker script requires (verified in a real
 * packaged-style Electron run: leaving any of them out stops OCR from starting).
 */
export const OCR_ASAR_UNPACK: readonly string[] = [
  'node_modules/tesseract.js/src/**',
  'node_modules/tesseract.js-core/tesseract-core*-lstm.js',
  'node_modules/tesseract.js-core/tesseract-core*-lstm.wasm',
  'node_modules/regenerator-runtime/**',
  'node_modules/is-url/**',
  'node_modules/bmp-js/**',
  'node_modules/wasm-feature-detect/**',
];

export const WORKER_SCRIPT_MODULE = 'tesseract.js/src/worker-script/node/index.js';
const CORE_PACKAGE_JSON = 'tesseract.js-core/package.json';
const LANG_PACKAGE_JSON = '@tesseract.js-data/eng/package.json';
const LANG_DATA_DIRECTORY = '4.0.0_best_int';
const PACKAGED_LANG_DIRECTORY = 'tessdata';

const ASAR_SEGMENT = /([\\/])app\.asar(?=[\\/]|$)/i;

/** Maps a path inside `app.asar` to the same path inside `app.asar.unpacked` (other paths are unchanged). */
export function unpackAsarPath(path: string): string {
  return path.replace(ASAR_SEGMENT, '$1app.asar.unpacked');
}

function tryResolve(resolveModule: (id: string) => string, id: string): string | null {
  try {
    return resolveModule(id);
  } catch {
    return null;
  }
}

export function resolveOcrAssets(options: OcrAssetOptions): OcrAssets {
  const { isPackaged, resourcesPath, projectRoot, resolveModule } = options;
  const modules = join(projectRoot, 'node_modules');
  const unpackedModules = join(resourcesPath, 'app.asar.unpacked', 'node_modules');
  const base = isPackaged ? unpackedModules : modules;
  const place = (path: string): string => (isPackaged ? unpackAsarPath(path) : path);

  const worker = tryResolve(resolveModule, WORKER_SCRIPT_MODULE);
  const core = tryResolve(resolveModule, CORE_PACKAGE_JSON);
  const lang = tryResolve(resolveModule, LANG_PACKAGE_JSON);

  return {
    langPath: isPackaged
      ? join(resourcesPath, PACKAGED_LANG_DIRECTORY)
      : join(
          lang ? dirname(lang) : join(modules, '@tesseract.js-data', 'eng'),
          LANG_DATA_DIRECTORY,
        ),
    workerPath: worker
      ? place(worker)
      : join(base, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    corePath: core ? place(dirname(core)) : join(base, 'tesseract.js-core'),
  };
}
