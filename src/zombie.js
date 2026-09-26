// zombie.js (Agent D) - pure logic: zombie stats, spawning, behavior state machine, damage/death.
// Contract: WORK_ORDER.md 3.5 (Zombie shape), 3.6 (API), 5.5 (behavior).
// No DOM access. All randomness via state.rng.

import { ZOMBIE, TILE, BOSS } from './config.js';
import { emit } from './events.js';
import { nextId, dist, norm, clamp } from './math.js';
import { tearBoard, barricadeOpen, resolveCircle, isWalkable, inArena } from './map.js';
import { getFlowDir } from './pathfinding.js';
import { damagePlayer } from './player.js';

// Tunables live in config.js ZOMBIE block (moved by integrator).
export const HIT_FLASH = ZOMBIE.hitFlash;             // seconds, per 5.5
const SPEED_JITTER = ZOMBIE.speedJitter;              // +-10% per 5.5
const WANDER_MIN = ZOMBIE.wanderMin, WANDER_MAX = ZOMBIE.wanderMax; // seconds between wander picks
const WANDER_SPEED_MULT = ZOMBIE.wanderSpeedMult;     // wandering zombies shamble at half speed
const BLOOD_HIT_TTL = ZOMBIE.bloodHitTtl;             // small splat per hit
const BLOOD_DEATH_TTL = ZOMBIE.bloodDeathTtl;         // death decal lingers longer than the corpse

// Tile type codes from map 5.1: 2 = window, 3 = spawn pocket.
const TILE_WINDOW = 2, TILE_POCKET = 3;

// Tier table from 5.5: [minRound, {walk, jog, sprint}] - first match from the top wins.
const TIER_TABLE = [
  [12, { walk: 0.00, jog: 0.25, sprint: 0.75 }],
  [8,  { walk: 0.10, jog: 0.40, sprint: 0.50 }],
  [5,  { walk: 0.30, jog: 0.50, sprint: 0.20 }],
  [3,  { walk: 0.70, jog: 0.30, sprint: 0.00 }],
  [1,  { walk: 1.00, jog: 0.00, sprint: 0.00 }],
];

// ---------------------------------------------------------------------------
// Stats per round
// ---------------------------------------------------------------------------

// WO5: `difficulty` is state.level.difficulty ({ healthMult, speedMult, countMult, sprintShift });
// absent -> level-1 values (health x1). The result is rounded when a multiplier applies.
export function healthForRound(round, difficulty) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  let hp;
  if (r <= ZOMBIE.roundsLinear) hp = ZOMBIE.baseHealth + ZOMBIE.healthPerRound * (r - 1);
  else {
    const atLinearEnd = ZOMBIE.baseHealth + ZOMBIE.healthPerRound * (ZOMBIE.roundsLinear - 1); // 950
    hp = Math.round(atLinearEnd * Math.pow(ZOMBIE.healthMultAfter, r - ZOMBIE.roundsLinear));
  }
  const m = difficultyOf(difficulty).healthMult;
  return m === 1 ? hp : Math.round(hp * m);
}

// WO5 1.3 difficulty with safe defaults. Accepts a difficulty object or null/undefined.
const DEFAULT_DIFFICULTY = Object.freeze({ healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 });
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
export function difficultyOf(d) {
  if (!d || typeof d !== 'object') return DEFAULT_DIFFICULTY;
  return {
    healthMult: num(d.healthMult, 1) > 0 ? num(d.healthMult, 1) : 1,
    speedMult: num(d.speedMult, 1) > 0 ? num(d.speedMult, 1) : 1,
    countMult: num(d.countMult, 1) > 0 ? num(d.countMult, 1) : 1,
    sprintShift: num(d.sprintShift, 0),
  };
}
function stateDifficulty(state) {
  return difficultyOf(state && state.level ? state.level.difficulty : null);
}

// WO5 1.2: boss max HP = baseHealth x healthMult x (1 + roundScale x round).
// FIX-2 (balance #4): the round factor stops growing at BOSS.roundScaleCap (12); past that the
// boss grows through the level's healthMult only.
export function bossHealthFor(round, difficulty) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  const cap = Number.isFinite(BOSS.roundScaleCap) ? BOSS.roundScaleCap : Infinity;
  return Math.round(BOSS.baseHealth * difficultyOf(difficulty).healthMult * (1 + BOSS.roundScale * Math.min(r, cap)));
}

// FIX-2 (balance #5): minion HP = BOSS.minion.health (300) x level healthMult (no round scaling).
// Falls back to the old healthFrac-of-round rule if the config key is missing.
export function minionHealthFor(round, difficulty) {
  const M = BOSS.minion;
  if (Number.isFinite(M.health)) return Math.max(1, Math.round(M.health * difficultyOf(difficulty).healthMult));
  return Math.max(1, Math.round(healthForRound(round, difficulty) * M.healthFrac));
}

// FIX-2 (balance #3): speed caps applied after every multiplier and the jitter.
export function maxSpeedFor(kind) {
  const cap = Number.isFinite(ZOMBIE.maxSpeed) ? ZOMBIE.maxSpeed : Infinity;
  if (kind === 'minion') return cap * (Number.isFinite(BOSS.minion.maxSpeedMult) ? BOSS.minion.maxSpeedMult : 1);
  if (kind === 'boss') return Infinity;
  return cap;
}

// FIX-2 (review M1, balance #7/#8): damage one hit deals to the boss.
//   - Fractional effects (Nuke, cause 'nuke'; Thundergun near share, passed as exactly
//     thunderNearFrac x maxHp or as Infinity) use their own fraction: no cap, no Insta-Kill bonus.
//   - Everything else: x BOSS.instaKillMult while Insta-Kill is active, then capped at
//     BOSS.maxHitFrac x maxHp.
export function bossHitDamage(amount, maxHp, cause, instaKill) {
  let dmg = Math.max(0, Number(amount));
  if (Number.isNaN(dmg)) dmg = 0;
  const thunder = BOSS.thunderNearFrac * maxHp;
  if (!Number.isFinite(dmg)) return thunder;
  if (cause === 'nuke') return dmg;
  if (Math.abs(dmg - thunder) <= 1e-9 * Math.max(1, maxHp)) return dmg;
  if (instaKill) dmg *= Number.isFinite(BOSS.instaKillMult) ? BOSS.instaKillMult : 1;
  if (Number.isFinite(BOSS.maxHitFrac)) dmg = Math.min(dmg, BOSS.maxHitFrac * maxHp);
  return dmg;
}

// WO5: kind helpers (weapons.js uses isBoss for the Thundergun rules).
export function isBoss(z) { return !!z && z.kind === 'boss'; }
export function isMinion(z) { return !!z && z.kind === 'minion'; }

export function tierForRound(round, rng) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  let d = TIER_TABLE[TIER_TABLE.length - 1][1];
  for (const [minRound, table] of TIER_TABLE) {
    if (r >= minRound) { d = table; break; }
  }
  const roll = rng && typeof rng.next === 'function' ? rng.next() : 0;
  if (roll < d.walk) return 'walk';
  if (roll < d.walk + d.jog) return 'jog';
  return 'sprint';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Reads the power-up slice directly per contract 3.5
// (state.powerups.active[type] = absolute expiry time). Semantics match powerups.isActive,
// but avoids a hard dependency so damage logic stays testable in isolation.
function powerupActive(state, type) {
  const active = state && state.powerups && state.powerups.active;
  const exp = active ? active[type] : undefined;
  return exp != null && exp > (state.time || 0);
}

function pushShake(state, ttl, magnitude) {
  if (!state || !Array.isArray(state.effects)) return;
  state.effects.push({ type: 'shake', ttl, maxTtl: ttl, magnitude });
}

function pushBlood(state, x, y, big) {
  if (!state || !Array.isArray(state.effects)) return;
  const ttl = big ? BLOOD_DEATH_TTL : BLOOD_HIT_TTL;
  state.effects.push({ type: 'blood', x, y, ttl, maxTtl: ttl, radius: big ? 18 : 7, big: !!big });
}

function tileTypeAt(map, x, y) {
  if (!map || !map.tiles || !map.cols) return -1;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return -1;
  return map.tiles[ty * map.cols + tx];
}

function isAlive(z) { return z.mode !== 'dying' && !z._killed; }

// WO7 downed-player rule: zombies (every kind) never start an attack on, or deal damage to, a
// player who is down, in the Quick Revive pause (downT > 0) or invulnerable after a revive
// (invulnT > 0). They keep chasing.
export function playerTargetable(p) {
  return !!p && !p.down && !(p.downT > 0) && !(p.invulnT > 0);
}

// WO7: boss ability from the level def ('charge' default | 'acid'); unknown values -> 'charge'.
export function bossAbilityOf(state, opts) {
  const o = opts && opts.ability;
  const def = state && state.level && state.level.def && state.level.def.boss;
  const a = o || (def && def.ability);
  return a === 'acid' ? 'acid' : 'charge';
}

// WO5: reach grows/shrinks with the body (boss radius 34, minion 10); a normal zombie keeps
// exactly ZOMBIE.attackRange.
function inAttackRange(z, p) {
  const reach = ZOMBIE.attackRange + ((z.radius || ZOMBIE.radius) - ZOMBIE.radius);
  return !!p && dist(z.x, z.y, p.x, p.y) <= reach + p.radius;
}

// Min centre distance kept between two zombies (normal pair = separationMinDist, scaled by size).
function pairMinDist(a, b) {
  return ZOMBIE.separationMinDist * ((a.radius || ZOMBIE.radius) + (b.radius || ZOMBIE.radius)) / (2 * ZOMBIE.radius);
}

function isOutsideTile(t) { return t === TILE_POCKET || t === TILE_WINDOW; }

// Deterministic direction for two exactly stacked zombies (angle derived from both ids),
// so stacked spawns fan out instead of all sliding along +x into the same wall.
// Returns the direction to push `a` away from `b` (antisymmetric in a/b).
function stackDir(a, b) {
  const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
  const ang = (lo * 2.399963 + hi * 0.7853982) % (Math.PI * 2);
  const s = a.id > b.id ? 1 : -1;
  return { x: Math.cos(ang) * s, y: Math.sin(ang) * s };
}

// Steering separation (velocity, px/s). The summed vector is capped at separationForce so a
// heavily stacked pocket cannot fling a zombie (review.md #2).
function separation(state, z) {
  let sx = 0, sy = 0;
  if (z.kind === 'boss') return { x: 0, y: 0 }; // WO5: the boss shoulders through its minions
  const R = ZOMBIE.separationRadius, F = ZOMBIE.separationForce;
  for (const o of state.zombies) {
    if (o === z || !isAlive(o)) continue;
    const dx = z.x - o.x, dy = z.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-6) {
      const u = stackDir(z, o);
      sx += u.x * F; sy += u.y * F;
      continue;
    }
    const f = F * (1 - d / R);
    sx += (dx / d) * f; sy += (dy / d) * f;
  }
  const m = Math.hypot(sx, sy);
  if (m > F) { const k = F / m; sx *= k; sy *= k; }
  return { x: sx, y: sy };
}

// Place a zombie at nx,ny, then keep it out of walls (map.resolveCircle) and inside the map.
function settle(state, z, nx, ny) {
  const map = state.map;
  if (map) {
    const r = resolveCircle(map, nx, ny, z.radius, true);
    nx = r.x; ny = r.y;
    if (map.width > 0 && map.height > 0) {
      nx = clamp(nx, z.radius, map.width - z.radius);
      ny = clamp(ny, z.radius, map.height - z.radius);
    }
  }
  if (Number.isFinite(nx) && Number.isFinite(ny)) { z.x = nx; z.y = ny; }
}

function moveAndCollide(state, z, vx, vy, dt) {
  z.vx = vx; z.vy = vy;
  settle(state, z, z.x + vx * dt, z.y + vy * dt);
}

function pickWanderDir(state, z) {
  const a = state.rng.range(0, Math.PI * 2);
  z.wanderX = Math.cos(a); z.wanderY = Math.sin(a);
  z.wanderT = state.rng.range(WANDER_MIN, WANDER_MAX);
}

// Pocket tile -> barricade id (review.md #1). Built once per map object from map.spawnPoints
// (a window spawn point sits on its pocket tile; spawn ids 1-8 == barricade ids), falling back
// to any barricade 4-adjacent to a pocket tile. Cached in a WeakMap so the Map shape is untouched.
const pocketCache = new WeakMap();
function pocketIndex(map) {
  let idx = pocketCache.get(map);
  if (idx) return idx;
  idx = new Map();
  for (const sp of map.spawnPoints || []) {
    if (sp.barricadeId == null) continue;
    const tx = Math.floor(sp.x / TILE), ty = Math.floor(sp.y / TILE);
    idx.set(ty * map.cols + tx, sp.barricadeId);
  }
  for (const b of map.barricades || []) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = b.tx + dx, ty = b.ty + dy;
      if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) continue;
      const k = ty * map.cols + tx;
      if (map.tiles[k] === TILE_POCKET && !idx.has(k)) idx.set(k, b.id);
    }
  }
  pocketCache.set(map, idx);
  return idx;
}

function barricadeForPocket(map, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const id = pocketIndex(map).get(ty * map.cols + tx);
  return id == null ? null : id;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

// WO5 3.2: opts.kind 'normal' (default) | 'minion' | 'boss'. Difficulty comes from
// state.level.difficulty (health x healthMult, speed x speedMult, tier roll at round + sprintShift);
// the zombie count is waves.js's job. opts.name / opts.tint override the boss's level-def values.
// Per-zombie combat stats (damage, attackWindup, attackCooldown) are stored on the zombie.
export function spawnZombie(state, spawnPoint, opts = {}) {
  const kind = opts && (opts.kind === 'boss' || opts.kind === 'minion') ? opts.kind : 'normal';
  const round = (state.rounds && state.rounds.round) || 1;
  const diff = stateDifficulty(state);
  const sp = spawnPoint || { x: 0, y: 0 };
  let hp, tier, speed, radius, damage, windup, cooldown;
  if (kind === 'boss') {
    hp = bossHealthFor(round, diff);
    tier = 'walk';
    speed = BOSS.speed * diff.speedMult;
    radius = BOSS.radius; damage = BOSS.damage; windup = BOSS.attackWindup; cooldown = BOSS.attackCooldown;
  } else if (kind === 'minion') {
    const M = BOSS.minion;
    hp = minionHealthFor(round, diff);
    tier = 'sprint';
    speed = ZOMBIE.speeds.sprint * M.speedMult * diff.speedMult * state.rng.range(1 - SPEED_JITTER, 1 + SPEED_JITTER);
    speed = Math.min(speed, maxSpeedFor('minion'));
    radius = M.radius; damage = M.damage; windup = ZOMBIE.attackWindup; cooldown = M.attackCooldown;
  } else {
    hp = healthForRound(round, diff);
    tier = tierForRound(round + diff.sprintShift, state.rng);
    speed = ZOMBIE.speeds[tier] * diff.speedMult * state.rng.range(1 - SPEED_JITTER, 1 + SPEED_JITTER);
    speed = Math.min(speed, maxSpeedFor('normal'));
    radius = ZOMBIE.radius; damage = ZOMBIE.damage; windup = ZOMBIE.attackWindup; cooldown = ZOMBIE.attackCooldown;
  }
  // Minions and the boss spawn inside the arena: never tearing, never tied to a window.
  const barricadeId = kind === 'normal' && sp.barricadeId != null ? sp.barricadeId : null;
  const z = {
    id: nextId(),
    kind,
    x: sp.x, y: sp.y,
    radius,
    hp, maxHp: hp,
    tier, speed,
    damage, attackWindup: windup, attackCooldown: cooldown,
    // Window spawns always start tearing; the first update flips them to chasing if the
    // barricade is already open (keeps spawn free of map calls).
    mode: barricadeId == null ? 'chasing' : 'tearing',
    spawnPointId: sp.id == null ? null : sp.id,
    barricadeId,
    tearTimer: 0, attackTimer: 0, attackCd: 0, dyingT: 0,
    vx: 0, vy: 0, hitFlash: 0,
    // Extra (non-contract) fields, documented in docs/notes/zombie.md:
    inside: barricadeId == null, // false while standing on a pocket/window tile (recomputed every frame)
    tearOwner: false,            // true while this zombie holds its barricade's single tear slot
    wanderT: 0, wanderX: 0, wanderY: 0,
    // WO2 3.10 knockback (Thundergun): knock velocity, stun seconds left, knock direction.
    kvx: 0, kvy: 0, stun: 0, knockAngle: 0,
  };
  if (kind === 'boss') {
    const def = state.level && state.level.def && state.level.def.boss;
    z.name = (opts && opts.name) || (def && def.name) || 'THE WARDEN';
    z.tint = (opts && opts.tint) || (def && def.tint) || '#7a1f1f';
    z.charge = { timer: BOSS.chargeEvery, phase: 'idle', dx: 0, dy: 0, t: 0 };
    z.summonTimer = BOSS.summonEvery;
    // WO7: per-level ability. An acid boss keeps an idle z.charge (render-safe) but never charges.
    z.ability = bossAbilityOf(state, opts);
    if (z.ability === 'acid') z.acid = { timer: acidCfg().every, phase: 'idle', t: 0 };
  }
  state.zombies.push(z);
  emit('zombie:spawned', { zombie: z, kind });
  return z;
}

// ---------------------------------------------------------------------------
// Damage / death
// ---------------------------------------------------------------------------

// Returns true if this call killed the zombie.
export function damageZombie(state, z, amount, cause = 'weapon', x, y) {
  if (!z || !isAlive(z)) return false;
  const hx = x == null ? z.x : x, hy = y == null ? z.y : y;
  let dmg = Math.max(0, Number(amount) || 0);
  const hpBefore = Number.isFinite(z.hp) ? z.hp : 0;
  if (z.kind === 'boss') {
    // WO5 1.2 + FIX-2: nothing one-shots the boss. A non-finite hit (Thundergun near-cone kill)
    // becomes thunderNearFrac of max HP; other hits are x instaKillMult under Insta-Kill and capped
    // at maxHitFrac of max HP (see bossHitDamage).
    const maxHp = Number.isFinite(z.maxHp) && z.maxHp > 0 ? z.maxHp : hpBefore;
    dmg = bossHitDamage(amount, maxHp, cause, powerupActive(state, 'instaKill'));
  } else if (powerupActive(state, 'instaKill')) dmg = Math.max(dmg, z.hp);
  // WO2: Thundergun near-cone kills pass Infinity. Report the hp actually removed and never
  // leave a non-finite hp behind.
  if (!Number.isFinite(dmg)) dmg = Math.max(0, hpBefore);
  z.hp = hpBefore - dmg;
  z.hitFlash = HIT_FLASH;
  pushBlood(state, hx, hy, false);
  emit('zombie:hit', { zombie: z, amount: dmg, x: hx, y: hy });
  if (z.hp <= 0) return killZombie(state, z, cause);
  return false;
}

// Emits zombie:killed exactly once per zombie. Returns true if it killed, false if already dead.
// Does NOT award points (player.js listens to zombie:killed).
export function killZombie(state, z, cause = 'weapon') {
  if (!z || !isAlive(z)) return false;
  z._killed = true;
  if (!(z.hp <= 0)) z.hp = 0; // also catches NaN
  z.mode = 'dying';
  z.dyingT = z.kind === 'boss' ? BOSS.deathLinger : ZOMBIE.deathLinger;
  z.vx = 0; z.vy = 0;
  z.attackTimer = 0;
  z.tearOwner = false;
  z.kvx = 0; z.kvy = 0; z.stun = 0;
  if (z.charge) { z.charge.phase = 'idle'; z.charge.t = 0; }
  if (z.acid) { z.acid.phase = 'idle'; z.acid.t = 0; }
  pushBlood(state, z.x, z.y, true);
  if (z.kind === 'boss' && state && Array.isArray(state.effects)) {
    // WO5: bigger pool + flash for the 2 s boss death.
    state.effects.push({ type: 'blood', x: z.x, y: z.y, ttl: BLOOD_DEATH_TTL * 2, maxTtl: BLOOD_DEATH_TTL * 2, radius: 44, big: true, boss: true });
    state.effects.push({ type: 'flash', ttl: 0.3, maxTtl: 0.3 });
    pushShake(state, 0.6, 10);
  }
  emit('zombie:killed', { zombie: z, cause, x: z.x, y: z.y, kind: z.kind || 'normal' });
  return true;
}

// ---------------------------------------------------------------------------
// Knockback (WO2 3.10)
// ---------------------------------------------------------------------------

// Sets the knock velocity (replacing any previous one) and extends the stun. Ignored for dying
// zombies and for tearing zombies (they stay in their pocket). Interrupts an attack wind-up.
// Returns true if the knockback was applied.
// WO5: the boss is immune to stun. Its knock is an instant displacement of
// min(|v| / knockFriction, BOSS.thunderNearKnock) px along (vx, vy) (the distance a normal zombie
// would slide, capped); no stun, no wind-up cancel, charge state untouched. Use pushZombie for an
// exact distance (Thundergun: near 60 px, far 40 px).
export function applyKnockback(state, z, vx, vy, stunSeconds) {
  if (!z || !isAlive(z) || z.mode === 'tearing') return false;
  vx = Number(vx); vy = Number(vy);
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  if (z.kind === 'boss') {
    const v = Math.hypot(vx, vy);
    if (!(v > 0)) return false;
    const d = Math.min(v / (ZOMBIE.knockFriction || 1), BOSS.thunderNearKnock);
    return pushZombie(state, z, (vx / v) * d, (vy / v) * d);
  }
  const st = Number(stunSeconds);
  // A knock needs a positive, finite stun: updateStunned is what decays and clears kvx/kvy, so a
  // velocity set without a stun would persist forever. Reject it without touching the zombie.
  if (!(Number.isFinite(st) && st > 0)) return false;
  z.kvx = vx; z.kvy = vy;
  z.stun = Math.max(Number.isFinite(z.stun) ? z.stun : 0, st);
  if (vx || vy) z.knockAngle = Math.atan2(vy, vx);
  z.attackTimer = 0;
  return true;
}

// WO5: instant displacement by (dx, dy) px with wall collision (map.resolveCircle) and bounds
// clamp. No stun. Works for every kind; the Thundergun uses it for the boss. Returns true if moved.
export function pushZombie(state, z, dx, dy) {
  if (!z || !isAlive(z) || z.mode === 'tearing') return false;
  dx = Number(dx); dy = Number(dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return false;
  // Step in chunks no longer than half a tile so a push cannot tunnel through a wall.
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (TILE / 2)));
  for (let i = 0; i < steps; i++) settle(state, z, z.x + dx / steps, z.y + dy / steps);
  z.knockAngle = Math.atan2(dy, dx);
  return true;
}

// One frame of a stunned zombie: slide with exponential friction, stop at walls, count the stun
// down, then resume the previous mode (attacking -> chasing). No AI, no attacks, no tearing.
function updateStunned(state, z, dt) {
  const k = ZOMBIE.knockFriction;
  const decay = Math.exp(-k * dt);
  // Exact integral of v(t) = v0 * e^(-k t) over dt, so the slide distance is frame-rate independent.
  const f = k > 0 ? (1 - decay) / k : dt;
  let kvx = z.kvx || 0, kvy = z.kvy || 0;
  const sep = separation(state, z);
  const ix = z.x + kvx * f + sep.x * dt, iy = z.y + kvy * f + sep.y * dt;
  settle(state, z, ix, iy);
  // Wall contact: drop the velocity component pointing into whatever pushed us back.
  const cx = z.x - ix, cy = z.y - iy;
  const c = Math.hypot(cx, cy);
  if (c > 1e-6) {
    const nx = cx / c, ny = cy / c;
    const dot = kvx * nx + kvy * ny;
    if (dot < 0) { kvx -= nx * dot; kvy -= ny * dot; }
  }
  kvx *= decay; kvy *= decay;
  if (Math.hypot(kvx, kvy) < ZOMBIE.stunMinSpeed) { kvx = 0; kvy = 0; }
  z.kvx = kvx; z.kvy = kvy;
  z.vx = kvx; z.vy = kvy;
  z.stun -= dt;
  if (z.stun <= 0) {
    z.stun = 0; z.kvx = 0; z.kvy = 0; z.vx = 0; z.vy = 0;
    if (z.mode === 'attacking') { z.mode = 'chasing'; z.attackTimer = 0; }
  }
}

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

// owners: Map barricadeId -> zombie holding that window's tear slot (playtest.md #2: one tearer
// per window; the rest queue in the pocket and take over when it gets through or dies).
function updateTearing(state, z, dt, owners) {
  if (z.barricadeId == null || !state.map || barricadeOpen(state.map, z.barricadeId)) {
    z.mode = 'chasing';
    z.tearTimer = 0;
    z.tearOwner = false;
    return;
  }
  const owner = owners.get(z.barricadeId);
  if (!owner || owner === z) {
    if (!owner) { owners.set(z.barricadeId, z); z.tearOwner = true; }
    z.tearTimer += dt;
    while (z.tearTimer >= ZOMBIE.boardTearTime) {
      z.tearTimer -= ZOMBIE.boardTearTime;
      tearBoard(state.map, z.barricadeId);
      if (barricadeOpen(state.map, z.barricadeId)) {
        z.mode = 'chasing'; z.tearTimer = 0; z.tearOwner = false;
        break;
      }
    }
  } else {
    // Queued behind the current tearer: wait in the pocket; the tear clock starts on takeover.
    z.tearTimer = 0;
    z.tearOwner = false;
  }
  // Stay in the pocket but do not stack on top of other tearers.
  const sep = separation(state, z);
  if (sep.x || sep.y) moveAndCollide(state, z, sep.x, sep.y, dt);
  else { z.vx = 0; z.vy = 0; }
}

function updateChasing(state, z, dt) {
  const p = state.player;
  if (playerTargetable(p) && inAttackRange(z, p)) {
    z.mode = 'attacking';
    z.attackTimer = z.attackCd <= 0 ? windupOf(z) : 0;
    z.vx = 0; z.vy = 0;
    return;
  }
  let dir = state.flow ? getFlowDir(state.flow, z.x, z.y) : { x: 0, y: 0 };
  if (!(dir.x || dir.y) && p) {
    // No flow (not built yet, or on the player's own tile): head straight for the player.
    dir = norm(p.x - z.x, p.y - z.y);
  }
  // Do not push into the player's body.
  let speed = z.speed;
  if (p && dist(z.x, z.y, p.x, p.y) <= z.radius + p.radius) speed = 0;
  const sep = separation(state, z);
  const v = blockByContacts(state, z, dir.x * speed, dir.y * speed);
  moveAndCollide(state, z, v.x + sep.x, v.y + sep.y, dt);
}

// Crowd contact (playtest.md #1): a chasing zombie does not advance into a zombie it is already
// touching; the velocity component toward each in-contact neighbour is removed, so zombies
// behind the front ring slide around it or wait instead of compressing the crowd.
function blockByContacts(state, z, vx, vy) {
  if (!z.inside || z.kind === 'boss') return { x: vx, y: vy };
  for (const o of state.zombies) {
    if (o === z || !o.inside || !isAlive(o)) continue;
    const reach = pairMinDist(z, o) + 2;
    const dx = o.x - z.x, dy = o.y - z.y;
    if (dx >= reach || dx <= -reach || dy >= reach || dy <= -reach) continue;
    const d = Math.hypot(dx, dy);
    if (d >= reach || d < 1e-6) continue;
    const nx = dx / d, ny = dy / d;
    const dot = vx * nx + vy * ny;
    if (dot > 0) { vx -= nx * dot; vy -= ny * dot; }
  }
  return { x: vx, y: vy };
}

function updateAttacking(state, z, dt) {
  const p = state.player;
  z.vx = 0; z.vy = 0;
  // WO7: a downed / reviving / invulnerable player cancels any swing (no damage) and the zombie
  // goes back to chasing.
  if (!playerTargetable(p)) { z.mode = 'chasing'; z.attackTimer = 0; return; }
  // Attackers keep their spacing too (playtest.md #1), so a crowd forms a ring, not a blob.
  const sep = separation(state, z);
  if (sep.x || sep.y) { moveAndCollide(state, z, sep.x, sep.y, dt); z.vx = 0; z.vy = 0; }
  if (z.attackTimer > 0) {
    // Winding up: the swing always completes, but only lands if still in range.
    z.attackTimer -= dt;
    if (z.attackTimer <= 0) {
      z.attackTimer = 0;
      if (inAttackRange(z, p)) damagePlayer(state, z.damage > 0 ? z.damage : ZOMBIE.damage);
      z.attackCd = z.attackCooldown > 0 ? z.attackCooldown : ZOMBIE.attackCooldown;
    }
    return;
  }
  if (!inAttackRange(z, p)) { z.mode = 'chasing'; return; }
  if (z.attackCd <= 0) z.attackTimer = windupOf(z);
}

function windupOf(z) { return z.attackWindup > 0 ? z.attackWindup : ZOMBIE.attackWindup; }

// ---------------------------------------------------------------------------
// WO5 boss AI: charge state machine idle -> telegraph -> dash -> recover -> idle.
// ---------------------------------------------------------------------------

// Returns true when the charge state machine owns this frame (the normal AI is skipped).
function updateBossCharge(state, z, dt) {
  const c = z.charge || (z.charge = { timer: BOSS.chargeEvery, phase: 'idle', dx: 0, dy: 0, t: 0 });
  const p = state.player;
  if (c.phase === 'idle') {
    if (c.timer > 0) c.timer -= dt;
    // Never interrupt a swing that is already winding up.
    const busy = z.mode === 'attacking' && z.attackTimer > 0;
    if (c.timer <= 0 && playerTargetable(p) && !busy) {
      c.phase = 'telegraph'; c.t = 0; c.dx = 0; c.dy = 0;
      z.mode = 'chasing'; z.attackTimer = 0; z.vx = 0; z.vy = 0;
      emit('boss:charge', { x: z.x, y: z.y });
      return true;
    }
    return false;
  }
  c.t += dt;
  if (c.phase === 'telegraph') {
    z.vx = 0; z.vy = 0;
    if (c.t >= BOSS.chargeTelegraph) {
      // Aim at where the player is when the telegraph ends.
      let d = p ? norm(p.x - z.x, p.y - z.y) : { x: 0, y: 0 };
      if (!(d.x || d.y)) d = { x: Math.cos(z.knockAngle || 0), y: Math.sin(z.knockAngle || 0) };
      c.dx = d.x; c.dy = d.y;
      c.phase = 'dash'; c.t = 0; c.hit = false;
    }
    return true;
  }
  if (c.phase === 'dash') {
    const sp = z.speed * BOSS.chargeSpeedMult;
    const step = sp * dt;
    z.vx = c.dx * sp; z.vy = c.dy * sp;
    // Sub-step so a fast dash cannot skip through a thin wall or past the player.
    const n = Math.max(1, Math.ceil(step / (TILE / 4)));
    let blocked = false;
    for (let i = 0; i < n; i++) {
      const bx = z.x, by = z.y;
      settle(state, z, bx + (c.dx * step) / n, by + (c.dy * step) / n);
      // Progress along the dash direction this sub-step; a wall eats most of it.
      const prog = (z.x - bx) * c.dx + (z.y - by) * c.dy;
      if (prog < (step / n) * 0.5) { blocked = true; break; }
      if (playerTargetable(p) && dist(z.x, z.y, p.x, p.y) <= z.radius + p.radius + 2) {
        chargeHitPlayer(state, z, c);
        return true;
      }
    }
    if (playerTargetable(p) && !c.hit && dist(z.x, z.y, p.x, p.y) <= z.radius + p.radius + 2) {
      chargeHitPlayer(state, z, c);
      return true;
    }
    if (blocked) {
      c.phase = 'recover'; c.t = 0; c.wall = true;
      z.vx = 0; z.vy = 0;
      pushShake(state, 0.35, 8);
      return true;
    }
    if (c.t >= BOSS.chargeMaxTime) {
      c.phase = 'recover'; c.t = 0; c.wall = false;
      z.vx = 0; z.vy = 0;
    }
    return true;
  }
  if (c.phase === 'recover') {
    z.vx = 0; z.vy = 0;
    if (c.t >= BOSS.chargeRecover) {
      c.phase = 'idle'; c.t = 0; c.timer = BOSS.chargeEvery; c.wall = false;
    }
    return true;
  }
  c.phase = 'idle';
  return false;
}

// Dash contact: damage + knock the player chargeKnockback px along the dash (wall-safe via
// map.resolveCircle), shake, then recover.
function chargeHitPlayer(state, z, c) {
  const p = state.player;
  c.hit = true;
  damagePlayer(state, BOSS.damage);
  const k = BOSS.chargeKnockback;
  const steps = Math.max(1, Math.ceil(k / (TILE / 2)));
  for (let i = 0; i < steps; i++) {
    let nx = p.x + (c.dx * k) / steps, ny = p.y + (c.dy * k) / steps;
    if (state.map) {
      const r = resolveCircle(state.map, nx, ny, p.radius || 14);
      nx = r.x; ny = r.y;
    }
    if (Number.isFinite(nx) && Number.isFinite(ny)) { p.x = nx; p.y = ny; }
  }
  pushShake(state, 0.4, 10);
  c.phase = 'recover'; c.t = 0; c.wall = false;
  z.vx = 0; z.vy = 0;
  z.attackCd = Math.max(z.attackCd || 0, z.attackCooldown || BOSS.attackCooldown);
}

// ---------------------------------------------------------------------------
// WO7 acid boss (THE SUBJECT): idle (hunt + melee) -> telegraph (still, boss:spit) -> lob globs.
// ---------------------------------------------------------------------------

const ACID_DEFAULTS = { every: 6, telegraph: 0.5, globs: 3, spread: 0.44, flight: 0.8, poolRadius: 50, poolSeconds: 5, dps: 25 };
export function acidCfg() { return { ...ACID_DEFAULTS, ...(BOSS.acid || {}) }; }

// Returns true while the telegraph owns the frame (normal AI skipped).
function updateBossAcid(state, z, dt) {
  const A = acidCfg();
  const a = z.acid || (z.acid = { timer: A.every, phase: 'idle', t: 0 });
  const p = state.player;
  if (a.phase === 'idle') {
    if (a.timer > 0) a.timer -= dt;
    const busy = z.mode === 'attacking' && z.attackTimer > 0;
    if (a.timer <= 0 && playerTargetable(p) && !busy) {
      a.phase = 'telegraph'; a.t = 0;
      z.mode = 'chasing'; z.attackTimer = 0; z.vx = 0; z.vy = 0;
      emit('boss:spit', { x: z.x, y: z.y });
      return true;
    }
    return false;
  }
  if (a.phase === 'telegraph') {
    a.t += dt;
    z.vx = 0; z.vy = 0;
    if (a.t >= A.telegraph) {
      if (p) lobAcid(state, z, p.x, p.y, A);
      a.phase = 'idle'; a.t = 0; a.timer = A.every;
    }
    return true;
  }
  a.phase = 'idle';
  return false;
}

// Pushes A.globs acid globs into state.acidGlobs (NOT state.bullets: weapons.updateBullets would
// treat them as ray-gun projectiles and detonate them on zombies). Glob i flies toward the
// player's position rotated by an even fan over [-spread, +spread] around the boss, at the
// player's distance, and lands exactly at (tx, ty) after A.flight seconds (arc is visual only).
// WO7 FIX-5 (playtest #4): an acid target on a walkable floor tile (inside `arena` when it is a
// Set of tile keys) is kept as is; otherwise it snaps to the centre of the nearest such tile
// (Euclidean from the intended point). Falls back to the player's position (px, py) if none.
export function acidLandingPoint(m, arena, x, y, px, py) {
  const ok = (tx, ty) => isWalkable(m, tx, ty, false) && (!arena || arena.has(ty * m.cols + tx));
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  if (ok(cx, cy)) return { x, y };
  let best = null, bestD = Infinity;
  const consider = (tx, ty) => {
    const wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
    const d = (wx - x) * (wx - x) + (wy - y) * (wy - y);
    if (d < bestD) { bestD = d; best = { x: wx, y: wy }; }
  };
  if (arena) {
    for (const k of arena) {
      const tx = k % m.cols, ty = (k - tx) / m.cols;
      if (ok(tx, ty)) consider(tx, ty);
    }
  } else {
    // Ring search; a ring at Chebyshev radius r is >= (r - 1) tiles away, so stop once past best.
    const maxR = Math.max(m.cols, m.rows);
    for (let r = 1; r <= maxR; r++) {
      if (best && (r - 1) * TILE > Math.sqrt(bestD)) break;
      for (let ty = cy - r; ty <= cy + r; ty++) {
        for (let tx = cx - r; tx <= cx + r; tx++) {
          if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
          if (ok(tx, ty)) consider(tx, ty);
        }
      }
    }
  }
  if (best) return best;
  return (Number.isFinite(px) && Number.isFinite(py)) ? { x: px, y: py } : { x, y };
}

export function lobAcid(state, z, px, py, A = acidCfg()) {
  if (!state || !z) return [];
  if (!Array.isArray(state.acidGlobs)) state.acidGlobs = [];
  const n = Math.max(1, Math.floor(A.globs) || 1);
  let d = Math.hypot(px - z.x, py - z.y);
  const base = d > 1e-6 ? Math.atan2(py - z.y, px - z.x) : (z.knockAngle || 0);
  if (!(d > 1e-6)) d = 0;
  const flight = A.flight > 0 ? A.flight : 0.8;
  const m = state.map;
  // Landing set: the arena floor while the boss stands in the arena, else any walkable tile
  // (null). undefined = no usable tile grid (bare test maps), targets are left as computed.
  const arena = (m && m.tiles && m.cols > 0 && m.rows > 0)
    ? ((m.arenaTiles && m.arenaTiles.size && inArena(m, z.x, z.y)) ? m.arenaTiles : null)
    : undefined;
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : -A.spread + (2 * A.spread * i) / (n - 1);
    let tx = z.x + Math.cos(base + off) * d, ty = z.y + Math.sin(base + off) * d;
    if (m && m.width > 0 && m.height > 0) { tx = clamp(tx, 0, m.width); ty = clamp(ty, 0, m.height); }
    // WO7 FIX-5 (playtest #4): land on reachable floor, never on a pillar or past the arena wall.
    if (arena !== undefined) ({ x: tx, y: ty } = acidLandingPoint(m, arena, tx, ty, px, py));
    const g = {
      id: nextId(), kind: 'acid', x: z.x, y: z.y, sx: z.x, sy: z.y, tx, ty,
      vx: (tx - z.x) / flight, vy: (ty - z.y) / flight, ttl: flight, maxTtl: flight,
      r: A.poolRadius, poolTtl: A.poolSeconds, dps: A.dps,
    };
    state.acidGlobs.push(g);
    out.push(g);
  }
  return out;
}

function updateWandering(state, z, dt) {
  z.wanderT -= dt;
  if (z.wanderT <= 0) pickWanderDir(state, z);
  const s = z.speed * WANDER_SPEED_MULT;
  const sep = separation(state, z);
  const ox = z.x, oy = z.y;
  const t0 = tileTypeAt(state.map, ox, oy);
  moveAndCollide(state, z, z.wanderX * s + sep.x, z.wanderY * s + sep.y, dt);
  // Wanderers in the play area never step back into a window or spawn pocket (review.md #1).
  if (t0 !== -1 && !isOutsideTile(t0) && isOutsideTile(tileTypeAt(state.map, z.x, z.y))) {
    z.x = ox; z.y = oy; z.vx = 0; z.vy = 0;
    pickWanderDir(state, z);
  }
}

// Positional overlap resolution between zombies in the play area (playtest.md #1).
// Runs after all movement: pairs closer than separationMinDist are pushed apart (half each),
// zombies are pushed out of the player's body, each zombie's displacement per pass is capped at
// separationMaxPush (review.md #2), and every moved zombie is re-settled with map.resolveCircle
// plus a map-bounds clamp. Zombies on pocket/window tiles are excluded: a pocket is one tile and
// its queue is handled by the (capped) steering separation instead.
function resolveOverlaps(state) {
  const list = [];
  for (const z of state.zombies) if (isAlive(z) && z.inside) list.push(z);
  const n = list.length;
  if (n === 0) return;
  const p = state.player;
  const maxPush = ZOMBIE.separationMaxPush;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let iter = 0; iter < ZOMBIE.separationIters; iter++) {
    px.fill(0); py.fill(0);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        const minD = pairMinDist(a, b);
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx >= minD || dx <= -minD || dy >= minD || dy <= -minD) continue;
        const d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        let ux, uy;
        if (d < 1e-6) { const u = stackDir(b, a); ux = u.x; uy = u.y; } else { ux = dx / d; uy = dy / d; }
        // Split the push by mass (radius^2): equal bodies move half each, a minion yields to the
        // boss almost entirely.
        const ma = (a.radius || ZOMBIE.radius) ** 2, mb = (b.radius || ZOMBIE.radius) ** 2;
        const over = minD - d;
        const ha = over * mb / (ma + mb), hb = over * ma / (ma + mb);
        px[i] -= ux * ha; py[i] -= uy * ha;
        px[j] += ux * hb; py[j] += uy * hb;
        any = true;
      }
      if (p) {
        const dx = a.x - p.x, dy = a.y - p.y;
        const need = a.radius + p.radius;
        const d = Math.hypot(dx, dy);
        if (d < need && d > 1e-6) {
          px[i] += (dx / d) * (need - d); py[i] += (dy / d) * (need - d);
          any = true;
        }
      }
    }
    if (!any) break;
    for (let i = 0; i < n; i++) {
      let mx = px[i], my = py[i];
      if (!mx && !my) continue;
      const m = Math.hypot(mx, my);
      if (m > maxPush) { mx *= maxPush / m; my *= maxPush / m; }
      settle(state, list[i], list[i].x + mx, list[i].y + my);
    }
  }
}

export function updateZombies(state, dt) {
  const zs = state.zombies;
  const blood = powerupActive(state, 'zombieBlood');
  const map = state.map;

  // Current tear-slot holders (at most one per barricade).
  const owners = new Map();
  for (const z of zs) {
    if (!z.tearOwner) continue;
    if (isAlive(z) && z.mode === 'tearing' && z.barricadeId != null && !owners.has(z.barricadeId)) {
      owners.set(z.barricadeId, z);
    } else z.tearOwner = false;
  }

  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.hitFlash > 0) z.hitFlash = Math.max(0, z.hitFlash - dt);
    if (z.mode === 'dying') { z.dyingT -= dt; continue; }
    if (z.attackCd > 0) z.attackCd = Math.max(0, z.attackCd - dt);

    // Stunned (knocked back): slide only. The pocket check below runs from the next frame on,
    // so a zombie knocked through an open window into a pocket tears only if the window is
    // boarded again, like any other zombie standing in a pocket.
    if (z.kind === 'boss') { z.stun = 0; z.kvx = 0; z.kvy = 0; }
    if (z.stun > 0) {
      if (z.mode === 'tearing') { z.stun = 0; z.kvx = 0; z.kvy = 0; }
      else {
        updateStunned(state, z, dt);
        const ts = tileTypeAt(map, z.x, z.y);
        if (ts !== -1) z.inside = !isOutsideTile(ts);
        continue;
      }
    }

    const special = z.kind === 'boss' || z.kind === 'minion';
    if (special) {
      // WO5: minions and the boss live in the arena: no pocket logic, never tearing, no stun.
      z.inside = true;
      if (z.mode === 'tearing') { z.mode = 'chasing'; z.tearTimer = 0; }
      if (z.kind === 'boss') {
        if (z.ability === 'acid' ? updateBossAcid(state, z, dt) : updateBossCharge(state, z, dt)) continue;
        // Zombie Blood does not fool the boss.
        if (z.mode === 'wandering') z.mode = 'chasing';
        switch (z.mode) {
          case 'attacking': updateAttacking(state, z, dt); break;
          default: z.mode = 'chasing'; updateChasing(state, z, dt); break;
        }
        continue;
      }
    }

    const t = special ? -1 : tileTypeAt(map, z.x, z.y);
    if (t !== -1) z.inside = !isOutsideTile(t);

    // Any zombie standing in a spawn pocket whose barricade has boards tears that barricade,
    // whatever its mode, z.inside or z.barricadeId (review.md #1: a re-entered pocket used to
    // soft-lock the round). The barricade is looked up from the pocket tile itself.
    if (t === TILE_POCKET) {
      const bid = barricadeForPocket(map, z.x, z.y);
      if (bid != null && bid !== z.barricadeId) {
        if (z.tearOwner && owners.get(z.barricadeId) === z) owners.delete(z.barricadeId);
        z.barricadeId = bid; z.tearOwner = false; z.tearTimer = 0;
      }
      if (bid != null && z.mode !== 'tearing' && !barricadeOpen(map, bid)) {
        z.mode = 'tearing'; z.tearTimer = 0; z.attackTimer = 0; z.vx = 0; z.vy = 0;
      }
    }

    // Zombie Blood: chasing/attacking zombies lose track of the player.
    // Tearing zombies keep tearing (they are outside the play area anyway).
    if (blood && (z.mode === 'chasing' || z.mode === 'attacking')) {
      z.mode = 'wandering'; z.attackTimer = 0; z.wanderT = 0;
    } else if (!blood && z.mode === 'wandering') {
      z.mode = 'chasing';
    }

    switch (z.mode) {
      case 'tearing': updateTearing(state, z, dt, owners); break;
      case 'chasing': updateChasing(state, z, dt); break;
      case 'attacking': updateAttacking(state, z, dt); break;
      case 'wandering': updateWandering(state, z, dt); break;
      default: z.mode = 'chasing'; break;
    }
    if (z.mode !== 'tearing' && z.tearOwner) {
      if (owners.get(z.barricadeId) === z) owners.delete(z.barricadeId);
      z.tearOwner = false;
    }
  }

  resolveOverlaps(state);

  // Remove corpses whose linger has elapsed (in place, preserving order).
  let w = 0;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.mode === 'dying' && z.dyingT <= 0) continue;
    zs[w++] = z;
  }
  zs.length = w;
}
