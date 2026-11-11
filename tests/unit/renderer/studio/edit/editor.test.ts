import { describe, expect, it } from 'vitest';
import {
  canRedoEdit,
  canUndoEdit,
  createEditor,
  currentEdit,
  DEFAULT_STYLE,
  editorReducer,
  hasChanges,
  STROKE_WIDTHS,
  type EditorAction,
  type EditorState,
} from '@renderer/studio/edit/editor';
import {
  activeBoxes,
  boxesFromRegions,
  redactionOps,
  removeBox,
  toggleBox,
} from '@renderer/studio/edit/redaction';
import { fitImage } from '@renderer/studio/layout';
import { outputSize } from '@renderer/studio/edit/flatten';

const IMAGE = { width: 1000, height: 600 };

function run(...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, createEditor());
}

const rectOp = {
  kind: 'rect',
  rect: { x: 10, y: 10, width: 50, height: 40 },
  color: '#ff0000',
  width: 4,
} as const;

describe('editor reducer', () => {
  it('starts empty with the pen, a coral colour and nothing to undo', () => {
    const state = createEditor();
    expect(state.tool).toBe('pen');
    expect(state.style).toEqual(DEFAULT_STYLE);
    expect(hasChanges(state)).toBe(false);
    expect(canUndoEdit(state)).toBe(false);
    expect(canRedoEdit(state)).toBe(false);
  });

  it('changes the tool, the colour and the width without making an undo step', () => {
    const state = run(
      { type: 'tool', tool: 'arrow' },
      { type: 'color', color: '#7C4DFF' },
      { type: 'width', width: 10 },
      { type: 'blurMode', mode: 'blur' },
    );
    expect(state).toMatchObject({
      tool: 'arrow',
      style: { color: '#7C4DFF', width: 10 },
      blurMode: 'blur',
    });
    expect(canUndoEdit(state)).toBe(false);
  });

  it('keeps the stroke width within its range and rounds it', () => {
    expect(run({ type: 'width', width: 1 }).style.width).toBe(STROKE_WIDTHS.min);
    expect(run({ type: 'width', width: 500 }).style.width).toBe(STROKE_WIDTHS.max);
    expect(run({ type: 'width', width: 7.6 }).style.width).toBe(8);
  });

  it('adds shapes with increasing ids', () => {
    const state = run({ type: 'add', op: rectOp }, { type: 'add', op: rectOp });
    expect(currentEdit(state).ops.map((op) => op.id)).toEqual([1, 2]);
    expect(state.nextId).toBe(3);
    expect(hasChanges(state)).toBe(true);
  });

  it('undoes and redoes shapes', () => {
    let state = run({ type: 'add', op: rectOp }, { type: 'add', op: rectOp });
    state = editorReducer(state, { type: 'undo' });
    expect(currentEdit(state).ops).toHaveLength(1);
    expect(canRedoEdit(state)).toBe(true);
    state = editorReducer(state, { type: 'undo' });
    expect(currentEdit(state).ops).toHaveLength(0);
    expect(canUndoEdit(state)).toBe(false);
    state = editorReducer(state, { type: 'redo' });
    state = editorReducer(state, { type: 'redo' });
    expect(currentEdit(state).ops.map((op) => op.id)).toEqual([1, 2]);
    // A new shape after an undo takes the redo steps away, and gets a fresh id.
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'add', op: rectOp });
    expect(canRedoEdit(state)).toBe(false);
    expect(currentEdit(state).ops.map((op) => op.id)).toEqual([1, 3]);
  });

  it('removes a shape by id, and does nothing for an unknown id', () => {
    const state = run({ type: 'add', op: rectOp }, { type: 'add', op: rectOp });
    const removed = editorReducer(state, { type: 'remove', id: 1 });
    expect(currentEdit(removed).ops.map((op) => op.id)).toEqual([2]);
    expect(editorReducer(removed, { type: 'remove', id: 99 })).toBe(removed);
    expect(editorReducer(removed, { type: 'undo' }).history.present.ops).toHaveLength(2);
  });

  it('sets the crop inside the image and treats the whole image as no crop', () => {
    const state = run({
      type: 'crop',
      crop: { x: -10, y: 20, width: 300, height: 200 },
      size: IMAGE,
    });
    expect(currentEdit(state).crop).toEqual({ x: 0, y: 20, width: 300, height: 200 });
    const whole = editorReducer(state, {
      type: 'crop',
      crop: { x: 0, y: 0, width: 1000, height: 600 },
      size: IMAGE,
    });
    expect(currentEdit(whole).crop).toBeNull();
    expect(editorReducer(whole, { type: 'crop', crop: null, size: IMAGE })).toBe(whole);
  });

  it('does not make a step of a crop that did not change', () => {
    const crop = { x: 10, y: 10, width: 300, height: 200 };
    const state = run({ type: 'crop', crop, size: IMAGE });
    expect(editorReducer(state, { type: 'crop', crop: { ...crop }, size: IMAGE })).toBe(state);
  });

  it('applies an aspect preset to the crop', () => {
    const square = run({ type: 'aspect', preset: '1:1', size: IMAGE });
    expect(square.aspect).toBe('1:1');
    expect(currentEdit(square).crop).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    const free = editorReducer(square, { type: 'aspect', preset: 'free', size: IMAGE });
    expect(free.aspect).toBe('free');
    expect(currentEdit(free).crop).toEqual({ x: 200, y: 0, width: 600, height: 600 });
  });

  it('keeps a free preset on a picture without a crop as no crop', () => {
    const state = run({ type: 'aspect', preset: 'free', size: IMAGE });
    expect(currentEdit(state).crop).toBeNull();
    expect(canUndoEdit(state)).toBe(false);
  });

  it('resets everything as one undoable step', () => {
    let state = run(
      { type: 'add', op: rectOp },
      { type: 'crop', crop: { x: 0, y: 0, width: 300, height: 200 }, size: IMAGE },
    );
    state = editorReducer(state, { type: 'reset' });
    expect(hasChanges(state)).toBe(false);
    expect(state.aspect).toBe('free');
    state = editorReducer(state, { type: 'undo' });
    expect(currentEdit(state).ops).toHaveLength(1);
    expect(currentEdit(state).crop).not.toBeNull();
  });

  it('does not make a step of resetting an untouched picture', () => {
    const state = createEditor();
    expect(canUndoEdit(editorReducer(state, { type: 'reset' }))).toBe(false);
  });
});

describe('outputSize', () => {
  it('is the crop, or the whole picture', () => {
    expect(outputSize(IMAGE, { ops: [], crop: null })).toEqual(IMAGE);
    expect(outputSize(IMAGE, { ops: [], crop: { x: 5, y: 5, width: 300, height: 200 } })).toEqual({
      width: 300,
      height: 200,
    });
  });
});

describe('redaction boxes', () => {
  const regions = [
    { rect: { x: 10, y: 20, width: 100, height: 24 }, kind: 'email', label: 'Email address' },
    { rect: { x: 900, y: 500, width: 300, height: 200 }, kind: 'card', label: 'Card number' },
    { rect: { x: 2000, y: 2000, width: 10, height: 10 }, kind: 'phone', label: 'Phone number' },
  ] as const;

  it('makes a selected box of every region, inside the image, and drops regions outside it', () => {
    const boxes = boxesFromRegions(regions, IMAGE);
    expect(boxes.map((box) => box.id)).toEqual(['box-0', 'box-1']);
    expect(boxes.every((box) => box.active)).toBe(true);
    expect(boxes[1]?.rect).toEqual({ x: 900, y: 500, width: 100, height: 100 });
  });

  it('toggles and removes boxes by id', () => {
    const boxes = boxesFromRegions(regions, IMAGE);
    const toggled = toggleBox(boxes, 'box-0');
    expect(toggled.map((box) => box.active)).toEqual([false, true]);
    expect(toggleBox(toggled, 'box-0').map((box) => box.active)).toEqual([true, true]);
    expect(removeBox(boxes, 'box-1').map((box) => box.id)).toEqual(['box-0']);
    expect(activeBoxes(toggled).map((box) => box.id)).toEqual(['box-1']);
  });

  it('turns the selected boxes into pixelate shapes with fresh ids', () => {
    const boxes = toggleBox(boxesFromRegions(regions, IMAGE), 'box-0');
    expect(redactionOps(boxes, 7)).toEqual([
      { id: 7, kind: 'blur', mode: 'pixelate', rect: { x: 900, y: 500, width: 100, height: 100 } },
    ]);
    expect(redactionOps([], 1)).toEqual([]);
  });
});

describe('fitImage', () => {
  const screen = { width: 1920, height: 1040 };

  it('shows a screenshot at most 78 % of the width and 72 % of the height', () => {
    const fit = fitImage({ width: 1920, height: 1080 }, screen);
    expect(fit.width).toBeLessThanOrEqual(1920 * 0.78);
    expect(fit.height).toBeLessThanOrEqual(1040 * 0.72);
    expect(fit.width / fit.height).toBeCloseTo(1920 / 1080, 1);
    expect(fit.scale).toBeCloseTo(fit.width / 1920, 3);
    // The height is the limit here.
    expect(fit.height).toBe(Math.floor(1040 * 0.72));
  });

  it('is limited by the width of a wide picture', () => {
    const fit = fitImage({ width: 4000, height: 500 }, screen);
    expect(fit.width).toBe(Math.floor(1920 * 0.78));
  });

  it('never enlarges a small picture', () => {
    expect(fitImage({ width: 300, height: 200 }, screen)).toEqual({
      width: 300,
      height: 200,
      scale: 1,
    });
  });

  it('shows native pixels at the size they have on a scaled display', () => {
    const fit = fitImage({ width: 300, height: 200 }, screen, { scaleFactor: 2 });
    expect(fit).toEqual({ width: 150, height: 100, scale: 0.5 });
  });

  it('leaves room for the toolbars', () => {
    const tall = fitImage({ width: 800, height: 2000 }, screen, {
      reserveTop: 200,
      reserveBottom: 200,
    });
    expect(tall.height).toBe(640);
    const plain = fitImage({ width: 800, height: 2000 }, screen);
    expect(plain.height).toBe(Math.floor(1040 * 0.72));
  });

  it('survives an empty window or picture', () => {
    expect(fitImage({ width: 0, height: 0 }, { width: 0, height: 0 }).width).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      fitImage({ width: 100, height: 100 }, { width: 0, height: 0 }, { scaleFactor: 0 }).height,
    ).toBeGreaterThanOrEqual(1);
  });
});
