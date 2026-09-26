// WO2 Phase 0 — src/sprites/pixel.js unit tests (parse, compose, flip, tint, quantize, placeholder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGrid, compose, tint, flipX, flipY, spriteKey, quantizeAngle,
  PLACEHOLDER, isPlaceholder, placeholderSprite, toCanvas, drawSprite,
} from '../src/sprites/pixel.js';
import { PALETTE } from '../src/sprites/palette.js';

const px = (s, x, y) => Array.from(s.pixels.slice((y * s.w + x) * 4, (y * s.w + x) * 4 + 4));

test('palette: frozen, transparent dot, all colours are #rrggbb', () => {
  assert.ok(Object.isFrozen(PALETTE));
  assert.equal(PALETTE['.'], null);
  for (const [ch, c] of Object.entries(PALETTE)) {
    if (ch === '.') continue;
    assert.match(c, /^#[0-9a-f]{6}$/i, ch);
  }
  assert.equal(Object.keys(PALETTE).length, 28);
});

test('parseGrid: size, rows and RGBA pixels', () => {
  const s = parseGrid(['k.', '.w', 'Rx']);
  assert.equal(s.w, 2);
  assert.equal(s.h, 3);
  assert.deepEqual(s.rows, ['k.', '.w', 'Rx']);
  assert.ok(s.pixels instanceof Uint8ClampedArray);
  assert.equal(s.pixels.length, 2 * 3 * 4);
  assert.deepEqual(px(s, 0, 0), [0x0b, 0x0b, 0x0d, 255]);
  assert.deepEqual(px(s, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(s, 1, 1), [0xf2, 0xf2, 0xf2, 255]);
  assert.deepEqual(px(s, 0, 2), [0xd9, 0x26, 0x26, 255]);
});

test('parseGrid: ragged rows throw', () => {
  assert.throws(() => parseGrid(['kk', 'k']), /ragged/);
});

test('parseGrid: unknown char throws (palette is case-sensitive)', () => {
  assert.throws(() => parseGrid(['kZ']), /unknown palette char/);
  assert.throws(() => parseGrid(['k ']), /unknown palette char/);
});

test('parseGrid: empty input throws; custom palette works', () => {
  assert.throws(() => parseGrid([]));
  assert.throws(() => parseGrid(['']));
  const s = parseGrid(['ab'], { a: '#ff0000', b: null });
  assert.deepEqual(px(s, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(s, 1, 0), [0, 0, 0, 0]);
});

test('compose: size of first layer, later layers over, transparent skipped, offsets clipped', () => {
  const base = parseGrid(['kkk', 'kkk', 'kkk']);
  const top = parseGrid(['w.', '.w']);
  const c = compose([{ sprite: base }, { sprite: top, dx: 1, dy: 1 }]);
  assert.equal(c.w, 3);
  assert.equal(c.h, 3);
  assert.deepEqual(c.rows, ['kkk', 'kwk', 'kkw']);
  assert.deepEqual(px(c, 1, 1), [0xf2, 0xf2, 0xf2, 255]);
  assert.deepEqual(px(c, 2, 1), [0x0b, 0x0b, 0x0d, 255]); // transparent pixel of top skipped
  const clipped = compose([{ sprite: base }, { sprite: top, dx: 2, dy: 2 }]);
  assert.deepEqual(clipped.rows, ['kkk', 'kkk', 'kkw']);
  const neg = compose([{ sprite: base }, { sprite: top, dx: -1, dy: -1 }]);
  assert.deepEqual(neg.rows, ['wkk', 'kkk', 'kkk']);
  assert.deepEqual(base.rows, ['kkk', 'kkk', 'kkk']); // inputs untouched
});

test('compose: transparent base takes the overlay colour', () => {
  const c = compose([{ sprite: parseGrid(['..']) }, { sprite: parseGrid(['R.']) }]);
  assert.deepEqual(px(c, 0, 0), [0xd9, 0x26, 0x26, 255]);
  assert.deepEqual(px(c, 1, 0), [0, 0, 0, 0]);
});

test('flipX / flipY mirror pixels and rows', () => {
  const s = parseGrid(['kw', 'R.']);
  const fx = flipX(s);
  assert.deepEqual(fx.rows, ['wk', '.R']);
  assert.deepEqual(px(fx, 0, 0), px(s, 1, 0));
  const fy = flipY(s);
  assert.deepEqual(fy.rows, ['R.', 'kw']);
  assert.deepEqual(px(fy, 0, 0), px(s, 0, 1));
  assert.deepEqual(flipX(flipX(s)).pixels, s.pixels);
});

test('tint maps every pixel with coordinates and returns a new sprite', () => {
  const s = parseGrid(['kw']);
  const seen = [];
  const t = tint(s, (r, g, b, a, x, y) => { seen.push([x, y]); return [255 - r, g, b, a]; });
  assert.deepEqual(seen, [[0, 0], [1, 0]]);
  assert.equal(t.pixels[0], 255 - 0x0b);
  assert.equal(s.pixels[0], 0x0b);
  assert.equal(t.rows, null);
});

test('spriteKey: stable and content-based', () => {
  const a = parseGrid(['kw']), b = parseGrid(['kw']), c = parseGrid(['wk']);
  assert.equal(typeof spriteKey(a), 'string');
  assert.equal(spriteKey(a), spriteKey(a));
  assert.equal(spriteKey(a), spriteKey(b));
  assert.notEqual(spriteKey(a), spriteKey(c));
  assert.notEqual(spriteKey(parseGrid(['k.', '..'])), spriteKey(parseGrid(['k...'])));
});

test('quantizeAngle', () => {
  const step = Math.PI * 2 / 32;
  assert.equal(quantizeAngle(0, 32), 0);
  assert.ok(Math.abs(quantizeAngle(step * 0.4, 32)) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(step * 0.6, 32) - step) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(Math.PI / 2 + 0.01, 32) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(-step * 1.4, 32) + step) < 1e-12);
  assert.equal(quantizeAngle(1.2345, 0), 1.2345);
  assert.equal(quantizeAngle(1.2345, -4), 1.2345);
  assert.ok(Math.abs(quantizeAngle(1.0, 4) - Math.PI / 2) < 1e-12);
});

test('PLACEHOLDER and isPlaceholder', () => {
  assert.equal(PLACEHOLDER.w, 16);
  assert.equal(PLACEHOLDER.h, 16);
  assert.ok(isPlaceholder(PLACEHOLDER));
  assert.ok(PLACEHOLDER.rows.join('').includes('x'));
  assert.ok(PLACEHOLDER.rows.join('').includes('k'));
  const p = placeholderSprite(24, 30);
  assert.equal(p.w, 24);
  assert.equal(p.h, 30);
  assert.ok(isPlaceholder(p));
  const real = parseGrid(['kw', 'wk']);
  assert.ok(!isPlaceholder(real));
  assert.ok(!isPlaceholder(null));
  assert.ok(isPlaceholder(compose([{ sprite: parseGrid(['k'.repeat(16)]) }, { sprite: PLACEHOLDER }])));
  assert.ok(isPlaceholder(flipX(PLACEHOLDER)));
  assert.ok(isPlaceholder(tint(PLACEHOLDER, (r, g, b, a) => [r, g, b, a])));
  assert.ok(isPlaceholder(parseGrid(['kx'])), 'a stray x pixel counts as placeholder');
});

test('pixel.js imports in Node; DOM functions fail only when called without a canvas', () => {
  assert.equal(typeof toCanvas, 'function');
  assert.equal(typeof drawSprite, 'function');
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    assert.throws(() => toCanvas(parseGrid(['k']), 2), /canvas/);
  }
});

test('drawSprite: smoothing off, quantized rotation, anchor offset, state restored', () => {
  const calls = [];
  const ctx = {
    imageSmoothingEnabled: true, globalAlpha: 1,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate(a) { calls.push(['rotate', a]); },
    drawImage(c, x, y, w, h) { calls.push(['drawImage', this.imageSmoothingEnabled, x, y, w, h]); },
  };
  // Minimal OffscreenCanvas so toCanvas can run under Node.
  const hadOC = 'OffscreenCanvas' in globalThis;
  const prev = globalThis.OffscreenCanvas;
  const stubbed = typeof document === 'undefined';
  if (stubbed) {
    globalThis.OffscreenCanvas = class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() {
        return { imageSmoothingEnabled: true, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
      }
    };
  }
  try {
    const s = parseGrid(['KKKK', 'KKKK']);
    drawSprite(ctx, s, 10, 20, { scale: 2, angle: 0.1, directions: 4, ax: 1, ay: 0 });
    drawSprite(ctx, s, 0, 0, { scale: 2, angle: 1.0, directions: 4 });
    assert.deepEqual(calls[0], ['save']);
    assert.deepEqual(calls[1], ['translate', 10, 20]);
    assert.deepEqual(calls[2], ['drawImage', false, -2, -0, 8, 4]); // 0.1 quantized to 0 -> no rotate
    assert.deepEqual(calls[3], ['restore']);
    const rot = calls.find((c) => c[0] === 'rotate');
    assert.ok(rot && Math.abs(rot[1] - Math.PI / 2) < 1e-12);
    assert.equal(calls.filter((c) => c[0] === 'save').length, calls.filter((c) => c[0] === 'restore').length);
  } finally {
    if (stubbed) {
      if (hadOC) globalThis.OffscreenCanvas = prev; else delete globalThis.OffscreenCanvas;
    }
  }
});
