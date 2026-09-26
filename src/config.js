export const CANVAS = { width: 1280, height: 720 };
// Camera zoom: world px per screen px = 1/zoom. Touch devices see a closer view (WO6 follow-up).
export const CAMERA = { zoom: 1, mobileZoom: 1.96 };
export const TILE = 40;                       // world units (px) per map tile
export const FIXED_DT_CAP = 1 / 30;           // clamp big frame gaps

export const POINTS = {
  perKill: 10,          // mandated by the order
  perHit: 0,
  nukeBonus: 40,
  carpenterBonus: 20,
  barricadeBoard: 1,
  barricadeBoardsPerRoundCap: 10,
};

export const PLAYER = {
  radius: 14, speed: 220, sprintMult: 1.35,
  maxHealth: 150, regenDelay: 4.0, regenPerSec: 1,   // WO3: 60 -> 1 HP/s (full heal from 1 HP ~150 s)
  interactRange: 64, weaponSlots: 2,
  startWeapon: 'mr6',
  muzzleOffset: 4,      // shots originate radius + muzzleOffset along the aim (player.js)
};

export const ZOMBIE = {
  radius: 14,
  speeds: { walk: 70, jog: 130, sprint: 195 },   // sprint 210 -> 195 (Phase 4, balance #6)
  damage: 50, attackRange: 34, attackWindup: 0.35, attackCooldown: 1.0,
  baseHealth: 150, healthPerRound: 100, roundsLinear: 9, healthMultAfter: 1.1,
  boardTearTime: 1.0,
  maxAlive: 24,
  separationRadius: 26, separationForce: 120,   // steering: summed push is capped at separationForce (px/s)
  // Phase 4: hard zombie-zombie spacing (positional overlap resolution after movement).
  separationMinDist: 28,  // centre distance kept between zombies in the play area (2 x radius)
  separationMaxPush: 6,   // max px a zombie is displaced by overlap resolution per frame
  separationIters: 2,     // relaxation passes per frame
  deathLinger: 0.6,      // seconds a corpse fades
  // Consolidated from zombie.js (Phase 2):
  hitFlash: 0.08,        // seconds a hit zombie flashes white
  speedJitter: 0.10,     // +-10% per-zombie speed variation
  wanderMin: 1.0, wanderMax: 2.0,  // seconds between Zombie Blood wander direction picks
  wanderSpeedMult: 0.5,  // wandering zombies shamble at half speed
  bloodHitTtl: 0.6,      // small blood splat per hit
  bloodDeathTtl: 6.0,    // death decal lingers longer than the corpse
  // WO2 (Agent H): Thundergun knockback.
  knockFriction: 6,      // exponential decay rate of knock velocity (1/s)
  stunMinSpeed: 20,      // knock speed (px/s) below which the slide stops
  // WO5 FIX-2 (balance #3): hard cap on a normal zombie's speed after tier x speedMult x jitter,
  // just under the player's 220 walk so the player can always back-pedal while firing.
  // Minions are capped at BOSS.minion.maxSpeedMult x this.
  maxSpeed: 214,
};

export const ROUNDS = {
  earlyCounts: [6, 8, 13, 18, 24, 27, 28, 28, 29],   // rounds 1..9 (BO3 solo)
  breakSeconds: 8,
  firstRoundDelay: 3,
  spawnIntervalStart: 2.0, spawnIntervalMin: 0.5, spawnIntervalDecayPerRound: 0.93,
  nearSpawnRadius: 900,  // prefer spawn points within this distance of the player
  nearSpawnWeight: 4,    // how much more likely a near spawn point is
};

export const POWERUPS = {
  dropChance: 0.02, maxPerRound: 4, lifetime: 30, blinkAt: 10, pickupRadius: 28,
  duration: { instaKill: 30, doublePoints: 30, fireSale: 30, deathMachine: 30, zombieBlood: 30 },
  weights: { instaKill: 3, doublePoints: 3, maxAmmo: 3, nuke: 2, carpenter: 2, fireSale: 1, deathMachine: 1, zombieBlood: 1 },
  nukeSpawnPause: 3,
  nukeStagger: 0.08,     // seconds between successive zombie deaths during a nuke
};

export const PRICES = { mysteryBox: 95, fireSaleBox: 10, wallAmmoMult: 0.5 };
export const MYSTERY_BOX = { spinSeconds: 3, offerSeconds: 10 };

export const COLORS = {
  floor: '#2a2a2e', wall: '#0e0e10', wallEdge: '#3c3c44',
  player: '#e8e8f0', zombieWalk: '#5f7a3a', zombieJog: '#7a8a2f', zombieSprint: '#9a6a2a',
  blood: '#7a1010', powerupGlow: '#6cf542', tracer: '#ffd27a',
  hudText: '#f2f2f2', hudPoints: '#ffd54a', hudRound: '#d21f1f',
};

// ---------------------------------------------------------------------------
// Phase 2 (Integrator): constants consolidated from TODO(integrator) markers in modules.
// ---------------------------------------------------------------------------

export const MAP = {
  maxBoards: 6,          // boards per barricade (map.js)
};

export const SHOP = {
  repairInterval: 0.8,   // seconds of holding F per rebuilt board
  boxCycleInterval: 0.1, // seconds between cosmetic weapon swaps while the box spins
  boxWeights: { wall: 3, boxOnly: 2, wonder: 1 },  // mystery box roll weights (shop.js + weapons.BOX_WEIGHTS)
};

export const WEAPON_FX = {
  defaultRange: 1400,
  tracerTtl: 0.06, muzzleTtl: 0.05, explosionTtl: 0.35,
  bulletRadius: 4,       // ray gun projectile collision radius
  selfSplashMult: 0.1,   // ray gun splash fraction applied to the player
  raygunColor: '#6cf542',
  shockwaveTtl: 0.45,
  thundergunShake: { ttl: 0.5, magnitude: 10 },
};

export const RENDER = {
  effectCap: 400,
  textTtl: 0.8, textRise: 30,
  damageShake: { ttl: 0.3, magnitude: 4 },
  nukeShake: { ttl: 0.5, magnitude: 8 },
  zombieBloodTint: 'rgba(255,120,40,0.06)',   // flat tint; edge vignette carries the rest (Phase 4)
  damageVignetteMax: 0.7,     // damage vignette alpha at 0 hp
  damageWithZbMult: 0.6,      // damage vignette scale while Zombie Blood is active
  // WO5 (moved from render.js by the integrator): boss / mega door effects and sprite scales.
  bossStartShake: { ttl: 0.9, magnitude: 10 },
  bossDeathShake: { ttl: 0.8, magnitude: 12 },
  bossDeathFlash: { ttl: 0.4, maxTtl: 0.65 },   // starts at ~60 % white
  megaDoorShake: { ttl: 0.6, magnitude: 5 },
  bossRingTtl: 0.6,   // boss death shock ring; the pool is zombie.js's boss blood effect (FIX-3)
  bossScale: 2.4, minionScale: 0.7,
};

export const AUDIO = {
  masterGain: 0.5,
  categoryGain: { guns: 0.55, zombies: 0.6, player: 0.8, ui: 0.6, world: 0.6 },
  maxGunVoices: 8,
  emptyClickMinInterval: 0.18, zombieHitMinInterval: 0.03, groanMinInterval: 0.05, deniedMinInterval: 0.25,
  // WO2 3.11 Thundergun: own bus (bypasses the gun limiter), concurrent boom cap, delayed body thud.
  thunderBusGain: 1.0, maxThunderVoices: 2, thunderThudDelay: 0.12,
  bossHitMinInterval: 0.12,  // WO5: min seconds between boss hit thuds (moved from audio.js)
};

export const INPUT = {
  wheelThreshold: 1,     // min |deltaY| per wheel step
};

export const LOOP = {
  flowRebuildInterval: 0.2,  // seconds between flow field rebuilds (main.js, 3.7)
};

// WO2 3.3 — pixel-art sprites (Phase 0, frozen). Read by src/sprites/*, render.js, hud.js.
export const SPRITES = {
  scale: 2,             // sprite px -> world px
  directions: 32,       // rotation quantization steps (0 = continuous)
  strideLength: 80,     // world px per full 8-frame walk cycle. WO4 run gait: a planted boot moves back 5 sprite px (= 10 world px) per frame, so 8 x 10 = 80 keeps it still on the ground (0.36 s cycle at walk speed 220). FIX-1: 48, v1: 72
  sprintCycleMult: 1,   // WO4: 1 (was 1.5) so the planted boot does not skid at sprint speed either
  legTurnRate: 900,     // WO4: deg/s cap on how fast the legs turn toward movement / aim
  backpedalEnter: 100,  // WO4: movement more than this many deg from the aim -> backpedal (legs face movement + 180, cycle reversed)
  backpedalExit: 80,    // WO4: ...and back to forward walking below this (hysteresis)
  recoilPx: 3,          // torso/gun kickback in sprite px (light guns); heavy = x1.6
  recoilTime: 0.06,
  reloadFrameTime: 0.25,
  faceScale: 4,
  face: { glanceMin: 1.0, glanceMax: 3.0, blinkMin: 3.0, blinkMax: 6.0, blinkTime: 0.12, winceTime: 0.4, grinTime: 1.0 },
};

// ---------------------------------------------------------------------------
// WO5 3.8 (Phase 0) — mega door, boss arena, multi-level dungeon.
// ---------------------------------------------------------------------------

export const DOORS = { megaCost: 250 };

export const BOSS = {
  radius: 34, speed: 90, damage: 75, attackWindup: 0.5, attackCooldown: 1.4,
  baseHealth: 4500, roundScale: 0.12,   // FIX-2 (balance #4): 4000 -> 4500
  roundScaleCap: 12,     // FIX-2 (balance #4): round factor uses min(round, roundScaleCap)
  points: 200,           // total per boss kill: POINTS.perKill via player.js + (points - perKill) from boss.finishFight
  deathLinger: 2.0,
  chargeEvery: 7, chargeTelegraph: 0.6, chargeSpeedMult: 3.5, chargeMaxTime: 1.1, chargeRecover: 0.4,
  chargeKnockback: 40, summonEvery: 12, minionsPerWave: 4, maxMinions: 10,
  instaKillFrac: 0.05,   // unused since FIX-2 (kept for the contract test); see instaKillMult
  nukeFrac: 0.10, thunderNearFrac: 0.08, thunderNearKnock: 60, thunderFarKnock: 40,  // FIX-2 (#9): near 0.15 -> 0.08
  // FIX-2 (review M1, balance #7/#8/#6/#13):
  instaKillMult: 2,      // Insta-Kill doubles damage to the boss (replaces the 5 % per-hit floor; deviates from 1.2)
  maxHitFrac: 0.03,      // any single hit on the boss is capped at 3 % of max HP (nuke / Thundergun near share exempt)
  ammoDropAtFrac: 0.5,   // one Max Ammo drops the first time the boss falls below this HP fraction
  minionsLevelCap: 2,    // extra minions per wave = min(levelIndex, minionsLevelCap)
  minion: {
    radius: 10, speedMult: 1.1,
    healthFrac: 0.45,    // unused since FIX-2 (kept for the contract test); see health
    health: 300,         // FIX-2 (balance #5): minion HP = health x level healthMult
    maxSpeedMult: 1.1,   // FIX-2: minion speed capped at ZOMBIE.maxSpeed x this
    damage: 25, attackCooldown: 0.8,
  },
};

export const LEVELS_CFG = {
  fadeSeconds: 1.2,
  // Per descent past the last authored level, compounding on the previous level (WO5 FIX-1,
  // QA balance #1/#2): health x1.2, count x1.1, speed x1.03 (capped at speedMultCap),
  // sprintShift +2. Every factor strictly increases each descent (speed until the cap).
  loop: { healthMult: 1.2, countMult: 1.1, speedMult: 1.03, sprintShift: 2, speedMultCap: 1.15 },
  // First break after a descent (seconds; replaces ROUNDS.firstRoundDelay there). The player is
  // also healed to full on arrival (QA playtest #4).
  arrivalBreak: 10,
};
