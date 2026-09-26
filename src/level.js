// level.js — level progression and descent transition (pure, no DOM). WO5 3.3.
// Agent G (WO5 Phase 1). See docs/notes/level.md.
//
// Index convention (Phase 0, see docs/notes/wo5-scaffold.md): `index` is the absolute
// progression index (0, 1, 2, ...). def = levelByIndex(index) (wraps), loop =
// floor(index / LEVELS.length). nextLevelIndex(state) = index + 1, so the loop count
// increments automatically when it wraps past LEVELS.length.
import { LEVELS_CFG, ROUNDS } from './config.js';
import * as events from './events.js';
import { LEVELS, levelByIndex } from './levels/levels.js';
// Siblings rewritten concurrently in WO5: namespace imports, called lazily and guarded.
import * as mapMod from './map.js';
import * as bossMod from './boss.js';
import * as wavesMod from './waves.js';

// Test hook: replaces map.loadMap in startLevel (null restores the default).
let loadMapImpl = null;
export function setLoadMapFunction(fn) { loadMapImpl = typeof fn === 'function' ? fn : null; }

// Per-level base difficulty (WO5 1.3). A level def may carry its own `difficulty` (preferred);
// otherwise this table is used by registry position.
const BASE_DIFFICULTY = [
  { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 },       // level 1 BUNKER
  { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 }, // level 2 CATACOMBS
];

function loopOf(index) {
  return Math.max(0, Math.floor(index / LEVELS.length));
}

function baseDifficultyOf(pos) {
  const def = LEVELS[pos];
  return (def && def.difficulty) || BASE_DIFFICULTY[pos] || BASE_DIFFICULTY[0];
}

// WO5 FIX-1 (QA balance #1/#2): authored levels use their own base difficulty. Past the last
// authored level every descent compounds on the PREVIOUS level: index n-1+k = last base x
// LEVELS_CFG.loop^k (speed capped at loop.speedMultCap), so health / count / sprintShift strictly
// increase on every descent and speed never decreases. `loop` is kept for signature compatibility
// (the layout/theme still cycle through levelByIndex; state.level.loop feeds the HUD and events).
export function levelDifficulty(index, loop = loopOf(index)) { // eslint-disable-line no-unused-vars
  const n = LEVELS.length;
  const i = Math.max(0, Math.floor(Number(index) || 0));
  if (i < n) {
    const b = baseDifficultyOf(i);
    return { healthMult: b.healthMult, speedMult: b.speedMult, countMult: b.countMult, sprintShift: b.sprintShift };
  }
  const last = baseDifficultyOf(n - 1);
  const L = LEVELS_CFG.loop;
  const k = i - (n - 1); // descents past the last authored level (level n+1 -> 1)
  const cap = Number.isFinite(L.speedMultCap) ? L.speedMultCap : Infinity;
  return {
    healthMult: last.healthMult * Math.pow(L.healthMult, k),
    // max(): the cap never pulls speed below the last authored level's own value.
    speedMult: Math.max(last.speedMult, Math.min(cap, last.speedMult * Math.pow(L.speedMult, k))),
    countMult: last.countMult * Math.pow(L.countMult, k),
    sprintShift: last.sprintShift + L.sprintShift * k,
  };
}

// ---------------------------------------------------------------------------
// Loop variants (WO5 FIX-1, QA playtest #9): from loop 1 on, a level is a derived def with a
// tinted theme, a numbered name ("BUNKER II") and a numbered boss ("THE WARDEN II"). Each
// (level, loop) gets its own def + theme object (render caches resolved themes per object);
// memoized so the same index always yields the same objects.
// ---------------------------------------------------------------------------

const LOOP_VARIANTS = [
  { label: 'FLOODED', tint: '#2f7a80', ambient: 'rgba(60,170,180,0.08)', torch: false },
  { label: 'BURNING', tint: '#b8481c', ambient: 'rgba(255,100,30,0.09)', torch: true },
  { label: 'BLIGHTED', tint: '#6a8a2a', ambient: 'rgba(140,200,60,0.07)', torch: false },
  { label: 'FROZEN', tint: '#5a82c0', ambient: 'rgba(90,150,255,0.07)', torch: false },
];

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(c) {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
// Mix `hex` toward `tint` by `amt` (0..1), then scale brightness by `bright`.
function tintHex(hex, tint, amt, bright = 1) {
  const a = hexToRgb(hex), b = hexToRgb(tint);
  if (!a || !b) return hex;
  return rgbToHex(a.map((v, i) => (v + (b[i] - v) * amt) * bright));
}

export function romanNumeral(n) {
  let v = Math.max(1, Math.floor(n) || 1);
  const T = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'],
    [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [k, r] of T) while (v >= k) { out += r; v -= k; }
  return out;
}

// Deterministic theme variant for loop >= 1: cycles FLOODED / BURNING / BLIGHTED / FROZEN, each
// further cycle a little darker (min 76 % brightness). floorAlt differs from floor, so render
// draws the textured look (checker, flecks, brickwork) even for the flat level-1 base.
export function loopTheme(base, loop) {
  const b = base || {};
  const k = Math.max(1, loop | 0);
  const v = LOOP_VARIANTS[(k - 1) % LOOP_VARIANTS.length];
  const bright = Math.max(0.76, 1 - 0.08 * Math.floor((k - 1) / LOOP_VARIANTS.length));
  const floor = tintHex(b.floor || '#2a2a2e', v.tint, 0.26, bright);
  return {
    name: `${b.name || ''} — ${v.label}`.trim(),
    floor,
    floorAlt: tintHex(floor, v.tint, 0.12, 1.12),
    wall: tintHex(b.wall || '#0e0e10', v.tint, 0.16, bright),
    wallEdge: tintHex(b.wallEdge || '#3c3c44', v.tint, 0.34, bright),
    accent: tintHex(b.accent || '#9aa0a8', v.tint, 0.3, 1),
    doorWood: tintHex(b.doorWood || '#3e2412', v.tint, 0.14, bright),
    doorIron: tintHex(b.doorIron || '#2b2d31', v.tint, 0.2, bright),
    ambient: v.ambient,
    torch: !!(b.torch || v.torch),
    variant: v.label,
  };
}

const variantCache = new Map(); // `${pos}:${loop}` -> derived def
function levelDefFor(index, loop) {
  const base = levelByIndex(index);
  if (loop < 1 || !base) return base;
  const n = LEVELS.length;
  const pos = ((Math.floor(index) % n) + n) % n;
  const key = `${pos}:${loop}`;
  let def = variantCache.get(key);
  if (def && def.baseDef === base) return def;
  const num = romanNumeral(loop + 1);
  const boss = base.boss ? { ...base.boss, name: base.boss.name ? `${base.boss.name} ${num}` : base.boss.name } : base.boss;
  def = { ...base, name: `${base.name} ${num}`, theme: loopTheme(base.theme, loop), boss, loop, baseDef: base };
  variantCache.set(key, def);
  return def;
}

export function createLevelState(index = 0) {
  const loop = loopOf(index);
  const def = levelDefFor(index, loop);
  return { index, loop, def, difficulty: levelDifficulty(index, loop), name: def.name };
}

export function nextLevelIndex(state) {
  const cur = state && state.level ? state.level.index : 0;
  return cur + 1;
}

// Rounds after a level swap: same round number, fresh break (ROUNDS.firstRoundDelay), nothing
// pending or alive, not suspended. Mutates in place so any holder of state.rounds sees it.
function resetRoundsForLevel(state) {
  let r = state.rounds;
  if (!r) {
    r = typeof wavesMod.createRoundState === 'function'
      ? wavesMod.createRoundState()
      : { round: 0, spawnInterval: ROUNDS.spawnIntervalStart };
    state.rounds = r;
  }
  r.phase = 'break';
  r.timer = ROUNDS.firstRoundDelay;
  r.toSpawn = 0;
  r.alive = 0;
  r.spawnTimer = 0;
  r.pausedUntil = 0;
  r.killedThisRound = 0;
  r.suspended = false;
}

// Loads level `index` (absolute progression index) and resets everything that belongs to a
// level: map (doors, barricades, mega door, stairs), zombies, bullets, effects, flow field,
// power-up items + nuke queue, mystery box, boss state, rounds (fresh break, round kept).
// Keeps: player points / weapons / ammo, active power-ups, stats, state.time. Health: healed to
// full when index > 0 (arrival relief, first break LEVELS_CFG.arrivalBreak).
// Emits level:start { index, name, loop }. Returns state.level.
export function startLevel(state, index = 0) {
  const idx = Math.max(0, Math.floor(Number(index) || 0));
  const lv = createLevelState(idx);
  state.level = lv; // set first so anything reading state.level during load sees the new level

  const load = loadMapImpl || (typeof mapMod.loadMap === 'function' ? mapMod.loadMap : null);
  if (load) {
    const m = load(lv.def);
    if (m) state.map = m;
  }

  state.zombies = [];
  state.bullets = [];
  state.effects = [];
  state.flow = null;

  if (!state.powerups) state.powerups = { items: [], active: {}, dropsThisRound: 0, nuke: null };
  state.powerups.items = [];
  state.powerups.nuke = null;

  if (!state.shop) state.shop = {};
  state.shop.prompt = null;
  state.shop.box = { state: 'idle', timer: 0, weaponId: null, cycleT: 0 };

  state.boss = typeof bossMod.createBossState === 'function' ? bossMod.createBossState() : null;

  resetRoundsForLevel(state);
  // WO5 FIX-1 (QA playtest #4): arriving by descent (index > 0) gives a longer first break
  // (LEVELS_CFG.arrivalBreak) and a full heal. Index 0 (boot / restart) keeps firstRoundDelay.
  const arriving = idx > 0;
  if (arriving && Number.isFinite(LEVELS_CFG.arrivalBreak)) state.rounds.timer = LEVELS_CFG.arrivalBreak;

  const p = state.player;
  if (p && arriving && Number.isFinite(p.maxHealth)) p.health = p.maxHealth;
  const start = state.map && state.map.playerStart;
  if (p && start) {
    p.x = start.x;
    p.y = start.y;
    if ('vx' in p) p.vx = 0;
    if ('vy' in p) p.vy = 0;
    p.repairTimer = 0;
  }

  events.emit('level:start', { index: lv.index, name: lv.name, loop: lv.loop });
  return lv;
}

// Starts the fade to the next level. Re-entrancy guarded: returns false (no event) while a
// transition is already running. Emits level:descend { from, to } (absolute indices).
export function beginDescent(state) {
  if (!state || state.transition) return false;
  const from = state.level ? state.level.index : 0;
  const to = nextLevelIndex(state);
  state.transition = { t: 0, dur: LEVELS_CFG.fadeSeconds, nextIndex: to, swapped: false };
  events.emit('level:descend', { from, to });
  return true;
}

// Advances state.transition: swaps the level exactly once when t reaches dur/2, clears the
// transition when t reaches dur (both can happen in one large step).
export function updateLevel(state, dt) {
  const tr = state && state.transition;
  if (!tr) return;
  tr.t += Math.max(0, Number(dt) || 0);
  if (!tr.swapped && tr.t >= tr.dur / 2) {
    tr.swapped = true;
    startLevel(state, tr.nextIndex);
  }
  if (tr.t >= tr.dur && state.transition === tr) state.transition = null;
}
