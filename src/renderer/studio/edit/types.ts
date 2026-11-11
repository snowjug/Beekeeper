import type { Point, Rect } from '@shared/geometry';

/** Tools that add a shape to the picture. */
export type DrawTool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'blur';
export type EditTool = DrawTool | 'crop' | 'eraser';

export type BlurMode = 'pixelate' | 'blur';

interface Base {
  /** Unique within one editing session. */
  id: number;
}

/** Everything is in image pixels, so the result does not depend on how the picture is shown. */
export interface PenOp extends Base {
  kind: 'pen';
  points: Point[];
  color: string;
  width: number;
}

export interface HighlighterOp extends Base {
  kind: 'highlighter';
  points: Point[];
  color: string;
  width: number;
}

export interface ArrowOp extends Base {
  kind: 'arrow';
  from: Point;
  to: Point;
  color: string;
  width: number;
}

export interface RectOp extends Base {
  kind: 'rect';
  rect: Rect;
  color: string;
  width: number;
}

export interface EllipseOp extends Base {
  kind: 'ellipse';
  rect: Rect;
  color: string;
  width: number;
}

export interface TextOp extends Base {
  kind: 'text';
  /** Top-left corner of the first line. */
  at: Point;
  text: string;
  color: string;
  /** Font size in image pixels. */
  size: number;
}

export interface BlurOp extends Base {
  kind: 'blur';
  rect: Rect;
  mode: BlurMode;
}

export type EditOp = PenOp | HighlighterOp | ArrowOp | RectOp | EllipseOp | TextOp | BlurOp;

/** An op before it gets its id. */
export type NewOp =
  | Omit<PenOp, 'id'>
  | Omit<HighlighterOp, 'id'>
  | Omit<ArrowOp, 'id'>
  | Omit<RectOp, 'id'>
  | Omit<EllipseOp, 'id'>
  | Omit<TextOp, 'id'>
  | Omit<BlurOp, 'id'>;

/** The document being edited: shapes drawn on top of the picture, and the part that is kept. */
export interface EditState {
  readonly ops: readonly EditOp[];
  /** The kept part of the picture (image pixels), or null for all of it. */
  readonly crop: Rect | null;
}

export const EMPTY_EDIT: EditState = { ops: [], crop: null };

export interface StrokeStyle {
  color: string;
  /** Line width in image pixels. */
  width: number;
}
