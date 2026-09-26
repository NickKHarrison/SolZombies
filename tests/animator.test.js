import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerAnim, updatePlayerAnim, noteShot, resetPlayerAnim, wrapAngle } from '../src/sprites/animator.js';
import { SPRITES } from '../src/config.js';
import { gunSpriteFor } from '../src/sprites/guns.js';

const STEP = SPRITES.strideLength / 8; // world px per leg frame (walking)
const DT = 1 / 60;
const PISTOL = { id: 'pistol', cls: 'pistol' };
const LMG = { id: 'lmg', cls: 'lmg' };
const idleWeapon = { reloading: false };

function mkPlayer(x = 0, y = 0, extra = {}) { return { x, y, angle: 0, sprinting: false, down: false, ...extra }; }
function start(p) { const a = createPlayerAnim(); updatePlayerAnim(a, p, PISTOL, idleWeapon, DT); return a; }

test('createPlayerAnim has every contract field', () => {
  const a = createPlayerAnim();
  for (const k of ['walkDist', 'legFrame', 'legAngle', 'moving', 'recoil', 'recoilDir', 'reloadFrame', 'reloadT', 'pose', 'lastX', 'lastY', 'initialized']) {
    assert.ok(k in a, k);
  }
  assert.equal(a.initialized, false);
  assert.equal(a.legFrame, 0);
});

test('first call initializes lastX/lastY without a jump', () => {
  const a = createPlayerAnim();
  updatePlayerAnim(a, mkPlayer(500, 300), PISTOL, idleWeapon, DT);
  assert.equal(a.initialized, true);
  assert.equal(a.lastX, 500); assert.equal(a.lastY, 300);
  assert.equal(a.walkDist, 0); assert.equal(a.legFrame, 0); assert.equal(a.moving, false);
});

test('legFrame advances with distance and wraps at 8', () => {
  const p = mkPlayer();
  const a = start(p);
  const seen = [];
  for (let i = 1; i <= 16; i++) {
    p.x = i * STEP + 0.01;
    updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
    seen.push(a.legFrame);
    assert.equal(a.moving, true);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0]);
  assert.ok(seen.every((f) => f >= 0 && f < 8));
});

test('sprinting speeds the cycle by sprintCycleMult', () => {
  const walk = mkPlayer(), run = mkPlayer(0, 0, { sprinting: true });
  const aw = start(walk), ar = start(run);
  const dist = STEP * 1.5; // walk frame 1, sprint frame 2 for any strideLength
  walk.x = dist; run.x = dist;
  updatePlayerAnim(aw, walk, PISTOL, idleWeapon, DT);
  updatePlayerAnim(ar, run, PISTOL, idleWeapon, DT);
  assert.ok(Math.abs(aw.walkDist - dist) < 1e-9);
  assert.ok(Math.abs(ar.walkDist - dist * SPRITES.sprintCycleMult) < 1e-9);
  assert.equal(ar.legFrame, Math.floor(dist * SPRITES.sprintCycleMult / STEP) % 8);
  assert.ok(ar.legFrame >= aw.legFrame);
  // WO4: 1 keeps the planted boot still at sprint speed too (it was 1.5).
  assert.ok(SPRITES.sprintCycleMult >= 1 && SPRITES.sprintCycleMult <= 1.5);
});

test('standing still holds the frame briefly, then snaps to 0 after 0.1 s', () => {
  const p = mkPlayer();
  const a = start(p);
  p.x = STEP * 3 + 0.5;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  assert.equal(a.legFrame, 3);
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0.05);
  assert.equal(a.legFrame, 3, 'held under 0.1 s');
  assert.equal(a.moving, true);
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0.06);
  assert.equal(a.legFrame, 0, 'snapped after 0.1 s');
  assert.equal(a.moving, false);
  assert.equal(a.walkDist, 0);
});

const RATE = SPRITES.legTurnRate * Math.PI / 180; // rad/s
const near = (a, b, eps = 1e-9) => Math.abs(wrapAngle(a - b)) < eps;
// Move one step of `len` px in direction `dir` (radians).
function stepDir(a, p, dir, len = 3, dt = DT) {
  p.x += Math.cos(dir) * len; p.y += Math.sin(dir) * len;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, dt);
}

test('WO4: legAngle turns toward movement at a capped rate, then settles on it', () => {
  const p = mkPlayer(0, 0, { angle: Math.PI / 2 });
  const a = start(p);
  assert.ok(near(a.legAngle, Math.PI / 2), 'idle at start faces aim');
  stepDir(a, p, Math.PI / 4); // 45 deg from aim: forward walk, legs turn from 90 toward 45 deg
  assert.equal(a.backpedal, false);
  assert.ok(near(a.legTarget, Math.PI / 4));
  const turned = Math.PI / 2 - a.legAngle;
  assert.ok(Math.abs(turned - Math.min(RATE * DT, Math.PI / 4)) < 1e-9, `turned ${turned} rad in one frame`);
  for (let i = 0; i < 30; i++) stepDir(a, p, Math.PI / 4);
  assert.ok(near(a.legAngle, Math.PI / 4), 'legs reach the movement direction');
});

test('WO4: shortest arc across the +-PI seam, never more than rate*dt per update', () => {
  const p = mkPlayer(0, 0, { angle: Math.PI - 0.1 });
  const a = start(p);
  let prev = a.legAngle;
  for (let i = 0; i < 20; i++) {
    stepDir(a, p, -Math.PI + 0.3); // 0.4 rad away across the seam
    const d = Math.abs(wrapAngle(a.legAngle - prev));
    assert.ok(d <= RATE * DT + 1e-9, `step ${d}`);
    prev = a.legAngle;
  }
  assert.ok(near(a.legAngle, -Math.PI + 0.3));
});

test('WO4: standing still eases the legs to the aim instead of snapping', () => {
  const p = mkPlayer();
  const a = start(p);
  for (let i = 0; i < 20; i++) stepDir(a, p, 0);
  p.angle = 1.5; // look ~86 deg to the side and stop
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0.05); // still inside the 0.1 s hold
  assert.equal(a.moving, true);
  assert.ok(near(a.legAngle, 0), 'hold keeps the walking direction');
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0.05); // idle now: one capped step toward the aim
  assert.equal(a.moving, false);
  assert.equal(a.legFrame, 0);
  assert.ok(near(a.legTarget, 1.5));
  assert.ok(RATE * 0.05 < 1.5 && Math.abs(a.legAngle - RATE * 0.05) < 1e-9, `eased to ${a.legAngle}`);
  for (let i = 0; i < 20; i++) updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  assert.ok(near(a.legAngle, 1.5), 'idle legs face aim');
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0);
  p.angle = -1;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0);
  assert.ok(near(a.legAngle, 1.5), 'dt 0 does not turn');
});

test('WO4: backpedal - moving > 100 deg from aim faces the legs backwards and reverses the cycle', () => {
  const p = mkPlayer(0, 0, { angle: 0 });
  const a = start(p);
  const frames = [];
  for (let i = 0; i < 60; i++) {
    p.x -= STEP / 2; // straight back, half a leg frame per update
    updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
    frames.push(a.legFrame);
  }
  assert.equal(a.backpedal, true);
  assert.ok(near(a.legTarget, 0), 'legs face movement + 180 = the aim');
  assert.ok(near(a.legAngle, 0), 'legs never turned away');
  // Cycle runs backwards: 0 -> 7 -> 6 ...
  assert.deepEqual(frames.slice(0, 5), [7, 7, 6, 6, 5]);
  for (let i = 1; i < frames.length; i++) {
    const d = (frames[i - 1] - frames[i] + 8) % 8;
    assert.ok(d === 0 || d === 1, `frame ${frames[i - 1]} -> ${frames[i]}`);
  }
  // Forward again: the cycle runs forwards and the legs face the movement.
  const f0 = a.legFrame;
  p.x += STEP + 0.01;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  assert.equal(a.backpedal, false);
  assert.equal(a.legFrame, (f0 + 1) % 8);
});

test('WO4: strafe at 90 deg walks forward; backpedal hysteresis between 80 and 100 deg', () => {
  const deg = (d) => d * Math.PI / 180;
  const p = mkPlayer(0, 0, { angle: 0 });
  const a = start(p);
  const walk = (moveDeg, n = 3) => { for (let i = 0; i < n; i++) stepDir(a, p, deg(moveDeg)); return a.backpedal; };
  assert.equal(walk(90), false, 'pure strafe faces the movement');
  assert.equal(walk(99), false, '99 deg: still forward');
  assert.equal(walk(-99), false, '-99 deg: still forward');
  assert.equal(walk(101), true, '101 deg: backpedal');
  assert.ok(near(a.legTarget, deg(101 - 180)));
  assert.equal(walk(90), true, '90 deg after backpedal: stays backpedalling');
  assert.equal(walk(81), true, '81 deg: stays');
  assert.equal(walk(79), false, '79 deg: forward again');
  assert.equal(walk(95), false, '95 deg from forward: stays forward');
  // Flicker check: jitter around 90 deg never toggles.
  let toggles = 0, prev = a.backpedal;
  for (let i = 0; i < 200; i++) {
    stepDir(a, p, deg(90 + 8 * Math.sin(i * 1.7)), 1);
    if (a.backpedal !== prev) { toggles++; prev = a.backpedal; }
  }
  assert.equal(toggles, 0);
});

test('WO4: the backpedal flip turns the legs through the aim side, at the capped rate', () => {
  const deg = (d) => d * Math.PI / 180;
  const p = mkPlayer(0, 0, { angle: 0 });
  const a = start(p);
  for (let i = 0; i < 60; i++) stepDir(a, p, deg(95), 1); // legs settle on 95 deg (forward strafe)
  assert.ok(near(a.legAngle, deg(95)));
  const seen = [];
  for (let i = 0; i < 40; i++) { stepDir(a, p, deg(105), 1); seen.push(a.legAngle); }
  assert.equal(a.backpedal, true);
  assert.ok(near(a.legAngle, deg(-75)), 'ends facing movement + 180');
  // It passed through 0 (the aim) rather than through 180 (behind the soldier).
  assert.ok(seen.some((x) => Math.abs(x) < RATE * DT), 'swung through the aim');
  assert.ok(seen.every((x) => Math.abs(x) <= deg(106)), 'never swung round the back');
});

test('teleport (> 100 px in one update) does not advance the cycle', () => {
  const p = mkPlayer();
  const a = start(p);
  p.x = 250; p.y = 40;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  assert.equal(a.walkDist, 0);
  assert.equal(a.legFrame, 0);
  assert.equal(a.lastX, 250);
  p.x += STEP + 0.1; // normal step afterwards counts from the new spot
  updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  assert.equal(a.legFrame, 1);
});

test('player.down freezes the legs but tracks position', () => {
  const p = mkPlayer();
  const a = start(p);
  p.x = STEP * 2 + 0.5;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, DT);
  const frame = a.legFrame, dist = a.walkDist;
  p.down = true;
  for (let i = 0; i < 30; i++) { p.x += 3; updatePlayerAnim(a, p, PISTOL, idleWeapon, DT); }
  assert.equal(a.legFrame, frame);
  assert.equal(a.walkDist, dist);
  assert.equal(a.moving, false);
  assert.equal(a.lastX, p.x);
});

test('dt = 0 is safe: no decay, no reload advance, movement still counted', () => {
  const p = mkPlayer();
  const a = start(p);
  noteShot(a, PISTOL);
  const r = a.recoil;
  updatePlayerAnim(a, p, PISTOL, { reloading: true }, 0);
  assert.equal(a.recoil, r);
  assert.equal(a.reloadT, 0);
  assert.equal(a.reloadFrame, 0);
  p.x = STEP + 0.1;
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0);
  assert.equal(a.legFrame, 1);
  updatePlayerAnim(a, p, PISTOL, idleWeapon, 0);
  assert.equal(a.legFrame, 1, 'dt 0 does not count as idle time');
  for (const bad of [NaN, -1, undefined]) updatePlayerAnim(a, p, PISTOL, idleWeapon, bad);
  assert.ok(Number.isFinite(a.recoil) && Number.isFinite(a.walkDist));
});

test('noteShot sets recoil from gun weight; heavy kicks harder', () => {
  const a = start(mkPlayer());
  noteShot(a, PISTOL);
  const lightW = gunSpriteFor(PISTOL).weight || 1;
  assert.ok(Math.abs(a.recoil - SPRITES.recoilPx * lightW) < 1e-9);
  noteShot(a, LMG);
  const heavyW = gunSpriteFor(LMG).weight || 1;
  assert.ok(Math.abs(a.recoil - SPRITES.recoilPx * heavyW) < 1e-9);
  assert.ok(heavyW > lightW, 'lmg is heavier than pistol');
});

test('recoilDir: explicit aimAngle, else last player.angle', () => {
  const p = mkPlayer(0, 0, { angle: 1.25 });
  const a = start(p);
  noteShot(a, PISTOL);
  assert.equal(a.recoilDir, 1.25);
  noteShot(a, PISTOL, -0.5);
  assert.equal(a.recoilDir, -0.5);
});

test('recoil decays linearly to 0 over recoilTime', () => {
  const p = mkPlayer();
  const a = start(p);
  noteShot(a, LMG);
  const peak = a.recoil;
  updatePlayerAnim(a, p, LMG, idleWeapon, DT); // first update after a shot holds the peak
  assert.equal(a.recoil, peak);
  updatePlayerAnim(a, p, LMG, idleWeapon, SPRITES.recoilTime / 2);
  assert.ok(Math.abs(a.recoil - peak / 2) < 1e-9);
  updatePlayerAnim(a, p, LMG, idleWeapon, SPRITES.recoilTime / 2 + 1e-9);
  assert.equal(a.recoil, 0);
  updatePlayerAnim(a, p, LMG, idleWeapon, 1);
  assert.equal(a.recoil, 0);
});

test('first update after noteShot keeps the full peak at any dt (FIX-2)', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 30]) {
    const p = mkPlayer();
    const a = start(p);
    noteShot(a, PISTOL);
    const peak = a.recoil;
    assert.ok(peak > 0);
    updatePlayerAnim(a, p, PISTOL, idleWeapon, dt);
    assert.equal(a.recoil, peak, 'first drawn frame shows the full kick');
    assert.equal(a.recoilFresh, false);
    updatePlayerAnim(a, p, PISTOL, idleWeapon, dt);
    assert.ok(a.recoil < peak, 'decays from the second update on');
    // A new shot mid-decay re-arms the hold.
    noteShot(a, PISTOL);
    updatePlayerAnim(a, p, PISTOL, idleWeapon, dt);
    assert.equal(a.recoil, peak);
  }
});

test('reloadFrame toggles every reloadFrameTime while reloading, 0 otherwise', () => {
  const p = mkPlayer();
  const a = start(p);
  const w = { reloading: true };
  const t = SPRITES.reloadFrameTime;
  const frames = [];
  for (let i = 0; i < 6; i++) { updatePlayerAnim(a, p, PISTOL, w, t / 2); frames.push(a.reloadFrame); }
  assert.deepEqual(frames, [0, 1, 1, 0, 0, 1]);
  w.reloading = false;
  updatePlayerAnim(a, p, PISTOL, w, DT);
  assert.equal(a.reloadFrame, 0); assert.equal(a.reloadT, 0);
  updatePlayerAnim(a, p, PISTOL, null, DT);
  assert.equal(a.reloadFrame, 0);
});

test('pose comes from the gun, defaults to twohand', () => {
  const a = start(mkPlayer());
  updatePlayerAnim(a, mkPlayer(), PISTOL, idleWeapon, DT);
  assert.equal(a.pose, gunSpriteFor(PISTOL).pose);
  assert.equal(a.pose, 'onehand');
  updatePlayerAnim(a, mkPlayer(), LMG, idleWeapon, DT);
  assert.equal(a.pose, 'heavy');
  updatePlayerAnim(a, mkPlayer(), null, idleWeapon, DT);
  assert.equal(a.pose, 'twohand');
});

test('resetPlayerAnim restores a fresh state in place', () => {
  const p = mkPlayer();
  const a = start(p);
  p.x = 30; updatePlayerAnim(a, p, LMG, { reloading: true }, 0.2); noteShot(a, LMG);
  const same = resetPlayerAnim(a);
  assert.equal(same, a);
  assert.deepEqual({ ...a }, createPlayerAnim());
});

test('deterministic: identical inputs give identical states', () => {
  function run() {
    const p = mkPlayer();
    const a = createPlayerAnim();
    const w = { reloading: false };
    for (let i = 0; i < 400; i++) {
      const t = i * DT;
      if ((i % 90) < 60) { p.x += Math.cos(t) * 3; p.y += Math.sin(t * 0.7) * 3; }
      p.angle = t * 0.9; p.sprinting = (i % 120) > 80; w.reloading = (i % 150) < 40;
      if (i % 17 === 0) noteShot(a, i % 34 ? PISTOL : LMG);
      updatePlayerAnim(a, p, i % 50 < 25 ? PISTOL : LMG, w, DT);
    }
    return a;
  }
  assert.deepEqual(run(), run());
});
