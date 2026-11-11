import {
  formatAccelerator,
  isTypingCombo,
  parseAccelerator,
  type CapturedKeys,
  type Modifier,
} from '@shared/hotkeys';
import type { HotkeySetResult } from '@shared/ipc/types';

export type RecorderState =
  | { phase: 'idle' }
  | { phase: 'recording'; held: readonly Modifier[]; hint: string | null }
  | { phase: 'saving'; accelerator: string }
  | {
      phase: 'failed';
      attempted: string;
      reason: 'invalid' | 'conflict' | 'reserved';
      message: string;
      suggestion: string | null;
    };

export type RecorderAction =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'keys'; keys: CapturedKeys }
  | { type: 'submit'; accelerator: string }
  | { type: 'result'; attempted: string; result: HotkeySetResult };

export const IDLE_RECORDER: RecorderState = { phase: 'idle' };

export const NEEDS_MODIFIER_HINT = 'Hold Ctrl, Alt, Shift or Win together with another key.';
export const TYPING_COMBO_HINT =
  'Shift with a letter or digit would get in the way of typing. Add Ctrl or Alt.';
const UNSUPPORTED_KEY_HINT = 'That key cannot be used in a shortcut. Try another one.';

/** Esc on its own cancels recording; with a modifier it is just an unsupported key. */
export function isCancelKey(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): boolean {
  return (
    event.code === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
  );
}

function afterKeys(
  state: Extract<RecorderState, { phase: 'recording' }>,
  keys: CapturedKeys,
): RecorderState {
  // Releasing or pressing a modifier only updates the live preview; a hint stays until the next try.
  if (keys.key === null) return { phase: 'recording', held: keys.modifiers, hint: state.hint };
  if (keys.modifiers.length === 0) {
    return { phase: 'recording', held: [], hint: NEEDS_MODIFIER_HINT };
  }
  const parsed = parseAccelerator([...keys.modifiers, keys.key].join('+'));
  if (!parsed) return { phase: 'recording', held: keys.modifiers, hint: UNSUPPORTED_KEY_HINT };
  if (isTypingCombo(parsed)) {
    return { phase: 'recording', held: keys.modifiers, hint: TYPING_COMBO_HINT };
  }
  return { phase: 'saving', accelerator: formatAccelerator(parsed) };
}

function afterResult(
  state: RecorderState,
  action: Extract<RecorderAction, { type: 'result' }>,
): RecorderState {
  if (state.phase !== 'saving') return state;
  const { result, attempted } = action;
  if (result.ok) return IDLE_RECORDER;
  return {
    phase: 'failed',
    attempted,
    reason: result.reason,
    message: result.message,
    suggestion: result.suggestion ?? null,
  };
}

/**
 * State machine behind "Change shortcut": idle -> recording (live modifier preview) -> saving
 * (once a valid combination was pressed) -> idle or failed (conflict / reserved / invalid).
 */
export function reduceRecorder(state: RecorderState, action: RecorderAction): RecorderState {
  switch (action.type) {
    case 'start':
      return state.phase === 'saving' ? state : { phase: 'recording', held: [], hint: null };
    case 'cancel':
      return state.phase === 'saving' ? state : IDLE_RECORDER;
    case 'keys':
      return state.phase === 'recording' ? afterKeys(state, action.keys) : state;
    case 'submit':
      return state.phase === 'saving'
        ? state
        : { phase: 'saving', accelerator: action.accelerator };
    case 'result':
      return afterResult(state, action);
  }
}
