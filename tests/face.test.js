// WO2 3.5 — src/sprites/face.js: tiers, deterministic timers, events, composition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACE, healthTier, createFaceState, updateFaceState, faceEvent, faceFrameKey, composeFace,
} from '../src/sprites/face.js';
import { isPlaceholder } from '../src/sprites/pixel.js';
import { SPRITES } from '../src/config.js';

const F = SPRITES.face;
const DT = 0.01;

function run(fs, seconds, frac = 1, down = false, each = null) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    updateFaceState(fs, frac, down, DT);
    if (each) each(fs, (i + 1) * DT);
  }
  return fs;
}

test('face: healthTier thresholds and dead flag', () => {
  const cases = [[1, 0], [0.85, 0], [0.849, 1], [0.65, 1], [0.649, 2], [0.45, 2], [0.449, 3],
    [0.25, 3], [0.249, 4], [0.001, 4], [0, 4], [-1, 4], [NaN, 4], [Infinity, 4]];
  for (const [f, t] of cases) assert.equal(healthTier(f), t, `healthTier(${f})`);
  const fs = createFaceState(1);
  updateFaceState(fs, 0.3, false, DT);
  assert.equal(fs.tier, 3);
  assert.equal(fs.dead, false);
  updateFaceState(fs, 0.3, true, DT);
  assert.equal(fs.dead, true, 'down -> dead');
  updateFaceState(fs, 0, false, DT);
  assert.equal(fs.dead, true, 'frac <= 0 -> dead');
  updateFaceState(fs, 0.9, false, DT);
  assert.equal(fs.dead, false);
  assert.equal(fs.tier, 0, 'regenerating health moves the tier back up');
});

test('face: same seed -> identical key sequence; different seeds diverge', () => {
  const seq = (seed) => {
    const fs = createFaceState(seed);
    const keys = [];
    run(fs, 20, 0.7, false, (s) => keys.push(faceFrameKey(s)));
    return keys;
  };
  assert.deepEqual(seq(42), seq(42));
  assert.notDeepEqual(seq(42), seq(43));
});

test('face: first glance happens within glanceMin..glanceMax, glances keep coming', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const fs = createFaceState(seed);
    let first = null;
    let changes = 0;
    let prev = fs.look;
    run(fs, 30, 1, false, (s, t) => {
      if (s.look !== prev) { changes++; if (first === null) first = t; prev = s.look; }
      assert.ok(['left', 'center', 'right'].includes(s.look));
    });
    assert.ok(first !== null, `seed ${seed}: never glanced`);
    assert.ok(first >= F.glanceMin - DT && first <= F.glanceMax + DT, `seed ${seed}: first glance at ${first}`);
    assert.ok(changes >= Math.floor(30 / F.glanceMax) - 1, `seed ${seed}: only ${changes} glances in 30 s`);
  }
});

test('face: blinks start within blinkMin..blinkMax, last ~blinkTime, show closed eyes', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const fs = createFaceState(seed);
    let firstBlink = null;
    let blinkFrames = 0;
    let blinks = 0;
    let wasBlink = false;
    run(fs, 30, 1, false, (s, t) => {
      const b = s.blinkFor > 0;
      if (b) {
        blinkFrames++;
        assert.match(faceFrameKey(s), /:closed:.*blink1/);
      }
      if (b && !wasBlink) { blinks++; if (firstBlink === null) firstBlink = t; }
      wasBlink = b;
    });
    assert.ok(firstBlink !== null, `seed ${seed}: never blinked`);
    assert.ok(firstBlink >= F.blinkMin - DT && firstBlink <= F.blinkMax + DT, `seed ${seed}: first blink at ${firstBlink}`);
    assert.ok(blinks >= Math.floor(30 / F.blinkMax) - 1 && blinks <= Math.ceil(30 / F.blinkMin) + 1, `seed ${seed}: ${blinks} blinks`);
    const avg = (blinkFrames * DT) / blinks;
    assert.ok(Math.abs(avg - F.blinkTime) < 0.03, `seed ${seed}: average blink ${avg}s`);
  }
});

test('face: wince overrides eyes+mouth and expires after winceTime', () => {
  const fs = createFaceState(5);
  updateFaceState(fs, 1, false, DT);
  faceEvent(fs, 'hurt');
  assert.match(faceFrameKey(fs), /^t0:closed:pain:/);
  faceEvent(fs, 'grin'); // wince wins over grin while both run
  assert.match(faceFrameKey(fs), /:closed:pain:/);
  run(fs, F.winceTime + 0.02);
  assert.equal(fs.winceT, 0);
  assert.doesNotMatch(faceFrameKey(fs), /:pain:/);
});

test('face: grin overrides mouth, expires after grinTime, never while dead', () => {
  const fs = createFaceState(6);
  updateFaceState(fs, 0.5, false, DT);
  faceEvent(fs, 'grin');
  assert.match(faceFrameKey(fs), /^t2:[a-z]+:grin:/);
  run(fs, F.grinTime - 0.1, 0.5);
  assert.match(faceFrameKey(fs), /:grin:/);
  run(fs, 0.12, 0.5);
  assert.equal(fs.grinT, 0);
  assert.match(faceFrameKey(fs), /:grit:/, 'back to the tier 2 default mouth');

  const dead = createFaceState(6);
  updateFaceState(dead, 0, true, DT);
  faceEvent(dead, 'grin');
  assert.equal(dead.grinT, 0);
  assert.equal(faceFrameKey(dead), 'dead');
  // Grin started while alive is cleared on death.
  const g = createFaceState(6);
  updateFaceState(g, 1, false, DT);
  faceEvent(g, 'grin');
  updateFaceState(g, 1, true, DT);
  assert.equal(g.grinT, 0);
  assert.equal(composeFace(g), FACE.dead);
});

test('face: tier default expressions', () => {
  const expect = [/^t0:(left|center|right):neutral:/, /^t1:(left|center|right):frown:/,
    /^t2:(left|center|right):grit:/, /^t3:squint:grit:/, /^t4:squint:pain:/];
  const fracs = [1, 0.7, 0.5, 0.3, 0.1];
  fracs.forEach((f, t) => {
    const fs = createFaceState(9);
    updateFaceState(fs, f, false, DT);
    assert.match(faceFrameKey(fs), expect[t]);
  });
});

test('face: breathing bob is a 0/1 offset that toggles and shifts only the head', () => {
  const fs = createFaceState(2);
  const seen = new Set();
  run(fs, 4, 1, false, (s) => seen.add(s.breathe));
  assert.deepEqual([...seen].sort(), [0, 1]);
  // Freeze blinks/glances by forcing the timers, then compare b0 vs b1 frames.
  const a = createFaceState(2); updateFaceState(a, 1, false, DT);
  const b = { ...a, breathe: 1 };
  a.breathe = 0;
  const s0 = composeFace(a), s1 = composeFace(b);
  assert.notEqual(faceFrameKey(a), faceFrameKey(b));
  assert.deepEqual(s0.rows.slice(1, 24), s1.rows.slice(2, 25), 'head moved down 1 px');
  assert.deepEqual(s0.rows.slice(26), s1.rows.slice(26), 'collar stays put');
  // Dead never breathes.
  const d = createFaceState(2);
  run(d, 4, 0, true, (s) => assert.equal(s.breathe, 0));
});

test('face: layers are 24x30, composeFace is 24x30, memoized, never placeholder, no x pixels', () => {
  const all = [FACE.base, FACE.dead, ...Object.values(FACE.hair), ...Object.values(FACE.eyes),
    ...Object.values(FACE.mouth), ...FACE.blood];
  for (const s of all) {
    assert.equal(s.w, 24); assert.equal(s.h, 30);
    assert.ok(!isPlaceholder(s));
    assert.ok(s.rows.every((r) => !r.includes('x')));
  }
  assert.ok(FACE.blood[0].rows.every((r) => /^\.+$/.test(r)), 'blood[0] is empty');
  for (let t = 1; t < 5; t++) assert.notDeepEqual(FACE.blood[t].rows, FACE.blood[t - 1].rows);

  const keys = new Set();
  for (let seed = 1; seed <= 4; seed++) {
    for (const f of [1, 0.7, 0.5, 0.3, 0.1, 0]) {
      const fs = createFaceState(seed);
      run(fs, 8, f, false, (s, t) => {
        if (t > 2 && t < 2.5) faceEvent(s, 'hurt');
        if (t > 5 && t < 5.05) faceEvent(s, 'grin');
        const k = faceFrameKey(s);
        const spr = composeFace(s);
        assert.equal(spr.w, 24); assert.equal(spr.h, 30);
        assert.ok(!isPlaceholder(spr), k);
        assert.ok(spr.rows.every((r) => !r.includes('x')), k);
        assert.equal(composeFace(s), spr, 'memoized');
        keys.add(k);
      });
    }
  }
  assert.ok(keys.size > 20, `only ${keys.size} distinct frames`);
  // Tier 4 is pale: no normal skin char left in the composed rows.
  const p = createFaceState(1); updateFaceState(p, 0.1, false, DT);
  const pr = composeFace(p).rows.join('');
  assert.ok(!pr.includes('s') && pr.includes('P'));
  // Each tier composes to a different picture.
  const pics = [1, 0.7, 0.5, 0.3, 0.1].map((f) => {
    const fs = createFaceState(1); updateFaceState(fs, f, false, DT);
    fs.look = 'center'; fs.breathe = 0; fs.blinkFor = 0;
    return composeFace(fs).rows.join('\n');
  });
  pics.push(FACE.dead.rows.join('\n'));
  assert.equal(new Set(pics).size, 6);
});

// FIX-4 (QA visual #8/#9/#10): readable damage art.
test('face: both eyes stay visible at every tier; blood never covers the eyes or the outline', () => {
  const eyeChars = /[ew]/;
  for (const f of [1, 0.7, 0.5, 0.3, 0.1]) {
    const fs = createFaceState(1); updateFaceState(fs, f, false, DT);
    fs.look = 'center'; fs.breathe = 0; fs.blinkFor = 0;
    const rows = composeFace(fs).rows;
    const left = rows.slice(11, 13).map((r) => r.slice(6, 10)).join('');
    const right = rows.slice(11, 13).map((r) => r.slice(14, 18)).join('');
    assert.match(left, eyeChars, `tier ${fs.tier}: left eye visible`);
    assert.match(right, eyeChars, `tier ${fs.tier}: right eye visible`);
  }
  const base = FACE.base.rows;
  FACE.blood.forEach((b, t) => b.rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    assert.ok(base[y][x] !== '.' && base[y][x] !== 'k', `blood[${t}] at ${x},${y} is off the skin`);
    if (y >= 11 && y <= 12) assert.ok(!(x >= 6 && x <= 9) && !(x >= 14 && x <= 17), `blood[${t}] over an eye at ${x},${y}`);
  })));
  // Sweat reads as sweat (cyan beads), bruises are not gun-metal grey.
  assert.ok(FACE.blood[1].rows.join('').includes('c'));
  for (const b of FACE.blood) assert.ok(!b.rows.join('').includes('m'), 'no grey bruise');
});

test('face: dead head is one rigid piece (no per-row shear) with a closed outline', () => {
  const rows = FACE.dead.rows;
  // Every head row keeps its outline on both sides: first and last non-transparent pixel is 'k'.
  for (let y = 3; y < 25; y++) {
    const r = rows[y];
    const a = r.search(/[^.]/), b = r.length - 1 - [...r].reverse().join('').search(/[^.]/);
    assert.equal(r[a], 'k', `dead row ${y} left edge`);
    assert.equal(r[b], 'k', `dead row ${y} right edge`);
  }
  // Consecutive rows of the skull side never step by more than 2 px (the old shear broke this).
  const lefts = rows.slice(4, 24).map((r) => r.search(/[^.]/));
  for (let i = 1; i < lefts.length; i++) assert.ok(Math.abs(lefts[i] - lefts[i - 1]) <= 2, `left outline jump at row ${i + 4}`);
});
