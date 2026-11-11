import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_COLORS } from '@shared/constants';
import {
  CONFETTI_SECONDS,
  createCelebration,
  createParticles,
  createRng,
  flutterScale,
  isAlive,
  particleOpacity,
  stepParticle,
  stepParticles,
  type BurstOptions,
  type Particle,
} from '@renderer/onboarding/confetti';
import { drawParticles, runConfetti } from '@renderer/onboarding/confettiCanvas';

const BURST: BurstOptions = {
  count: 200,
  x: 450,
  y: 200,
  angle: -Math.PI / 2,
  spread: 0.4,
  minSpeed: 300,
  maxSpeed: 700,
  minLife: 1.5,
  maxLife: 2.5,
};

function one(overrides: Partial<Particle> = {}): Particle {
  return {
    x: 0,
    y: 0,
    vx: 100,
    vy: 0,
    rotation: 0,
    spin: 4,
    flip: 0,
    flipSpeed: 5,
    size: 6,
    color: BRAND_COLORS.honey,
    shape: 'hexagon',
    age: 0,
    life: 2,
    ...overrides,
  };
}

describe('createRng', () => {
  it('is deterministic per seed and stays inside [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const values = Array.from({ length: 500 }, () => a());
    expect(values).toEqual(Array.from({ length: 500 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(createRng(42)());
    expect(new Set(values).size).toBeGreaterThan(490);
  });
});

describe('createParticles', () => {
  const particles = createParticles(createRng(7), BURST);

  it('creates the requested number of particles at the origin', () => {
    expect(particles).toHaveLength(200);
    expect(particles.every((p) => p.x === 450 && p.y === 200 && p.age === 0)).toBe(true);
  });

  it('uses only the four brand colours and both hexagons and circles', () => {
    const colours = new Set(particles.map((p) => p.color));
    expect([...colours].every((c) => Object.values(BRAND_COLORS).includes(c as never))).toBe(true);
    expect(colours.size).toBe(4);
    expect(new Set(particles.map((p) => p.shape))).toEqual(new Set(['hexagon', 'circle']));
  });

  it('shoots inside the cone with speeds and lifetimes from the options', () => {
    for (const p of particles) {
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(300 - 1e-6);
      expect(speed).toBeLessThanOrEqual(700 + 1e-6);
      const direction = Math.atan2(p.vy, p.vx);
      expect(Math.abs(direction + Math.PI / 2)).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(p.life).toBeGreaterThanOrEqual(1.5);
      expect(p.life).toBeLessThanOrEqual(2.5);
    }
  });

  it('repeats exactly for the same seed', () => {
    expect(createParticles(createRng(7), BURST)).toEqual(particles);
  });
});

describe('physics', () => {
  it('pulls particles down, slows them with drag and spins them', () => {
    const p = one({ vx: 400, vy: -400 });
    stepParticle(p, 0.1);
    expect(p.vy).toBeGreaterThan(-400 * Math.exp(-0.24) - 1e-9);
    expect(p.vx).toBeLessThan(400);
    expect(p.x).toBeGreaterThan(0);
    expect(p.rotation).toBeGreaterThan(0);
    expect(p.age).toBeCloseTo(0.1);
  });

  it('settles at a terminal fall speed instead of accelerating forever', () => {
    const p = one({ vx: 0, vy: 0 });
    for (let i = 0; i < 600; i += 1) stepParticle(p, 1 / 60, { gravity: 720, drag: 2.4 });
    expect(p.vy).toBeCloseTo(720 / 2.4, 3);
    expect(Math.abs(p.vx)).toBeLessThan(1e-6);
  });

  it('does not depend on the frame rate', () => {
    const fine = one({ vx: 300, vy: -500 });
    const coarse = one({ vx: 300, vy: -500 });
    for (let i = 0; i < 60; i += 1) stepParticle(fine, 1 / 60);
    for (let i = 0; i < 30; i += 1) stepParticle(coarse, 1 / 30);
    expect(coarse.x).toBeCloseTo(fine.x, 6);
    expect(coarse.y).toBeCloseTo(fine.y, 6);
    expect(coarse.vy).toBeCloseTo(fine.vy, 6);
    expect(coarse.age).toBeCloseTo(fine.age, 6);
  });

  it('follows a plain parabola when there is no drag', () => {
    const p = one({ vx: 100, vy: -200 });
    stepParticle(p, 1, { gravity: 500, drag: 0 });
    expect([p.x, p.y, p.vx, p.vy]).toEqual([100, 50, 100, 300]);
  });

  it('drops particles whose life is over', () => {
    const alive = one({ life: 1 });
    const dying = one({ life: 0.05 });
    expect(isAlive(dying)).toBe(true);
    const remaining = stepParticles([alive, dying], 0.1);
    expect(remaining).toEqual([alive]);
    expect(isAlive(dying)).toBe(false);
  });

  it('fades out during the last 40 % of the life only', () => {
    expect(particleOpacity(one({ age: 0 }))).toBe(1);
    expect(particleOpacity(one({ age: 1.1 }))).toBe(1);
    expect(particleOpacity(one({ age: 1.6 }))).toBeCloseTo(0.5);
    expect(particleOpacity(one({ age: 2 }))).toBe(0);
    expect(particleOpacity(one({ age: 3 }))).toBe(0);
  });

  it('squashes hexagons between 30 % and 100 % to look like they tumble', () => {
    const scales = Array.from({ length: 60 }, (_, i) => flutterScale(one({ flip: i / 5 })));
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1);
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.5);
  });
});

describe('createCelebration', () => {
  it('starts from the orb and both bottom corners, inside the window', () => {
    const particles = createCelebration(createRng(1), 900, 660);
    expect(particles).toHaveLength(150);
    expect(particles.every((p) => p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 660)).toBe(true);
    expect(particles.filter((p) => p.x < 100).length).toBe(40);
    expect(particles.filter((p) => p.x > 800).length).toBe(40);
  });

  it('is over after about two and a half seconds', () => {
    let particles = createCelebration(createRng(2), 900, 660);
    expect(Math.max(...particles.map((p) => p.life))).toBeLessThanOrEqual(CONFETTI_SECONDS);
    let frames = 0;
    while (particles.length > 0 && frames < 1000) {
      particles = stepParticles(particles, 1 / 60);
      frames += 1;
    }
    expect(particles).toHaveLength(0);
    expect(frames / 60).toBeGreaterThan(1.5);
    expect(frames / 60).toBeLessThanOrEqual(CONFETTI_SECONDS + 0.05);
  });
});

function fakeContext() {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  };
  return context;
}

describe('drawParticles', () => {
  it('draws hexagons as six-cornered paths and circles as arcs, then resets the alpha', () => {
    const context = fakeContext();
    drawParticles(context as unknown as CanvasRenderingContext2D, [
      one({ shape: 'hexagon' }),
      one({ shape: 'circle', color: BRAND_COLORS.cyan }),
    ]);
    expect(context.moveTo).toHaveBeenCalledTimes(1);
    expect(context.lineTo).toHaveBeenCalledTimes(5);
    expect(context.arc).toHaveBeenCalledTimes(1);
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
    expect(context.globalAlpha).toBe(1);
    expect(context.fillStyle).toBe(BRAND_COLORS.cyan);
  });
});

describe('runConfetti', () => {
  let queue: FrameRequestCallback[] = [];
  let now = 0;

  function install() {
    queue = [];
    now = performance.now();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
  }

  function frame(ms = 16.7): void {
    now += ms;
    const due = queue;
    queue = [];
    for (const callback of due) callback(now);
  }

  function canvasWith(context: ReturnType<typeof fakeContext> | null): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    return canvas;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('animates, and the loop ends by itself once every particle has faded', () => {
    install();
    const context = fakeContext();
    runConfetti(canvasWith(context), 5);
    expect(queue).toHaveLength(1);
    frame();
    expect(context.fill.mock.calls.length).toBeGreaterThan(100);
    let frames = 1;
    while (queue.length > 0 && frames < 1000) {
      frame();
      frames += 1;
    }
    expect(queue).toHaveLength(0);
    expect((frames * 16.7) / 1000).toBeLessThan(CONFETTI_SECONDS + 0.5);
    const lastClear = context.clearRect.mock.calls.length;
    expect(lastClear).toBeGreaterThan(frames - 1);
  });

  it('can be stopped early and clears the canvas', () => {
    install();
    const context = fakeContext();
    const stop = runConfetti(canvasWith(context), 5);
    frame();
    const clears = context.clearRect.mock.calls.length;
    stop();
    expect(queue).toHaveLength(0);
    expect(context.clearRect.mock.calls.length).toBe(clears + 1);
    frame();
    expect(context.fill.mock.calls.length).toBeGreaterThan(0);
    expect(context.clearRect.mock.calls.length).toBe(clears + 1);
  });

  it('does nothing when the canvas has no 2d context', () => {
    install();
    const stop = runConfetti(canvasWith(null));
    expect(queue).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });

  it('sizes the canvas for the device pixel ratio and caps it at 2', () => {
    install();
    vi.stubGlobal('devicePixelRatio', 3);
    const canvas = canvasWith(fakeContext());
    Object.defineProperty(canvas, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 660, configurable: true });
    runConfetti(canvas, 1)();
    expect([canvas.width, canvas.height]).toEqual([1800, 1320]);
  });
});
