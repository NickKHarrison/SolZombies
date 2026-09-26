import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/state.js';
import * as events from '../src/events.js';
import {
  WEAPONS, WALL_WEAPON_IDS, BOX_WEAPON_IDS, BOX_WEIGHTS,
  createWeapon, updateWeapon, tryFire, startReload, refillReserve, refillAll,
  createDeathMachine, updateBullets, ammoCost, hitscan, setWeaponDeps, resetWeaponDeps,
} from '../src/weapons.js';
import { healthForRound } from '../src/zombie.js';
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
  assert.equal(WALL_WEAPON_IDS.length, 24); // WO5: 13 WO4 + 6 new + haymaker12 + drakon; WO7: + 3 tier-3
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
  const calls = { kill: [], knock: [], ray: [], push: [] };
  setWeaponDeps({
    pushZombie: (state, z, dx, dy) => { calls.push.push({ z, dx, dy }); return true; },
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

// ---------------------------------------------------------------------------------------------
// WO5 3.4 (Agent D): level-2 guns, wall prices, box weights; 1.2 Thundergun vs boss.
import { BOX_WALL_WEIGHT_IDS, bossKnock } from '../src/weapons.js';
import { BOSS, ZOMBIE } from '../src/config.js';
import { GUN_SPRITES, gunSpriteFor } from '../src/sprites/guns.js';

const WO5_NEW = {
  manowar:   { name: 'Man-O-War',  cls: 'ar',      cost: 250, damage: 140, rpm: 520, auto: true,  mag: 25, reserve: 200, reloadTime: 2.6, penetration: 2 },
  xr2:       { name: 'XR-2',       cls: 'ar',      cost: 225, damage: 80,  rpm: 800, auto: true,  mag: 30, reserve: 270, reloadTime: 2.1, spread: 0.02 },
  weevil:    { name: 'Weevil',     cls: 'smg',     cost: 200, damage: 65,  rpm: 950, auto: true,  mag: 48, reserve: 288, reloadTime: 2.0 },
  marshal16: { name: 'Marshal 16', cls: 'shotgun', cost: 225, damage: 100, rpm: 150, auto: false, mag: 2,  reserve: 40,  reloadTime: 1.5, pellets: 8, spread: 0.16, range: 650 },
  gorgon:    { name: 'Gorgon',     cls: 'lmg',     cost: 300, damage: 175, rpm: 480, auto: true,  mag: 48, reserve: 240, reloadTime: 4.0, penetration: 3 },
  dredge48:  { name: '48 Dredge',  cls: 'lmg',     cost: 275, damage: 85,  rpm: 900, auto: true,  mag: 48, reserve: 288, reloadTime: 3.6 },
};
const WO4_WALL = ['rk5', 'lcar9', 'sheiva', 'krm262', 'kuda', 'vmp', 'vesper', 'pharo', 'bootlegger', 'kn44', 'hvk30', 'icr1', 'argus'];

test('WO5 new weapon defs match 3.4 and use their own gun sprites', () => {
  for (const [id, want] of Object.entries(WO5_NEW)) {
    const d = WEAPONS[id];
    assert.ok(d, `WEAPONS.${id} missing`);
    assert.equal(d.id, id);
    for (const [k, v] of Object.entries(want)) assert.equal(d[k], v, `${id}.${k}`);
    assert.equal(d.sprite, id);
    assert.equal(d.tier, 2);
    assert.ok(Object.isFrozen(d));
    assert.equal(gunSpriteFor(d), GUN_SPRITES[id], `${id} resolves to its own sprite`);
    assert.equal(ammoCost(id), Math.round(want.cost * 0.3), `${id} tier-2 ammo = 0.3x price`);
    const w = createWeapon(id);
    assert.equal(w.mag, want.mag);
    assert.equal(w.reserve, want.reserve);
  }
  assert.equal(WEAPONS.xr2.penetration, 1);
});

test('WO5 new guns fire per their stats (marshal16: 8 pellets, 1 round, semi-auto)', () => {
  const { state, calls } = setup();
  state.zombies.push(zombie(1, 40, 0, 1e6)); // close enough that every jittered pellet hits
  const m = createWeapon('marshal16');
  assert.equal(tryFire(state, m, 0, 0, 1, 0), true);
  assert.equal(m.mag, 1);
  assert.equal(calls.zombie.length, 8);
  assert.ok(calls.zombie.every((c) => c.amount === WEAPONS.marshal16.damage));
  assert.equal(tryFire(state, m, 0, 0, 1, 0), false, 'semi-auto: held trigger does not refire');
  const g = setup();
  g.state.zombies.push(zombie(1, 100, 0), zombie(2, 150, 0), zombie(3, 200, 0), zombie(4, 250, 0));
  assert.equal(tryFire(g.state, createWeapon('gorgon'), 0, 0, 1, 0), true);
  assert.equal(g.calls.zombie.length, 3, 'gorgon penetration 3');
});

test('WO5 wall prices: haymaker12 250, drakon 300; all level-2 guns are wall ids and in the box', () => {
  assert.equal(WEAPONS.haymaker12.cost, 250);
  assert.equal(WEAPONS.drakon.cost, 300);
  const lvl2 = [...Object.keys(WO5_NEW), 'haymaker12', 'drakon'];
  for (const id of lvl2) {
    assert.ok(WALL_WEAPON_IDS.includes(id), `wall ${id}`);
    assert.ok(BOX_WEAPON_IDS.includes(id), `box ${id}`);
    assert.equal(BOX_WEIGHTS[id], SHOP.boxWeights.boxOnly, `${id} box weight = boxOnly`);
    assert.ok(!BOX_WALL_WEIGHT_IDS.includes(id));
    const c = WEAPONS[id].cost;
    assert.ok(c >= 200 && c <= 350, `${id} level-2 price ${c} in 200..350`);
  }
  // Level-1 (WO4) wall guns unchanged: same ids, weight 3.
  assert.deepEqual([...BOX_WALL_WEIGHT_IDS].sort(), [...WO4_WALL].sort());
  for (const id of WO4_WALL) assert.equal(BOX_WEIGHTS[id], SHOP.boxWeights.wall);
  assert.deepEqual([...WALL_WEAPON_IDS].sort(), [...WO4_WALL, ...lvl2, 'hg40', 'm8a7', 'peacekeeper'].sort()); // WO7: + tier 3
  // Existing box-only guns / wonder weapons keep their weights.
  assert.equal(BOX_WEIGHTS.locus, 2);
  assert.equal(BOX_WEIGHTS.dingo, 2);
  assert.equal(BOX_WEIGHTS.raygun, 1);
  assert.equal(BOX_WEIGHTS.thundergun, 1);
  assert.equal(BOX_WEAPON_IDS.length, Object.keys(WEAPONS).length - 2);
});

test('WO5 bossKnock: speed/stun give the requested slide under zombie.js stun physics', () => {
  for (const px of [BOSS.thunderNearKnock, BOSS.thunderFarKnock]) {
    const { speed, stun } = bossKnock(px);
    assert.ok(stun > 0 && stun < 1);
    // replay zombie.js updateStunned (no walls/separation) at 60 fps
    const k = ZOMBIE.knockFriction, dt = 1 / 60;
    let v = speed, x = 0, t = stun;
    while (t > 0) {
      const decay = Math.exp(-k * dt);
      x += v * (1 - decay) / k;
      v *= decay;
      if (v < ZOMBIE.stunMinSpeed) v = 0;
      t -= dt;
    }
    assert.ok(Math.abs(x - px) < 3, `slide ${x.toFixed(1)} ~ ${px}`);
  }
  assert.deepEqual(bossKnock(0), { speed: 0, stun: 0 });
});

test('WO5 thundergun vs boss: near cone = thunderNearFrac of max HP + 60 px knock; minions still die', () => {
  const { state, calls } = coneSetup();
  const nearBoss = zombie(1, 200, 0, 8000); nearBoss.kind = 'boss'; nearBoss.radius = 34;
  const minion = zombie(2, 150, 20, 300); minion.kind = 'minion';
  state.zombies.push(nearBoss, minion);
  const w = createWeapon('thundergun');
  assert.equal(tryFire(state, w, 0, 0, 1, 0), true);

  const bossHit = calls.kill.find((c) => c.z === nearBoss);
  assert.ok(bossHit, 'boss damaged');
  assert.ok(Math.abs(bossHit.amount - 8000 * BOSS.thunderNearFrac) < 1e-9, 'near: 15% of max HP');
  assert.equal(bossHit.cause, 'weapon');
  assert.equal(nearBoss.hp, 8000 - 8000 * BOSS.thunderNearFrac);
  assert.notEqual(nearBoss.mode, 'dying');
  const minionHit = calls.kill.find((c) => c.z === minion);
  assert.equal(minionHit.amount, Infinity, 'minions die like normal zombies');

  // Integrator: the boss is pushed an exact 60 px via zombie.pushZombie (no velocity knock).
  assert.equal(calls.knock.filter((c) => c.z === nearBoss).length, 0);
  assert.equal(calls.push.length, 1);
  const kb = calls.push[0];
  assert.equal(kb.z, nearBoss);
  assert.ok(Math.abs(kb.dx - BOSS.thunderNearKnock) < 1e-9 && Math.abs(kb.dy) < 1e-9);
  assert.equal(state.stats.shotsHit, 1);
});

test('WO5 thundergun vs boss: far cone = 40 px knock only, no damage', () => {
  const { state, calls } = coneSetup();
  const farBoss = zombie(3, 0, 400, 8000); farBoss.kind = 'boss';
  state.zombies.push(farBoss);
  assert.equal(tryFire(state, createWeapon('thundergun'), 0, 0, 0, 1), true);
  assert.equal(calls.kill.length, 0, 'far cone never damages the boss');
  assert.equal(calls.knock.length, 0);
  assert.equal(calls.push.length, 1);
  assert.ok(Math.abs(calls.push[0].dy - BOSS.thunderFarKnock) < 1e-9 && Math.abs(calls.push[0].dx) < 1e-9);
  assert.equal(farBoss.hp, 8000);
  assert.equal(state.stats.shotsHit, 1);
});

test('WO5 thundergun vs boss: state.boss.maxHp fallback; lethal chip skips knock; walls block', () => {
  const { state, calls } = coneSetup();
  state.boss = { maxHp: 4000 };
  const lethalHp = Math.floor(4000 * BOSS.thunderNearFrac) - 20; // chip >= hp -> dies (any near frac)
  const b = zombie(1, 100, 0, lethalHp); b.kind = 'boss'; delete b.maxHp;
  state.zombies.push(b);
  assert.equal(tryFire(state, createWeapon('thundergun'), 0, 0, 1, 0), true);
  assert.equal(calls.kill[0].amount, 4000 * BOSS.thunderNearFrac);
  assert.equal(calls.knock.length + calls.push.length, 0, 'dead boss is not knocked');

  const s2 = coneSetup({ wallT: 20 });
  const b2 = zombie(2, 100, 0, 8000); b2.kind = 'boss';
  s2.state.zombies.push(b2);
  tryFire(s2.state, createWeapon('thundergun'), 0, 0, 1, 0);
  assert.equal(s2.calls.kill.length + s2.calls.knock.length + s2.calls.push.length, 0, 'wall blocks the boss too');
});

// ---------------------------------------------------------------------------
// WO5 FIX-4 (playtest #2, balance #12): tier-2 TTK calculator. Sustained single-target fire from
// a full mag: first shot at t=0, then 60/rpm per shot; the shot that empties the mag is followed
// by max(interval, reloadTime). Pellet weapons land 80 % of their pellets; single-bullet guns hit
// every shot (equal accuracy for the KN-44 comparison). Uses expected damage, so shots-to-kill =
// ceil(hp / (damage * pellets * acc)).
// ---------------------------------------------------------------------------

const TIER2_IDS = ['weevil', 'xr2', 'marshal16', 'manowar', 'haymaker12', 'dredge48', 'gorgon', 'drakon'];
const L2 = { healthMult: 1.5 };

function ttkSeconds(d, hp) {
  const acc = d.pellets > 1 ? 0.8 : 1;
  const shots = Math.ceil(hp / (d.damage * d.pellets * acc) - 1e-9);
  const interval = 60 / d.rpm;
  let t = 0, mag = d.mag;
  for (let i = 1; i < shots; i++) {
    mag -= 1;
    if (mag <= 0) { t += Math.max(interval, d.reloadTime); mag = d.mag; } else t += interval;
  }
  return t;
}
// Mean TTK over level-2 rounds 6..12 (smooths the shots-to-kill steps, e.g. the Marshal's 2-shot cliff).
function meanTtkL2(d) {
  let sum = 0;
  for (let r = 6; r <= 12; r++) sum += ttkSeconds(d, healthForRound(r, L2));
  return sum / 7;
}

test('WO5 tier-2 TTK: every level-2 gun kills an L2 round-8 zombie in <= 0.85x the KN-44 time', () => {
  const hp = healthForRound(8, L2);
  assert.equal(hp, 1275);
  const kn = ttkSeconds(WEAPONS.kn44, hp);
  assert.ok(Math.abs(kn - 18 * 60 / 700) < 1e-9, 'KN-44: 19 shots, no reload');
  for (const id of TIER2_IDS) {
    assert.equal(WEAPONS[id].tier, 2, `${id} is tier 2`);
    const t = ttkSeconds(WEAPONS[id], hp);
    assert.ok(t <= 0.85 * kn, `${id} R8 TTK ${t.toFixed(3)} s > 0.85 x KN-44 ${kn.toFixed(3)} s`);
    assert.ok(meanTtkL2(WEAPONS[id]) <= 0.85 * meanTtkL2(WEAPONS.kn44), `${id} mean L2 TTK`);
  }
});

test('WO5 tier-2 TTK: price tracks power (Sanctum guns strongest, XR-2 not the best)', () => {
  const mean = Object.fromEntries(TIER2_IDS.map((id) => [id, meanTtkL2(WEAPONS[id])]));
  const others = TIER2_IDS.filter((id) => id !== 'gorgon' && id !== 'drakon');
  for (const top of ['gorgon', 'drakon']) {
    for (const id of others) assert.ok(mean[top] < mean[id], `${top} (${mean[top].toFixed(3)}) beats ${id} (${mean[id].toFixed(3)})`);
  }
  assert.ok(Math.min(...Object.values(mean)) < mean.xr2, 'XR-2 is not the best gun');
  // The cheapest gun is the weakest; the 275-point Dredge beats every 200-250 point gun.
  for (const id of TIER2_IDS) if (id !== 'weevil') assert.ok(mean[id] < mean.weevil, `${id} beats the 200-point Weevil`);
  for (const id of ['xr2', 'marshal16', 'manowar', 'haymaker12']) assert.ok(mean.dredge48 < mean[id], `dredge48 beats ${id}`);
  // Price-weighted: cost order never inverts by more than one price step (225 < 250 < 275 < 300).
  for (const a of TIER2_IDS) for (const b of TIER2_IDS) {
    if (WEAPONS[a].cost - WEAPONS[b].cost >= 50) assert.ok(mean[a] < mean[b], `${a} (${WEAPONS[a].cost}) beats ${b} (${WEAPONS[b].cost})`);
  }
});

test('WO5 tier-2 identities hold after the retune', () => {
  const W = WEAPONS;
  const t2 = TIER2_IDS.map((id) => W[id]);
  // Marshal 16: devastating close range = biggest single trigger pull, two-shot kill at L2 R8.
  const pull = (d) => d.damage * d.pellets * (d.pellets > 1 ? 0.8 : 1);
  for (const d of t2) if (d.id !== 'marshal16') assert.ok(pull(W.marshal16) > pull(d), `marshal16 pull > ${d.id}`);
  assert.equal(W.marshal16.mag, 2);
  assert.ok(2 * pull(W.marshal16) >= healthForRound(8, L2));
  // Drakon: highest per-bullet damage and penetrating, long range.
  for (const d of t2) if (d.id !== 'drakon') assert.ok(W.drakon.damage > d.damage, `drakon dmg > ${d.id}`);
  assert.ok(W.drakon.penetration >= 3 && W.drakon.range >= 2000);
  // Gorgon: heavy penetrating LMG, the best sustained single-target gun.
  assert.equal(W.gorgon.cls, 'lmg');
  assert.ok(W.gorgon.penetration >= 3);
  const dps = (d) => pull(d) * d.mag / ((d.mag - 1) * 60 / d.rpm + Math.max(60 / d.rpm, d.reloadTime));
  for (const d of t2) if (d.id !== 'gorgon') assert.ok(dps(W.gorgon) > dps(d), `gorgon sustained DPS > ${d.id}`);
  // 48 Dredge: high-volume LMG (fastest LMG, big mag); Weevil: fastest-firing tier-2 gun.
  assert.ok(W.dredge48.rpm > W.gorgon.rpm && W.dredge48.mag >= 48);
  for (const d of t2) if (d.id !== 'weevil') assert.ok(W.weevil.rpm > d.rpm, `weevil rpm > ${d.id}`);
  // Man-O-War: heavy AR (hits harder, fires slower than the XR-2, penetrates). XR-2: most accurate auto.
  assert.ok(W.manowar.damage > W.xr2.damage && W.manowar.rpm < W.xr2.rpm && W.manowar.penetration >= 2);
  for (const d of t2) if (d.auto && d.id !== 'xr2') assert.ok(W.xr2.spread < d.spread, `xr2 spread < ${d.id}`);
  // Haymaker 12: automatic shotgun.
  assert.ok(W.haymaker12.auto && W.haymaker12.pellets > 1);
});

test('WO5 balance #10: tier-2 wall ammo costs 0.3x the price, tier-1 keeps 0.5x', () => {
  const want = { weevil: 60, xr2: 68, marshal16: 68, manowar: 75, haymaker12: 75, dredge48: 83, gorgon: 90, drakon: 90 };
  for (const [id, c] of Object.entries(want)) assert.equal(ammoCost(id), c, id);
  for (const id of WALL_WEAPON_IDS) {
    if (WEAPONS[id].tier === 1) assert.equal(ammoCost(id), Math.round(WEAPONS[id].cost * 0.5), id);
  }
});

// ---------------------------------------------------------------------------
// WO7 (Agent F): perks (T2), knife (T3), tier-3 guns (T5)
// ---------------------------------------------------------------------------

import { meleeAttack, weaponPerkMods } from '../src/weapons.js';
import { PERKS, MELEE, ZOMBIE as ZCFG, BOSS as BOSS_CFG } from '../src/config.js';
import * as playerModule from '../src/player.js';
import { damageZombie as realDamageZombie } from '../src/zombie.js';

const havePerkMods = typeof playerModule.perkMods === 'function';
const L3 = { healthMult: 2.0 };
const TIER3_IDS = ['hg40', 'm8a7', 'peacekeeper'];
function meanTtkL3(d) {
  let sum = 0;
  for (let r = 6; r <= 12; r++) sum += ttkSeconds(d, healthForRound(r, L3));
  return sum / 7;
}

test('WO7 tier-3 defs: ids/names/classes/costs/mags/reloads per 1.5, tier 3, own sprites, box weight 2, ammo 0.3x', () => {
  const want = {
    hg40:        { name: 'HG 40', cls: 'smg', cost: 350, damage: 130, mag: 40, reserve: 280, reloadTime: 1.9, penetration: 2 }, // WO7 FIX-5 (balance #2)
    m8a7:        { name: 'M8A7', cls: 'ar', cost: 375, mag: 32, reserve: 256, reloadTime: 2.2, penetration: 3, spread: 0.02 }, // WO7 FIX-5 (balance #3)
    peacekeeper: { name: 'Peacekeeper MK2', cls: 'ar', cost: 400, mag: 30, reserve: 270, reloadTime: 2.3, penetration: 3 },
  };
  for (const [id, w] of Object.entries(want)) {
    const d = WEAPONS[id];
    assert.ok(d, id);
    for (const [k, v] of Object.entries(w)) assert.equal(d[k], v, `${id}.${k}`);
    assert.equal(d.tier, 3);
    assert.equal(d.auto, true);
    assert.equal(d.sprite, id);
    assert.ok(WALL_WEAPON_IDS.includes(id) && BOX_WEAPON_IDS.includes(id));
    assert.ok(!BOX_WALL_WEIGHT_IDS.includes(id));
    assert.equal(BOX_WEIGHTS[id], SHOP.boxWeights.boxOnly);
    assert.equal(ammoCost(id), Math.round(d.cost * PERKS.ammoMultTier3), `${id} ammo = ammoMultTier3 x price`);
  }
  assert.deepEqual(TIER3_IDS.map(ammoCost), [105, 113, 120]);
});

test('WO7 tier-3 TTK: every tier-3 gun out-kills every tier-2 gun on level-3 health; price tracks power', () => {
  const hp8 = healthForRound(8, L3);
  for (const id of TIER3_IDS) {
    const m3 = meanTtkL3(WEAPONS[id]);
    const r8 = ttkSeconds(WEAPONS[id], hp8);
    for (const o of TIER2_IDS) {
      assert.ok(m3 < meanTtkL3(WEAPONS[o]), `${id} mean L3 TTK ${m3.toFixed(3)} >= ${o} ${meanTtkL3(WEAPONS[o]).toFixed(3)}`);
      assert.ok(r8 <= ttkSeconds(WEAPONS[o], hp8), `${id} L3 R8 TTK vs ${o}`);
    }
  }
  const [h, m, p] = TIER3_IDS.map((id) => meanTtkL3(WEAPONS[id]));
  assert.ok(p < m && m < h, 'Peacekeeper (400) < M8A7 (375) < HG 40 (350)');
  // Identities: HG 40 fastest-firing with the biggest mag; M8A7 tightest spread; Peacekeeper hits hardest.
  const W3 = TIER3_IDS.map((id) => WEAPONS[id]);
  for (const d of W3) if (d.id !== 'hg40') assert.ok(WEAPONS.hg40.rpm > d.rpm && WEAPONS.hg40.mag > d.mag);
  for (const d of W3) if (d.id !== 'm8a7') assert.ok(WEAPONS.m8a7.spread < d.spread);
  for (const d of W3) if (d.id !== 'peacekeeper') assert.ok(WEAPONS.peacekeeper.damage > d.damage);
});

test('WO7 tier-3 guns fire (hg40 pen 2, m8a7 pen 3, peacekeeper pen 3)', () => {
  for (const [id, pen] of [['hg40', 2], ['m8a7', 3], ['peacekeeper', 3]]) {
    const { state, calls } = setup();
    state.zombies.push(zombie(1, 100, 0), zombie(2, 150, 0), zombie(3, 200, 0), zombie(4, 250, 0));
    assert.equal(tryFire(state, createWeapon(id), 0, 0, 1, 0), true);
    assert.equal(calls.zombie.length, pen, id);
    assert.ok(calls.zombie.every((c) => c.amount === WEAPONS[id].damage));
    resetWeaponDeps();
  }
});

// --- T2 perks ---

function withPerks(state, perks) {
  state.player = { x: 0, y: 0, radius: 14, angle: 0, perks: perks.slice(), weapons: [], activeSlot: 0, meleeCd: 0, meleeT: 0 };
  return state.player;
}
const ONES = { reloadMult: 1, rpmMult: 1, bulletDamageMult: 1 };

test('WO7 weaponPerkMods: no player / no perks -> all 1; Death Machine ignores perks', () => {
  const { state } = setup();
  assert.deepEqual(weaponPerkMods(state, createWeapon('kn44')), ONES);
  withPerks(state, []);
  assert.deepEqual(weaponPerkMods(state, createWeapon('kn44')), ONES);
  withPerks(state, ['speed', 'dtap']);
  assert.deepEqual(weaponPerkMods(state, createDeathMachine()), ONES);
  if (havePerkMods) {
    assert.deepEqual(weaponPerkMods(state, createWeapon('kn44')), {
      reloadMult: PERKS.list.speed.reloadMult, rpmMult: PERKS.list.dtap.rpmMult, bulletDamageMult: PERKS.list.dtap.bulletDamageMult,
    });
  }
});

test('WO7 Speed Cola halves reload time (explicit state, lastState fallback, auto-reload)', { skip: !havePerkMods }, () => {
  const { state } = setup();
  withPerks(state, ['speed']);
  const half = WEAPONS.kn44.reloadTime * PERKS.list.speed.reloadMult;
  const w = createWeapon('kn44');
  w.mag = 0;
  assert.equal(startReload(w, state), true);
  assert.ok(Math.abs(w.reloadT - half) < 1e-9);
  // player.js calls startReload(w) without state: the last state seen (updateBullets runs every frame).
  updateBullets(state, 0.016);
  const w2 = createWeapon('kn44');
  w2.mag = 0;
  assert.equal(startReload(w2), true);
  assert.ok(Math.abs(w2.reloadT - half) < 1e-9);
  const w3 = createWeapon('kn44');
  w3.mag = 1;
  tryFire(state, w3, 0, 0, 1, 0);
  assert.ok(w3.reloading && Math.abs(w3.reloadT - half) < 1e-9);
});

test('WO7 no perks: reload time unchanged', () => {
  const { state } = setup();
  withPerks(state, []);
  const w = createWeapon('kn44');
  w.mag = 0;
  startReload(w, state);
  assert.equal(w.reloadT, WEAPONS.kn44.reloadTime);
});

test('WO7 Double Tap II: rpm x1.33, hitscan damage x2 (pellets too); Ray Gun and Death Machine unchanged', { skip: !havePerkMods }, () => {
  const { state, calls } = setup();
  withPerks(state, ['dtap']);
  const w = createWeapon('kn44');
  tryFire(state, w, 0, 0, 1, 0);
  assert.ok(Math.abs(w.cooldown - 60 / (700 * PERKS.list.dtap.rpmMult)) < 1e-9, 'interval / 1.33');
  state.zombies.push(zombie(1, 100, 0, 1e6));
  w.cooldown = 0; w.triggerHeld = false;
  tryFire(state, w, 0, 0, 1, 0);
  assert.equal(calls.zombie.at(-1).amount, WEAPONS.kn44.damage * 2);
  calls.zombie.length = 0;
  tryFire(state, createWeapon('krm262'), 0, 0, 1, 0);
  assert.ok(calls.zombie.length > 0 && calls.zombie.every((c) => c.amount === WEAPONS.krm262.damage * 2), 'shotgun pellets doubled');
  calls.zombie.length = 0;
  const dm = createDeathMachine();
  tryFire(state, dm, 0, 0, 1, 0);
  assert.ok(Math.abs(dm.cooldown - 60 / WEAPONS.deathmachine.rpm) < 1e-9, 'Death Machine rpm unchanged');
  assert.ok(calls.zombie.length > 0 && calls.zombie.every((c) => c.amount === WEAPONS.deathmachine.damage));
  calls.zombie.length = 0;
  state.bullets.length = 0;
  tryFire(state, createWeapon('raygun'), 0, 0, 1, 0);
  updateBullets(state, 1);
  assert.equal(calls.zombie[0].amount, WEAPONS.raygun.damage, 'Ray Gun projectile unchanged');
});

test('WO7 FIX-5 Double Tap vs boss: rpm x1.33 kept, bullet damage x BOSS.dtapDamageMult on the boss only', { skip: !havePerkMods }, () => {
  assert.equal(BOSS_CFG.dtapDamageMult, 1);
  const { state, calls } = setup();
  withPerks(state, ['dtap']);
  // Boss between two normal zombies on the same ray: penetration 3 hits all three.
  const a = zombie(1, 100, 0, 1e6), b = { ...zombie(2, 150, 0, 1e6), kind: 'boss', radius: 34 }, c = { ...zombie(3, 220, 0, 1e6), kind: 'minion' };
  state.zombies.push(a, b, c);
  const w = createWeapon('peacekeeper');
  tryFire(state, w, 0, 0, 1, 0);
  assert.ok(Math.abs(w.cooldown - 60 / (WEAPONS.peacekeeper.rpm * PERKS.list.dtap.rpmMult)) < 1e-9, 'rpm bonus still applies');
  const by = new Map(calls.zombie.map((x) => [x.z.id, x.amount]));
  assert.equal(by.get(1), WEAPONS.peacekeeper.damage * PERKS.list.dtap.bulletDamageMult);
  assert.equal(by.get(2), WEAPONS.peacekeeper.damage * BOSS_CFG.dtapDamageMult, 'boss not doubled');
  assert.equal(by.get(3), WEAPONS.peacekeeper.damage * PERKS.list.dtap.bulletDamageMult, 'minions doubled');
  // Shotgun pellets too.
  calls.zombie.length = 0;
  state.zombies.length = 0; state.zombies.push({ ...zombie(4, 60, 0, 1e6), kind: 'boss', radius: 34 });
  tryFire(state, createWeapon('krm262'), 0, 0, 1, 0);
  assert.ok(calls.zombie.length > 0 && calls.zombie.every((x) => x.amount === WEAPONS.krm262.damage), 'boss pellets not doubled');
  // Without Double Tap the boss takes plain damage (the cap never raises damage).
  calls.zombie.length = 0;
  withPerks(state, []);
  tryFire(state, createWeapon('kn44'), 0, 0, 1, 0);
  assert.equal(calls.zombie.at(-1).amount, WEAPONS.kn44.damage);
  // hitscan's bossDamage parameter defaults to damage.
  calls.zombie.length = 0;
  hitscan(state, 0, 0, 1, 0, 1000, 1, 77);
  assert.equal(calls.zombie[0].amount, 77);
});

test('WO7 updateBullets leaves foreign (acid) entries in state.bullets untouched', () => {
  const { state } = setup();
  const glob = { kind: 'acid', x: 5, y: 5, vx: 10, vy: 0, ttl: 1 };
  state.bullets.push(glob);
  updateBullets(state, 0.1);
  assert.deepEqual(state.bullets, [glob]);
  assert.equal(glob.x, 5);
});

// --- T3 knife ---

function knifeSetup(opts) {
  const s = setup(opts);
  const knocks = [], pushes = [];
  setWeaponDeps({
    applyKnockback: (st, z, vx, vy, stun) => { knocks.push({ z, vx, vy, stun }); return true; },
    pushZombie: (st, z, dx, dy) => { pushes.push({ z, dx, dy }); return true; },
  });
  const p = withPerks(s.state, []);
  return { ...s, p, knocks, pushes };
}

test('WO7 meleeAttack: reach/arc, nearest first, max 3, damage 150, timers, events, slash, knockback', () => {
  const { state, calls, p, knocks } = knifeSetup();
  const swings = [], hits = [];
  events.on('melee:swing', (e) => swings.push(e));
  events.on('melee:hit', (e) => hits.push(e));
  // edge gap = d - 14 - 14 <= 44  ->  d <= 72
  state.zombies.push(
    zombie(1, 40, 0), zombie(2, 60, 10), zombie(3, 70, -5), zombie(4, 50, 20), // 4 in the arc: 3 hit
    zombie(5, 80, 0),   // out of reach
    zombie(6, 0, 50),   // in reach, 90 deg off the aim
    zombie(7, -40, 0),  // behind
  );
  assert.equal(meleeAttack(state, p), 3);
  assert.deepEqual(calls.zombie.map((c) => c.z.id), [1, 4, 2]);
  assert.ok(calls.zombie.every((c) => c.amount === MELEE.damage && c.cause === 'weapon'));
  assert.equal(p.meleeCd, MELEE.cooldown);
  assert.equal(p.meleeT, MELEE.swingTime);
  assert.deepEqual(swings, [{ x: 0, y: 0, angle: 0 }]);
  assert.deepEqual(hits, [{ zombieId: 1, killed: false }, { zombieId: 4, killed: false }, { zombieId: 2, killed: false }]);
  const slash = state.effects.find((e) => e.type === 'slash');
  assert.deepEqual(slash, { type: 'slash', x: 0, y: 0, angle: 0, ttl: 0.18, maxTtl: 0.18 });
  assert.equal(knocks.length, 3);
  const stun = Math.log(MELEE.knockback / ZCFG.stunMinSpeed) / ZCFG.knockFriction;
  for (const k of knocks) {
    assert.ok(Math.abs(Math.hypot(k.vx, k.vy) - MELEE.knockback) < 1e-9);
    assert.ok(k.vx > 0, 'pushed away from the player');
    assert.ok(Math.abs(k.stun - stun) < 1e-9);
  }
});

test('WO7 meleeAttack: cooldown blocks; whiff still swings; no knife while down', () => {
  const { state, p, calls } = knifeSetup();
  let swings = 0;
  events.on('melee:swing', () => swings++);
  assert.equal(meleeAttack(state, p), 0, 'whiff');
  assert.equal(swings, 1);
  assert.equal(meleeAttack(state, p), 0);
  assert.equal(swings, 1, 'on cooldown: no second swing');
  p.meleeCd = 0;
  state.zombies.push(zombie(1, 30, 0));
  assert.equal(meleeAttack(state, p), 1);
  assert.equal(calls.zombie.length, 1);
  p.meleeCd = 0; p.downT = 1;
  assert.equal(meleeAttack(state, p), 0);
  assert.equal(swings, 2);
});

test('WO7 meleeAttack: a kill reports killed and skips knockback; the swing cancels an active reload', () => {
  const { state, p, knocks } = knifeSetup();
  const hits = [];
  events.on('melee:hit', (e) => hits.push(e));
  const w = createWeapon('kn44');
  w.mag = 0;
  startReload(w, state);
  p.weapons = [w];
  state.zombies.push(zombie(1, 30, 0, 100));
  assert.equal(meleeAttack(state, p), 1);
  assert.deepEqual(hits, [{ zombieId: 1, killed: true }]);
  assert.equal(knocks.length, 0);
  assert.equal(w.reloading, false);
  assert.equal(w.reloadT, 0);
  assert.equal(w.mag, 0, 'cancelled, not completed');
});

test('WO7 meleeAttack: walls block; boss is pushed (no stun); follows player.angle', () => {
  const blocked = knifeSetup({ wallT: 5 });
  blocked.state.zombies.push(zombie(1, 40, 0));
  assert.equal(meleeAttack(blocked.state, blocked.p), 0);
  assert.equal(blocked.calls.zombie.length, 0);
  resetWeaponDeps();

  const { state, p, pushes, knocks } = knifeSetup();
  p.angle = Math.PI / 2; // aiming +y
  const boss = { ...zombie(9, 0, 60, 50000), kind: 'boss', radius: 34 };
  state.zombies.push(boss, zombie(1, 40, 0));
  assert.equal(meleeAttack(state, p), 1);
  assert.equal(knocks.length, 0);
  assert.equal(pushes.length, 1);
  assert.ok(Math.abs(pushes[0].dx) < 1e-9 && pushes[0].dy > 0);
  assert.ok(Math.abs(pushes[0].dy - (MELEE.knockback - ZCFG.stunMinSpeed) / ZCFG.knockFriction) < 1e-9);
});

test('WO7 meleeAttack with the real zombie.damageZombie: normal 150, Insta-Kill lethal, boss per-hit cap', () => {
  resetWeaponDeps();
  setWeaponDeps({ applyKnockback: () => true, pushZombie: () => true, damageZombie: realDamageZombie });
  const state = createEmptyState(3);
  state.map = null;
  const p = withPerks(state, []);
  const z = { ...zombie(1, 30, 0, 5000), kind: 'normal' };
  state.zombies.push(z);
  meleeAttack(state, p);
  assert.equal(z.hp, 5000 - MELEE.damage);
  state.powerups.active.instaKill = (state.time || 0) + 10;
  p.meleeCd = 0;
  meleeAttack(state, p);
  assert.ok(!(z.hp > 0), 'Insta-Kill makes the knife lethal');
  delete state.powerups.active.instaKill;
  const b = { ...zombie(2, 30, 0, 100000), kind: 'boss', radius: 34, maxHp: 100000 };
  state.zombies = [b];
  p.meleeCd = 0;
  meleeAttack(state, p);
  assert.equal(100000 - b.hp, Math.min(MELEE.damage, BOSS_CFG.maxHitFrac * 100000));
  const small = { ...zombie(3, 30, 0, 1000), kind: 'boss', radius: 34, maxHp: 1000 };
  state.zombies = [small];
  p.meleeCd = 0;
  meleeAttack(state, p);
  assert.ok(Math.abs((1000 - small.hp) - BOSS_CFG.maxHitFrac * 1000) < 1e-9, 'capped');
});
