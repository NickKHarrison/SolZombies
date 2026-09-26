// WO2 3.2 — pixel grid parser, composition, canvas cache and drawing (Phase 0, FROZEN).
//
// A grid is an array of equal-length strings of PALETTE characters.
// A Sprite is { w, h, rows, pixels } where pixels is an RGBA Uint8ClampedArray (w*h*4).
//   - rows is the source grid for parsed sprites (and for flips/compositions of parsed sprites);
//     it is null for sprites whose colours no longer map to palette chars (e.g. tint()).
//   - placeholder: true marks stand-in art (see isPlaceholder). Propagates through
//     compose/tint/flipX/flipY.
//
// Everything here is pure and Node-safe EXCEPT toCanvas/drawSprite, which touch the DOM
// (document / OffscreenCanvas) lazily at call time only.

import { PALETTE } from './palette.js';
import { SPRITES } from '../config.js';

// ---------------------------------------------------------------------------------------------
// Colour parsing

const colourCache = new Map();

function parseColour(css) {
  if (css == null) return [0, 0, 0, 0];
  let c = colourCache.get(css);
  if (c) return c;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(css).trim());
  if (!m) throw new Error(`pixel: unsupported colour '${css}' (use #rgb, #rgba, #rrggbb or #rrggbbaa)`);
  let hex = m[1];
  if (hex.length <= 4) hex = hex.split('').map((ch) => ch + ch).join('');
  c = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
  ];
  colourCache.set(css, c);
  return c;
}

function makeSprite(w, h, rows, pixels, placeholder) {
  const s = { w, h, rows, pixels };
  if (placeholder) s.placeholder = true;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Parsing

// rows -> Sprite. Throws on empty/ragged rows or unknown characters.
export function parseGrid(rows, palette = PALETTE) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('parseGrid: rows must be a non-empty array of strings');
  const h = rows.length;
  const w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w === 0) throw new Error('parseGrid: rows must be non-empty strings');
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (typeof row !== 'string') throw new Error(`parseGrid: row ${y} is not a string`);
    if (row.length !== w) throw new Error(`parseGrid: ragged rows (row 0 has ${w} chars, row ${y} has ${row.length})`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (!Object.prototype.hasOwnProperty.call(palette, ch)) {
        throw new Error(`parseGrid: unknown palette char '${ch}' at (${x}, ${y})`);
      }
      const [r, g, b, a] = parseColour(palette[ch]);
      const i = (y * w + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  return makeSprite(w, h, rows.slice(), pixels, false);
}

// ---------------------------------------------------------------------------------------------
// Composition and transforms

// [{ sprite, dx = 0, dy = 0 }] -> Sprite the size of the first layer; later layers drawn over
// (src-over); alpha 0 pixels are skipped; pixels falling outside the first layer are clipped.
// rows are composed too when every layer has rows ('.' = transparent), otherwise null.
export function compose(layers) {
  if (!Array.isArray(layers) || layers.length === 0 || !layers[0] || !layers[0].sprite) {
    throw new Error('compose: need at least one { sprite } layer');
  }
  const base = layers[0].sprite;
  const w = base.w, h = base.h;
  const out = new Uint8ClampedArray(w * h * 4);
  let placeholder = false;
  let rowChars = layers.every((l) => l && l.sprite && Array.isArray(l.sprite.rows))
    ? Array.from({ length: h }, () => new Array(w).fill('.'))
    : null;

  for (const layer of layers) {
    if (!layer || !layer.sprite) continue;
    const s = layer.sprite;
    const dx = Math.round(layer.dx || 0), dy = Math.round(layer.dy || 0);
    if (isPlaceholder(s)) placeholder = true;
    const src = s.pixels;
    for (let sy = 0; sy < s.h; sy++) {
      const ty = sy + dy;
      if (ty < 0 || ty >= h) continue;
      for (let sx = 0; sx < s.w; sx++) {
        const tx = sx + dx;
        if (tx < 0 || tx >= w) continue;
        const si = (sy * s.w + sx) * 4;
        const a = src[si + 3];
        if (a === 0) continue;
        const ti = (ty * w + tx) * 4;
        if (a === 255 || out[ti + 3] === 0) {
          out[ti] = src[si]; out[ti + 1] = src[si + 1]; out[ti + 2] = src[si + 2]; out[ti + 3] = a;
        } else {
          const sa = a / 255, da = out[ti + 3] / 255;
          const oa = sa + da * (1 - sa);
          for (let k = 0; k < 3; k++) {
            out[ti + k] = (src[si + k] * sa + out[ti + k] * da * (1 - sa)) / oa;
          }
          out[ti + 3] = oa * 255;
        }
        if (rowChars) rowChars[ty][tx] = s.rows[sy][sx];
      }
    }
  }
  const rows = rowChars ? rowChars.map((r) => r.join('')) : null;
  return makeSprite(w, h, rows, out, placeholder);
}

// mapFn(r, g, b, a, x, y) -> [r, g, b, a]; returns a new Sprite (rows = null).
export function tint(sprite, mapFn) {
  const { w, h, pixels } = sprite;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const res = mapFn(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3], x, y);
      if (res) { out[i] = res[0]; out[i + 1] = res[1]; out[i + 2] = res[2]; out[i + 3] = res[3]; }
      else { out[i] = pixels[i]; out[i + 1] = pixels[i + 1]; out[i + 2] = pixels[i + 2]; out[i + 3] = pixels[i + 3]; }
    }
  }
  return makeSprite(w, h, null, out, isPlaceholder(sprite));
}

export function flipX(sprite) {
  const { w, h, pixels } = sprite;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, ti = (y * w + (w - 1 - x)) * 4;
      out[ti] = pixels[si]; out[ti + 1] = pixels[si + 1]; out[ti + 2] = pixels[si + 2]; out[ti + 3] = pixels[si + 3];
    }
  }
  const rows = Array.isArray(sprite.rows) ? sprite.rows.map((r) => r.split('').reverse().join('')) : null;
  return makeSprite(w, h, rows, out, isPlaceholder(sprite));
}

export function flipY(sprite) {
  const { w, h, pixels } = sprite;
  const out = new Uint8ClampedArray(pixels.length);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    out.set(pixels.subarray(y * stride, (y + 1) * stride), (h - 1 - y) * stride);
  }
  const rows = Array.isArray(sprite.rows) ? sprite.rows.slice().reverse() : null;
  return makeSprite(w, h, rows, out, isPlaceholder(sprite));
}

// ---------------------------------------------------------------------------------------------
// Identity

const keyCache = new WeakMap();

// Stable, content-based string id (same pixels -> same key), memoized per sprite object.
export function spriteKey(sprite) {
  let k = keyCache.get(sprite);
  if (k) return k;
  let hash = 0x811c9dc5; // FNV-1a 32
  const p = sprite.pixels;
  for (let i = 0; i < p.length; i++) {
    hash ^= p[i];
    hash = Math.imul(hash, 0x01000193);
  }
  k = `${sprite.w}x${sprite.h}:${(hash >>> 0).toString(36)}`;
  keyCache.set(sprite, k);
  return k;
}

// ---------------------------------------------------------------------------------------------
// Placeholder

function checkerRows(w, h, cell) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) ? 'x' : 'k';
    rows.push(r);
  }
  return rows;
}

// Extra helper (not in the 3.2 list): a w x h magenta/black checker Sprite flagged as placeholder.
// Stubs use it for non-16x16 placeholders (face 24x30, down 20x20, guns).
export function placeholderSprite(w = 16, h = 16) {
  const s = parseGrid(checkerRows(w, h, 4));
  s.placeholder = true;
  return Object.freeze(s);
}

// 16x16 magenta/black checker (4-px cells).
export const PLACEHOLDER = placeholderSprite(16, 16);

// True for PLACEHOLDER, anything built by placeholderSprite, anything composed/tinted/flipped
// from a placeholder, and any sprite whose rows still contain the placeholder char 'x'.
export function isPlaceholder(sprite) {
  if (!sprite || typeof sprite !== 'object') return false;
  if (sprite === PLACEHOLDER || sprite.placeholder === true) return true;
  if (Array.isArray(sprite.rows)) {
    for (const r of sprite.rows) if (typeof r === 'string' && r.includes('x')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Angle helper

// Rounds angle to the nearest multiple of 2*PI/directions. directions <= 0 (or not a number)
// returns the angle unchanged. Not wrapped: the result stays near the input (e.g. -0.1 -> -0).
export function quantizeAngle(angle, directions) {
  if (!(directions > 0)) return angle;
  const step = (Math.PI * 2) / directions;
  return Math.round(angle / step) * step;
}

// ---------------------------------------------------------------------------------------------
// DOM (lazy): canvas cache + drawing

const CANVAS_CACHE_MAX = 4096;
const canvasCache = new Map(); // `${spriteKey}@${scale}` -> canvas

function createCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('pixel.toCanvas: no canvas implementation available (needs a DOM or OffscreenCanvas)');
}

// Cached canvas of the sprite at an integer scale (nearest-neighbour upscaled in software).
export function toCanvas(sprite, scale = 1) {
  const s = Math.max(1, Math.round(scale) || 1);
  const key = `${spriteKey(sprite)}@${s}`;
  let c = canvasCache.get(key);
  if (c) return c;
  const W = sprite.w * s, H = sprite.h * s;
  c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(W, H);
  const src = sprite.pixels, dst = img.data;
  for (let y = 0; y < H; y++) {
    const sy = (y / s) | 0;
    for (let x = 0; x < W; x++) {
      const si = (sy * sprite.w + ((x / s) | 0)) * 4;
      const di = (y * W + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  if (canvasCache.size >= CANVAS_CACHE_MAX) canvasCache.delete(canvasCache.keys().next().value);
  canvasCache.set(key, c);
  return c;
}

// Draws sprite with anchor (ax, ay in sprite px) at (x, y) in ctx units, rotated by angle
// quantized to `directions` steps, image smoothing off. ctx state is saved/restored.
export function drawSprite(ctx, sprite, x, y, opts = {}) {
  const scale = opts.scale ?? SPRITES.scale;
  const angle = opts.angle ?? 0;
  const ax = opts.ax ?? sprite.w / 2;
  const ay = opts.ay ?? sprite.h / 2;
  const alpha = opts.alpha ?? 1;
  const directions = opts.directions ?? SPRITES.directions;
  const canvas = toCanvas(sprite, Math.ceil(scale));
  ctx.save();
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    const a = quantizeAngle(angle, directions);
    if (a) ctx.rotate(a);
    ctx.drawImage(canvas, -ax * scale, -ay * scale, sprite.w * scale, sprite.h * scale);
  } finally {
    ctx.restore();
  }
}
