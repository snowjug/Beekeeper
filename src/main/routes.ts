import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { VOSK_WORKER_FILE } from '@shared/constants';
import { ROLE_PAGE, type WindowRole } from '@shared/windows';

export type Route =
  | {
      kind: 'file';
      path: string;
      role: WindowRole | null;
      contentName: string;
      /** The Vosk worker script gets its own CSP. */
      voskWorker: boolean;
    }
  | { kind: 'model'; path: string; contentName: string }
  | { kind: 'capture'; id: string; contentName: string }
  | { kind: 'notfound' };

const MODEL_FILE = /^[A-Za-z0-9._-]+\.tar\.gz$/;
const CAPTURE_FILE = /^([A-Za-z0-9_-]{8,64})\.(jpg|png)$/;

const PAGE_TO_ROLE = new Map<string, WindowRole>(
  (Object.entries(ROLE_PAGE) as Array<[WindowRole, string]>).map(([role, page]) => [page, role]),
);

export interface RouteRoots {
  rendererRoot: string;
  modelsDir: string;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Maps a beekeeper://app/<path> URL path to something servable. Pure and exhaustively unit tested:
 * this is the only place where URL input touches the file system.
 */
export function resolveRoute(pathname: string, roots: RouteRoots): Route {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: 'notfound' };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { kind: 'notfound' };

  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) return { kind: 'notfound' };

  const [first, second, ...rest] = segments;
  if (first === 'models' || first === 'capture') {
    // These two prefixes are strictly "<prefix>/<single whitelisted file name>".
    if (second === undefined || rest.length > 0) return { kind: 'notfound' };
    if (first === 'models') {
      return MODEL_FILE.test(second)
        ? { kind: 'model', path: join(roots.modelsDir, second), contentName: second }
        : { kind: 'notfound' };
    }
    const match = CAPTURE_FILE.exec(second);
    return match?.[1]
      ? { kind: 'capture', id: match[1], contentName: second }
      : { kind: 'notfound' };
  }

  const last = segments[segments.length - 1] ?? '';
  const relativeParts = last.includes('.') ? segments : [...segments, 'index.html'];
  const filePath = normalize(join(roots.rendererRoot, ...relativeParts));
  if (!inside(roots.rendererRoot, filePath)) return { kind: 'notfound' };

  const fileName = relativeParts[relativeParts.length - 1] ?? '';
  const role =
    fileName === 'index.html' ? (PAGE_TO_ROLE.get(relativeParts[0] ?? '') ?? null) : null;
  return {
    kind: 'file',
    path: filePath,
    role,
    contentName: relativeParts.join(sep),
    voskWorker: relativeParts.join('/') === VOSK_WORKER_FILE,
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
};

export function mimeTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const extension = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}
