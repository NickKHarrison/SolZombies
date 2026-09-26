// waves.js (Agent F) — round flow and zombie spawning. Pure logic: no DOM.
// Contract: WORK_ORDER.md 3.6 / 5.6.
import { ROUNDS, ZOMBIE } from './config.js';
import * as events from './events.js';
import { dist } from './math.js';
import { spawnZombie } from './zombie.js';
// Namespace import so this module still links while map.js is being extended (WO4 doors).
import * as mapMod from './map.js';

// Unsubscribe functions from the most recent initRounds call. Re-running initRounds
// drops the previous subscriptions first, so listeners never stack up even if the
// caller forgets events.clearAll().
let unsubs = [];

// Test hook: replaces zombie.spawnZombie for spawning (null restores the default).
let spawnImpl = null;
export function setSpawnFunction(fn) { spawnImpl = typeof fn === 'function' ? fn : null; }

export function createRoundState() {
  return {
    round: 0,
    phase: 'break',
    timer: ROUNDS.firstRoundDelay,
    toSpawn: 0,
    alive: 0,
    spawnTimer: 0,
    spawnInterval: ROUNDS.spawnIntervalStart,
    pausedUntil: 0,
    killedThisRound: 0,
  };
}

export function initRounds(state) {
  for (const u of unsubs) u();
  unsubs = [
    events.on('zombie:spawned', () => {
      const r = state.rounds;
      if (r) r.alive++;
    }),
    events.on('zombie:killed', () => {
      const r = state.rounds;
      if (!r) return;
      r.alive = Math.max(0, r.alive - 1);
      r.killedThisRound++;
    }),
  ];
}

export function zombiesForRound(round) {
  const r = Math.max(1, Math.floor(round));
  if (r <= ROUNDS.earlyCounts.length) return ROUNDS.earlyCounts[r - 1];
  return Math.round(0.000058 * r ** 3 + 0.074032 * r ** 2 + 0.718119 * r + 14.738699);
}

export function spawnIntervalForRound(round) {
  return Math.max(
    ROUNDS.spawnIntervalMin,
    ROUNDS.spawnIntervalStart * ROUNDS.spawnIntervalDecayPerRound ** (round - 1),
  );
}

// Weighted pick among state.map.spawnPoints: near (within nearSpawnRadius of the
// player) weighs nearSpawnWeight, else 1. Returns null when there are none.
// WO4: a spawn point counts only when it is active (its zone is opened, see
// map.isSpawnActive); if nothing is active, all points are used as a fallback.
export function spawnPointActive(map, sp) {
  if (!map || !sp) return true;
  if (typeof mapMod.isSpawnActive === 'function') return mapMod.isSpawnActive(map, sp.id);
  const set = map.activeSpawnIds;
  return !set || typeof set.has !== 'function' || set.has(sp.id);
}

export function pickSpawnPoint(state) {
  const all = state.map && state.map.spawnPoints;
  if (!all || all.length === 0) return null;
  let points = all;
  if (state.map.activeSpawnIds) {
    const active = all.filter((sp) => spawnPointActive(state.map, sp));
    if (active.length > 0) points = active;
  }
  const p = state.player;
  const weights = points.map((sp) =>
    p && dist(sp.x, sp.y, p.x, p.y) <= ROUNDS.nearSpawnRadius ? ROUNDS.nearSpawnWeight : 1);
  let total = 0;
  for (const w of weights) total += w;
  let roll = state.rng.next() * total;
  for (let i = 0; i < points.length; i++) {
    roll -= weights[i];
    if (roll < 0) return points[i];
  }
  return points[points.length - 1];
}

function startRound(state) {
  const r = state.rounds;
  r.round++;
  r.phase = 'active';
  r.timer = 0;
  r.toSpawn = zombiesForRound(r.round);
  r.killedThisRound = 0;
  r.spawnInterval = spawnIntervalForRound(r.round);
  r.spawnTimer = 0; // first zombie appears on the first active frame
  if (state.stats) state.stats.roundReached = r.round;
  events.emit('round:start', { round: r.round });
}

export function updateRounds(state, dt) {
  const r = state.rounds;
  if (!r) return;

  if (r.phase === 'break') {
    r.timer -= dt;
    if (r.timer <= 0) startRound(state);
    return;
  }

  // active
  if (r.spawnTimer > 0) r.spawnTimer -= dt;
  if (r.toSpawn > 0 && r.alive < ZOMBIE.maxAlive && state.time >= r.pausedUntil && r.spawnTimer <= 0) {
    const sp = pickSpawnPoint(state);
    if (sp) {
      (spawnImpl || spawnZombie)(state, sp);
      r.toSpawn--;
      r.spawnTimer = r.spawnInterval;
    }
  }

  if (r.toSpawn === 0 && r.alive === 0) {
    events.emit('round:end', { round: r.round });
    r.phase = 'break';
    r.timer = ROUNDS.breakSeconds;
  }
}

export function pauseSpawning(state, seconds) {
  const r = state.rounds;
  if (!r) return;
  r.pausedUntil = Math.max(r.pausedUntil, state.time + seconds);
}

export function skipToRound(state, round) {
  const r = state.rounds;
  if (!r) return;
  r.round = Math.max(0, Math.floor(round) - 1);
  r.toSpawn = 0;
  r.alive = 0;
  r.phase = 'break';
  r.timer = 0.5;
}
