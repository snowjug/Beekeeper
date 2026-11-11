/**
 * Beekeeper brand asset generator (run with `npm run icons`).
 *
 * Renders every brand asset from the SVG sources below with resvg and writes it under assets/ and
 * docs/. Output is byte-for-byte deterministic and unchanged files are not rewritten, so running
 * the script twice leaves the working tree untouched.
 *
 *   assets/icon.svg, icon.png (1024), icon.ico (16-256)  app icon (electron-builder win.icon)
 *   assets/icons/icon-<size>.png                          16 - 512 px PNG set
 *   assets/tray/tray-<state>-<theme>[@2x].png             16 / 32 px tray frames
 *   assets/tray/tray-<state>-<theme>.ico                  16 / 20 / 24 / 32 px tray icons
 *   assets/installer/*.bmp                                NSIS sidebar + header artwork
 *   assets/logo.svg, docs/banner.png                      lockup + README hero
 *
 * Tray icons are shipped as .ico as well because on Windows Electron's Tray only reads the 1x
 * bitmap of a PNG (the @2x file is ignored) but loads an .ico at the system small-icon size
 * (16 / 20 / 24 / 32 px at 100 / 125 / 150 / 200 % display scaling).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------------------------------ */
/* Palette                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const COLORS = {
  honey: { light: '#FFE08A', mid: '#FFC933', base: '#FFB300', dark: '#E58A00' },
  coral: { light: '#FFA3A6', mid: '#FF7C80', base: '#FF5A5F', dark: '#D6384A' },
  violet: { light: '#B99CFF', mid: '#9B72FF', base: '#7C4DFF', dark: '#5A2FD4' },
  cyan: { light: '#7FEAF6', mid: '#2ED3E6', base: '#00BCD4', dark: '#0090A3' },
};
const DOT_ORDER = ['honey', 'coral', 'violet', 'cyan'];

/* ------------------------------------------------------------------------------------------ */
/* Geometry helpers                                                                            */
/* ------------------------------------------------------------------------------------------ */

const SQRT3 = Math.sqrt(3);

/** Short, deterministic number formatting for SVG attributes. */
function n(value) {
  const s = String(Math.round(value * 1000) / 1000);
  return s === '-0' ? '0' : s;
}

/** Vertices of a pointy-top hexagon from its apothem (centre to flat side), optionally squashed. */
function hexVertices(cx, cy, apothem, squash = 1) {
  const radius = apothem / (SQRT3 / 2);
  return Array.from({ length: 6 }, (_, k) => {
    const angle = ((-90 + 60 * k) * Math.PI) / 180;
    return [cx + radius * Math.cos(angle), cy + radius * squash * Math.sin(angle)];
  });
}

function towards(from, to, distance) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return [from[0] + (dx / length) * distance, from[1] + (dy / length) * distance];
}

/** Tangent points and arc centre of the circle of `radius` rounding the corner at p. */
function cornerArc(prev, p, next, radius) {
  const dx1 = prev[0] - p[0];
  const dy1 = prev[1] - p[1];
  const dx2 = next[0] - p[0];
  const dy2 = next[1] - p[1];
  const cos = (dx1 * dx2 + dy1 * dy2) / (Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2));
  const half = Math.acos(cos) / 2;
  const from = towards(p, prev, radius / Math.tan(half));
  const to = towards(p, next, radius / Math.tan(half));
  const mid = [(from[0] + to[0]) / 2 - p[0], (from[1] + to[1]) / 2 - p[1]];
  const reach = radius / Math.sin(half) / Math.hypot(mid[0], mid[1]);
  return { from, to, centre: [p[0] + mid[0] * reach, p[1] + mid[1] * reach] };
}

/** Closed path of a convex polygon whose corners are rounded with circular arcs. */
function roundedPolygonPath(points, radius) {
  let d = '';
  points.forEach((p, k) => {
    const { from, to } = cornerArc(
      points[(k + points.length - 1) % points.length],
      p,
      points[(k + 1) % points.length],
      radius,
    );
    d += `${k === 0 ? 'M' : 'L'}${n(from[0])} ${n(from[1])}A${n(radius)} ${n(radius)} 0 0 1 ${n(to[0])} ${n(to[1])}`;
  });
  return `${d}Z`;
}

/** Bounding box of the rounded polygon, sampled along every corner arc. */
function roundedPolygonBounds(points, radius) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  points.forEach((p, k) => {
    const { from, to, centre } = cornerArc(
      points[(k + points.length - 1) % points.length],
      p,
      points[(k + 1) % points.length],
      radius,
    );
    const a1 = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
    let sweep = Math.atan2(to[1] - centre[1], to[0] - centre[0]) - a1;
    if (sweep < 0) sweep += 2 * Math.PI;
    for (let i = 0; i <= 32; i++) {
      const angle = a1 + (sweep * i) / 32;
      const x = centre[0] + radius * Math.cos(angle);
      const y = centre[1] + radius * Math.sin(angle);
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    }
  });
  return box;
}

/** Closed path of a pointy-top hexagon whose six corners are rounded with `radius`. */
function roundedHexPath(cx, cy, apothem, radius, squash = 1) {
  return roundedPolygonPath(hexVertices(cx, cy, apothem, squash), radius);
}

/** Outlines of a pointy-top honeycomb lattice (one cell centred on cx, cy) within `reach`. */
function latticePath(cx, cy, cellApothem, reach) {
  const radius = cellApothem / (SQRT3 / 2);
  const stepX = 2 * cellApothem;
  const stepY = 1.5 * radius;
  const rows = Math.ceil(reach / stepY) + 1;
  const cols = Math.ceil(reach / stepX) + 1;
  let d = '';
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      const x = cx + i * stepX + (j & 1 ? stepX / 2 : 0);
      const y = cy + j * stepY;
      if (Math.hypot(x - cx, y - cy) > reach + radius) continue;
      const v = hexVertices(x, y, cellApothem);
      d += `M${v.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}Z`;
    }
  }
  return d;
}

/* ------------------------------------------------------------------------------------------ */
/* App icon (512 unit design space)                                                            */
/* ------------------------------------------------------------------------------------------ */

function orbDots(cx, cy, distance, radius, swirl = 0) {
  const centres = [
    [cx - swirl, cy - distance],
    [cx + distance, cy - swirl],
    [cx + swirl, cy + distance],
    [cx - distance, cy + swirl],
  ];
  return centres.map(([x, y], i) => ({ x, y, r: radius, name: DOT_ORDER[i] }));
}

/** The icon artwork in a 512 x 512 design space (used for every render of 128 px and above). */
function appIconArt(idp) {
  const c = 256;
  const outer = roundedHexPath(c, c, 204, 50);
  const inner = roundedHexPath(c, c, 182, 28);
  const dots = orbDots(c, c, 80, 52);

  const beadDefs = dots
    .map(
      (dot) => `<radialGradient id="${idp}-bead-${dot.name}" cx=".5" cy=".46" r=".66">
      <stop offset="0" stop-color="${COLORS[dot.name].light}"/>
      <stop offset=".5" stop-color="${COLORS[dot.name].base}"/>
      <stop offset="1" stop-color="${COLORS[dot.name].dark}"/>
    </radialGradient>`,
    )
    .join('\n    ');

  const defs = `
    <radialGradient id="${idp}-glass" cx="256" cy="212" r="280" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#352A63"/>
      <stop offset=".5" stop-color="#1C1539"/>
      <stop offset="1" stop-color="#0C0919"/>
    </radialGradient>
    <linearGradient id="${idp}-rim" x1="110" y1="30" x2="400" y2="486" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFF3C4"/>
      <stop offset=".2" stop-color="#FFD455"/>
      <stop offset=".52" stop-color="#FFB300"/>
      <stop offset=".8" stop-color="#FF9A1F"/>
      <stop offset="1" stop-color="#FF6B4A"/>
    </linearGradient>
    <linearGradient id="${idp}-rimhi" x1="140" y1="50" x2="380" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".8"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${idp}-halo" cx="256" cy="256" r="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".2"/>
      <stop offset=".45" stop-color="#B9A4FF" stop-opacity=".1"/>
      <stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${idp}-floor" cx="256" cy="500" r="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7C4DFF" stop-opacity=".38"/>
      <stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${idp}-sheen" x1="0" y1="30" x2="0" y2="250" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".2"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${idp}-cells" cx="256" cy="256" r="236" gradientUnits="userSpaceOnUse">
      <stop offset=".25" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".7" stop-color="#FFD455" stop-opacity=".1"/>
      <stop offset="1" stop-color="#FFD455" stop-opacity=".2"/>
    </radialGradient>
    ${beadDefs}
    <clipPath id="${idp}-clip"><path d="${outer}"/></clipPath>
    <filter id="${idp}-b8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="${idp}-b12" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="${idp}-glow" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="26"/></filter>`;

  const ambient = `<path d="${outer}" fill="#000" opacity=".32" filter="url(#${idp}-b8)" transform="translate(0 10)"/>
    <path d="${outer}" fill="#FFB300" opacity=".3" filter="url(#${idp}-b12)"/>`;

  const texture = `<path d="${latticePath(c, c, 38, 250)}" fill="none" stroke="url(#${idp}-cells)" stroke-width="1.6" stroke-linejoin="round"/>`;

  const glows = dots
    .map(
      (dot) =>
        `<circle cx="${n(dot.x)}" cy="${n(dot.y)}" r="${n(dot.r * 1.5)}" fill="${COLORS[dot.name].base}" opacity=".6" filter="url(#${idp}-glow)" style="mix-blend-mode:screen"/>`,
    )
    .join('\n      ');

  const beads = dots
    .map(
      (dot) =>
        `<circle cx="${n(dot.x)}" cy="${n(dot.y)}" r="${n(dot.r)}" fill="url(#${idp}-bead-${dot.name})"/>`,
    )
    .join('\n      ');

  const body = `
    ${ambient}
    <path d="${outer}" fill="url(#${idp}-glass)"/>
    <g clip-path="url(#${idp}-clip)">
      ${texture}
      <circle cx="256" cy="500" r="190" fill="url(#${idp}-floor)"/>
      <circle cx="256" cy="256" r="190" fill="url(#${idp}-halo)"/>
      <g style="isolation:isolate">
      ${glows}
      </g>
      ${beads}
      <ellipse cx="256" cy="-30" rx="330" ry="300" fill="url(#${idp}-sheen)"/>
    </g>
    <path d="${outer} ${inner}" fill="url(#${idp}-rim)" fill-rule="evenodd"/>
    <path d="${inner}" fill="none" stroke="url(#${idp}-rimhi)" stroke-width="2.5"/>`;

  return { defs, body };
}

function fullIconSvg(size) {
  const art = appIconArt('bk');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <title>Beekeeper</title>
  <defs>${art.defs}</defs>
  ${art.body}
</svg>
`;
}

/* ------------------------------------------------------------------------------------------ */
/* 16 px pixel-grid helpers: hand-snapped hexagon with 1 px strokes and 2:1 diagonals          */
/* ------------------------------------------------------------------------------------------ */

/** Hexagon outline, one string per pixel row: 1 px stroke with 2:1 diagonals. */
const PIXEL_HEX_OUTLINE = [
  '.......##.......',
  '.....##..##.....',
  '...##......##...',
  '.##..........##.',
  ...Array.from({ length: 8 }, () => '.#............#.'),
  '.##..........##.',
  '...##......##...',
  '.....##..##.....',
  '.......##.......',
];

/** Pixel set of the outline, or of the whole filled silhouette when `fill` is set. */
function hexPixels(fill = false) {
  const pixels = new Set();
  PIXEL_HEX_OUTLINE.forEach((row, y) => {
    const first = row.indexOf('#');
    const last = row.lastIndexOf('#');
    for (let x = first; x <= last; x++) {
      if (fill || row[x] === '#') pixels.add(`${x},${y}`);
    }
  });
  return pixels;
}

/** Pixels whose centres lie within `radius` of (cx, cy). */
function discPixels(cx, cy, radius, size) {
  const pixels = new Set();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) pixels.add(`${x},${y}`);
    }
  }
  return pixels;
}

/** Path of unit squares for a pixel set (horizontal runs merged). */
function pixelsPath(pixels) {
  const rows = new Map();
  for (const key of pixels) {
    const [x, y] = key.split(',').map(Number);
    rows.set(y, [...(rows.get(y) ?? []), x]);
  }
  let d = '';
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(y).sort((a, b) => a - b);
    let from = xs[0];
    xs.forEach((x, i) => {
      if (xs[i + 1] === x + 1) return;
      d += `M${from} ${y}h${x + 1 - from}v1h${from - x - 1}Z`;
      from = xs[i + 1];
    });
  }
  return d;
}

/** 3 x 3 pixel dot: a solid plus with softened corners, centred on the pixel containing (x, y). */
function pixelDot(x, y, color) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const plus = `M${px} ${py - 1}h1v3h-1zM${px - 1} ${py}h3v1h-3z`;
  let corners = '';
  for (const dy of [-1, 1]) {
    for (const dx of [-1, 1]) corners += `M${px + dx} ${py + dy}h1v1h-1z`;
  }
  return `<path d="${plus}" fill="${color}" shape-rendering="crispEdges"/>
    <path d="${corners}" fill="${color}" fill-opacity=".62" shape-rendering="crispEdges"/>`;
}

/* ------------------------------------------------------------------------------------------ */
/* Compact app icon (16 - 64 px): simplified, thicker rim, designed on the pixel grid          */
/* ------------------------------------------------------------------------------------------ */

const COMPACT_ICON = {
  16: { pixel: true, dotD: 3.5, swirl: 0.5 },
  24: { apothem: 10, corner: 2.2, rim: 2, dotD: 4, dotR: 2, swirl: 0 },
  32: { apothem: 14, corner: 3, rim: 3, dotD: 6, dotR: 3, swirl: 0 },
  48: { apothem: 20, corner: 4.5, rim: 3, dotD: 9, dotR: 5, swirl: 0 },
  64: { apothem: 26, corner: 6, rim: 4, dotD: 12, dotR: 7, swirl: 0 },
};

function compactIconSvg(size) {
  const m = COMPACT_ICON[size];
  const c = size / 2;
  const polished = size >= 48;
  const outer = m.pixel ? pixelsPath(hexPixels(true)) : roundedHexPath(c, c, m.apothem, m.corner);
  const rim = m.pixel
    ? pixelsPath(hexPixels())
    : `${outer} ${roundedHexPath(c, c, m.apothem - m.rim, Math.max(m.corner - m.rim, 0.5))}`;
  const crisp = m.pixel ? ' shape-rendering="crispEdges"' : '';
  const dots = orbDots(c, c, m.dotD, m.dotR, m.swirl);
  const beadFill = (name) => (polished ? `url(#bk-bead-${name})` : COLORS[name].base);
  const beadDefs = polished
    ? dots
        .map(
          (d) => `<linearGradient id="bk-bead-${d.name}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLORS[d.name].mid}"/>
      <stop offset="1" stop-color="${COLORS[d.name].base}"/>
    </linearGradient>`,
        )
        .join('\n    ')
    : '';
  const halo = polished
    ? `<radialGradient id="bk-halo" cx="${c}" cy="${c}" r="${n(m.dotD + m.dotR * 1.8)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B9A4FF" stop-opacity=".3"/>
      <stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/>
    </radialGradient>`
    : '';
  const haloShape = polished
    ? `<circle cx="${c}" cy="${c}" r="${n(m.dotD + m.dotR * 1.8)}" fill="url(#bk-halo)"/>`
    : '';
  const circles = dots
    .map((d) =>
      m.pixel
        ? pixelDot(d.x, d.y, COLORS[d.name].base)
        : `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${n(d.r)}" fill="${beadFill(d.name)}"/>`,
    )
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bk-fill" x1="0" y1="0" x2="0" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#271D4B"/>
      <stop offset="1" stop-color="#110C22"/>
    </linearGradient>
    <linearGradient id="bk-rim" x1="0" y1="0" x2="0" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFC933"/>
      <stop offset="1" stop-color="#FFA000"/>
    </linearGradient>
    ${beadDefs}
    ${halo}
  </defs>
  <path d="${outer}" fill="url(#bk-fill)"${crisp}/>
  ${haloShape}
  ${circles}
  <path d="${rim}" fill="url(#bk-rim)"${m.pixel ? crisp : ' fill-rule="evenodd"'}/>
</svg>
`;
}

/* ------------------------------------------------------------------------------------------ */
/* Tray glyphs (16 / 20 / 24 / 32 px): outline hexagon + orb, audio bars while listening       */
/* ------------------------------------------------------------------------------------------ */

const TRAY_THEMES = {
  light: {
    outline: '#1C1B22',
    dots: { honey: '#F5A300', coral: '#F2494F', violet: '#6B3CF0', cyan: '#00A9C0' },
  },
  dark: {
    outline: '#FFFFFF',
    dots: { honey: '#FFB300', coral: '#FF5A5F', violet: '#8A5CFF', cyan: '#00BCD4' },
  },
};

/**
 * Per-size metrics, all in pixels of the target canvas. Bars pulse between `outer` (first and
 * last bar) and `inner` (middle bars) heights, always in multiples of 2 so they stay centred on
 * the pixel grid. 16 px is drawn pixel by pixel; the others are vector shapes snapped to pixels.
 */
const TRAY = {
  16: {
    pixel: true,
    dot: { d: 3.5, r: 1.5, swirl: 0.5 },
    bars: { w: 1, pitch: 3, radius: 0, outer: [2, 6], inner: [2, 10] },
    badge: { x: 13, y: 13, r: 2, knock: 4 },
  },
  20: {
    apothem: 8.5,
    squash: 0.95,
    corner: 1.8,
    stroke: 1,
    dot: { d: 4, r: 2, swirl: 0 },
    bars: { w: 2, pitch: 4, radius: 0, outer: [2, 8], inner: [2, 12] },
    badge: { x: 16, y: 16, r: 2.5, knock: 3.7 },
  },
  24: {
    apothem: 10.25,
    squash: 0.955,
    corner: 2.2,
    stroke: 1.5,
    dot: { d: 4.5, r: 2.5, swirl: 0.5 },
    bars: { w: 2, pitch: 4, radius: 0, outer: [2, 10], inner: [2, 14] },
    badge: { x: 19, y: 19, r: 3, knock: 4.4 },
  },
  32: {
    apothem: 13,
    corner: 2.2,
    stroke: 2,
    dot: { d: 6, r: 3, swirl: 0 },
    bars: { w: 3, pitch: 5, radius: 1, outer: [4, 12], inner: [4, 20] },
    badge: { x: 26, y: 26, r: 4, knock: 5.8 },
  },
};

/** Bar heights for one frame of the 8-frame loop: a wave travelling across the four bars. */
function barHeights(frame, { outer, inner }) {
  return [outer, inner, inner, outer].map(([low, high], i) => {
    const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * frame) / 8 - (i * Math.PI) / 2);
    return Math.round((low + (high - low) * wave) / 2) * 2;
  });
}

function trayGlyphSvg(px, { theme, state, frame = 0 }) {
  const m = TRAY[px];
  const t = TRAY_THEMES[theme];
  const c = px / 2;
  const armed = state === 'armed';
  const b = m.badge;
  let orb;
  if (state === 'listening') {
    const heights = barHeights(frame, m.bars);
    const x0 = c - (3 * m.bars.pitch + m.bars.w) / 2;
    orb = DOT_ORDER.map((name, i) => {
      const h = heights[i];
      return `<rect x="${n(x0 + i * m.bars.pitch)}" y="${n(c - h / 2)}" width="${n(m.bars.w)}" height="${n(h)}" rx="${n(m.bars.radius)}" fill="${t.dots[name]}"/>`;
    }).join('\n    ');
  } else {
    orb = orbDots(c, c, m.dot.d, m.dot.r, m.dot.swirl)
      .map((d) =>
        m.pixel
          ? pixelDot(d.x, d.y, t.dots[d.name])
          : `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${n(d.r)}" fill="${t.dots[d.name]}"/>`,
      )
      .join('\n    ');
  }

  let outline;
  let defs = '';
  let badge = '';
  let mask = '';
  if (m.pixel) {
    const pixels = hexPixels();
    if (armed) {
      for (const key of discPixels(b.x, b.y, b.knock, px)) pixels.delete(key);
      badge = `<path d="${pixelsPath(discPixels(b.x, b.y, b.r, px))}" fill="${t.dots.coral}" shape-rendering="crispEdges"/>`;
    }
    outline = `<path d="${pixelsPath(pixels)}" fill="${t.outline}" shape-rendering="crispEdges"/>`;
  } else {
    outline = `<path d="${roundedHexPath(c, c, m.apothem, m.corner, m.squash)}" fill="none" stroke="${t.outline}" stroke-width="${n(m.stroke)}" stroke-linejoin="round"/>`;
    if (armed) {
      defs = `<mask id="bk-ko" maskUnits="userSpaceOnUse" x="0" y="0" width="${px}" height="${px}">
      <rect width="${px}" height="${px}" fill="#fff"/>
      <circle cx="${n(b.x)}" cy="${n(b.y)}" r="${n(b.knock)}" fill="#000"/>
    </mask>`;
      mask = ' mask="url(#bk-ko)"';
      badge = `<circle cx="${n(b.x)}" cy="${n(b.y)}" r="${n(b.r)}" fill="${t.dots.coral}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <defs>${defs}</defs>
  <g${mask}>
    ${outline}
    ${orb}
  </g>
  ${badge}
</svg>
`;
}

/* ------------------------------------------------------------------------------------------ */
/* Rendering + encoders                                                                        */
/* ------------------------------------------------------------------------------------------ */

function renderSvg(svg, width, { text = false } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: text
      ? { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' }
      : { loadSystemFonts: false },
  });
  const image = resvg.render();
  return { png: image.asPng(), pixels: image.pixels, width: image.width, height: image.height };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** ICO container (ICONDIR + ICONDIRENTRY[]) holding one PNG-compressed image per size. */
function encodeIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const head = Buffer.alloc(6 + 16 * sorted.length);
  head.writeUInt16LE(1, 2); // image type: icon
  head.writeUInt16LE(sorted.length, 4);
  let offset = head.length;
  sorted.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at); // 0 stands for 256
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...sorted.map((image) => image.png)]);
}

function readIco(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO file');
  }
  return Array.from({ length: buffer.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const offset = buffer.readUInt32LE(at + 12);
    return {
      width: buffer[at] || 256,
      height: buffer[at + 1] || 256,
      bits: buffer.readUInt16LE(at + 6),
      png: buffer.subarray(offset, offset + buffer.readUInt32LE(at + 8)),
    };
  });
}

/** Uncompressed 24-bit BMP (bottom-up rows padded to 4 bytes), the format NSIS requires. */
function encodeBmp24({ pixels, width, height }) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowBytes * height);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10); // pixel data offset
  out.writeUInt32LE(40, 14); // BITMAPINFOHEADER size
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowBytes * height, 34);
  out.writeInt32LE(2835, 38); // 72 dpi
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    let at = 54 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (pixels[p + 3] !== 255) throw new Error('BMP artwork must be fully opaque');
      out[at++] = pixels[p + 2];
      out[at++] = pixels[p + 1];
      out[at++] = pixels[p];
    }
  }
  return out;
}

function readBmp(buffer) {
  if (buffer.length < 54 || buffer.toString('latin1', 0, 2) !== 'BM') {
    throw new Error('not a BMP file');
  }
  return {
    width: buffer.readInt32LE(18),
    height: buffer.readInt32LE(22),
    bits: buffer.readUInt16LE(28),
    compression: buffer.readUInt32LE(30),
    fileSize: buffer.readUInt32LE(2),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Brand art: banner, installer artwork, logo                                                  */
/* ------------------------------------------------------------------------------------------ */

const WORDMARK = 'Beekeeper';
const TAGLINE = 'Voice-first desktop assistant for Windows';
const FONT_DISPLAY = "'Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',sans-serif";
const FONT_TEXT = "'Segoe UI Variable Text','Segoe UI',sans-serif";

/** Dark glass gradient with soft colour glows and a faint honeycomb lattice. */
function backdrop(idp, width, height, { glows, cell, focus }) {
  const defs = `
    <linearGradient id="${idp}-base" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#171031"/>
      <stop offset=".55" stop-color="#1B1236"/>
      <stop offset="1" stop-color="#0A0716"/>
    </linearGradient>
    ${glows
      .map(
        (
          glow,
          i,
        ) => `<radialGradient id="${idp}-glow${i}" cx="${n(glow.x)}" cy="${n(glow.y)}" r="${n(glow.r)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${glow.color}" stop-opacity="${glow.opacity}"/>
      <stop offset="1" stop-color="${glow.color}" stop-opacity="0"/>
    </radialGradient>`,
      )
      .join('\n    ')}
    <radialGradient id="${idp}-cells" cx="${n(focus.x)}" cy="${n(focus.y)}" r="${n(focus.r)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity="${focus.opacity}"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>`;
  const body = `<rect width="${width}" height="${height}" fill="url(#${idp}-base)"/>
  ${glows.map((_, i) => `<rect width="${width}" height="${height}" fill="url(#${idp}-glow${i})" style="mix-blend-mode:screen"/>`).join('\n  ')}
  <path d="${latticePath(width / 2, height / 2, cell, Math.hypot(width, height) / 2)}" fill="none" stroke="url(#${idp}-cells)" stroke-width="1.4" stroke-linejoin="round"/>`;
  return { defs, body };
}

function bannerSvg() {
  const width = 1280;
  const height = 400;
  const iconSize = 288;
  const iconX = 156;
  const iconY = (height - iconSize) / 2;
  const textX = iconX + iconSize + 40;
  const art = appIconArt('bk');
  const backdropArt = backdrop('bn', width, height, {
    glows: [
      { x: iconX + iconSize / 2, y: 200, r: 250, color: '#FFB300', opacity: 0.42 },
      { x: iconX + iconSize / 2, y: 200, r: 460, color: '#FF8A3D', opacity: 0.1 },
      { x: 1090, y: 30, r: 620, color: '#7C4DFF', opacity: 0.4 },
      { x: 1280, y: 400, r: 420, color: '#FF5A5F', opacity: 0.16 },
      { x: 700, y: 430, r: 460, color: '#00BCD4', opacity: 0.12 },
    ],
    cell: 46,
    focus: { x: 1040, y: 60, r: 760, opacity: 0.1 },
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${WORDMARK} — ${TAGLINE}</title>
  <defs>
    ${backdropArt.defs}
    ${art.defs}
    <linearGradient id="bn-word" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#D9D0FF"/>
    </linearGradient>
    <linearGradient id="bn-edge" x1="0" y1="0" x2="0" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset=".3" stop-color="#fff" stop-opacity=".04"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".1"/>
    </linearGradient>
    <filter id="bn-shadow" x="-10%" y="-30%" width="120%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#000" flood-opacity=".45"/></filter>
  </defs>
  ${backdropArt.body}
  <g transform="translate(${iconX} ${n(iconY)}) scale(${n(iconSize / 512)})">${art.body}</g>
  <text x="${textX}" y="214" font-family="${FONT_DISPLAY}" font-size="132" font-weight="600" letter-spacing="-3" fill="url(#bn-word)" filter="url(#bn-shadow)">${WORDMARK}</text>
  <text x="${textX + 4}" y="282" font-family="${FONT_TEXT}" font-size="34" letter-spacing=".4" fill="#CBC4E8">${TAGLINE}</text>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" fill="none" stroke="url(#bn-edge)"/>
</svg>
`;
}

function sidebarSvg() {
  const width = 164;
  const height = 314;
  const art = appIconArt('bk');
  const backdropArt = backdrop('sb', width, height, {
    glows: [
      { x: 82, y: 110, r: 150, color: '#FFB300', opacity: 0.26 },
      { x: 164, y: 300, r: 200, color: '#7C4DFF', opacity: 0.3 },
      { x: 0, y: 314, r: 150, color: '#00BCD4', opacity: 0.12 },
    ],
    cell: 20,
    focus: { x: 82, y: 314, r: 220, opacity: 0.1 },
  });
  const iconSize = 124;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${backdropArt.defs}
    ${art.defs}
  </defs>
  ${backdropArt.body}
  <g transform="translate(${n((width - iconSize) / 2)} 62) scale(${n(iconSize / 512)})">${art.body}</g>
  <text x="82" y="236" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="26" font-weight="600" letter-spacing="-.4" fill="#fff">${WORDMARK}</text>
  <text x="82" y="260" text-anchor="middle" font-family="${FONT_TEXT}" font-size="11" fill="#BDB6DA">Voice-first desktop</text>
  <text x="82" y="275" text-anchor="middle" font-family="${FONT_TEXT}" font-size="11" fill="#BDB6DA">assistant for Windows</text>
</svg>
`;
}

function headerSvg() {
  const width = 150;
  const height = 57;
  const art = appIconArt('bk');
  const backdropArt = backdrop('hd', width, height, {
    glows: [
      { x: 30, y: 28, r: 70, color: '#FFB300', opacity: 0.26 },
      { x: 150, y: 0, r: 120, color: '#7C4DFF', opacity: 0.3 },
    ],
    cell: 14,
    focus: { x: 150, y: 0, r: 130, opacity: 0.1 },
  });
  const iconSize = 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${backdropArt.defs}
    ${art.defs}
  </defs>
  ${backdropArt.body}
  <g transform="translate(9 ${n((height - iconSize) / 2)}) scale(${n(iconSize / 512)})">${art.body}</g>
  <text x="60" y="34" font-family="${FONT_DISPLAY}" font-size="16" font-weight="600" letter-spacing="-.2" fill="#fff">${WORDMARK}</text>
</svg>
`;
}

/** Horizontal lockup; the wordmark turns white in dark colour schemes where CSS media apply. */
function logoSvg() {
  const art = appIconArt('bk');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="320" viewBox="0 0 1040 320">
  <title>${WORDMARK}</title>
  <style>
    .wordmark { fill: #1E1637; }
    @media (prefers-color-scheme: dark) { .wordmark { fill: #FFFFFF; } }
  </style>
  <defs>${art.defs}</defs>
  <g transform="translate(0 32) scale(.5)">${art.body}</g>
  <text class="wordmark" x="296" y="214" font-family="${FONT_DISPLAY}" font-size="150" font-weight="600" letter-spacing="-3">${WORDMARK}</text>
</svg>
`;
}

/* ------------------------------------------------------------------------------------------ */
/* Pipeline                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** Windows loads tray icons at the system small-icon size: 16 / 20 / 24 / 32 px at 100 - 200 %. */
const TRAY_ICO_SIZES = [16, 20, 24, 32];
const TRAY_THEME_NAMES = ['light', 'dark'];
const TRAY_STATES = [
  { id: 'idle', state: 'idle', frame: 0 },
  { id: 'armed', state: 'armed', frame: 0 },
  ...Array.from({ length: 8 }, (_, frame) => ({
    id: `listening-${frame}`,
    state: 'listening',
    frame,
  })),
];

const written = [];
const warnings = [];

/** OneDrive briefly locks freshly written files, so transient EBUSY / EPERM errors are retried. */
async function writeWithRetry(target, content) {
  for (let attempt = 1; ; attempt++) {
    try {
      await writeFile(target, content);
      return;
    } catch (error) {
      const transient = ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
      if (!transient || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

async function writeAsset(rel, data, group, expect) {
  const content = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const target = path.join(ROOT, rel);
  await mkdir(path.dirname(target), { recursive: true });
  let status = 'new';
  if (existsSync(target)) {
    status = (await readFile(target)).equals(content) ? 'unchanged' : 'updated';
  }
  if (status !== 'unchanged') await writeWithRetry(target, content);
  written.push({ rel, group, bytes: content.length, status, expect });
}

/** Fails when anything painted reaches the outermost pixel ring (a clipped glow or shape). */
function assertNotClipped(label, { pixels, width, height }, maxAlpha = 3) {
  const check = (x, y) => {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha > maxAlpha)
      throw new Error(`${label}: artwork touches the canvas edge (alpha ${alpha})`);
  };
  for (let i = 0; i < width; i++) {
    check(i, 0);
    check(i, height - 1);
  }
  for (let j = 0; j < height; j++) {
    check(0, j);
    check(width - 1, j);
  }
}

/** The rounded hexagon (plus half its stroke) must lie inside the canvas: nothing is clipped. */
function assertHexFits(label, size, { apothem, corner, squash = 1, pixel }, stroke = 0) {
  if (pixel) return; // pixel-grid designs are bounded by their 16 x 16 span table
  const c = size / 2;
  const box = roundedPolygonBounds(hexVertices(c, c, apothem, squash), corner);
  const half = stroke / 2;
  const inside =
    box.minX - half >= -1e-6 &&
    box.minY - half >= -1e-6 &&
    box.maxX + half <= size + 1e-6 &&
    box.maxY + half <= size + 1e-6;
  if (!inside) throw new Error(`${label}: hexagon does not fit a ${size}px canvas`);
}

function appIconSvgFor(size) {
  return size <= 64 ? compactIconSvg(size) : fullIconSvg(size);
}

async function buildAppIcons() {
  const group = 'App icon';
  await writeAsset('assets/icon.svg', fullIconSvg(512), group, { svg: true });
  const renders = new Map();
  for (const size of ICON_SIZES) {
    const render = renderSvg(appIconSvgFor(size), size);
    if (size >= 128) assertNotClipped(`icon-${size}.png`, render);
    else assertHexFits(`icon-${size}.png`, size, COMPACT_ICON[size]);
    renders.set(size, render.png);
    await writeAsset(`assets/icons/icon-${size}.png`, render.png, group, { png: [size, size] });
  }
  const master = renderSvg(fullIconSvg(1024), 1024);
  assertNotClipped('icon.png', master);
  await writeAsset('assets/icon.png', master.png, group, { png: [1024, 1024] });
  const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: renders.get(size) })));
  await writeAsset('assets/icon.ico', ico, group, { ico: ICO_SIZES });
}

async function buildTrayIcons() {
  const group = 'Tray';
  for (const theme of TRAY_THEME_NAMES) {
    for (const { id, state, frame } of TRAY_STATES) {
      const label = `tray-${id}-${theme}`;
      const renders = new Map(
        TRAY_ICO_SIZES.map((px) => {
          assertHexFits(label, px, TRAY[px], TRAY[px].stroke);
          return [px, renderSvg(trayGlyphSvg(px, { theme, state, frame }), px).png];
        }),
      );
      await writeAsset(`assets/tray/${label}.png`, renders.get(16), group, { png: [16, 16] });
      await writeAsset(`assets/tray/${label}@2x.png`, renders.get(32), group, { png: [32, 32] });
      const ico = encodeIco(TRAY_ICO_SIZES.map((size) => ({ size, png: renders.get(size) })));
      await writeAsset(`assets/tray/${label}.ico`, ico, group, { ico: TRAY_ICO_SIZES });
    }
  }
}

/** Text artwork needs the Windows UI fonts; without them the committed files are left alone. */
function hasSegoeUi() {
  const fonts = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
  return ['segoeui.ttf', 'seguisb.ttf'].every((file) => existsSync(path.join(fonts, file)));
}

async function buildInstallerArt() {
  if (!hasSegoeUi()) {
    warnings.push('Segoe UI is not installed: installer artwork was not regenerated.');
    return;
  }
  const group = 'Installer';
  const sidebar = renderSvg(sidebarSvg(), 164, { text: true });
  await writeAsset('assets/installer/installer-sidebar.bmp', encodeBmp24(sidebar), group, {
    bmp: [164, 314],
  });
  const header = renderSvg(headerSvg(), 150, { text: true });
  await writeAsset('assets/installer/installer-header.bmp', encodeBmp24(header), group, {
    bmp: [150, 57],
  });
}

async function buildBrandArt() {
  const group = 'Brand';
  await writeAsset('assets/logo.svg', logoSvg(), group, { svg: true });
  if (!hasSegoeUi()) {
    warnings.push('Segoe UI is not installed: docs/banner.png was not regenerated.');
    return;
  }
  const banner = renderSvg(bannerSvg(), 1280, { text: true });
  await writeAsset('docs/banner.png', banner.png, group, { png: [1280, 400] });
}

/** Re-reads every written file and checks container structure and dimensions. */
async function verifyOutputs() {
  for (const entry of written) {
    const data = await readFile(path.join(ROOT, entry.rel));
    const { expect } = entry;
    const fail = (message) => {
      throw new Error(`${entry.rel}: ${message}`);
    };
    if (expect.svg && !data.toString('utf8').trimStart().startsWith('<svg')) fail('not an SVG');
    if (expect.png) {
      const size = readPngSize(data);
      if (size.width !== expect.png[0] || size.height !== expect.png[1]) {
        fail(`expected ${expect.png.join('x')}, found ${size.width}x${size.height}`);
      }
    }
    if (expect.bmp) {
      const bmp = readBmp(data);
      const ok =
        bmp.width === expect.bmp[0] &&
        bmp.height === expect.bmp[1] &&
        bmp.bits === 24 &&
        bmp.compression === 0 &&
        bmp.fileSize === data.length;
      if (!ok) fail('not a valid 24-bit uncompressed BMP of the expected size');
    }
    if (expect.ico) {
      const images = readIco(data);
      const sizes = images.map((image) => image.width);
      if (sizes.join() !== expect.ico.join()) fail(`unexpected ICO sizes ${sizes.join(',')}`);
      for (const image of images) {
        const size = readPngSize(image.png);
        if (size.width !== image.width || size.height !== image.height || image.bits !== 32) {
          fail(`ICO entry ${image.width} does not match its PNG payload`);
        }
      }
    }
  }
}

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function printSummary(seconds) {
  const groups = [...new Set(written.map((entry) => entry.group))];
  for (const group of groups) {
    const entries = written.filter((entry) => entry.group === group);
    console.log(`\n${group} (${entries.length} files)`);
    for (const entry of entries) {
      console.log(
        `  ${entry.status.padEnd(9)} ${entry.rel.padEnd(46)} ${formatBytes(entry.bytes).padStart(9)}`,
      );
    }
  }
  const count = (status) => written.filter((entry) => entry.status === status).length;
  const total = written.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(
    `\n${written.length} files, ${formatBytes(total)} - ${count('new')} new, ${count('updated')} updated, ${count('unchanged')} unchanged (${seconds.toFixed(1)}s)`,
  );
  for (const warning of warnings) console.warn(`warning: ${warning}`);
}

async function main() {
  const started = performance.now();
  await buildAppIcons();
  await buildTrayIcons();
  await buildInstallerArt();
  await buildBrandArt();
  await verifyOutputs();
  printSummary((performance.now() - started) / 1000);
}

main().catch((error) => {
  console.error(`\nIcon generation failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
