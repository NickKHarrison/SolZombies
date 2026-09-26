import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.js';
import { ROUNDS, ZOMBIE } from '../src/config.js';
import { createEmptyState } from '../src/state.js';
import {
  createRoundState, initRounds, updateRounds, zombiesForRound, pauseSpawning,
  skipToRound, pickSpawnPoint, setSpawnFunction, spawnIntervalForRound,
  endRoundNow, isRoundZombie,
} from '../src/waves.js';

// Fake spawner: emits zombie:spawned like zombie.js would.
let spawned = [];
function fakeSpawn(state, sp) {
  const zombie = { id: spawned.length + 1, spawnPointId: sp.id };
  spawned.push(zombie);
  state.zombies.push(zombie);
  events.emit('zombie:spawned', { zombie });
}

function makeState(seed = 1) {
  const s = createEmptyState(seed);
  s.phase = 'playing';
  s.player = { x: 100, y: 100, radius: 14 };
  s.map = {
    spawnPoints: [
      { id: 1, x: 150, y: 100, barricadeId: 1, kind: 'window' },     // near
      { id: 2, x: 2300, y: 1500, barricadeId: null, kind: 'open' },  // far
    ],
  };
  s.rounds = createRoundState();
  return s;
}

function setup(seed) {
  events.clearAll();
  spawned = [];
  setSpawnFunction(fakeSpawn);
  const s = makeState(seed);
  initRounds(s);
  return s;
}

function step(s, dt) { s.time += dt; s.dt = dt; updateRounds(s, dt); }

function killOne(s) {
  const z = s.zombies.shift();
  events.emit('zombie:killed', { zombie: z, cause: 'weapon', x: 0, y: 0 });
}

// NOTE: WORK_ORDER 5.6 says '33 for round 10 (+-1)', but the mandated formula yields 29
// (0.058 + 7.403 + 7.181 + 14.739 = 29.38). We follow the formula; see docs/notes/waves.md.
test('zombiesForRound matches table for 1..9 and the BO3 formula after', () => {
  for (let r = 1; r <= 9; r++) assert.equal(zombiesForRound(r), ROUNDS.earlyCounts[r - 1]);
  assert.equal(zombiesForRound(10), 29);
  assert.equal(zombiesForRound(20), 59);
  assert.ok(zombiesForRound(10) >= zombiesForRound(9));
  assert.ok(zombiesForRound(30) > zombiesForRound(20));
});

test('createRoundState initial shape', () => {
  const r = createRoundState();
  assert.equal(r.round, 0);
  assert.equal(r.phase, 'break');
  assert.equal(r.timer, ROUNDS.firstRoundDelay);
  for (const k of ['toSpawn', 'alive', 'spawnTimer', 'spawnInterval', 'pausedUntil', 'killedThisRound']) {
    assert.equal(typeof r[k], 'number', k);
  }
});

test('first break ends into round 1 and emits round:start', () => {
  const s = setup();
  const starts = [];
  events.on('round:start', (p) => starts.push(p.round));
  step(s, ROUNDS.firstRoundDelay - 0.1);
  assert.equal(s.rounds.round, 0);
  step(s, 0.2);
  assert.deepEqual(starts, [1]);
  assert.equal(s.rounds.phase, 'active');
  assert.equal(s.rounds.toSpawn, 6);
  assert.equal(s.stats.roundReached, 1);
  assert.equal(s.rounds.spawnInterval, spawnIntervalForRound(1));
  assert.equal(spawnIntervalForRound(1000), ROUNDS.spawnIntervalMin);
});

test('spawns at spawnInterval and counters track events', () => {
  const s = setup();
  step(s, ROUNDS.firstRoundDelay + 0.01); // start round
  step(s, 0.01);                          // first spawn immediately
  assert.equal(spawned.length, 1);
  assert.equal(s.rounds.alive, 1);
  assert.equal(s.rounds.toSpawn, 5);
  step(s, s.rounds.spawnInterval / 2);
  assert.equal(spawned.length, 1);
  step(s, s.rounds.spawnInterval / 2 + 0.01);
  assert.equal(spawned.length, 2);
  killOne(s);
  assert.equal(s.rounds.alive, 1);
  assert.equal(s.rounds.killedThisRound, 1);
});

test('round advances only when toSpawn and alive are both 0', () => {
  const s = setup();
  const ends = [];
  events.on('round:end', (p) => ends.push(p.round));
  step(s, ROUNDS.firstRoundDelay + 0.01);
  for (let i = 0; i < 200 && s.rounds.toSpawn > 0; i++) step(s, 0.1);
  assert.equal(s.rounds.toSpawn, 0);
  assert.equal(s.rounds.alive, 6);
  while (s.zombies.length > 1) { killOne(s); step(s, 0.1); }
  assert.equal(s.rounds.phase, 'active');
  assert.deepEqual(ends, []);
  killOne(s);
  step(s, 0.1);
  assert.deepEqual(ends, [1]);
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.rounds.timer, ROUNDS.breakSeconds);
  step(s, ROUNDS.breakSeconds + 0.01);
  assert.equal(s.rounds.round, 2);
  assert.equal(s.rounds.toSpawn, 8);
  assert.equal(s.rounds.killedThisRound, 0);
});

test('alive cap blocks spawning', () => {
  const s = setup();
  step(s, ROUNDS.firstRoundDelay + 0.01);
  s.rounds.toSpawn = 100;
  s.rounds.alive = ZOMBIE.maxAlive;
  for (let i = 0; i < 50; i++) step(s, 0.1);
  assert.equal(spawned.length, 0);
});

test('pauseSpawning defers spawning and never shortens a pause', () => {
  const s = setup();
  step(s, ROUNDS.firstRoundDelay + 0.01);
  pauseSpawning(s, 3);
  const until = s.rounds.pausedUntil;
  pauseSpawning(s, 1);
  assert.equal(s.rounds.pausedUntil, until);
  for (let i = 0; i < 29; i++) step(s, 0.1);
  assert.equal(spawned.length, 0);
  step(s, 0.2);
  assert.equal(spawned.length, 1);
});

test('skipToRound sets up the requested round', () => {
  const s = setup();
  step(s, ROUNDS.firstRoundDelay + 0.01);
  step(s, 0.01);
  skipToRound(s, 10);
  assert.equal(s.rounds.round, 9);
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.rounds.timer, 0.5);
  assert.equal(s.rounds.alive, 0);
  step(s, 0.6);
  assert.equal(s.rounds.round, 10);
  assert.equal(s.rounds.toSpawn, zombiesForRound(10));
});

test('near spawn points are picked more often (seeded)', () => {
  const s = makeState(12345);
  let near = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) if (pickSpawnPoint(s).id === 1) near++;
  const expected = ROUNDS.nearSpawnWeight / (ROUNDS.nearSpawnWeight + 1);
  assert.ok(Math.abs(near / N - expected) < 0.03, `near ratio ${near / N}`);
  // deterministic
  const a = makeState(7), b = makeState(7);
  for (let i = 0; i < 20; i++) assert.equal(pickSpawnPoint(a).id, pickSpawnPoint(b).id);
});

test('pickSpawnPoint returns null without spawn points', () => {
  const s = makeState();
  s.map.spawnPoints = [];
  assert.equal(pickSpawnPoint(s), null);
});

test('initRounds twice does not double-count; clearAll + re-init works', () => {
  const s = setup();
  initRounds(s);
  events.emit('zombie:spawned', { zombie: {} });
  assert.equal(s.rounds.alive, 1);
  events.clearAll();
  const s2 = makeState();
  initRounds(s2);
  events.emit('zombie:spawned', { zombie: {} });
  assert.equal(s2.rounds.alive, 1);
  assert.equal(s.rounds.alive, 1);
  events.emit('zombie:killed', { zombie: {} });
  events.emit('zombie:killed', { zombie: {} });
  assert.equal(s2.rounds.alive, 0); // clamped
});

// ---------------- WO4: only active spawn points (fake map, layout-independent) ----------------

test('pickSpawnPoint only picks active spawn points (activeSpawnIds)', () => {
  const s = makeState(99);
  s.map.spawnPoints.push({ id: 3, x: 900, y: 900, barricadeId: 3, kind: 'window' });
  s.map.activeSpawnIds = new Set([2, 3]);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(pickSpawnPoint(s).id);
  assert.deepEqual([...seen].sort(), [2, 3]);
  s.map.activeSpawnIds = new Set([1]);
  for (let i = 0; i < 200; i++) assert.equal(pickSpawnPoint(s).id, 1);
});

test('pickSpawnPoint falls back to all points when none are active', () => {
  const s = makeState(5);
  s.map.activeSpawnIds = new Set();
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(pickSpawnPoint(s).id);
  assert.deepEqual([...seen].sort(), [1, 2]);
});

test('fake maps without activeSpawnIds count every spawn point as active', () => {
  const s = makeState(6);
  assert.equal(s.map.activeSpawnIds, undefined);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(pickSpawnPoint(s).id);
  assert.deepEqual([...seen].sort(), [1, 2]);
});

test('updateRounds spawns only from active points', () => {
  const s = setup(11);
  s.map.activeSpawnIds = new Set([2]);
  s.rounds.phase = 'break';
  s.rounds.timer = 0;
  for (let i = 0; i < 400 && spawned.length < 5; i++) step(s, 0.1);
  assert.ok(spawned.length >= 5);
  for (const z of spawned) assert.equal(z.spawnPointId, 2);
});

// ---------------- WO5 3.3 ----------------

test('WO5: rounds.suspended freezes spawning, timers and the round-end check', () => {
  const s = setup(21);
  assert.equal(s.rounds.suspended, false);
  // break timer frozen
  s.rounds.suspended = true;
  const t0 = s.rounds.timer;
  for (let i = 0; i < 100; i++) step(s, 0.1);
  assert.equal(s.rounds.timer, t0);
  assert.equal(s.rounds.round, 0);
  // active round: no spawns, spawn timer frozen, no round:end even with toSpawn 0 / alive 0
  s.rounds.suspended = false;
  s.rounds.timer = 0;
  step(s, 0.01);
  assert.equal(s.rounds.phase, 'active');
  const n = spawned.length;
  s.rounds.suspended = true;
  s.rounds.spawnTimer = 1;
  for (let i = 0; i < 100; i++) step(s, 0.1);
  assert.equal(spawned.length, n);
  assert.equal(s.rounds.spawnTimer, 1);
  const ends = [];
  events.on('round:end', (p) => ends.push(p));
  s.rounds.toSpawn = 0;
  while (s.zombies.length) killOne(s);
  step(s, 0.1);
  assert.equal(ends.length, 0);
  assert.equal(s.rounds.phase, 'active');
  s.rounds.suspended = false;
  step(s, 0.1);
  assert.equal(ends.length, 1);
});

test('WO5: zombiesForRound applies ceil(base * countMult)', () => {
  for (const r of [1, 2, 5, 9, 10, 20]) {
    const base = zombiesForRound(r);
    assert.equal(zombiesForRound(r, undefined), base);
    assert.equal(zombiesForRound(r, { countMult: 1 }), base);
    assert.equal(zombiesForRound(r, { countMult: 1.25 }), Math.ceil(base * 1.25));
  }
  assert.equal(zombiesForRound(1, { countMult: 1.25 }), Math.ceil(ROUNDS.earlyCounts[0] * 1.25));
  assert.equal(zombiesForRound(10, { countMult: 1.25 }), 37); // ceil(29 * 1.25) = ceil(36.25)
  assert.equal(zombiesForRound(10, { countMult: 2 }), 58);   // exact product stays exact
  assert.equal(zombiesForRound(10, { countMult: NaN }), 29);
});

test('WO5: round start reads countMult from state.level.difficulty', () => {
  const s = setup(22);
  s.level = { index: 1, loop: 0, difficulty: { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 } };
  s.rounds.timer = 0;
  step(s, 0.01);
  assert.equal(s.rounds.round, 1);
  assert.equal(s.rounds.toSpawn + spawned.length, Math.ceil(ROUNDS.earlyCounts[0] * 1.25));
});

test('WO5: boss and minions never touch alive / killedThisRound', () => {
  const s = setup(23);
  assert.equal(isRoundZombie(undefined), true);
  assert.equal(isRoundZombie({}), true);
  assert.equal(isRoundZombie({ kind: 'normal' }), true);
  assert.equal(isRoundZombie({ kind: 'boss' }), false);
  assert.equal(isRoundZombie({ kind: 'minion' }), false);
  const boss = { id: 90, kind: 'boss' };
  const minion = { id: 91, kind: 'minion' };
  const normal = { id: 92, kind: 'normal' };
  for (const zombie of [boss, minion, normal]) events.emit('zombie:spawned', { zombie });
  assert.equal(s.rounds.alive, 1);
  events.emit('zombie:killed', { zombie: minion, cause: 'weapon' });
  events.emit('zombie:killed', { zombie: boss, cause: 'weapon' });
  assert.equal(s.rounds.alive, 1);
  assert.equal(s.rounds.killedThisRound, 0);
  events.emit('zombie:killed', { zombie: normal, cause: 'weapon' });
  assert.equal(s.rounds.alive, 0);
  assert.equal(s.rounds.killedThisRound, 1);
});

test('WO5: endRoundNow ends an active round when no normal zombie is alive', () => {
  const s = setup(24);
  const ends = [];
  events.on('round:end', (p) => ends.push(p));
  s.rounds.phase = 'active';
  s.rounds.round = 4;
  s.rounds.toSpawn = 7;
  s.rounds.alive = 3; // stale count
  s.zombies = [
    { kind: 'boss', mode: 'dying', _killed: true },
    { kind: 'minion', mode: 'chasing' },
    { kind: 'normal', mode: 'dying', _killed: true },
  ];
  assert.equal(endRoundNow(s), true);
  assert.equal(s.rounds.toSpawn, 0);
  assert.equal(s.rounds.alive, 0);
  assert.deepEqual(ends, [{ round: 4 }]);
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.rounds.timer, ROUNDS.breakSeconds);
});

test('WO5: endRoundNow with live normal zombies waits for them, then updateRounds ends it', () => {
  const s = setup(25);
  const ends = [];
  events.on('round:end', (p) => ends.push(p));
  s.rounds.phase = 'active';
  s.rounds.round = 2;
  s.rounds.toSpawn = 5;
  s.zombies = [{ id: 1, mode: 'chasing' }, { id: 2, kind: 'normal', mode: 'tearing' }];
  assert.equal(endRoundNow(s), false);
  assert.equal(s.rounds.toSpawn, 0);
  assert.equal(s.rounds.alive, 2);
  assert.equal(ends.length, 0);
  killOne(s); killOne(s);
  step(s, 0.1);
  assert.deepEqual(ends, [{ round: 2 }]);
});

test('WO5: endRoundNow during a break emits nothing', () => {
  const s = setup(26);
  const ends = [];
  events.on('round:end', (p) => ends.push(p));
  s.rounds.phase = 'break';
  s.rounds.timer = 3;
  assert.equal(endRoundNow(s), false);
  assert.equal(ends.length, 0);
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.rounds.timer, 3);
  assert.equal(endRoundNow({}), false);
});

test('WO5: the default spawner is called with kind normal', () => {
  const s = setup(27);
  const calls = [];
  setSpawnFunction((st, sp, opts) => { calls.push(opts); });
  s.rounds.timer = 0;
  step(s, 0.01);
  step(s, 0.01);
  assert.ok(calls.length >= 1);
  for (const o of calls) assert.deepEqual(o, { kind: 'normal' });
  setSpawnFunction(fakeSpawn);
});
