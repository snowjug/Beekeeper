/**
 * The five onboarding screens (spec 4.6; v1.1 turned the voice-model screen into "Language & voice")
 * and the pure state machine that moves between them.
 */
export const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'language', title: 'Language & voice' },
  { id: 'microphone', title: 'Microphone' },
  { id: 'hotkeys', title: 'Hotkeys & wake word' },
  { id: 'done', title: 'All set' },
] as const;

export type Step = (typeof STEPS)[number];
export type StepId = Step['id'];

export const STEP_COUNT = STEPS.length;

/** 1 = forward (the next screen slides in from the right), -1 = backward. */
export type Direction = 1 | -1;

export interface NavState {
  index: number;
  direction: Direction;
}

export type NavAction = { type: 'next' } | { type: 'back' };

export const INITIAL_NAV: NavState = { index: 0, direction: 1 };

/** Moves one step; at either end the very same state object is returned so React bails out. */
export function navReducer(state: NavState, action: NavAction): NavState {
  if (action.type === 'next') {
    return state.index >= STEP_COUNT - 1 ? state : { index: state.index + 1, direction: 1 };
  }
  return state.index <= 0 ? state : { index: state.index - 1, direction: -1 };
}

function clampIndex(index: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), STEP_COUNT - 1);
}

export function stepAt(index: number): Step {
  return STEPS[clampIndex(index)] ?? STEPS[0];
}

/** "Step 2 of 5" - the accessible name of the progress indicator. */
export function stepProgressLabel(index: number): string {
  return `Step ${clampIndex(index) + 1} of ${STEP_COUNT}`;
}

/** "Step 2 of 5: Microphone" - spoken through the live region when the screen changes. */
export function stepAnnouncement(index: number): string {
  return `${stepProgressLabel(index)}: ${stepAt(index).title}`;
}
