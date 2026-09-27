import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOMBIE, TILE, BOSS } from '../src/config.js';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as map from '../src/map.js';
import * as player from '../src/player.js';
import * as zombie from '../src/zombie.js';
import {
  healthForRound, tierForRound, spawnZombie, damageZombie, killZombie, updateZombies, HIT_FLASH,
  applyKnockback,
} from '../src/zombie.js';

const isStub = (fn) => String(fn).includes('not implemented');
const mapStub = isStub(map.tearBoard) || isStub(map.barricadeOpen) || isStub(map.resolveCircle);
const playerStub = isStub(player.damagePlayer);

function fakeState(seed = 1) {
  events.clearAll();
  const s = createEmptyState(seed);
  s.phase = 'playing';
  s.rounds = { round: 1 };
  return s;
}

function fakePlayer(x, y) {
  return { id: 999, x, y, radius: 14, health: 150, maxHealth: 150, regenTimer: 0, down: false,
    invulnerable: false, points: 0, weapons: [null, null], activeSlot: 0, tempWeapon: null };
}

function record(name) {
  const out = [];
  events.on(name, (p) => out.push(p));
  return out;
}

// Small fake map per 5.1: row 0 walls, row 1 pocket (S) at x=2, row 2 window (W) at x=2,
// rows 3..6 floor, surrounded by walls. Tile codes: 0 floor,1 wall,2 window,3 pocket.
function fakeMap(boards = 2) {
  const rows = [
    '#######',
    '##S####',
    '##W####',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ];
  const cols = rows[0].length, nrows = rows.length;
  const code = { '#': 1, '.': 0, 'W': 2, 'S': 3 };
  const tiles = new Uint8Array(cols * nrows);
  rows.forEach((r, y) => [...r].forEach((c, x) => { tiles[y * cols + x] = code[c]; }));
  return {
    cols, rows: nrows, width: cols * TILE, height: nrows * TILE, tiles, walls: [],
    barricades: [{ id: 1, tx: 2, ty: 2, x: 2 * TILE, y: 2 * TILE, w: TILE, h: TILE, boards, maxBoards: 6, spawnPointId: 1 }],
    spawnPoints: [{ id: 1, x: 2.5 * TILE, y: 1.5 * TILE, barricadeId: 1, kind: 'window' }],
    wallBuys: [], box: null, playerStart: { x: 3.5 * TILE, y: 4.5 * TILE },
  };
}

const openSpawn = { id: 7, x: 100, y: 100, barricadeId: null, kind: 'open' };

// --- pure stats -----------------------------------------------------------

test('healthForRound matches BO3 curve', () => {
  assert.equal(healthForRound(1), 150);
  assert.equal(healthForRound(2), 250);
  assert.equal(healthForRound(9), 950);
  assert.equal(healthForRound(10), 1045);
  assert.equal(healthForRound(20), Math.round(950 * Math.pow(1.1, 11)));
  assert.equal(healthForRound(0), 150);
});

test('tierForRound distribution by round bracket', () => {
  const s = fakeState(123);
  const count = (r, n = 4000) => {
    const c = { walk: 0, jog: 0, sprint: 0 };
    for (let i = 0; i < n; i++) c[tierForRound(r, s.rng)]++;
    for (const k in c) c[k] /= n;
    return c;
  };
  assert.deepEqual(count(1, 200), { walk: 1, jog: 0, sprint: 0 });
  assert.deepEqual(count(2, 200), { walk: 1, jog: 0, sprint: 0 });
  const r3 = count(3);
  assert.ok(Math.abs(r3.walk - 0.7) < 0.04 && r3.sprint === 0);
  const r6 = count(6);
  assert.ok(Math.abs(r6.walk - 0.3) < 0.04 && Math.abs(r6.jog - 0.5) < 0.04 && Math.abs(r6.sprint - 0.2) < 0.04);
  const r10 = count(10);
  assert.ok(Math.abs(r10.walk - 0.1) < 0.03 && Math.abs(r10.sprint - 0.5) < 0.04);
  const r15 = count(15);
  assert.equal(r15.walk, 0);
  assert.ok(Math.abs(r15.sprint - 0.75) < 0.04);
});

// --- spawning ---------------------------------------------------------------

test('spawnZombie at open spawn: chasing, round stats, event', () => {
  const s = fakeState();
  s.rounds.round = 5;
  const spawned = record('zombie:spawned');
  const z = spawnZombie(s, openSpawn);
  assert.equal(s.zombies.length, 1);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].zombie, z);
  assert.equal(z.mode, 'chasing');
  assert.equal(z.barricadeId, null);
  assert.equal(z.spawnPointId, 7);
  assert.equal(z.hp, 550);
  assert.equal(z.maxHp, 550);
  assert.equal(z.radius, ZOMBIE.radius);
  const base = ZOMBIE.speeds[z.tier];
  assert.ok(z.speed >= base * 0.9 - 1e-9 && z.speed <= base * 1.1 + 1e-9);
  for (const k of ['tearTimer', 'attackTimer', 'attackCd', 'dyingT', 'vx', 'vy', 'hitFlash']) {
    assert.equal(z[k], 0, k);
  }
});

test('spawnZombie at window spawn starts tearing in the pocket', () => {
  const s = fakeState();
  const sp = { id: 3, x: 250, y: 60, barricadeId: 4, kind: 'window' };
  const z = spawnZombie(s, sp);
  assert.equal(z.mode, 'tearing');
  assert.equal(z.barricadeId, 4);
  assert.equal(z.x, 250); assert.equal(z.y, 60);
});

test('spawn ids are unique', () => {
  const s = fakeState();
  const a = spawnZombie(s, openSpawn), b = spawnZombie(s, openSpawn);
  assert.notEqual(a.id, b.id);
});

// --- damage / kill ------------------------------------------------------------

test('damageZombie reduces hp, flashes, bleeds, emits hit', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  const hits = record('zombie:hit');
  const killed = damageZombie(s, z, 40, 'weapon', 105, 95);
  assert.equal(killed, false);
  assert.equal(z.hp, 110);
  assert.equal(z.hitFlash, HIT_FLASH);
  assert.equal(hits.length, 1);
  assert.deepEqual({ amount: hits[0].amount, x: hits[0].x, y: hits[0].y }, { amount: 40, x: 105, y: 95 });
  const blood = s.effects.filter((e) => e.type === 'blood');
  assert.equal(blood.length, 1);
  assert.ok(blood[0].ttl > 0 && blood[0].maxTtl === blood[0].ttl);
});

test('damageZombie kills at hp <= 0 and emits killed once', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  const kills = record('zombie:killed');
  assert.equal(damageZombie(s, z, 1000), true);
  assert.equal(z.mode, 'dying');
  assert.equal(z.dyingT, ZOMBIE.deathLinger);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].cause, 'weapon');
  assert.equal(kills[0].zombie, z);
  // Further hits and kills are ignored.
  assert.equal(damageZombie(s, z, 1000), false);
  assert.equal(killZombie(s, z, 'nuke'), false);
  assert.equal(kills.length, 1);
});

test('killZombie guard: double kill emits once, cause passed through', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  const kills = record('zombie:killed');
  assert.equal(killZombie(s, z, 'nuke'), true);
  assert.equal(killZombie(s, z, 'nuke'), false);
  assert.equal(killZombie(s, z), false);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].cause, 'nuke');
  assert.equal(kills[0].x, z.x);
  assert.equal(kills[0].y, z.y);
  assert.equal(s.player, null); // no points awarded by zombie.js (no player needed)
});

test('killZombie default cause is weapon', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  const kills = record('zombie:killed');
  killZombie(s, z);
  assert.equal(kills[0].cause, 'weapon');
});

test('insta-kill kills outright on any hit', () => {
  const s = fakeState();
  s.rounds.round = 30;
  s.time = 5;
  s.powerups.active.instaKill = 30;
  const z = spawnZombie(s, openSpawn);
  const kills = record('zombie:killed');
  assert.equal(damageZombie(s, z, 1), true);
  assert.equal(kills.length, 1);
});

test('expired insta-kill does not apply', () => {
  const s = fakeState();
  s.time = 40;
  s.powerups.active.instaKill = 30;
  const z = spawnZombie(s, openSpawn);
  assert.equal(damageZombie(s, z, 1), false);
  assert.equal(z.hp, 149);
});

// --- update (paths that do not touch other modules) --------------------------

test('dying zombies linger then are removed; hitFlash decays', () => {
  const s = fakeState();
  const a = spawnZombie(s, openSpawn);
  const b = spawnZombie(s, openSpawn);
  killZombie(s, a); killZombie(s, b);
  a.hitFlash = 0.08;
  updateZombies(s, 0.05);
  assert.equal(s.zombies.length, 2);
  assert.ok(Math.abs(a.hitFlash - 0.03) < 1e-9);
  updateZombies(s, ZOMBIE.deathLinger);
  assert.equal(s.zombies.length, 0);
});

test('chasing without flow/map walks straight at the player and enters attacking', () => {
  const s = fakeState();
  s.player = fakePlayer(400, 100);
  const z = spawnZombie(s, openSpawn);
  const x0 = z.x;
  updateZombies(s, 0.1);
  assert.equal(z.mode, 'chasing');
  assert.ok(z.x > x0);
  assert.ok(Math.abs(z.y - 100) < 1e-9);
  z.x = s.player.x - 30;
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'attacking');
  assert.equal(z.attackTimer, ZOMBIE.attackWindup);
});

test('never attacks a downed player', () => {
  const s = fakeState();
  s.player = fakePlayer(130, 100);
  s.player.down = true;
  const z = spawnZombie(s, openSpawn);
  updateZombies(s, 0.016);
  assert.notEqual(z.mode, 'attacking');
  z.mode = 'attacking'; z.attackTimer = 0.1;
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'chasing');
});

test('attacking with player out of range returns to chasing', () => {
  const s = fakeState();
  s.player = fakePlayer(1000, 100);
  const z = spawnZombie(s, openSpawn);
  z.mode = 'attacking'; z.attackTimer = 0;
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'chasing');
});

test('zombie blood makes chasers wander and they resume after expiry', () => {
  const s = fakeState();
  s.player = fakePlayer(130, 100);
  const z = spawnZombie(s, openSpawn);
  const t = spawnZombie(s, { id: 2, x: 500, y: 500, barricadeId: 9, kind: 'window' });
  s.time = 1; s.powerups.active.zombieBlood = 31;
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'wandering');
  assert.equal(t.mode, 'chasing'); // no map: tearing resolves immediately, then chases
  updateZombies(s, 0.016);
  assert.equal(t.mode, 'wandering');
  assert.ok(z.wanderT > 0);
  s.time = 40;
  updateZombies(s, 0.016);
  assert.notEqual(z.mode, 'wandering');
});

test('separation pushes stacked zombies apart', () => {
  const s = fakeState();
  s.player = fakePlayer(2000, 2000);
  s.player.down = true;
  const a = spawnZombie(s, openSpawn);
  const b = spawnZombie(s, openSpawn);
  a.speed = 0; b.speed = 0;
  updateZombies(s, 0.1);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1);
});

// --- paths that call other modules (skipped while they are stubs) -------------

test('attack wind-up then damages player', { skip: playerStub }, () => {
  const s = fakeState();
  s.player = fakePlayer(130, 100);
  const dmg = record('player:damaged');
  const z = spawnZombie(s, openSpawn);
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'attacking');
  updateZombies(s, ZOMBIE.attackWindup + 0.01);
  assert.equal(s.player.health, 150 - ZOMBIE.damage);
  assert.equal(dmg.length, 1);
  assert.ok(z.attackCd > 0);
});

test('window zombie tears boards then chases through the window', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(2);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  const boards = record('barricade:board');
  const z = spawnZombie(s, s.map.spawnPoints[0]);
  assert.equal(z.mode, 'tearing');
  updateZombies(s, ZOMBIE.boardTearTime + 0.01);
  assert.equal(s.map.barricades[0].boards, 1);
  assert.equal(z.mode, 'tearing');
  updateZombies(s, ZOMBIE.boardTearTime);
  assert.equal(s.map.barricades[0].boards, 0);
  assert.equal(z.mode, 'chasing');
  assert.equal(boards.length, 2);
  // No flow field: zombie heads straight down through the open window.
  for (let i = 0; i < 120 && z.mode === 'chasing'; i++) updateZombies(s, 1 / 60);
  assert.ok(z.y > 3 * TILE, `zombie should be inside, y=${z.y}`);
  assert.equal(z.inside, true);
});

test('window zombie at an already-open barricade chases immediately', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(0);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  const z = spawnZombie(s, s.map.spawnPoints[0]);
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'chasing');
});

// --- Phase 4 fixes ------------------------------------------------------------

function roomMap(w = 20, h = 20) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : '.';
    rows.push(r);
  }
  const tiles = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { tiles[y * w + x] = c === '#' ? 1 : 0; }));
  return { cols: w, rows: h, width: w * TILE, height: h * TILE, tiles, walls: [], barricades: [],
    spawnPoints: [], wallBuys: [], box: null, playerStart: { x: w * TILE / 2, y: h * TILE / 2 } };
}

function minPairDist(zs) {
  let m = Infinity;
  for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) {
    m = Math.min(m, Math.hypot(zs[i].x - zs[j].x, zs[i].y - zs[j].y));
  }
  return m;
}

test('regression: zombie that re-enters a pocket after the window is rebuilt goes back to tearing', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(0);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  s.player.invulnerable = true;
  // An "inside" zombie from an open spawn (barricadeId null) that wandered back into the pocket.
  const z = spawnZombie(s, openSpawn);
  z.x = 2.5 * TILE; z.y = 1.5 * TILE; z.inside = true; z.mode = 'chasing';
  s.map.barricades[0].boards = 6; // player / carpenter rebuilt the window
  updateZombies(s, 1 / 60);
  assert.equal(z.mode, 'tearing');
  assert.equal(z.barricadeId, 1);
  assert.equal(z.inside, false);
  for (let i = 0; i < 60 * 12 && !(z.inside && s.map.barricades[0].boards === 0); i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 0);
  assert.equal(z.inside, true, `zombie got back into the play area (y=${z.y})`);
});

test('regression: wandering (Zombie Blood) zombie in a rebuilt pocket tears instead of sticking', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(0);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  s.time = 1; s.powerups.active.zombieBlood = 100;
  const z = spawnZombie(s, openSpawn);
  z.x = 2.5 * TILE; z.y = 1.5 * TILE; z.inside = true; z.mode = 'wandering';
  s.map.barricades[0].boards = 3;
  updateZombies(s, 1 / 60);
  assert.equal(z.mode, 'tearing');
  for (let i = 0; i < 60 * 5; i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 0);
  assert.notEqual(z.mode, 'tearing');
});

test('wandering zombies in the play area never step into a window or pocket', { skip: mapStub }, () => {
  const s = fakeState(5);
  s.map = fakeMap(0);
  s.player = fakePlayer(5.5 * TILE, 5.5 * TILE);
  s.time = 1; s.powerups.active.zombieBlood = 1000;
  const zs = [];
  for (let i = 0; i < 6; i++) {
    const z = spawnZombie(s, { id: 9, x: (1.5 + i % 5) * TILE, y: 3.5 * TILE, barricadeId: null, kind: 'open' });
    zs.push(z);
  }
  for (let f = 0; f < 60 * 60; f++) {
    updateZombies(s, 1 / 60);
    for (const z of zs) assert.ok(z.y > 3 * TILE, `zombie ${z.id} left the room (y=${z.y.toFixed(1)})`);
  }
});

test('only one zombie tears a window at a time; the next takes over when it dies', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(6);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  const boards = record('barricade:board');
  const a = spawnZombie(s, s.map.spawnPoints[0]);
  const b = spawnZombie(s, s.map.spawnPoints[0]);
  const c = spawnZombie(s, s.map.spawnPoints[0]);
  for (let i = 0; i < Math.round(2.5 * 60); i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 4, 'one board per boardTearTime, not one per zombie');
  assert.equal(boards.length, 2);
  assert.equal([a, b, c].filter((z) => z.tearOwner).length, 1);
  const owner = [a, b, c].find((z) => z.tearOwner);
  killZombie(s, owner);
  for (let i = 0; i < Math.round(1.5 * 60); i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 3, 'a queued zombie took over');
  const alive = [a, b, c].filter((z) => z !== owner);
  assert.equal(alive.filter((z) => z.tearOwner).length, 1);
  for (let i = 0; i < 4 * 60; i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 0);
  for (const z of alive) assert.notEqual(z.mode, 'tearing');
});

for (const dt of [1 / 60, 1 / 30]) {
  test(`zombies converging on a stationary player form a ring, not a blob (dt=${dt.toFixed(3)})`, { skip: mapStub || playerStub }, () => {
    const s = fakeState(3);
    s.map = roomMap(24, 24);
    const cx = 12 * TILE, cy = 12 * TILE;
    s.player = fakePlayer(cx, cy);
    s.player.invulnerable = true;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const z = spawnZombie(s, { id: 9, x: cx + Math.cos(a) * 300, y: cy + Math.sin(a) * 300, barricadeId: null, kind: 'open' });
      z.speed = ZOMBIE.speeds.sprint * 1.1;
    }
    // A few extra spawned exactly stacked.
    for (let i = 0; i < 4; i++) spawnZombie(s, { id: 10, x: cx + 250, y: cy, barricadeId: null, kind: 'open' }).speed = 150;
    let worst = Infinity;
    for (let t = 0; t < 8; t += dt) {
      updateZombies(s, dt);
      if (t > 4) worst = Math.min(worst, minPairDist(s.zombies));
    }
    assert.ok(worst >= 1.5 * ZOMBIE.radius, `closest pair ${worst.toFixed(1)} px`);
    const attackers = s.zombies.filter((z) => z.mode === 'attacking').length;
    assert.ok(attackers >= 4, `some zombies reach the player (${attackers})`);
    assert.ok(attackers < s.zombies.length, 'the crowd cannot all reach the player at once');
    for (const z of s.zombies) {
      assert.ok(Math.hypot(z.x - cx, z.y - cy) >= z.radius + s.player.radius - 0.5, 'no zombie inside the player');
    }
  });
}

test('heavily stacked spawns stay inside walkable tiles and the map (real map)', { skip: mapStub }, async () => {
  const s = fakeState(7);
  s.map = map.loadMap();
  s.player = fakePlayer(s.map.playerStart.x, s.map.playerStart.y);
  s.player.invulnerable = true;
  for (const sp of s.map.spawnPoints) for (let i = 0; i < 12; i++) spawnZombie(s, sp);
  for (let f = 0; f < 90; f++) {
    updateZombies(s, 1 / 30);
    for (const z of s.zombies) {
      assert.ok(z.x >= 0 && z.y >= 0 && z.x <= s.map.width && z.y <= s.map.height, `in bounds ${z.x},${z.y}`);
      const tx = Math.floor(z.x / TILE), ty = Math.floor(z.y / TILE);
      const code = s.map.tiles[ty * s.map.cols + tx];
      assert.ok(code === 0 || code === 2 || code === 3 || code === 6, `zombie ${z.id} centre on tile code ${code}`);
    }
  }
});

// --- WO2 3.10: knockback / stun ----------------------------------------------

test('knockback moves the zombie and the slide decays to a stop', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = roomMap(40, 10);
  s.player = fakePlayer(2 * TILE, 5 * TILE);
  s.player.invulnerable = true;
  const z = spawnZombie(s, { id: 9, x: 5 * TILE, y: 5 * TILE, barricadeId: null, kind: 'open' });
  assert.equal(applyKnockback(s, z, 720, 0, 1.2), true);
  assert.equal(z.stun, 1.2);
  assert.equal(z.knockAngle, 0);
  const x0 = z.x;
  updateZombies(s, 1 / 60);
  assert.ok(z.x > x0 + 5, 'moved away along the knock');
  assert.ok(z.kvx > 0 && z.kvx < 720, 'velocity decays');
  let prev = z.kvx;
  for (let i = 0; i < 30; i++) { updateZombies(s, 1 / 60); assert.ok(z.kvx <= prev); prev = z.kvx; }
  for (let i = 0; i < 60 && z.kvx !== 0; i++) updateZombies(s, 1 / 60);
  assert.equal(z.kvx, 0, 'zeroed under stunMinSpeed');
  // Slide distance is roughly v0 / friction (exponential decay integral).
  assert.ok(z.x - x0 > 0.8 * 720 / ZOMBIE.knockFriction && z.x - x0 < 1.05 * 720 / ZOMBIE.knockFriction, `slid ${z.x - x0}`);
});

test('stun blocks attacks; stun expiry resumes chasing', () => {
  const s = fakeState();
  s.player = fakePlayer(130, 100);
  const dmg = record('player:damaged');
  const z = spawnZombie(s, openSpawn);
  updateZombies(s, 0.016);
  assert.equal(z.mode, 'attacking');
  applyKnockback(s, z, 0, 0, 1.0); // stun in place, still in range
  assert.equal(z.attackTimer, 0);
  for (let i = 0; i < 50; i++) updateZombies(s, 0.016);
  assert.equal(dmg.length, 0, 'no attack while stunned');
  assert.equal(z.attackTimer, 0);
  assert.ok(z.stun > 0);
  for (let i = 0; i < 20 && z.stun > 0; i++) updateZombies(s, 0.016);
  assert.equal(z.stun, 0);
  assert.equal(z.mode, 'chasing', 'attacking resumes as chasing when the stun ends');
  // Resumed chasing: the next update picks the player back up.
  z.x = 400; z.y = 100; z.attackCd = 0;
  const x0 = z.x;
  updateZombies(s, 0.05);
  assert.equal(z.mode, 'chasing');
  assert.ok(z.x < x0, 'chases again');
});

test('stun expiry after a knock resumes chasing the player', () => {
  const s = fakeState();
  s.player = fakePlayer(600, 100);
  const z = spawnZombie(s, openSpawn);
  applyKnockback(s, z, -300, 0, 0.3);
  updateZombies(s, 0.1);
  assert.ok(z.x < 100 && z.stun > 0);
  for (let i = 0; i < 5; i++) updateZombies(s, 0.1);
  assert.equal(z.stun, 0);
  assert.equal(z.mode, 'chasing');
  const x1 = z.x;
  updateZombies(s, 0.1);
  assert.ok(z.x > x1, 'walking back toward the player');
});

test('a wall stops the slide', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = roomMap(10, 10);
  s.player = fakePlayer(2 * TILE, 5 * TILE);
  s.player.invulnerable = true;
  const z = spawnZombie(s, { id: 9, x: 7.5 * TILE, y: 5.5 * TILE, barricadeId: null, kind: 'open' });
  applyKnockback(s, z, 2000, 0, 1.0);
  const wallX = 9 * TILE;
  for (let i = 0; i < 10; i++) {
    updateZombies(s, 1 / 60);
    assert.ok(z.x <= wallX - z.radius + 0.5, `inside the wall x=${z.x}`);
  }
  assert.equal(z.kvx, 0, 'velocity into the wall is dropped');
  assert.ok(Math.abs(z.y - 5.5 * TILE) < 1, 'no sideways drift');
});

test('tearing zombies ignore knockback', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(6);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  const z = spawnZombie(s, s.map.spawnPoints[0]);
  updateZombies(s, 1 / 60);
  assert.equal(z.mode, 'tearing');
  const x0 = z.x, y0 = z.y;
  assert.equal(applyKnockback(s, z, 0, -900, 2), false);
  assert.equal(z.stun, 0);
  updateZombies(s, 1 / 60);
  assert.equal(z.mode, 'tearing');
  assert.ok(Math.hypot(z.x - x0, z.y - y0) < 1);
});

test('dying zombies ignore knockback; knocked zombies can still be killed', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  applyKnockback(s, z, 500, 0, 1);
  assert.equal(damageZombie(s, z, 1e9), true);
  assert.equal(z.stun, 0);
  assert.equal(applyKnockback(s, z, 500, 0, 1), false);
  const x = z.x;
  updateZombies(s, 0.1);
  assert.equal(z.x, x);
});

test('Infinity damage kills cleanly and emits zombie:killed once', () => {
  const s = fakeState();
  s.rounds.round = 25;
  const z = spawnZombie(s, openSpawn);
  const kills = record('zombie:killed');
  const hits = record('zombie:hit');
  assert.equal(damageZombie(s, z, Infinity, 'weapon', z.x, z.y), true);
  assert.equal(damageZombie(s, z, Infinity, 'weapon', z.x, z.y), false);
  assert.equal(kills.length, 1);
  assert.equal(z.mode, 'dying');
  assert.ok(Number.isFinite(z.hp) && z.hp <= 0, `hp ${z.hp}`);
  assert.ok(Number.isFinite(hits[0].amount), 'reported amount is finite');
  assert.equal(hits[0].amount, z.maxHp);
  // Insta-kill combined with Infinity is also clean.
  s.time = 1; s.powerups.active.instaKill = 30;
  const y = spawnZombie(s, openSpawn);
  assert.equal(damageZombie(s, y, Infinity), true);
  assert.ok(!Number.isNaN(y.hp));
  assert.equal(kills.length, 2);
});

test('zombie knocked through an open window into its pocket comes back in', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(0);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  s.player.invulnerable = true;
  const z = spawnZombie(s, openSpawn);
  z.x = 2.5 * TILE; z.y = 3.5 * TILE;
  applyKnockback(s, z, 0, -700, 0.8);
  for (let i = 0; i < 30; i++) {
    updateZombies(s, 1 / 60);
    assert.notEqual(z.mode, 'tearing', 'no tearing while stunned');
  }
  assert.ok(z.y < 3 * TILE, `knocked out through the window (y=${z.y.toFixed(1)})`);
  for (let i = 0; i < 60 * 4 && !z.inside; i++) updateZombies(s, 1 / 60);
  assert.equal(z.inside, true, 'walked back in');
});

test('zombie knocked into its pocket then boarded up tears back out after the stun', { skip: mapStub }, () => {
  const s = fakeState();
  s.map = fakeMap(0);
  s.player = fakePlayer(2.5 * TILE, 5.5 * TILE);
  s.player.invulnerable = true;
  const z = spawnZombie(s, openSpawn);
  z.x = 2.5 * TILE; z.y = 1.5 * TILE; z.inside = false;
  applyKnockback(s, z, 0, 0, 0.5);
  s.map.barricades[0].boards = 2;
  updateZombies(s, 1 / 60);
  assert.notEqual(z.mode, 'tearing');
  for (let i = 0; i < 40; i++) updateZombies(s, 1 / 60);
  assert.equal(z.mode, 'tearing');
  for (let i = 0; i < 60 * 6 && !z.inside; i++) updateZombies(s, 1 / 60);
  assert.equal(s.map.barricades[0].boards, 0);
  assert.equal(z.inside, true);
});

// Review #7: a knock without a positive, finite stun is rejected and leaves no stale velocity.
test('applyKnockback rejects stun <= 0 or non-finite without setting velocity', () => {
  const s = fakeState();
  const z = spawnZombie(s, openSpawn);
  for (const bad of [0, -1, NaN, Infinity, undefined, 'x']) {
    assert.equal(applyKnockback(s, z, 500, 0, bad), false, `stun ${String(bad)}`);
    assert.ok(!z.kvx && !z.kvy, 'no knock velocity');
    assert.ok(!(z.stun > 0), 'no stun');
  }
  assert.equal(applyKnockback(s, z, 500, 0, 0.5), true);
  assert.equal(z.kvx, 500);
  assert.equal(z.stun, 0.5);
});

// --- WO5 3.2: zombie kinds, difficulty, boss AI ------------------------------------------

const L2 = { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 };

test('WO5 healthForRound applies difficulty.healthMult; default is level 1', () => {
  assert.equal(healthForRound(1, L2), 225);
  assert.equal(healthForRound(5, { healthMult: 2 }), 1100);
  assert.equal(healthForRound(5, null), healthForRound(5));
});

test('WO5 spawnZombie: normal kind uses state.level.difficulty (health, speed, sprintShift)', () => {
  const s = fakeState(3);
  s.level = { index: 1, difficulty: L2 };
  const tiers = new Set();
  for (let i = 0; i < 200; i++) {
    const z = spawnZombie(s, openSpawn);
    assert.equal(z.kind, 'normal');
    assert.equal(z.hp, 225);
    const base = ZOMBIE.speeds[z.tier] * 1.1;
    assert.ok(z.speed <= base * 1.1 + 1e-9 && z.speed >= base * 0.9 - 1e-9);
    tiers.add(z.tier);
  }
  assert.ok(tiers.has('jog'), 'round 1 + sprintShift 3 rolls joggers');
  const s1 = fakeState(3);
  for (let i = 0; i < 50; i++) assert.equal(spawnZombie(s1, openSpawn).tier, 'walk');
});

test('WO5 spawnZombie: minion and boss stats, kind in zombie:spawned payload', () => {
  const s = fakeState(4);
  s.rounds.round = 5;
  const spawned = record('zombie:spawned');
  const m = spawnZombie(s, { id: 'x1', x: 100, y: 100, barricadeId: 3 }, { kind: 'minion' });
  assert.equal(m.kind, 'minion');
  assert.equal(m.radius, BOSS.minion.radius);
  assert.equal(m.hp, BOSS.minion.health, 'FIX-2: minion HP = 300 x healthMult, no round scaling');
  assert.equal(m.damage, BOSS.minion.damage);
  assert.equal(m.attackCooldown, BOSS.minion.attackCooldown);
  assert.equal(m.mode, 'chasing');
  assert.equal(m.barricadeId, null, 'minions are never tied to a window');
  const base = ZOMBIE.speeds.sprint * BOSS.minion.speedMult;
  assert.ok(m.speed >= base * 0.9 - 1e-9 && m.speed <= base * 1.1 + 1e-9);
  const b = spawnZombie(s, { id: 'boss', x: 200, y: 200 }, { kind: 'boss', name: 'THE BONE PRIEST' });
  assert.equal(b.kind, 'boss');
  assert.equal(b.radius, BOSS.radius);
  assert.equal(b.maxHp, Math.round(BOSS.baseHealth * (1 + BOSS.roundScale * 5)));
  assert.equal(BOSS.baseHealth, 4500);
  assert.equal(b.speed, BOSS.speed);
  assert.equal(b.name, 'THE BONE PRIEST');
  assert.deepEqual(b.charge, { timer: BOSS.chargeEvery, phase: 'idle', dx: 0, dy: 0, t: 0 });
  assert.equal(b.summonTimer, BOSS.summonEvery);
  assert.deepEqual(spawned.map((p) => p.kind), ['minion', 'boss']);
  assert.equal(spawnZombie(s, openSpawn).kind, 'normal');
});

test('WO5 FIX-2 insta-kill doubles damage to the boss (not a kill, no floor); minions still die', () => {
  const s = fakeState(5);
  s.time = 10;
  s.powerups.active.instaKill = 100;
  const b = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  const killed = record('zombie:killed');
  assert.equal(damageZombie(s, b, 10), false);
  assert.equal(b.hp, b.maxHp - 10 * BOSS.instaKillMult, 'x2, not a 5 % floor');
  const hp0 = b.hp;
  damageZombie(s, b, 1e6); // doubled, then capped at maxHitFrac
  assert.ok(Math.abs(hp0 - b.hp - BOSS.maxHitFrac * b.maxHp) < 1e-6);
  // 20 Death-Machine-sized hits no longer kill it (review M1: was dead in 20 hits).
  for (let i = 0; i < 20; i++) damageZombie(s, b, 150);
  assert.ok(b.hp > 0 && killed.length === 0);
  b.hp = 1;
  damageZombie(s, b, 10);
  assert.ok(b.hp <= 0 && killed.length === 1 && killed[0].kind === 'boss');
  assert.equal(b.dyingT, BOSS.deathLinger);
  const m = spawnZombie(s, { x: 150, y: 100 }, { kind: 'minion' });
  assert.equal(damageZombie(s, m, 1), true);
});

test('WO5 boss ignores stun: knockback is displacement only', { skip: mapStub }, () => {
  const s = fakeState(6);
  s.map = roomMap(16, 12);
  const b = spawnZombie(s, { x: 8 * TILE, y: 6 * TILE }, { kind: 'boss' });
  const x0 = b.x;
  assert.equal(applyKnockback(s, b, 720, 0, 1.2), true);
  assert.equal(b.stun, 0);
  assert.equal(b.kvx, 0);
  assert.ok(Math.abs(b.x - x0 - BOSS.thunderNearKnock) < 1e-6, `moved ${b.x - x0}`);
  const x1 = b.x;
  zombie.pushZombie(s, b, 40, 0);
  assert.ok(Math.abs(b.x - x1 - 40) < 1e-6);
  zombie.pushZombie(s, b, 10000, 0); // wall stops the push
  assert.ok(b.x <= s.map.width - TILE - b.radius + 1e-6);
  assert.equal(zombie.isBoss(b), true);
});

test('WO5 boss charge: telegraph (still, boss:charge) -> dash -> wall stop -> recover -> idle', { skip: mapStub }, () => {
  const s = fakeState(7);
  s.map = roomMap(16, 12);
  s.player = fakePlayer(14 * TILE, 6 * TILE);
  const charges = record('boss:charge');
  const b = spawnZombie(s, { x: 8 * TILE, y: 6 * TILE }, { kind: 'boss' });
  b.charge.timer = 0.001;
  const dt = 1 / 60;
  updateZombies(s, dt);
  assert.equal(b.charge.phase, 'telegraph');
  assert.equal(charges.length, 1);
  assert.deepEqual(charges[0], { x: 8 * TILE, y: 6 * TILE });
  const x0 = b.x;
  let t = 0;
  while (b.charge.phase === 'telegraph' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.chargeTelegraph) < 2 * dt, `telegraph ${t}`);
  assert.equal(b.x, x0, 'boss stands still during the telegraph');
  assert.equal(b.charge.phase, 'dash');
  assert.ok(b.charge.dx > 0.99);
  // Player sidesteps: the boss runs into the east wall.
  s.player.x = 2 * TILE; s.player.y = 2 * TILE;
  t = 0;
  while (b.charge.phase === 'dash' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.equal(b.charge.phase, 'recover');
  assert.equal(b.charge.wall, true, 'stopped by the wall');
  assert.ok(t < BOSS.chargeMaxTime, `dash ${t}`);
  assert.ok(b.x > (s.map.cols - 1) * TILE - b.radius - 3, `x=${b.x}`);
  assert.ok(s.effects.some((e) => e.type === 'shake'));
  const xr = b.x;
  t = 0;
  while (b.charge.phase === 'recover' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.chargeRecover) < 2 * dt);
  assert.ok(Math.abs(b.x - xr) < 1e-6, 'stays put while recovering');
  assert.equal(b.charge.phase, 'idle');
  assert.ok(b.charge.timer > BOSS.chargeEvery - 0.1);
  assert.equal(charges.length, 1);
});

test('WO5 boss charge hits the player: damage and 40 px knockback along the dash', { skip: mapStub || playerStub }, () => {
  const s = fakeState(8);
  s.map = roomMap(24, 12);
  s.player = fakePlayer(12 * TILE, 6 * TILE);
  const b = spawnZombie(s, { x: 5 * TILE, y: 6 * TILE }, { kind: 'boss' });
  b.charge.timer = 0.001;
  const dt = 1 / 60;
  let t = 0;
  let px = s.player.x;
  while (b.charge.phase !== 'recover' && t < 3) {
    px = s.player.x;
    updateZombies(s, dt); t += dt;
  }
  assert.equal(b.charge.phase, 'recover');
  assert.equal(b.charge.wall, false);
  assert.equal(s.player.health, 150 - BOSS.damage);
  assert.ok(Math.abs(s.player.x - px - BOSS.chargeKnockback) < 1e-6, `knock ${s.player.x - px}`);
  assert.equal(s.player.y, 6 * TILE);
});

test('WO5 boss charge ends after chargeMaxTime in the open', { skip: mapStub }, () => {
  const s = fakeState(9);
  s.map = roomMap(60, 12);
  s.player = fakePlayer(55 * TILE, 6 * TILE);
  const b = spawnZombie(s, { x: 3 * TILE, y: 6 * TILE }, { kind: 'boss' });
  b.charge.timer = 0.001;
  const dt = 1 / 60;
  let t = 0;
  while (b.charge.phase !== 'dash' && t < 2) { updateZombies(s, dt); t += dt; }
  s.player.y = 2 * TILE; // out of the line
  const x0 = b.x;
  t = 0;
  while (b.charge.phase === 'dash' && t < 3) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.chargeMaxTime) < 2 * dt, `dash ${t}`);
  assert.ok(Math.abs(b.x - x0 - BOSS.speed * BOSS.chargeSpeedMult * t) < 10);
  assert.equal(b.charge.wall, false);
});

test('WO5 boss keeps hunting under Zombie Blood; minions wander', { skip: mapStub }, () => {
  const s = fakeState(10);
  s.map = roomMap(16, 12);
  s.time = 1;
  s.powerups.active.zombieBlood = 100;
  s.player = fakePlayer(12 * TILE, 6 * TILE);
  const b = spawnZombie(s, { x: 3 * TILE, y: 6 * TILE }, { kind: 'boss' });
  const m = spawnZombie(s, { x: 3 * TILE, y: 3 * TILE }, { kind: 'minion' });
  const x0 = b.x;
  for (let i = 0; i < 30; i++) updateZombies(s, 1 / 60);
  assert.equal(b.mode, 'chasing');
  assert.ok(b.x > x0 + 20);
  assert.equal(m.mode, 'wandering');
});

test('WO5 minions never tear boards, even standing in a boarded pocket', { skip: mapStub }, () => {
  const s = fakeState(11);
  s.map = fakeMap(4);
  s.player = fakePlayer(3.5 * TILE, 5.5 * TILE);
  const m = spawnZombie(s, { x: 2.5 * TILE, y: 1.5 * TILE, barricadeId: 1 }, { kind: 'minion' });
  assert.equal(m.mode, 'chasing');
  for (let i = 0; i < 180; i++) {
    updateZombies(s, 1 / 60);
    assert.notEqual(m.mode, 'tearing');
  }
  assert.equal(s.map.barricades[0].boards, 4);
});

test('WO5 boss melee uses boss damage, wind-up and reach', { skip: mapStub || playerStub }, () => {
  const s = fakeState(12);
  s.map = roomMap(16, 12);
  const b = spawnZombie(s, { x: 6 * TILE, y: 6 * TILE }, { kind: 'boss' });
  s.player = fakePlayer(6 * TILE + BOSS.radius + 14 + 20, 6 * TILE); // in boss reach, beyond a normal one
  const dt = 1 / 60;
  updateZombies(s, dt);
  assert.equal(b.mode, 'attacking');
  let t = dt;
  while (s.player.health === 150 && t < 2) { updateZombies(s, dt); t += dt; }
  assert.equal(s.player.health, 150 - BOSS.damage);
  assert.ok(Math.abs(t - BOSS.attackWindup) < 3 * dt, `windup ${t}`);
  assert.ok(Math.abs(b.attackCd - BOSS.attackCooldown) < 2 * dt);
});

// ---------------------------------------------------------------------------
// WO5 FIX-2 balance rules (docs/qa/wo5-balance.md #3, #4, #5, #7, #8, #9)
// ---------------------------------------------------------------------------

test('FIX-2 boss per-hit cap: any single hit <= maxHitFrac x maxHp; nuke / Thundergun share exempt', () => {
  const s = fakeState(11);
  s.rounds.round = 10;
  const b = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  const max = b.maxHp;
  const cap = BOSS.maxHitFrac * max;
  const hits = record('zombie:hit');
  damageZombie(s, b, 70); // KN-44 hit: below the cap, untouched
  assert.equal(b.hp, max - 70);
  let hp = b.hp;
  damageZombie(s, b, 1000); // Ray Gun direct hit: capped
  assert.ok(Math.abs(hp - b.hp - cap) < 1e-6);
  assert.ok(Math.abs(hits[1].amount - cap) < 1e-6, 'zombie:hit reports the capped amount');
  hp = b.hp;
  damageZombie(s, b, BOSS.thunderNearFrac * max); // Thundergun near share: its own fraction
  assert.ok(Math.abs(hp - b.hp - BOSS.thunderNearFrac * max) < 1e-6);
  hp = b.hp;
  damageZombie(s, b, Infinity); // non-finite near-cone kill -> thunderNearFrac
  assert.ok(Math.abs(hp - b.hp - BOSS.thunderNearFrac * max) < 1e-6);
  hp = b.hp;
  damageZombie(s, b, BOSS.nukeFrac * max, 'nuke'); // nuke: its own fraction
  assert.ok(Math.abs(hp - b.hp - BOSS.nukeFrac * max) < 1e-6);
  assert.equal(BOSS.thunderNearFrac, 0.08);
  assert.equal(BOSS.maxHitFrac, 0.03);
});

test('FIX-2 fractional effects get no Insta-Kill bonus; capped hits stay capped under Insta-Kill', () => {
  const s = fakeState(12);
  s.time = 5;
  s.powerups.active.instaKill = 100;
  const b = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  const max = b.maxHp;
  damageZombie(s, b, BOSS.thunderNearFrac * max);
  assert.ok(Math.abs(max - b.hp - BOSS.thunderNearFrac * max) < 1e-6);
  const hp = b.hp;
  damageZombie(s, b, 0.02 * max); // x2 = 4 % -> capped at 3 %
  assert.ok(Math.abs(hp - b.hp - BOSS.maxHitFrac * max) < 1e-6);
  assert.equal(zombie.bossHitDamage(50, 10000, 'weapon', true), 100);
  assert.equal(zombie.bossHitDamage(50, 10000, 'weapon', false), 50);
  assert.equal(zombie.bossHitDamage(1000, 10000, 'nuke', true), 1000);
});

test('FIX-2 boss HP: 4500 x healthMult x (1 + 0.12 x min(round, 12))', () => {
  const { bossHealthFor } = zombie;
  assert.equal(bossHealthFor(10), Math.round(4500 * (1 + 0.12 * 10)));
  assert.equal(bossHealthFor(12), Math.round(4500 * (1 + 0.12 * 12)));
  assert.equal(bossHealthFor(20), bossHealthFor(12), 'round factor capped at roundScaleCap');
  assert.equal(bossHealthFor(20, { healthMult: 1.5 }), Math.round(4500 * 1.5 * (1 + 0.12 * 12)));
  assert.equal(BOSS.roundScaleCap, 12);
});

test('FIX-2 minion HP = BOSS.minion.health x level healthMult, independent of round', () => {
  const s = fakeState(13);
  s.rounds.round = 3;
  assert.equal(spawnZombie(s, openSpawn, { kind: 'minion' }).hp, 300);
  s.rounds.round = 20;
  assert.equal(spawnZombie(s, openSpawn, { kind: 'minion' }).hp, 300);
  s.level = { index: 1, difficulty: { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 } };
  assert.equal(spawnZombie(s, openSpawn, { kind: 'minion' }).hp, 450);
  assert.equal(zombie.minionHealthFor(99, { healthMult: 2.16 }), 648);
});

test('FIX-2 speed cap: normal zombies <= ZOMBIE.maxSpeed (214), minions <= 1.1 x that, boss uncapped', () => {
  const s = fakeState(14);
  s.rounds.round = 30;
  s.level = { index: 3, difficulty: { healthMult: 2.16, speedMult: 1.15, countMult: 1.5, sprintShift: 7 } };
  assert.equal(ZOMBIE.maxSpeed, 214);
  let capped = 0;
  for (let i = 0; i < 300; i++) {
    const z = spawnZombie(s, openSpawn);
    assert.ok(z.speed <= ZOMBIE.maxSpeed + 1e-9, `normal ${z.speed}`);
    if (z.speed === ZOMBIE.maxSpeed) capped++;
  }
  assert.ok(capped > 0, 'fast sprinters actually hit the cap');
  const minionCap = ZOMBIE.maxSpeed * BOSS.minion.maxSpeedMult;
  for (let i = 0; i < 100; i++) {
    const m = spawnZombie(s, openSpawn, { kind: 'minion' });
    assert.ok(m.speed <= minionCap + 1e-9, `minion ${m.speed}`);
  }
  // Level 1 walkers / joggers are untouched.
  const s1 = fakeState(15);
  for (let i = 0; i < 50; i++) assert.ok(spawnZombie(s1, openSpawn).speed < ZOMBIE.maxSpeed);
  const b = spawnZombie(s, openSpawn, { kind: 'boss' });
  assert.ok(Math.abs(b.speed - BOSS.speed * 1.15) < 1e-9);
});

// ---------------------------------------------------------------------------
// WO7 (Agent H): boss ability switch, acid spit, downed-player rule
// ---------------------------------------------------------------------------

function acidState(seed = 21) {
  const s = fakeState(seed);
  s.map = roomMap(24, 16);
  s.level = { index: 2, def: { boss: { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' } } };
  return s;
}

test('WO7 boss ability: level def acid -> acid, charge/missing/unknown -> charge; opts override', () => {
  const s = fakeState(20);
  assert.equal(spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' }).ability, 'charge');
  s.level = { index: 0, def: { boss: { ability: 'lasers' } } };
  assert.equal(spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' }).ability, 'charge');
  s.level = { index: 2, def: { boss: { ability: 'acid' } } };
  const a = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  assert.equal(a.ability, 'acid');
  assert.deepEqual(a.acid, { timer: BOSS.acid.every, phase: 'idle', t: 0 });
  assert.equal(a.charge.phase, 'idle', 'acid boss keeps an idle charge object (render-safe)');
  assert.equal(spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss', ability: 'charge' }).ability, 'charge');
  assert.equal(zombie.bossAbilityOf(null), 'charge');
});

test('WO7 acid boss never charges; spits every BOSS.acid.every s with a still telegraph', { skip: mapStub }, () => {
  const s = acidState();
  s.map = roomMap(48, 16);
  s.player = fakePlayer(44 * TILE, 8 * TILE);
  s.player.health = s.player.maxHealth = 1e6; // survives the boss's melee between spits
  const spits = record('boss:spit');
  const charges = record('boss:charge');
  const b = spawnZombie(s, { x: 3 * TILE, y: 8 * TILE }, { kind: 'boss' });
  const dt = 1 / 60;
  let t = 0;
  while (spits.length === 0 && t < 20) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.acid.every) < 2 * dt, `first spit at ${t}`);
  assert.equal(b.acid.phase, 'telegraph');
  assert.deepEqual(spits[0], { x: b.x, y: b.y });
  const x0 = b.x, y0 = b.y;
  t = 0;
  while (b.acid.phase === 'telegraph' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.acid.telegraph) < 2 * dt, `telegraph ${t}`);
  assert.equal(b.x, x0); assert.equal(b.y, y0);
  assert.equal(s.acidGlobs.length, BOSS.acid.globs);
  assert.ok(!s.bullets.some((x) => x.kind === 'acid'), 'globs are kept out of state.bullets');
  // Moves again (hunting) and spits again one period later.
  t = 0;
  while (spits.length === 1 && t < 20) { updateZombies(s, dt); t += dt; }
  assert.ok(b.x > x0, 'boss hunts between spits');
  assert.ok(Math.abs(t - BOSS.acid.every) < 3 * dt, `period ${t}`);
  assert.equal(charges.length, 0);
  assert.equal(b.charge.phase, 'idle');
});

test('WO7 lobAcid: glob count, fan spread, flight time and landing points', () => {
  const s = acidState(22);
  const b = spawnZombie(s, { x: 5 * TILE, y: 8 * TILE }, { kind: 'boss' });
  const px = b.x + 300, py = b.y;
  const globs = zombie.lobAcid(s, b, px, py);
  assert.equal(globs.length, BOSS.acid.globs);
  const angles = globs.map((g) => Math.atan2(g.ty - b.y, g.tx - b.x)).sort((x, y) => x - y);
  assert.ok(Math.abs(angles[0] + BOSS.acid.spread) < 1e-9);
  assert.ok(Math.abs(angles[angles.length - 1] - BOSS.acid.spread) < 1e-9);
  assert.ok(globs.some((g) => Math.abs(g.tx - px) < 1e-6 && Math.abs(g.ty - py) < 1e-6), 'centre glob on the player');
  for (const g of globs) {
    assert.equal(g.kind, 'acid');
    assert.equal(g.ttl, BOSS.acid.flight); assert.equal(g.maxTtl, BOSS.acid.flight);
    assert.ok(Math.abs(g.x + g.vx * g.ttl - g.tx) < 1e-6 && Math.abs(g.y + g.vy * g.ttl - g.ty) < 1e-6);
    assert.ok(Math.abs(Math.hypot(g.tx - b.x, g.ty - b.y) - 300) < 1e-6);
  }
});

// WO7 FIX-5 (playtest #4): arena = x 1..11 (x 12 is the arena wall), pillar block at (8..9, 7..8).
function acidArenaState(seed) {
  const s = acidState(seed);
  const m = s.map;
  for (let y = 1; y < m.rows - 1; y++) m.tiles[y * m.cols + 12] = 1;
  for (const [x, y] of [[8, 7], [9, 7], [8, 8], [9, 8]]) m.tiles[y * m.cols + x] = 1;
  m.arenaTiles = new Set();
  for (let y = 1; y < m.rows - 1; y++) for (let x = 1; x < 12; x++) if (m.tiles[y * m.cols + x] === 0) m.arenaTiles.add(y * m.cols + x);
  return s;
}
const tileKey = (m, x, y) => Math.floor(y / TILE) * m.cols + Math.floor(x / TILE);

test('WO7 FIX-5 lobAcid: globs never land on a pillar or past the arena wall', () => {
  const s = acidArenaState(40);
  const m = s.map;
  const b = spawnZombie(s, { x: 4.5 * TILE, y: 7.5 * TILE }, { kind: 'boss' });
  // Aim straight through the pillar, then past the east arena wall, then far outside the map.
  for (const [px, py] of [[8.5 * TILE, 7.9 * TILE], [14 * TILE, 7.5 * TILE], [11.5 * TILE, 2.5 * TILE], [40 * TILE, 30 * TILE]]) {
    s.acidGlobs = [];
    const globs = zombie.lobAcid(s, b, px, py);
    assert.equal(globs.length, BOSS.acid.globs);
    for (const g of globs) {
      assert.ok(m.arenaTiles.has(tileKey(m, g.tx, g.ty)), `(${g.tx.toFixed(1)}, ${g.ty.toFixed(1)}) in arena floor`);
      assert.ok(map.isWalkable(m, Math.floor(g.tx / TILE), Math.floor(g.ty / TILE)));
      assert.ok(Math.abs(g.x + g.vx * g.ttl - g.tx) < 1e-6 && Math.abs(g.y + g.vy * g.ttl - g.ty) < 1e-6, 'velocity re-aimed');
    }
  }
  // Snapped globs go to the nearest arena tile: aimed at pillar tile (8, 7) -> an adjacent tile.
  const p = zombie.acidLandingPoint(m, m.arenaTiles, 8.2 * TILE, 7.5 * TILE, 0, 0);
  assert.deepEqual(p, { x: 7.5 * TILE, y: 7.5 * TILE });
  const e = zombie.acidLandingPoint(m, m.arenaTiles, 13.5 * TILE, 5.5 * TILE, 0, 0);
  assert.deepEqual(e, { x: 11.5 * TILE, y: 5.5 * TILE });
  // Valid targets are untouched; an empty landing set falls back to the player's position.
  assert.deepEqual(zombie.acidLandingPoint(m, m.arenaTiles, 3.3 * TILE, 4.1 * TILE, 0, 0), { x: 3.3 * TILE, y: 4.1 * TILE });
  assert.deepEqual(zombie.acidLandingPoint(m, new Set([5]), 8.5 * TILE, 7.5 * TILE, 99, 77), { x: 99, y: 77 });
});

test('WO7 FIX-5 lobAcid outside the arena: snaps to the nearest walkable tile', () => {
  const s = acidArenaState(41);
  const m = s.map;
  const b = spawnZombie(s, { x: 18.5 * TILE, y: 7.5 * TILE }, { kind: 'boss' }); // east of the arena wall
  const globs = zombie.lobAcid(s, b, 12.5 * TILE, 7.5 * TILE); // centre glob on the wall column
  for (const g of globs) assert.ok(map.isWalkable(m, Math.floor(g.tx / TILE), Math.floor(g.ty / TILE)));
  const c = globs.find((g) => Math.abs(g.ty - 7.5 * TILE) < 1e-6);
  assert.ok(c && (c.tx === 11.5 * TILE || c.tx === 13.5 * TILE), `centre glob beside the wall, got ${c && c.tx}`);
});

test('WO7 downed-player rule: no attack start while downT > 0 or invulnT > 0; they still chase', () => {
  for (const field of ['downT', 'invulnT']) {
    const s = fakeState(23);
    s.player = fakePlayer(400, 100);
    s.player[field] = 1;
    const z = spawnZombie(s, openSpawn);
    const x0 = z.x;
    updateZombies(s, 0.1);
    assert.ok(z.x > x0, `${field}: still chases`);
    z.x = s.player.x - 30;
    updateZombies(s, 0.016);
    assert.equal(z.mode, 'chasing', `${field}: no attack started`);
    // A swing already winding up is cancelled without damage.
    z.mode = 'attacking'; z.attackTimer = 0.01;
    updateZombies(s, 0.05);
    assert.equal(z.mode, 'chasing');
    assert.equal(s.player.health, 150);
    // Rule lifts: attacks resume.
    s.player[field] = 0;
    updateZombies(s, 0.016);
    assert.equal(z.mode, 'attacking', `${field}: attacks once cleared`);
  }
});

test('WO7 downed-player rule applies to minions and the boss (melee, charge and spit)', { skip: mapStub }, () => {
  const s = fakeState(24);
  s.map = roomMap(16, 12);
  s.player = fakePlayer(8 * TILE, 6 * TILE);
  s.player.invulnT = 5;
  const dmg = record('player:damaged');
  const spits = record('boss:spit');
  const charges = record('boss:charge');
  const m = spawnZombie(s, { x: 8 * TILE - 30, y: 6 * TILE }, { kind: 'minion' });
  const b = spawnZombie(s, { x: 8 * TILE + BOSS.radius + 20, y: 6 * TILE }, { kind: 'boss' });
  b.charge.timer = 0.001;
  s.level = { index: 2, def: { boss: { ability: 'acid' } } };
  const a = spawnZombie(s, { x: 3 * TILE, y: 3 * TILE }, { kind: 'boss' });
  a.acid.timer = 0.001;
  const dt = 1 / 60;
  for (let t = 0; t < 1; t += dt) updateZombies(s, dt);
  assert.notEqual(m.mode, 'attacking');
  assert.notEqual(b.mode, 'attacking');
  assert.equal(b.charge.phase, 'idle');
  assert.equal(a.acid.phase, 'idle');
  assert.equal(charges.length, 0); assert.equal(spits.length, 0);
  assert.equal(dmg.length, 0);
  assert.equal(s.player.health, 150);
});

// ---------------------------------------------------------------------------
// WO9 (Agent E): frost (THE WENDIGO) and tide (THE DROWNED KING) boss abilities
// ---------------------------------------------------------------------------

function wo9State(ability, seed = 90, w = 40, h = 24) {
  const s = fakeState(seed);
  s.map = roomMap(w, h);
  s.level = { index: ability === 'frost' ? 4 : 5, def: { boss: { name: 'BOSS', tint: '#ffffff', ability } } };
  return s;
}
const setTile = (m, tx, ty, code) => { m.tiles[ty * m.cols + tx] = code; };
const PIT = Number.isFinite(map.TILE_PIT) ? map.TILE_PIT : 12;

test('WO9 boss ability: frost / tide from the level def get their state objects', () => {
  const s = wo9State('frost');
  const f = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  assert.equal(f.ability, 'frost');
  assert.deepEqual(f.frost, { timer: BOSS.frost.every, phase: 'idle', t: 0, angle: 0, hit: false });
  assert.equal(f.charge.phase, 'idle', 'frost boss keeps an idle charge object (render-safe)');
  s.level.def.boss.ability = 'tide';
  const t = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  assert.equal(t.ability, 'tide');
  assert.equal(t.tide.phase, 'idle'); assert.equal(t.tide.radius, 0); assert.equal(t.tide.timer, BOSS.tide.every);
  assert.equal(spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss', ability: 'frost' }).ability, 'frost');
  assert.equal(zombie.bossAbilityOf(s, { ability: 'nope' }), 'charge');
  assert.equal(zombie.bossAbilityOf(s), 'tide');
});

test('WO9 frost cadence: boss:frost every BOSS.frost.every s, still telegraph + breath, never charges', { skip: mapStub }, () => {
  const s = wo9State('frost', 91, 60, 16);
  s.player = fakePlayer(56 * TILE, 8 * TILE); // far out of range: no hit
  const frosts = record('boss:frost');
  const charges = record('boss:charge');
  const b = spawnZombie(s, { x: 3 * TILE, y: 8 * TILE }, { kind: 'boss' });
  const dt = 1 / 60;
  let t = 0;
  while (frosts.length === 0 && t < 20) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.frost.every) < 2 * dt, `first breath at ${t}`);
  assert.equal(b.frost.phase, 'telegraph');
  assert.equal(frosts[0].x, b.x); assert.equal(frosts[0].y, b.y);
  assert.ok(Math.abs(frosts[0].angle) < 1e-9, 'aimed at the player (east)');
  assert.equal(b.frost.angle, frosts[0].angle);
  const x0 = b.x;
  t = 0;
  while (b.frost.phase === 'telegraph' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.frost.telegraph) < 2 * dt, `telegraph ${t}`);
  assert.equal(b.frost.phase, 'breath');
  t = 0;
  while (b.frost.phase === 'breath' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - zombie.FROST_BREATH) < 2 * dt, `breath ${t}`);
  assert.equal(b.x, x0, 'still during telegraph and breath');
  t = 0;
  while (frosts.length === 1 && t < 20) { updateZombies(s, dt); t += dt; }
  assert.ok(b.x > x0, 'hunts between breaths');
  assert.ok(Math.abs(t - BOSS.frost.every) < 3 * dt, `period ${t}`);
  assert.equal(charges.length, 0);
  assert.equal(s.player.health, 150);
});

test('WO9 inFrostCone: edge distance, widened half-angle, line of sight (walls block, pits do not)', () => {
  const m = roomMap(40, 24);
  const F = BOSS.frost;
  const bx = 10 * TILE + 20, by = 12 * TILE + 20;
  const at = (d, a, r = 14) => ({ x: bx + Math.cos(a) * d, y: by + Math.sin(a) * d, radius: r });
  assert.ok(zombie.inFrostCone(m, bx, by, 0, at(150, 0), F));
  assert.ok(zombie.inFrostCone(m, bx, by, 0, at(F.range + 13, 0), F), 'edge within range');
  assert.ok(!zombie.inFrostCone(m, bx, by, 0, at(F.range + 15, 0), F), 'edge out of range');
  const widen = Math.asin(14 / 150);
  assert.ok(zombie.inFrostCone(m, bx, by, 0, at(150, F.halfAngle + widen - 0.01), F), 'edge inside the cone');
  assert.ok(!zombie.inFrostCone(m, bx, by, 0, at(150, F.halfAngle + widen + 0.01), F), 'edge outside the cone');
  assert.ok(!zombie.inFrostCone(m, bx, by, 0, at(150, Math.PI), F), 'behind');
  assert.ok(zombie.inFrostCone(m, bx, by, Math.PI / 2, at(150, Math.PI / 2), F), 'other directions');
  assert.ok(zombie.inFrostCone(m, bx, by, 0, at(5, 2), F), 'overlapping the boss centre');
  // A wall tile between boss and player blocks the breath; a pit tile does not.
  const wallM = roomMap(40, 24);
  setTile(wallM, 13, 12, 1);
  assert.ok(!zombie.inFrostCone(wallM, bx, by, 0, at(200, 0), F), 'wall blocks');
  const pitM = roomMap(40, 24);
  setTile(pitM, 13, 12, PIT);
  assert.ok(zombie.inFrostCone(pitM, bx, by, 0, at(200, 0), F), 'breath crosses a pit');
});

function frostDuel(seed, px, py, prep) {
  const s = wo9State('frost', seed);
  s.player = fakePlayer(px, py);
  s.player.slowT = 0;
  const b = spawnZombie(s, { x: 10 * TILE + 20, y: 12 * TILE + 20 }, { kind: 'boss' });
  b.frost.timer = 1e-3;
  if (prep) prep(s, b);
  const dmg = record('player:damaged');
  const dt = 1 / 60;
  updateZombies(s, dt);
  let t = 0;
  while (b.frost.phase !== 'idle' && t < 3) { updateZombies(s, dt); t += dt; }
  return { s, b, dmg };
}

test('WO9 frost breath: damage + slow once per breath for a player in the cone', { skip: mapStub || playerStub }, () => {
  const { s, dmg } = frostDuel(92, 10 * TILE + 20 + 180, 12 * TILE + 20);
  assert.equal(dmg.length, 1, 'one hit per breath');
  assert.equal(dmg[0].amount, BOSS.frost.damage);
  assert.equal(s.player.health, 150 - BOSS.frost.damage);
  assert.equal(s.player.slowT, BOSS.frost.slowSeconds);
  // A longer slow already running is kept (max).
  const r = frostDuel(93, 10 * TILE + 20 + 180, 12 * TILE + 20, (st) => { st.player.slowT = 5; });
  assert.equal(r.s.player.slowT, 5);
});

test('WO9 frost breath misses behind a wall, out of the locked cone, and while invulnerable', { skip: mapStub || playerStub }, () => {
  const wall = frostDuel(94, 10 * TILE + 20 + 180, 12 * TILE + 20, (s) => setTile(s.map, 13, 12, 1));
  assert.equal(wall.dmg.length, 0); assert.equal(wall.s.player.slowT, 0);
  // Cone locked at telegraph start: sidestepping during the telegraph dodges it.
  const dodge = frostDuel(95, 10 * TILE + 20 + 180, 12 * TILE + 20, (s, b) => {
    const dt = 1 / 60;
    updateZombies(s, dt);
    assert.equal(b.frost.phase, 'telegraph');
    s.player.y += 200;
  });
  assert.equal(dodge.dmg.length, 0); assert.equal(dodge.s.player.slowT, 0);
  const god = frostDuel(96, 10 * TILE + 20 + 180, 12 * TILE + 20, (s) => { s.player.invulnerable = true; });
  assert.equal(god.dmg.length, 0); assert.equal(god.s.player.slowT, 0);
  for (const field of ['invulnT', 'downT']) {
    const r = frostDuel(97, 10 * TILE + 20 + 180, 12 * TILE + 20, (s, b) => {
      updateZombies(s, 1 / 60); // telegraph starts
      s.player[field] = 5;
    });
    assert.equal(r.dmg.length, 0, field); assert.equal(r.s.player.slowT, 0, field);
  }
});

test('WO9 frost / tide cooldowns pause while the player is untargetable', { skip: mapStub }, () => {
  for (const ability of ['frost', 'tide']) {
    for (const field of ['invulnT', 'downT']) {
      const s = wo9State(ability, 98);
      s.player = fakePlayer(30 * TILE, 12 * TILE);
      s.player[field] = 5;
      const ev = record(`boss:${ability}`);
      const b = spawnZombie(s, { x: 5 * TILE, y: 12 * TILE }, { kind: 'boss' });
      b[ability].timer = 0.5;
      for (let t = 0; t < 1; t += 1 / 60) updateZombies(s, 1 / 60);
      assert.equal(b[ability].timer, 0.5, `${ability}/${field}: timer frozen`);
      assert.equal(b[ability].phase, 'idle');
      assert.equal(ev.length, 0);
      s.player[field] = 0;
      for (let t = 0; t < 0.6; t += 1 / 60) updateZombies(s, 1 / 60);
      assert.equal(ev.length, 1, `${ability}/${field}: resumes`);
    }
  }
});

test('WO9 tideBandHits: swept band test', () => {
  const B = BOSS.tide.band;
  assert.ok(zombie.tideBandHits(100, 90, 95, B));
  assert.ok(zombie.tideBandHits(100, 0, 100 - B + 1, B));
  assert.ok(!zombie.tideBandHits(100, 0, 100 - B, B));
  assert.ok(!zombie.tideBandHits(100, 100 + B, 140, B), 'ring already past');
  assert.ok(zombie.tideBandHits(100, 20, 300, B), 'a big step never skips the player');
});

test('WO9 tide cadence: boss:tide every BOSS.tide.every s, still telegraph, ring grows at speed to maxRadius', { skip: mapStub }, () => {
  const s = wo9State('tide', 100, 60, 16);
  s.player = fakePlayer(56 * TILE, 8 * TILE); // out of the ring's reach
  const tides = record('boss:tide');
  const charges = record('boss:charge');
  const b = spawnZombie(s, { x: 3 * TILE, y: 8 * TILE }, { kind: 'boss' });
  const dt = 1 / 60;
  let t = 0;
  while (tides.length === 0 && t < 20) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.tide.every) < 2 * dt, `first wave at ${t}`);
  assert.deepEqual(tides[0], { x: b.x, y: b.y });
  assert.equal(b.tide.phase, 'telegraph');
  const x0 = b.x;
  t = 0;
  while (b.tide.phase === 'telegraph' && t < 2) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.tide.telegraph) < 2 * dt, `telegraph ${t}`);
  assert.equal(b.x, x0, 'still during the telegraph');
  assert.equal(b.tide.phase, 'wave');
  assert.equal(b.tide.x, x0);
  for (let i = 0; i < 30; i++) updateZombies(s, dt);
  assert.ok(Math.abs(b.tide.radius - BOSS.tide.speed * 30 * dt) < 1e-6, `radius ${b.tide.radius}`);
  assert.ok(b.x > x0, 'hunts while the wave rolls');
  assert.equal(b.tide.x, x0, 'wave centre stays put');
  t = 30 * dt;
  while (b.tide.phase === 'wave' && t < 5) { updateZombies(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.tide.maxRadius / BOSS.tide.speed) < 2 * dt, `wave lasted ${t}`);
  assert.equal(b.tide.radius, 0);
  assert.equal(b.tide.timer, BOSS.tide.every);
  assert.equal(charges.length, 0);
  assert.equal(s.player.health, 150);
});

function tideDuel(seed, bx, px, prep) {
  const s = wo9State('tide', seed);
  s.player = fakePlayer(px, 12 * TILE + 20);
  s.player.health = s.player.maxHealth = 1e6;
  const b = spawnZombie(s, { x: bx, y: 12 * TILE + 20 }, { kind: 'boss' });
  b.tide.timer = 1e-3;
  if (prep) prep(s, b);
  const dmg = record('player:damaged');
  const dt = 1 / 60;
  updateZombies(s, dt);
  let t = 0;
  const x0 = s.player.x;
  while (b.tide.phase === 'telegraph' && t < 3) { updateZombies(s, dt); t += dt; }
  while (b.tide.phase === 'wave' && t < 5) { updateZombies(s, dt); t += dt; }
  return { s, b, dmg, x0 };
}

test('WO9 tide wave: hits once per wave, 40 damage, 120 px knockback away from the centre', { skip: mapStub || playerStub }, () => {
  const { s, dmg, x0 } = tideDuel(101, 20 * TILE, 20 * TILE + 200);
  assert.equal(dmg.length, 1, 'once per wave (the knocked player is not hit again)');
  assert.equal(dmg[0].amount, BOSS.tide.damage);
  assert.ok(Math.abs(s.player.x - (x0 + BOSS.tide.knockback)) < 1e-6, `knocked to ${s.player.x}`);
  assert.equal(s.player.y, 12 * TILE + 20);
});

test('WO9 tide wave: blocked by walls, not by pits; out of reach; untargetable player', { skip: mapStub || playerStub }, () => {
  const wall = tideDuel(102, 20 * TILE, 20 * TILE + 200, (s) => { for (let y = 8; y <= 16; y++) setTile(s.map, 22, y, 1); });
  assert.equal(wall.dmg.length, 0); assert.equal(wall.s.player.x, wall.x0);
  const pit = tideDuel(103, 20 * TILE, 20 * TILE + 200, (s) => { for (let y = 8; y <= 16; y++) setTile(s.map, 22, y, PIT); });
  assert.equal(pit.dmg.length, 1, 'the wave rolls over water');
  const far = tideDuel(104, 5 * TILE, 5 * TILE + BOSS.tide.maxRadius + BOSS.tide.band + 20);
  assert.equal(far.dmg.length, 0);
  for (const field of ['invulnT', 'downT']) {
    const r = tideDuel(105, 20 * TILE, 20 * TILE + 200, (s) => { s.player[field] = 0; });
    assert.equal(r.dmg.length, 1, `${field} baseline`);
    const q = tideDuel(106, 20 * TILE, 20 * TILE + 200, (s, b) => {
      updateZombies(s, 1 / 60); // telegraph starts
      assert.equal(b.tide.phase, 'telegraph');
      s.player[field] = 10;
    });
    assert.equal(q.dmg.length, 0, field); assert.equal(q.s.player.x, q.x0, `${field}: no knockback`);
  }
});

test('WO9 tide knockback is wall-safe (resolveCircle)', { skip: mapStub || playerStub }, () => {
  // East wall inner face at x = 39 * TILE; the player starts 60 px from it.
  const { s, dmg } = tideDuel(107, 30 * TILE, 39 * TILE - 60);
  assert.equal(dmg.length, 1);
  assert.ok(s.player.x <= 39 * TILE - s.player.radius + 1e-6, `stays out of the wall: ${s.player.x}`);
  assert.ok(s.player.x > 39 * TILE - 60, 'pushed toward the wall');
});

test('WO9 killZombie resets frost / tide phases', () => {
  const s = wo9State('frost', 108);
  const f = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  f.frost.phase = 'breath'; f.frost.t = 0.2;
  killZombie(s, f, 'debug');
  assert.equal(f.frost.phase, 'idle');
  s.level.def.boss.ability = 'tide';
  const t = spawnZombie(s, { x: 100, y: 100 }, { kind: 'boss' });
  t.tide.phase = 'wave'; t.tide.radius = 200;
  killZombie(s, t, 'debug');
  assert.equal(t.tide.phase, 'idle'); assert.equal(t.tide.radius, 0);
});

// ---------------------------------------------------------------------------
// WO9 FIX-3 (QA outpost #1, temple #1): large-zombie clearance flow + unstick watchdog
// ---------------------------------------------------------------------------
import { buildFlowField } from '../src/pathfinding.js';

// 30 x 16 room split by a wall at row 7. `wideGap`: a 3-tile gap at x 2..4 (a detour the boss fits
// through); always a 1-tile gap at x 15, right on the straight line between boss and player.
function gapMap(wideGap = true) {
  const w = 30, h = 16;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wall = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (y === 7) wall = !(x === 15 || (wideGap && x >= 2 && x <= 4));
      tiles[y * w + x] = wall ? 1 : 0;
    }
  }
  return { cols: w, rows: h, width: w * TILE, height: h * TILE, tiles, walls: [], barricades: [],
    spawnPoints: [], wallBuys: [], box: null, playerStart: { x: 15.5 * TILE, y: 11.5 * TILE } };
}

function gapDuel(seed, wideGap) {
  const s = fakeState(seed);
  s.map = gapMap(wideGap);
  s.player = fakePlayer(15.5 * TILE, 11.5 * TILE);
  s.flow = buildFlowField(s.map, s.player.x, s.player.y);
  const b = spawnZombie(s, { x: 15.5 * TILE, y: 3.5 * TILE }, { kind: 'boss' });
  b.charge.timer = 1e9; // no dash: pure hunting
  return { s, b };
}

test('WO9 FIX-3 fatMask / circleFits / nearestFitPoint: 1-tile gaps close for the boss, 2-wide lanes stay open', { skip: mapStub }, () => {
  const m = gapMap(true);
  const R = BOSS.radius;
  assert.ok(R > TILE / 2 && zombie.isLargeZombie({ radius: R }) && !zombie.isLargeZombie({ radius: ZOMBIE.radius }));
  const mask = zombie.fatMask(m, R);
  assert.equal(mask[7 * m.cols + 15], 0, '1-tile gap is closed');
  assert.equal(mask[7 * m.cols + 3], 1, '3-tile gap centre is open');
  assert.equal(mask[7 * m.cols + 2], 1, '3-tile gap side (fits on its edge with the centre tile)');
  assert.equal(mask[3 * m.cols + 15], 1, 'open floor');
  assert.equal(mask[1 * m.cols + 1], 1, 'room corner tile (its inner corner point fits)');
  assert.equal(mask[0], 0, 'wall');
  // 2-wide lane: both tiles open (the shared edge midpoint is 40 px from each wall)
  const lane = gapMap(false);
  lane.tiles[7 * lane.cols + 16] = 0;
  const lm = zombie.fatMask(lane, R);
  assert.equal(lm[7 * lane.cols + 15], 1); assert.equal(lm[7 * lane.cols + 16], 1);
  assert.ok(zombie.circleFits(m, 15.5 * TILE, 3.5 * TILE, R));
  assert.ok(!zombie.circleFits(m, 15.5 * TILE, 7.5 * TILE, R), 'boss does not fit in the 1-tile gap');
  assert.ok(zombie.circleFits(m, 15.5 * TILE, 7.5 * TILE, ZOMBIE.radius), 'a normal zombie does');
  const g = zombie.nearestFitPoint(m, 15.5 * TILE, 6.4 * TILE, R);
  assert.ok(g && zombie.circleFits(m, g.x, g.y, R));
  assert.ok(g.y <= 6.4 * TILE, 'nearest fitting point is back in the north room');
});

test('WO9 FIX-3 boss takes the wide detour instead of wedging in a 1-tile gap', { skip: mapStub }, () => {
  const { s, b } = gapDuel(301, true);
  const dt = 1 / 60;
  let reached = false, minY = Infinity;
  for (let t = 0; t < 30 && !reached; t += dt) {
    updateZombies(s, dt);
    if (b.y > 7 * TILE && b.x < 6 * TILE) minY = Math.min(minY, b.y);
    if (b.mode === 'attacking') reached = true;
  }
  assert.ok(reached, `boss reached the player (at ${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
  assert.ok(minY < Infinity, 'went through the west gap');
  assert.ok(!b.unstick || b.unstick.count === 0, 'never needed the watchdog');
});

test('WO9 FIX-3 watchdog: a boss pinned at a gap it cannot fit through never stands still for long', { skip: mapStub }, () => {
  // No detour: the clearance field has no route, so the boss falls back to the shared flow, which
  // leads into the 1-tile gap. Without the watchdog it stays pinned there for good.
  const { s, b } = gapDuel(302, false);
  const dt = 1 / 60;
  let still = 0, maxStill = 0, lx = b.x, ly = b.y, stages = new Set();
  for (let t = 0; t < 12; t += dt) {
    updateZombies(s, dt);
    if (b.unstick && b.unstick.mode) stages.add(b.unstick.mode);
    if (Math.hypot(b.x - lx, b.y - ly) >= UNSTICK_MIN) { lx = b.x; ly = b.y; still = 0; } else still += dt;
    maxStill = Math.max(maxStill, still);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(b.y < 7 * TILE + 1, 'never squeezes through');
  }
  assert.ok(b.unstick && b.unstick.count >= 2, `watchdog fired (${b.unstick && b.unstick.count})`);
  assert.ok(maxStill < zombie.UNSTICK.span + zombie.UNSTICK.steer + 0.2, `longest stand-still ${maxStill.toFixed(2)} s`);
  assert.ok(stages.has('steer'), 'stage 1 steer');
  assert.ok(stages.has('seek') || stages.has('nudge'), `escalates (${[...stages]})`);
  // After an escape the boss rests where its circle fits.
  for (let t = 0; t < 3; t += 1 / 60) {
    updateZombies(s, 1 / 60);
    if (b.unstick.mode === 'nudge') { updateZombies(s, 1 / 60); }
  }
  const r = map.resolveCircle(s.map, b.x, b.y, b.radius, true);
  assert.ok(Math.hypot(r.x - b.x, r.y - b.y) < 1, 'resolved position');
});
const UNSTICK_MIN = 4;

test('WO9 FIX-3 watchdog stays quiet while the boss swings, telegraphs or touches the player; normal zombies untouched', { skip: mapStub || playerStub }, () => {
  const s = wo9State('frost', 303, 20, 20);
  s.player = fakePlayer(10 * TILE, 10 * TILE);
  s.player.invulnerable = true;
  s.flow = buildFlowField(s.map, s.player.x, s.player.y);
  const b = spawnZombie(s, { x: 10 * TILE + 50, y: 10 * TILE }, { kind: 'boss' });
  const n = spawnZombie(s, { x: 3 * TILE, y: 3 * TILE });
  let frosts = 0;
  for (let t = 0; t < 14; t += 1 / 60) {
    updateZombies(s, 1 / 60);
    if (b.frost.phase !== 'idle') frosts++;
    s.player.health = s.player.maxHealth;
  }
  assert.ok(frosts > 0, 'telegraphed / breathed at least once');
  assert.ok(!b.unstick || b.unstick.count === 0, 'no false unstick');
  assert.equal(n.unstick, undefined, 'radius-14 zombies never get the watchdog');
});
