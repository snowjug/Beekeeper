/** Paints the picture and its edits onto a canvas, at any scale: the preview and the saved PNG use the same code. */
import { expandRect, normalizeRect, type Point, type Rect } from '@shared/geometry';
import { arrowHead, HIGHLIGHTER_FACTOR } from './shapes';
import type { EditOp, EditState } from './types';

const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const TEXT_LINE_HEIGHT = 1.25;
const HIGHLIGHTER_ALPHA = 0.5;

/** Creates the temporary canvas that blur and pixelate copy a region into. */
export type ScratchFactory = (width: number, height: number) => HTMLCanvasElement;

export function createScratchCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Black or white with some see-through, whichever stays readable around text of `color`. */
export function haloColor(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return 'rgba(0, 0, 0, 0.75)';
  const [red, green, blue] = [match[1], match[2], match[3]].map((part) =>
    parseInt(part ?? '0', 16),
  );
  const luminance = (0.299 * (red ?? 0) + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0)) / 255;
  return luminance > 0.6 ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)';
}

/** Size of the blocks a pixelated region is made of (image pixels): large enough to make text unreadable. */
export function pixelBlock(rect: Rect): number {
  return Math.max(10, Math.round(Math.min(rect.width, rect.height) / 2.2));
}

/** Radius of a blurred region. */
export function blurRadius(rect: Rect): number {
  return Math.max(8, Math.round(Math.min(rect.width, rect.height) / 3));
}

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  const first = points[0];
  ctx.beginPath();
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  const last = points[points.length - 1];
  if (!last || points.length === 1) {
    // A tap leaves a dot.
    ctx.lineTo(first.x + 0.01, first.y);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (point && next) {
      ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
  }
  ctx.lineTo(last.x, last.y);
}

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Copies `rect` (image pixels) of what is on the canvas so far into a scratch canvas of `width` x `height`. */
function copyRegion(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  width: number,
  height: number,
  scratch: ScratchFactory,
): HTMLCanvasElement | null {
  const matrix = ctx.getTransform();
  const target = scratch(width, height);
  const inner = target.getContext('2d');
  if (!inner) return null;
  inner.imageSmoothingEnabled = true;
  inner.imageSmoothingQuality = 'high';
  inner.drawImage(
    ctx.canvas,
    rect.x * matrix.a + matrix.e,
    rect.y * matrix.d + matrix.f,
    rect.width * matrix.a,
    rect.height * matrix.d,
    0,
    0,
    target.width,
    target.height,
  );
  return target;
}

function pixelate(ctx: CanvasRenderingContext2D, rect: Rect, scratch: ScratchFactory): void {
  const block = pixelBlock(rect);
  const small = copyRegion(
    ctx,
    rect,
    Math.max(1, Math.round(rect.width / block)),
    Math.max(1, Math.round(rect.height / block)),
    scratch,
  );
  if (!small) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function blur(ctx: CanvasRenderingContext2D, rect: Rect, scratch: ScratchFactory): void {
  const radius = blurRadius(rect);
  const matrix = ctx.getTransform();
  // The blur reads past the edges of the region, or its border would fade into what is underneath.
  const area = expandRect(rect, radius * 3);
  const copy = copyRegion(
    ctx,
    area,
    Math.max(1, Math.round(area.width * matrix.a)),
    Math.max(1, Math.round(area.height * matrix.d)),
    scratch,
  );
  if (!copy) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.filter = `blur(${radius * matrix.a}px)`;
  ctx.drawImage(copy, area.x, area.y, area.width, area.height);
  ctx.restore();
}

/** Draws one shape. Regions are blurred or pixelated from what is on the canvas at that moment. */
export function paintOp(ctx: CanvasRenderingContext2D, op: EditOp, scratch: ScratchFactory): void {
  ctx.save();
  switch (op.kind) {
    case 'pen':
      stroke(ctx, op.color, op.width);
      tracePath(ctx, op.points);
      ctx.stroke();
      break;
    case 'highlighter':
      stroke(ctx, op.color, op.width * HIGHLIGHTER_FACTOR);
      ctx.globalAlpha = HIGHLIGHTER_ALPHA;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineCap = 'butt';
      tracePath(ctx, op.points);
      ctx.stroke();
      break;
    case 'arrow': {
      const head = arrowHead(op.from, op.to, op.width);
      stroke(ctx, op.color, op.width);
      ctx.beginPath();
      ctx.moveTo(op.from.x, op.from.y);
      ctx.lineTo(head.base.x, head.base.y);
      ctx.stroke();
      ctx.fillStyle = op.color;
      ctx.beginPath();
      ctx.moveTo(head.tip.x, head.tip.y);
      ctx.lineTo(head.left.x, head.left.y);
      ctx.lineTo(head.right.x, head.right.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'rect': {
      const { x, y, width, height } = normalizeRect(op.rect);
      stroke(ctx, op.color, op.width);
      ctx.strokeRect(x, y, width, height);
      break;
    }
    case 'ellipse': {
      const { x, y, width, height } = normalizeRect(op.rect);
      stroke(ctx, op.color, op.width);
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.font = `600 ${op.size}px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, op.size / 7);
      ctx.strokeStyle = haloColor(op.color);
      ctx.fillStyle = op.color;
      op.text.split('\n').forEach((line, index) => {
        const y = op.at.y + index * op.size * TEXT_LINE_HEIGHT;
        ctx.strokeText(line, op.at.x, y);
        ctx.fillText(line, op.at.x, y);
      });
      break;
    }
    case 'blur': {
      const rect = normalizeRect(op.rect);
      if (op.mode === 'blur') blur(ctx, rect, scratch);
      else pixelate(ctx, rect, scratch);
      break;
    }
  }
  ctx.restore();
}

/**
 * Draws the part `view` (image pixels) of the picture with its edits, `scale` canvas pixels per
 * image pixel. `source` is the unedited picture.
 */
export function paintEdit(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  state: EditState,
  view: Rect,
  scale: number,
  scratch: ScratchFactory = createScratchCanvas,
): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0);
  for (const op of state.ops) paintOp(ctx, op, scratch);
  ctx.restore();
}
