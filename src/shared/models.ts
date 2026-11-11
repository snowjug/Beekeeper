import manifestJson from './model-manifest.json';

/** Where the offline speech model is in its lifecycle. */
export type ModelState = 'missing' | 'partial' | 'downloading' | 'ready' | 'error';

export interface ModelStatus {
  state: ModelState;
  receivedBytes: number;
  totalBytes: number;
  /** Friendly explanation; set when the state is 'error'. */
  message?: string;
}

export type ModelProgressPhase = 'checking' | 'downloading' | 'verifying' | 'ready' | 'error';

export interface ModelProgress {
  phase: ModelProgressPhase;
  receivedBytes: number;
  totalBytes: number;
  /** Smoothed transfer rate; 0 whenever nothing is being transferred. */
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** 1-based attempt on the current download source. */
  attempt: number;
  maxAttempts: number;
  /** Friendly status text, e.g. why the download is being retried. */
  message?: string;
}

export interface ModelManifest {
  id: string;
  displayName: string;
  description: string;
  /** Name of the file inside the models folder; also the last segment of the served URL path. */
  fileName: string;
  /** Top-level folder inside the .tar.gz archive. */
  archiveRoot: string;
  /** Download sources, primary first. Every source must serve byte-identical content. */
  urls: readonly string[];
  /** Lower-case hex SHA-256 of the archive. */
  sha256: string;
  sizeBytes: number;
  license: string;
}

export const modelManifest: ModelManifest = manifestJson;

const MODELS_URL_PREFIX = '/models/';
const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.tar\.gz$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Same-origin path under which the app protocol serves the model archive to the renderer. */
export function getModelUrlPath(manifest: ModelManifest = modelManifest): string {
  return `${MODELS_URL_PREFIX}${encodeURIComponent(manifest.fileName)}`;
}

function isAcceptableSource(source: string): boolean {
  try {
    const url = new URL(source);
    return (
      url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
}

/** Throws a descriptive error when the manifest cannot be used safely. */
export function assertValidManifest(manifest: ModelManifest): void {
  const problems: string[] = [];
  if (!manifest.id) problems.push('id is empty');
  if (!manifest.displayName) problems.push('displayName is empty');
  if (!manifest.license) problems.push('license is empty');
  if (!manifest.archiveRoot) problems.push('archiveRoot is empty');
  if (!FILE_NAME_PATTERN.test(manifest.fileName)) {
    problems.push('fileName must be a plain file name ending in .tar.gz');
  }
  if (!SHA256_PATTERN.test(manifest.sha256)) {
    problems.push('sha256 must be 64 lower-case hex digits');
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0) {
    problems.push('sizeBytes must be a positive integer');
  }
  if (manifest.urls.length === 0) problems.push('urls is empty');
  for (const source of manifest.urls) {
    if (!isAcceptableSource(source)) problems.push(`url is not https: ${source}`);
  }
  if (problems.length > 0) throw new Error(`Invalid model manifest: ${problems.join('; ')}`);
}
