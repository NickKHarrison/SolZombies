// WO5 3.2 boss fight tests (Agent C). Fake maps and state only: layout independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS, POINTS, TILE, ZOMBIE } from '../src/config.js';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as player from '../src/player.js';
import * as waves from '../src/waves.js';
import * as powerups from '../src/powerups.js';
import * as zombie from '../src/zombie.js';
import {
  createBossState, initBoss, updateBoss, startFight, spawnMinions, finishFight, bossZombie, bossHpFrac,
} from '../src/boss.js';
import * as bossMod from '../src/boss.js';

const COLS = 16, ROWS = 12;

// Open walled room; every floor tile is "arena". Mega door / stairs have no tiles so any real
// map.sealMegaDoor / openStairs implementation only flips flags.
function arenaMap() {
  const tiles = new Uint8Array(COLS * ROWS);
  const arenaTiles = new Set();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const wall = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      tiles[y * COLS + x] = wall ? 1 : 0;
      if (!wall) arenaTiles.add(y * COLS + x);
    }
  }
  return {
    cols: COLS, rows: ROWS, width: COLS * TILE, height: ROWS * TILE, tiles, walls: [], version: 0,
    barricades: [], spawnPoints: [], wallBuys: [], doors: [], box: null,
    playerStart: { x: 2.5 * TILE, y: 2.5 * TILE },
    megaDoor: { id: 'mega', cost: 250, open: true, sealed: false, tiles: [], x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0, axis: 'h' },
    bossSpawn: { x: 8.5 * TILE, y: 6.5 * TILE },
    arenaSpawns: [
      { id: 'x1', x: 2.5 * TILE, y: 2.5 * TILE }, { id: 'x2', x: 13.5 * TILE, y: 2.5 * TILE },
      { id: 'x3', x: 2.5 * TILE, y: 9.5 * TILE }, { id: 'x4', x: 13.5 * TILE, y: 9.5 * TILE },
    ],
    arenaTiles,
    stairs: { tiles: [], x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0, open: false },
  };
}

function fresh(seed = 1, { round = 1, difficulty, index = 0 } = {}) {
  events.clearAll();
  const s = createEmptyState(seed);
  s.phase = 'playing';
  s.map = arenaMap();
  s.player = player.createPlayer(1.5 * TILE, 6.5 * TILE);
  s.rounds = waves.createRoundState();
  s.rounds.round = round;
  s.rounds.phase = 'active';
  s.level = { index, loop: 0, def: { boss: { name: 'THE WARDEN', tint: '#7a1f1f' } }, name: 'BUNKER',
    difficulty: difficulty || { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 } };
  player.initPlayer(s);
  powerups.initPowerups(s);
  initBoss(s);
  return s;
}

function record(name) {
  const out = [];
  events.on(name, (p) => out.push(p));
  return out;
}

const minions = (s) => s.zombies.filter((z) => z.kind === 'minion' && !z._killed);

test('createBossState shape', () => {
  const b = createBossState();
  assert.equal(b.phase, 'idle');
  assert.equal(b.bossId, null);
  assert.equal(b.summonTimer, BOSS.summonEvery);
  assert.equal(b.minionsSpawned, 0);
});

test('fight starts only when the player enters the arena through the open, unsealed mega door', () => {
  const s = fresh();
  const starts = record('boss:start');
  s.map.megaDoor.open = false;
  s.player.x = 8.5 * TILE; s.player.y = 3.5 * TILE;
  updateBoss(s, 1 / 60);
  assert.equal(s.boss.phase, 'idle', 'door closed: no fight');
  s.map.megaDoor.open = true;
  s.player.x = -100; // outside the arena
  updateBoss(s, 1 / 60);
  assert.equal(s.boss.phase, 'idle', 'player outside the arena');
  s.player.x = 8.5 * TILE;
  updateBoss(s, 1 / 60);
  assert.equal(s.boss.phase, 'active');
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0], { name: 'THE WARDEN', maxHp: s.boss.maxHp, level: 0 });
  assert.equal(s.map.megaDoor.sealed, true);
  assert.equal(s.map.megaDoor.open, false);
  assert.equal(s.rounds.suspended, true);
  const bz = bossZombie(s);
  assert.ok(bz && bz.kind === 'boss');
  assert.equal(bz.x, s.map.bossSpawn.x);
  assert.equal(bz.name, 'THE WARDEN');
  assert.equal(minions(s).length, BOSS.minionsPerWave, 'first wave at fight start');
  assert.equal(startFight(s), false, 'cannot start twice');
});

test('boss stats scale with level difficulty and round', () => {
  const s1 = fresh(1, { round: 1 });
  startFight(s1);
  assert.equal(bossZombie(s1).maxHp, Math.round(BOSS.baseHealth * (1 + 0.12 * 1)));
  const s2 = fresh(1, { round: 10, difficulty: { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 }, index: 1 });
  startFight(s2);
  const bz = bossZombie(s2);
  assert.equal(bz.maxHp, Math.round(BOSS.baseHealth * 1.5 * (1 + 0.12 * 10)));
  assert.equal(s2.boss.maxHp, bz.maxHp);
  assert.ok(Math.abs(bz.speed - BOSS.speed * 1.1) < 1e-9);
  assert.equal(bz.radius, BOSS.radius);
  assert.equal(minions(s2).length, BOSS.minionsPerWave + 1, 'levelIndex adds minions per wave');
  assert.equal(bossHpFrac(s2), 1);
  bz.hp = bz.maxHp / 4;
  assert.equal(bossHpFrac(s2), 0.25);
});

test('summon every summonEvery seconds, capped at maxMinions alive', () => {
  const s = fresh(3);
  startFight(s);
  assert.equal(minions(s).length, 4);
  updateBoss(s, BOSS.summonEvery - 0.01);
  assert.equal(minions(s).length, 4);
  updateBoss(s, 0.02);
  assert.equal(minions(s).length, 8);
  updateBoss(s, BOSS.summonEvery);
  assert.equal(minions(s).length, BOSS.maxMinions, 'cap');
  updateBoss(s, BOSS.summonEvery);
  assert.equal(minions(s).length, BOSS.maxMinions);
  assert.equal(spawnMinions(s, 5), 0);
  assert.equal(s.boss.minionsSpawned, BOSS.maxMinions);
  // every minion spawned on an arena spawn tile
  const spots = new Set(s.map.arenaSpawns.map((p) => `${p.x},${p.y}`));
  assert.ok(minions(s).every((m) => spots.has(`${m.x},${m.y}`)));
});

test('finishFight: minions die for free, door unsealed, stairs open, rounds resume, 200 points total, max ammo drop', () => {
  const s = fresh(5);
  startFight(s);
  const bz = bossZombie(s);
  const defeated = record('boss:defeated');
  const killed = record('zombie:killed');
  const pts0 = s.player.points;
  zombie.damageZombie(s, bz, Infinity, 'weapon'); // becomes thunderNearFrac, not lethal
  assert.ok(bz.hp > 0);
  zombie.killZombie(s, bz, 'weapon');
  assert.equal(bz.dyingT, BOSS.deathLinger);
  assert.equal(bossZombie(s), null);
  updateBoss(s, 1 / 60);
  assert.equal(s.boss.phase, 'defeated');
  assert.equal(defeated.length, 1);
  assert.deepEqual(defeated[0], { name: 'THE WARDEN', level: 0 });
  assert.equal(minions(s).length, 0);
  const minionKills = killed.filter((k) => k.kind === 'minion');
  assert.equal(minionKills.length, BOSS.minionsPerWave);
  assert.ok(minionKills.every((k) => k.cause === 'debug'));
  assert.equal(s.player.points - pts0, BOSS.points, 'perKill (player.js) + points - perKill (boss.js)');
  assert.equal(s.map.megaDoor.sealed, false);
  assert.equal(s.map.megaDoor.open, true);
  assert.equal(s.map.stairs.open, true);
  assert.equal(s.rounds.suspended, false);
  assert.equal(s.rounds.toSpawn, 0);
  const ammo = s.powerups.items.filter((i) => i.type === 'maxAmmo');
  assert.equal(s.powerups.items.length, 1, 'boss drops exactly one item');
  assert.equal(ammo.length, 1);
  assert.equal(ammo[0].x, bz.x);
  assert.equal(ammo[0].y, bz.y);
  assert.equal(finishFight(s), false, 'runs once');
  // boss corpse lingers 2 s
  zombie.updateZombies(s, BOSS.deathLinger - 0.1);
  assert.ok(s.zombies.includes(bz));
  zombie.updateZombies(s, 0.2);
  assert.ok(!s.zombies.includes(bz));
});

test('initBoss is re-init safe (no duplicate listeners) and game:restart resets', () => {
  const s = fresh(6);
  initBoss(s);
  initBoss(s);
  startFight(s);
  const bz = bossZombie(s);
  s.boss.hp = 123;
  zombie.killZombie(s, bz, 'weapon');
  assert.equal(s.boss.hp, 0);
  updateBoss(s, 0.01);
  const pts = s.player.points;
  assert.equal(pts, BOSS.points, 'finishFight paid once');
  events.emit('game:restart', {});
  assert.equal(s.boss.phase, 'idle');
  assert.equal(s.boss.bossId, null);
});

test('boss nuke: 10 % damage, not queued; minions queued', () => {
  const s = fresh(7);
  startFight(s);
  const bz = bossZombie(s);
  powerups.applyPowerup(s, 'nuke');
  assert.ok(Math.abs(bz.hp - bz.maxHp * (1 - BOSS.nukeFrac)) < 1e-6);
  assert.ok(!s.powerups.nuke.queue.includes(bz.id));
  assert.equal(s.powerups.nuke.queue.length, BOSS.minionsPerWave);
  for (let i = 0; i < 20; i++) powerups.updatePowerups(s, 0.1);
  assert.equal(minions(s).length, 0);
  assert.ok(!bz._killed);
});

// ---------------------------------------------------------------------------
// WO5 FIX-2 balance rules (docs/qa/wo5-balance.md #6, #11, #13)
// ---------------------------------------------------------------------------

test('FIX-2: one Max Ammo drops the first time the boss falls below ammoDropAtFrac', () => {
  const s = fresh(21);
  startFight(s);
  const bz = bossZombie(s);
  const ammo = () => s.powerups.items.filter((i) => i.type === 'maxAmmo').length;
  bz.hp = bz.maxHp * BOSS.ammoDropAtFrac + 1;
  updateBoss(s, 1 / 60);
  assert.equal(ammo(), 0, 'not yet');
  bz.hp = bz.maxHp * BOSS.ammoDropAtFrac - 1;
  updateBoss(s, 1 / 60);
  assert.equal(ammo(), 1, 'dropped at < 50 %');
  assert.equal(s.powerups.items[0].x, bz.x);
  assert.equal(s.boss.midDrop, true);
  bz.hp = bz.maxHp * 0.2;
  updateBoss(s, 1 / 60);
  assert.equal(ammo(), 1, 'only once');
  zombie.killZombie(s, bz, 'weapon');
  updateBoss(s, 1 / 60);
  assert.equal(ammo(), 2, 'plus the guaranteed death drop');
  events.emit('game:restart', {});
  assert.equal(s.boss.midDrop, false);
});

test('FIX-2: the player is healed to full when the fight starts', () => {
  const s = fresh(22);
  s.player.health = 40;
  startFight(s);
  assert.equal(s.player.health, s.player.maxHealth);
});

test('FIX-2: extra minions per wave above base capped at minionsLevelCap (+2)', () => {
  assert.equal(BOSS.minionsLevelCap, 2);
  for (const [index, want] of [[0, 4], [1, 5], [2, 6], [3, 6], [6, 6]]) {
    const s = fresh(23 + index, { index });
    startFight(s);
    assert.equal(s.zombies.filter((z) => z.kind === 'minion').length, BOSS.minionsPerWave + Math.min(index, 2), `level ${index}`);
    assert.equal(s.zombies.filter((z) => z.kind === 'minion').length, want);
  }
});

// ---------------------------------------------------------------------------
// WO7 (Agent H): acid hazards
// ---------------------------------------------------------------------------

const pool = (s, x, y, extra = {}) => {
  const h = { id: 900 + s.hazards.length, kind: 'acid', x, y, r: BOSS.acid.poolRadius, ttl: BOSS.acid.poolSeconds,
    maxTtl: BOSS.acid.poolSeconds, dps: BOSS.acid.dps, ...extra };
  s.hazards.push(h);
  return h;
};

test('WO7 startFight on an acid level spawns an acid boss', () => {
  const s = fresh(31);
  s.level.def.boss = { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' };
  startFight(s);
  const z = bossZombie(s);
  assert.equal(z.ability, 'acid');
  assert.equal(z.name, 'THE SUBJECT');
});

test('WO7 updateHazards: glob flies, lands at its target and becomes a pool', () => {
  const s = fresh(32);
  const z = zombie.spawnZombie(s, { x: 4 * TILE, y: 6 * TILE }, { kind: 'boss' });
  zombie.lobAcid(s, z, 10 * TILE, 6 * TILE);
  assert.equal(s.acidGlobs.length, BOSS.acid.globs);
  const dt = 1 / 60;
  let t = 0;
  bossMod.updateHazards(s, dt); t += dt;
  const g = s.acidGlobs[0];
  assert.ok(g.x !== 4 * TILE || g.y !== 6 * TILE, 'globs move');
  while (s.acidGlobs.length && t < 3) { bossMod.updateHazards(s, dt); t += dt; }
  assert.ok(Math.abs(t - BOSS.acid.flight) < 2 * dt, `flight ${t}`);
  assert.equal(s.hazards.length, BOSS.acid.globs);
  const centre = s.hazards.find((h) => Math.abs(h.x - 10 * TILE) < 1e-6 && Math.abs(h.y - 6 * TILE) < 1e-6);
  assert.ok(centre, 'centre pool at the aimed point');
  for (const h of s.hazards) {
    assert.equal(h.kind, 'acid');
    assert.equal(h.r, BOSS.acid.poolRadius);
    assert.equal(h.maxTtl, BOSS.acid.poolSeconds);
    assert.equal(h.dps, BOSS.acid.dps);
  }
});

test('WO7 pool deals dps per second to a player inside, nothing outside; expires after poolSeconds', () => {
  const s = fresh(33);
  s.player.x = 5 * TILE; s.player.y = 5 * TILE;
  s.player.health = 150;
  pool(s, 5 * TILE + 20, 5 * TILE);
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) bossMod.updateHazards(s, dt);
  assert.ok(Math.abs(150 - s.player.health - BOSS.acid.dps) < 1e-6, `lost ${150 - s.player.health}`);
  s.player.x = 12 * TILE;
  const h0 = s.player.health;
  for (let i = 0; i < 60; i++) bossMod.updateHazards(s, dt);
  assert.equal(s.player.health, h0, 'outside the pool: no damage');
  for (let t = 2; t < BOSS.acid.poolSeconds + 0.1; t += dt) bossMod.updateHazards(s, dt);
  assert.equal(s.hazards.length, 0, 'pool pruned');
});

test('WO7 overlapping pools do not stack; pools never hurt zombies', () => {
  const s = fresh(34);
  s.player.x = 5 * TILE; s.player.y = 5 * TILE;
  pool(s, 5 * TILE, 5 * TILE); pool(s, 5 * TILE + 10, 5 * TILE);
  const z = zombie.spawnZombie(s, { x: 5 * TILE, y: 5 * TILE + 5 }, { kind: 'minion' });
  const hp = z.hp;
  for (let i = 0; i < 60; i++) bossMod.updateHazards(s, 1 / 60);
  assert.ok(Math.abs(150 - s.player.health - BOSS.acid.dps) < 1e-6);
  assert.equal(z.hp, hp);
});

test('WO7 pools respect invulnT, downT and a downed player', () => {
  for (const setup of [(p) => { p.invulnT = 1; }, (p) => { p.downT = 1; }, (p) => { p.down = true; }]) {
    const s = fresh(35);
    s.player.x = 5 * TILE; s.player.y = 5 * TILE;
    setup(s.player);
    const dmg = record('player:damaged');
    pool(s, 5 * TILE, 5 * TILE);
    for (let i = 0; i < 30; i++) bossMod.updateHazards(s, 1 / 60);
    assert.equal(s.player.health, 150);
    assert.equal(dmg.length, 0);
    assert.equal(s.hazards.length, 1, 'pool still ticks down');
  }
});

test('WO7 hazards and globs clear on level change (state.map swap) and on game:restart', () => {
  const s = fresh(36);
  s.player.x = 12 * TILE;
  pool(s, 5 * TILE, 5 * TILE);
  s.acidGlobs = [{ id: 1, kind: 'acid', x: 0, y: 0, tx: 10, ty: 10, vx: 1, vy: 1, ttl: 0.8, maxTtl: 0.8 }];
  bossMod.updateHazards(s, 1 / 60);
  assert.equal(s.hazards.length, 1);
  s.map = arenaMap();
  bossMod.updateHazards(s, 1 / 60);
  assert.equal(s.hazards.length, 0);
  assert.equal(s.acidGlobs.length, 0);
  pool(s, 5 * TILE, 5 * TILE);
  s.acidGlobs.push({ id: 2, kind: 'acid', x: 0, y: 0, tx: 10, ty: 10, vx: 1, vy: 1, ttl: 0.8, maxTtl: 0.8 });
  events.emit('game:restart', {});
  assert.equal(s.hazards.length, 0);
  assert.equal(s.acidGlobs.length, 0);
  bossMod.updateHazards(s, 0); // tolerates dt 0 and missing arrays
  delete s.hazards; delete s.acidGlobs;
  bossMod.updateHazards(s, 1 / 60);
  assert.deepEqual(s.hazards, []);
});

// ---------------------------------------------------------------------------
// WO9 (Agent E): frost / tide bosses through a real fight
// ---------------------------------------------------------------------------

test('WO9 startFight on frost / tide levels spawns the matching boss', () => {
  for (const [ability, name] of [['frost', 'THE WENDIGO'], ['tide', 'THE DROWNED KING']]) {
    const s = fresh(60);
    s.level.def.boss = { name, tint: '#bfe8ff', ability };
    startFight(s);
    const z = bossZombie(s);
    assert.equal(z.ability, ability);
    assert.equal(z.name, name);
    assert.equal(z[ability].phase, 'idle');
  }
});

test('WO9 frost / tide bosses use their ability in a fight and never charge; the player stays sane', () => {
  for (const ability of ['frost', 'tide']) {
    const s = fresh(61);
    s.level.def.boss = { name: 'B', tint: '#ffffff', ability };
    s.player.health = s.player.maxHealth = 1e6;
    const used = record(`boss:${ability}`);
    const charges = record('boss:charge');
    startFight(s);
    const dt = 1 / 60;
    for (let t = 0; t < 20; t += dt) {
      zombie.updateZombies(s, dt);
      updateBoss(s, dt);
      player.updatePlayer(s, { moveX: 0, moveY: 0 }, null, dt);
      assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.y));
    }
    assert.ok(used.length >= 2, `${ability} used ${used.length} times`);
    assert.equal(charges.length, 0);
    const tx = Math.floor(s.player.x / TILE), ty = Math.floor(s.player.y / TILE);
    assert.ok(tx > 0 && ty > 0 && tx < COLS - 1 && ty < ROWS - 1, 'player never pushed into the wall ring');
  }
});
