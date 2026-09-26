// waves.js (Agent F) — round flow and zombie spawning. Pure logic: no DOM.
// Contract: WORK_ORDER.md 3.6 / 5.6.
import { ROUNDS, ZOMBIE } from './config.js';
import * as events from './events.js';
import { dist } from './math.js';
// WO5: namespace import so this module links while zombie.js is being rewritten.
import * as zombieMod from './zombie.js';
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
    suspended: false, // WO5: true during a boss fight (see updateRounds)
  };
}

// WO5: only kind 'normal' zombies (or zombies without a kind: pre-WO5 / test fakes) belong to
// the round. Boss and minions never touch alive / killedThisRound.
export function isRoundZombie(z) {
  return !z || z.kind === undefined || z.kind === null || z.kind === 'normal';
}

export function initRounds(state) {
  for (const u of unsubs) u();
  unsubs = [
    events.on('zombie:spawned', (p) => {
      const r = state.rounds;
      if (r && isRoundZombie(p && p.zombie)) r.alive++;
    }),
    events.on('zombie:killed', (p) => {
      const r = state.rounds;
      if (!r || !isRoundZombie(p && p.zombie)) return;
      r.alive = Math.max(0, r.alive - 1);
      r.killedThisRound++;
    }),
  ];
}

function baseZombiesForRound(round) {
  const r = Math.max(1, Math.floor(round));
  if (r <= ROUNDS.earlyCounts.length) return ROUNDS.earlyCounts[r - 1];
  return Math.round(0.000058 * r ** 3 + 0.074032 * r ** 2 + 0.718119 * r + 14.738699);
}

// WO5: ceil(base * difficulty.countMult). No difficulty (or a bad countMult) = multiplier 1.
// The 1e-9 guard stops float noise (e.g. 1.15^n products) from rounding an exact integer up.
export function zombiesForRound(round, difficulty) {
  const base = baseZombiesForRound(round);
  const m = difficulty && Number.isFinite(difficulty.countMult) && difficulty.countMult > 0
    ? difficulty.countMult : 1;
  if (m === 1) return base;
  return Math.max(1, Math.ceil(base * m - 1e-9));
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
  r.toSpawn = zombiesForRound(r.round, state.level ? state.level.difficulty : undefined);
  r.killedThisRound = 0;
  r.spawnInterval = spawnIntervalForRound(r.round);
  r.spawnTimer = 0; // first zombie appears on the first active frame
  if (state.stats) state.stats.roundReached = r.round;
  events.emit('round:start', { round: r.round });
}

export function updateRounds(state, dt) {
  const r = state.rounds;
  if (!r) return;
  // WO5 boss fight: no spawning, no round-end check, break/spawn timers frozen.
  if (r.suspended) return;

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
      const spawn = spawnImpl || zombieMod.spawnZombie;
      if (typeof spawn === 'function') spawn(state, sp, { kind: 'normal' });
      r.toSpawn--;
      r.spawnTimer = r.spawnInterval;
    }
  }

  if (r.toSpawn === 0 && r.alive === 0) endRound(state);
}

function endRound(state) {
  const r = state.rounds;
  events.emit('round:end', { round: r.round });
  r.phase = 'break';
  r.timer = ROUNDS.breakSeconds;
}

function liveRoundZombies(state) {
  let n = 0;
  for (const z of state.zombies || []) {
    if (z && !z._killed && z.mode !== 'dying' && isRoundZombie(z)) n++;
  }
  return n;
}

// WO5 3.3 (boss.finishFight): stop spawning for the current round and recount live normal
// zombies. If none are left the round ends now (round:end + break); otherwise it ends through
// updateRounds when the last one dies. No-op outside an active round (a fight that started
// during a break just lets the break continue). Returns true if the round ended here.
export function endRoundNow(state) {
  const r = state && state.rounds;
  if (!r) return false;
  r.toSpawn = 0;
  r.alive = liveRoundZombies(state);
  if (r.phase !== 'active' || r.alive > 0) return false;
  endRound(state);
  return true;
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
