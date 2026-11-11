import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictationStart, DictationStatus, TranscribeResult } from '@shared/ipc/types';
import { applySettingsPatch, DEFAULT_SETTINGS, type SettingsPatch } from '@shared/settings';
import { DictationController, resolveLanguage } from '@main/dictation/controller';
import { MESSAGES } from '@main/dictation/messages';
import type { DictationPill, Win32Services } from '@main/dictation/types';
import type { WindowRef } from '@main/system/foreground';
import type { InjectOutcome } from '@main/system/inputInjector';

const NOTEPAD: WindowRef = { handle: 100, pid: 2000 };
const OWN_PID = 4242;
const OK: InjectOutcome = { status: 'ok' };

/** A short sentence: a second of loud tone between two moments of near-silence (like the pill's clip). */
function speech(): Float32Array {
  const margin = 4800;
  const samples = new Float32Array(margin + 16_000 + margin);
  for (let index = 0; index < samples.length; index += 1) {
    const inside = index >= margin && index < margin + 16_000;
    samples[index] = (inside ? 0.3 : 0.002) * Math.sin((2 * Math.PI * 220 * index) / 16_000);
  }
  return samples;
}

function heard(text: string, lang = 'en'): TranscribeResult {
  return { text, lang, model: 'small', durationMs: 120, audioMs: 1000 };
}

interface Options {
  patch?: SettingsPatch;
  transcript?: string;
  services?: Win32Services | null;
  own?: (handle: number) => boolean;
  foreground?: WindowRef | null;
  typeOutcome?: InjectOutcome;
  hotkey?: string | null;
  timings?: ConstructorParameters<typeof DictationController>[0]['timings'];
}

function setup(options: Options = {}) {
  let foreground: WindowRef | null =
    options.foreground === undefined ? NOTEPAD : options.foreground;
  let elevated = false;
  const settings = applySettingsPatch(DEFAULT_SETTINGS, options.patch ?? {});

  const order: string[] = [];
  const statuses: DictationStatus[] = [];
  const starts: DictationStart[] = [];

  const show = vi.fn((_target: WindowRef | null) => {
    order.push('pill.show');
    return Promise.resolve();
  });
  const start = vi.fn((payload: DictationStart) => {
    order.push('pill.start');
    starts.push(payload);
  });
  const stop = vi.fn((submit: boolean) => {
    order.push(`pill.stop(${String(submit)})`);
  });
  const status = vi.fn((value: DictationStatus) => {
    statuses.push(value);
  });
  const hide = vi.fn(() => {
    order.push('pill.hide');
  });
  const destroy = vi.fn();
  const pill: DictationPill = { show, start, stop, status, hide, destroy };

  const armEscape = vi.fn((_onPress: () => void) => true);
  const disarmEscape = vi.fn();

  const typeText = vi.fn(
    (_text: string, _options?: { shouldContinue?: () => boolean }): Promise<InjectOutcome> =>
      Promise.resolve(options.typeOutcome ?? OK),
  );
  const pasteText = vi.fn((_text: string): Promise<InjectOutcome> => Promise.resolve(OK));
  const blocksInput = vi.fn(() => elevated);
  const services: Win32Services | null =
    options.services === undefined
      ? {
          foreground: {
            current: () => foreground,
            caretRect: () => null,
            windowRect: () => null,
            blocksInput,
          },
          injector: { typeText, pasteText, dispose: vi.fn() },
        }
      : options.services;

  const transcribe = vi.fn((_request: { samples: Float32Array; language?: 'auto' | 'en' | 'hi' }) =>
    Promise.resolve(heard(options.transcript ?? 'hello comma world')),
  );
  const writeText = vi.fn((_text: string) => Promise.resolve());
  const releaseOwnFocus = vi.fn(() => {
    order.push('releaseOwnFocus');
  });
  const stopAssistantListening = vi.fn(() => {
    order.push('assistant.stop');
  });
  const setWakePaused = vi.fn((paused: boolean) => {
    order.push(`wake.paused(${String(paused)})`);
  });
  const setMicActive = vi.fn((active: boolean) => {
    order.push(`tray.mic(${String(active)})`);
  });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clock = { now: 1_000_000 };

  const controller = new DictationController({
    logger,
    settings: () => settings,
    speech: { transcribe },
    services: () => Promise.resolve(services),
    pill,
    escape: { arm: armEscape, disarm: disarmEscape },
    isOwnWindow: options.own ?? (() => false),
    ownPid: OWN_PID,
    releaseOwnFocus,
    stopAssistantListening,
    setWakePaused,
    setMicActive,
    hotkey: () => (options.hotkey === undefined ? 'Alt+Shift+D' : options.hotkey),
    theme: () => 'dark',
    clipboard: { writeText },
    now: () => clock.now,
    ...(options.timings ? { timings: options.timings } : {}),
  });

  return {
    controller,
    settings,
    order,
    statuses,
    starts,
    show,
    start,
    stop,
    status,
    hide,
    destroy,
    armEscape,
    disarmEscape,
    typeText,
    pasteText,
    blocksInput,
    transcribe,
    writeText,
    releaseOwnFocus,
    stopAssistantListening,
    setWakePaused,
    setMicActive,
    logger,
    clock,
    setForeground: (value: WindowRef | null) => {
      foreground = value;
    },
    setElevated: (value: boolean) => {
      elevated = value;
    },
    phases: () => statuses.map((entry) => entry.phase),
  };
}

type Harness = ReturnType<typeof setup>;

/** Lets the asynchronous start-up (services, target, pill) finish. */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

async function startListening(harness: Harness): Promise<void> {
  harness.controller.toggle('hotkey');
  await settle();
  expect(harness.controller.phase).toBe('listening');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('starting', () => {
  it('shows the pill after remembering the focused window, then starts the recording', async () => {
    const harness = setup({ patch: { voice: { earcons: false, micDeviceId: 'usb-mic' } } });
    harness.controller.toggle('hotkey');
    expect(harness.controller.phase).toBe('starting');
    expect(harness.controller.active).toBe(true);
    await settle();

    expect(harness.controller.phase).toBe('listening');
    expect(harness.show).toHaveBeenCalledWith(NOTEPAD);
    expect(harness.starts).toEqual([
      {
        language: 'auto',
        micDeviceId: 'usb-mic',
        silenceMs: 2000,
        maxSeconds: 60,
        earcons: false,
        theme: 'dark',
        hotkey: 'Alt+Shift+D',
      },
    ]);
    expect(harness.order).toEqual([
      'assistant.stop',
      'wake.paused(true)',
      'pill.show',
      'tray.mic(true)',
      'pill.start',
    ]);
    expect(harness.armEscape).toHaveBeenCalledTimes(1);
  });

  it('tells the pill when the hotkey is not registered', async () => {
    const harness = setup({ hotkey: null });
    await startListening(harness);
    expect(harness.starts[0]?.hotkey).toBeNull();
  });

  it('turns the silence setting into milliseconds', async () => {
    const harness = setup({ patch: { dictation: { silenceSeconds: 3.5 } } });
    await startListening(harness);
    expect(harness.starts[0]?.silenceMs).toBe(3500);
  });

  it.each([
    [{ dictation: { language: 'inherit' as const }, voice: { language: 'hi' as const } }, 'hi'],
    [{ dictation: { language: 'inherit' as const }, voice: { language: 'en' as const } }, 'en'],
    [{ dictation: { language: 'en' as const }, voice: { language: 'hi' as const } }, 'en'],
    [{ dictation: { language: 'auto' as const }, voice: { language: 'en' as const } }, 'auto'],
  ])('resolves the language from %j to %s', async (patch, expected) => {
    expect(resolveLanguage(applySettingsPatch(DEFAULT_SETTINGS, patch))).toBe(expected);
    const harness = setup({ patch });
    await startListening(harness);
    expect(harness.starts[0]?.language).toBe(expected);
  });

  it('says so on the pill when dictation is switched off, and does not record', async () => {
    const harness = setup({ patch: { dictation: { enabled: false } } });
    harness.controller.toggle('hotkey');
    await settle();

    expect(harness.statuses).toEqual([{ phase: 'error', message: 'Dictation is off in Settings' }]);
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.setMicActive).not.toHaveBeenCalled();
    expect(harness.setWakePaused).not.toHaveBeenCalled();
    expect(harness.controller.active).toBe(false);

    await vi.advanceTimersByTimeAsync(2600);
    expect(harness.hide).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
  });

  it('still starts when the Win32 helpers are missing (the text will go to the clipboard)', async () => {
    const harness = setup({ services: null });
    await startListening(harness);
    expect(harness.show).toHaveBeenCalledWith(null);
  });

  it('gives up with a message when the pill page never loads', async () => {
    const harness = setup();
    harness.show.mockRejectedValue(new Error('timeout'));
    harness.controller.toggle('hotkey');
    await settle();

    expect(harness.destroy).toHaveBeenCalled();
    expect(harness.controller.phase).toBe('idle');
    // Everything the start took was given back.
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
  });
});

describe('the window to type into', () => {
  it('steps Beekeeper’s own window aside and waits for the app below it', async () => {
    let handle = 7;
    const harness = setup({ foreground: { handle, pid: OWN_PID }, own: (value) => value === 7 });
    harness.releaseOwnFocus.mockImplementation(() => {
      // The assistant bar closes; Windows gives the focus back to Notepad a moment later.
      setTimeout(() => {
        handle = 100;
        harness.setForeground(NOTEPAD);
      }, 120);
    });
    harness.controller.toggle('voice');
    await vi.advanceTimersByTimeAsync(400);

    expect(harness.releaseOwnFocus).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('listening');
    expect(harness.show).toHaveBeenCalledWith(NOTEPAD);
  });

  it('asks the user to click somewhere when only Beekeeper windows have the focus', async () => {
    const harness = setup({ foreground: { handle: 7, pid: OWN_PID }, own: () => true });
    harness.controller.toggle('hotkey');
    await vi.advanceTimersByTimeAsync(1200);

    expect(harness.releaseOwnFocus).toHaveBeenCalledTimes(1);
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.statuses[0]).toEqual({ phase: 'error', message: MESSAGES.noTarget });
    expect(harness.setWakePaused).not.toHaveBeenCalled();
  });

  it('ignores the tray menu (a window of Beekeeper’s process) when started from the tray', async () => {
    const harness = setup({ foreground: { handle: 55, pid: OWN_PID } });
    harness.releaseOwnFocus.mockImplementation(() => {
      setTimeout(() => harness.setForeground(NOTEPAD), 80);
    });
    harness.controller.toggle('tray');
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.show).toHaveBeenCalledWith(NOTEPAD);
    expect(harness.controller.phase).toBe('listening');
  });

  it('does not mistake a window of Beekeeper’s process for its own unless it is a known window', async () => {
    // The E2E target window lives in Beekeeper's process but is not registered as a window role.
    const harness = setup({ foreground: { handle: 55, pid: OWN_PID } });
    harness.controller.toggle('hotkey');
    await settle();
    expect(harness.releaseOwnFocus).not.toHaveBeenCalled();
    expect(harness.controller.phase).toBe('listening');
  });
});

describe('finishing a dictation', () => {
  it('stops on the second hotkey press, then types the processed transcript', async () => {
    const harness = setup();
    await startListening(harness);

    harness.controller.toggle('hotkey');
    expect(harness.stop).toHaveBeenCalledWith(true);
    // Still listening until the pill hands over what it recorded.
    expect(harness.controller.phase).toBe('listening');

    const result = await harness.controller.submit(speech());
    expect(result).toEqual({ ok: true, text: 'Hello, world' });
    expect(harness.transcribe).toHaveBeenCalledWith({
      samples: expect.any(Float32Array) as Float32Array,
      language: 'auto',
    });
    expect(harness.typeText).toHaveBeenCalledTimes(1);
    expect(harness.typeText.mock.calls[0]?.[0]).toBe('Hello, world');
    expect(harness.phases()).toEqual(['transcribing', 'typing', 'done']);
    expect(harness.statuses[2]).toEqual({ phase: 'done', text: 'Hello, world' });
    expect(harness.setMicActive).toHaveBeenLastCalledWith(false);
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
    expect(harness.controller.phase).toBe('finishing');
    expect(harness.controller.active).toBe(false);

    await vi.advanceTimersByTimeAsync(1200);
    expect(harness.hide).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
  });

  it('types a recording that ended by itself (silence) the same way', async () => {
    const harness = setup({ transcript: 'I am fine full stop' });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result.text).toBe('I am fine.');
    expect(harness.stop).not.toHaveBeenCalled();
  });

  it('keeps spoken punctuation as words when the setting is off', async () => {
    const harness = setup({
      transcript: 'hello comma world',
      patch: { dictation: { spokenPunctuation: false } },
    });
    await startListening(harness);
    expect((await harness.controller.submit(speech())).text).toBe('Hello comma world');
  });

  it('pastes instead of typing when the method is paste', async () => {
    const harness = setup({ patch: { dictation: { method: 'paste' } } });
    await startListening(harness);
    await harness.controller.submit(speech());
    expect(harness.pasteText).toHaveBeenCalledWith('Hello, world');
    expect(harness.typeText).not.toHaveBeenCalled();
  });

  it('asks the language the user speaks, and Hindi gets its danda', async () => {
    const harness = setup({
      transcript: 'मैं ठीक हूँ पूर्ण विराम',
      patch: { dictation: { language: 'hi' } },
    });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(harness.transcribe.mock.calls[0]?.[0].language).toBe('hi');
    expect(result.text).toBe('मैं ठीक हूँ।');
  });

  it('refuses a recording when no dictation is running', async () => {
    const harness = setup();
    await expect(harness.controller.submit(speech())).resolves.toEqual({
      ok: false,
      message: 'Dictation is not active.',
    });
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it('refuses a second recording for the same dictation', async () => {
    const harness = setup();
    await startListening(harness);
    await harness.controller.submit(speech());
    await expect(harness.controller.submit(speech())).resolves.toMatchObject({ ok: false });
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('cancelling', () => {
  it('cancels with Esc while listening', async () => {
    const harness = setup();
    await startListening(harness);
    const onEscape = harness.armEscape.mock.calls[0]?.[0];
    onEscape?.();

    expect(harness.stop).toHaveBeenCalledWith(false);
    expect(harness.statuses).toEqual([{ phase: 'cancelled' }]);
    expect(harness.setMicActive).toHaveBeenLastCalledWith(false);
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
    expect(harness.controller.active).toBe(false);

    await vi.advanceTimersByTimeAsync(250);
    expect(harness.hide).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
  });

  it('cancels from the pill’s close button', async () => {
    const harness = setup();
    await startListening(harness);
    harness.controller.cancel('pill');
    expect(harness.phases()).toEqual(['cancelled']);
  });

  it('ignores a recording that arrives after the cancel', async () => {
    const harness = setup();
    await startListening(harness);
    harness.controller.cancel('pill');
    await expect(harness.controller.submit(speech())).resolves.toMatchObject({ ok: false });
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.typeText).not.toHaveBeenCalled();
  });

  it('cancels while transcribing when the hotkey is pressed, and never types the late result', async () => {
    const harness = setup();
    let finish: (value: TranscribeResult) => void = () => undefined;
    harness.transcribe.mockReturnValue(
      new Promise<TranscribeResult>((resolve) => {
        finish = resolve;
      }),
    );
    await startListening(harness);
    const submitted = harness.controller.submit(speech());
    await settle();
    expect(harness.controller.phase).toBe('transcribing');

    harness.controller.toggle('hotkey');
    expect(harness.phases()).toEqual(['transcribing', 'cancelled']);

    finish(heard('too late'));
    await expect(submitted).resolves.toEqual({ ok: false, message: 'Cancelled.' });
    expect(harness.typeText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.controller.phase).toBe('idle');
  });

  it('cancels while the pill is still starting', async () => {
    const harness = setup();
    let release: () => void = () => undefined;
    harness.show.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    harness.controller.toggle('hotkey');
    await settle();
    expect(harness.controller.phase).toBe('starting');

    // A second press while it is starting means "never mind".
    harness.controller.toggle('hotkey');
    release();
    await vi.advanceTimersByTimeAsync(300);

    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.setMicActive).not.toHaveBeenCalled();
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.controller.phase).toBe('idle');
  });

  it('cannot cancel what is already being typed', async () => {
    const harness = setup();
    let finish: (value: InjectOutcome) => void = () => undefined;
    harness.typeText.mockReturnValue(
      new Promise<InjectOutcome>((resolve) => {
        finish = resolve;
      }),
    );
    await startListening(harness);
    const submitted = harness.controller.submit(speech());
    await settle();
    expect(harness.controller.phase).toBe('typing');

    harness.controller.toggle('hotkey');
    harness.controller.cancel('escape');
    expect(harness.phases()).toEqual(['transcribing', 'typing']);

    finish(OK);
    await expect(submitted).resolves.toMatchObject({ ok: true });
  });

  it('starts a new dictation at once when the hotkey is pressed while the result is still showing', async () => {
    const harness = setup();
    await startListening(harness);
    await harness.controller.submit(speech());
    expect(harness.controller.phase).toBe('finishing');

    harness.controller.toggle('hotkey');
    await settle();
    expect(harness.controller.phase).toBe('listening');
    expect(harness.start).toHaveBeenCalledTimes(2);

    // The first dictation's hide timer must not hide the new session's pill.
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.hide).not.toHaveBeenCalled();
  });
});

describe('failures show a friendly message', () => {
  it.each([
    [
      'the model is not installed',
      new Error('The speech recognition model is not installed. Download it in Settings > Voice.'),
      MESSAGES.noModel,
    ],
    [
      'the engine cannot start',
      new Error('The speech engine could not start. Reinstall the voice pack in Settings.'),
      MESSAGES.engine,
    ],
    ['anything else', new Error('C:\\secret\\path\\worker.js exploded'), MESSAGES.failed],
    ['a non-error rejection', 'nope', MESSAGES.failed],
  ])('when %s', async (_name, error, message) => {
    const harness = setup();
    harness.transcribe.mockRejectedValue(error);
    await startListening(harness);
    const result = await harness.controller.submit(speech());

    expect(result).toEqual({ ok: false, message });
    expect(harness.statuses.at(-1)).toEqual({ phase: 'error', message });
    expect(harness.typeText).not.toHaveBeenCalled();
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
    // The raw error never reaches the pill; it is logged.
    expect(JSON.stringify(harness.statuses)).not.toContain('secret');
    expect(harness.logger.warn).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2600);
    expect(harness.hide).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
  });

  it.each([
    ['nothing was recognised', ''],
    ['only fillers were heard', 'um uh hmm'],
    ['only an annotation was heard', '[Music]'],
  ])('when %s', async (_name, transcript) => {
    const harness = setup({ transcript });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result).toEqual({ ok: false, message: MESSAGES.nothingHeard });
    expect(harness.statuses.at(-1)).toEqual({ phase: 'error', message: MESSAGES.nothingHeard });
    expect(harness.typeText).not.toHaveBeenCalled();
  });

  it('drops "Thank you." that Whisper made up from a silent recording', async () => {
    const harness = setup({ transcript: 'Thank you.' });
    await startListening(harness);
    const result = await harness.controller.submit(new Float32Array(16_000));
    expect(result.ok).toBe(false);
    expect(harness.typeText).not.toHaveBeenCalled();
  });

  it('keeps "Thank you." when it was really said', async () => {
    const harness = setup({ transcript: 'Thank you.' });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result).toEqual({ ok: true, text: 'Thank you.' });
  });

  it.each([
    ['the microphone is blocked', 'mic-denied' as const, MESSAGES.micDenied],
    ['there is no microphone', 'mic-missing' as const, MESSAGES.micMissing],
    ['the microphone is busy', 'mic-busy' as const, MESSAGES.micBusy],
    ['nothing was said', 'no-speech' as const, MESSAGES.nothingHeard],
    ['the recorder broke', 'error' as const, MESSAGES.failed],
  ])('when the pill reports that %s', async (_name, reason, message) => {
    const harness = setup();
    await startListening(harness);
    harness.controller.abort(reason, 'NotAllowedError');

    await settle();
    expect(harness.statuses).toEqual([{ phase: 'error', message }]);
    expect(harness.setMicActive).toHaveBeenLastCalledWith(false);
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(2600);
    expect(harness.controller.phase).toBe('idle');
  });

  it('ignores an abort when nothing is listening', async () => {
    const harness = setup();
    harness.controller.abort('error');
    await settle();
    expect(harness.status).not.toHaveBeenCalled();
  });

  it('gives up when the pill does not hand over its recording after a stop request', async () => {
    const harness = setup();
    await startListening(harness);
    harness.controller.toggle('hotkey');
    await vi.advanceTimersByTimeAsync(6000);

    expect(harness.statuses.at(-1)).toEqual({ phase: 'error', message: MESSAGES.unresponsive });
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
  });
});

describe('never typing into the wrong place', () => {
  it('copies the text instead when the user switched to another window', async () => {
    const harness = setup();
    await startListening(harness);
    harness.setForeground({ handle: 999, pid: 3000 });

    const result = await harness.controller.submit(speech());
    expect(result).toEqual({ ok: true, text: 'Hello, world', message: MESSAGES.copied });
    expect(harness.typeText).not.toHaveBeenCalled();
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
    expect(harness.statuses.at(-1)).toEqual({
      phase: 'done',
      text: 'Hello, world',
      message: MESSAGES.copied,
    });
    await vi.advanceTimersByTimeAsync(2600);
    expect(harness.controller.phase).toBe('idle');
  });

  it('copies the text instead when focus left the app while there were no windows', async () => {
    const harness = setup();
    await startListening(harness);
    harness.setForeground(null);
    await harness.controller.submit(speech());
    expect(harness.typeText).not.toHaveBeenCalled();
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('never types into a Beekeeper window', async () => {
    let own = false;
    const harness = setup({ own: () => own });
    await startListening(harness);
    own = true;
    await harness.controller.submit(speech());
    expect(harness.typeText).not.toHaveBeenCalled();
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('copies the text when Windows would drop the keystrokes (the app runs elevated)', async () => {
    const harness = setup();
    await startListening(harness);
    harness.setElevated(true);
    const result = await harness.controller.submit(speech());
    expect(result.message).toBe(MESSAGES.copied);
    expect(harness.typeText).not.toHaveBeenCalled();
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('copies everything when SendInput refuses the first batch', async () => {
    const harness = setup({ typeOutcome: { status: 'failed', reason: 'refused', typed: 0 } });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result.message).toBe(MESSAGES.copied);
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('copies only the rest when typing was interrupted part-way', async () => {
    const harness = setup({ typeOutcome: { status: 'failed', reason: 'interrupted', typed: 5 } });
    await startListening(harness);
    await harness.controller.submit(speech());
    expect(harness.writeText).toHaveBeenCalledWith(', world');
  });

  it('copies the text when a hotkey modifier is still held', async () => {
    const harness = setup({ typeOutcome: { status: 'failed', reason: 'keys-held', typed: 0 } });
    await startListening(harness);
    await harness.controller.submit(speech());
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('passes a guard that notices the focus moving during a long text', async () => {
    const harness = setup();
    await startListening(harness);
    await harness.controller.submit(speech());
    const guard = harness.typeText.mock.calls[0]?.[1]?.shouldContinue;
    expect(guard?.()).toBe(true);
    harness.setForeground({ handle: 5, pid: 1 });
    expect(guard?.()).toBe(false);
  });

  it('copies the text when the Win32 helpers are missing', async () => {
    const harness = setup({ services: null });
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result.message).toBe(MESSAGES.copied);
    expect(harness.writeText).toHaveBeenCalledWith('Hello, world');
  });

  it('does not claim the text was copied when the clipboard cannot be written', async () => {
    const harness = setup({ services: null });
    harness.writeText.mockRejectedValue(new Error('locked'));
    await startListening(harness);
    const result = await harness.controller.submit(speech());
    expect(result).toEqual({ ok: false, message: MESSAGES.lost });
    expect(harness.statuses.at(-1)).toEqual({ phase: 'error', message: MESSAGES.lost });
    expect(harness.logger.warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2600);
    expect(harness.controller.phase).toBe('idle');
  });
});

describe('continuing a sentence', () => {
  async function dictate(harness: Harness, transcript: string): Promise<void> {
    harness.transcribe.mockResolvedValue(heard(transcript));
    harness.controller.toggle('hotkey');
    await settle();
    await harness.controller.submit(speech());
    await vi.advanceTimersByTimeAsync(1300);
  }

  it('adds a space when the next dictation goes into the same window soon after', async () => {
    const harness = setup();
    await dictate(harness, 'first part');
    await dictate(harness, 'second part');
    expect(harness.typeText.mock.calls.map((call) => call[0])).toEqual([
      'First part',
      ' Second part',
    ]);
  });

  it('does not add a space after a long pause, in another window, or after a line break', async () => {
    const harness = setup();
    await dictate(harness, 'first part');
    harness.clock.now += 31_000;
    await dictate(harness, 'late part');

    harness.setForeground({ handle: 321, pid: 9 });
    await dictate(harness, 'elsewhere');

    harness.setForeground(NOTEPAD);
    await dictate(harness, 'one new line');
    await dictate(harness, 'two');
    expect(harness.typeText.mock.calls.map((call) => call[0])).toEqual([
      'First part',
      'Late part',
      'Elsewhere',
      'One\n',
      'Two',
    ]);
  });

  it('does not add a space before punctuation', async () => {
    const harness = setup();
    await dictate(harness, 'first part');
    await dictate(harness, 'comma');
    expect(harness.typeText.mock.calls.map((call) => call[0])).toEqual(['First part', ',']);
  });
});

describe('watchdogs and disposal', () => {
  it('resets a transcription that never answers', async () => {
    const harness = setup();
    harness.transcribe.mockReturnValue(new Promise<TranscribeResult>(() => undefined));
    await startListening(harness);
    void harness.controller.submit(speech());
    await settle();
    expect(harness.controller.phase).toBe('transcribing');

    await vi.advanceTimersByTimeAsync(90_000);
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalled();
  });

  it('resets a recording that never ends', async () => {
    const harness = setup();
    await startListening(harness);
    await vi.advanceTimersByTimeAsync(75_000);
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(harness.setMicActive).toHaveBeenLastCalledWith(false);
    expect(harness.controller.phase).toBe('idle');
  });

  it('resets a start that never completes', async () => {
    const harness = setup();
    harness.show.mockReturnValue(new Promise<void>(() => undefined));
    harness.controller.toggle('hotkey');
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase).toBe('idle');
  });

  it('can be used again after a reset', async () => {
    const harness = setup();
    await startListening(harness);
    await vi.advanceTimersByTimeAsync(75_000);
    harness.controller.toggle('hotkey');
    await settle();
    expect(harness.controller.phase).toBe('listening');
  });

  it('releases everything when the app quits mid-dictation', async () => {
    const harness = setup();
    await startListening(harness);
    harness.controller.dispose();

    expect(harness.destroy).toHaveBeenCalled();
    expect(harness.setMicActive).toHaveBeenLastCalledWith(false);
    expect(harness.setWakePaused).toHaveBeenLastCalledWith(false);
    expect(harness.disarmEscape).toHaveBeenCalled();
    expect(harness.controller.phase).toBe('idle');

    harness.controller.toggle('hotkey');
    await settle();
    expect(harness.controller.phase).toBe('idle');
    await expect(harness.controller.submit(speech())).resolves.toMatchObject({ ok: false });

    // Disposing twice is harmless.
    harness.controller.dispose();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not type a result that arrives after dispose', async () => {
    const harness = setup();
    let finish: (value: TranscribeResult) => void = () => undefined;
    harness.transcribe.mockReturnValue(
      new Promise<TranscribeResult>((resolve) => {
        finish = resolve;
      }),
    );
    await startListening(harness);
    void harness.controller.submit(speech());
    await settle();
    harness.controller.dispose();
    finish(heard('late'));
    await settle();
    expect(harness.typeText).not.toHaveBeenCalled();
  });
});
