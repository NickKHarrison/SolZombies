// weapons.js (Agent C) — weapon definitions, firing (hitscan + ray gun projectiles),
// reload, ammo refills. Pure logic: no DOM access. See WORK_ORDER.md 5.4 and docs/notes/weapons.md.

import { PRICES, COLORS, FIXED_DT_CAP, WEAPON_FX, SHOP, BOSS, ZOMBIE, PERKS, MELEE, PAP as PAP_CFG } from './config.js';
import { emit } from './events.js';
import { rayCircle, dist, nextId } from './math.js';
import { raycastWalls } from './map.js';
import { damageZombie } from './zombie.js';
import * as zombieMod from './zombie.js';
import { damagePlayer } from './player.js';
import * as playerMod from './player.js';

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
    tier: 1,          // WO5: 2 = level-2 wall gun, WO7: 3 = level-3 wall gun (box weight boxOnly)
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
  // WO5 3.4: drakon + haymaker12 gain a (level-2) wall price; tier 2 keeps their box weight at boxOnly.
  drakon:     def({ id: 'drakon',     name: 'Drakon',       cls: 'sniper',  cost: 300,  tier: 2, damage: 380,  rpm: 200,  auto: false, mag: 10,  reserve: 60,  reloadTime: 2.5, spread: 0.008, penetration: 3, range: 2400 }),
  haymaker12: def({ id: 'haymaker12', name: 'Haymaker 12',  cls: 'shotgun', cost: 250,  tier: 2, damage: 32,   rpm: 330,  auto: true,  mag: 16,  reserve: 64,  reloadTime: 3.0, spread: 0.2, pellets: 8, range: 700 }),
  dingo:      def({ id: 'dingo',      name: 'Dingo',        cls: 'lmg',     cost: null, damage: 60,   rpm: 800,  auto: true,  mag: 100, reserve: 300, reloadTime: 4.5, spread: 0.07 }),
  brm:        def({ id: 'brm',        name: 'BRM',          cls: 'lmg',     cost: null, damage: 75,   rpm: 650,  auto: true,  mag: 75,  reserve: 300, reloadTime: 4.2, spread: 0.06 }),
  // WO5 3.4 (Agent D): level-2 wall guns (cost = level-2 wall price), also in the box at boxOnly weight.
  // WO5 FIX-4 (playtest #2, balance #12): tier-2 stats retuned so every level-2 gun kills a level-2
  // round-8 zombie in <= 0.85x the KN-44's time and price tracks power (Gorgon/Drakon strongest).
  // tests/weapons.test.js "tier-2 TTK" pins this; see docs/notes/weapons.md for the table.
  manowar:    def({ id: 'manowar',    name: 'Man-O-War',    cls: 'ar',      sprite: 'manowar',   cost: 250, tier: 2, damage: 140, rpm: 520, auto: true,  mag: 25, reserve: 200, reloadTime: 2.6, spread: 0.035, penetration: 2 }),
  xr2:        def({ id: 'xr2',        name: 'XR-2',         cls: 'ar',      sprite: 'xr2',       cost: 225, tier: 2, damage: 80,  rpm: 800, auto: true,  mag: 30, reserve: 270, reloadTime: 2.1, spread: 0.02 }),
  weevil:     def({ id: 'weevil',     name: 'Weevil',       cls: 'smg',     sprite: 'weevil',    cost: 200, tier: 2, damage: 65,  rpm: 950, auto: true,  mag: 48, reserve: 288, reloadTime: 2.0, spread: 0.06 }),
  marshal16:  def({ id: 'marshal16',  name: 'Marshal 16',   cls: 'shotgun', sprite: 'marshal16', cost: 225, tier: 2, damage: 100, rpm: 150, auto: false, mag: 2,  reserve: 40,  reloadTime: 1.5, spread: 0.16, pellets: 8, range: 650 }),
  gorgon:     def({ id: 'gorgon',     name: 'Gorgon',       cls: 'lmg',     sprite: 'gorgon',    cost: 300, tier: 2, damage: 175, rpm: 480, auto: true,  mag: 48, reserve: 240, reloadTime: 4.0, spread: 0.05, penetration: 3 }),
  dredge48:   def({ id: 'dredge48',   name: '48 Dredge',    cls: 'lmg',     sprite: 'dredge48',  cost: 275, tier: 2, damage: 85,  rpm: 900, auto: true,  mag: 48, reserve: 288, reloadTime: 3.6, spread: 0.07 }),
  // WO7 1.5 (Agent F): level-3 (tier 3) wall guns, box weight boxOnly (2), ammo x PERKS.ammoMultTier3.
  // Damage/rpm retuned from the 1.5 table so each beats every tier-2 gun on level-3 health
  // (healthMult 2.0) and price tracks power; tests/weapons.test.js "WO7 tier-3 TTK" pins it.
  hg40:       def({ id: 'hg40',       name: 'HG 40',           cls: 'smg', sprite: 'hg40',        cost: 350, tier: 3, damage: 130, rpm: 800, auto: true, mag: 40, reserve: 280, reloadTime: 1.9, spread: 0.05, penetration: 2 }),  // WO7 FIX-5 (balance #2): 120 -> 130, pen 1 -> 2
  m8a7:       def({ id: 'm8a7',       name: 'M8A7',            cls: 'ar',  sprite: 'm8a7',        cost: 375, tier: 3, damage: 140, rpm: 780, auto: true, mag: 32, reserve: 256, reloadTime: 2.2, spread: 0.02, penetration: 3 }),  // WO7 FIX-5 (balance #3): pen 2 -> 3
  peacekeeper: def({ id: 'peacekeeper', name: 'Peacekeeper MK2', cls: 'ar', sprite: 'peacekeeper', cost: 400, tier: 3, damage: 185, rpm: 650, auto: true, mag: 30, reserve: 270, reloadTime: 2.3, spread: 0.035, penetration: 3 }),
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

// WO5 3.4: wall guns whose box weight is SHOP.boxWeights.wall (3) = the level-1 (WO4) wall guns.
// WO7: tier-3 (level-3) wall guns are excluded too (box weight boxOnly = 2).
// Level-2 wall guns (def.tier === 2: the six new guns + haymaker12 + drakon) have a cost but keep
// the boxOnly weight (2), so adding them does not change the relative odds of the WO4 box guns.
// shop.boxWeights(boxIds, wallIds) should default wallIds to this list to stay consistent.
export const BOX_WALL_WEIGHT_IDS = Object.freeze(
  WALL_WEAPON_IDS.filter((id) => !(WEAPONS[id].tier >= 2)),
);

// Extra export (not in contract 3.6): mystery box weights, for shop.js.
// 3 for level-1 wall guns, 2 for box-only and level-2 guns, 1 for wonder weapons.
// Use with state.rng.weighted(BOX_WEIGHTS).
export const BOX_WEIGHTS = Object.freeze(Object.fromEntries(BOX_WEAPON_IDS.map((id) => [
  id, WONDER_WEAPON_IDS.includes(id) ? SHOP.boxWeights.wonder
    : (BOX_WALL_WEIGHT_IDS.includes(id) ? SHOP.boxWeights.wall : SHOP.boxWeights.boxOnly),
])));

// ---------------------------------------------------------------------------
// WO8 1.2: Pack-a-Punch upgraded defs
// ---------------------------------------------------------------------------

const PAP_DEFAULTS = Object.freeze({ ammoCost: 450, damageMult: 2, magMult: 1.5, reserveMult: 1.5, spreadMult: 0.8,
  penetrationBonus: 1, maxPenetration: 4, projectileMult: 1.5, coneKillMult: 1.25, coneRangeMult: 1.15, knockMult: 1.2 });
const PAP = Object.freeze({ ...PAP_DEFAULTS, ...(PAP_CFG || {}) });

// WO8 1.2 names table (three BO3 originals, the rest in the BO3 style). Death Machine excluded.
export const UPGRADE_NAMES = Object.freeze({
  mr6: 'Nightingale', rk5: 'Dominion', lcar9: 'Gravedigger', sheiva: 'Fallen Comrade',
  krm262: 'Krumhaar', kuda: 'Scorpion Sting', vmp: 'Hydra', vesper: 'Ultraviolet',
  pharo: "Sekhmet's Ire", bootlegger: 'Moonshiner', kn44: "Warden's Wrath", hvk30: 'Comet',
  icr1: 'Infinity Reaper', argus: 'Exodus', locus: 'Cauterizer', drakon: 'Firestorm',
  haymaker12: 'Mainsail', dingo: 'Kraken', brm: 'Barrage', manowar: 'Dreadnought',
  xr2: 'Nebula', weevil: 'Wyrm', marshal16: 'Judge & Jury', gorgon: "Medusa's Gaze",
  dredge48: 'Overflow', hg40: 'Venom Drum', m8a7: 'Pulsar', peacekeeper: 'Peacemaker',
  raygun: "Porter's X2 Ray Gun", thundergun: 'Zeus Cannon',
});

// Derived upgraded def: same id (wall buy / box / stats keep working), damage x2, mag/reserve x1.5
// (rounded), spread x0.8, penetration +1 (max 4), rpm/reload unchanged; Ray Gun splash damage and
// radius x projectileMult; Thundergun killRange x coneKillMult, range x coneRangeMult, knockback x
// knockMult. Everything in combat reads w.def, so an upgraded weapon needs no special casing.
function upgradedDef(base, name) {
  const o = {
    ...base,
    name,
    damage: base.damage * PAP.damageMult,
    mag: Math.round(base.mag * PAP.magMult),
    reserve: Math.round(base.reserve * PAP.reserveMult),
    spread: base.spread * PAP.spreadMult,
    penetration: Math.max(base.penetration, Math.min(PAP.maxPenetration, base.penetration + PAP.penetrationBonus)),
    upgraded: true,
    baseId: base.id,
  };
  if (base.projectile) {
    o.projectile = Object.freeze({ ...base.projectile,
      splashDamage: base.projectile.splashDamage * PAP.projectileMult,
      splashRadius: base.projectile.splashRadius * PAP.projectileMult });
  }
  if (base.cone) {
    o.cone = Object.freeze({ ...base.cone,
      killRange: base.cone.killRange * PAP.coneKillMult,
      range: base.cone.range * PAP.coneRangeMult,
      knockback: base.cone.knockback * PAP.knockMult });
  }
  return Object.freeze(o);
}

export const UPGRADES = Object.freeze(Object.fromEntries(
  Object.keys(WEAPONS).filter((id) => UPGRADE_NAMES[id]).map((id) => [id, upgradedDef(WEAPONS[id], UPGRADE_NAMES[id])]),
));

// WO8 Phase 4a (economy #2): vs kind 'boss' an upgraded def deals base x BOSS.papDamageMult
// (1.25) instead of base x the PaP multiplier `mult` it was built with (PAP.damageMult for bullet /
// bolt damage, PAP.projectileMult for Ray Gun splash). Returns the factor applied on top of the
// upgraded value (1 for base guns). The Thundergun's boss share stays BOSS.thunderNearFrac.
function papBossFactor(def, mult) {
  if (!def || def.upgraded !== true) return 1;
  const want = BOSS && Number.isFinite(BOSS.papDamageMult) && BOSS.papDamageMult > 0 ? BOSS.papDamageMult : 1;
  const m = Number.isFinite(mult) && mult > 0 ? mult : 1;
  return want / m;
}

export function isUpgraded(w) {
  return !!(w && (w.upgraded === true || (w.def && w.def.upgraded === true)));
}

// Upgraded display name for a weapon id (or a weapon object); falls back to the base name / id.
export function upgradedName(id) {
  const key = id && typeof id === 'object' ? id.id : id;
  if (UPGRADES[key]) return UPGRADES[key].name;
  return (WEAPONS[key] && WEAPONS[key].name) || String(key);
}

export function canUpgrade(w) {
  if (!w || typeof w.id !== 'string' || !WEAPONS[w.id]) return { ok: false, reason: 'unknown' };
  if (w.id === 'deathmachine' || !UPGRADES[w.id]) return { ok: false, reason: 'powerup' };
  if (isUpgraded(w)) return { ok: false, reason: 'upgraded' };
  return { ok: true };
}

// Mutates w into its upgraded form: def = UPGRADES[id], upgraded = true, mag/reserve filled to the
// new maxima, any reload cancelled. Safe to call twice (the def is never compounded). Unknown ids
// and the Death Machine are returned unchanged.
export function upgradeWeapon(w) {
  if (!w) return w;
  const d = UPGRADES[w.id];
  if (!d) return w;
  w.def = d;
  w.upgraded = true;
  w.mag = d.mag;
  w.reserve = d.reserve;
  w.reloading = false;
  w.reloadT = 0;
  return w;
}

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
  // WO5 (integrator): exact px displacement (boss Thundergun push). null result = not available,
  // thunderBoss then falls back to applyKnockback + bossKnock.
  pushZombie: (...a) => (typeof zombieMod.pushZombie === 'function' ? zombieMod.pushZombie(...a) : null),
});
let deps = { ...DEFAULT_DEPS };

export function setWeaponDeps(overrides) { deps = { ...deps, ...overrides }; }
export function resetWeaponDeps() { deps = { ...DEFAULT_DEPS }; lastState = null; }

// ---------------------------------------------------------------------------
// WO7 T2: perk multipliers (player.perkMods, Agent E). Read lazily through the namespace import
// and guarded, so a missing / throwing perkMods means "no perks" (every multiplier 1).
// ---------------------------------------------------------------------------

const NO_MODS = Object.freeze({ reloadMult: 1, rpmMult: 1, bulletDamageMult: 1 });

// startReload(w) / updateWeapon(w, dt) predate perks and are called without state (player.js).
// They fall back to the last state seen by tryFire / meleeAttack / updateBullets (main.js calls
// updateBullets every frame), so Speed Cola still applies. Tests reset it via resetWeaponDeps.
let lastState = null;
function remember(state) { if (state && typeof state === 'object') lastState = state; }

function num(v) { return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : 1; }

// Extra export: the weapon-relevant perk multipliers for state.player. Death Machine (a timed
// power-up weapon with fixed stats) ignores perks entirely (WO7 decision, docs/notes/weapons.md).
export function weaponPerkMods(state, w) {
  if (w && w.def && w.def.id === 'deathmachine') return NO_MODS;
  const p = state && state.player;
  if (!p || typeof playerMod.perkMods !== 'function') return NO_MODS;
  let m;
  try { m = playerMod.perkMods(p); } catch { return NO_MODS; }
  if (!m) return NO_MODS;
  return { reloadMult: num(m.reloadMult), rpmMult: num(m.rpmMult), bulletDamageMult: num(m.bulletDamageMult) };
}

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

// WO7: optional `state` (defaults to the last state seen) for Speed Cola (reloadTime x reloadMult).
export function startReload(w, state = lastState) {
  if (!w || w.def.noReload || w.reloading) return false;
  if (!(w.reserve > 0) || !(w.mag < w.def.mag)) return false;
  remember(state);
  w.reloading = true;
  w.reloadT = w.def.reloadTime * weaponPerkMods(state, w).reloadMult;
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

const TIER2_AMMO_MULT = 0.3;
const TIER3_AMMO_MULT = 0.3;

// WO8: `upgraded` (shop passes isUpgraded(w)) -> PAP.ammoCost at the gun's own wall buy; a gun
// without a wall price stays Infinity (Max Ammo only), upgraded or not. Only a literal true counts.
export function ammoCost(id, upgraded = false) {
  const d = WEAPONS[id];
  if (!d || typeof d.cost !== 'number') return Infinity; // not sold on walls: never affordable
  if (upgraded === true) { // strict: ids.map(ammoCost) passes the index
    // WO8 Phase 4a (economy #5): min(PAP.ammoCost, round(PAP.ammoCostMult x base wall ammo price)).
    const base = ammoCost(id);
    const k = Number.isFinite(PAP.ammoCostMult) && PAP.ammoCostMult > 0 ? PAP.ammoCostMult : Infinity;
    return Number.isFinite(base) && Number.isFinite(k) ? Math.min(PAP.ammoCost, Math.round(k * base)) : PAP.ammoCost;
  }
  // WO5 balance #10: level-2 (tier 2) wall ammo is 0.3x the gun price (level-2 zombies have 1.5x
  // health but still pay 10 per kill); tier-1 guns keep PRICES.wallAmmoMult (0.5).
  // WO7: tier 3 (level-3 walls) uses PERKS.ammoMultTier3 (0.3).
  const mult = d.tier === 3
    ? (PERKS && typeof PERKS.ammoMultTier3 === 'number' ? PERKS.ammoMultTier3 : TIER3_AMMO_MULT)
    : d.tier === 2
      ? (typeof PRICES.wallAmmoMultTier2 === 'number' ? PRICES.wallAmmoMultTier2 : TIER2_AMMO_MULT)
      : PRICES.wallAmmoMult;
  return Math.round(d.cost * mult);
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
// WO7 FIX-5: optional `bossDamage` (default `damage`) is dealt instead to zombies of kind 'boss'.
export function hitscan(state, ox, oy, dx, dy, range, penetration, damage, bossDamage = damage) {
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
    deps.damageZombie(state, z, z.kind === 'boss' ? bossDamage : damage, 'weapon', hx, hy);
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
    if (z.kind === 'boss') {
      if (thunderBoss(state, z, zx, zy, d, d <= cone.killRange)) affected = true;
      continue;
    }
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

// WO5 1.2: knock speed + stun for a slide of `px` pixels under zombie.js's stun physics (velocity
// decays by exp(-knockFriction*t) and stops below stunMinSpeed, so distance = (v0 - min)/k and the
// slide lasts ln(v0/min)/k). The stun equals the slide time, i.e. no stun beyond the push itself;
// zombie.applyKnockback ignores the stun for the boss anyway (3.2) but rejects stun <= 0.
export function bossKnock(px) {
  const k = ZOMBIE.knockFriction, vMin = ZOMBIE.stunMinSpeed;
  if (!(px > 0)) return { speed: 0, stun: 0 };
  if (!(k > 0)) return { speed: px, stun: 1 };
  const speed = px * k + vMin;
  return { speed, stun: vMin > 0 ? Math.log(speed / vMin) / k : 1 };
}

// Thundergun vs boss (WO5 1.2): near cone (within killRange) deals BOSS.thunderNearFrac of the
// boss's max HP and knocks it back BOSS.thunderNearKnock px; far cone only knocks it back
// BOSS.thunderFarKnock px. Never an instant kill, no real stun. Returns true if anything applied.
function thunderBoss(state, z, zx, zy, d, near) {
  let affected = false;
  if (near) {
    const maxHp = Number.isFinite(z.maxHp) && z.maxHp > 0 ? z.maxHp
      : (state.boss && Number.isFinite(state.boss.maxHp) && state.boss.maxHp > 0 ? state.boss.maxHp : z.hp);
    deps.damageZombie(state, z, maxHp * BOSS.thunderNearFrac, 'weapon', z.x, z.y);
    affected = true;
    if (!isAlive(z)) return true;
  }
  const px = near ? BOSS.thunderNearKnock : BOSS.thunderFarKnock;
  const ux = d > 1e-6 ? zx / d : 1, uy = d > 1e-6 ? zy / d : 0;
  // Integrator: prefer zombie.pushZombie (exact 60 / 40 px). zombie.applyKnockback on the boss
  // moves min(|v|/k, 60) px, which would give ~40 + stunMinSpeed/k for the far cone.
  const pushed = deps.pushZombie(state, z, ux * px, uy * px);
  if (pushed != null) { if (pushed !== false) affected = true; return affected; }
  const kb = bossKnock(px);
  if (deps.applyKnockback(state, z, ux * kb.speed, uy * kb.speed, kb.stun) !== false) affected = true;
  return affected;
}

export function tryFire(state, w, ox, oy, dx, dy) {
  if (!w) return false;
  remember(state);
  const wasHeld = w.triggerHeld;
  w.triggerHeld = true; // the trigger is being pulled right now

  if (w.reloading) return false;
  if (w.mag <= 0) {
    if (w.reserve > 0) startReload(w, state);
    else if (!wasHeld) emit('weapon:empty', { weaponId: w.id });
    return false;
  }
  if (!w.def.auto && wasHeld) return false;
  if (w.cooldown > 0) return false;

  const d = w.def;
  const mods = weaponPerkMods(state, w);
  // WO7 Double Tap II: rate of fire x rpmMult for every gun (Death Machine exempt, see above).
  const interval = 60 / (d.rpm * mods.rpmMult);
  const bossMult = Math.min(mods.bulletDamageMult,
    BOSS && Number.isFinite(BOSS.dtapDamageMult) ? BOSS.dtapDamageMult : Infinity);
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
      // WO7 Double Tap II: hitscan bullets (incl. shotgun pellets) deal x bulletDamageMult; the
      // Ray Gun projectile and the Thundergun cone above are unchanged.
      // WO7 FIX-5 (balance #1): vs the boss the multiplier is capped at BOSS.dtapDamageMult.
      const res = hitscan(state, ox, oy, Math.cos(a), Math.sin(a), d.range, d.penetration,
        d.damage * mods.bulletDamageMult, d.damage * bossMult * papBossFactor(d, PAP.damageMult));
      if (res.hits.length) anyHit = true;
    }
    if (anyHit && state.stats) state.stats.shotsHit++;
  }

  pushEffect(state, { type: 'muzzle', x: ox, y: oy, angle: baseAngle, size: d.cls === 'shotgun' ? 14 : 9,
    ttl: MUZZLE_TTL, maxTtl: MUZZLE_TTL, color: d.cone ? THUNDERGUN_COLOR : d.projectile ? RAYGUN_COLOR : COLORS.tracer });
  emit('weapon:fired', { weaponId: w.id, x: ox, y: oy, dirX: bx, dirY: by });

  // Auto-reload as soon as the mag runs dry (player may also call startReload; it is idempotent).
  if (w.mag <= 0 && w.reserve > 0) startReload(w, state);
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
  // WO8 Phase 4a (economy #2): an upgraded bolt/splash deals base x BOSS.papDamageMult to the boss.
  const bossDirect = b.def.damage * papBossFactor(b.def, PAP.damageMult);
  const bossSplash = pr.splashDamage * papBossFactor(b.def, PAP.projectileMult);
  if (direct && isAlive(direct)) {
    deps.damageZombie(state, direct, direct.kind === 'boss' ? bossDirect : b.def.damage, 'weapon', x, y);
    hitAny = true;
  }
  const sp = Math.hypot(b.vx || 0, b.vy || 0);
  const ox = sp > 0 ? x - (b.vx / sp) * SPLASH_LOS_BACKOFF : x;
  const oy = sp > 0 ? y - (b.vy / sp) * SPLASH_LOS_BACKOFF : y;
  for (const z of state.zombies || []) {
    if (z === direct || !isAlive(z)) continue;
    if (dist(x, y, z.x, z.y) <= pr.splashRadius + z.radius &&
        splashVisible(state, ox, oy, z.x, z.y, z.radius)) {
      deps.damageZombie(state, z, z.kind === 'boss' ? bossSplash : pr.splashDamage, 'weapon', z.x, z.y);
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
  remember(state);
  const bullets = state.bullets;
  if (!Array.isArray(bullets) || bullets.length === 0) return;
  const keep = [];
  for (const b of bullets) {
    // WO7: acid globs (kind 'acid', Agent H) and anything else without a weapon projectile def
    // share state.bullets; they are not ours to move or detonate, keep them untouched.
    if (!b || b.kind === 'acid' || !b.def || !b.def.projectile) { if (b) keep.push(b); continue; }
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

// ---------------------------------------------------------------------------
// WO7 T3: knife (1.3 / 3.3)
// ---------------------------------------------------------------------------

const SLASH_TTL = 0.18;
const MELEE_DEFAULTS = Object.freeze({ damage: 150, cooldown: 0.5, reach: 44, halfAngle: 0.7, maxTargets: 3,
  knockback: 90, swingTime: 0.25, bonusPoints: 5 });
function meleeCfg() { return { ...MELEE_DEFAULTS, ...(MELEE || {}) }; }

function activeWeaponOf(p) {
  if (typeof playerMod.getActiveWeapon === 'function') {
    try { return playerMod.getActiveWeapon(p); } catch { /* fall through */ }
  }
  return p.tempWeapon || (Array.isArray(p.weapons) ? p.weapons[p.activeSlot | 0] : null) || null;
}

// Knife swing. Respects player.meleeCd (no swing while > 0, or while the player is down), sets
// meleeCd = MELEE.cooldown and meleeT = MELEE.swingTime, cancels an active reload (BO3 rule),
// pushes a 'slash' effect and emits melee:swing, then hits up to MELEE.maxTargets live zombies
// (nearest first) whose edge is within MELEE.reach of the player's edge, within MELEE.halfAngle
// of player.angle, and in line of sight (walls, windows, doors block, same test as the ray gun
// splash / Thundergun). Damage MELEE.damage via damageZombie (cause 'weapon', so kills pay
// POINTS.perKill and can drop power-ups; Insta-Kill and the boss per-hit cap apply inside
// damageZombie; Double Tap does not). Survivors are knocked back at MELEE.knockback px/s with a
// stun equal to the slide time (boss: pushed by the same slide distance, no stun). Emits
// melee:hit { zombieId, killed } per target (player.js pays MELEE.bonusPoints on killed).
// Returns the number of zombies hit (0 when the swing was refused or whiffed).
export function meleeAttack(state, player) {
  remember(state);
  const p = player || (state && state.player);
  if (!p) return 0;
  if (p.meleeCd > 0 || p.downT > 0 || p.down) return 0;
  const M = meleeCfg();
  p.meleeCd = M.cooldown;
  p.meleeT = M.swingTime;

  const w = activeWeaponOf(p);
  if (w && w.reloading) { w.reloading = false; w.reloadT = 0; }

  const angle = Number.isFinite(p.angle) ? p.angle : 0;
  const pr = Number.isFinite(p.radius) ? p.radius : 0;
  const ox = p.x, oy = p.y;
  pushEffect(state, { type: 'slash', x: ox, y: oy, angle, ttl: SLASH_TTL, maxTtl: SLASH_TTL });
  emit('melee:swing', { x: ox, y: oy, angle });

  const cands = [];
  for (const z of (state && state.zombies) || []) {
    if (!isAlive(z)) continue;
    const zx = z.x - ox, zy = z.y - oy;
    const d = Math.hypot(zx, zy);
    const zr = Number.isFinite(z.radius) ? z.radius : 0;
    if (d - zr - pr > M.reach) continue;
    if (d > 1e-6 && Math.abs(angleDiff(Math.atan2(zy, zx), angle)) > M.halfAngle) continue;
    if (!splashVisible(state, ox, oy, z.x, z.y, zr)) continue;
    cands.push({ z, d, zx, zy });
  }
  cands.sort((a, b) => a.d - b.d);
  const targets = cands.slice(0, Math.max(0, M.maxTargets | 0));

  const vMin = ZOMBIE.stunMinSpeed, k = ZOMBIE.knockFriction;
  const kb = M.knockback;
  const slidePx = k > 0 ? Math.max(0, (kb - vMin) / k) : 0;
  const stun = (k > 0 && vMin > 0 && kb > vMin) ? Math.log(kb / vMin) / k : 0;

  let hits = 0;
  for (const { z, d, zx, zy } of targets) {
    if (!isAlive(z)) continue;
    const ux = d > 1e-6 ? zx / d : Math.cos(angle), uy = d > 1e-6 ? zy / d : Math.sin(angle);
    const zr = Number.isFinite(z.radius) ? z.radius : 0;
    const hx = z.x - ux * zr, hy = z.y - uy * zr;
    const res = deps.damageZombie(state, z, M.damage, 'weapon', hx, hy);
    const killed = res === true || !isAlive(z);
    hits++;
    if (!killed && kb > 0) {
      if (z.kind === 'boss') {
        const pushed = slidePx > 0 ? deps.pushZombie(state, z, ux * slidePx, uy * slidePx) : false;
        if (pushed == null && stun > 0) deps.applyKnockback(state, z, ux * kb, uy * kb, stun);
      } else if (stun > 0) {
        deps.applyKnockback(state, z, ux * kb, uy * kb, stun);
      }
    }
    emit('melee:hit', { zombieId: z.id, killed });
  }
  return hits;
}
