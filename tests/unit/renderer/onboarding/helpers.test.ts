import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicError } from '@renderer/lib/voice/mic';
import { createErrorReporter, logFailure } from '@renderer/onboarding/bridge';
import { isInteractiveTarget, shouldRunPrimaryOnEnter } from '@renderer/onboarding/keys';
import { asMicError, openWithFallback } from '@renderer/onboarding/micOpen';
import { applyTheme, systemTheme } from '@renderer/onboarding/theme';
import { createFakeBridge, createFakeMic } from './testUtils';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  delete document.documentElement.dataset['theme'];
});

describe('Enter shortcut', () => {
  /** Dispatches a keydown on `target` and reports what the shortcut helper says. */
  function press(target: Element, init: KeyboardEventInit = {}): boolean {
    let result = false;
    const listener = (event: KeyboardEvent): void => {
      result = shouldRunPrimaryOnEnter(event);
    };
    document.addEventListener('keydown', listener);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));
    document.removeEventListener('keydown', listener);
    return result;
  }

  function mount(html: string): Element {
    document.body.innerHTML = html;
    const target = document.body.firstElementChild;
    if (!target) throw new Error('Fixture is empty');
    return target;
  }

  it('fires for Enter on the page, a heading or plain text', () => {
    expect(press(document.body)).toBe(true);
    expect(press(mount('<h1 tabindex="-1">Title</h1>'))).toBe(true);
    expect(press(mount('<p><span>text</span></p>').firstElementChild ?? document.body)).toBe(true);
  });

  it.each([
    '<button>Back</button>',
    '<a href="#x">link</a>',
    '<input />',
    '<textarea></textarea>',
    '<div role="switch" aria-checked="false"></div>',
    '<div role="button">x</div>',
    '<div contenteditable="true"></div>',
  ])('leaves Enter to %s', (html) => {
    expect(press(mount(html))).toBe(false);
  });

  it('also leaves Enter to the children of a control', () => {
    const button = mount('<button><span>inner</span></button>');
    const inner = button.querySelector('span');
    expect(isInteractiveTarget(inner)).toBe(true);
    expect(press(inner ?? button)).toBe(false);
  });

  it.each([
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true },
  ])('ignores Enter with %j', (init) => {
    expect(press(document.body, init)).toBe(false);
  });

  it('ignores other keys and events that were already handled', () => {
    expect(press(document.body, { key: 'a' })).toBe(false);
    let handled = true;
    const first = (event: KeyboardEvent): void => event.preventDefault();
    const second = (event: KeyboardEvent): void => {
      handled = shouldRunPrimaryOnEnter(event);
    };
    document.addEventListener('keydown', first);
    document.addEventListener('keydown', second);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    document.removeEventListener('keydown', first);
    document.removeEventListener('keydown', second);
    expect(handled).toBe(false);
  });

  it('treats a missing target as not interactive', () => {
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

describe('openWithFallback', () => {
  it('returns the session of the saved microphone', async () => {
    const { session } = createFakeMic();
    const open = vi.fn().mockResolvedValue(session);
    await expect(openWithFallback(open, 'usb-mic')).resolves.toBe(session);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('usb-mic');
  });

  it('falls back to the default device once when the saved one is gone', async () => {
    const { session } = createFakeMic();
    const open = vi
      .fn()
      .mockRejectedValueOnce(new MicError('no-device', 'gone'))
      .mockResolvedValueOnce(session);
    await expect(openWithFallback(open, 'unplugged')).resolves.toBe(session);
    expect(open.mock.calls).toEqual([['unplugged'], ['default']]);
  });

  it('does not retry the default device, nor other kinds of failure', async () => {
    const noDevice = vi.fn().mockRejectedValue(new MicError('no-device', 'none'));
    await expect(openWithFallback(noDevice, 'default')).rejects.toMatchObject({
      kind: 'no-device',
    });
    expect(noDevice).toHaveBeenCalledTimes(1);

    const denied = vi.fn().mockRejectedValue(new MicError('denied', 'blocked'));
    await expect(openWithFallback(denied, 'usb-mic')).rejects.toMatchObject({ kind: 'denied' });
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('reports a failing fallback as a MicError too', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new MicError('no-device', 'gone'))
      .mockRejectedValueOnce(new DOMException('in use', 'NotReadableError'));
    await expect(openWithFallback(open, 'unplugged')).rejects.toMatchObject({ kind: 'busy' });
  });

  it('turns browser errors into friendly kinds', () => {
    expect(asMicError(new DOMException('no', 'NotAllowedError')).kind).toBe('denied');
    expect(asMicError(new DOMException('no', 'NotFoundError')).kind).toBe('no-device');
    expect(asMicError(new Error('weird')).kind).toBe('unknown');
    const existing = new MicError('busy', 'x');
    expect(asMicError(existing)).toBe(existing);
  });
});

describe('error reporting', () => {
  it('forwards crashes to the main-process log with bounded sizes', () => {
    const fake = createFakeBridge();
    const report = createErrorReporter(fake.bridge);
    const error = new Error('x'.repeat(10_000));
    error.stack = 'y'.repeat(20_000);
    report(error, 'react');
    const [input] = fake.inputsOf('app:log') as Array<{
      level: string;
      scope: string;
      message: string;
      stack: string;
    }>;
    expect(input?.level).toBe('error');
    expect(input?.scope).toBe('react');
    expect(input?.message.length).toBeLessThanOrEqual(3900);
    expect(input?.stack.length).toBeLessThanOrEqual(7900);
  });

  it('never throws or rejects when logging itself fails', async () => {
    const fake = createFakeBridge();
    fake.handle('app:log', () => {
      throw new Error('log failed');
    });
    expect(() =>
      createErrorReporter(fake.bridge)(new Error('boom'), 'window.onerror'),
    ).not.toThrow();
    expect(() => logFailure(fake.bridge, 'settings:get', new Error('nope'))).not.toThrow();
    // An unhandled rejection would make the whole test run fail.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.inputsOf('app:log')).toHaveLength(2);
  });

  it('logs non-fatal IPC failures as warnings with the action name', () => {
    const fake = createFakeBridge();
    logFailure(fake.bridge, 'hotkeys:status', 'plain string');
    expect(fake.inputsOf('app:log')).toEqual([
      { level: 'warn', scope: 'onboarding', message: 'hotkeys:status: plain string' },
    ]);
  });
});

describe('theme', () => {
  it('follows the OS colour scheme and defaults to dark without matchMedia', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }));
    expect(systemTheme()).toBe('light');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(systemTheme()).toBe('dark');
    vi.stubGlobal('matchMedia', undefined);
    expect(systemTheme()).toBe('dark');
  });

  it('switches the design tokens through data-theme on the root element', () => {
    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
