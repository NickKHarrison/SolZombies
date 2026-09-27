// Contract tests (Agent M). Asserts the public surface described in WORK_ORDER.md Section 3.
// These tests check SHAPE (names and kinds of exports), not behaviour. Behaviour lives in each
// module's own tests/<module>.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as config from '../src/config.js';
import * as events from '../src/events.js';
import * as math from '../src/math.js';
import * as stateMod from '../src/state.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const F = 'function';
const OBJ = 'object';   // plain non-null, non-array object
const ARR = 'array';

function kindOf(v) {
  if (Array.isArray(v)) return ARR;
  if (v === null) return 'null';
  return typeof v;
}

function assertExports(mod, spec, label) {
  for (const [name, kind] of Object.entries(spec)) {
    assert.ok(name in mod, `${label}: missing export "${name}"`);
    assert.equal(kindOf(mod[name]), kind, `${label}: export "${name}" should be ${kind}, got ${kindOf(mod[name])}`);
  }
}

/**
 * Remove comments from JS source. With blankStrings=true, string and template literal contents
 * are also blanked (quotes kept) so words inside strings do not count as references.
 * Simple scanner: handles '..', "..", `..` (without ${} nesting awareness), line and block
 * comments. Regex literals are not specially handled (acceptable for this codebase).
 */
function stripComments(src, blankStrings = false) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') {
          if (!blankStrings) out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (src[i] === '\n' && q !== '`') break; // unterminated; bail
        if (!blankStrings || src[i] === '\n') out += src[i];
        i++;
      }
      if (i < n && src[i] === q) { out += q; i++; }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function readSrc(file) {
  return readFileSync(join(SRC_DIR, file), 'utf8');
}

// ---------------------------------------------------------------------------------------------
// 3.1 config.js
// ---------------------------------------------------------------------------------------------

const CONFIG_SPEC = {
  CANVAS: { width: 'number', height: 'number' },
  POINTS: {
    perKill: 'number', perHit: 'number', nukeBonus: 'number', carpenterBonus: 'number',
    barricadeBoard: 'number', barricadeBoardsPerRoundCap: 'number',
  },
  PLAYER: {
    radius: 'number', speed: 'number', sprintMult: 'number', maxHealth: 'number',
    regenDelay: 'number', regenPerSec: 'number', interactRange: 'number', weaponSlots: 'number',
    startWeapon: 'string',
  },
  ZOMBIE: {
    radius: 'number', speeds: OBJ, damage: 'number', attackRange: 'number',
    attackWindup: 'number', attackCooldown: 'number', baseHealth: 'number',
    healthPerRound: 'number', roundsLinear: 'number', healthMultAfter: 'number',
    boardTearTime: 'number', maxAlive: 'number', separationRadius: 'number',
    separationForce: 'number', deathLinger: 'number',
  },
  ROUNDS: {
    earlyCounts: ARR, breakSeconds: 'number', firstRoundDelay: 'number',
    spawnIntervalStart: 'number', spawnIntervalMin: 'number', spawnIntervalDecayPerRound: 'number',
    nearSpawnRadius: 'number', nearSpawnWeight: 'number',
  },
  POWERUPS: {
    dropChance: 'number', maxPerRound: 'number', lifetime: 'number', blinkAt: 'number',
    pickupRadius: 'number', duration: OBJ, weights: OBJ, nukeSpawnPause: 'number', nukeStagger: 'number',
  },
  PRICES: { mysteryBox: 'number', fireSaleBox: 'number', wallAmmoMult: 'number' },
  MYSTERY_BOX: { spinSeconds: 'number', offerSeconds: 'number' },
  COLORS: {
    floor: 'string', wall: 'string', wallEdge: 'string', player: 'string', zombieWalk: 'string',
    zombieJog: 'string', zombieSprint: 'string', blood: 'string', powerupGlow: 'string',
    tracer: 'string', hudText: 'string', hudPoints: 'string', hudRound: 'string',
  },
};

test('3.1 config.js: scalar exports', () => {
  assertExports(config, { TILE: 'number', FIXED_DT_CAP: 'number' }, 'config');
});

test('3.1 config.js: object exports and their keys', () => {
  for (const [name, keys] of Object.entries(CONFIG_SPEC)) {
    assert.equal(kindOf(config[name]), OBJ, `config.${name} should be an object`);
    for (const [key, kind] of Object.entries(keys)) {
      assert.equal(kindOf(config[name][key]), kind, `config.${name}.${key} should be ${kind}`);
    }
  }
  for (const k of ['walk', 'jog', 'sprint']) {
    assert.equal(typeof config.ZOMBIE.speeds[k], 'number', `config.ZOMBIE.speeds.${k}`);
  }
  const ptypes = ['instaKill', 'doublePoints', 'maxAmmo', 'nuke', 'carpenter', 'fireSale', 'deathMachine', 'zombieBlood'];
  for (const t of ptypes) assert.equal(typeof config.POWERUPS.weights[t], 'number', `POWERUPS.weights.${t}`);
  for (const t of ['instaKill', 'doublePoints', 'fireSale', 'deathMachine', 'zombieBlood']) {
    assert.equal(typeof config.POWERUPS.duration[t], 'number', `POWERUPS.duration.${t}`);
  }
  assert.equal(config.POINTS.perKill, 10, 'POINTS.perKill is mandated to be 10');
});

// ---------------------------------------------------------------------------------------------
// 3.2 events.js
// ---------------------------------------------------------------------------------------------

const CANONICAL_EVENTS = [
  'round:start', 'round:end',
  'zombie:spawned', 'zombie:hit', 'zombie:killed',
  'player:damaged', 'player:down',
  'points:changed',
  'weapon:fired', 'weapon:reload', 'weapon:empty', 'weapon:equipped',
  'powerup:spawned', 'powerup:collected', 'powerup:expired',
  'purchase:made', 'purchase:denied',
  'box:opened',
  'barricade:board',
  'game:start', 'game:over', 'game:restart',
  // WO5 3.7
  'boss:start',     // { name, maxHp, level }   boss.js
  'boss:charge',    // { x, y }                 zombie.js (charge telegraph start)
  'boss:defeated',  // { name, level }          boss.js
  'level:start',    // { index, name, loop }    level.js
  'level:descend',  // { from, to }             level.js
  // WO7 3.2 (purchase:made / purchase:denied also gain kind 'perk')
  'perk:bought',     // { perkId, cost }                                shop.js
  'perk:lost',       // { perkId, reason: 'revive' | 'debug' }          player.js
  'player:downed',   // { reviveIn }                                    player.js (Quick Revive path only)
  'player:revived',  // { health }                                      player.js
  'melee:swing',     // { x, y, angle }                                 weapons.js
  'melee:hit',       // { zombieId, killed }                            weapons.js
  'boss:spit',       // { x, y }                                        zombie.js (acid telegraph start)
  'score:recorded',  // { rank, entry, isBestRound, isBestPoints }      main.js
  // WO8 3 (purchase:made / purchase:denied also gain kind 'pap')
  'pap:start',       // { weaponId, slot }                              shop.js
  'pap:done',        // { weaponId }  (when the upgraded gun is taken)  shop.js
];

test('3.2 events.js: exports', () => {
  assertExports(events, { on: F, off: F, emit: F, clearAll: F }, 'events');
});

test('3.2 events.js: on() returns an unsubscribe function', () => {
  events.clearAll();
  let hits = 0;
  const unsub = events.on('contracts:probe', () => hits++);
  assert.equal(typeof unsub, F);
  events.emit('contracts:probe', {});
  unsub();
  events.emit('contracts:probe', {});
  assert.equal(hits, 1);
  events.clearAll();
});

test('3.2 every literal emit(\'...\') in src/*.js uses a canonical event name', () => {
  const files = [
    ...readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')),
    ...readdirSync(join(SRC_DIR, 'sprites')).filter((f) => f.endsWith('.js')).map((f) => `sprites/${f}`),
    ...readdirSync(join(SRC_DIR, 'levels')).filter((f) => f.endsWith('.js')).map((f) => `levels/${f}`), // WO5
  ];
  const re = /\bemit\s*\(\s*(['"`])([^'"`]*)\1/g;
  const bad = [];
  for (const f of files) {
    const code = stripComments(readSrc(f), false);
    for (const m of code.matchAll(re)) {
      if (!CANONICAL_EVENTS.includes(m[2])) bad.push(`${f}: '${m[2]}'`);
    }
  }
  assert.deepEqual(bad, [], `non-canonical event names emitted:\n  ${bad.join('\n  ')}`);
});

// ---------------------------------------------------------------------------------------------
// 3.3 math.js
// ---------------------------------------------------------------------------------------------

test('3.3 math.js: exports', () => {
  assertExports(math, {
    len: F, norm: F, dist: F, clamp: F, lerp: F, angleTo: F,
    circleHitsCircle: F, circleHitsRect: F, rayCircle: F, rayRect: F,
    createRng: F, nextId: F,
  }, 'math');
});

test('3.3 math.js: createRng() returns the documented methods; nextId increases', () => {
  const rng = math.createRng(123);
  for (const m of ['next', 'range', 'int', 'pick', 'chance', 'weighted']) {
    assert.equal(typeof rng[m], F, `rng.${m} should be a function`);
  }
  const a = math.nextId();
  const b = math.nextId();
  assert.ok(b > a, 'nextId is monotonically increasing');
});

// ---------------------------------------------------------------------------------------------
// 3.4 state.js
// ---------------------------------------------------------------------------------------------

test('3.4 state.js: createEmptyState exists and returns the canonical shape', () => {
  assertExports(stateMod, { createEmptyState: F }, 'state');
  const s = stateMod.createEmptyState(7);
  const shape = {
    phase: 'string', time: 'number', dt: 'number', rng: OBJ, seed: 'number', camera: OBJ,
    map: 'null', player: 'null', zombies: ARR, bullets: ARR, effects: ARR, flow: 'null',
    rounds: 'null', powerups: OBJ, shop: OBJ, stats: OBJ, debug: 'boolean',
  };
  for (const [k, kind] of Object.entries(shape)) {
    assert.ok(k in s, `state.${k} missing`);
    assert.equal(kindOf(s[k]), kind, `state.${k} should be ${kind}`);
  }
  assert.equal(s.phase, 'menu');
  assert.equal(s.seed, 7);
  assert.deepEqual(s.camera, { x: 0, y: 0 });
  assert.equal(kindOf(s.powerups.items), ARR);
  assert.equal(kindOf(s.powerups.active), OBJ);
  assert.equal(typeof s.powerups.dropsThisRound, 'number');
  assert.ok('nuke' in s.powerups);
  assert.ok('prompt' in s.shop);
  assert.deepEqual(Object.keys(s.shop.box).sort(), ['state', 'timer', 'weaponId']);
  for (const k of ['kills', 'shotsFired', 'shotsHit', 'pointsEarned', 'roundReached']) {
    assert.equal(typeof s.stats[k], 'number', `state.stats.${k}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 3.6 module APIs
// ---------------------------------------------------------------------------------------------

const MODULE_SPEC = {
  input: { dom: true, exports: { initInput: F, getInput: F, endFrame: F } },
  player: {
    dom: false,
    exports: {
      createPlayer: F, initPlayer: F, updatePlayer: F, damagePlayer: F, addPoints: F,
      spendPoints: F, getActiveWeapon: F, giveWeapon: F, hasWeapon: F,
      equipTemporary: F, clearTemporary: F,
    },
  },
  weapons: {
    dom: false,
    exports: {
      WEAPONS: OBJ, WALL_WEAPON_IDS: ARR, BOX_WEAPON_IDS: ARR,
      createWeapon: F, updateWeapon: F, tryFire: F, startReload: F, refillReserve: F,
      refillAll: F, createDeathMachine: F, updateBullets: F, ammoCost: F,
    },
  },
  zombie: {
    dom: false,
    exports: {
      spawnZombie: F, updateZombies: F, damageZombie: F, killZombie: F,
      healthForRound: F, tierForRound: F,
    },
  },
  pathfinding: { dom: false, exports: { buildFlowField: F, getFlowDir: F, distanceAt: F } },
  waves: {
    dom: false,
    exports: {
      createRoundState: F, initRounds: F, updateRounds: F, zombiesForRound: F,
      pauseSpawning: F, skipToRound: F,
      spawnPointActive: F, // WO4
    },
  },
  powerups: {
    dom: false,
    exports: {
      POWERUP_TYPES: ARR, POWERUP_LABEL: OBJ,
      initPowerups: F, updatePowerups: F, spawnPowerup: F, applyPowerup: F, isActive: F, timeLeft: F,
    },
  },
  map: {
    dom: false,
    exports: {
      MAP_ASCII: ARR,
      loadMap: F, worldToTile: F, tileToWorld: F, isWalkable: F, resolveCircle: F,
      raycastWalls: F, tearBoard: F, repairBoard: F, repairAll: F, barricadeOpen: F,
      nearestInteractable: F,
      // WO4 buyable doors
      TILE_DOOR: 'number', DOOR_MAP: OBJ, openDoor: F, recomputeActiveSpawns: F, isSpawnActive: F,
    },
  },
  shop: {
    dom: false,
    exports: {
      initShop: F, updateShop: F, buyWallWeapon: F, buyAmmo: F, spinBox: F,
      takeBoxWeapon: F, boxPrice: F,
      buyDoor: F, // WO4
    },
  },
  render: { dom: true, exports: { initRender: F, updateEffects: F, render: F, addEffect: F } },
  hud: { dom: true, exports: { initHud: F, updateHud: F } },
  audio: { dom: true, exports: { initAudio: F, playSfx: F, setMuted: F } },
};

for (const [name, { dom, exports: spec }] of Object.entries(MODULE_SPEC)) {
  test(`3.6 ${name}.js (${dom ? 'DOM' : 'pure'}): imports in Node without throwing and has every contract export`, async () => {
    let mod;
    try {
      mod = await import(`../src/${name}.js`);
    } catch (err) {
      assert.fail(`importing src/${name}.js threw at module load: ${err && err.name}: ${err && err.message}\n${err && err.stack}`);
    }
    assertExports(mod, spec, `${name}.js`);
  });
}

// ---------------------------------------------------------------------------------------------
// Rule 4 / Rule 6: pure modules must not touch the DOM or Math.random
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_IN_PURE = [
  { label: 'window', re: /(?<![.\w$])window\b/ },
  { label: 'document', re: /(?<![.\w$])document\b/ },
  { label: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/ },
  { label: 'Math.random', re: /\bMath\s*\.\s*random\b/ },
];

// WO2 rule 4: every src/sprites/*.js except pixel.js is pure (pixel.js may touch the DOM lazily).
const PURE_FILES = [
  ...Object.entries(MODULE_SPEC).filter(([, { dom }]) => !dom).map(([name]) => name),
  'sprites/palette', 'sprites/soldier', 'sprites/guns', 'sprites/face', 'sprites/animator',
  // WO5 rule: boss.js, level.js, levels/*.js are pure
  'boss', 'level', 'levels/levels', 'levels/level1', 'levels/level2',
  // WO7: new pure modules (scores.js only touches globalThis.localStorage, guarded)
  'sprites/zombie', 'scores', 'levels/level3',
];

for (const name of PURE_FILES) {
  test(`rule 4/6: src/${name}.js does not reference window/document/requestAnimationFrame/Math.random`, () => {
    const code = stripComments(readSrc(`${name}.js`), true);
    const lines = code.split('\n');
    const hits = [];
    for (const { label, re } of FORBIDDEN_IN_PURE) {
      lines.forEach((line, i) => { if (re.test(line)) hits.push(`line ${i + 1}: ${label}`); });
    }
    assert.deepEqual(hits, [], `src/${name}.js forbidden references:\n  ${hits.join('\n  ')}`);
  });
}

test('stripComments helper: removes comments, keeps code, optionally blanks strings', () => {
  const src = "a(); // window\n/* document */ b('window'); c(\"x//y\");";
  const kept = stripComments(src, false);
  assert.ok(!kept.includes('// window'));
  assert.ok(!kept.includes('document'));
  assert.ok(kept.includes("b('window')"));
  assert.ok(kept.includes('"x//y"'), 'string containing // is not treated as a comment');
  const blanked = stripComments(src, true);
  assert.ok(!blanked.includes('window'));
  assert.ok(blanked.includes("b('')"));
});

// ---------------------------------------------------------------------------------------------
// WORK_ORDER_2 (Agent K): sprite modules 3.1-3.6, SPRITES config 3.3, new exports 3.7/3.9/3.10
// ---------------------------------------------------------------------------------------------

const SPRITE_SPEC = {
  palette: { PALETTE: OBJ },
  pixel: {
    parseGrid: F, compose: F, tint: F, flipX: F, flipY: F, spriteKey: F, toCanvas: F,
    drawSprite: F, quantizeAngle: F, PLACEHOLDER: OBJ, isPlaceholder: F, placeholderSprite: F,
  },
  soldier: { SOLDIER: OBJ },
  guns: { GUN_SPRITES: OBJ, gunSpriteFor: F },
  face: {
    FACE: OBJ, healthTier: F, createFaceState: F, updateFaceState: F, faceEvent: F,
    faceFrameKey: F, composeFace: F,
  },
  animator: { createPlayerAnim: F, updatePlayerAnim: F, noteShot: F, resetPlayerAnim: F },
};

for (const [name, spec] of Object.entries(SPRITE_SPEC)) {
  test(`WO2 3.1-3.6 sprites/${name}.js: imports in Node without throwing and has every contract export`, async () => {
    let mod;
    try {
      mod = await import(`../src/sprites/${name}.js`);
    } catch (err) {
      assert.fail(`importing src/sprites/${name}.js threw at module load: ${err && err.name}: ${err && err.message}\n${err && err.stack}`);
    }
    assertExports(mod, spec, `sprites/${name}.js`);
  });
}

test('WO2 3.3 config.SPRITES shape', () => {
  const S = config.SPRITES;
  assert.equal(kindOf(S), OBJ, 'config.SPRITES should be an object');
  for (const k of ['scale', 'directions', 'strideLength', 'sprintCycleMult', 'recoilPx', 'recoilTime', 'reloadFrameTime', 'faceScale']) {
    assert.equal(typeof S[k], 'number', `SPRITES.${k}`);
  }
  assert.equal(kindOf(S.face), OBJ, 'SPRITES.face');
  for (const k of ['glanceMin', 'glanceMax', 'blinkMin', 'blinkMax', 'blinkTime', 'winceTime', 'grinTime']) {
    assert.equal(typeof S.face[k], 'number', `SPRITES.face.${k}`);
  }
});

test('WO2 3.4-3.6 sprite data shapes (structure only; art checks live in sprites.test.js)', async () => {
  const { SOLDIER } = await import('../src/sprites/soldier.js');
  const { GUN_SPRITES } = await import('../src/sprites/guns.js');
  const { FACE, createFaceState } = await import('../src/sprites/face.js');
  const { createPlayerAnim } = await import('../src/sprites/animator.js');
  for (const k of ['legs', 'torso', 'down', 'shadow']) assert.equal(kindOf(SOLDIER[k]), OBJ, `SOLDIER.${k}`);
  for (const k of ['idle', 'reload', 'anchor', 'hand']) assert.equal(kindOf(SOLDIER.torso[k]), OBJ, `SOLDIER.torso.${k}`);
  for (const k of ['pistol', 'smg', 'ar', 'shotgun', 'sniper', 'lmg', 'raygun', 'thundergun', 'deathmachine', 'default']) {
    const g = GUN_SPRITES[k];
    assert.equal(kindOf(g), OBJ, `GUN_SPRITES.${k}`);
    for (const f of ['sprite', 'grip', 'muzzle']) assert.equal(kindOf(g[f]), OBJ, `GUN_SPRITES.${k}.${f}`);
    assert.equal(typeof g.pose, 'string', `GUN_SPRITES.${k}.pose`);
    assert.equal(typeof g.weight, 'number', `GUN_SPRITES.${k}.weight`);
  }
  for (const k of ['base', 'hair', 'eyes', 'mouth', 'dead']) assert.equal(kindOf(FACE[k]), OBJ, `FACE.${k}`);
  assert.equal(kindOf(FACE.blood), ARR, 'FACE.blood');
  const fs = createFaceState(1);
  for (const k of ['tier', 'look', 'lookT', 'blinkT', 'blinkFor', 'winceT', 'grinT', 'breathe', 'dead', 'rng']) {
    assert.ok(k in fs, `createFaceState(): missing field ${k}`);
  }
  const anim = createPlayerAnim();
  for (const k of ['walkDist', 'legFrame', 'legAngle', 'moving', 'recoil', 'recoilDir', 'reloadFrame', 'reloadT', 'pose', 'lastX', 'lastY', 'initialized']) {
    assert.ok(k in anim, `createPlayerAnim(): missing field ${k}`);
  }
});

// Exports added by Agents G (weapons), H (zombie) and E (render) during WO2 Phase 1.
// EXPECTED TO FAIL until those agents land their changes.
test('WO2 new exports: weapons.WONDER_WEAPON_IDS, zombie.applyKnockback, render.getMuzzleWorld', async () => {
  const weapons = await import('../src/weapons.js');
  const zombie = await import('../src/zombie.js');
  const render = await import('../src/render.js');
  const missing = [];
  if (!Array.isArray(weapons.WONDER_WEAPON_IDS)) missing.push('weapons.WONDER_WEAPON_IDS (array)');
  if (typeof zombie.applyKnockback !== F) missing.push('zombie.applyKnockback (function)');
  if (typeof render.getMuzzleWorld !== F) missing.push('render.getMuzzleWorld (function)');
  assert.deepEqual(missing, [], `missing WO2 exports:\n  ${missing.join('\n  ')}`);
  assert.ok(weapons.WONDER_WEAPON_IDS.includes('raygun') && weapons.WONDER_WEAPON_IDS.includes('thundergun'),
    'WONDER_WEAPON_IDS contains raygun and thundergun');
});

// Config / weapon-def additions by Agents G and H (3.3, 3.9). EXPECTED TO FAIL until they land.
test('WO2 new config and weapon defs: thundergun cone, WEAPON_FX, ZOMBIE knock, box contents', async () => {
  const { WEAPONS, BOX_WEAPON_IDS } = await import('../src/weapons.js');
  assert.equal(typeof config.WEAPON_FX.shockwaveTtl, 'number', 'WEAPON_FX.shockwaveTtl');
  assert.equal(kindOf(config.WEAPON_FX.thundergunShake), OBJ, 'WEAPON_FX.thundergunShake');
  assert.equal(typeof config.ZOMBIE.knockFriction, 'number', 'ZOMBIE.knockFriction');
  assert.equal(typeof config.ZOMBIE.stunMinSpeed, 'number', 'ZOMBIE.stunMinSpeed');
  assert.equal(typeof config.SHOP.boxWeights.wonder, 'number', 'SHOP.boxWeights.wonder');
  assert.equal(kindOf(WEAPONS.thundergun), OBJ, 'WEAPONS.thundergun');
  assert.equal(kindOf(WEAPONS.thundergun.cone), OBJ, 'WEAPONS.thundergun.cone');
  for (const k of ['range', 'killRange', 'halfAngle', 'knockback', 'stun']) {
    assert.equal(typeof WEAPONS.thundergun.cone[k], 'number', `thundergun.cone.${k}`);
  }
  assert.ok(BOX_WEAPON_IDS.includes('thundergun'), 'BOX_WEAPON_IDS includes thundergun');
  assert.ok(!BOX_WEAPON_IDS.includes('deathmachine'), 'Death Machine stays out of the box');
});

// ---------------------------------------------------------------------------------------------
// WORK_ORDER_5 (Agent 0, Phase 0): config 3.8, state additions, new modules 3.2/3.3/3.5
// ---------------------------------------------------------------------------------------------

test('WO5 3.8 config: DOORS, BOSS, LEVELS_CFG', () => {
  assert.equal(kindOf(config.DOORS), OBJ, 'config.DOORS');
  assert.equal(config.DOORS.megaCost, 250);
  const B = config.BOSS;
  assert.equal(kindOf(B), OBJ, 'config.BOSS');
  for (const k of ['radius', 'speed', 'damage', 'attackWindup', 'attackCooldown', 'baseHealth', 'roundScale',
    'points', 'deathLinger', 'chargeEvery', 'chargeTelegraph', 'chargeSpeedMult', 'chargeMaxTime', 'chargeRecover',
    'chargeKnockback', 'summonEvery', 'minionsPerWave', 'maxMinions', 'instaKillFrac', 'nukeFrac',
    'thunderNearFrac', 'thunderNearKnock', 'thunderFarKnock']) {
    assert.equal(typeof B[k], 'number', `BOSS.${k}`);
  }
  assert.equal(kindOf(B.minion), OBJ, 'BOSS.minion');
  for (const k of ['radius', 'speedMult', 'healthFrac', 'damage', 'attackCooldown']) {
    assert.equal(typeof B.minion[k], 'number', `BOSS.minion.${k}`);
  }
  assert.ok(B.points > config.POINTS.perKill, 'boss pays perKill via player.js + (points - perKill) via boss.js');
  const L = config.LEVELS_CFG;
  assert.equal(kindOf(L), OBJ, 'config.LEVELS_CFG');
  assert.equal(typeof L.fadeSeconds, 'number', 'LEVELS_CFG.fadeSeconds');
  for (const k of ['healthMult', 'countMult', 'speedMult', 'sprintShift']) {
    assert.equal(typeof L.loop[k], 'number', `LEVELS_CFG.loop.${k}`);
  }
});

test('WO5 state.js: level, boss, transition default to null', () => {
  const s = stateMod.createEmptyState(1);
  for (const k of ['level', 'boss', 'transition']) {
    assert.ok(k in s, `state.${k} missing`);
    assert.equal(s[k], null, `state.${k} should default to null`);
  }
});

const WO5_MODULE_SPEC = {
  boss: {
    createBossState: F, initBoss: F, updateBoss: F, startFight: F, spawnMinions: F,
    finishFight: F, bossZombie: F, bossHpFrac: F,
  },
  level: {
    createLevelState: F, levelDifficulty: F, startLevel: F, beginDescent: F, updateLevel: F,
    nextLevelIndex: F,
  },
  'levels/levels': { LEVELS: ARR, levelByIndex: F },
  'levels/level1': { LEVEL1: OBJ },
  'levels/level2': { LEVEL2: OBJ },
};

for (const [name, spec] of Object.entries(WO5_MODULE_SPEC)) {
  test(`WO5 ${name}.js (pure): imports in Node without throwing and has every contract export`, async () => {
    let mod;
    try {
      mod = await import(`../src/${name}.js`);
    } catch (err) {
      assert.fail(`importing src/${name}.js threw at module load: ${err && err.name}: ${err && err.message}\n${err && err.stack}`);
    }
    assertExports(mod, spec, `${name}.js`);
  });
}

test('WO5 3.5 level defs: shape', async () => {
  const { LEVELS, levelByIndex } = await import('../src/levels/levels.js');
  assert.ok(LEVELS.length >= 2, 'at least two levels');
  for (const def of LEVELS) {
    for (const k of ['id', 'name']) assert.equal(typeof def[k], 'string', `level.${k}`);
    assert.equal(kindOf(def.ascii), ARR, `${def.id}.ascii`);
    assert.equal(def.ascii.length, 40, `${def.id}: 40 rows`);
    for (const row of def.ascii) assert.equal(row.length, 60, `${def.id}: 60 columns`);
    assert.equal(kindOf(def.wallbuys), OBJ, `${def.id}.wallbuys`);
    assert.equal(kindOf(def.theme), OBJ, `${def.id}.theme`);
    for (const k of ['name', 'floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'doorWood', 'doorIron']) {
      assert.equal(typeof def.theme[k], 'string', `${def.id}.theme.${k}`);
    }
    assert.ok('ambient' in def.theme, `${def.id}.theme.ambient`);
    assert.equal(typeof def.theme.torch, 'boolean', `${def.id}.theme.torch`);
    assert.equal(kindOf(def.boss), OBJ, `${def.id}.boss`);
    assert.equal(typeof def.boss.name, 'string', `${def.id}.boss.name`);
    assert.equal(typeof def.boss.tint, 'string', `${def.id}.boss.tint`);
  }
  assert.equal(LEVELS[0].id, 'bunker');
  assert.equal(LEVELS[1].id, 'catacombs');
  assert.equal(levelByIndex(LEVELS.length), LEVELS[0], 'levelByIndex wraps');
});

// Exports added by Agents A-G in WO5 Phase 1 (3.1-3.5). EXPECTED TO FAIL until they land.
test('WO5 new exports', async () => {
  const map = await import('../src/map.js');
  const waves = await import('../src/waves.js');
  const shop = await import('../src/shop.js');
  const zombie = await import('../src/zombie.js');
  const boss = await import('../src/boss.js');
  const level = await import('../src/level.js');
  const levels = await import('../src/levels/levels.js');
  const { WEAPONS, WALL_WEAPON_IDS } = await import('../src/weapons.js');
  const missing = [];
  const need = (mod, label, name, kind) => {
    if (kindOf(mod[name]) !== kind) missing.push(`${label}.${name} (${kind})`);
  };
  // 3.1 map.js (Agent B)
  for (const f of ['loadMap', 'allDoorsOpen', 'megaDoorUnlockable', 'openMegaDoor', 'sealMegaDoor',
    'unsealMegaDoor', 'openStairs', 'inArena', 'isBossActiveBlocking']) need(map, 'map', f, F);
  need(map, 'map', 'TILE_ARENA_SPAWN', 'number');
  need(map, 'map', 'TILE_STAIRS', 'number');
  if (map.TILE_ARENA_SPAWN !== undefined && map.TILE_ARENA_SPAWN !== 8) missing.push('map.TILE_ARENA_SPAWN === 8');
  if (map.TILE_STAIRS !== undefined && map.TILE_STAIRS !== 9) missing.push('map.TILE_STAIRS === 9');
  // 3.2 zombie.js / boss.js (Agent C)
  for (const f of ['spawnZombie', 'updateZombies', 'damageZombie', 'killZombie', 'healthForRound',
    'tierForRound', 'applyKnockback']) need(zombie, 'zombie', f, F);
  for (const f of ['createBossState', 'initBoss', 'updateBoss', 'startFight', 'spawnMinions',
    'finishFight', 'bossZombie', 'bossHpFrac']) need(boss, 'boss', f, F);
  // 3.3 waves.js / shop.js / level.js (Agent G)
  need(waves, 'waves', 'endRoundNow', F);
  need(shop, 'shop', 'buyMegaDoor', F);
  need(shop, 'shop', 'useStairs', F);
  for (const f of ['createLevelState', 'levelDifficulty', 'startLevel', 'beginDescent', 'updateLevel',
    'nextLevelIndex']) need(level, 'level', f, F);
  // 3.4 weapons.js (Agent D): new guns + level-2 wall prices
  const NEW_GUNS = { manowar: 250, xr2: 225, weevil: 200, marshal16: 225, gorgon: 300, dredge48: 275, haymaker12: 250, drakon: 300 };
  for (const [id, cost] of Object.entries(NEW_GUNS)) {
    if (kindOf(WEAPONS[id]) !== OBJ) { missing.push(`WEAPONS.${id}`); continue; }
    if (WEAPONS[id].cost !== cost) missing.push(`WEAPONS.${id}.cost === ${cost}`);
    if (!WALL_WEAPON_IDS.includes(id)) missing.push(`WALL_WEAPON_IDS includes ${id}`);
  }
  // 3.5 levels (Agent A)
  need(levels, 'levels', 'LEVELS', ARR);
  need(levels, 'levels', 'levelByIndex', F);
  assert.deepEqual(missing, [], `missing WO5 exports:\n  ${missing.join('\n  ')}`);
});

// ---------------------------------------------------------------------------------------------
// WORK_ORDER_7 (Agent 0, Phase 0): config 3.1, state additions, new modules 3.3
// ---------------------------------------------------------------------------------------------

test('WO7 3.1 config: PERKS, MELEE, SCORES, BOSS.acid, SPRITES strides', () => {
  const P = config.PERKS;
  assert.equal(kindOf(P), OBJ, 'config.PERKS');
  assert.equal(P.maxPerks, 4);
  assert.equal(P.ammoMultTier3, 0.3);
  assert.deepEqual(Object.keys(P.list).sort(), ['dtap', 'jugg', 'mule', 'revive', 'speed', 'stamin']);
  const letters = new Set();
  for (const [id, p] of Object.entries(P.list)) {
    for (const k of ['name', 'letter', 'color']) assert.equal(typeof p[k], 'string', `PERKS.list.${id}.${k}`);
    assert.equal(typeof p.cost, 'number', `PERKS.list.${id}.cost`);
    assert.match(p.color, /^#[0-9a-f]{6}$/i, `PERKS.list.${id}.color`);
    letters.add(p.letter);
  }
  assert.deepEqual([...letters].sort(), ['C', 'J', 'K', 'N', 'Q', 'U']);
  assert.equal(P.list.jugg.maxHealth, 250);
  assert.equal(P.list.revive.maxUses, 3);
  assert.equal(P.list.mule.weaponSlots, 3);
  const M = config.MELEE;
  for (const k of ['damage', 'cooldown', 'reach', 'halfAngle', 'maxTargets', 'knockback', 'swingTime', 'bonusPoints']) {
    assert.equal(typeof M[k], 'number', `MELEE.${k}`);
  }
  assert.equal(M.bonusPoints + config.POINTS.perKill, 15, 'knife kills pay 15');
  assert.deepEqual(config.SCORES, { key: 'solzombies.scores.v1', max: 10 });
  for (const k of ['every', 'telegraph', 'globs', 'spread', 'flight', 'poolRadius', 'poolSeconds', 'dps']) {
    assert.equal(typeof config.BOSS.acid[k], 'number', `BOSS.acid.${k}`);
  }
  assert.equal(typeof config.SPRITES.zombieStride, 'number');
  assert.equal(typeof config.SPRITES.bossStride, 'number');
});

test('WO7 state.js: stats additions and hazards', () => {
  const s = stateMod.createEmptyState(1);
  assert.deepEqual(s.hazards, []);
  for (const k of ['timeSurvived', 'levelReached', 'bossesKilled', 'powerupsCollected', 'doorsOpened', 'meleeKills', 'perksBought']) {
    assert.equal(typeof s.stats[k], 'number', `state.stats.${k}`);
  }
  assert.equal(s.stats.levelReached, 1);
  assert.ok('bestWeaponId' in s.stats && s.stats.bestWeaponId === null, 'state.stats.bestWeaponId = null');
  assert.notEqual(stateMod.createEmptyState(1).hazards, s.hazards, 'fresh hazards array per state');
});

const WO7_MODULE_SPEC = {
  'sprites/zombie': { ZOMBIE_SPRITES: OBJ, zombieSpriteFor: F },
  scores: { loadScores: F, saveScores: F, recordRun: F, topScores: F, clearScores: F, formatTime: F },
  'levels/level3': { LEVEL3: OBJ },
};

for (const [name, spec] of Object.entries(WO7_MODULE_SPEC)) {
  test(`WO7 ${name}.js (pure): imports in Node without throwing and has every contract export`, async () => {
    let mod;
    try {
      mod = await import(`../src/${name}.js`);
    } catch (err) {
      assert.fail(`importing src/${name}.js threw at module load: ${err && err.name}: ${err && err.message}\n${err && err.stack}`);
    }
    assertExports(mod, spec, `${name}.js`);
  });
}

test('WO7 sprites/zombie.js: ZOMBIE_SPRITES shape (3.3)', async () => {
  const { ZOMBIE_SPRITES: Z, zombieSpriteFor } = await import('../src/sprites/zombie.js');
  const isSprite = (s, w, h, label) => {
    assert.equal(kindOf(s), OBJ, label);
    assert.equal(s.w, w, `${label}.w`); assert.equal(s.h, h, `${label}.h`);
    assert.ok(s.pixels && s.pixels.length === w * h * 4, `${label}.pixels`);
  };
  for (const v of ['walker', 'jogger', 'sprinter']) isSprite(Z.normal.body[v], 16, 16, `normal.body.${v}`);
  assert.equal(Z.normal.legs.frames.length, 6);
  Z.normal.legs.frames.forEach((f, i) => isSprite(f, 16, 16, `normal.legs.frames[${i}]`));
  for (const k of ['tearing', 'damaged', 'corpse']) isSprite(Z.normal[k], 16, 16, `normal.${k}`);
  assert.deepEqual(Z.normal.anchor, { x: 8, y: 8 });
  isSprite(Z.minion.body, 12, 12, 'minion.body');
  isSprite(Z.minion.corpse, 12, 12, 'minion.corpse');
  assert.equal(Z.minion.legs.frames.length, 4);
  assert.deepEqual(Z.minion.anchor, { x: 6, y: 6 });
  for (const k of ['body', 'charge', 'corpse']) isSprite(Z.boss[k], 40, 40, `boss.${k}`);
  assert.equal(Z.boss.legs.frames.length, 4);
  assert.deepEqual(Z.boss.anchor, { x: 20, y: 20 });
  assert.equal(typeof Z.boss.tintColor, 'string');
  for (const z of [{ kind: 'normal', tier: 'walk' }, { kind: 'normal', tier: 'jog' }, { kind: 'normal', tier: 'sprint' },
    { kind: 'minion', tier: 'sprint' }, { kind: 'boss', tier: 'walk' }, {}]) {
    const r = zombieSpriteFor(z);
    for (const k of ['body', 'legs', 'corpse', 'anchor']) assert.ok(r && r[k], `zombieSpriteFor(${JSON.stringify(z)}).${k}`);
  }
  assert.equal(zombieSpriteFor({ kind: 'normal', tier: 'jog' }).body, Z.normal.body.jogger);
  assert.equal(zombieSpriteFor({ kind: 'boss' }).body, Z.boss.body);
});

test('WO7 level defs: boss.ability, level 3 = LABORATORY', async () => {
  const { LEVELS } = await import('../src/levels/levels.js');
  assert.ok(LEVELS.length >= 3, 'at least three levels');
  assert.equal(LEVELS[0].boss.ability, 'charge');
  assert.equal(LEVELS[1].boss.ability, 'charge');
  const L3 = LEVELS[2];
  assert.equal(L3.id, 'lab');
  assert.equal(L3.name, 'LABORATORY');
  assert.deepEqual(L3.boss, { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' });
  assert.equal(L3.theme.flicker, true);
  assert.ok(L3.difficulty.healthMult > LEVELS[1].difficulty.healthMult, 'level 3 harder than level 2');
});

// Exports added by Agents A-J in WO7 Phase 1 (3.3). EXPECTED TO FAIL until they land.
// Every import is guarded, so a module that fails to load is reported instead of thrown.
test('WO7 new exports', async () => {
  const missing = [];
  const load = async (name) => {
    try { return await import(`../src/${name}.js`); } catch (err) { missing.push(`${name}.js failed to import: ${err && err.message}`); return {}; }
  };
  const player = await load('player');
  const weapons = await load('weapons');
  const map = await load('map');
  const shop = await load('shop');
  const boss = await load('boss');
  const scores = await load('scores');
  const hud = await load('hud');
  const sprites = await load('sprites/zombie');
  const need = (mod, label, name, kind) => {
    if (kindOf(mod[name]) !== kind) missing.push(`${label}.${name} (${kind})`);
  };
  // sprites/zombie.js (A): real art, not placeholders
  need(sprites, 'sprites/zombie', 'ZOMBIE_SPRITES', OBJ);
  need(sprites, 'sprites/zombie', 'zombieSpriteFor', F);
  const Z = sprites.ZOMBIE_SPRITES;
  if (Z && Z.normal && Z.normal.body && Z.normal.body.walker && Z.normal.body.walker.placeholder) {
    missing.push('ZOMBIE_SPRITES.normal still PLACEHOLDER (Agent A)');
  }
  // player.js (E)
  for (const f of ['perkMods', 'addPerk', 'removeAllPerks', 'hasPerk']) need(player, 'player', f, F);
  // weapons.js (F)
  need(weapons, 'weapons', 'meleeAttack', F);
  need(weapons, 'weapons', 'ammoCost', F);
  const W = weapons.WEAPONS || {};
  for (const id of ['hg40', 'm8a7', 'peacekeeper']) {
    if (kindOf(W[id]) !== OBJ) missing.push(`WEAPONS.${id}`);
    else if (W[id].tier !== 3) missing.push(`WEAPONS.${id}.tier === 3`);
  }
  // map.js / shop.js (G)
  need(map, 'map', 'TILE_PERK', 'number');
  if (map.TILE_PERK !== undefined && map.TILE_PERK !== 10) missing.push('map.TILE_PERK === 10');
  need(shop, 'shop', 'buyPerk', F);
  // boss.js (H)
  need(boss, 'boss', 'updateHazards', F);
  // scores.js (J)
  for (const f of ['loadScores', 'recordRun', 'topScores', 'clearScores', 'formatTime']) need(scores, 'scores', f, F);
  // hud.js (D)
  need(hud, 'hud', 'setScores', F);
  need(hud, 'hud', 'setGameOverSummary', F);
  assert.deepEqual(missing, [], `missing WO7 exports:\n  ${missing.join('\n  ')}`);
});

// ---------------------------------------------------------------------------------------------
// WO8 (Pack-a-Punch)
// ---------------------------------------------------------------------------------------------

test('WO8 config: PAP block (Section 3)', () => {
  assert.deepEqual(config.PAP, {
    letter: 'A', cost: 500, ammoCost: 450, workSeconds: 3, damageMult: 2, magMult: 1.5, reserveMult: 1.5,
    spreadMult: 0.8, penetrationBonus: 1, maxPenetration: 4, projectileMult: 1.5, coneKillMult: 1.25, coneRangeMult: 1.15, knockMult: 1.2,
    ammoCostMult: 3.75, // WO8 Phase 4a (economy #5)
  });
});

test('WO8 state.js: shop.pap and stats.papCount', () => {
  const s = stateMod.createEmptyState(1);
  assert.deepEqual(s.shop.pap, { state: 'idle', timer: 0, weapon: null, slot: -1, baseId: null });
  assert.equal(s.stats.papCount, 0);
  assert.deepEqual(s.shop.box, { state: 'idle', timer: 0, weaponId: null }, 'box unchanged');
  assert.notEqual(stateMod.createEmptyState(1).shop.pap, s.shop.pap, 'fresh pap object per state');
});

// Exports added by Agents A and B in WO8 Phase 1 (Section 3). EXPECTED TO FAIL until they land.
// Every import is guarded, so a module that fails to load is reported instead of thrown.
test('WO8 new exports', async () => {
  const missing = [];
  const load = async (name) => {
    try { return await import(`../src/${name}.js`); } catch (err) { missing.push(`${name}.js failed to import: ${err && err.message}`); return {}; }
  };
  const weapons = await load('weapons');
  const map = await load('map');
  const shop = await load('shop');
  const need = (mod, label, name, kind) => {
    if (kindOf(mod[name]) !== kind) missing.push(`${label}.${name} (${kind})`);
  };
  // weapons.js (A)
  need(weapons, 'weapons', 'UPGRADES', OBJ);
  for (const f of ['upgradeWeapon', 'isUpgraded', 'upgradedName', 'canUpgrade']) need(weapons, 'weapons', f, F);
  // map.js (B)
  need(map, 'map', 'TILE_PAP', 'number');
  if (map.TILE_PAP !== undefined && map.TILE_PAP !== 11) missing.push('map.TILE_PAP === 11');
  // shop.js (B)
  for (const f of ['startPap', 'takePap', 'updatePap']) need(shop, 'shop', f, F);
  assert.deepEqual(missing, [], `missing WO8 exports:\n  ${missing.join('\n  ')}`);
});
