import type { Rect, Size } from '@shared/geometry';
import { clampCrop, aspectValue, fitAspect, fullCrop, isFullCrop, type AspectPreset } from './crop';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from './history';
import {
  EMPTY_EDIT,
  type BlurMode,
  type EditOp,
  type EditState,
  type EditTool,
  type NewOp,
  type StrokeStyle,
} from './types';

/** Colours of the brand palette, plus black and white. */
export const SWATCHES = ['#FFB300', '#FF5A5F', '#7C4DFF', '#00BCD4', '#000000', '#FFFFFF'] as const;
export const DEFAULT_STYLE: StrokeStyle = { color: '#FF5A5F', width: 6 };
export const STROKE_WIDTHS = { min: 2, max: 24 } as const;

export interface EditorState {
  history: History<EditState>;
  tool: EditTool;
  style: StrokeStyle;
  blurMode: BlurMode;
  aspect: AspectPreset;
  /** Id of the next op. */
  nextId: number;
}

export type EditorAction =
  | { type: 'tool'; tool: EditTool }
  | { type: 'color'; color: string }
  | { type: 'width'; width: number }
  | { type: 'blurMode'; mode: BlurMode }
  | { type: 'aspect'; preset: AspectPreset; size: Size }
  | { type: 'add'; op: NewOp }
  | { type: 'remove'; id: number }
  | { type: 'crop'; crop: Rect | null; size: Size }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export function createEditor(): EditorState {
  return {
    history: createHistory(EMPTY_EDIT),
    tool: 'pen',
    style: DEFAULT_STYLE,
    blurMode: 'pixelate',
    aspect: 'free',
    nextId: 1,
  };
}

export function currentEdit(state: EditorState): EditState {
  return state.history.present;
}

export function hasChanges(state: EditorState): boolean {
  const { ops, crop } = state.history.present;
  return ops.length > 0 || crop !== null;
}

export function canUndoEdit(state: EditorState): boolean {
  return canUndo(state.history);
}

export function canRedoEdit(state: EditorState): boolean {
  return canRedo(state.history);
}

function withEdit(
  state: EditorState,
  next: EditState,
  extra: Partial<EditorState> = {},
): EditorState {
  return { ...state, ...extra, history: commit(state.history, next) };
}

function sameCrop(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Every change of the editor (tool, colour, shapes, crop, undo...) as a pure function. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const edit = state.history.present;
  switch (action.type) {
    case 'tool':
      return { ...state, tool: action.tool };
    case 'color':
      return { ...state, style: { ...state.style, color: action.color } };
    case 'width':
      return {
        ...state,
        style: {
          ...state.style,
          width: Math.min(STROKE_WIDTHS.max, Math.max(STROKE_WIDTHS.min, Math.round(action.width))),
        },
      };
    case 'blurMode':
      return { ...state, blurMode: action.mode };
    case 'aspect': {
      const ratio = aspectValue(action.preset);
      const current = edit.crop ?? fullCrop(action.size);
      const next = ratio === null ? current : fitAspect(current, ratio, action.size);
      const crop = isFullCrop(next, action.size) ? null : next;
      return sameCrop(crop, edit.crop)
        ? { ...state, aspect: action.preset }
        : withEdit(state, { ...edit, crop }, { aspect: action.preset });
    }
    case 'add': {
      const op: EditOp = { ...action.op, id: state.nextId };
      return withEdit(state, { ...edit, ops: [...edit.ops, op] }, { nextId: state.nextId + 1 });
    }
    case 'remove':
      return edit.ops.some((op) => op.id === action.id)
        ? withEdit(state, { ...edit, ops: edit.ops.filter((op) => op.id !== action.id) })
        : state;
    case 'crop': {
      const next = action.crop ? clampCrop(action.crop, action.size) : null;
      const crop = isFullCrop(next, action.size) ? null : next;
      return sameCrop(crop, edit.crop) ? state : withEdit(state, { ...edit, crop });
    }
    case 'undo':
      return { ...state, history: undo(state.history) };
    case 'redo':
      return { ...state, history: redo(state.history) };
    case 'reset':
      return hasChanges(state)
        ? withEdit(state, EMPTY_EDIT, { aspect: 'free' })
        : { ...state, aspect: 'free' };
  }
}
