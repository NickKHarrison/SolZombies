// boss.js — boss fight state machine (pure, no DOM). WO5 3.2 (Agent C).
//
// Flow: idle -> (player enters the arena through the open, unsealed mega door) startFight ->
// active (summon waves, watch the boss zombie) -> boss dies -> finishFight -> defeated.
//
// Points (Phase 0 decision, docs/notes/wo5-scaffold.md #2): the boss's zombie:killed carries the
// real cause ('weapon', 'explosion', 'nuke', ...), so player.js pays POINTS.perKill (10) as for any
// zombie; finishFight() then awards BOSS.points - POINTS.perKill (190) via player.addPoints, for a
// total of BOSS.points (200). Leftover minions are killed with cause 'debug' (no points, no drops).
//
// Siblings (map, zombie, player, powerups, waves) are imported as namespaces and called lazily
// inside functions, guarded with typeof checks (they may be mid-rewrite in Phase 1).
import { BOSS, POINTS, TILE } from './config.js';
import * as events from './events.js';
import * as zombie from './zombie.js';
import * as mapMod from './map.js';
import * as player from './player.js';
import * as powerups from './powerups.js';
import * as waves from './waves.js';

const fn = (mod, name) => (mod && typeof mod[name] === 'function' ? mod[name] : null);

export function createBossState() {
  return {
    phase: 'idle',        // 'idle' | 'active' | 'defeated'
    bossId: null,         // id of the live boss zombie
    name: '',
    hp: 0,
    maxHp: 0,
    summonTimer: BOSS.summonEvery,
    minionsSpawned: 0,
    startedAt: 0,
    // FIX-2 (balance #6): true once the mid-fight Max Ammo (boss below BOSS.ammoDropAtFrac) dropped.
    midDrop: false,
    // Extra: last known boss position (drop point for the guaranteed Max Ammo).
    x: 0, y: 0,
  };
}

// Unsubscribers from the most recent initBoss call (re-init safe, like initPlayer/initRounds).
let unsubs = [];

// Subscribes zombie:killed (boss hp bookkeeping), round:start (nothing) and game:restart (reset).
export function initBoss(state) {
  for (const u of unsubs) u();
  unsubs = [];
  if (!state) return;
  if (!state.boss) state.boss = createBossState();
  unsubs.push(events.on('zombie:killed', (p) => {
    const b = state.boss;
    const z = p && p.zombie;
    if (!b || !z || b.bossId == null || z.id !== b.bossId) return;
    b.hp = 0;
    if (Number.isFinite(z.x) && Number.isFinite(z.y)) { b.x = z.x; b.y = z.y; }
  }));
  unsubs.push(events.on('game:restart', () => { state.boss = createBossState(); clearHazards(state); }));
}

// ---------------------------------------------------------------------------
// WO7 acid hazards (THE SUBJECT). Globs live in state.acidGlobs (zombie.lobAcid pushes them;
// kept out of state.bullets because weapons.updateBullets would detonate them on zombies).
// Glob: { id, kind: 'acid', x, y, sx, sy, tx, ty, vx, vy, ttl, maxTtl, r, poolTtl, dps }.
// Pool: state.hazards { id, kind: 'acid', x, y, r, ttl, maxTtl, dps }.
// ---------------------------------------------------------------------------

// Map each state was last updated on: a new state.map object means a level swap -> clear.
const lastMap = new WeakMap();

export function clearHazards(state) {
  if (!state) return;
  if (Array.isArray(state.hazards)) state.hazards.length = 0; else state.hazards = [];
  if (Array.isArray(state.acidGlobs)) state.acidGlobs.length = 0; else state.acidGlobs = [];
}

function acidDefaults() {
  const A = BOSS.acid || {};
  return {
    poolRadius: Number.isFinite(A.poolRadius) ? A.poolRadius : 50,
    poolSeconds: Number.isFinite(A.poolSeconds) ? A.poolSeconds : 5,
    dps: Number.isFinite(A.dps) ? A.dps : 25,
  };
}

// Player is immune to pools while down, in the Quick Revive pause or invulnerable.
function playerHurtable(p) {
  return !!p && !p.down && !(p.downT > 0) && !(p.invulnT > 0) && !p.invulnerable;
}

// Glob flight + landing (-> pool), pool ttl, player damage dps x dt while the player's centre is
// inside a pool (overlapping pools do not stack: the highest dps applies), prune. Clears
// everything when state.map changes identity (level swap).
export function updateHazards(state, dt) {
  if (!state) return;
  if (!Array.isArray(state.hazards)) state.hazards = [];
  if (!Array.isArray(state.acidGlobs)) state.acidGlobs = [];
  const prev = lastMap.get(state);
  if (prev !== undefined && prev !== state.map) clearHazards(state);
  lastMap.set(state, state.map || null);
  dt = Number(dt);
  if (!(dt > 0)) return;
  const D = acidDefaults();

  const globs = state.acidGlobs;
  let w = 0;
  for (let i = 0; i < globs.length; i++) {
    const g = globs[i];
    g.ttl -= dt;
    if (g.ttl <= 0) {
      const ttl = Number.isFinite(g.poolTtl) ? g.poolTtl : D.poolSeconds;
      state.hazards.push({
        id: g.id, kind: 'acid',
        x: Number.isFinite(g.tx) ? g.tx : g.x, y: Number.isFinite(g.ty) ? g.ty : g.y,
        r: Number.isFinite(g.r) ? g.r : D.poolRadius,
        ttl, maxTtl: ttl, dps: Number.isFinite(g.dps) ? g.dps : D.dps,
      });
      continue;
    }
    g.x += g.vx * dt; g.y += g.vy * dt;
    globs[w++] = g;
  }
  globs.length = w;

  const hz = state.hazards;
  const p = state.player;
  let dps = 0;
  w = 0;
  for (let i = 0; i < hz.length; i++) {
    const h = hz[i];
    const live = Math.min(dt, Math.max(0, h.ttl));
    if (p && live > 0 && h.dps > 0 && Math.hypot(p.x - h.x, p.y - h.y) <= h.r) dps = Math.max(dps, h.dps * (live / dt));
    h.ttl -= dt;
    if (h.ttl > 0) hz[w++] = h;
  }
  hz.length = w;
  if (dps > 0 && playerHurtable(p)) {
    const hurt = fn(player, 'damagePlayer');
    if (hurt) hurt(state, dps * dt);
  }
}

function levelIndex(state) {
  const i = state && state.level ? Number(state.level.index) : 0;
  return Number.isFinite(i) ? i : 0;
}

// FIX-2 (balance #13): minions per wave = minionsPerWave + min(levelIndex, minionsLevelCap).
export function minionsPerWaveFor(state) {
  const cap = Number.isFinite(BOSS.minionsLevelCap) ? BOSS.minionsLevelCap : Infinity;
  return BOSS.minionsPerWave + Math.max(0, Math.min(levelIndex(state), cap));
}

function playerInArena(state) {
  const m = state.map, p = state.player;
  if (!m || !p || p.down) return false;
  const inArena = fn(mapMod, 'inArena');
  if (inArena) return !!inArena(m, p.x, p.y);
  if (m.arenaTiles && typeof m.arenaTiles.has === 'function' && m.cols) {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.cols || ty >= m.rows) return false;
    return m.arenaTiles.has(ty * m.cols + tx);
  }
  return false;
}

function findById(state, id) {
  if (id == null || !Array.isArray(state.zombies)) return null;
  for (const z of state.zombies) if (z.id === id) return z;
  return null;
}

function liveMinions(state) {
  let n = 0;
  for (const z of state.zombies || []) if (z.kind === 'minion' && !z._killed && z.mode !== 'dying') n++;
  return n;
}

export function updateBoss(state, dt) {
  if (!state) return;
  if (!state.boss) state.boss = createBossState();
  const b = state.boss;
  if (b.phase === 'idle') {
    const md = state.map && state.map.megaDoor;
    if (md && md.open && !md.sealed && playerInArena(state)) startFight(state);
    return;
  }
  if (b.phase !== 'active') return;
  const z = bossZombie(state);
  if (!z) {
    // Boss is dying (or gone): the fight is over.
    const corpse = findById(state, b.bossId);
    if (corpse) { b.x = corpse.x; b.y = corpse.y; }
    b.hp = 0;
    finishFight(state);
    return;
  }
  b.hp = z.hp; b.x = z.x; b.y = z.y;
  // FIX-2 (balance #6): one Max Ammo the first time the boss falls below ammoDropAtFrac of max HP.
  const dropFrac = Number.isFinite(BOSS.ammoDropAtFrac) ? BOSS.ammoDropAtFrac : 0;
  if (!b.midDrop && b.maxHp > 0 && z.hp < dropFrac * b.maxHp) {
    b.midDrop = true;
    const drop = fn(powerups, 'spawnPowerup');
    if (drop && state.powerups) drop(state, 'maxAmmo', z.x, z.y);
  }
  b.summonTimer -= Number(dt) || 0;
  if (b.summonTimer <= 0) {
    b.summonTimer += BOSS.summonEvery;
    if (b.summonTimer <= 0) b.summonTimer = BOSS.summonEvery;
    spawnMinions(state, minionsPerWaveFor(state));
  }
}

// Seals the mega door, suspends rounds, spawns the boss and the first minion wave.
// Returns true if the fight started.
export function startFight(state) {
  if (!state) return false;
  if (!state.boss) state.boss = createBossState();
  const b = state.boss;
  if (b.phase !== 'idle') return false;
  const m = state.map;
  const seal = fn(mapMod, 'sealMegaDoor');
  if (m && m.megaDoor) {
    if (seal) seal(m);
    else { m.megaDoor.open = false; m.megaDoor.sealed = true; }
  }
  if (state.rounds) state.rounds.suspended = true;
  const at = (m && m.bossSpawn) || (state.player ? { x: state.player.x, y: state.player.y } : { x: 0, y: 0 });
  const def = state.level && state.level.def && state.level.def.boss;
  const z = zombie.spawnZombie(state, { id: 'boss', x: at.x, y: at.y, barricadeId: null, kind: 'boss' },
    { kind: 'boss', name: def && def.name, tint: def && def.tint });
  b.phase = 'active';
  b.bossId = z.id;
  b.name = z.name;
  b.hp = z.hp;
  b.maxHp = z.maxHp;
  b.x = z.x; b.y = z.y;
  b.startedAt = state.time || 0;
  b.summonTimer = BOSS.summonEvery;
  b.minionsSpawned = 0;
  b.midDrop = false;
  // FIX-2 (balance #11): the fight starts at full health (1 HP/s regen barely matters in the arena).
  const p = state.player;
  if (p && !p.down && Number.isFinite(p.maxHealth) && p.maxHealth > 0) p.health = p.maxHealth;
  spawnMinions(state, minionsPerWaveFor(state));
  events.emit('boss:start', { name: b.name, maxHp: b.maxHp, level: levelIndex(state) });
  return true;
}

// Spawns up to n minions at random arena spawn tiles, capped at BOSS.maxMinions alive.
// Returns the number spawned.
export function spawnMinions(state, n) {
  if (!state || !Array.isArray(state.zombies)) return 0;
  const want = Math.max(0, Math.floor(Number(n) || 0));
  const room = Math.max(0, BOSS.maxMinions - liveMinions(state));
  const count = Math.min(want, room);
  if (!count) return 0;
  const m = state.map;
  let spots = (m && Array.isArray(m.arenaSpawns) && m.arenaSpawns.length) ? m.arenaSpawns : null;
  if (!spots) {
    const c = (m && m.bossSpawn) || (state.player ? { x: state.player.x, y: state.player.y } : null);
    if (!c) return 0;
    spots = [{ id: 'arena', x: c.x, y: c.y }];
  }
  for (let i = 0; i < count; i++) {
    const s = state.rng.pick(spots);
    zombie.spawnZombie(state, { id: s.id, x: s.x, y: s.y, barricadeId: null, kind: 'arena' }, { kind: 'minion' });
  }
  if (state.boss) state.boss.minionsSpawned += count;
  return count;
}

// Ends the fight: leftover minions die (cause 'debug': no points, no drops), mega door unsealed,
// stairs opened, rounds resume and the current round ends, +190 points, guaranteed Max Ammo at the
// boss position, boss:defeated. Returns true if it ran.
export function finishFight(state) {
  if (!state || !state.boss || state.boss.phase !== 'active') return false;
  const b = state.boss;
  b.phase = 'defeated';
  b.hp = 0;
  const corpse = findById(state, b.bossId);
  if (corpse) { b.x = corpse.x; b.y = corpse.y; }
  for (const z of [...(state.zombies || [])]) {
    if (z.kind === 'minion' && !z._killed && z.mode !== 'dying') zombie.killZombie(state, z, 'debug');
  }
  const m = state.map;
  if (m) {
    const unseal = fn(mapMod, 'unsealMegaDoor');
    if (m.megaDoor) {
      if (unseal) unseal(m);
      else { m.megaDoor.open = true; m.megaDoor.sealed = false; }
    }
    const stairs = fn(mapMod, 'openStairs');
    if (stairs) stairs(m);
    else if (m.stairs) m.stairs.open = true;
  }
  const r = state.rounds;
  if (r) {
    r.suspended = false;
    const end = fn(waves, 'endRoundNow');
    if (end) end(state);
    else {
      r.toSpawn = 0;
      r.alive = (state.zombies || []).filter((z) => (z.kind || 'normal') === 'normal' && !z._killed && z.mode !== 'dying').length;
    }
  }
  const add = fn(player, 'addPoints');
  if (add && state.player) add(state, BOSS.points - POINTS.perKill, b.x, b.y);
  const drop = fn(powerups, 'spawnPowerup');
  if (drop && state.powerups) drop(state, 'maxAmmo', b.x, b.y);
  events.emit('boss:defeated', { name: b.name, level: levelIndex(state) });
  return true;
}

export function bossZombie(state) {
  const b = state && state.boss;
  if (!b || b.bossId == null || !Array.isArray(state.zombies)) return null;
  for (const z of state.zombies) {
    if (z.id === b.bossId && !z._killed && z.mode !== 'dying') return z;
  }
  return null;
}

export function bossHpFrac(state) {
  const b = state && state.boss;
  if (!b || !(b.maxHp > 0)) return 0;
  const z = bossZombie(state);
  const hp = z ? z.hp : b.hp;
  return Math.max(0, Math.min(1, hp / b.maxHp));
}
