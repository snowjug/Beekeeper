import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  MAX_HISTORY,
  redo,
  undo,
} from '@renderer/studio/edit/history';

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistory('a');
    expect(history.present).toBe('a');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('commits steps, undoes and redoes them in order', () => {
    let history = createHistory('a');
    history = commit(history, 'b');
    history = commit(history, 'c');
    expect(history.present).toBe('c');
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.present).toBe('b');
    expect(canRedo(history)).toBe(true);
    history = undo(history);
    expect(history.present).toBe('a');
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    history = redo(history);
    expect(history.present).toBe('c');
    expect(canRedo(history)).toBe(false);
  });

  it('forgets the redo steps when something new is committed', () => {
    let history = commit(commit(createHistory('a'), 'b'), 'c');
    history = undo(history);
    history = commit(history, 'd');
    expect(history.present).toBe('d');
    expect(canRedo(history)).toBe(false);
    expect(history.past).toEqual(['a', 'b']);
  });

  it('does not make a step of a value that did not change', () => {
    const history = createHistory({ n: 1 });
    expect(commit(history, history.present)).toBe(history);
  });

  it('ignores undo and redo when there is nothing to go back or forward to', () => {
    const history = createHistory('a');
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('keeps only the newest steps', () => {
    let history = createHistory(0);
    for (let index = 1; index <= MAX_HISTORY + 20; index += 1) history = commit(history, index);
    expect(history.past).toHaveLength(MAX_HISTORY);
    expect(history.past[0]).toBe(20);
    expect(history.present).toBe(MAX_HISTORY + 20);
  });

  it('never changes the value it was given', () => {
    const history = createHistory('a');
    const next = commit(history, 'b');
    expect(history).toEqual({ past: [], present: 'a', future: [] });
    undo(next);
    expect(next.present).toBe('b');
  });
});
