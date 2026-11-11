import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';

type PermissionRequest = (
  contents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
  details: { requestingUrl: string; mediaTypes?: string[] },
) => void;
type PermissionCheck = (contents: unknown, permission: string, origin: string) => boolean;
type HeadersHandler = (
  details: {
    url: string;
    resourceType: string;
    responseHeaders?: Record<string, string[]>;
  },
  callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
) => void;
type OpenHandler = (details: { url: string }) => { action: 'deny' };

const electron = vi.hoisted(() => {
  const state = {
    request: undefined as unknown,
    check: undefined as unknown,
    headers: undefined as unknown,
    created: undefined as unknown,
  };
  return {
    state,
    openExternal: vi.fn((_url: string) => Promise.resolve()),
    module: {
      app: {
        on: (_event: string, listener: unknown) => {
          state.created = listener;
        },
      },
      shell: {
        openExternal: (url: string): Promise<void> => electron.openExternal(url),
      },
      session: {
        defaultSession: {
          setPermissionRequestHandler: (handler: unknown) => {
            state.request = handler;
          },
          setPermissionCheckHandler: (handler: unknown) => {
            state.check = handler;
          },
          webRequest: {
            onHeadersReceived: (handler: unknown) => {
              state.headers = handler;
            },
          },
        },
      },
    },
  };
});

vi.mock('electron', () => electron.module);

const { installSecurity, isTrustedUrl } = await import('@main/security');

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const DEV_ORIGIN = 'http://localhost:5173';

describe('isTrustedUrl', () => {
  it('trusts only the app protocol and the dev server origin', () => {
    expect(isTrustedUrl('beekeeper://app/assistant/index.html', null)).toBe(true);
    expect(isTrustedUrl('beekeeper://app.evil.example/assistant', null)).toBe(false);
    expect(isTrustedUrl('beekeeper://other/assistant', null)).toBe(false);
    expect(isTrustedUrl('https://example.com/', null)).toBe(false);
    expect(isTrustedUrl('file:///C:/secret.txt', null)).toBe(false);
    expect(isTrustedUrl(`${DEV_ORIGIN}/assistant/index.html`, DEV_ORIGIN)).toBe(true);
    expect(isTrustedUrl(`${DEV_ORIGIN}/assistant/index.html`, null)).toBe(false);
    expect(isTrustedUrl('http://localhost:51730/assistant', DEV_ORIGIN)).toBe(false);
  });
});

describe('installSecurity', () => {
  let request: PermissionRequest;
  let check: PermissionCheck;

  function install(dev = false): void {
    electron.state.request = undefined;
    electron.state.check = undefined;
    electron.state.headers = undefined;
    electron.state.created = undefined;
    installSecurity({ dev, devOrigin: dev ? DEV_ORIGIN : null, logger });
    request = electron.state.request as PermissionRequest;
    check = electron.state.check as PermissionCheck;
  }

  function ask(permission: string, url: string, mediaTypes?: string[]): boolean {
    let answer: boolean | undefined;
    request(
      null,
      permission,
      (allowed) => {
        answer = allowed;
      },
      { requestingUrl: url, ...(mediaTypes ? { mediaTypes } : {}) },
    );
    if (answer === undefined) throw new Error('The permission handler did not answer');
    return answer;
  }

  beforeEach(() => {
    electron.openExternal.mockClear();
    install();
  });

  it('allows the microphone, and only the microphone, for the app pages', () => {
    const page = 'beekeeper://app/assistant/index.html';
    expect(ask('media', page, ['audio'])).toBe(true);
    expect(ask('media', page, ['video'])).toBe(false);
    expect(ask('media', page, ['audio', 'video'])).toBe(false);
    expect(ask('media', page, [])).toBe(false);
    expect(ask('media', 'https://example.com/', ['audio'])).toBe(false);
  });

  it('denies every other permission, whoever asks', () => {
    for (const permission of ['geolocation', 'notifications', 'midi', 'clipboard-read', 'hid']) {
      expect(ask(permission, 'beekeeper://app/settings/index.html')).toBe(false);
    }
    expect(ask('clipboard-sanitized-write', 'beekeeper://app/assistant/index.html')).toBe(true);
    expect(ask('clipboard-sanitized-write', 'https://example.com/')).toBe(false);
  });

  it('answers permission checks from the origin only', () => {
    expect(check(null, 'media', 'beekeeper://app')).toBe(true);
    expect(check(null, 'media', 'beekeeper://app/')).toBe(true);
    expect(check(null, 'media', 'https://example.com')).toBe(false);
    expect(check(null, 'geolocation', 'beekeeper://app')).toBe(false);
  });

  it('does not touch response headers outside development', () => {
    expect(electron.state.headers).toBeUndefined();
  });

  it('adds the per-window CSP to the dev server pages (main frame only)', () => {
    install(true);
    const headers = electron.state.headers as HeadersHandler;
    let response: { responseHeaders?: Record<string, string[]> } | undefined;
    headers(
      {
        url: `${DEV_ORIGIN}/settings/index.html`,
        resourceType: 'mainFrame',
        responseHeaders: { 'X-Test': ['1'] },
      },
      (value) => {
        response = value;
      },
    );
    expect(response?.responseHeaders?.['X-Test']).toEqual(['1']);
    expect(response?.responseHeaders?.['Content-Security-Policy']?.[0]).toContain(
      "default-src 'none'",
    );

    for (const details of [
      { url: `${DEV_ORIGIN}/assets/app.js`, resourceType: 'script' },
      { url: `${DEV_ORIGIN}/unknown-page/index.html`, resourceType: 'mainFrame' },
      { url: 'https://example.com/', resourceType: 'mainFrame' },
    ]) {
      response = undefined;
      headers(details, (value) => {
        response = value;
      });
      expect(response).toEqual({});
    }
  });

  describe('window contents', () => {
    interface FakeContents {
      handlers: Map<string, (event: { preventDefault: () => void }) => void>;
      open: OpenHandler | undefined;
      on: (name: string, handler: (event: { preventDefault: () => void }) => void) => void;
      setWindowOpenHandler: (handler: OpenHandler) => void;
    }

    function created(): FakeContents {
      const contents: FakeContents = {
        handlers: new Map(),
        open: undefined,
        on: (name, handler) => {
          contents.handlers.set(name, handler);
        },
        setWindowOpenHandler: (handler) => {
          contents.open = handler;
        },
      };
      (electron.state.created as (event: unknown, contents: FakeContents) => void)(null, contents);
      return contents;
    }

    it('never lets a window navigate, redirect or attach a webview', () => {
      const contents = created();
      for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
        const preventDefault = vi.fn();
        contents.handlers.get(name)?.({ preventDefault });
        expect(preventDefault, name).toHaveBeenCalledOnce();
      }
    });

    it('opens safe links in the browser and refuses everything else', () => {
      const contents = created();
      expect(contents.open?.({ url: 'https://example.com/a?b=1' })).toEqual({ action: 'deny' });
      expect(electron.openExternal).toHaveBeenCalledWith('https://example.com/a?b=1');

      for (const url of [
        // eslint-disable-next-line no-script-url -- the test proves that such URLs are refused
        'javascript:alert(1)',
        'file:///C:/Windows/System32/cmd.exe',
        'ms-msdt:x',
      ]) {
        electron.openExternal.mockClear();
        expect(contents.open?.({ url })).toEqual({ action: 'deny' });
        expect(electron.openExternal).not.toHaveBeenCalled();
      }
    });
  });
});
