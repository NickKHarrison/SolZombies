// weapons.js (Agent C) — weapon definitions, firing (hitscan + ray gun projectiles),
// reload, ammo refills. Pure logic: no DOM access. See WORK_ORDER.md 5.4 and docs/notes/weapons.md.

import { PRICES, COLORS, FIXED_DT_CAP, WEAPON_FX, SHOP } from './config.js';
import { emit } from './events.js';
import { rayCircle, dist, nextId } from './math.js';
import { raycastWalls } from './map.js';
import { damageZombie } from './zombie.js';
import * as zombieMod from './zombie.js';
import { damagePlayer } from './player.js';

// Tunables live in config.js WEAPON_FX (moved by integrator).
const DEFAULT_RANGE = WEAPON_FX.defaultRange;
const TRACER_TTL = WEAPON_FX.tracerTtl;
const MUZZLE_TTL = WEAPON_FX.muzzleTtl;
const EXPLOSION_TTL = WEAPON_FX.explosionTtl;
const BULLET_RADIUS = WEAPON_FX.bulletRadius;         // ray gun projectile collision radius
const SELF_SPLASH_MULT = WEAPON_FX.selfSplashMult;    // ray gun splash damage fraction applied to the player
const RAYGUN_COLOR = WEAPON_FX.raygunColor;
const SHOCKWAVE_TTL = WEAPON_FX.shockwaveTtl;
const THUNDERGUN_SHAKE = WEAPON_FX.thundergunShake;
const THUNDERGUN_COLOR = '#3ec9ff';

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

function def(o) {
  return Object.freeze({
    pellets: 1,
    range: DEFAULT_RANGE,
    penetration: 1,
    projectile: null,
    cone: null,
    cost: null,
    noReload: false,
    ...o,
  });
}

// cost: number = wall buy price; null = not purchasable off a wall (box / start / power-up).
export const WEAPONS = Object.freeze({
  mr6:        def({ id: 'mr6',        name: 'MR6',          cls: 'pistol',  cost: null, damage: 50,   rpm: 320,  auto: false, mag: 8,   reserve: 80,  reloadTime: 1.3, spread: 0.03 }),
  rk5:        def({ id: 'rk5',        name: 'RK5',          cls: 'pistol',  cost: 50,   damage: 50,   rpm: 500,  auto: false, mag: 15,  reserve: 135, reloadTime: 1.5, spread: 0.03 }),
  lcar9:      def({ id: 'lcar9',      name: 'L-CAR 9',      cls: 'pistol',  cost: 75,   damage: 30,   rpm: 900,  auto: true,  mag: 24,  reserve: 216, reloadTime: 1.6, spread: 0.05 }),
  sheiva:     def({ id: 'sheiva',     name: 'Sheiva',       cls: 'ar',      cost: 50,   damage: 90,   rpm: 260,  auto: false, mag: 10,  reserve: 120, reloadTime: 2.0, spread: 0.02, penetration: 2 }),
  krm262:     def({ id: 'krm262',     name: 'KRM-262',      cls: 'shotgun', cost: 75,   damage: 30,   rpm: 65,   auto: false, mag: 6,   reserve: 42,  reloadTime: 2.6, spread: 0.22, pellets: 8, range: 700 }),
  kuda:       def({ id: 'kuda',       name: 'Kuda',         cls: 'smg',     cost: 125,  damage: 45,   rpm: 750,  auto: true,  mag: 30,  reserve: 240, reloadTime: 1.9, spread: 0.06 }),
  vmp:        def({ id: 'vmp',        name: 'VMP',          cls: 'smg',     cost: 125,  damage: 40,   rpm: 900,  auto: true,  mag: 40,  reserve: 240, reloadTime: 2.1, spread: 0.06 }),
  vesper:     def({ id: 'vesper',     name: 'Vesper',       cls: 'smg',     cost: 125,  damage: 38,   rpm: 1100, auto: true,  mag: 25,  reserve: 250, reloadTime: 1.8, spread: 0.07 }),
  pharo:      def({ id: 'pharo',      name: 'Pharo',        cls: 'smg',     cost: 100,  damage: 42,   rpm: 800,  auto: true,  mag: 24,  reserve: 216, reloadTime: 1.9, spread: 0.06 }),
  bootlegger: def({ id: 'bootlegger', name: 'Bootlegger',   cls: 'smg',     cost: 100,  damage: 44,   rpm: 780,  auto: true,  mag: 30,  reserve: 240, reloadTime: 1.9, spread: 0.06 }),
  kn44:       def({ id: 'kn44',       name: 'KN-44',        cls: 'ar',      cost: 150,  damage: 70,   rpm: 700,  auto: true,  mag: 30,  reserve: 240, reloadTime: 2.2, spread: 0.04 }),
  hvk30:      def({ id: 'hvk30',      name: 'HVK-30',       cls: 'ar',      cost: 125,  damage: 58,   rpm: 750,  auto: true,  mag: 32,  reserve: 256, reloadTime: 2.2, spread: 0.04 }),
  icr1:       def({ id: 'icr1',       name: 'ICR-1',        cls: 'ar',      cost: 150,  damage: 66,   rpm: 700,  auto: true,  mag: 30,  reserve: 240, reloadTime: 2.1, spread: 0.035 }),
  argus:      def({ id: 'argus',      name: 'Argus',        cls: 'shotgun', cost: 150,  damage: 45,   rpm: 90,   auto: false, mag: 6,   reserve: 36,  reloadTime: 2.8, spread: 0.12, pellets: 6, range: 900 }),
  locus:      def({ id: 'locus',      name: 'Locus',        cls: 'sniper',  cost: null, damage: 400,  rpm: 50,   auto: false, mag: 6,   reserve: 48,  reloadTime: 2.8, spread: 0.004, penetration: 4, range: 2400 }),
  drakon:     def({ id: 'drakon',     name: 'Drakon',       cls: 'sniper',  cost: null, damage: 220,  rpm: 200,  auto: false, mag: 10,  reserve: 60,  reloadTime: 2.5, spread: 0.008, penetration: 3, range: 2400 }),
  haymaker12: def({ id: 'haymaker12', name: 'Haymaker 12',  cls: 'shotgun', cost: null, damage: 25,   rpm: 300,  auto: true,  mag: 16,  reserve: 64,  reloadTime: 3.0, spread: 0.2, pellets: 8, range: 700 }),
  dingo:      def({ id: 'dingo',      name: 'Dingo',        cls: 'lmg',     cost: null, damage: 60,   rpm: 800,  auto: true,  mag: 100, reserve: 300, reloadTime: 4.5, spread: 0.07 }),
  brm:        def({ id: 'brm',        name: 'BRM',          cls: 'lmg',     cost: null, damage: 75,   rpm: 650,  auto: true,  mag: 75,  reserve: 300, reloadTime: 4.2, spread: 0.06 }),
  raygun:     def({ id: 'raygun',     name: 'Ray Gun',      cls: 'special', sprite: 'raygun', cost: null, damage: 1000, rpm: 180,  auto: false, mag: 20,  reserve: 160, reloadTime: 3.0, spread: 0.01,
                    projectile: Object.freeze({ speed: 900, splashRadius: 90, splashDamage: 300 }) }),
  thundergun: def({ id: 'thundergun', name: 'Thundergun', cls: 'special', sprite: 'thundergun', cost: null,
                    damage: 0, rpm: 60, auto: false, mag: 4, reserve: 12, reloadTime: 3.0, spread: 0,
                    cone: Object.freeze({ range: 480, killRange: 300, halfAngle: 0.52, knockback: 720, stun: 1.2 }) }),
  deathmachine: def({ id: 'deathmachine', name: 'Death Machine', cls: 'special', sprite: 'deathmachine', cost: null, damage: 60, rpm: 1200, auto: true, mag: Infinity, reserve: Infinity, reloadTime: 0, spread: 0.08, noReload: true }),
});

export const WALL_WEAPON_IDS = Object.freeze(
  Object.keys(WEAPONS).filter((id) => typeof WEAPONS[id].cost === 'number'),
);

export const BOX_WEAPON_IDS = Object.freeze(
  Object.keys(WEAPONS).filter((id) => id !== 'mr6' && id !== 'deathmachine'),
);

// WO2 3.9: wonder weapons share the lowest box weight (SHOP.boxWeights.wonder).
export const WONDER_WEAPON_IDS = Object.freeze(['raygun', 'thundergun']);

// Extra export (not in contract 3.6): mystery box weights, for shop.js.
// 3 for wall guns, 2 for box-only guns, 1 for wonder weapons. Use with state.rng.weighted(BOX_WEIGHTS).
export const BOX_WEIGHTS = Object.freeze(Object.fromEntries(BOX_WEAPON_IDS.map((id) => [
  id, WONDER_WEAPON_IDS.includes(id) ? SHOP.boxWeights.wonder
    : (typeof WEAPONS[id].cost === 'number' ? SHOP.boxWeights.wall : SHOP.boxWeights.boxOnly),
])));

// ---------------------------------------------------------------------------
// Injectable dependencies (extra export, used by tests; defaults call the real modules lazily
// so import cycles are harmless).
// ---------------------------------------------------------------------------

const DEFAULT_DEPS = Object.freeze({
  raycastWalls: (...a) => raycastWalls(...a),
  damageZombie: (...a) => damageZombie(...a),
  damagePlayer: (...a) => damagePlayer(...a),
  // zombie.applyKnockback (WO2 3.10) is looked up lazily so this module works before it exists.
  applyKnockback: (...a) => (typeof zombieMod.applyKnockback === 'function' ? zombieMod.applyKnockback(...a) : undefined),
});
let deps = { ...DEFAULT_DEPS };

export function setWeaponDeps(overrides) { deps = { ...deps, ...overrides }; }
export function resetWeaponDeps() { deps = { ...DEFAULT_DEPS }; }

// ---------------------------------------------------------------------------
// Weapon instances
// ---------------------------------------------------------------------------

export function createWeapon(id) {
  const d = WEAPONS[id];
  if (!d) throw new Error(`weapons.createWeapon: unknown weapon id "${id}"`);
  return { id, def: d, mag: d.mag, reserve: d.reserve, reloading: false, reloadT: 0, cooldown: 0, triggerHeld: false };
}

export function createDeathMachine() {
  return createWeapon('deathmachine');
}

export function updateWeapon(w, dt) {
  if (!w) return;
  // Allow a small negative carry so sustained auto fire keeps its true rpm at any frame rate.
  w.cooldown = Math.max(w.cooldown - dt, -FIXED_DT_CAP);
  if (w.reloading) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      const n = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += n;
      w.reserve -= n;
      w.reloading = false;
      w.reloadT = 0;
    }
  }
}

export function startReload(w) {
  if (!w || w.def.noReload || w.reloading) return false;
  if (!(w.reserve > 0) || !(w.mag < w.def.mag)) return false;
  w.reloading = true;
  w.reloadT = w.def.reloadTime;
  emit('weapon:reload', { weaponId: w.id });
  return true;
}

export function refillReserve(w) {
  if (!w) return;
  w.reserve = w.def.reserve;
}

export function refillAll(w) {
  if (!w) return;
  w.mag = w.def.mag;
  w.reserve = w.def.reserve;
  w.reloading = false;
  w.reloadT = 0;
}

export function ammoCost(id) {
  const d = WEAPONS[id];
  if (!d || typeof d.cost !== 'number') return Infinity; // not sold on walls: never affordable
  return Math.round(d.cost * PRICES.wallAmmoMult);
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

function pushEffect(state, e) {
  if (state && Array.isArray(state.effects)) state.effects.push(e);
}

function isAlive(z) {
  return z && z.mode !== 'dying' && !(z.hp <= 0);
}

// Extra export: single hitscan ray. Finds walls via deps.raycastWalls (skipped when state.map is
// null), hits the nearest `penetration` live zombies in front of the wall with `damage`, and
// pushes a tracer effect. Returns { hits: [zombie...], endX, endY }.
export function hitscan(state, ox, oy, dx, dy, range, penetration, damage) {
  let wallT = state.map ? deps.raycastWalls(state.map, ox, oy, dx, dy, range) : Infinity;
  if (!(wallT >= 0)) wallT = Infinity;
  const maxT = Math.min(wallT, range);

  const cands = [];
  for (const z of state.zombies || []) {
    if (!isAlive(z)) continue;
    const t = rayCircle(ox, oy, dx, dy, z.x, z.y, z.radius);
    if (t < maxT) cands.push({ z, t });
  }
  cands.sort((a, b) => a.t - b.t);

  const hits = [];
  let endT = maxT;
  const n = Math.min(cands.length, penetration);
  for (let i = 0; i < n; i++) {
    const { z, t } = cands[i];
    const hx = ox + dx * t, hy = oy + dy * t;
    hits.push(z);
    deps.damageZombie(state, z, damage, 'weapon', hx, hy);
    if (i === penetration - 1) endT = t;
  }
  if (!Number.isFinite(endT)) endT = range;

  const endX = ox + dx * endT, endY = oy + dy * endT;
  pushEffect(state, { type: 'tracer', x0: ox, y0: oy, x1: endX, y1: endY, ttl: TRACER_TTL, maxTtl: TRACER_TTL, color: COLORS.tracer });
  return { hits, endX, endY };
}

// Signed smallest difference a - b, wrapped to [-PI, PI].
function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Thundergun cone blast (WO2 3.9). Every live zombie inside the cone needs line of sight from the
// fire origin to the near edge of its circle (walls and boarded windows block, same test as ray gun
// splash). Those within killRange die; those between killRange and range are knocked back + stunned.
// Pushes the shockwave + shake effects. Returns true if any zombie was affected.
function fireCone(state, cone, ox, oy, angle) {
  let affected = false;
  const targets = (state.zombies || []).filter(isAlive); // snapshot: kills may mutate the list
  for (const z of targets) {
    if (!isAlive(z)) continue;
    const zx = z.x - ox, zy = z.y - oy;
    const d = Math.hypot(zx, zy);
    if (d > cone.range) continue;
    if (d > 1e-6 && Math.abs(angleDiff(Math.atan2(zy, zx), angle)) > cone.halfAngle) continue;
    if (!splashVisible(state, ox, oy, z.x, z.y, z.radius)) continue; // wall / boards in the way
    if (d <= cone.killRange) {
      deps.damageZombie(state, z, Infinity, 'weapon', z.x, z.y);
      affected = true;
      continue;
    }
    const ux = zx / d, uy = zy / d;
    // applyKnockback returns false when it refuses (e.g. a tearing zombie); a fake returning
    // undefined still counts.
    if (deps.applyKnockback(state, z, ux * cone.knockback, uy * cone.knockback, cone.stun) !== false) affected = true;
  }
  pushEffect(state, { type: 'shockwave', x: ox, y: oy, angle, range: cone.range, halfAngle: cone.halfAngle,
    ttl: SHOCKWAVE_TTL, maxTtl: SHOCKWAVE_TTL });
  pushEffect(state, { type: 'shake', ttl: THUNDERGUN_SHAKE.ttl, maxTtl: THUNDERGUN_SHAKE.ttl, magnitude: THUNDERGUN_SHAKE.magnitude });
  return affected;
}

export function tryFire(state, w, ox, oy, dx, dy) {
  if (!w) return false;
  const wasHeld = w.triggerHeld;
  w.triggerHeld = true; // the trigger is being pulled right now

  if (w.reloading) return false;
  if (w.mag <= 0) {
    if (w.reserve > 0) startReload(w);
    else if (!wasHeld) emit('weapon:empty', { weaponId: w.id });
    return false;
  }
  if (!w.def.auto && wasHeld) return false;
  if (w.cooldown > 0) return false;

  const d = w.def;
  const interval = 60 / d.rpm;
  // Carry negative cooldown only during sustained fire; a fresh pull starts a clean interval.
  w.cooldown = (wasHeld && w.cooldown < 0) ? w.cooldown + interval : interval;
  w.mag -= 1;

  const baseLen = Math.hypot(dx, dy) || 1;
  const bx = dx / baseLen, by = dy / baseLen;
  const baseAngle = Math.atan2(by, bx);
  const rng = state.rng;
  const jitter = () => (d.spread > 0 && rng ? rng.range(-d.spread, d.spread) : 0);

  if (state.stats) state.stats.shotsFired++;

  if (d.cone) {
    if (fireCone(state, d.cone, ox, oy, baseAngle) && state.stats) state.stats.shotsHit++;
  } else if (d.projectile) {
    const a = baseAngle + jitter();
    const vx = Math.cos(a) * d.projectile.speed, vy = Math.sin(a) * d.projectile.speed;
    if (Array.isArray(state.bullets)) {
      state.bullets.push({ id: nextId(), x: ox, y: oy, vx, vy, ttl: d.range / d.projectile.speed, def: d });
    }
  } else {
    let anyHit = false;
    for (let p = 0; p < d.pellets; p++) {
      const a = baseAngle + jitter();
      const res = hitscan(state, ox, oy, Math.cos(a), Math.sin(a), d.range, d.penetration, d.damage);
      if (res.hits.length) anyHit = true;
    }
    if (anyHit && state.stats) state.stats.shotsHit++;
  }

  pushEffect(state, { type: 'muzzle', x: ox, y: oy, angle: baseAngle, size: d.cls === 'shotgun' ? 14 : 9,
    ttl: MUZZLE_TTL, maxTtl: MUZZLE_TTL, color: d.cone ? THUNDERGUN_COLOR : d.projectile ? RAYGUN_COLOR : COLORS.tracer });
  emit('weapon:fired', { weaponId: w.id, x: ox, y: oy, dirX: bx, dirY: by });

  // Auto-reload as soon as the mag runs dry (player may also call startReload; it is idempotent).
  if (w.mag <= 0 && w.reserve > 0) startReload(w);
  return true;
}

// ---------------------------------------------------------------------------
// Ray gun projectiles
// ---------------------------------------------------------------------------

// Splash line-of-sight (review.md #4a). The LOS origin is backed off the impact point by
// SPLASH_LOS_BACKOFF px against the bolt's travel direction so a hit on a wall/window face does
// not self-block. A target is visible when the wall ray reaches the point of its circle nearest
// the blast (minus SPLASH_LOS_TOL px), so a zombie in a spawn pocket behind a window, or anyone
// on the far side of a wall, takes no splash.
const SPLASH_LOS_BACKOFF = 1;
const SPLASH_LOS_TOL = 0.5;

function splashVisible(state, ox, oy, tx, ty, r) {
  if (!state.map) return true;
  const dx = tx - ox, dy = ty - oy;
  const d = Math.hypot(dx, dy);
  const reach = d - (r || 0);
  if (!(reach > SPLASH_LOS_TOL)) return true; // blast is inside / touching the target
  const t = deps.raycastWalls(state.map, ox, oy, dx / d, dy / d, reach);
  return !(t < reach - SPLASH_LOS_TOL);
}

function detonate(state, b, x, y, direct) {
  const pr = b.def.projectile;
  let hitAny = false;
  if (direct && isAlive(direct)) {
    deps.damageZombie(state, direct, b.def.damage, 'weapon', x, y);
    hitAny = true;
  }
  const sp = Math.hypot(b.vx || 0, b.vy || 0);
  const ox = sp > 0 ? x - (b.vx / sp) * SPLASH_LOS_BACKOFF : x;
  const oy = sp > 0 ? y - (b.vy / sp) * SPLASH_LOS_BACKOFF : y;
  for (const z of state.zombies || []) {
    if (z === direct || !isAlive(z)) continue;
    if (dist(x, y, z.x, z.y) <= pr.splashRadius + z.radius &&
        splashVisible(state, ox, oy, z.x, z.y, z.radius)) {
      deps.damageZombie(state, z, pr.splashDamage, 'weapon', z.x, z.y);
      hitAny = true;
    }
  }
  const pl = state.player;
  if (pl && !pl.down && dist(x, y, pl.x, pl.y) <= pr.splashRadius + (pl.radius || 0) &&
      splashVisible(state, ox, oy, pl.x, pl.y, pl.radius || 0)) {
    deps.damagePlayer(state, pr.splashDamage * SELF_SPLASH_MULT);
  }
  if (hitAny && state.stats) state.stats.shotsHit++;
  pushEffect(state, { type: 'explosion', x, y, radius: pr.splashRadius, ttl: EXPLOSION_TTL, maxTtl: EXPLOSION_TTL, color: RAYGUN_COLOR });
}

export function updateBullets(state, dt) {
  const bullets = state.bullets;
  if (!Array.isArray(bullets) || bullets.length === 0) return;
  const keep = [];
  for (const b of bullets) {
    const speed = Math.hypot(b.vx, b.vy);
    if (!(speed > 0)) continue;
    const dx = b.vx / speed, dy = b.vy / speed;
    const step = speed * Math.min(dt, Math.max(b.ttl, 0));
    const expiring = b.ttl - dt <= 0;

    let wallT = state.map ? deps.raycastWalls(state.map, b.x, b.y, dx, dy, step) : Infinity;
    if (!(wallT >= 0)) wallT = Infinity;
    let zT = Infinity, zHit = null;
    for (const z of state.zombies || []) {
      if (!isAlive(z)) continue;
      const t = rayCircle(b.x, b.y, dx, dy, z.x, z.y, z.radius + BULLET_RADIUS);
      if (t < zT) { zT = t; zHit = z; }
    }

    const t = Math.min(wallT, zT);
    if (t <= step) {
      const hx = b.x + dx * t, hy = b.y + dy * t;
      detonate(state, b, hx, hy, zT <= wallT ? zHit : null);
      continue;
    }
    b.x += dx * step;
    b.y += dy * step;
    b.ttl -= dt;
    if (expiring) continue; // fizzles at max range without exploding
    keep.push(b);
  }
  bullets.length = 0;
  for (const b of keep) bullets.push(b);
}
