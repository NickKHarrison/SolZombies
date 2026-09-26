import test from 'node:test';
import assert from 'node:assert/strict';
import { POWERUPS, POINTS, BOSS } from '../src/config.js';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as player from '../src/player.js';
import * as weapons from '../src/weapons.js';
import * as zombie from '../src/zombie.js';
import * as waves from '../src/waves.js';
import * as map from '../src/map.js';
import {
  POWERUP_TYPES, POWERUP_LABEL, initPowerups, updatePowerups, spawnPowerup,
  applyPowerup, isActive, timeLeft,
} from '../src/powerups.js';

// True when any of the given functions is still a Phase 0 stub.
const stub = (...fns) => fns.some((f) => String(f).includes('not implemented'));

function fresh(seed = 1) {
  events.clearAll();
  const s = createEmptyState(seed);
  s.phase = 'playing';
  return s;
}

function fakePlayer(x = 0, y = 0) {
  return { id: 1, x, y, radius: 14, points: 0, weapons: [null, null], tempWeapon: null, down: false };
}

const kill = (cause = 'weapon', x = 5, y = 6) =>
  events.emit('zombie:killed', { zombie: { id: 99, x, y }, cause, x, y });

test('types and labels', () => {
  assert.deepEqual([...POWERUP_TYPES], ['instaKill', 'doublePoints', 'maxAmmo', 'nuke', 'carpenter', 'fireSale', 'deathMachine', 'zombieBlood']);
  for (const t of POWERUP_TYPES) assert.equal(typeof POWERUP_LABEL[t], 'string');
  assert.equal(POWERUP_LABEL.instaKill, 'INSTA-KILL');
  assert.equal(POWERUP_LABEL.zombieBlood, 'ZOMBIE BLOOD');
});

test('drop chance is about 2% over 10000 weapon kills', () => {
  const s = fresh(12345);
  initPowerups(s);
  let drops = 0;
  events.on('powerup:spawned', () => drops++);
  for (let i = 0; i < 10000; i++) {
    s.powerups.dropsThisRound = 0; // remove the per-round cap for this measurement
    kill();
  }
  assert.ok(drops > 150 && drops < 250, `drops=${drops}`);
  assert.equal(s.powerups.items.length, drops);
});

test('cap of maxPerRound drops per round, reset on round:start', () => {
  const s = fresh(7);
  initPowerups(s);
  for (let i = 0; i < 5000; i++) kill();
  assert.equal(s.powerups.items.length, POWERUPS.maxPerRound);
  events.emit('round:start', { round: 2 });
  assert.equal(s.powerups.dropsThisRound, 0);
  for (let i = 0; i < 5000; i++) kill();
  assert.equal(s.powerups.items.length, POWERUPS.maxPerRound * 2);
});

test('non-weapon kills never roll drops', () => {
  const s = fresh(3);
  initPowerups(s);
  for (let i = 0; i < 5000; i++) { kill('nuke'); kill('debug'); }
  assert.equal(s.powerups.items.length, 0);
});

test('same type never drops twice in a row', () => {
  const s = fresh(99);
  initPowerups(s);
  const seq = [];
  events.on('powerup:spawned', ({ item }) => seq.push(item.type));
  for (let i = 0; i < 40000; i++) { s.powerups.dropsThisRound = 0; kill(); }
  assert.ok(seq.length > 500);
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
});

test('spawnPowerup creates item with contract shape', () => {
  const s = fresh(5);
  const item = spawnPowerup(s, 'instaKill', 10, 20);
  assert.deepEqual({ ...item, id: 0 }, { id: 0, type: 'instaKill', x: 10, y: 20, ttl: POWERUPS.lifetime, bob: 0 });
  assert.equal(s.powerups.items[0], item);
});

test('item ttl, bob and expiry removal', () => {
  const s = fresh();
  spawnPowerup(s, 'fireSale', 1000, 1000);
  updatePowerups(s, 1);
  assert.equal(s.powerups.items[0].bob, 1);
  assert.equal(s.powerups.items[0].ttl, POWERUPS.lifetime - 1);
  updatePowerups(s, POWERUPS.lifetime);
  assert.equal(s.powerups.items.length, 0);
});

test('pickup applies timed power-up and emits collected', () => {
  const s = fresh();
  s.player = fakePlayer(0, 0);
  const got = [];
  events.on('powerup:collected', (p) => got.push(p.type));
  spawnPowerup(s, 'doublePoints', 30, 0); // 30 < 28 + 14
  spawnPowerup(s, 'instaKill', 100, 0);   // out of range
  updatePowerups(s, 0.016);
  assert.deepEqual(got, ['doublePoints']);
  assert.equal(s.powerups.items.length, 1);
  assert.ok(isActive(s, 'doublePoints'));
  assert.ok(!isActive(s, 'instaKill'));
});

test('downed player cannot pick up', () => {
  const s = fresh();
  s.player = fakePlayer(0, 0);
  s.player.down = true;
  spawnPowerup(s, 'zombieBlood', 0, 0);
  updatePowerups(s, 0.016);
  assert.equal(s.powerups.items.length, 1);
});

test('timed power-up: isActive/timeLeft and re-pickup resets timer', () => {
  const s = fresh();
  assert.equal(timeLeft(s, 'instaKill'), 0);
  assert.equal(isActive(s, 'instaKill'), false);
  applyPowerup(s, 'instaKill');
  assert.equal(timeLeft(s, 'instaKill'), POWERUPS.duration.instaKill);
  s.time = 20;
  assert.equal(timeLeft(s, 'instaKill'), POWERUPS.duration.instaKill - 20);
  applyPowerup(s, 'instaKill');
  assert.equal(timeLeft(s, 'instaKill'), POWERUPS.duration.instaKill);
  assert.equal(s.powerups.active.instaKill, 20 + POWERUPS.duration.instaKill);
});

test('expiry deletes entry and emits powerup:expired once', () => {
  const s = fresh();
  const expired = [];
  events.on('powerup:expired', (p) => expired.push(p.type));
  applyPowerup(s, 'zombieBlood');
  applyPowerup(s, 'fireSale');
  s.time = POWERUPS.duration.zombieBlood - 0.01;
  updatePowerups(s, 0.01);
  assert.deepEqual(expired, []);
  s.time = POWERUPS.duration.zombieBlood;
  assert.ok(!isActive(s, 'zombieBlood'));
  updatePowerups(s, 0.01);
  assert.deepEqual(expired.sort(), ['fireSale', 'zombieBlood']);
  assert.deepEqual(s.powerups.active, {});
  updatePowerups(s, 0.01);
  assert.equal(expired.length, 2);
});

test('maxAmmo fills reserve only', { skip: stub(weapons.createWeapon, weapons.refillReserve) }, () => {
  const s = fresh();
  s.player = fakePlayer();
  const w = weapons.createWeapon('mr6');
  w.mag = 2; w.reserve = 3;
  s.player.weapons = [w, null];
  applyPowerup(s, 'maxAmmo');
  assert.equal(w.reserve, w.def.reserve);
  assert.equal(w.mag, 2);
});

test('deathMachine equips temp weapon and clears on expiry',
  { skip: stub(player.createPlayer, player.equipTemporary, player.clearTemporary, weapons.createDeathMachine) }, () => {
    const s = fresh();
    s.player = player.createPlayer(0, 0);
    applyPowerup(s, 'deathMachine');
    assert.ok(s.player.tempWeapon);
    s.time = POWERUPS.duration.deathMachine;
    updatePowerups(s, 0.01);
    assert.equal(s.player.tempWeapon, null);
  });

test('carpenter repairs all and awards bonus',
  { skip: stub(player.createPlayer, player.addPoints, map.loadMap, map.repairAll) }, () => {
    const s = fresh();
    s.map = map.loadMap();
    s.player = player.createPlayer(0, 0);
    const before = s.player.points;
    applyPowerup(s, 'carpenter');
    assert.equal(s.player.points - before, POINTS.carpenterBonus);
  });

test('nuke: flash, bonus, and staggered kills of all alive zombies',
  { skip: stub(player.createPlayer, player.addPoints, zombie.killZombie, waves.createRoundState, waves.pauseSpawning) }, () => {
    const s = fresh();
    s.player = player.createPlayer(0, 0);
    s.rounds = waves.createRoundState();
    s.rounds.round = 1;
    for (let i = 0; i < 5; i++) {
      s.zombies.push({ id: 1000 + i, x: 100 + i * 30, y: 100, radius: 14, hp: 150, maxHp: 150, tier: 'walk', speed: 70,
        mode: 'chasing', spawnPointId: 0, barricadeId: null, tearTimer: 0, attackTimer: 0, attackCd: 0, dyingT: 0, vx: 0, vy: 0, hitFlash: 0 });
    }
    initPowerups(s);
    const killed = [];
    events.on('zombie:killed', (p) => killed.push(p));
    const before = s.player.points;
    applyPowerup(s, 'nuke');
    assert.equal(s.player.points - before, POINTS.nukeBonus);
    assert.ok(s.effects.some((e) => e.type === 'flash'));
    assert.equal(s.powerups.nuke.queue.length, 5);
    updatePowerups(s, POWERUPS.nukeStagger * 0.5);
    assert.equal(killed.length, 0);
    for (let i = 0; i < 20; i++) updatePowerups(s, POWERUPS.nukeStagger);
    assert.equal(killed.length, 5);
    assert.ok(killed.every((k) => k.cause === 'nuke'));
    assert.equal(s.powerups.nuke, null);
    assert.equal(s.powerups.items.length, 0); // nuke kills never roll drops
  });

// Regression for review.md #4b: drops on non-player-walkable tiles (spawn pockets) are moved to
// the nearest player-walkable tile, or skipped without counting toward the per-round cap.
test('drops in a spawn pocket snap to the window inside neighbour (review #4b)',
  { skip: stub(map.loadMap, map.isWalkable, map.worldToTile, map.tileToWorld) }, () => {
    const s = fresh(3);
    s.map = map.loadMap();
    s.rng.chance = () => true; // force a drop on every roll
    initPowerups(s);
    // Find a spawn pocket whose window's inside neighbour (two tiles away) is floor.
    const { cols, rows, tiles } = s.map;
    let pocket = null;
    for (let ty = 0; ty < rows && !pocket; ty++) {
      for (let tx = 0; tx < cols && !pocket; tx++) {
        if (tiles[ty * cols + tx] !== map.TILE_SPAWN_POCKET) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (tiles[(ty + dy) * cols + tx + dx] === map.TILE_WINDOW &&
              map.isWalkable(s.map, tx + 2 * dx, ty + 2 * dy, false)) {
            pocket = { tx, ty, inside: map.tileToWorld(tx + 2 * dx, ty + 2 * dy) };
            break;
          }
        }
      }
    }
    assert.ok(pocket, 'map has a spawn pocket behind a window');
    const c = map.tileToWorld(pocket.tx, pocket.ty);
    kill('weapon', c.x, c.y);
    assert.equal(s.powerups.items.length, 1);
    assert.equal(s.powerups.dropsThisRound, 1);
    const item = s.powerups.items[0];
    assert.deepEqual({ x: item.x, y: item.y }, { x: pocket.inside.x, y: pocket.inside.y });
    const t = map.worldToTile(item.x, item.y);
    assert.ok(map.isWalkable(s.map, t.tx, t.ty, false), 'item sits on a player-walkable tile');

    // A drop on a walkable tile keeps its exact position.
    const f = map.tileToWorld(pocket.inside.x / 40 | 0, pocket.inside.y / 40 | 0);
    kill('weapon', f.x + 3, f.y - 2);
    assert.deepEqual({ x: s.powerups.items[1].x, y: s.powerups.items[1].y }, { x: f.x + 3, y: f.y - 2 });
  });

test('drops with no player-walkable tile nearby are skipped and not counted (review #4b)',
  { skip: stub(map.isWalkable, map.worldToTile, map.tileToWorld) }, () => {
    const s = fresh(4);
    // 9x9 all-wall map with a pocket in the middle: nothing reachable within the snap radius.
    const tiles = new Array(81).fill(map.TILE_WALL);
    tiles[4 * 9 + 4] = map.TILE_SPAWN_POCKET;
    s.map = { cols: 9, rows: 9, tiles, barricades: [], barricadeIndex: {} };
    s.rng.chance = () => true;
    initPowerups(s);
    let spawned = 0;
    events.on('powerup:spawned', () => spawned++);
    kill('weapon', 4.5 * 40, 4.5 * 40);
    assert.equal(spawned, 0);
    assert.equal(s.powerups.items.length, 0);
    assert.equal(s.powerups.dropsThisRound, 0, 'skipped drop does not count toward the cap');
  });

// --- WO5 3.2: boss / minion power-up rules -------------------------------------------------

test('WO5 nuke: boss is not queued and takes BOSS.nukeFrac of max HP; minions are queued',
  { skip: stub(player.createPlayer, zombie.killZombie, waves.createRoundState, waves.pauseSpawning) }, () => {
    const s = fresh(21);
    s.player = player.createPlayer(0, 0);
    s.rounds = waves.createRoundState();
    s.rounds.round = 3;
    const boss = zombie.spawnZombie(s, { x: 300, y: 300 }, { kind: 'boss' });
    const mins = [0, 1, 2].map((i) => zombie.spawnZombie(s, { x: 100 + i * 30, y: 100 }, { kind: 'minion' }));
    initPowerups(s);
    applyPowerup(s, 'nuke');
    assert.ok(Math.abs(boss.hp - boss.maxHp * (1 - BOSS.nukeFrac)) < 1e-6);
    assert.deepEqual(s.powerups.nuke.queue, mins.map((m) => m.id));
    // A boss id sneaking into the queue (e.g. an older nuke) is still never killed by it.
    s.powerups.nuke.queue.push(boss.id);
    for (let i = 0; i < 20; i++) updatePowerups(s, POWERUPS.nukeStagger);
    assert.ok(mins.every((m) => m._killed));
    assert.ok(!boss._killed);
  });

test('WO5 drops: minions roll at the normal chance; the boss never rolls (guaranteed Max Ammo is boss.js)', () => {
  const s = fresh(22);
  initPowerups(s);
  for (let i = 0; i < 5000; i++) {
    s.powerups.dropsThisRound = 0;
    events.emit('zombie:killed', { zombie: { id: 1, x: 5, y: 6, kind: 'boss' }, cause: 'weapon', x: 5, y: 6, kind: 'boss' });
  }
  assert.equal(s.powerups.items.length, 0);
  let drops = 0;
  for (let i = 0; i < 10000; i++) {
    s.powerups.dropsThisRound = 0;
    events.emit('zombie:killed', { zombie: { id: 2, x: 5, y: 6, kind: 'minion' }, cause: 'weapon', x: 5, y: 6, kind: 'minion' });
  }
  drops = s.powerups.items.length;
  assert.ok(drops > 150 && drops < 250, `drops=${drops}`);
});

test('WO5 FIX-2 nuke vs boss is a fractional effect: exactly nukeFrac even above maxHitFrac and under Insta-Kill',
  { skip: stub(player.createPlayer, zombie.killZombie, waves.createRoundState, waves.pauseSpawning) }, () => {
    const s = fresh(23);
    s.player = player.createPlayer(0, 0);
    s.rounds = waves.createRoundState();
    s.rounds.round = 10;
    const boss = zombie.spawnZombie(s, { x: 300, y: 300 }, { kind: 'boss' });
    initPowerups(s);
    applyPowerup(s, 'instaKill');
    applyPowerup(s, 'nuke');
    assert.ok(BOSS.nukeFrac > BOSS.maxHitFrac);
    assert.ok(Math.abs(boss.hp - boss.maxHp * (1 - BOSS.nukeFrac)) < 1e-6);
  });
