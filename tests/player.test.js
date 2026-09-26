import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER, POINTS } from '../src/config.js';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as weapons from '../src/weapons.js';
import * as powerups from '../src/powerups.js';
import {
  createPlayer, initPlayer, updatePlayer, damagePlayer, addPoints, spendPoints,
  getActiveWeapon, giveWeapon, hasWeapon, equipTemporary, clearTemporary,
} from '../src/player.js';

const isStub = (fn) => String(fn).includes('not implemented');
const powerupsStub = isStub(powerups.isActive);
const weaponsStub = isStub(weapons.createWeapon) || isStub(weapons.updateWeapon)
  || isStub(weapons.tryFire) || isStub(weapons.startReload);

function makeState() {
  events.clearAll();
  const s = createEmptyState(1);
  s.player = createPlayer(100, 100);
  s.phase = 'playing';
  return s; // map stays null: updatePlayer skips collision without a map
}

function fakeWeapon(id, extra = {}) {
  return { id, def: { mag: 10, reserve: 50 }, mag: 10, reserve: 50, reloading: false, reloadT: 0, cooldown: 0, triggerHeld: false, ...extra };
}

function capture(name) {
  const got = [];
  events.on(name, (p) => got.push(p));
  return got;
}

const noInput = { moveX: 0, moveY: 0, fire: false, reload: false, swap: false, sprint: false };

test('createPlayer matches the entity shape', () => {
  const p = createPlayer(5, 6);
  assert.equal(p.x, 5); assert.equal(p.y, 6);
  assert.equal(p.health, PLAYER.maxHealth);
  assert.equal(p.weapons.length, PLAYER.weaponSlots);
  assert.deepEqual(p.weapons, [null, null]);
  assert.equal(p.tempWeapon, null);
  assert.equal(p.down, false);
  assert.equal(p.boardsThisRound, 0);
});

test('damagePlayer reduces health, sets regenTimer, emits player:damaged', () => {
  const s = makeState();
  const got = capture('player:damaged');
  damagePlayer(s, 50);
  assert.equal(s.player.health, PLAYER.maxHealth - 50);
  assert.equal(s.player.regenTimer, PLAYER.regenDelay);
  assert.deepEqual(got, [{ amount: 50, health: PLAYER.maxHealth - 50 }]);
});

test('regen waits regenDelay then heals at regenPerSec up to max', () => {
  const s = makeState();
  damagePlayer(s, 100);
  const hp = s.player.health;
  const dt = 0.1;
  const steps = Math.round(PLAYER.regenDelay / dt) - 1;
  for (let i = 0; i < steps; i++) updatePlayer(s, noInput, null, dt);
  assert.equal(s.player.health, hp, 'no regen before delay');
  updatePlayer(s, noInput, null, dt); // timer reaches 0
  updatePlayer(s, noInput, null, 0.5);
  assert.ok(Math.abs(s.player.health - (hp + PLAYER.regenPerSec * 0.5)) < 1e-6);
  // Enough time to fully heal at the configured rate (WO3: 1 HP/s -> ~100 s here), then clamp.
  const healSteps = Math.ceil(PLAYER.maxHealth / PLAYER.regenPerSec / 0.1) + 10;
  for (let i = 0; i < healSteps; i++) updatePlayer(s, noInput, null, 0.1);
  assert.equal(s.player.health, PLAYER.maxHealth);
});

test('damage during regen resets the delay', () => {
  const s = makeState();
  damagePlayer(s, 50);
  for (let i = 0; i < 39; i++) updatePlayer(s, noInput, null, 0.1);
  damagePlayer(s, 10);
  const hp = s.player.health;
  updatePlayer(s, noInput, null, 0.5);
  assert.equal(s.player.health, hp);
});

// WO3: regenPerSec 60 -> 1. Explicit rate checks (expected values derived from config so a
// future retune only needs these literals if the rate itself is the thing being asserted).
test('WO3: regen after the delay gains regenPerSec * 10 HP in 10 s (~10 HP at 1 HP/s)', () => {
  assert.equal(PLAYER.regenPerSec, 1, 'WO3 sets regenPerSec to 1');
  assert.equal(PLAYER.regenDelay, 4.0, 'WO3 keeps regenDelay at 4.0');
  const s = makeState();
  s.player.health = 50; s.player.regenTimer = PLAYER.regenDelay;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(PLAYER.regenDelay / dt); i++) updatePlayer(s, noInput, null, dt);
  assert.ok(Math.abs(s.player.health - 50) < 1e-6, 'still 50 after the delay');
  for (let i = 0; i < 600; i++) updatePlayer(s, noInput, null, dt);
  assert.ok(Math.abs(s.player.health - (50 + PLAYER.regenPerSec * 10)) < 0.05, `gained regenPerSec*10, got ${s.player.health}`);
  assert.ok(Math.abs(s.player.health - 60) < 0.05, '~10 HP gained at 1 HP/s');
});

test('WO3: 60 s of healing from 50 HP reaches ~110, not full (150)', () => {
  const s = makeState();
  s.player.health = 50; s.player.regenTimer = 0; // delay already elapsed
  for (let i = 0; i < 60 * 60; i++) updatePlayer(s, noInput, null, 1 / 60);
  assert.ok(Math.abs(s.player.health - 110) < 0.01, `expected ~110, got ${s.player.health}`);
  assert.ok(s.player.health < PLAYER.maxHealth);
  // Fractional accumulation: HP is not rounded per frame, so a sub-1-HP step still counts.
  const before = s.player.health;
  updatePlayer(s, noInput, null, 1 / 60);
  assert.ok(s.player.health > before && s.player.health - before < 0.02);
});

test('WO3: taking damage mid-regen resets the full delay before healing resumes', () => {
  const s = makeState();
  s.player.health = 50; s.player.regenTimer = 0;
  for (let i = 0; i < 5; i++) updatePlayer(s, noInput, null, 1); // +5 HP
  assert.ok(Math.abs(s.player.health - 55) < 1e-6);
  damagePlayer(s, 10);
  assert.equal(s.player.regenTimer, PLAYER.regenDelay);
  const hp = s.player.health;
  for (let i = 0; i < 39; i++) updatePlayer(s, noInput, null, 0.1); // 3.9 s: still inside the delay
  assert.ok(Math.abs(s.player.health - hp) < 1e-6, 'no regen during the reset delay');
  updatePlayer(s, noInput, null, 0.1); // delay reaches 0
  for (let i = 0; i < 10; i++) updatePlayer(s, noInput, null, 0.1); // 1 s of regen
  assert.ok(Math.abs(s.player.health - (hp + PLAYER.regenPerSec)) < 0.11);
});

test('health <= 0 downs the player once and emits player:down with stats', () => {
  const s = makeState();
  s.stats.kills = 7; s.player.points = 70; s.rounds = { round: 3 };
  const got = capture('player:down');
  damagePlayer(s, 100); damagePlayer(s, 100); damagePlayer(s, 100);
  assert.equal(s.player.down, true);
  assert.equal(s.player.health, 0);
  assert.deepEqual(got, [{ round: 3, kills: 7, points: 70 }]);
});

test('invulnerable player takes no damage', () => {
  const s = makeState();
  s.player.invulnerable = true;
  damagePlayer(s, 500);
  assert.equal(s.player.health, PLAYER.maxHealth);
});

test('spendPoints refuses and changes nothing when insufficient', () => {
  const s = makeState();
  s.player.points = 40;
  const got = capture('points:changed');
  assert.equal(spendPoints(s, 50), false);
  assert.equal(s.player.points, 40);
  assert.equal(got.length, 0);
  assert.equal(spendPoints(s, 40), true);
  assert.equal(s.player.points, 0);
  assert.deepEqual(got, [{ delta: -40, total: 0 }]);
});

test('movement: speed, diagonal normalization, sprint, firing cancels sprint', () => {
  const s = makeState();
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 0.5);
  assert.equal(s.player.x, 100 + PLAYER.speed * 0.5);
  assert.equal(s.player.moving, true);
  assert.equal(s.player.sprinting, false);

  const s2 = makeState();
  updatePlayer(s2, { ...noInput, moveX: 1, moveY: 1 }, null, 1);
  const d = Math.hypot(s2.player.x - 100, s2.player.y - 100);
  assert.ok(Math.abs(d - PLAYER.speed) < 1e-6);

  const s3 = makeState();
  updatePlayer(s3, { ...noInput, moveX: 1, sprint: true }, null, 1);
  assert.equal(s3.player.sprinting, true);
  assert.ok(Math.abs(s3.player.x - (100 + PLAYER.speed * PLAYER.sprintMult)) < 1e-6);

  const s4 = makeState(); // no weapon held, so fire does not reach weapons.js
  updatePlayer(s4, { ...noInput, moveX: 1, sprint: true, fire: true }, null, 1);
  assert.equal(s4.player.sprinting, false);
});

test('angle faces the aim point; downed player does not move', () => {
  const s = makeState();
  updatePlayer(s, noInput, { x: 100, y: 200 }, 0.016);
  assert.ok(Math.abs(s.player.angle - Math.PI / 2) < 1e-9);
  s.player.down = true;
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 1);
  assert.equal(s.player.x, 100);
});

test('giveWeapon fills empty slots first, then replaces the active slot', () => {
  const s = makeState();
  const got = capture('weapon:equipped');
  giveWeapon(s, fakeWeapon('mr6'));
  assert.equal(s.player.activeSlot, 0);
  giveWeapon(s, fakeWeapon('kn44'));
  assert.equal(s.player.activeSlot, 1);
  assert.equal(s.player.weapons[1].id, 'kn44');
  s.player.activeSlot = 0;
  giveWeapon(s, fakeWeapon('vmp'));
  assert.deepEqual(s.player.weapons.map((w) => w.id), ['vmp', 'kn44']);
  assert.equal(s.player.activeSlot, 0);
  assert.deepEqual(got.map((e) => [e.weaponId, e.slot]), [['mr6', 0], ['kn44', 1], ['vmp', 0]]);
  assert.equal(hasWeapon(s.player, 'kn44'), true);
  assert.equal(hasWeapon(s.player, 'mr6'), false);
});

test('temporary weapon overrides active weapon and clears back', () => {
  const s = makeState();
  giveWeapon(s, fakeWeapon('mr6', { reloading: true, reloadT: 1 }));
  const dm = fakeWeapon('deathmachine');
  equipTemporary(s, dm);
  assert.equal(getActiveWeapon(s.player), dm);
  assert.equal(s.player.weapons[0].reloading, false, 'reload cancelled');
  assert.equal(hasWeapon(s.player, 'deathmachine'), false);
  clearTemporary(s);
  assert.equal(getActiveWeapon(s.player).id, 'mr6');
});

test('round:start resets boardsThisRound; re-init does not duplicate listeners', () => {
  const s = makeState();
  initPlayer(s);
  initPlayer(s);
  s.player.boardsThisRound = 5;
  events.emit('round:start', { round: 2 });
  assert.equal(s.player.boardsThisRound, 0);
});

// ---- Paths that call powerups.isActive (stub-guarded) ----

test('addPoints awards points, updates stats, emits points:changed', { skip: powerupsStub }, () => {
  const s = makeState();
  const got = capture('points:changed');
  assert.equal(addPoints(s, 10, 3, 4), 10);
  assert.equal(s.player.points, 10);
  assert.equal(s.stats.pointsEarned, 10);
  assert.deepEqual(got, [{ delta: 10, total: 10, x: 3, y: 4 }]);
});

test('double points doubles awards', { skip: powerupsStub }, () => {
  const s = makeState();
  s.time = 5;
  s.powerups.active.doublePoints = 30;
  assert.equal(addPoints(s, 10), 20);
  assert.equal(s.player.points, 20);
  assert.equal(s.stats.pointsEarned, 20);
});

test('zombie:killed awards perKill and counts kills; debug kills do not', { skip: powerupsStub }, () => {
  const s = makeState();
  initPlayer(s);
  initPlayer(s); // no duplicate listeners
  events.emit('zombie:killed', { zombie: {}, cause: 'weapon', x: 1, y: 2 });
  events.emit('zombie:killed', { zombie: {}, cause: 'nuke', x: 1, y: 2 });
  events.emit('zombie:killed', { zombie: {}, cause: 'debug', x: 1, y: 2 });
  assert.equal(s.player.points, POINTS.perKill * 2);
  assert.equal(s.stats.kills, 2);
});

// ---- Paths that call weapons.js (stub-guarded) ----

test('giveWeapon by id uses weapons.createWeapon', { skip: weaponsStub }, () => {
  const s = makeState();
  const w = giveWeapon(s, 'mr6');
  assert.equal(w.id, 'mr6');
  assert.equal(getActiveWeapon(s.player), w);
});

test('swap via Q and slot keys, cancels reload, blocked by temp weapon', { skip: weaponsStub }, () => {
  const s = makeState();
  giveWeapon(s, 'mr6');
  giveWeapon(s, 'kn44');
  assert.equal(s.player.activeSlot, 1);
  s.player.weapons[1].reloading = true;
  updatePlayer(s, { ...noInput, swap: true }, null, 0.016);
  assert.equal(s.player.activeSlot, 0);
  assert.equal(s.player.weapons[1].reloading, false);
  updatePlayer(s, { ...noInput, slot: 2 }, null, 0.016);
  assert.equal(s.player.activeSlot, 1);
  equipTemporary(s, weapons.createDeathMachine());
  updatePlayer(s, { ...noInput, swap: true }, null, 0.016);
  assert.equal(s.player.activeSlot, 1);
});

test('firing sets triggerHeld and auto-reloads on empty mag', { skip: weaponsStub }, () => {
  const s = makeState();
  const w = giveWeapon(s, 'mr6');
  w.mag = 0;
  updatePlayer(s, { ...noInput, fire: true }, { x: 200, y: 100 }, 0.016);
  assert.equal(w.triggerHeld, true);
  assert.equal(w.reloading, true);
  updatePlayer(s, noInput, { x: 200, y: 100 }, 0.016);
  assert.equal(w.triggerHeld, false);
});
