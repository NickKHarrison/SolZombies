// Sprite data tests (Agent K, WORK_ORDER_2.md 3.12).
//
// Two groups:
//   1. STRUCTURAL checks: sizes, palette-only pixels, anchors/grip/muzzle in bounds, frame counts,
//      gun lookup. These must pass against both the Phase 0 stubs and the finished art.
//   2. 'art complete: ...' checks: no placeholder sprites remain and the tier-0 blood overlay is
//      empty. These FAIL while stubs are present, which is intended: they are the end-state gate
//      for the integrator (see docs/notes/contracts.md, WO2 section).
//
// Coordinates: anchors, hands, grip and muzzle are measured from pixel corners (the centre of a
// 16x16 sprite is (8, 8)), so a point is in bounds when 0 <= x <= w and 0 <= y <= h.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE } from '../src/sprites/palette.js';
import {
  parseGrid, compose, quantizeAngle, isPlaceholder, PLACEHOLDER, placeholderSprite,
} from '../src/sprites/pixel.js';
import { SOLDIER } from '../src/sprites/soldier.js';
import { SPRITES } from '../src/config.js';
import { GUN_SPRITES, gunSpriteFor } from '../src/sprites/guns.js';
import {
  FACE, healthTier, createFaceState, updateFaceState, faceEvent, faceFrameKey, composeFace,
} from '../src/sprites/face.js';

// ---------------------------------------------------------------------------------------------
// Helpers

const PALETTE_RGBA = new Set(
  Object.values(PALETTE)
    .filter((c) => c != null)
    .map((c) => {
      const h = c.slice(1);
      return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},255`;
    }),
);
const MAGENTA = '255,0,255,255';

function isSprite(s) {
  return !!s && typeof s === 'object' && Number.isInteger(s.w) && Number.isInteger(s.h)
    && s.pixels instanceof Uint8ClampedArray;
}

/** Structural sprite check: size, pixel buffer, rows (if present) are palette-only and match pixels. */
function checkSprite(s, w, h, label) {
  assert.ok(isSprite(s), `${label}: not a Sprite { w, h, pixels }`);
  if (w != null) assert.equal(s.w, w, `${label}: width ${s.w}, expected ${w}`);
  if (h != null) assert.equal(s.h, h, `${label}: height ${s.h}, expected ${h}`);
  assert.equal(s.pixels.length, s.w * s.h * 4, `${label}: pixels length`);
  if (Array.isArray(s.rows)) {
    assert.equal(s.rows.length, s.h, `${label}: rows.length ${s.rows.length} != h ${s.h}`);
    s.rows.forEach((r, y) => {
      assert.equal(typeof r, 'string', `${label}: row ${y} not a string`);
      assert.equal(r.length, s.w, `${label}: row ${y} has ${r.length} chars, expected ${s.w}`);
      for (let x = 0; x < r.length; x++) {
        assert.ok(Object.prototype.hasOwnProperty.call(PALETTE, r[x]),
          `${label}: non-palette char '${r[x]}' at (${x}, ${y})`);
      }
    });
    // Parses cleanly, and the parsed pixels equal the stored ones.
    const parsed = parseGrid(s.rows);
    assert.deepEqual(Array.from(parsed.pixels), Array.from(s.pixels), `${label}: pixels do not match rows`);
  } else {
    assert.ok(s.rows === null || s.rows === undefined, `${label}: rows must be an array or null`);
  }
  // Every visible pixel is an opaque palette colour (covers rows = null sprites, e.g. tinted).
  const p = s.pixels;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const key = `${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}`;
    if (!PALETTE_RGBA.has(key)) {
      const n = i / 4;
      assert.fail(`${label}: pixel (${n % s.w}, ${Math.floor(n / s.w)}) rgba(${key}) is not a palette colour`);
    }
  }
}

function checkPoint(pt, w, h, label) {
  assert.ok(pt && Number.isFinite(pt.x) && Number.isFinite(pt.y), `${label}: must be { x, y } numbers`);
  assert.ok(pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h,
    `${label}: (${pt.x}, ${pt.y}) outside 0..${w} x 0..${h}`);
}

function hasMagentaPixel(s) {
  const p = s.pixels;
  for (let i = 0; i < p.length; i += 4) {
    if (`${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}` === MAGENTA) return true;
  }
  return false;
}

const POSES = ['onehand', 'twohand', 'heavy'];
const LEGS_W = 26, LEGS_H = 26; // WO2 Phase 2: enlarged from 16x16 so the stride shows past the torso
const EYES = ['center', 'left', 'right', 'closed', 'squint', 'pain'];
const MOUTHS = ['neutral', 'frown', 'grit', 'grin', 'pain', 'slack'];
// Nominal sizes from 3.4 ("~"), checked with tolerance.
const GUN_NOMINAL = {
  pistol: [8, 4], smg: [12, 5], ar: [16, 5], shotgun: [16, 5], sniper: [20, 4], lmg: [18, 7],
  raygun: [14, 8], thundergun: [20, 8], deathmachine: [18, 9], default: [12, 5],
};

/** Every grid-derived sprite in soldier.js, guns.js and face.js, with its expected size. */
function allSprites() {
  const out = [];
  SOLDIER.legs.frames.forEach((s, i) => out.push({ path: `SOLDIER.legs.frames[${i}]`, s, w: LEGS_W, h: LEGS_H }));
  for (const p of POSES) {
    out.push({ path: `SOLDIER.torso.idle.${p}`, s: SOLDIER.torso.idle[p], w: 16, h: 16 });
    (SOLDIER.torso.reload[p] || []).forEach((s, i) =>
      out.push({ path: `SOLDIER.torso.reload.${p}[${i}]`, s, w: 16, h: 16 }));
    ((SOLDIER.torso.walk && SOLDIER.torso.walk[p]) || []).forEach((s, i) =>
      out.push({ path: `SOLDIER.torso.walk.${p}[${i}]`, s, w: 16, h: 16 }));
  }
  if (SOLDIER.torso.helmet) out.push({ path: 'SOLDIER.torso.helmet.sprite', s: SOLDIER.torso.helmet.sprite, w: 16, h: 16 });
  out.push({ path: 'SOLDIER.down.sprite', s: SOLDIER.down.sprite, w: 20, h: 20 });
  for (const [k, g] of Object.entries(GUN_SPRITES)) out.push({ path: `GUN_SPRITES.${k}.sprite`, s: g.sprite, w: null, h: null });
  out.push({ path: 'FACE.base', s: FACE.base, w: 24, h: 30 });
  for (const k of Object.keys(FACE.hair)) out.push({ path: `FACE.hair.${k}`, s: FACE.hair[k], w: 24, h: 30 });
  for (const k of EYES) out.push({ path: `FACE.eyes.${k}`, s: FACE.eyes[k], w: 24, h: 30 });
  for (const k of MOUTHS) out.push({ path: `FACE.mouth.${k}`, s: FACE.mouth[k], w: 24, h: 30 });
  FACE.blood.forEach((s, i) => out.push({ path: `FACE.blood[${i}]`, s, w: 24, h: 30 }));
  out.push({ path: 'FACE.dead', s: FACE.dead, w: 24, h: 30 });
  return out;
}

/** composeFace outputs for tiers 0..4, a wince, a grin, and dead. */
function composedFaces() {
  const out = [];
  for (const [tier, frac] of [[0, 1], [1, 0.75], [2, 0.5], [3, 0.3], [4, 0.1]]) {
    const fs = createFaceState(7);
    updateFaceState(fs, frac, false, 0.016);
    assert.equal(fs.tier, tier, `health ${frac} -> tier ${tier}`);
    out.push({ path: `composeFace(tier ${tier})`, s: composeFace(fs) });
  }
  const hurt = createFaceState(7);
  updateFaceState(hurt, 0.5, false, 0.016);
  faceEvent(hurt, 'hurt');
  out.push({ path: 'composeFace(wince)', s: composeFace(hurt) });
  const grin = createFaceState(7);
  updateFaceState(grin, 1, false, 0.016);
  faceEvent(grin, 'grin');
  out.push({ path: 'composeFace(grin)', s: composeFace(grin) });
  const dead = createFaceState(7);
  updateFaceState(dead, 0, true, 0.016);
  out.push({ path: 'composeFace(dead)', s: composeFace(dead) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// pixel.js unit checks (3.12 asks for quantizeAngle and compose here)

test('pixel.quantizeAngle: snaps to nearest 2PI/n step, n <= 0 is continuous', () => {
  const step = (Math.PI * 2) / 32;
  assert.equal(quantizeAngle(0, 32), 0);
  assert.ok(Math.abs(quantizeAngle(step * 0.4, 32) - 0) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(step * 0.6, 32) - step) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(Math.PI / 2 + 0.01, 4) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(quantizeAngle(-step * 2.2, 32) + step * 2) < 1e-12);
  assert.equal(quantizeAngle(1.2345, 0), 1.2345);
  assert.equal(quantizeAngle(1.2345, -8), 1.2345);
});

test('pixel.compose: first layer sets size, later layers overwrite, transparent skipped, clipped', () => {
  const base = parseGrid(['kkk', 'kkk', 'kkk']);
  const over = parseGrid(['w.', '.w']);
  const c = compose([{ sprite: base }, { sprite: over, dx: 2, dy: 1 }]);
  assert.equal(c.w, 3);
  assert.equal(c.h, 3);
  assert.deepEqual(c.rows, ['kkk', 'kkw', 'kkk']); // (3,2) is clipped, '.' skipped
  const px = (x, y) => Array.from(c.pixels.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
  assert.deepEqual(px(2, 1), [0xf2, 0xf2, 0xf2, 255]);
  assert.deepEqual(px(1, 1), [0x0b, 0x0b, 0x0d, 255]);
  assert.equal(isPlaceholder(c), false);
  assert.equal(isPlaceholder(compose([{ sprite: base }, { sprite: PLACEHOLDER }])), true,
    'placeholder flag propagates through compose');
});

test('pixel.placeholderSprite: flagged, sized, detected', () => {
  const p = placeholderSprite(24, 30);
  assert.equal(p.w, 24);
  assert.equal(p.h, 30);
  assert.ok(isPlaceholder(p));
  assert.ok(hasMagentaPixel(p));
  assert.ok(!isPlaceholder(parseGrid(['kG', 'Gk'])));
});

// ---------------------------------------------------------------------------------------------
// soldier.js

test('soldier: legs has 8 frames of 26x26 and a centred anchor', () => {
  assert.ok(Array.isArray(SOLDIER.legs.frames), 'legs.frames is an array');
  assert.equal(SOLDIER.legs.frames.length, 8, 'legs has 8 frames');
  SOLDIER.legs.frames.forEach((s, i) => checkSprite(s, LEGS_W, LEGS_H, `legs.frames[${i}]`));
  checkPoint(SOLDIER.legs.anchor, LEGS_W, LEGS_H, 'legs.anchor');
  assert.deepEqual({ ...SOLDIER.legs.anchor }, { x: LEGS_W / 2, y: LEGS_H / 2 }, 'legs anchor is the grid centre');
});

// WO4 2.5: feet tucked under the body, a real gait, and no sliding. Helpers read the legs grids:
// boot pixels are leather/shine/cuff ('K', 'W', 'M', 'o'); lane rows are split at the anchor.
const BOOT_CHARS = new Set(['K', 'W', 'M', 'o']);
function bootsOf(s, side) { // side 'L' = rows above the anchor (-y), 'R' = below
  const ay = SOLDIER.legs.anchor.y, out = [];
  s.rows.forEach((r, y) => {
    if ((side === 'L') !== (y < ay)) return;
    for (let x = 0; x < r.length; x++) if (BOOT_CHARS.has(r[x])) out.push({ x, y });
  });
  return out;
}
const mean = (a, k) => a.reduce((t, p) => t + p[k] + 0.5, 0) / a.length;

test('soldier: boots sit in tucked lanes (4.5-6 px) and never reach past the shoulders sideways', () => {
  const ay = SOLDIER.legs.anchor.y;
  SOLDIER.legs.frames.forEach((s, i) => {
    for (const side of ['L', 'R']) {
      const b = bootsOf(s, side);
      assert.ok(b.length >= 12, `legs[${i}] ${side}: boot has ${b.length} px`);
      const lane = Math.abs(mean(b, 'y') - ay);
      assert.ok(lane >= 4.5 && lane <= 6, `legs[${i}] ${side}: lane ${lane} px from the centre line`);
    }
    // Every legs pixel, outline included, stays within the torso's 16-px width (rows -8..+8).
    s.rows.forEach((r, y) => {
      if (/[^.]/.test(r)) assert.ok(y >= ay - 8 && y < ay + 8, `legs[${i}]: pixel row ${y} sticks out sideways`);
    });
  });
});

test('soldier: legs gait - planted boot moves back exactly one frame of travel (no sliding)', () => {
  const ax = SOLDIER.legs.anchor.x;
  const perFrame = SPRITES.strideLength / 8 / SPRITES.scale; // sprite px the body moves per frame
  for (const side of ['L', 'R']) {
    const xs = SOLDIER.legs.frames.map((s) => mean(bootsOf(s, side), 'x') - ax);
    const steps = xs.map((x, i) => xs[(i + 1) % 8] - x);
    const back = steps.filter((d) => d < -1e-9);
    // Stance: two consecutive backward moves of exactly perFrame (+5 -> 0 -> -5); all other
    // moves are the swing (forward) or a hold.
    assert.equal(back.length, 2, `${side}: ${back.length} backward moves (${steps.join(', ')})`);
    for (const d of back) assert.ok(Math.abs(-d - perFrame) < 1e-6, `${side}: planted boot moves ${-d} px, body ${perFrame}`);
    const span = Math.max(...xs) - Math.min(...xs);
    assert.ok(span >= 9.5 && span <= 10.5, `${side}: stride span ${span} (+-5)`);
  }
  // The two boots run the same cycle half a cycle apart.
  const L = SOLDIER.legs.frames.map((s) => mean(bootsOf(s, 'L'), 'x'));
  const R = SOLDIER.legs.frames.map((s) => mean(bootsOf(s, 'R'), 'x'));
  L.forEach((x, i) => assert.ok(Math.abs(x - R[(i + 4) % 8]) < 1e-9, `frame ${i}: right boot mirrors left at +4`));
});

test('soldier: boots stay visible past the shoulders in every legs frame, front and back', () => {
  // Shoulders = the twohand idle torso without the forward-reaching arms (torso cols 0-9),
  // registered on the legs anchor as when legs and torso face the same way.
  const T = SOLDIER.torso.idle.twohand.rows;
  const off = SOLDIER.legs.anchor.x - SOLDIER.torso.anchor.x;
  const covered = (x, y) => {
    const tx = x - off, ty = y - (SOLDIER.legs.anchor.y - SOLDIER.torso.anchor.y);
    return ty >= 0 && ty < 16 && tx >= 0 && tx <= 9 && T[ty][tx] !== '.';
  };
  let behind = 0, ahead = 0;
  SOLDIER.legs.frames.forEach((s, i) => {
    let vis = 0;
    for (const side of ['L', 'R']) for (const p of bootsOf(s, side)) {
      if (covered(p.x, p.y)) continue;
      vis++;
      if (p.x < SOLDIER.legs.anchor.x) behind++; else ahead++;
    }
    assert.ok(vis >= 6, `legs[${i}]: only ${vis} boot px visible`);
  });
  assert.ok(behind >= 8 && ahead >= 8, `boots show behind (${behind}) and ahead (${ahead}) of the shoulders`);
});

// FIX-1: helmet overlay drawn after the gun so long guns never hide the head.
test('soldier: torso.helmet is a 16x16 overlay on the torso anchor, matching the idle torsos', () => {
  const h = SOLDIER.torso.helmet;
  assert.ok(h && h.sprite, 'torso.helmet.sprite exists');
  checkSprite(h.sprite, 16, 16, 'torso.helmet.sprite');
  assert.deepEqual({ ...h.anchor }, { ...SOLDIER.torso.anchor }, 'helmet anchor equals torso anchor');
  let n = 0;
  for (let i = 0; i < h.sprite.pixels.length; i += 4) {
    if (h.sprite.pixels[i + 3] === 0) continue;
    n++;
    for (const p of POSES) {
      const t = SOLDIER.torso.idle[p].pixels;
      for (let c = 0; c < 4; c++) assert.equal(t[i + c], h.sprite.pixels[i + c], `helmet pixel ${i / 4} matches idle.${p}`);
    }
  }
  assert.ok(n >= 30 && n <= 80, `helmet has ${n} opaque px (a head, not the whole torso)`);
});

test('soldier: optional torso.walk arm-swing frames are 8 per pose and frame 0 is idle', () => {
  const W = SOLDIER.torso.walk || {};
  for (const [p, frames] of Object.entries(W)) {
    assert.ok(POSES.includes(p), `walk pose ${p}`);
    assert.equal(frames.length, 8, `torso.walk.${p} has 8 frames`);
    frames.forEach((s, i) => checkSprite(s, 16, 16, `torso.walk.${p}[${i}]`));
    assert.equal(frames[0].rows.join(), SOLDIER.torso.idle[p].rows.join(), `torso.walk.${p}[0] is the idle pose`);
  }
});

test('soldier: torso idle/reload per pose, 16x16, reload has 2 frames per pose', () => {
  for (const p of POSES) {
    checkSprite(SOLDIER.torso.idle[p], 16, 16, `torso.idle.${p}`);
    const r = SOLDIER.torso.reload[p];
    assert.ok(Array.isArray(r), `torso.reload.${p} is an array`);
    assert.equal(r.length, 2, `torso.reload.${p} has 2 frames`);
    r.forEach((s, i) => checkSprite(s, 16, 16, `torso.reload.${p}[${i}]`));
  }
});

test('soldier: torso anchor and hand anchors are inside the 16x16 torso', () => {
  checkPoint(SOLDIER.torso.anchor, 16, 16, 'torso.anchor');
  for (const p of POSES) checkPoint(SOLDIER.torso.hand[p], 16, 16, `torso.hand.${p}`);
});

test('soldier: down sprite is 20x20 with an in-bounds anchor; shadow radii are sane', () => {
  checkSprite(SOLDIER.down.sprite, 20, 20, 'down.sprite');
  checkPoint(SOLDIER.down.anchor, 20, 20, 'down.anchor');
  const { rx, ry } = SOLDIER.shadow;
  assert.ok(rx > 0 && rx <= 10 && ry > 0 && ry <= 10, `shadow { rx: ${rx}, ry: ${ry} } within 0..10`);
});

// ---------------------------------------------------------------------------------------------
// guns.js

test('guns: every contract key exists with a sane sprite, pose and weight', () => {
  for (const k of Object.keys(GUN_NOMINAL)) {
    const g = GUN_SPRITES[k];
    assert.ok(g, `GUN_SPRITES.${k} missing`);
    checkSprite(g.sprite, null, null, `GUN_SPRITES.${k}.sprite`);
    const [nw, nh] = GUN_NOMINAL[k];
    assert.ok(g.sprite.w >= Math.floor(nw * 0.5) && g.sprite.w <= Math.ceil(nw * 1.5),
      `GUN_SPRITES.${k} width ${g.sprite.w} far from nominal ~${nw}`);
    assert.ok(g.sprite.h >= Math.max(2, nh - 3) && g.sprite.h <= nh + 4,
      `GUN_SPRITES.${k} height ${g.sprite.h} far from nominal ~${nh}`);
    assert.ok(g.sprite.w > g.sprite.h, `GUN_SPRITES.${k} should be longer than tall (faces +x)`);
    assert.ok(POSES.includes(g.pose), `GUN_SPRITES.${k}.pose '${g.pose}'`);
    assert.ok(g.weight === 1 || g.weight === 1.6, `GUN_SPRITES.${k}.weight ${g.weight} (1 or 1.6)`);
  }
});

test('guns: grip and muzzle are in bounds and muzzle.x > grip.x', () => {
  for (const [k, g] of Object.entries(GUN_SPRITES)) {
    checkPoint(g.grip, g.sprite.w, g.sprite.h, `GUN_SPRITES.${k}.grip`);
    checkPoint(g.muzzle, g.sprite.w, g.sprite.h, `GUN_SPRITES.${k}.muzzle`);
    assert.ok(g.muzzle.x > g.grip.x, `GUN_SPRITES.${k}: muzzle.x ${g.muzzle.x} <= grip.x ${g.grip.x}`);
  }
});

test('guns: gunSpriteFor lookup order is sprite -> id -> cls -> default', () => {
  assert.equal(gunSpriteFor({ sprite: 'thundergun', id: 'raygun', cls: 'pistol' }), GUN_SPRITES.thundergun);
  assert.equal(gunSpriteFor({ id: 'raygun', cls: 'special' }), GUN_SPRITES.raygun);
  assert.equal(gunSpriteFor({ id: 'deathmachine', cls: 'special' }), GUN_SPRITES.deathmachine);
  assert.equal(gunSpriteFor({ sprite: 'nope', id: 'kn44', cls: 'ar' }), GUN_SPRITES.ar);
  assert.equal(gunSpriteFor({ cls: 'smg' }), GUN_SPRITES.smg);
  assert.equal(gunSpriteFor({ cls: 'special' }), GUN_SPRITES.default);
  assert.equal(gunSpriteFor({}), GUN_SPRITES.default);
  assert.equal(gunSpriteFor(null), GUN_SPRITES.default);
  assert.equal(gunSpriteFor(undefined), GUN_SPRITES.default);
});

test('guns: every weapons.WEAPONS def resolves to a gun sprite; wonder/special guns get their own', async () => {
  const { WEAPONS } = await import('../src/weapons.js');
  for (const [id, d] of Object.entries(WEAPONS)) {
    const g = gunSpriteFor(d);
    assert.ok(g && isSprite(g.sprite), `WEAPONS.${id} has no gun sprite`);
    if (Object.prototype.hasOwnProperty.call(GUN_SPRITES, id)) {
      assert.equal(g, GUN_SPRITES[id], `WEAPONS.${id} should use GUN_SPRITES.${id}`);
    } else if (d.cls && Object.prototype.hasOwnProperty.call(GUN_SPRITES, d.cls)) {
      assert.equal(g, GUN_SPRITES[d.cls], `WEAPONS.${id} (cls ${d.cls}) should use GUN_SPRITES.${d.cls}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// face.js

test('face: FACE is 24x30 and every layer is 24x30 palette art', () => {
  assert.equal(FACE.w, 24);
  assert.equal(FACE.h, 30);
  checkSprite(FACE.base, 24, 30, 'FACE.base');
  for (const k of ['neat', 'messy']) checkSprite(FACE.hair[k], 24, 30, `FACE.hair.${k}`);
  for (const k of EYES) checkSprite(FACE.eyes[k], 24, 30, `FACE.eyes.${k}`);
  for (const k of MOUTHS) checkSprite(FACE.mouth[k], 24, 30, `FACE.mouth.${k}`);
  assert.ok(Array.isArray(FACE.blood), 'FACE.blood is an array');
  assert.equal(FACE.blood.length, 5, 'FACE.blood has 5 tiers');
  FACE.blood.forEach((s, i) => checkSprite(s, 24, 30, `FACE.blood[${i}]`));
  checkSprite(FACE.dead, 24, 30, 'FACE.dead');
});

test('face: healthTier thresholds (0 >= .85, 1 >= .65, 2 >= .45, 3 >= .25, else 4)', () => {
  const cases = [[1, 0], [0.85, 0], [0.84, 1], [0.65, 1], [0.64, 2], [0.45, 2], [0.44, 3],
    [0.25, 3], [0.24, 4], [0.01, 4], [0, 4], [NaN, 4]];
  for (const [f, t] of cases) assert.equal(healthTier(f), t, `healthTier(${f})`);
});

test('face: composeFace returns 24x30 sprites for every tier, wince, grin and dead; memoized by key', () => {
  for (const { path, s } of composedFaces()) {
    assert.ok(isSprite(s), `${path}: not a Sprite`);
    assert.equal(s.w, 24, `${path}: width`);
    assert.equal(s.h, 30, `${path}: height`);
  }
  const fs = createFaceState(3);
  updateFaceState(fs, 0.5, false, 0.016);
  const k = faceFrameKey(fs);
  assert.equal(typeof k, 'string');
  const a = composeFace(fs);
  assert.equal(faceFrameKey(fs), k, 'composeFace does not change the frame key');
  assert.equal(composeFace(fs), a, 'same key -> same (memoized) sprite object');
});

test('face: dead face key differs from alive, and grin never shows while dead', () => {
  const alive = createFaceState(1);
  updateFaceState(alive, 1, false, 0.016);
  const dead = createFaceState(1);
  updateFaceState(dead, 0, true, 0.016);
  assert.equal(dead.dead, true);
  assert.notEqual(faceFrameKey(dead), faceFrameKey(alive));
  const before = faceFrameKey(dead);
  faceEvent(dead, 'grin');
  updateFaceState(dead, 0, true, 0.016);
  assert.equal(faceFrameKey(dead), before, 'grin event has no visible effect while dead');
});

// ---------------------------------------------------------------------------------------------
// End-state gates. EXPECTED TO FAIL until Agents A, B and C replace the Phase 0 stubs.

test('art complete: no placeholder sprites (soldier, guns, face layers, composed faces)', () => {
  const bad = [];
  for (const { path, s } of [...allSprites(), ...composedFaces()]) {
    if (!isSprite(s)) continue; // structural tests report this
    const why = [];
    if (s === PLACEHOLDER) why.push('is PLACEHOLDER');
    if (isPlaceholder(s)) why.push('isPlaceholder');
    if (Array.isArray(s.rows) && s.rows.some((r) => r.includes('x'))) why.push("rows contain 'x'");
    if (hasMagentaPixel(s)) why.push('magenta pixel');
    if (why.length) bad.push(`${path} (${[...new Set(why)].join(', ')})`);
  }
  assert.deepEqual(bad, [], `${bad.length} placeholder sprite(s) remain:\n  ${bad.join('\n  ')}`);
});

test('art complete: FACE.blood[0] (tier 0) is an empty overlay and higher tiers are not', () => {
  const opaque = (s) => { let n = 0; for (let i = 3; i < s.pixels.length; i += 4) if (s.pixels[i]) n++; return n; };
  assert.equal(opaque(FACE.blood[0]), 0, 'FACE.blood[0] must be fully transparent');
  for (let i = 1; i < 5; i++) assert.ok(opaque(FACE.blood[i]) > 0, `FACE.blood[${i}] must have blood pixels`);
});
