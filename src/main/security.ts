import { app, session, shell, type Session, type WebContents } from 'electron';
import type { Logger } from '@shared/logger';
import { parseSafeExternalUrl } from '@shared/url';
import { APP_ORIGIN, ROLE_PAGE, WINDOW_ROLES, type WindowRole } from '@shared/windows';
import { buildCsp } from './csp';

export interface SecurityOptions {
  dev: boolean;
  /** Vite dev server origin (http://localhost:5173) when running `electron-vite dev`. */
  devOrigin: string | null;
  logger: Logger;
}

export function isTrustedUrl(url: string, devOrigin: string | null): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return devOrigin !== null && url.startsWith(`${devOrigin}/`);
}

function roleFromDevUrl(url: string, devOrigin: string): WindowRole | null {
  const page = url.slice(devOrigin.length).split('/').filter(Boolean)[0];
  return WINDOW_ROLES.find((role) => ROLE_PAGE[role] === page) ?? null;
}

function hardenSession(target: Session, options: SecurityOptions): void {
  const { devOrigin, dev } = options;

  // Microphone only, only for our own pages (spec 6: mic active only while listening / wake word).
  target.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const trusted = isTrustedUrl(details.requestingUrl, devOrigin);
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      callback(trusted && types.length > 0 && types.every((type) => type === 'audio'));
      return;
    }
    callback(trusted && permission === 'clipboard-sanitized-write');
  });
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const trusted = isTrustedUrl(`${requestingOrigin.replace(/\/$/, '')}/`, devOrigin);
    return trusted && (permission === 'media' || permission === 'clipboard-sanitized-write');
  });

  if (dev && devOrigin) {
    // Pages served by the Vite dev server do not pass through our protocol handler.
    target.webRequest.onHeadersReceived((details, callback) => {
      const role = details.url.startsWith(devOrigin)
        ? roleFromDevUrl(details.url, devOrigin)
        : null;
      if (!role || details.resourceType !== 'mainFrame') {
        callback({});
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [buildCsp({ role, dev: true })],
        },
      });
    });
  }
}

function lockDownContents(contents: WebContents, options: SecurityOptions): void {
  // Windows never navigate after their page has loaded; links open in the default browser instead.
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const safe = parseSafeExternalUrl(url);
    if (safe) {
      void shell.openExternal(safe.href).catch((error: unknown) => {
        options.logger.warn('openExternal failed', error);
      });
    } else {
      options.logger.warn('Blocked window.open to an unsafe URL');
    }
    return { action: 'deny' };
  });
}

/** Session permissions, CSP in dev and navigation / window.open blocking for every window. */
export function installSecurity(options: SecurityOptions): void {
  hardenSession(session.defaultSession, options);
  app.on('web-contents-created', (_event, contents) => lockDownContents(contents, options));
}
