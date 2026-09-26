// zombie.js (Agent D) - pure logic: zombie stats, spawning, behavior state machine, damage/death.
// Contract: WORK_ORDER.md 3.5 (Zombie shape), 3.6 (API), 5.5 (behavior).
// No DOM access. All randomness via state.rng.

import { ZOMBIE, TILE } from './config.js';
import { emit } from './events.js';
import { nextId, dist, norm, clamp } from './math.js';
import { tearBoard, barricadeOpen, resolveCircle } from './map.js';
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

export function healthForRound(round) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  if (r <= ZOMBIE.roundsLinear) return ZOMBIE.baseHealth + ZOMBIE.healthPerRound * (r - 1);
  const atLinearEnd = ZOMBIE.baseHealth + ZOMBIE.healthPerRound * (ZOMBIE.roundsLinear - 1); // 950
  return Math.round(atLinearEnd * Math.pow(ZOMBIE.healthMultAfter, r - ZOMBIE.roundsLinear));
}

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

function inAttackRange(z, p) {
  return !!p && dist(z.x, z.y, p.x, p.y) <= ZOMBIE.attackRange + p.radius;
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

export function spawnZombie(state, spawnPoint) {
  const round = (state.rounds && state.rounds.round) || 1;
  const hp = healthForRound(round);
  const tier = tierForRound(round, state.rng);
  const speed = ZOMBIE.speeds[tier] * state.rng.range(1 - SPEED_JITTER, 1 + SPEED_JITTER);
  const barricadeId = spawnPoint.barricadeId == null ? null : spawnPoint.barricadeId;
  const z = {
    id: nextId(),
    x: spawnPoint.x, y: spawnPoint.y,
    radius: ZOMBIE.radius,
    hp, maxHp: hp,
    tier, speed,
    // Window spawns always start tearing; the first update flips them to chasing if the
    // barricade is already open (keeps spawn free of map calls).
    mode: barricadeId == null ? 'chasing' : 'tearing',
    spawnPointId: spawnPoint.id,
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
  state.zombies.push(z);
  emit('zombie:spawned', { zombie: z });
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
  if (powerupActive(state, 'instaKill')) dmg = Math.max(dmg, z.hp);
  // WO2: Thundergun near-cone kills pass Infinity. Report the hp actually removed and never
  // leave a non-finite hp behind.
  const hpBefore = Number.isFinite(z.hp) ? z.hp : 0;
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
  z.dyingT = ZOMBIE.deathLinger;
  z.vx = 0; z.vy = 0;
  z.attackTimer = 0;
  z.tearOwner = false;
  z.kvx = 0; z.kvy = 0; z.stun = 0;
  pushBlood(state, z.x, z.y, true);
  emit('zombie:killed', { zombie: z, cause, x: z.x, y: z.y });
  return true;
}

// ---------------------------------------------------------------------------
// Knockback (WO2 3.10)
// ---------------------------------------------------------------------------

// Sets the knock velocity (replacing any previous one) and extends the stun. Ignored for dying
// zombies and for tearing zombies (they stay in their pocket). Interrupts an attack wind-up.
// Returns true if the knockback was applied.
export function applyKnockback(state, z, vx, vy, stunSeconds) {
  if (!z || !isAlive(z) || z.mode === 'tearing') return false;
  vx = Number(vx); vy = Number(vy);
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
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
  if (p && !p.down && inAttackRange(z, p)) {
    z.mode = 'attacking';
    z.attackTimer = z.attackCd <= 0 ? ZOMBIE.attackWindup : 0;
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
  if (!z.inside) return { x: vx, y: vy };
  const reach = ZOMBIE.separationMinDist + 2;
  for (const o of state.zombies) {
    if (o === z || !o.inside || !isAlive(o)) continue;
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
  if (!p || p.down) { z.mode = 'chasing'; z.attackTimer = 0; return; }
  // Attackers keep their spacing too (playtest.md #1), so a crowd forms a ring, not a blob.
  const sep = separation(state, z);
  if (sep.x || sep.y) { moveAndCollide(state, z, sep.x, sep.y, dt); z.vx = 0; z.vy = 0; }
  if (z.attackTimer > 0) {
    // Winding up: the swing always completes, but only lands if still in range.
    z.attackTimer -= dt;
    if (z.attackTimer <= 0) {
      z.attackTimer = 0;
      if (inAttackRange(z, p)) damagePlayer(state, ZOMBIE.damage);
      z.attackCd = ZOMBIE.attackCooldown;
    }
    return;
  }
  if (!inAttackRange(z, p)) { z.mode = 'chasing'; return; }
  if (z.attackCd <= 0) z.attackTimer = ZOMBIE.attackWindup;
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
  const minD = ZOMBIE.separationMinDist, maxPush = ZOMBIE.separationMaxPush;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let iter = 0; iter < ZOMBIE.separationIters; iter++) {
    px.fill(0); py.fill(0);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx >= minD || dx <= -minD || dy >= minD || dy <= -minD) continue;
        const d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        let ux, uy;
        if (d < 1e-6) { const u = stackDir(b, a); ux = u.x; uy = u.y; } else { ux = dx / d; uy = dy / d; }
        const h = (minD - d) / 2;
        px[i] -= ux * h; py[i] -= uy * h;
        px[j] += ux * h; py[j] += uy * h;
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
    if (z.stun > 0) {
      if (z.mode === 'tearing') { z.stun = 0; z.kvx = 0; z.kvy = 0; }
      else {
        updateStunned(state, z, dt);
        const ts = tileTypeAt(map, z.x, z.y);
        if (ts !== -1) z.inside = !isOutsideTile(ts);
        continue;
      }
    }

    const t = tileTypeAt(map, z.x, z.y);
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
