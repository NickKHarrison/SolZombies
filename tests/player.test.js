import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER, POINTS, PERKS, MELEE, BOSS } from '../src/config.js';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as weapons from '../src/weapons.js';
import * as powerups from '../src/powerups.js';
import {
  createPlayer, initPlayer, updatePlayer, damagePlayer, addPoints, spendPoints,
  getActiveWeapon, giveWeapon, hasWeapon, equipTemporary, clearTemporary,
  perkMods, addPerk, removeAllPerks, hasPerk, slowMult,
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

// ---- WO7: perks, Quick Revive, knife ----

const REV = PERKS.list.revive;

test('WO7 createPlayer has perk/knife fields', () => {
  const p = createPlayer(0, 0);
  assert.deepEqual(p.perks, []);
  assert.equal(p.reviveUses, 0);
  assert.equal(p.invulnT, 0);
  assert.equal(p.downT, 0);
  assert.equal(p.meleeCd, 0);
  assert.equal(p.meleeT, 0);
});

test('WO7 perkMods: neutral without perks, multiplies per held perk', () => {
  const p = createPlayer(0, 0);
  assert.deepEqual(perkMods(p), {
    reloadMult: 1, rpmMult: 1, bulletDamageMult: 1, speedMult: 1, sprintMult: 1,
    weaponSlots: PLAYER.weaponSlots, maxHealth: PLAYER.maxHealth,
  });
  p.perks = ['speed', 'dtap', 'stamin', 'mule', 'jugg'];
  const m = perkMods(p);
  assert.equal(m.reloadMult, PERKS.list.speed.reloadMult);
  assert.equal(m.rpmMult, PERKS.list.dtap.rpmMult);
  assert.equal(m.bulletDamageMult, PERKS.list.dtap.bulletDamageMult);
  assert.equal(m.speedMult, PERKS.list.stamin.speedMult);
  assert.equal(m.sprintMult, PERKS.list.stamin.sprintMult);
  assert.equal(m.weaponSlots, 3);
  assert.equal(m.maxHealth, 250);
  assert.equal(perkMods(null).speedMult, 1);
});

test('WO7 addPerk: unique, unknown refused, cap at maxPerks, counts perksBought', () => {
  const s = makeState();
  assert.equal(addPerk(s, 'speed'), true);
  assert.equal(hasPerk(s.player, 'speed'), true);
  assert.equal(addPerk(s, 'speed'), false, 'duplicate');
  assert.equal(addPerk(s, 'nope'), false, 'unknown');
  assert.equal(addPerk(s, 'dtap'), true);
  assert.equal(addPerk(s, 'stamin'), true);
  assert.equal(addPerk(s, 'revive'), true);
  assert.equal(PERKS.maxPerks, 4);
  assert.equal(addPerk(s, 'jugg'), false, 'cap');
  assert.deepEqual(s.player.perks, ['speed', 'dtap', 'stamin', 'revive']);
  assert.equal(s.stats.perksBought, 4);
  assert.equal(hasPerk(s.player, 'jugg'), false);
  assert.equal(hasPerk(null, 'jugg'), false);
});

test('WO7 Juggernog: maxHealth 250 and heals to full; lost -> back to 150', () => {
  const s = makeState();
  s.player.health = 40;
  assert.equal(addPerk(s, 'jugg'), true);
  assert.equal(s.player.maxHealth, PERKS.list.jugg.maxHealth);
  assert.equal(s.player.health, 250);
  const lost = capture('perk:lost');
  removeAllPerks(s, 'debug');
  assert.equal(s.player.maxHealth, PLAYER.maxHealth);
  assert.equal(s.player.health, PLAYER.maxHealth);
  assert.deepEqual(lost, [{ perkId: 'jugg', reason: 'debug' }]);
  assert.deepEqual(s.player.perks, []);
});

test('WO7 Mule Kick: third slot, giveWeapon fills it, digit 3 and Q cycle 3 slots', { skip: weaponsStub }, () => {
  const s = makeState();
  giveWeapon(s, 'mr6');
  giveWeapon(s, 'kn44');
  assert.equal(addPerk(s, 'mule'), true);
  assert.equal(s.player.weapons.length, 3);
  assert.equal(s.player.weapons[2], null);
  giveWeapon(s, 'mr6');
  assert.equal(s.player.activeSlot, 2, 'third gun goes to the new slot');
  updatePlayer(s, { ...noInput, slot: 1 }, null, 0.016);
  assert.equal(s.player.activeSlot, 0);
  updatePlayer(s, { ...noInput, swap: true }, null, 0.016);
  assert.equal(s.player.activeSlot, 1);
  updatePlayer(s, { ...noInput, swap: true }, null, 0.016);
  assert.equal(s.player.activeSlot, 2);
  updatePlayer(s, { ...noInput, swap: true }, null, 0.016);
  assert.equal(s.player.activeSlot, 0);
  updatePlayer(s, { ...noInput, slot: 3 }, null, 0.016);
  assert.equal(s.player.activeSlot, 2);
});

test('WO7 Mule Kick lost: third gun dropped, active slot 2 falls back to slot 0', () => {
  const s = makeState();
  const a = fakeWeapon('a'), b = fakeWeapon('b'), c = fakeWeapon('c', { reloading: true, reloadT: 1 });
  s.player.weapons = [a, b];
  addPerk(s, 'mule');
  s.player.weapons[2] = c;
  s.player.activeSlot = 2;
  const eq = capture('weapon:equipped');
  removeAllPerks(s, 'revive');
  assert.deepEqual(s.player.weapons, [a, b]);
  assert.equal(s.player.activeSlot, 0);
  assert.equal(c.reloading, false);
  assert.deepEqual(eq, [{ weaponId: 'a', slot: 0 }]);
  // Not active: slot 1 stays selected, third gun still dropped.
  addPerk(s, 'mule');
  s.player.weapons[2] = c;
  s.player.activeSlot = 1;
  removeAllPerks(s, 'debug');
  assert.deepEqual(s.player.weapons, [a, b]);
  assert.equal(s.player.activeSlot, 1);
  // Re-buying gives an empty third slot.
  addPerk(s, 'mule');
  assert.deepEqual(s.player.weapons, [a, b, null]);
});

test('WO7 removeAllPerks emits perk:lost per perk in order; no-op when empty', () => {
  const s = makeState();
  addPerk(s, 'speed'); addPerk(s, 'revive'); addPerk(s, 'stamin');
  const lost = capture('perk:lost');
  removeAllPerks(s, 'revive');
  assert.deepEqual(lost.map((e) => e.perkId), ['speed', 'revive', 'stamin']);
  assert.ok(lost.every((e) => e.reason === 'revive'));
  removeAllPerks(s, 'debug');
  assert.equal(lost.length, 3);
});

test('WO7 without Quick Revive, 0 HP is game over as before', () => {
  const s = makeState();
  addPerk(s, 'speed');
  const downed = capture('player:downed');
  const down = capture('player:down');
  damagePlayer(s, 999);
  assert.equal(s.player.down, true);
  assert.equal(s.player.downT, 0);
  assert.equal(downed.length, 0);
  assert.equal(down.length, 1);
});

test('WO7 Quick Revive: down pause, no move/fire, revive at 150 with invulnerability, all perks lost', () => {
  const s = makeState();
  s.player.reviveUses = 1;
  addPerk(s, 'jugg'); addPerk(s, 'revive'); addPerk(s, 'stamin');
  const downed = capture('player:downed');
  const revived = capture('player:revived');
  const down = capture('player:down');
  const lost = capture('perk:lost');
  damagePlayer(s, 300);
  assert.equal(s.player.down, false, 'not game over');
  assert.equal(s.player.health, 0);
  assert.equal(s.player.downT, REV.downSeconds);
  assert.deepEqual(downed, [{ reviveIn: REV.downSeconds }]);
  assert.equal(down.length, 0);
  // Further damage is ignored while down.
  damagePlayer(s, 50);
  assert.equal(s.player.health, 0);
  // No movement while down.
  const x0 = s.player.x;
  updatePlayer(s, { ...noInput, moveX: 1, fire: true }, null, 0.5);
  assert.equal(s.player.x, x0);
  assert.equal(s.player.moving, false);
  assert.equal(revived.length, 0);
  assert.ok(Math.abs(s.player.downT - (REV.downSeconds - 0.5)) < 1e-9);
  updatePlayer(s, noInput, null, 0.5);
  assert.equal(revived.length, 0);
  updatePlayer(s, noInput, null, 0.6); // pause over
  assert.equal(s.player.downT, 0);
  assert.equal(s.player.maxHealth, PLAYER.maxHealth);
  assert.equal(s.player.health, PLAYER.maxHealth);
  assert.deepEqual(revived, [{ health: PLAYER.maxHealth }]);
  assert.deepEqual(s.player.perks, []);
  assert.deepEqual(lost.map((e) => e.perkId), ['jugg', 'revive', 'stamin']);
  assert.equal(s.player.reviveUses, 1, 'uses unchanged by revive');
  assert.equal(s.player.invulnT, REV.invulnSeconds);
  // Invulnerable: damage ignored until invulnT runs out.
  damagePlayer(s, 100);
  assert.equal(s.player.health, PLAYER.maxHealth);
  updatePlayer(s, noInput, null, 1.0);
  damagePlayer(s, 100);
  assert.equal(s.player.health, PLAYER.maxHealth);
  updatePlayer(s, noInput, null, 1.01);
  assert.equal(s.player.invulnT, 0);
  damagePlayer(s, 100);
  assert.equal(s.player.health, PLAYER.maxHealth - 100);
  // Now without the perk, going down again is game over.
  damagePlayer(s, 999);
  assert.equal(s.player.down, true);
  assert.equal(down.length, 1);
});

test('WO7 Stamin-Up: move speed x1.07, sprint mult x1.2', () => {
  const s = makeState();
  addPerk(s, 'stamin');
  const st = PERKS.list.stamin;
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 1);
  assert.ok(Math.abs(s.player.x - (100 + PLAYER.speed * st.speedMult)) < 1e-6);
  const x1 = s.player.x;
  updatePlayer(s, { ...noInput, moveX: 1, sprint: true }, null, 1);
  assert.ok(Math.abs(s.player.x - (x1 + PLAYER.speed * st.speedMult * PLAYER.sprintMult * st.sprintMult)) < 1e-6);
});

test('WO7 knife timers tick down; melee input without a target is harmless', () => {
  const s = makeState();
  s.player.meleeCd = 0.5; s.player.meleeT = 0.25;
  updatePlayer(s, noInput, null, 0.2);
  assert.ok(Math.abs(s.player.meleeCd - 0.3) < 1e-9);
  assert.ok(Math.abs(s.player.meleeT - 0.05) < 1e-9);
  updatePlayer(s, noInput, null, 0.2);
  assert.equal(s.player.meleeT, 0);
  assert.doesNotThrow(() => updatePlayer(s, { ...noInput, melee: true }, { x: 200, y: 100 }, 0.016));
});

test('WO7 knife input calls weapons.meleeAttack (sets the swing timers)',
  { skip: typeof weapons.meleeAttack !== 'function' }, () => {
    const s = makeState();
    s.zombies = [];
    updatePlayer(s, { ...noInput, melee: true }, { x: 200, y: 100 }, 0.016);
    assert.ok(s.player.meleeT > 0 || s.player.meleeCd > 0);
  });

test('WO7 no firing during the knife swing', { skip: weaponsStub }, () => {
  const s = makeState();
  const w = giveWeapon(s, 'mr6');
  const mag = w.mag;
  s.player.meleeT = 0.2;
  updatePlayer(s, { ...noInput, fire: true }, { x: 200, y: 100 }, 0.016);
  assert.equal(w.mag, mag);
});

test('WO7 knife kill pays MELEE.bonusPoints on top of perKill and counts meleeKills', { skip: powerupsStub }, () => {
  const s = makeState();
  initPlayer(s);
  events.emit('zombie:killed', { zombie: {}, cause: 'melee', x: 1, y: 2 });
  events.emit('melee:hit', { zombieId: 1, killed: true });
  events.emit('melee:hit', { zombieId: 2, killed: false });
  assert.equal(s.player.points, POINTS.perKill + MELEE.bonusPoints);
  assert.equal(s.stats.meleeKills, 1);
  assert.equal(s.stats.kills, 1);
});

test('WO8 FIX-A (M1): Mule Kick lost with slot 0 empty switches to the first filled slot', () => {
  const s = makeState();
  const sheiva = fakeWeapon('sheiva'), kn = fakeWeapon('kn44');
  s.player.weapons = [null, sheiva];
  addPerk(s, 'mule');
  s.player.weapons[2] = kn;
  s.player.activeSlot = 2; // slot 0's gun is inside the Pack-a-Punch
  const eq = capture('weapon:equipped');
  removeAllPerks(s, 'revive');
  assert.deepEqual(s.player.weapons, [null, sheiva]);
  assert.equal(s.player.activeSlot, 1);
  assert.equal(getActiveWeapon(s.player), sheiva);
  assert.deepEqual(eq, [{ weaponId: 'sheiva', slot: 1 }]);
  // No filled slot below the new count: slot 0, empty hands, no event.
  addPerk(s, 'mule');
  s.player.weapons = [null, null, kn];
  s.player.activeSlot = 2;
  eq.length = 0;
  removeAllPerks(s, 'revive');
  assert.deepEqual(s.player.weapons, [null, null]);
  assert.equal(s.player.activeSlot, 0);
  assert.deepEqual(eq, []);
});

// ---------------------------------------------------------------------------
// WO9 (Agent E): frost slow (player.slowT)
// ---------------------------------------------------------------------------

test('WO9 createPlayer has slowT 0; slowMult comes from BOSS.frost', () => {
  assert.equal(createPlayer(0, 0).slowT, 0);
  assert.equal(slowMult(), BOSS.frost.slowMult);
});

test('WO9 frost slow: move speed x slowMult while slowT > 0, counts down, then full speed', () => {
  const s = makeState();
  s.player.slowT = 1;
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 0.5);
  assert.ok(Math.abs(s.player.x - (100 + PLAYER.speed * BOSS.frost.slowMult * 0.5)) < 1e-6);
  assert.ok(Math.abs(s.player.slowT - 0.5) < 1e-9);
  const x1 = s.player.x;
  updatePlayer(s, { ...noInput, moveX: 1, sprint: true }, null, 0.5);
  assert.ok(Math.abs(s.player.x - (x1 + PLAYER.speed * PLAYER.sprintMult * BOSS.frost.slowMult * 0.5)) < 1e-6, 'sprint slowed too');
  assert.equal(s.player.slowT, 0);
  const x2 = s.player.x;
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 0.5);
  assert.ok(Math.abs(s.player.x - (x2 + PLAYER.speed * 0.5)) < 1e-6, 'full speed once the slow ends');
  // Standing still still counts the slow down.
  s.player.slowT = 0.3;
  updatePlayer(s, noInput, null, 0.5);
  assert.equal(s.player.slowT, 0);
});

test('WO9 frost slow stacks multiplicatively with Stamin-Up', () => {
  const s = makeState();
  addPerk(s, 'stamin');
  s.player.slowT = 2;
  updatePlayer(s, { ...noInput, moveX: 1 }, null, 1);
  const st = PERKS.list.stamin;
  assert.ok(Math.abs(s.player.x - (100 + PLAYER.speed * st.speedMult * BOSS.frost.slowMult)) < 1e-6);
});

test('WO9 frost slow resets on Quick Revive, game:restart and level change', () => {
  const s = makeState();
  initPlayer(s);
  addPerk(s, 'revive');
  s.player.slowT = 2;
  damagePlayer(s, 999);
  assert.ok(s.player.downT > 0);
  updatePlayer(s, noInput, null, s.player.downT + 0.01);
  assert.equal(s.player.slowT, 0, 'revive clears the slow');
  for (const ev of ['game:restart', 'level:descend', 'level:teleport']) {
    s.player.slowT = 2;
    events.emit(ev, {});
    assert.equal(s.player.slowT, 0, ev);
  }
});
