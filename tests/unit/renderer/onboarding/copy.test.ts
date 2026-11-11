import { describe, expect, it } from 'vitest';
import { MIC_ERROR_HELP } from '@renderer/lib/voice/mic';
import { footerFor } from '@renderer/onboarding/footer';
import { describeShortcut, keyCapsFor } from '@renderer/onboarding/keycaps';
import { describeMicStatus, SILENT_TEXT } from '@renderer/onboarding/micCopy';
import { describeModelCopy } from '@renderer/onboarding/modelCopy';
import { describeModel } from '@renderer/onboarding/modelFormat';
import { micOutcomeOf, summarizeSetup } from '@renderer/onboarding/summary';
import type { MicTestState } from '@renderer/onboarding/types';
import { describeWakeHint } from '@renderer/onboarding/wakeHint';
import { modelState } from './testUtils';

describe('summarizeSetup', () => {
  const ready = modelState({ state: 'ready' });

  it('reports a heard microphone, a ready model and the wake word', () => {
    expect(summarizeSetup({ mic: 'heard', model: ready, wakeWord: true })).toEqual([
      { id: 'microphone', label: 'Microphone', value: 'Heard you loud and clear', tone: 'good' },
      { id: 'model', label: 'Voice model', value: 'Ready — voice works offline', tone: 'good' },
      { id: 'wakeWord', label: 'Wake word', value: 'On — say “Hey Beekeeper”', tone: 'good' },
    ]);
  });

  it.each([
    ['skipped', 'neutral', /Skipped/],
    ['silent', 'warn', /Didn’t hear anything/],
    ['problem', 'warn', /Couldn’t open it/],
  ] as const)('describes a %s microphone', (mic, tone, text) => {
    const [item] = summarizeSetup({ mic, model: null, wakeWord: false });
    expect(item?.tone).toBe(tone);
    expect(item?.value).toMatch(text);
  });

  it('shows the live progress of a model that is still downloading', () => {
    const downloading = modelState({
      state: 'downloading',
      receivedBytes: 20_592_431,
      totalBytes: 41_184_862,
    });
    const [, model] = summarizeSetup({ mic: 'skipped', model: downloading, wakeWord: false });
    expect(model).toMatchObject({ value: 'Downloading… 50%', tone: 'neutral' });
  });

  it.each([
    [modelState({ state: 'partial', receivedBytes: 10_296_216 }), /Paused at 25%/, 'neutral'],
    [modelState({ state: 'error', message: 'x' }), /Download failed/, 'warn'],
    [modelState({ state: 'missing' }), /Skipped/, 'neutral'],
    [null, /unavailable/, 'neutral'],
  ] as const)('describes the model state %#', (model, text, tone) => {
    const [, item] = summarizeSetup({ mic: 'heard', model, wakeWord: false });
    expect(item?.value).toMatch(text);
    expect(item?.tone).toBe(tone);
  });

  it('explains that the wake word waits for the model, or is off', () => {
    const [, , waiting] = summarizeSetup({ mic: 'heard', model: null, wakeWord: true });
    expect(waiting?.tone).toBe('neutral');
    expect(waiting?.value).toMatch(/once the voice model/);
    const [, , off] = summarizeSetup({ mic: 'heard', model: ready, wakeWord: false });
    expect(off?.tone).toBe('neutral');
    expect(off?.value).toMatch(/^Off/);
  });
});

describe('micOutcomeOf', () => {
  it.each([
    [false, { status: 'idle' }, 'skipped'],
    [false, { status: 'listening' }, 'skipped'],
    [false, { status: 'silent' }, 'silent'],
    [false, { status: 'error', kind: 'denied' }, 'problem'],
    [true, { status: 'error', kind: 'busy' }, 'heard'],
    [true, { status: 'heard' }, 'heard'],
  ] as Array<[boolean, MicTestState, string]>)(
    'heard=%s state=%j -> %s',
    (heard, state, expected) => {
      expect(micOutcomeOf(heard, state)).toBe(expected);
    },
  );
});

describe('footerFor', () => {
  const idle: MicTestState = { status: 'idle' };

  it('has no Back on the first screen and a Get started primary', () => {
    expect(footerFor({ step: 'welcome', mic: idle, model: null })).toEqual({
      primary: { id: 'next', label: 'Get started' },
      skip: null,
      canGoBack: false,
    });
  });

  it.each([
    [{ status: 'idle' }, 'start-mic', 'Allow & test microphone', 'Skip for now'],
    [{ status: 'requesting' }, 'start-mic', 'Allow & test microphone', 'Skip for now'],
    [{ status: 'listening' }, 'next', 'Continue', undefined],
    [{ status: 'heard' }, 'next', 'Continue', undefined],
    [{ status: 'silent' }, 'start-mic', 'Try again', 'Skip for now'],
    [{ status: 'error', kind: 'denied' }, 'start-mic', 'Try again', 'Skip for now'],
  ] as Array<[MicTestState, string, string, string | undefined]>)(
    'microphone %j: primary "%s"',
    (mic, id, label, skip) => {
      const spec = footerFor({ step: 'microphone', mic, model: null });
      expect(spec.primary).toMatchObject({ id, label });
      expect(spec.skip?.label).toBe(skip);
      expect(spec.canGoBack).toBe(true);
    },
  );

  it.each([
    [null, 'download', 'Download', 'Not now'],
    ['missing', 'download', 'Download', 'Not now'],
    ['partial', 'resume', 'Resume', 'Not now'],
    ['error', 'retry-download', 'Retry', 'Not now'],
    ['downloading', 'next', 'Continue', undefined],
    ['ready', 'next', 'Continue', undefined],
  ] as const)('voice model %s: primary "%s"', (state, id, label, skip) => {
    const model = state ? modelState({ state }) : null;
    const spec = footerFor({ step: 'model', mic: idle, model });
    expect(spec.primary).toMatchObject({ id, label });
    expect(spec.skip?.label).toBe(skip);
  });

  it('continues on the hotkeys screen and finishes on the last one', () => {
    expect(footerFor({ step: 'hotkeys', mic: idle, model: null }).primary.label).toBe('Continue');
    expect(footerFor({ step: 'done', mic: idle, model: null }).primary).toMatchObject({
      id: 'finish',
      label: 'Start using Beekeeper',
    });
  });
});

describe('describeMicStatus', () => {
  it('maps every test state to one friendly line', () => {
    expect(describeMicStatus({ status: 'idle' }).text).toMatch(/Allow & test microphone/);
    expect(describeMicStatus({ status: 'listening' })).toEqual({
      tone: 'active',
      text: 'Say something…',
    });
    expect(describeMicStatus({ status: 'heard' })).toEqual({
      tone: 'good',
      text: 'I can hear you',
    });
    expect(describeMicStatus({ status: 'silent' })).toEqual({ tone: 'warn', text: SILENT_TEXT });
  });

  it.each(['denied', 'no-device', 'busy', 'unknown'] as const)(
    'uses the shared help for %s',
    (kind) => {
      expect(describeMicStatus({ status: 'error', kind })).toEqual({
        tone: 'bad',
        text: MIC_ERROR_HELP[kind],
      });
    },
  );
});

describe('describeWakeHint', () => {
  it('explains that the choice is saved while the model is missing', () => {
    expect(describeWakeHint({ wakeWord: false, modelReady: false, worker: null })?.text).toMatch(
      /Needs the voice model/,
    );
    expect(describeWakeHint({ wakeWord: true, modelReady: false, worker: null })?.text).toMatch(
      /Saved\. It starts listening/,
    );
  });

  it('shows the worker status once the model is ready and the wake word is on', () => {
    const hint = (state: 'armed' | 'loading' | 'paused' | 'error' | 'off', message?: string) =>
      describeWakeHint({
        wakeWord: true,
        modelReady: true,
        worker: { state, ...(message ? { message } : {}) },
      });
    expect(hint('armed')).toEqual({ tone: 'good', text: 'Listening for “Hey Beekeeper”.' });
    expect(hint('loading')?.tone).toBe('info');
    expect(hint('paused')?.text).toMatch(/battery/);
    expect(hint('error', 'Model failed to load')).toEqual({
      tone: 'bad',
      text: 'Model failed to load',
    });
    expect(hint('error')?.text).toMatch(/couldn’t start/);
    expect(hint('off')).toBeNull();
  });

  it('says nothing when the wake word is off and the model is ready', () => {
    expect(describeWakeHint({ wakeWord: false, modelReady: true, worker: null })).toBeNull();
    expect(describeWakeHint({ wakeWord: true, modelReady: true, worker: null })).toBeNull();
  });
});

describe('describeModelCopy', () => {
  it('has a headline for every phase', () => {
    expect(describeModelCopy(null, false).headline).toMatch(/Checking/);
    const phases = [
      ['missing', 'Not downloaded yet'],
      ['downloading', 'Downloading…'],
      ['ready', 'Voice model ready'],
    ] as const;
    for (const [state, headline] of phases) {
      expect(describeModelCopy(describeModel(modelState({ state })), false).headline).toBe(
        headline,
      );
    }
    const verifying = describeModel(
      modelState({ state: 'downloading', receivedBytes: 41_184_862 }),
    );
    expect(describeModelCopy(verifying, false).headline).toBe('Checking the download…');
  });

  it('distinguishes a pause from an unfinished download and shows the percentage', () => {
    const partial = describeModel(modelState({ state: 'partial', receivedBytes: 20_592_431 }));
    expect(describeModelCopy(partial, true).headline).toBe('Paused');
    expect(describeModelCopy(partial, false).headline).toBe('Download not finished');
    expect(describeModelCopy(partial, true).detail).toMatch(/^50% is already on your PC/);
  });

  it('turns a server fragment into a sentence and promises that progress is kept', () => {
    const error = describeModel(modelState({ state: 'error', message: 'No internet connection' }));
    const copy = describeModelCopy(error, false);
    expect(copy.headline).toBe('The download didn’t finish');
    expect(copy.detail).toBe(
      'No internet connection. Your progress is kept — Retry continues where it stopped.',
    );
    const punctuated = describeModel(modelState({ state: 'error', message: 'Stopped…' }));
    expect(describeModelCopy(punctuated, false).detail).toMatch(/^Stopped… Your progress/);
    const bare = describeModel(modelState({ state: 'error' }));
    expect(describeModelCopy(bare, false).detail).toMatch(/^Your progress is kept/);
  });
});

describe('keyCapsFor', () => {
  it.each([
    ['Ctrl+Shift+Space', ['Ctrl', 'Shift', 'Space']],
    ['alt+shift+c', ['Alt', 'Shift', 'C']],
    ['Ctrl+Alt+Up', ['Ctrl', 'Alt', '↑']],
    ['Win+Escape', ['Win', 'Esc']],
    ['Ctrl+PageDown', ['Ctrl', 'PgDn']],
    ['not a shortcut', ['not a shortcut']],
    ['', []],
  ])('draws %s as %j', (accelerator, caps) => {
    expect(keyCapsFor(accelerator)).toEqual(caps);
  });

  it('speaks the shortcut as one phrase', () => {
    expect(describeShortcut('Ctrl+Shift+Space')).toBe('Ctrl + Shift + Space');
  });
});
