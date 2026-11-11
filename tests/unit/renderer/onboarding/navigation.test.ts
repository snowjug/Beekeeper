import { describe, expect, it } from 'vitest';
import {
  INITIAL_NAV,
  navReducer,
  STEP_COUNT,
  STEPS,
  stepAnnouncement,
  stepAt,
  stepProgressLabel,
  type NavState,
} from '@renderer/onboarding/navigation';

function walk(start: NavState, action: 'next' | 'back', times: number): NavState {
  let state = start;
  for (let i = 0; i < times; i += 1) state = navReducer(state, { type: action });
  return state;
}

describe('navReducer', () => {
  it('walks forward through the five screens and sets the direction', () => {
    const visited: string[] = [STEPS[0].id];
    let state = INITIAL_NAV;
    for (let i = 1; i < STEP_COUNT; i += 1) {
      state = navReducer(state, { type: 'next' });
      expect(state.direction).toBe(1);
      visited.push(stepAt(state.index).id);
    }
    expect(visited).toEqual(['welcome', 'microphone', 'model', 'hotkeys', 'done']);
  });

  it('stops at the last screen without creating a new state', () => {
    const last = walk(INITIAL_NAV, 'next', STEP_COUNT - 1);
    expect(last.index).toBe(STEP_COUNT - 1);
    expect(navReducer(last, { type: 'next' })).toBe(last);
    expect(walk(INITIAL_NAV, 'next', 50).index).toBe(STEP_COUNT - 1);
  });

  it('goes back with a reversed direction and stops at the first screen', () => {
    const middle = walk(INITIAL_NAV, 'next', 2);
    const back = navReducer(middle, { type: 'back' });
    expect(back).toEqual({ index: 1, direction: -1 });
    expect(navReducer(INITIAL_NAV, { type: 'back' })).toBe(INITIAL_NAV);
    expect(walk(middle, 'back', 10).index).toBe(0);
  });

  it('flips the direction when the user changes their mind', () => {
    const forward = navReducer(INITIAL_NAV, { type: 'next' });
    const backward = navReducer(forward, { type: 'back' });
    const again = navReducer(backward, { type: 'next' });
    expect([forward.direction, backward.direction, again.direction]).toEqual([1, -1, 1]);
  });
});

describe('step labels', () => {
  it.each([
    [0, 'Step 1 of 5', 'Step 1 of 5: Welcome'],
    [1, 'Step 2 of 5', 'Step 2 of 5: Microphone'],
    [2, 'Step 3 of 5', 'Step 3 of 5: Voice model'],
    [3, 'Step 4 of 5', 'Step 4 of 5: Hotkeys & wake word'],
    [4, 'Step 5 of 5', 'Step 5 of 5: All set'],
  ])('describes index %i', (index, label, announcement) => {
    expect(stepProgressLabel(index)).toBe(label);
    expect(stepAnnouncement(index)).toBe(announcement);
  });

  it('clamps out-of-range indexes', () => {
    expect(stepAt(-3).id).toBe('welcome');
    expect(stepAt(99).id).toBe('done');
    expect(stepProgressLabel(99)).toBe('Step 5 of 5');
  });
});
