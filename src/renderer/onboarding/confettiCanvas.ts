import {
  createCelebration,
  createRng,
  flutterScale,
  particleOpacity,
  stepParticles,
  type Particle,
} from './confetti';

const HEXAGON = Array.from({ length: 6 }, (_, index) => ({
  x: Math.cos((Math.PI / 3) * index),
  y: Math.sin((Math.PI / 3) * index),
}));
const MAX_FRAME_SECONDS = 0.05;
const MAX_PIXEL_RATIO = 2;

/** Pure drawing (no timing): hexagons tumble, circles are honey drops. */
export function drawParticles(
  context: CanvasRenderingContext2D,
  particles: readonly Particle[],
): void {
  for (const particle of particles) {
    context.globalAlpha = particleOpacity(particle);
    context.fillStyle = particle.color;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.beginPath();
    if (particle.shape === 'circle') {
      context.arc(0, 0, particle.size * 0.7, 0, Math.PI * 2);
    } else {
      context.scale(1, flutterScale(particle));
      HEXAGON.forEach((corner, index) => {
        const x = corner.x * particle.size;
        const y = corner.y * particle.size;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
    context.fill();
    context.restore();
  }
  context.globalAlpha = 1;
}

/**
 * Plays one honey-confetti burst on `canvas` and returns a function that stops it. The
 * requestAnimationFrame loop ends by itself (and clears the canvas) once every particle has faded.
 */
export function runConfetti(canvas: HTMLCanvasElement, seed: number = Date.now()): () => void {
  const context = canvas.getContext('2d');
  if (!context) return () => undefined;

  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  let particles = createCelebration(createRng(seed), width, height);
  let running = true;
  let last = performance.now();
  let frame = 0;

  const tick = (now: number): void => {
    if (!running) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
    last = now;
    particles = stepParticles(particles, dt);
    context.clearRect(0, 0, width, height);
    if (particles.length === 0) {
      running = false;
      return;
    }
    drawParticles(context, particles);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    running = false;
    cancelAnimationFrame(frame);
    context.clearRect(0, 0, width, height);
  };
}
