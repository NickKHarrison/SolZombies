import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/state.js';
import * as events from '../src/events.js';
import {
  WEAPONS, WALL_WEAPON_IDS, BOX_WEAPON_IDS, BOX_WEIGHTS,
  createWeapon, updateWeapon, tryFire, startReload, refillReserve, refillAll,
  createDeathMachine, updateBullets, ammoCost, hitscan, setWeaponDeps, resetWeaponDeps,
} from '../src/weapons.js';
import { raycastWalls as realRaycastWalls, TILE_FLOOR as F, TILE_WALL as W, TILE_WINDOW as WIN, TILE_SPAWN_POCKET as P } from '../src/map.js';

// Fake deps: no walls unless told, damage just subtracts hp and records calls.
function setup({ wallT = Infinity } = {}) {
  const calls = { zombie: [], player: [] };
  setWeaponDeps({
    raycastWalls: () => wallT,
    damageZombie: (state, z, amount, cause, x, y) => { calls.zombie.push({ z, amount, cause, x, y }); z.hp -= amount; },
    damagePlayer: (state, amount) => { calls.player.push(amount); },
  });
  const state = createEmptyState(1);
  state.map = {}; // fake map object; raycastWalls is injected
  return { state, calls };
}

function zombie(id, x, y, hp = 1000) {
  return { id, x, y, radius: 14, hp, maxHp: hp, mode: 'chasing' };
}

test.afterEach(() => { resetWeaponDeps(); events.clearAll(); });

test('weapon tables', () => {
  assert.ok(!WALL_WEAPON_IDS.includes('mr6'));
  assert.ok(WALL_WEAPON_IDS.includes('sheiva') && WALL_WEAPON_IDS.includes('argus'));
  assert.ok(!WALL_WEAPON_IDS.includes('raygun'));
  assert.equal(WALL_WEAPON_IDS.length, 13);
  assert.ok(!BOX_WEAPON_IDS.includes('mr6') && !BOX_WEAPON_IDS.includes('deathmachine'));
  assert.equal(BOX_WEAPON_IDS.length, Object.keys(WEAPONS).length - 2);
  assert.equal(BOX_WEIGHTS.raygun, 1);
  assert.equal(BOX_WEIGHTS.kn44, 3);
  assert.equal(BOX_WEIGHTS.locus, 2);
  assert.equal(ammoCost('kn44'), 75);
  assert.equal(ammoCost('krm262'), 38);
  assert.equal(ammoCost('raygun'), Infinity);
  const w = createWeapon('mr6');
  assert.deepEqual({ ...w, def: undefined }, { id: 'mr6', def: undefined, mag: 8, reserve: 80, reloading: false, reloadT: 0, cooldown: 0, triggerHeld: false });
  assert.throws(() => createWeapon('nope'));
});

test('rpm cooldown math (auto)', () => {
  const { state } = setup();
  const w = createWeapon('kn44'); // 700 rpm
  const interval = 60 / 700;
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.ok(Math.abs(w.cooldown - interval) < 1e-9);
  assert.equal(tryFire(state, w, 0, 0, 1, 0), false);
  updateWeapon(w, interval * 0.5);
  assert.equal(tryFire(state, w, 0, 0, 1, 0), false);
  updateWeapon(w, interval * 0.5 + 1e-6);
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(w.mag, 28);
  // Sustained fire over 1 simulated second at 60 fps approximates rpm/60 shots.
  const w2 = createWeapon('vesper'); // 1100 rpm, 25 mag
  w2.mag = 1000;
  let shots = 0;
  for (let i = 0; i < 60; i++) { if (tryFire(state, w2, 0, 0, 1, 0)) shots++; updateWeapon(w2, 1 / 60); }
  assert.ok(Math.abs(shots - 1100 / 60) <= 1.5, `shots=${shots}`);
});

test('semi-auto needs trigger release, auto does not', () => {
  const { state } = setup();
  const semi = createWeapon('mr6');
  assert.equal(tryFire(state, semi, 0, 0, 1, 0), true);
  updateWeapon(semi, 1);
  assert.equal(tryFire(state, semi, 0, 0, 1, 0), false, 'held trigger blocks semi');
  semi.triggerHeld = false; // player releases
  assert.equal(tryFire(state, semi, 0, 0, 1, 0), true);

  const auto = createWeapon('kuda');
  auto.triggerHeld = true;
  assert.equal(tryFire(state, auto, 0, 0, 1, 0), true);
  updateWeapon(auto, 1);
  assert.equal(tryFire(state, auto, 0, 0, 1, 0), true);
});

test('reload moves the correct counts', () => {
  const w = createWeapon('kn44');
  assert.equal(startReload(w), false, 'full mag');
  w.mag = 10;
  let reloadEvents = 0;
  events.on('weapon:reload', () => reloadEvents++);
  assert.equal(startReload(w), true);
  assert.equal(startReload(w), false, 'already reloading');
  updateWeapon(w, 1.0);
  assert.equal(w.mag, 10);
  updateWeapon(w, 1.3);
  assert.equal(w.reloading, false);
  assert.equal(w.mag, 30);
  assert.equal(w.reserve, 220);
  assert.equal(reloadEvents, 1);

  const low = createWeapon('kn44');
  low.mag = 0; low.reserve = 7;
  startReload(low);
  updateWeapon(low, 5);
  assert.equal(low.mag, 7);
  assert.equal(low.reserve, 0);
  assert.equal(startReload(low), false, 'no reserve');
});

test('empty mag auto-reloads or emits weapon:empty', () => {
  const { state } = setup();
  let empties = 0;
  events.on('weapon:empty', () => empties++);
  const w = createWeapon('mr6');
  w.mag = 1;
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(w.reloading, true, 'auto reload on last round');
  const dry = createWeapon('mr6');
  dry.mag = 0; dry.reserve = 0;
  assert.equal(tryFire(state, dry, 0, 0, 1, 0), false);
  assert.equal(tryFire(state, dry, 0, 0, 1, 0), false);
  assert.equal(empties, 1, 'only once per trigger pull');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), false, 'cannot fire while reloading');
});

test('refills and death machine', () => {
  const w = createWeapon('vmp');
  w.mag = 3; w.reserve = 5;
  refillReserve(w);
  assert.equal(w.mag, 3);
  assert.equal(w.reserve, 240);
  w.reloading = true;
  refillAll(w);
  assert.equal(w.mag, 40);
  assert.equal(w.reloading, false);

  const { state } = setup();
  const dm = createDeathMachine();
  assert.equal(dm.id, 'deathmachine');
  assert.equal(tryFire(state, dm, 0, 0, 1, 0), true);
  assert.equal(dm.mag, Infinity);
  assert.equal(startReload(dm), false);
});

test('hitscan hits nearest first and respects penetration', () => {
  const { state, calls } = setup();
  const far = zombie(1, 300, 0), near = zombie(2, 100, 0), mid = zombie(3, 200, 0), off = zombie(4, 150, 200);
  state.zombies = [far, near, mid, off];
  const w = createWeapon('kn44'); // penetration 1
  w.def = { ...w.def, spread: 0 };
  tryFire(state, w, 0, 0, 1, 0);
  assert.equal(calls.zombie.length, 1);
  assert.equal(calls.zombie[0].z, near);
  assert.equal(calls.zombie[0].amount, 70);
  assert.equal(calls.zombie[0].cause, 'weapon');
  assert.ok(Math.abs(calls.zombie[0].x - 86) < 1e-6, 'hit point on the zombie edge');
  assert.equal(state.stats.shotsFired, 1);
  assert.equal(state.stats.shotsHit, 1);
  const tracer = state.effects.find((e) => e.type === 'tracer');
  assert.ok(tracer && Math.abs(tracer.x1 - 86) < 1e-6, 'tracer stops at the hit');
  assert.ok(state.effects.some((e) => e.type === 'muzzle'));

  calls.zombie.length = 0;
  const s = createWeapon('sheiva'); // penetration 2
  s.def = { ...s.def, spread: 0 };
  tryFire(state, s, 0, 0, 1, 0);
  assert.deepEqual(calls.zombie.map((c) => c.z.id), [2, 3]);

  calls.zombie.length = 0;
  const res = hitscan(state, 0, 0, 1, 0, 1400, 10, 5);
  assert.deepEqual(res.hits.map((z) => z.id), [2, 3, 1]);
});

test('walls block hitscan and dying zombies are ignored', () => {
  const { state, calls } = setup({ wallT: 150 });
  state.zombies = [zombie(1, 100, 0), zombie(2, 200, 0)];
  state.zombies[0].mode = 'dying';
  const res = hitscan(state, 0, 0, 1, 0, 1400, 5, 10);
  assert.equal(res.hits.length, 0);
  assert.equal(calls.zombie.length, 0);
  assert.equal(res.endX, 150);
});

test('shotgun pellets consume one round and emit one fired event', () => {
  const { state, calls } = setup();
  state.zombies = [zombie(1, 60, 0, 10000)];
  let fired = 0;
  events.on('weapon:fired', (p) => { fired++; assert.equal(p.weaponId, 'krm262'); });
  const w = createWeapon('krm262');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(w.mag, 5);
  assert.equal(fired, 1);
  assert.equal(state.effects.filter((e) => e.type === 'tracer').length, 8);
  assert.ok(calls.zombie.length >= 6, 'close zombie takes most pellets');
  assert.equal(state.stats.shotsHit, 1);
});

test('ray gun projectile detonates on zombie with splash and self-damage', () => {
  const { state, calls } = setup();
  state.player = { x: 0, y: 0, radius: 14, down: false };
  const target = zombie(1, 60, 0, 5000), side = zombie(2, 60, 60, 5000), away = zombie(3, 60, 500, 5000);
  state.zombies = [target, side, away];
  const w = createWeapon('raygun');
  w.def = { ...w.def, spread: 0 };
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(state.bullets.length, 1);
  assert.equal(calls.zombie.length, 0, 'no instant damage');
  for (let i = 0; i < 10 && state.bullets.length; i++) updateBullets(state, 1 / 60);
  assert.equal(state.bullets.length, 0);
  const byId = Object.fromEntries(calls.zombie.map((c) => [c.z.id, c.amount]));
  assert.equal(byId[1], 1000);
  assert.equal(byId[2], 300);
  assert.equal(byId[3], undefined);
  assert.deepEqual(calls.player, [30]);
  assert.ok(state.effects.some((e) => e.type === 'explosion'));
});

test('ray gun projectile travels, stops at walls, and expires at range', () => {
  const { state } = setup({ wallT: Infinity });
  state.player = { x: -1000, y: 0, radius: 14, down: false };
  const w = createWeapon('raygun');
  w.def = { ...w.def, spread: 0 };
  tryFire(state, w, 0, 0, 1, 0);
  updateBullets(state, 0.1);
  assert.equal(state.bullets.length, 1);
  assert.ok(Math.abs(state.bullets[0].x - 90) < 1e-6);
  for (let i = 0; i < 40; i++) updateBullets(state, 0.1);
  assert.equal(state.bullets.length, 0, 'expired');
  assert.equal(state.effects.filter((e) => e.type === 'explosion').length, 0, 'fizzles without exploding');

  const { state: s2, calls } = setup({ wallT: 5 });
  s2.player = { x: 0, y: 0, radius: 14, down: false };
  const w2 = createWeapon('raygun');
  tryFire(s2, w2, 0, 0, 1, 0);
  updateBullets(s2, 1 / 60);
  assert.equal(s2.bullets.length, 0);
  assert.deepEqual(calls.player, [30]);
});

test('balance pass (balance.md, Phase 4): approved damage/reserve values', () => {
  assert.equal(WEAPONS.mr6.damage, 50);
  assert.equal(WEAPONS.mr6.reserve, 80);
  assert.equal(WEAPONS.rk5.damage, 50);
  assert.equal(WEAPONS.sheiva.damage, 90);
  assert.equal(WEAPONS.hvk30.damage, 58);
  assert.equal(WEAPONS.icr1.damage, 66);
  assert.equal(WEAPONS.icr1.cost, 150);
});

// Regression for review.md #4a: ray-gun splash must respect walls/windows.
// Grid (TILE=40): column 2 is wall / window / wall; columns 3-4 are a spawn pocket.
test('ray gun splash does not pass through a window or wall (review #4a)', () => {
  const { state, calls } = setup();
  setWeaponDeps({ raycastWalls: realRaycastWalls });
  state.map = {
    cols: 5, rows: 3,
    tiles: [
      F, F, W,   P, P,
      F, F, WIN, P, P,
      F, F, W,   P, P,
    ],
  };
  state.player = { x: 20, y: 60, radius: 14, down: false };
  const pocket = zombie(1, 140, 60, 5000);   // behind the window, 60 px from the impact point
  const behindWall = zombie(2, 130, 20, 5000); // behind the wall above the window, in splash radius
  const inside = zombie(3, 50, 100, 5000);   // same side as the blast, clear LOS
  state.zombies = [pocket, behindWall, inside];
  const w = createWeapon('raygun');
  w.def = { ...w.def, spread: 0 };
  assert.equal(tryFire(state, w, 20, 60, 1, 0), true);
  for (let i = 0; i < 20 && state.bullets.length; i++) updateBullets(state, 1 / 60);
  assert.equal(state.bullets.length, 0, 'bolt detonated on the window face');
  const ids = calls.zombie.map((c) => c.z.id);
  assert.ok(!ids.includes(1), 'pocket zombie behind the window takes no splash');
  assert.ok(!ids.includes(2), 'zombie behind the wall takes no splash');
  assert.ok(ids.includes(3), 'zombie with clear LOS takes splash');
  assert.deepEqual(calls.player, [30], 'player on the blast side with LOS takes self-splash');

  // Player on the far side of a wall from the blast takes no self-splash.
  const { state: s2, calls: c2 } = setup();
  setWeaponDeps({ raycastWalls: realRaycastWalls });
  s2.map = state.map;
  s2.player = { x: 130, y: 20, radius: 14, down: false };
  s2.zombies = [];
  s2.bullets.push({ x: 20, y: 60, vx: 900, vy: 0, ttl: 2, def: WEAPONS.raygun });
  for (let i = 0; i < 20 && s2.bullets.length; i++) updateBullets(s2, 1 / 60);
  assert.equal(s2.bullets.length, 0);
  assert.deepEqual(c2.player, []);
});

// ---------------------------------------------------------------------------
// WO2 3.9: Thundergun cone, wonder weapons, sprite keys
// ---------------------------------------------------------------------------

import { WONDER_WEAPON_IDS } from '../src/weapons.js';
import { WEAPON_FX, SHOP } from '../src/config.js';

function coneSetup({ wallT = Infinity } = {}) {
  const calls = { kill: [], knock: [], ray: [] };
  setWeaponDeps({
    raycastWalls: (map, ox, oy, dx, dy, max) => { calls.ray.push({ dx, dy, max }); return wallT; },
    damageZombie: (state, z, amount, cause, x, y) => { calls.kill.push({ z, amount, cause, x, y }); z.hp -= amount; if (z.hp <= 0) z.mode = 'dying'; },
    applyKnockback: (state, z, vx, vy, stun) => { calls.knock.push({ z, vx, vy, stun }); },
    damagePlayer: () => {},
  });
  const state = createEmptyState(1);
  state.map = {};
  return { state, calls };
}

test('WO2 thundergun def, sprites, wonder ids and box weights', () => {
  const d = WEAPONS.thundergun;
  assert.equal(d.cls, 'special');
  assert.equal(d.sprite, 'thundergun');
  assert.equal(d.cost, null);
  assert.equal(d.mag, 4);
  assert.equal(d.reserve, 12);
  assert.equal(d.reloadTime, 3.0);
  assert.equal(d.auto, false);
  assert.deepEqual({ ...d.cone }, { range: 480, killRange: 300, halfAngle: 0.52, knockback: 720, stun: 1.2 });
  assert.equal(WEAPONS.raygun.sprite, 'raygun');
  assert.equal(WEAPONS.deathmachine.sprite, 'deathmachine');
  assert.deepEqual([...WONDER_WEAPON_IDS], ['raygun', 'thundergun']);
  assert.ok(BOX_WEAPON_IDS.includes('thundergun'));
  assert.ok(!BOX_WEAPON_IDS.includes('deathmachine'));
  assert.ok(!WALL_WEAPON_IDS.includes('thundergun'));
  assert.equal(BOX_WEIGHTS.thundergun, SHOP.boxWeights.wonder);
  assert.equal(BOX_WEIGHTS.raygun, SHOP.boxWeights.wonder);
  assert.equal(SHOP.boxWeights.wonder, 1);
  assert.equal(ammoCost('thundergun'), Infinity);
});

test('WO2 thundergun cone: kill inside killRange, knockback beyond, ignore outside angle/range', () => {
  const { state, calls } = coneSetup();
  const near = zombie(1, 200, 0);                       // in cone, kill range
  const nearEdge = zombie(2, 200 * Math.cos(0.5), 200 * Math.sin(0.5)); // angle 0.5 < 0.52
  const offAngle = zombie(3, 200 * Math.cos(0.6), 200 * Math.sin(0.6)); // angle 0.6 > 0.52
  const behind = zombie(4, -100, 0);
  const far = zombie(5, 400, 0);                        // knockback band
  const tooFar = zombie(6, 500, 0);                     // beyond range
  const dying = zombie(7, 100, 0); dying.mode = 'dying';
  state.zombies.push(near, nearEdge, offAngle, behind, far, tooFar, dying);
  const fired = [];
  events.on('weapon:fired', (p) => fired.push(p));

  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(w.mag, 3, 'one round consumed');

  assert.deepEqual(calls.kill.map((c) => c.z.id).sort(), [1, 2]);
  for (const c of calls.kill) {
    assert.equal(c.amount, Infinity);
    assert.equal(c.cause, 'weapon');
    assert.equal(c.x, c.z.x);
  }
  assert.equal(calls.knock.length, 1);
  assert.equal(calls.knock[0].z, far);
  assert.ok(Math.abs(calls.knock[0].vx - 720) < 1e-9 && Math.abs(calls.knock[0].vy) < 1e-9);
  assert.equal(calls.knock[0].stun, 1.2);
  assert.equal(calls.ray.length, 3, 'LOS checked for every in-cone zombie (kill band and knock band)');

  const sw = state.effects.find((e) => e.type === 'shockwave');
  assert.ok(sw);
  assert.deepEqual({ ...sw }, { type: 'shockwave', x: 0, y: 0, angle: 0, range: 480, halfAngle: 0.52, ttl: WEAPON_FX.shockwaveTtl, maxTtl: WEAPON_FX.shockwaveTtl });
  const sh = state.effects.find((e) => e.type === 'shake');
  assert.ok(sh && sh.magnitude === WEAPON_FX.thundergunShake.magnitude && sh.ttl === WEAPON_FX.thundergunShake.ttl);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].weaponId, 'thundergun');
  assert.equal(state.stats.shotsFired, 1);
  assert.equal(state.stats.shotsHit, 1);
});

test('WO2 thundergun cone: angle wrap at +/-PI', () => {
  const { state, calls } = coneSetup();
  const a = zombie(1, -200, 5);    // atan2 ~ +PI
  const b = zombie(2, -200, -5);   // atan2 ~ -PI
  const farBlocked = zombie(3, -400, 0);
  state.zombies.push(a, b, farBlocked);
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, -1, 0), true); // aim angle PI
  assert.deepEqual(calls.kill.map((c) => c.z.id).sort(), [1, 2]);
  assert.deepEqual(calls.knock.map((c) => c.z.id), [3]);
  assert.equal(state.stats.shotsHit, 1);
});

test('WO2 thundergun cone: a wall blocks both kills and knockback (lead decision on review #2)', () => {
  const { state, calls } = coneSetup({ wallT: 50 });
  state.zombies.push(zombie(1, 200, 0), zombie(2, 400, 0));
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(calls.kill.length, 0, 'wall blocks kills inside killRange');
  assert.equal(calls.knock.length, 0, 'wall blocks knockback');
  assert.equal(state.stats.shotsHit, 0);
  assert.ok(state.effects.some((e) => e.type === 'shockwave'));
});

// Real raycastWalls, TILE=40. Row 0: wall at col 4; row 1: window at col 4 then spawn pocket;
// row 2: open floor. Shooter at (20,60) aiming +x; all three targets are inside killRange.
test('WO2 thundergun cone kill band respects walls and boarded windows (real map)', () => {
  const { state, calls } = coneSetup();
  setWeaponDeps({ raycastWalls: realRaycastWalls });
  state.map = {
    cols: 8, rows: 3,
    tiles: [
      F, F, F, F, W,   F, F, F,
      F, F, F, F, WIN, P, P, P,
      F, F, F, F, F,   F, F, F,
    ],
  };
  const pocket = zombie(1, 220, 60); pocket.mode = 'tearing'; // tearing behind the boarded window
  const behindWall = zombie(2, 220, 20);
  const clear = zombie(3, 220, 100);
  state.zombies.push(pocket, behindWall, clear);
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 20, 60, 1, 0), true);
  assert.deepEqual(calls.kill.map((c) => c.z.id), [3], 'only the zombie in clear LOS dies');
  assert.equal(pocket.mode, 'tearing', 'pocket zombie behind the boarded window survives');
  assert.equal(behindWall.hp, behindWall.maxHp, 'zombie behind the wall survives');
  assert.equal(calls.knock.length, 0);
  assert.equal(state.stats.shotsHit, 1);
});

test('WO2 thundergun: miss does not count a hit; empty cone still shows shockwave', () => {
  const { state, calls } = coneSetup();
  state.zombies.push(zombie(1, 0, 200)); // 90 degrees off aim
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(calls.kill.length + calls.knock.length, 0);
  assert.equal(state.stats.shotsHit, 0);
  assert.ok(state.effects.some((e) => e.type === 'shockwave'));
});

test('WO2 thundergun: semi-auto, 4/12 reload and refill', () => {
  const { state } = coneSetup();
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  assert.equal(tryFire(state, w, 0, 0, 1, 0), false, 'semi-auto needs a release');
  for (let i = 0; i < 3; i++) {
    w.triggerHeld = false;
    updateWeapon(w, 1.01);
    assert.equal(tryFire(state, w, 0, 0, 1, 0), true);
  }
  assert.equal(w.mag, 0);
  assert.equal(w.reloading, true, 'auto-reload on empty');
  updateWeapon(w, 2.9);
  assert.equal(w.mag, 0);
  updateWeapon(w, 0.2);
  assert.equal(w.mag, 4);
  assert.equal(w.reserve, 8);
  w.mag = 1;
  assert.equal(startReload(w), true);
  updateWeapon(w, 3.01);
  assert.equal(w.mag, 4);
  assert.equal(w.reserve, 5);
  refillReserve(w);
  assert.equal(w.reserve, 12);
  w.mag = 0; w.reserve = 0;
  refillAll(w);
  assert.equal(w.mag, 4);
  assert.equal(w.reserve, 12);
});
