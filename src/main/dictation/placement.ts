export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PillPlacement {
  /** Size of the pill window in DIPs. */
  size: { width: number; height: number };
  /** Work area of the display that holds the target window (DIPs). */
  work: Box;
  /** Text caret of the target app in DIPs, when it has one. */
  caret?: Box | null;
}

/** The window has a transparent margin around the visible pill (for its shadow). */
const WINDOW_INSET = 10;
const CARET_GAP = 14;
const EDGE_MARGIN = 8;
const BOTTOM_MARGIN = 28;
/** The pill starts a little left of the caret so that its mic button sits under the text. */
const CARET_LEFT_SHIFT = 40;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Where the pill goes: just below the text caret (above it when there is no room), else centred
 * at the bottom of the display, the way the assistant bar appears.
 */
export function computePillBounds({ size, work, caret }: PillPlacement): Box {
  const left = work.x + EDGE_MARGIN;
  const right = work.x + work.width - size.width - EDGE_MARGIN;
  const bottom = work.y + work.height - EDGE_MARGIN;
  const top = work.y + EDGE_MARGIN;

  const centred: Box = {
    x: Math.round(clamp(work.x + (work.width - size.width) / 2, left, Math.max(left, right))),
    y: Math.round(work.y + work.height - size.height - BOTTOM_MARGIN),
    width: size.width,
    height: size.height,
  };
  if (!caret) return centred;

  const x = Math.round(clamp(caret.x - CARET_LEFT_SHIFT, left, Math.max(left, right)));
  const below = caret.y + caret.height + CARET_GAP - WINDOW_INSET;
  if (below + size.height <= bottom) {
    return { x, y: Math.round(below), width: size.width, height: size.height };
  }
  const above = caret.y - CARET_GAP - size.height + WINDOW_INSET;
  if (above >= top) return { x, y: Math.round(above), width: size.width, height: size.height };
  return centred;
}
