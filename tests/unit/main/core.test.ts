import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCsp, ASSET_CSP } from '@main/csp';
import { loadDotEnvFiles, parseDotEnv, readAzureEnv } from '@main/env';
import { listLogFiles, rotateLogFile } from '@main/logRotation';
import { mimeTypeFor, resolveRoute } from '@main/routes';
import { parseTaskbarTheme } from '@main/taskbarTheme';
import { backdropFor, parseWindowsBuild, supportsBackdrop } from '@main/windows/material';
import {
  computeAssistantBounds,
  computeCenteredBounds,
  pickDisplay,
  type DisplayLike,
} from '@main/windows/placement';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beekeeper-main-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildCsp', () => {
  it('never allows eval and keeps the default locked down', () => {
    for (const role of [
      'assistant',
      'circle',
      'edgeGlow',
      'settings',
      'onboarding',
      'worker',
    ] as const) {
      const csp = buildCsp({ role, dev: false });
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
    expect(ASSET_CSP).not.toContain("'unsafe-eval'");
    expect(ASSET_CSP).not.toContain("'unsafe-inline'");
  });

  it('only lets the assistant reach Azure Speech endpoints', () => {
    expect(buildCsp({ role: 'assistant', dev: false })).toContain('speech.microsoft.com');
    expect(buildCsp({ role: 'settings', dev: false })).not.toContain('microsoft.com');
    expect(buildCsp({ role: 'circle', dev: false })).toMatch(/connect-src 'self' blob:(;|$)/);
  });

  it('relaxes scripts and websockets for the dev server only', () => {
    expect(buildCsp({ role: 'assistant', dev: true })).toContain("'unsafe-inline'");
    expect(buildCsp({ role: 'assistant', dev: true })).toContain('ws://localhost:*');
    expect(buildCsp({ role: 'assistant', dev: false })).not.toContain('localhost');
    expect(buildCsp({ role: 'assistant', dev: false })).not.toMatch(
      /script-src[^;]*'unsafe-inline'/,
    );
  });
});

describe('resolveRoute', () => {
  const roots = { rendererRoot: 'C:\\app\\renderer', modelsDir: 'C:\\data\\models' };

  it('serves renderer pages and tags html with the window role', () => {
    const page = resolveRoute('/assistant/index.html', roots);
    expect(page).toMatchObject({ kind: 'file', role: 'assistant' });
    expect(resolveRoute('/edge-glow/', roots)).toMatchObject({ kind: 'file', role: 'edgeGlow' });
    expect(resolveRoute('/settings', roots)).toMatchObject({ kind: 'file', role: 'settings' });
    expect(resolveRoute('/assets/app-abc.js', roots)).toMatchObject({ kind: 'file', role: null });
  });

  it('serves only whitelisted model archives and captures', () => {
    expect(resolveRoute('/models/vosk-model-small-en-us-0.15.tar.gz', roots)).toMatchObject({
      kind: 'model',
      path: join('C:\\data\\models', 'vosk-model-small-en-us-0.15.tar.gz'),
    });
    expect(resolveRoute('/models/evil.exe', roots).kind).toBe('notfound');
    expect(resolveRoute('/models/a/b.tar.gz', roots).kind).toBe('notfound');
    expect(resolveRoute('/capture/abcdef123456.jpg', roots)).toMatchObject({
      kind: 'capture',
      id: 'abcdef123456',
    });
    expect(resolveRoute('/capture/short.jpg', roots).kind).toBe('notfound');
    expect(resolveRoute('/capture/abcdef123456.exe', roots).kind).toBe('notfound');
  });

  it.each([
    '/../secret.txt',
    '/assistant/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/assistant/..%2f..%2fsecret',
    '/a\\b',
    '/bad%00name',
    '/%E0%A4%A',
  ])('refuses path traversal attempt %s', (pathname) => {
    expect(resolveRoute(pathname, roots).kind).toBe('notfound');
  });

  it('maps extensions to content types', () => {
    expect(mimeTypeFor('a.html')).toContain('text/html');
    expect(mimeTypeFor('a.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('model.tar.gz')).toBe('application/gzip');
    expect(mimeTypeFor('x.PNG')).toBe('image/png');
    expect(mimeTypeFor('mystery')).toBe('application/octet-stream');
  });
});

describe('window placement', () => {
  const primary: DisplayLike = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    workArea: { x: 0, y: 0, width: 1280, height: 680 },
    scaleFactor: 1.5,
  };
  const left: DisplayLike = {
    id: 2,
    bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
    workArea: { x: -1920, y: -200, width: 1920, height: 1040 },
    scaleFactor: 1,
  };

  it('picks the display under the cursor, else the nearest one', () => {
    expect(pickDisplay([primary, left], { x: 100, y: 100 }).id).toBe(1);
    expect(pickDisplay([primary, left], { x: -500, y: 300 }).id).toBe(2);
    expect(pickDisplay([primary, left], { x: 1290, y: 100 }).id).toBe(1);
    expect(pickDisplay([primary, left], { x: -2000, y: -300 }).id).toBe(2);
    expect(() => pickDisplay([], { x: 0, y: 0 })).toThrow();
  });

  it('centres the bar horizontally above the taskbar on any monitor', () => {
    const bounds = computeAssistantBounds(primary);
    expect(bounds.width).toBe(720 + 72);
    expect(bounds.x).toBe(Math.round((1280 - bounds.width) / 2));
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
    expect(bounds.height).toBeLessThanOrEqual(680 - 20);

    const second = computeAssistantBounds(left);
    expect(second.x).toBe(Math.round(-1920 + (1920 - second.width) / 2));
    expect(second.y + second.height).toBeLessThanOrEqual(-200 + 1080);
    expect(second.y).toBeGreaterThanOrEqual(-200);
  });

  it('centres framed windows and never exceeds the work area', () => {
    expect(computeCenteredBounds(primary, { width: 1000, height: 600 })).toEqual({
      x: 140,
      y: 40,
      width: 1000,
      height: 600,
    });
    const tight = computeCenteredBounds(primary, { width: 4000, height: 4000 });
    expect(tight.width).toBe(1280);
    expect(tight.height).toBe(680);
  });
});

describe('windows backdrop', () => {
  it('parses the Windows build from os.release()', () => {
    expect(parseWindowsBuild('10.0.26300')).toBe(26300);
    expect(parseWindowsBuild('10.0.19045')).toBe(19045);
    expect(parseWindowsBuild('6.1.7601')).toBe(0);
    expect(parseWindowsBuild('5.15.0-generic')).toBe(0);
  });

  it('uses Mica for framed windows on Windows 11 22H2+ and glass elsewhere', () => {
    expect(supportsBackdrop(22621)).toBe(true);
    expect(supportsBackdrop(22000)).toBe(false);
    expect(backdropFor('settings', 26300)).toBe('mica');
    expect(backdropFor('onboarding', 22621)).toBe('mica');
    expect(backdropFor('assistant', 26300)).toBe('none');
    expect(backdropFor('settings', 19045)).toBe('none');
  });
});

describe('taskbar theme', () => {
  it('reads SystemUsesLightTheme from reg.exe output', () => {
    expect(parseTaskbarTheme('\r\n    SystemUsesLightTheme    REG_DWORD    0x0\r\n')).toBe('dark');
    expect(parseTaskbarTheme('    SystemUsesLightTheme    REG_DWORD    0x1')).toBe('light');
    expect(parseTaskbarTheme('')).toBe('dark');
    expect(
      parseTaskbarTheme('ERROR: The system was unable to find the specified registry key'),
    ).toBe('dark');
  });
});

describe('log rotation', () => {
  it('keeps at most maxFiles files, newest archive first', () => {
    const file = join(dir, 'main.log');
    for (let round = 1; round <= 7; round += 1) {
      writeFileSync(file, `round ${round}`, 'utf8');
      rotateLogFile(file, 5);
    }
    writeFileSync(file, 'current', 'utf8');
    expect(listLogFiles(file)).toEqual([
      'main.1.log',
      'main.2.log',
      'main.3.log',
      'main.4.log',
      'main.log',
    ]);
    expect(readFileSync(join(dir, 'main.1.log'), 'utf8')).toBe('round 7');
    expect(readFileSync(join(dir, 'main.4.log'), 'utf8')).toBe('round 4');
  });

  it('copes with a missing log file or folder', () => {
    expect(() => rotateLogFile(join(dir, 'nope.log'), 3)).not.toThrow();
    expect(listLogFiles(join(dir, 'missing', 'main.log'))).toEqual([]);
  });
});

describe('.env handling', () => {
  it('parses quotes, comments and export prefixes', () => {
    const parsed = parseDotEnv(
      [
        '# comment',
        'A=1',
        'B = "two words"',
        "C='x'",
        'export D=4 # trailing',
        'EMPTY=',
        'not a line',
        '9BAD=1',
      ].join('\n'),
    );
    expect(parsed).toEqual({ A: '1', B: 'two words', C: 'x', D: '4' });
  });

  it('prefers earlier files and ignores unreadable ones', () => {
    writeFileSync(join(dir, 'one.env'), 'AZURE_SPEECH_KEY=first\nSHARED=1', 'utf8');
    writeFileSync(join(dir, 'two.env'), 'AZURE_SPEECH_KEY=second\nOTHER=2', 'utf8');
    mkdirSync(join(dir, 'folder.env'));
    const merged = loadDotEnvFiles([
      join(dir, 'missing.env'),
      join(dir, 'one.env'),
      join(dir, 'folder.env'),
      join(dir, 'two.env'),
    ]);
    expect(merged).toEqual({ AZURE_SPEECH_KEY: 'first', SHARED: '1', OTHER: '2' });
  });

  it('extracts the Azure variables and trims blanks', () => {
    expect(
      readAzureEnv({
        AZURE_SPEECH_KEY: ' k ',
        AZURE_SPEECH_REGION: 'westeurope',
        AZURE_OPENAI_ENDPOINT: '',
        AZURE_OPENAI_KEY: undefined,
        AZURE_OPENAI_DEPLOYMENT: 'gpt',
      }),
    ).toEqual({ speechKey: 'k', speechRegion: 'westeurope', openAiDeployment: 'gpt' });
  });
});
