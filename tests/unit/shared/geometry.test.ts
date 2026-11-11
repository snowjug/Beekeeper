import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  chaikin,
  clampRect,
  cropRectFromSelection,
  dipToPixels,
  displayPixelSize,
  displayPointToImagePoint,
  distance,
  expandRect,
  imagePointToDisplayPoint,
  imageRectToDisplayRect,
  isLassoClosed,
  isTap,
  morphPoints,
  normalizeRect,
  pathLength,
  pixelsToDip,
  rectArea,
  rectCenter,
  rectContainsPoint,
  rectFromPoints,
  rectIntersection,
  resamplePath,
  resampleToCount,
  roundedRectOutline,
  shiftRectInside,
  signedArea,
  strokeWidthForVelocity,
  type DisplayGeometry,
  type Point,
  type Rect,
} from '@shared/geometry';

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function circle(radius: number, steps: number, center: Point = { x: 0, y: 0 }): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

describe('boundingBox', () => {
  it('is null for an empty path', () => {
    expect(boundingBox([])).toBeNull();
  });

  it.each<[string, Point[], Rect]>([
    ['a single point', [{ x: 4, y: 7 }], { x: 4, y: 7, width: 0, height: 0 }],
    ['a square', square, { x: 0, y: 0, width: 10, height: 10 }],
    [
      'negative coordinates',
      [
        { x: -5, y: 3 },
        { x: 2, y: -8 },
        { x: -1, y: 1 },
      ],
      { x: -5, y: -8, width: 7, height: 11 },
    ],
  ])('covers %s', (_name, points, expected) => {
    expect(boundingBox(points)).toEqual(expected);
  });
});

describe('rectFromPoints', () => {
  it.each<[string, Point, Point]>([
    ['down-right', { x: 10, y: 20 }, { x: 40, y: 60 }],
    ['down-left', { x: 40, y: 20 }, { x: 10, y: 60 }],
    ['up-right', { x: 10, y: 60 }, { x: 40, y: 20 }],
    ['up-left', { x: 40, y: 60 }, { x: 10, y: 20 }],
  ])('normalises a %s drag', (_name, a, b) => {
    expect(rectFromPoints(a, b)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('rect helpers', () => {
  it('normalizeRect flips negative sizes', () => {
    expect(normalizeRect({ x: 50, y: 40, width: -20, height: -10 })).toEqual({
      x: 30,
      y: 30,
      width: 20,
      height: 10,
    });
    expect(normalizeRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it.each<[string, Rect, number, Rect]>([
    ['grows', { x: 10, y: 10, width: 20, height: 10 }, 5, { x: 5, y: 5, width: 30, height: 20 }],
    [
      'shrinks',
      { x: 10, y: 10, width: 20, height: 10 },
      -3,
      { x: 13, y: 13, width: 14, height: 4 },
    ],
    [
      'collapses onto the centre when shrunk too far',
      { x: 0, y: 0, width: 10, height: 4 },
      -3,
      { x: 3, y: 2, width: 4, height: 0 },
    ],
  ])('expandRect %s', (_name, rect, pad, expected) => {
    expect(expandRect(rect, pad)).toEqual(expected);
  });

  const bounds: Rect = { x: 0, y: 0, width: 30, height: 30 };

  it.each<[string, Rect, Rect]>([
    ['inside', { x: 5, y: 5, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }],
    [
      'overhanging',
      { x: -10, y: -10, width: 50, height: 50 },
      { x: 0, y: 0, width: 30, height: 30 },
    ],
    [
      'half outside',
      { x: 20, y: 10, width: 20, height: 5 },
      { x: 20, y: 10, width: 10, height: 5 },
    ],
    [
      'fully outside',
      { x: 100, y: 100, width: 10, height: 10 },
      { x: 30, y: 30, width: 0, height: 0 },
    ],
    [
      'negative size',
      { x: 20, y: 20, width: -10, height: -10 },
      { x: 10, y: 10, width: 10, height: 10 },
    ],
  ])('clampRect keeps a %s rect inside the bounds', (_name, rect, expected) => {
    expect(clampRect(rect, bounds)).toEqual(expected);
  });

  it.each<[string, Rect, Rect]>([
    ['left', { x: -5, y: 40, width: 20, height: 20 }, { x: 0, y: 40, width: 20, height: 20 }],
    [
      'bottom right',
      { x: 90, y: 90, width: 20, height: 20 },
      { x: 80, y: 80, width: 20, height: 20 },
    ],
    [
      'larger than the bounds',
      { x: -50, y: -50, width: 300, height: 300 },
      { x: 0, y: 0, width: 100, height: 100 },
    ],
  ])('shiftRectInside moves a rect that sticks out at the %s', (_name, rect, expected) => {
    expect(shiftRectInside(rect, { x: 0, y: 0, width: 100, height: 100 })).toEqual(expected);
  });

  it.each<[string, Point, boolean]>([
    ['inside', { x: 5, y: 5 }, true],
    ['top-left corner', { x: 0, y: 0 }, true],
    ['bottom-right corner', { x: 10, y: 10 }, true],
    ['just outside', { x: 10.01, y: 5 }, false],
    ['far away', { x: -4, y: 50 }, false],
  ])('rectContainsPoint: %s', (_name, point, expected) => {
    expect(rectContainsPoint({ x: 0, y: 0, width: 10, height: 10 }, point)).toBe(expected);
  });

  it('rectContainsPoint understands rects with negative size', () => {
    expect(rectContainsPoint({ x: 10, y: 10, width: -10, height: -10 }, { x: 5, y: 5 })).toBe(true);
  });

  it.each<[string, Rect, Rect, Rect | null]>([
    [
      'overlapping',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 },
      { x: 5, y: 5, width: 5, height: 5 },
    ],
    [
      'contained',
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 10, y: 20, width: 5, height: 5 },
      { x: 10, y: 20, width: 5, height: 5 },
    ],
    [
      'touching edges',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
      null,
    ],
    [
      'disjoint',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 50, y: 50, width: 1, height: 1 },
      null,
    ],
  ])('rectIntersection: %s', (_name, a, b, expected) => {
    expect(rectIntersection(a, b)).toEqual(expected);
    expect(rectIntersection(b, a)).toEqual(expected);
  });

  it('computes area, centre and distance', () => {
    expect(rectArea({ x: 5, y: 5, width: 4, height: 2.5 })).toBe(10);
    expect(rectArea({ x: 0, y: 0, width: -4, height: 3 })).toBe(12);
    expect(rectCenter({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 });
    expect(rectCenter({ x: 50, y: 40, width: -20, height: -10 })).toEqual({ x: 40, y: 35 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('chaikin', () => {
  it('cuts the corners of an open polyline and keeps both end points', () => {
    const result = chaikin(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      1,
    );
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 2.5, y: 0 },
      { x: 7.5, y: 0 },
      { x: 10, y: 2.5 },
      { x: 10, y: 7.5 },
      { x: 10, y: 10 },
    ]);
  });

  it('cuts every corner of a closed polygon', () => {
    expect(chaikin(square, 1, true)).toEqual([
      { x: 2.5, y: 0 },
      { x: 7.5, y: 0 },
      { x: 10, y: 2.5 },
      { x: 10, y: 7.5 },
      { x: 7.5, y: 10 },
      { x: 2.5, y: 10 },
      { x: 0, y: 7.5 },
      { x: 0, y: 2.5 },
    ]);
  });

  it('drops the repeated closing point of a closed path', () => {
    const closed = [...square, { x: 0, y: 0 }];
    expect(chaikin(closed, 1, true)).toHaveLength(8);
  });

  it.each([0, 1, 2, 3])(
    'keeps end points and stays inside the original box after %i rounds',
    (rounds) => {
      const wiggle: Point[] = [
        { x: 3, y: 4 },
        { x: 40, y: 80 },
        { x: 90, y: 10 },
        { x: 130, y: 70 },
        { x: 180, y: 20 },
      ];
      const result = chaikin(wiggle, rounds);
      expect(result[0]).toEqual(wiggle[0]);
      expect(result[result.length - 1]).toEqual(wiggle[wiggle.length - 1]);
      const box = boundingBox(wiggle);
      for (const point of result) {
        expect(point.x).toBeGreaterThanOrEqual((box?.x ?? 0) - 1e-9);
        expect(point.y).toBeGreaterThanOrEqual((box?.y ?? 0) - 1e-9);
        expect(point.x).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0) + 1e-9);
        expect(point.y).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0) + 1e-9);
      }
    },
  );

  it('shortens the path (smoothing) with each round', () => {
    const zigzag: Point[] = Array.from({ length: 20 }, (_, index) => ({
      x: index * 10,
      y: index % 2 === 0 ? 0 : 20,
    }));
    const lengths = [0, 1, 2, 3].map((rounds) => pathLength(chaikin(zigzag, rounds)));
    for (let index = 1; index < lengths.length; index += 1) {
      expect(lengths[index]).toBeLessThan(lengths[index - 1] ?? Infinity);
    }
  });

  it('returns copies for degenerate input and does not mutate its argument', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(chaikin([], 2)).toEqual([]);
    expect(chaikin(two, 3)).toEqual(two);
    expect(chaikin(two, 3)).not.toBe(two);
    const input = square.map((point) => ({ ...point }));
    chaikin(input, 2, true);
    expect(input).toEqual(square);
  });

  it('treats iterations as a count between 0 and 8', () => {
    expect(chaikin(square, 0)).toEqual(square);
    expect(chaikin(square, -3)).toEqual(square);
    expect(chaikin(square, Number.NaN)).toEqual(square);
    expect(chaikin(square, 50, true)).toHaveLength(4 * 2 ** 8);
  });
});

describe('paths', () => {
  it('measures open and closed length', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
    expect(pathLength(square)).toBe(30);
    expect(pathLength(square, true)).toBe(40);
  });

  it.each<[number, number]>([
    [3, 5],
    [5, 3],
    [10, 2],
    [25, 2],
  ])('resamplePath with spacing %i keeps the ends of a 10px line (%i points)', (spacing, count) => {
    const result = resamplePath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      spacing,
    );
    expect(result).toHaveLength(count);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it('spaces samples evenly across corners', () => {
    const result = resamplePath(square, 4);
    for (let index = 1; index < result.length - 1; index += 1) {
      const a = result[index - 1];
      const b = result[index];
      if (a && b) expect(pathLength([a, b])).toBeLessThanOrEqual(4 + 1e-9);
    }
    expect(result[1]).toEqual({ x: 4, y: 0 });
    expect(result[3]).toEqual({ x: 10, y: 2 });
  });

  it('handles degenerate input', () => {
    expect(resamplePath([], 5)).toEqual([]);
    expect(resamplePath([{ x: 2, y: 3 }], 5)).toEqual([{ x: 2, y: 3 }]);
    expect(resamplePath(square, 0)).toEqual(square);
    expect(resamplePath(square, Number.NaN)).toEqual(square);
    expect(
      resamplePath(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        2,
      ),
    ).toEqual([{ x: 1, y: 1 }]);
  });

  it('never creates an unbounded number of points', () => {
    const result = resamplePath(
      [
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
      ],
      1e-6,
    );
    expect(result.length).toBeLessThanOrEqual(20_002);
  });

  it('resampleToCount returns evenly spaced points on open paths', () => {
    expect(
      resampleToCount(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        5,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2.5, y: 0 },
      { x: 5, y: 0 },
      { x: 7.5, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('resampleToCount walks around closed rings without repeating the start', () => {
    expect(resampleToCount(square, 8, true)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ]);
  });

  it.each([1, 2, 7, 64, 200])('resampleToCount returns exactly %i points', (count) => {
    expect(resampleToCount(circle(40, 25), count, false)).toHaveLength(count);
    expect(resampleToCount(circle(40, 25), count, true)).toHaveLength(count);
  });

  it('resampleToCount handles degenerate input', () => {
    expect(resampleToCount([], 4)).toEqual([]);
    expect(resampleToCount(square, 0)).toEqual([]);
    expect(resampleToCount([{ x: 3, y: 3 }], 3)).toEqual(Array(3).fill({ x: 3, y: 3 }));
  });
});

describe('closed shapes', () => {
  it('signedArea is positive for clockwise (on screen) rings and negative otherwise', () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea([...square].reverse())).toBe(-100);
    expect(signedArea([{ x: 1, y: 1 }])).toBe(0);
  });

  it('builds an evenly spaced outline of a plain rectangle', () => {
    expect(roundedRectOutline({ x: 0, y: 0, width: 20, height: 10 }, 0, 6)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('starts at the outline point nearest to startNear and can run counter-clockwise', () => {
    const rect: Rect = { x: 0, y: 0, width: 20, height: 10 };
    const near = roundedRectOutline(rect, 0, 6, { startNear: { x: 19, y: 11 } });
    expect(near[0]).toEqual({ x: 20, y: 10 });
    expect(near[1]).toEqual({ x: 10, y: 10 });

    const clockwise = roundedRectOutline(rect, 0, 6);
    const counter = roundedRectOutline(rect, 0, 6, { clockwise: false });
    expect(counter[0]).toEqual(clockwise[0]);
    expect(signedArea(clockwise)).toBeGreaterThan(0);
    expect(signedArea(counter)).toBeLessThan(0);
  });

  it('cuts the corners and keeps the straight edges of a rounded outline', () => {
    const rect: Rect = { x: 100, y: 50, width: 200, height: 100 };
    const outline = roundedRectOutline(rect, 20, 120);
    expect(outline).toHaveLength(120);
    for (const point of outline) {
      expect(point.x).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(point.x).toBeLessThanOrEqual(300 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(point.y).toBeLessThanOrEqual(150 + 1e-9);
      const inCorner = (point.x < 120 || point.x > 280) && (point.y < 70 || point.y > 130);
      if (inCorner) {
        const cx = point.x < 120 ? 120 : 280;
        const cy = point.y < 70 ? 70 : 130;
        expect(Math.abs(Math.hypot(point.x - cx, point.y - cy) - 20)).toBeLessThan(0.1);
      }
    }
    expect(outline.some((point) => point.x === 100 + 0 && point.y > 70 && point.y < 130)).toBe(
      true,
    );
  });

  it('clamps an oversized radius to a pill shape', () => {
    const outline = roundedRectOutline({ x: 0, y: 0, width: 100, height: 20 }, 999, 60);
    for (const point of outline) {
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      expect(point.y).toBeLessThanOrEqual(20 + 1e-9);
    }
  });

  it('morphPoints interpolates point by point', () => {
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const to: Point[] = [
      { x: 10, y: 10 },
      { x: 30, y: 20 },
    ];
    expect(morphPoints(from, to, 0)).toEqual(from);
    expect(morphPoints(from, to, 1)).toEqual(to);
    expect(morphPoints(from, to, 0.5)).toEqual([
      { x: 5, y: 5 },
      { x: 20, y: 10 },
    ]);
    expect(morphPoints(from, [{ x: 4, y: 4 }], 1)[1]).toEqual({ x: 10, y: 0 });
  });
});

describe('strokeWidthForVelocity', () => {
  const range = { min: 2, max: 12 };

  it('is thickest when the pointer rests and thinnest when it flies', () => {
    expect(strokeWidthForVelocity(0, range)).toBe(12);
    expect(strokeWidthForVelocity(500, range)).toBeCloseTo(2, 6);
    expect(strokeWidthForVelocity(Infinity, range)).toBeCloseTo(2, 6);
  });

  it('eases monotonically between the limits', () => {
    const widths = [0, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8].map((v) => strokeWidthForVelocity(v, range));
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]).toBeLessThanOrEqual(widths[index - 1] ?? Infinity);
    }
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(2);
      expect(width).toBeLessThanOrEqual(12);
    }
  });

  it.each<[string, number]>([
    ['negative speed', -4],
    ['NaN', Number.NaN],
  ])('treats %s as resting', (_name, velocity) => {
    expect(strokeWidthForVelocity(velocity, range)).toBe(12);
  });

  it('accepts swapped limits and a custom reference velocity', () => {
    expect(strokeWidthForVelocity(1, { min: 12, max: 2 })).toBe(strokeWidthForVelocity(1, range));
    const gentle = strokeWidthForVelocity(1, { ...range, referenceVelocity: 10 });
    const sharp = strokeWidthForVelocity(1, { ...range, referenceVelocity: 0.2 });
    expect(gentle).toBeGreaterThan(sharp);
    expect(strokeWidthForVelocity(1, { ...range, referenceVelocity: 0 })).toBe(
      strokeWidthForVelocity(1, range),
    );
  });
});

describe('gesture classification', () => {
  it.each<[string, Point[], number, boolean]>([
    ['a full circle', circle(50, 40), 20, true],
    ['a circle that stops a little short', circle(50, 40).slice(0, 39), 20, true],
    ['an open arc', circle(50, 40).slice(0, 30), 20, false],
    ['a tiny loop', circle(5, 12), 20, false],
    [
      'a back-and-forth scribble',
      [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 0, y: 0 },
      ],
      20,
      false,
    ],
    [
      'two points',
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      20,
      false,
    ],
    ['no points', [], 20, false],
    ['a loop that ends within a generous threshold', circle(100, 40).slice(0, 33), 120, true],
  ])('isLassoClosed: %s', (_name, points, threshold, expected) => {
    expect(isLassoClosed(points, threshold)).toBe(expected);
  });

  it.each<[string, Point[], number, number, boolean]>([
    ['a still press', [{ x: 10, y: 10 }], 80, 250, true],
    [
      'a press with jitter',
      [
        { x: 10, y: 10 },
        { x: 12, y: 11 },
        { x: 10, y: 9 },
      ],
      120,
      250,
      true,
    ],
    [
      'a drag',
      [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
      ],
      120,
      250,
      false,
    ],
    ['a long press', [{ x: 10, y: 10 }], 900, 250, false],
    [
      'exactly at the limits',
      [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      250,
      250,
      true,
    ],
    ['no points', [], 10, 250, false],
  ])('isTap: %s', (_name, points, duration, maxDuration, expected) => {
    expect(isTap(points, 5, duration, maxDuration)).toBe(expected);
  });
});

const IMAGE_1080P = { width: 1920, height: 1080 };

// 1920x1080 panel at the four common Windows scale factors, plus monitors left of / above the primary.
const DISPLAYS: Array<[string, DisplayGeometry, { width: number; height: number }]> = [
  ['100 %', { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }, IMAGE_1080P],
  ['125 %', { bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 }, IMAGE_1080P],
  ['150 %', { bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }, IMAGE_1080P],
  ['200 %', { bounds: { x: 0, y: 0, width: 960, height: 540 }, scaleFactor: 2 }, IMAGE_1080P],
  [
    '125 % left of the primary',
    { bounds: { x: -1536, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 },
    IMAGE_1080P,
  ],
  [
    '150 % above the primary',
    { bounds: { x: 0, y: -720, width: 1280, height: 720 }, scaleFactor: 1.5 },
    IMAGE_1080P,
  ],
  [
    '100 % left and above the primary',
    { bounds: { x: -1920, y: -1080, width: 1920, height: 1080 }, scaleFactor: 1 },
    IMAGE_1080P,
  ],
  [
    '200 % to the right of a 125 % primary',
    { bounds: { x: 1536, y: 120, width: 960, height: 540 }, scaleFactor: 2 },
    IMAGE_1080P,
  ],
];

describe('DIP <-> pixel conversion', () => {
  const rect: Rect = { x: 100, y: 40, width: 200, height: 80 };

  it.each([
    [1, { x: 100, y: 40, width: 200, height: 80 }],
    [1.25, { x: 125, y: 50, width: 250, height: 100 }],
    [1.5, { x: 150, y: 60, width: 300, height: 120 }],
    [2, { x: 200, y: 80, width: 400, height: 160 }],
  ])('dipToPixels / pixelsToDip at %d', (scale, pixels) => {
    expect(dipToPixels(rect, scale)).toEqual(pixels);
    expect(pixelsToDip(pixels, scale)).toEqual(rect);
  });

  it.each([0, -1, Number.NaN, Infinity])('ignores the invalid scale factor %s', (scale) => {
    expect(dipToPixels(rect, scale)).toEqual(rect);
    expect(pixelsToDip(rect, scale)).toEqual(rect);
  });

  it.each<[string, number, number, number, number, number]>([
    ['1080p at 100 %', 1920, 1080, 1, 1920, 1080],
    ['1080p at 125 %', 1536, 864, 1.25, 1920, 1080],
    ['1080p at 150 %', 1280, 720, 1.5, 1920, 1080],
    ['1080p at 200 %', 960, 540, 2, 1920, 1080],
    ['1440p at 175 % (fractional bounds are rounded)', 1463, 823, 1.75, 2560, 1440],
    ['768p laptop at 125 %', 1093, 614, 1.25, 1366, 768],
  ])('displayPixelSize: %s', (_name, width, height, scaleFactor, pixelWidth, pixelHeight) => {
    expect(displayPixelSize({ bounds: { x: 0, y: 0, width, height }, scaleFactor })).toEqual({
      width: pixelWidth,
      height: pixelHeight,
    });
  });
});

describe('display <-> image mapping', () => {
  it.each(DISPLAYS)(
    'maps the centre of the %s display to the centre of the image',
    (_name, display, image) => {
      const { bounds } = display;
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      expect(displayPointToImagePoint(centre, display, image)).toEqual({ x: 960, y: 540 });
      expect(displayPointToImagePoint({ x: bounds.x, y: bounds.y }, display, image)).toEqual({
        x: 0,
        y: 0,
      });
    },
  );

  it.each(DISPLAYS)('round-trips points on the %s display', (_name, display, image) => {
    const { bounds } = display;
    for (const [fx, fy] of [
      [0.1, 0.9],
      [0.5, 0.25],
      [0.77, 0.33],
    ] as const) {
      const point = { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
      const back = imagePointToDisplayPoint(
        displayPointToImagePoint(point, display, image),
        display,
        image,
      );
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it.each(DISPLAYS)('round-trips boxes on the %s display', (_name, display, image) => {
    const { bounds } = display;
    for (const [fx, fy] of [
      [0.1, 0.9],
      [0.5, 0.25],
      [0.77, 0.33],
    ] as const) {
      const point = { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
      const mapped = displayPointToImagePoint(point, display, image);
      const back = imageRectToDisplayRect({ ...mapped, width: 0, height: 0 }, display, image);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it('clamps points outside the display to the image', () => {
    const display = DISPLAYS[0]?.[1] as DisplayGeometry;
    expect(displayPointToImagePoint({ x: 5000, y: -50 }, display, IMAGE_1080P)).toEqual({
      x: 1920,
      y: 0,
    });
  });

  it('uses the real image/bounds ratio, not the nominal scale factor', () => {
    const display: DisplayGeometry = {
      bounds: { x: 0, y: 0, width: 1463, height: 823 },
      scaleFactor: 1.75,
    };
    const mapped = displayPointToImagePoint({ x: 731.5, y: 411.5 }, display, {
      width: 2560,
      height: 1440,
    });
    expect(mapped.x).toBeCloseTo(1280, 6);
    expect(mapped.y).toBeCloseTo(720, 6);
  });

  it('falls back to the nominal scale factor when the image size is unknown', () => {
    const display: DisplayGeometry = {
      bounds: { x: -100, y: 50, width: 800, height: 600 },
      scaleFactor: 2,
    };
    expect(imagePointToDisplayPoint({ x: 200, y: 100 }, display, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 100,
    });
    expect(
      imageRectToDisplayRect({ x: 200, y: 100, width: 40, height: 20 }, display, {
        width: 0,
        height: 0,
      }),
    ).toEqual({ x: 0, y: 100, width: 20, height: 10 });
  });

  it('maps OCR boxes back into DIPs on a monitor left of the primary', () => {
    const display: DisplayGeometry = {
      bounds: { x: -1536, y: 0, width: 1536, height: 864 },
      scaleFactor: 1.25,
    };
    expect(
      imageRectToDisplayRect({ x: 250, y: 200, width: 500, height: 300 }, display, IMAGE_1080P),
    ).toEqual({ x: -1336, y: 160, width: 400, height: 240 });
  });
});

describe('cropRectFromSelection', () => {
  it.each(DISPLAYS)('crops the same screen area on the %s display', (_name, display, image) => {
    const { bounds, scaleFactor } = display;
    // 400x200 DIP selection starting 100/80 DIP into the display
    const selection = { x: bounds.x + 100, y: bounds.y + 80, width: 400, height: 200 };
    expect(cropRectFromSelection(selection, display, image)).toEqual({
      x: 100 * scaleFactor,
      y: 80 * scaleFactor,
      width: 400 * scaleFactor,
      height: 200 * scaleFactor,
    });
  });

  it('accepts drags in any direction', () => {
    const display = DISPLAYS[1]?.[1] as DisplayGeometry;
    const forward = cropRectFromSelection(
      { x: 100, y: 100, width: 400, height: 300 },
      display,
      IMAGE_1080P,
    );
    const backward = cropRectFromSelection(
      { x: 500, y: 400, width: -400, height: -300 },
      display,
      IMAGE_1080P,
    );
    expect(backward).toEqual(forward);
  });

  it('covers every pixel a fractional selection touches', () => {
    const display = DISPLAYS[1]?.[1] as DisplayGeometry;
    expect(
      cropRectFromSelection({ x: 10.1, y: 10.1, width: 10.2, height: 10.2 }, display, IMAGE_1080P),
    ).toEqual({ x: 12, y: 12, width: 14, height: 14 });
  });

  it('is not thrown off by floating point noise at the edges', () => {
    const display = DISPLAYS[0]?.[1] as DisplayGeometry;
    expect(
      cropRectFromSelection(
        { x: 100, y: 0, width: 400.00000000000006, height: 10 },
        display,
        IMAGE_1080P,
      ),
    ).toEqual({ x: 100, y: 0, width: 400, height: 10 });
  });

  it('stays inside the image', () => {
    const display = DISPLAYS[0]?.[1] as DisplayGeometry;
    expect(
      cropRectFromSelection({ x: 1800, y: 1000, width: 500, height: 500 }, display, IMAGE_1080P),
    ).toEqual({ x: 1800, y: 1000, width: 120, height: 80 });
    expect(
      cropRectFromSelection({ x: -50, y: -50, width: 100, height: 100 }, display, IMAGE_1080P),
    ).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it.each<[string, Rect, Rect]>([
    [
      'in the middle',
      { x: 100, y: 100, width: 2, height: 2 },
      { x: 97, y: 97, width: 8, height: 8 },
    ],
    [
      'at the top-left corner',
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 8, height: 8 },
    ],
    [
      'at the bottom-right corner',
      { x: 1919, y: 1079, width: 1, height: 1 },
      { x: 1912, y: 1072, width: 8, height: 8 },
    ],
    [
      'as a line',
      { x: 500, y: 500, width: 300, height: 0 },
      { x: 500, y: 496, width: 300, height: 8 },
    ],
    [
      'outside the display',
      { x: 3000, y: 3000, width: 10, height: 10 },
      { x: 1912, y: 1072, width: 8, height: 8 },
    ],
  ])('grows a tiny selection %s to the minimum size', (_name, selection, expected) => {
    const display = DISPLAYS[0]?.[1] as DisplayGeometry;
    expect(cropRectFromSelection(selection, display, IMAGE_1080P)).toEqual(expected);
  });

  it('honours a custom minimum size and a tiny image', () => {
    const display: DisplayGeometry = {
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      scaleFactor: 1,
    };
    expect(
      cropRectFromSelection(
        { x: 4, y: 4, width: 1, height: 1 },
        display,
        { width: 10, height: 10 },
        32,
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it.each<[string, Rect, { width: number; height: number }]>([
    ['a non-finite selection', { x: Number.NaN, y: 0, width: 10, height: 10 }, IMAGE_1080P],
    ['an empty image', { x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }],
  ])('returns an empty rect for %s', (_name, selection, image) => {
    const display = DISPLAYS[0]?.[1] as DisplayGeometry;
    expect(cropRectFromSelection(selection, display, image)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('works for a fractional scale where the nominal image size is off by a pixel', () => {
    const display: DisplayGeometry = {
      bounds: { x: -1463, y: 0, width: 1463, height: 823 },
      scaleFactor: 1.75,
    };
    const image = { width: 2560, height: 1440 };
    const full = cropRectFromSelection(
      { x: -1463, y: 0, width: 1463, height: 823 },
      display,
      image,
    );
    expect(full).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });
});
