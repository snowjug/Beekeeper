import { describe, expect, it } from 'vitest';
import {
  blurRadius,
  haloColor,
  paintEdit,
  paintOp,
  pixelBlock,
  type ScratchFactory,
} from '@renderer/studio/edit/draw';
import type { EditOp } from '@renderer/studio/edit/types';

interface Recorder {
  context: CanvasRenderingContext2D;
  log: string[];
  scratches: Array<{ width: number; height: number; log: string[] }>;
  scratch: ScratchFactory;
}

function format(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (typeof value === 'object' && value !== null) return '[canvas]';
  return String(value);
}

/** A 2-D context that writes down every call and every property it is given. */
function recorder(canvasSize = { width: 400, height: 300 }): Recorder {
  const log: string[] = [];
  const scratches: Recorder['scratches'] = [];
  let matrix = { a: 1, d: 1, e: 0, f: 0 };

  const proxy = (target: { log: string[]; canvas: object }): CanvasRenderingContext2D =>
    new Proxy(
      {},
      {
        get(_object, name: string) {
          if (name === 'canvas') return target.canvas;
          if (name === 'getTransform') return () => matrix;
          if (name === 'setTransform') {
            return (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
              matrix = { a, d, e, f };
              target.log.push(`setTransform(${format(a)},${format(d)},${format(e)},${format(f)})`);
            };
          }
          return (...args: unknown[]) => {
            target.log.push(`${name}(${args.map(format).join(',')})`);
          };
        },
        set(_object, name: string, value: unknown) {
          target.log.push(`${name}=${format(value)}`);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;

  const scratch: ScratchFactory = (width, height) => {
    const entry = { width, height, log: [] as string[] };
    scratches.push(entry);
    const inner = proxy({ log: entry.log, canvas: {} });
    return { width, height, getContext: () => inner } as unknown as HTMLCanvasElement;
  };
  return { context: proxy({ log, canvas: canvasSize }), log, scratches, scratch };
}

describe('paintEdit', () => {
  it('draws the picture with the view at the origin, scaled to the canvas', () => {
    const { context, log, scratch } = recorder();
    paintEdit(
      context,
      {} as CanvasImageSource,
      { ops: [], crop: null },
      { x: 100, y: 50, width: 200, height: 100 },
      2,
      scratch,
    );
    expect(log[0]).toBe('save()');
    expect(log).toContain('setTransform(2,2,-200,-100)');
    expect(log).toContain('drawImage([canvas],0,0)');
    expect(log.at(-1)).toBe('restore()');
  });

  it('paints the shapes in the order they were drawn, each between save and restore', () => {
    const { context, log, scratch } = recorder();
    const ops: EditOp[] = [
      { id: 1, kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 }, color: '#f00', width: 3 },
      {
        id: 2,
        kind: 'ellipse',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        color: '#0f0',
        width: 3,
      },
    ];
    paintEdit(
      context,
      {} as CanvasImageSource,
      { ops, crop: null },
      { x: 0, y: 0, width: 400, height: 300 },
      1,
      scratch,
    );
    expect(log.indexOf('strokeRect(0,0,10,10)')).toBeGreaterThan(-1);
    expect(log.indexOf('strokeRect(0,0,10,10)')).toBeLessThan(
      log.findIndex((entry) => entry.startsWith('ellipse(')),
    );
  });
});

describe('paintOp', () => {
  it('draws a pen stroke as a smooth round-capped line', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'pen',
        color: '#7C4DFF',
        width: 6,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
        ],
      },
      scratch,
    );
    expect(log).toEqual(
      expect.arrayContaining([
        'strokeStyle=#7C4DFF',
        'lineWidth=6',
        'lineCap=round',
        'lineJoin=round',
        'moveTo(0,0)',
        'quadraticCurveTo(10,10,15,5)',
        'lineTo(20,0)',
        'stroke()',
      ]),
    );
  });

  it('leaves a dot for a single tap', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      { id: 1, kind: 'pen', color: '#000', width: 8, points: [{ x: 5, y: 5 }] },
      scratch,
    );
    expect(log).toContain('lineTo(5.01,5)');
    expect(log).toContain('stroke()');
  });

  it('does nothing visible for a stroke without points', () => {
    const { context, log, scratch } = recorder();
    paintOp(context, { id: 1, kind: 'pen', color: '#000', width: 8, points: [] }, scratch);
    expect(log.some((entry) => entry.startsWith('moveTo') || entry.startsWith('lineTo'))).toBe(
      false,
    );
  });

  it('draws a highlighter wide, see-through and multiplied with what is underneath', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'highlighter',
        color: '#FFB300',
        width: 5,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
      },
      scratch,
    );
    expect(log).toEqual(
      expect.arrayContaining([
        'lineWidth=16',
        'globalAlpha=0.5',
        'globalCompositeOperation=multiply',
      ]),
    );
  });

  it('draws an arrow as a shaft and a filled head', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'arrow',
        color: '#FF5A5F',
        width: 6,
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      },
      scratch,
    );
    expect(log.filter((entry) => entry === 'stroke()')).toHaveLength(2);
    expect(log).toEqual(expect.arrayContaining(['fillStyle=#FF5A5F', 'closePath()', 'fill()']));
  });

  it('draws a rectangle from a rect dragged in any direction', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'rect',
        color: '#000',
        width: 2,
        rect: { x: 50, y: 40, width: -30, height: -20 },
      },
      scratch,
    );
    expect(log).toContain('strokeRect(20,20,30,20)');
  });

  it('draws an ellipse inscribed in its box', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'ellipse',
        color: '#000',
        width: 2,
        rect: { x: 10, y: 20, width: 100, height: 60 },
      },
      scratch,
    );
    expect(log).toContain('ellipse(60,50,50,30,0,0,6.28)');
  });

  it('draws text line by line with a halo, so it can be read on any background', () => {
    const { context, log, scratch } = recorder();
    paintOp(
      context,
      {
        id: 1,
        kind: 'text',
        color: '#FFB300',
        size: 20,
        at: { x: 5, y: 10 },
        text: 'Hello\nWorld',
      },
      scratch,
    );
    expect(log).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^font=600 20px /),
        'textBaseline=top',
        'fillStyle=#FFB300',
        'strokeText(Hello,5,10)',
        'fillText(Hello,5,10)',
        'strokeText(World,5,35)',
        'fillText(World,5,35)',
      ]),
    );
  });

  it('pixelates a region by shrinking it into a small canvas and stretching that back without smoothing', () => {
    const { context, log, scratches, scratch } = recorder();
    paintOp(
      context,
      { id: 1, kind: 'blur', mode: 'pixelate', rect: { x: 100, y: 100, width: 220, height: 44 } },
      scratch,
    );
    const block = pixelBlock({ x: 0, y: 0, width: 220, height: 44 });
    expect(block).toBe(20);
    expect(scratches[0]).toMatchObject({ width: 11, height: 2 });
    expect(scratches[0]?.log).toContain('drawImage([canvas],100,100,220,44,0,0,11,2)');
    expect(log).toEqual(
      expect.arrayContaining([
        'rect(100,100,220,44)',
        'clip()',
        'imageSmoothingEnabled=false',
        'drawImage([canvas],100,100,220,44)',
      ]),
    );
  });

  it('blurs a region with a margin around it, clipped to the region', () => {
    const { context, log, scratches, scratch } = recorder();
    paintOp(
      context,
      { id: 1, kind: 'blur', mode: 'blur', rect: { x: 100, y: 100, width: 120, height: 30 } },
      scratch,
    );
    const radius = blurRadius({ x: 0, y: 0, width: 120, height: 30 });
    expect(radius).toBe(10);
    expect(scratches[0]).toMatchObject({ width: 180, height: 90 });
    expect(log).toEqual(
      expect.arrayContaining(['clip()', 'filter=blur(10px)', 'drawImage([canvas],70,70,180,90)']),
    );
  });

  it('scales a blur with the canvas scale', () => {
    const { context, log, scratch } = recorder();
    context.setTransform(2, 0, 0, 2, 0, 0);
    paintOp(
      context,
      { id: 1, kind: 'blur', mode: 'blur', rect: { x: 0, y: 0, width: 120, height: 30 } },
      scratch,
    );
    expect(log).toContain('filter=blur(20px)');
  });

  it('gives up quietly when no scratch canvas can be made', () => {
    const { context, log } = recorder();
    const broken: ScratchFactory = () =>
      ({ width: 1, height: 1, getContext: () => null }) as unknown as HTMLCanvasElement;
    paintOp(
      context,
      { id: 1, kind: 'blur', mode: 'pixelate', rect: { x: 0, y: 0, width: 50, height: 20 } },
      broken,
    );
    expect(log).not.toContain('clip()');
  });
});

describe('helpers', () => {
  it('makes the pixelate blocks large enough to hide text, and at least 10 px', () => {
    expect(pixelBlock({ x: 0, y: 0, width: 300, height: 14 })).toBe(10);
    expect(pixelBlock({ x: 0, y: 0, width: 300, height: 66 })).toBe(30);
    expect(pixelBlock({ x: 0, y: 0, width: 20, height: 400 })).toBe(10);
  });

  it('picks a halo that contrasts with the text colour', () => {
    expect(haloColor('#FFFFFF')).toBe('rgba(0, 0, 0, 0.75)');
    expect(haloColor('#FFB300')).toBe('rgba(0, 0, 0, 0.75)');
    expect(haloColor('#000000')).toBe('rgba(255, 255, 255, 0.85)');
    expect(haloColor('#7C4DFF')).toBe('rgba(255, 255, 255, 0.85)');
    expect(haloColor('red')).toBe('rgba(0, 0, 0, 0.75)');
  });
});
