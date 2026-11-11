import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import type { Logger } from '@shared/logger';
import { APP_SCHEME } from '@shared/windows';
import type { BinaryStore } from './capture/store';
import { ASSET_CSP, buildCsp, VOSK_WORKER_CSP } from './csp';
import { mimeTypeFor, resolveRoute, type RouteRoots } from './routes';

export interface AppProtocolDeps extends RouteRoots {
  dev: boolean;
  captures: BinaryStore;
  logger: Logger;
}

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Serves the bundled renderer pages, downloaded speech models and Circle-to-Search captures from
 * `beekeeper://app/...` with a strict CSP on every response. Nothing outside those roots is reachable.
 */
export function registerAppProtocol(deps: AppProtocolDeps): void {
  const { dev, captures, logger } = deps;
  const roots: RouteRoots = { rendererRoot: deps.rendererRoot, modelsDir: deps.modelsDir };

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return plain(404, 'Not found');

    const route = resolveRoute(url.pathname, roots);
    const baseHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    };
    // In dev the pages live on http://localhost, so models/captures are cross-origin.
    if (dev) baseHeaders['Access-Control-Allow-Origin'] = '*';

    try {
      switch (route.kind) {
        case 'notfound':
          return plain(404, 'Not found');
        case 'capture': {
          const entry = captures.get(route.id);
          if (!entry) return plain(404, 'Capture expired');
          return new Response(new Uint8Array(entry.data), {
            headers: { ...baseHeaders, 'Content-Type': entry.mime },
          });
        }
        case 'model':
        case 'file': {
          const upstream = await net.fetch(pathToFileURL(route.path).toString());
          if (!upstream.ok) return plain(404, 'Not found');
          const headers: Record<string, string> = {
            ...baseHeaders,
            'Content-Type': mimeTypeFor(route.contentName),
          };
          if (route.kind === 'file') {
            headers['Content-Security-Policy'] = route.role
              ? buildCsp({ role: route.role, dev })
              : route.voskWorker
                ? VOSK_WORKER_CSP
                : ASSET_CSP;
          }
          return new Response(upstream.body, { status: 200, headers });
        }
      }
    } catch (error) {
      logger.warn('app protocol request failed', url.pathname, error);
      return plain(404, 'Not found');
    }
  });
}
