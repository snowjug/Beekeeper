import { describe, expect, it } from 'vitest';
import { captureAccelerator } from '@shared/hotkeys';
import {
  IDLE_RECORDER,
  isCancelKey,
  NEEDS_MODIFIER_HINT,
  reduceRecorder,
  TYPING_COMBO_HINT,
  type RecorderAction,
  type RecorderState,
} from '@renderer/settings/lib/hotkeyRecorder';

const keys = (
  code: string,
  mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
): RecorderAction => ({
  type: 'keys',
  keys: captureAccelerator({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  }),
});

function run(actions: RecorderAction[], from: RecorderState = IDLE_RECORDER): RecorderState {
  return actions.reduce(reduceRecorder, from);
}

describe('hotkey recorder state machine', () => {
  it('shows the held modifiers live while recording', () => {
    expect(run([{ type: 'start' }])).toEqual({ phase: 'recording', held: [], hint: null });
    expect(run([{ type: 'start' }, keys('ControlLeft', { ctrlKey: true })])).toEqual({
      phase: 'recording',
      held: ['Ctrl'],
      hint: null,
    });
    expect(
      run([
        { type: 'start' },
        keys('ControlLeft', { ctrlKey: true }),
        keys('ShiftLeft', { ctrlKey: true, shiftKey: true }),
      ]),
    ).toMatchObject({ held: ['Ctrl', 'Shift'] });
  });

  it('submits as soon as a modifier and a key are pressed (canonical spelling)', () => {
    const state = run([{ type: 'start' }, keys('KeyK', { ctrlKey: true, altKey: true })]);
    expect(state).toEqual({ phase: 'saving', accelerator: 'Ctrl+Alt+K' });
    expect(run([{ type: 'start' }, keys('Space', { shiftKey: true, ctrlKey: true })])).toEqual({
      phase: 'saving',
      accelerator: 'Ctrl+Shift+Space',
    });
  });

  it('requires at least one modifier, and keeps the hint while modifiers come and go', () => {
    const hinted = run([{ type: 'start' }, keys('KeyK')]);
    expect(hinted).toEqual({ phase: 'recording', held: [], hint: NEEDS_MODIFIER_HINT });
    expect(run([keys('ControlLeft', { ctrlKey: true })], hinted)).toEqual({
      phase: 'recording',
      held: ['Ctrl'],
      hint: NEEDS_MODIFIER_HINT,
    });
  });

  it('rejects typing combinations such as Shift+A', () => {
    expect(run([{ type: 'start' }, keys('KeyA', { shiftKey: true })])).toEqual({
      phase: 'recording',
      held: ['Shift'],
      hint: TYPING_COMBO_HINT,
    });
    // Shift plus a function key is fine.
    expect(run([{ type: 'start' }, keys('F9', { shiftKey: true })])).toMatchObject({
      phase: 'saving',
    });
  });

  it('ignores keys that are not part of a shortcut and keys while not recording', () => {
    expect(run([{ type: 'start' }, keys('CapsLock')])).toMatchObject({
      phase: 'recording',
      held: [],
    });
    expect(run([keys('KeyK', { ctrlKey: true })])).toEqual(IDLE_RECORDER);
  });

  it('goes back to idle after success and keeps the details after a failure', () => {
    const saving = run([{ type: 'start' }, keys('KeyK', { ctrlKey: true })]);
    expect(
      reduceRecorder(saving, {
        type: 'result',
        attempted: 'Ctrl+K',
        result: { ok: true, accelerator: 'Ctrl+K' },
      }),
    ).toEqual(IDLE_RECORDER);

    expect(
      reduceRecorder(saving, {
        type: 'result',
        attempted: 'Ctrl+K',
        result: {
          ok: false,
          reason: 'conflict',
          message: 'Taken. Try Ctrl+Alt+K.',
          suggestion: 'Ctrl+Alt+K',
        },
      }),
    ).toEqual({
      phase: 'failed',
      attempted: 'Ctrl+K',
      reason: 'conflict',
      message: 'Taken. Try Ctrl+Alt+K.',
      suggestion: 'Ctrl+Alt+K',
    });
    expect(
      reduceRecorder(saving, {
        type: 'result',
        attempted: 'Ctrl+K',
        result: { ok: false, reason: 'reserved', message: 'Reserved' },
      }),
    ).toMatchObject({ phase: 'failed', reason: 'reserved', suggestion: null });
  });

  it('ignores a result that nobody is waiting for', () => {
    const state = reduceRecorder(IDLE_RECORDER, {
      type: 'result',
      attempted: 'Ctrl+K',
      result: { ok: false, reason: 'invalid', message: 'x' },
    });
    expect(state).toEqual(IDLE_RECORDER);
  });

  it('cancels, restarts after a failure and never interrupts a save in progress', () => {
    expect(run([{ type: 'start' }, { type: 'cancel' }])).toEqual(IDLE_RECORDER);
    const failed = run([
      { type: 'submit', accelerator: 'Ctrl+K' },
      {
        type: 'result',
        attempted: 'Ctrl+K',
        result: { ok: false, reason: 'invalid', message: 'no' },
      },
    ]);
    expect(run([{ type: 'start' }], failed)).toMatchObject({ phase: 'recording' });
    expect(run([{ type: 'cancel' }], failed)).toEqual(IDLE_RECORDER);

    const saving: RecorderState = { phase: 'saving', accelerator: 'Ctrl+K' };
    expect(run([{ type: 'start' }], saving)).toBe(saving);
    expect(run([{ type: 'cancel' }], saving)).toBe(saving);
    expect(run([{ type: 'submit', accelerator: 'Ctrl+J' }], saving)).toBe(saving);
  });
});

describe('isCancelKey', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  it('is a bare Escape only', () => {
    expect(isCancelKey({ ...base, code: 'Escape' })).toBe(true);
    expect(isCancelKey({ ...base, code: 'Escape', ctrlKey: true })).toBe(false);
    expect(isCancelKey({ ...base, code: 'KeyK' })).toBe(false);
  });
});
