import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.js';
import { LEVELS_CFG, ROUNDS, LEVEL_SELECT } from '../src/config.js';
import { createEmptyState } from '../src/state.js';
import { LEVELS, levelByIndex } from '../src/levels/levels.js';
import {
  createLevelState, levelDifficulty, startLevel, beginDescent, updateLevel, nextLevelIndex,
  setLoadMapFunction, loopTheme, romanNumeral, loopWallbuys,
} from '../src/level.js';
import { WEAPONS } from '../src/weapons.js';
import * as mapMod from '../src/map.js';

const N = LEVELS.length;
const close = (a, b) => Math.abs(a - b) < 1e-9;

// Fake loader (map.js is being rewritten concurrently): records the def it was given; every
// map has its own playerStart.
let loads = [];
function fakeLoad(def) {
  const m = { def, levelId: def && def.id, playerStart: { x: 100 + loads.length * 10, y: 200 },
    doors: [{ id: 1, open: false }], spawnPoints: [] };
  loads.push(m);
  return m;
}

function setup() {
  events.clearAll();
  loads = [];
  setLoadMapFunction(fakeLoad);
  const s = createEmptyState(5);
  s.phase = 'playing';
  s.player = { x: 1, y: 1, points: 1234, health: 60, maxHealth: 150, weapons: [{ id: 'm1911' }, { id: 'rk5' }],
    activeSlot: 1, repairTimer: 0.3 };
  s.rounds = { round: 7, phase: 'active', timer: 0, toSpawn: 12, alive: 5, spawnTimer: 0.4,
    spawnInterval: 1.2, pausedUntil: 99, killedThisRound: 8, suspended: true };
  s.stats.kills = 55;
  s.stats.roundReached = 7;
  return s;
}

function record(name) {
  const out = [];
  events.on(name, (p) => out.push(p));
  return out;
}

test('levelDifficulty: base table and loop scaling', () => {
  const d0 = levelDifficulty(0);
  assert.deepEqual(d0, { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 });
  const d1 = levelDifficulty(1);
  assert.ok(close(d1.healthMult, 1.5) && close(d1.speedMult, 1.1) && close(d1.countMult, 1.25));
  assert.equal(d1.sprintShift, 3);
  // WO7 Phase 0: authored levels use their def.difficulty; generic in LEVELS.length (was 2).
  for (let i = 0; i < N; i++) assert.deepEqual(levelDifficulty(i), { ...LEVELS[i].difficulty }, `authored level ${i}`);
  // Past the last authored level: compound on the previous level (FIX-1, QA balance #1/#2).
  // The cap never pulls speed below the last authored level's own value (level.js max()).
  const L = LEVELS_CFG.loop;
  const last = LEVELS[N - 1].difficulty;
  const capped = (k) => Math.max(last.speedMult, Math.min(L.speedMultCap, last.speedMult * L.speedMult ** k));
  const dl = levelDifficulty(N);
  assert.ok(close(dl.healthMult, last.healthMult * L.healthMult));
  assert.ok(close(dl.countMult, last.countMult * L.countMult));
  assert.ok(close(dl.speedMult, capped(1)));
  assert.equal(dl.sprintShift, last.sprintShift + L.sprintShift);
  const dl2 = levelDifficulty(2 * N + 1);
  const k2 = 2 * N + 1 - (N - 1);
  assert.ok(close(dl2.healthMult, last.healthMult * L.healthMult ** k2));
  assert.ok(close(dl2.countMult, last.countMult * L.countMult ** k2));
  assert.equal(dl2.sprintShift, last.sprintShift + k2 * L.sprintShift);
  assert.ok(close(dl2.speedMult, capped(k2)));
  // `loop` argument is ignored beyond compatibility: the index decides.
  assert.deepEqual(levelDifficulty(N + 1, 0), levelDifficulty(N + 1));
});

test('levelDifficulty: monotonic every descent (health/count/sprint strictly, speed capped)', () => {
  const L = LEVELS_CFG.loop;
  let prev = levelDifficulty(0);
  for (let i = 1; i <= 12; i++) {
    const d = levelDifficulty(i);
    assert.ok(d.healthMult > prev.healthMult, `health ${i}`);
    assert.ok(d.countMult > prev.countMult, `count ${i}`);
    assert.ok(d.sprintShift > prev.sprintShift, `sprintShift ${i}`);
    assert.ok(d.speedMult >= prev.speedMult - 1e-12, `speed ${i}`);
    if (i >= N) assert.ok(d.speedMult <= Math.max(L.speedMultCap, LEVELS[N - 1].difficulty.speedMult) + 1e-12, `speed cap ${i}`);
    prev = d;
  }
});

test('createLevelState / nextLevelIndex: loop math', () => {
  const a = createLevelState(0);
  assert.equal(a.index, 0);
  assert.equal(a.loop, 0);
  assert.equal(a.def, LEVELS[0]);
  assert.equal(a.name, LEVELS[0].name);
  const b = createLevelState(N);
  assert.equal(b.loop, 1);
  assert.equal(b.def.baseDef, levelByIndex(N));
  assert.equal(b.def.baseDef, LEVELS[0]);
  assert.equal(b.def.ascii, LEVELS[0].ascii);
  assert.equal(b.def.id, LEVELS[0].id);
  assert.equal(nextLevelIndex({ level: null }), 1);
  assert.equal(nextLevelIndex({ level: createLevelState(0) }), 1);
  assert.equal(nextLevelIndex({ level: createLevelState(N - 1) }), N);
  assert.equal(createLevelState(nextLevelIndex({ level: createLevelState(N - 1) })).loop, 1);
});

test('startLevel: loads the level def, resets per-level state, keeps player/round/stats', () => {
  const s = setup();
  const starts = record('level:start');
  s.zombies = [{ id: 1 }, { id: 2 }];
  s.bullets = [{ id: 3 }];
  s.effects = [{ type: 'blood' }];
  s.flow = { some: 'field' };
  s.powerups.items = [{ type: 'nuke' }];
  s.powerups.nuke = { queue: [1] };
  s.powerups.active = { doublePoints: 50 };
  s.shop.box = { state: 'offering', timer: 3, weaponId: 'raygun', cycleT: 0 };
  s.shop.prompt = { kind: 'box' };
  s.boss = { phase: 'defeated', bossId: 9 };
  s.time = 42;
  const weapons = s.player.weapons;

  const lv = startLevel(s, 1);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].def, LEVELS[1]);
  assert.equal(s.map, loads[0]);
  assert.equal(s.level, lv);
  assert.equal(lv.index, 1);
  assert.equal(lv.def, LEVELS[1]);
  assert.deepEqual(starts, [{ index: 1, name: LEVELS[1].name, loop: 0 }]);

  assert.deepEqual(s.zombies, []);
  assert.deepEqual(s.bullets, []);
  assert.deepEqual(s.effects, []);
  assert.equal(s.flow, null);
  assert.deepEqual(s.powerups.items, []);
  assert.equal(s.powerups.nuke, null);
  assert.deepEqual(s.powerups.active, { doublePoints: 50 }); // active power-ups carry over
  assert.equal(s.shop.box.state, 'idle');
  assert.equal(s.shop.box.weaponId, null);
  assert.equal(s.shop.prompt, null);
  assert.equal(s.boss.phase, 'idle');
  assert.equal(s.boss.bossId, null);

  const r = s.rounds;
  assert.equal(r.round, 7);
  assert.equal(r.phase, 'break');
  assert.equal(r.timer, LEVELS_CFG.arrivalBreak); // arrival relief (index > 0)
  assert.equal(r.toSpawn, 0);
  assert.equal(r.alive, 0);
  assert.equal(r.suspended, false);
  assert.equal(r.pausedUntil, 0);

  assert.equal(s.player.x, loads[0].playerStart.x);
  assert.equal(s.player.y, loads[0].playerStart.y);
  assert.equal(s.player.points, 1234);
  assert.equal(s.player.health, 150); // healed to full on arrival
  assert.equal(s.player.weapons, weapons);
  assert.deepEqual(s.player.weapons.map((w) => w.id), ['m1911', 'rk5']);
  assert.equal(s.player.activeSlot, 1);
  assert.equal(s.stats.kills, 55);
  assert.equal(s.stats.roundReached, 7);
  assert.equal(s.time, 42);
});

test('startLevel(0) on a fresh state creates rounds and emits level:start', () => {
  events.clearAll();
  loads = [];
  setLoadMapFunction(fakeLoad);
  const s = createEmptyState(1);
  s.player = { x: 0, y: 0 };
  const starts = record('level:start');
  startLevel(s, 0);
  assert.equal(s.rounds.round, 0);
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.level.index, 0);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].index, 0);
});

test('beginDescent: sets the transition, emits level:descend, guards re-entrancy', () => {
  const s = setup();
  startLevel(s, 0);
  const desc = record('level:descend');
  assert.equal(beginDescent(s), true);
  assert.deepEqual(s.transition, { t: 0, dur: LEVELS_CFG.fadeSeconds, nextIndex: 1, swapped: false });
  assert.deepEqual(desc, [{ from: 0, to: 1 }]);
  assert.equal(beginDescent(s), false);
  assert.equal(desc.length, 1);
  assert.equal(s.transition.nextIndex, 1);
});

test('updateLevel: swaps exactly once at the midpoint and clears at the end', () => {
  const s = setup();
  startLevel(s, 0);
  s.player.points = 900;
  const starts = record('level:start');
  beginDescent(s);
  const dur = LEVELS_CFG.fadeSeconds;
  const dt = dur / 20;
  let swapStep = -1;
  for (let i = 1; i <= 30 && s.transition; i++) {
    updateLevel(s, dt);
    if (swapStep < 0 && starts.length === 1) swapStep = i;
    if (s.transition && s.transition.t < dur / 2 - 1e-9) assert.equal(s.level.index, 0);
  }
  assert.ok(swapStep >= 10 && swapStep <= 11, `swap at step ${swapStep}`);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].index, 1);
  assert.equal(loads.length, 2); // boot + one swap
  assert.equal(s.transition, null);
  assert.equal(s.level.index, 1);
  assert.equal(s.player.points, 900);
  updateLevel(s, 1); // no transition: nothing happens
  assert.equal(starts.length, 1);
});

test('updateLevel: one huge step swaps once and clears', () => {
  const s = setup();
  startLevel(s, 0);
  const starts = record('level:start');
  beginDescent(s);
  updateLevel(s, 10);
  assert.equal(starts.length, 1);
  assert.equal(s.transition, null);
  assert.equal(s.level.index, 1);
});

test('descending past the last authored level loops with the next loop count', () => {
  const s = setup();
  startLevel(s, N - 1);
  const starts = record('level:start');
  beginDescent(s);
  assert.equal(s.transition.nextIndex, N);
  updateLevel(s, LEVELS_CFG.fadeSeconds);
  assert.equal(s.level.index, N);
  assert.equal(s.level.loop, 1);
  assert.equal(s.level.def.baseDef, LEVELS[0]);
  assert.equal(loads[loads.length - 1].def, s.level.def); // the map is loaded from the variant def
  assert.deepEqual(starts, [{ index: N, name: `${LEVELS[0].name} II`, loop: 1 }]);
  assert.ok(s.level.difficulty.healthMult > 1);
});

test('startLevel(0): keeps firstRoundDelay and does not heal', () => {
  const s = setup();
  startLevel(s, 0);
  assert.equal(s.rounds.timer, ROUNDS.firstRoundDelay);
  assert.equal(s.player.health, 60);
});

test('loop variants: numbered names, numbered boss, a distinct theme object per level', () => {
  assert.equal(romanNumeral(2), 'II'); assert.equal(romanNumeral(4), 'IV'); assert.equal(romanNumeral(9), 'IX');
  const l1 = createLevelState(0), l3 = createLevelState(N), l4 = createLevelState(N + 1), l5 = createLevelState(2 * N);
  assert.equal(l1.def, LEVELS[0]);
  assert.equal(l1.name, LEVELS[0].name);
  assert.equal(l3.name, `${LEVELS[0].name} II`);
  assert.equal(l3.def.name, l3.name);
  assert.equal(l4.name, `${LEVELS[1].name} II`);
  assert.equal(l5.name, `${LEVELS[0].name} III`);
  assert.equal(l3.def.boss.name, `${LEVELS[0].boss.name} II`);
  assert.equal(l5.def.boss.name, `${LEVELS[0].boss.name} III`);
  assert.equal(l3.def.boss.tint, LEVELS[0].boss.tint);
  // base defs are not mutated
  assert.equal(LEVELS[0].name, 'BUNKER');
  assert.equal(LEVELS[0].boss.name, 'THE WARDEN');
  // new theme object per level, stable per index, all different from each other
  const themes = [l1.def.theme, l3.def.theme, l5.def.theme, createLevelState(3 * N).def.theme];
  assert.equal(new Set(themes).size, themes.length);
  assert.equal(createLevelState(N).def.theme, l3.def.theme); // memoized
  assert.notEqual(l3.def.theme.floor, LEVELS[0].theme.floor);
  assert.notEqual(l3.def.theme.ambient, l5.def.theme.ambient);
  assert.match(l3.def.theme.name, /FLOODED/);
  assert.match(l5.def.theme.name, /BURNING/);
  for (const t of themes.slice(1)) {
    for (const k of ['floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'doorWood', 'doorIron']) {
      assert.match(t[k], /^#[0-9a-f]{6}$/i, k);
    }
    assert.notEqual(t.floor, t.floorAlt);
    assert.match(t.ambient, /^rgba\(/);
    // readable: floor stays dark, accent stays brighter than the floor
    const lum = (h) => { const v = parseInt(h.slice(1), 16); return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11; };
    assert.ok(lum(t.floor) < 90, `floor ${t.floor}`);
    assert.ok(lum(t.accent) > lum(t.floorAlt) + 30, `accent ${t.accent}`);
  }
  // deterministic
  assert.deepEqual(loopTheme(LEVELS[1].theme, 2), loopTheme(LEVELS[1].theme, 2));
});

test('FIX-3 (L1): startLevel clears acid pools and globs from the old level', () => {
  const s = setup();
  s.hazards = [{ id: 1, kind: 'acid', x: 5, y: 5, r: 50, ttl: 3 }];
  s.acidGlobs = [{ id: 2 }, { id: 3 }];
  startLevel(s, 1);
  assert.deepEqual(s.hazards, []);
  assert.deepEqual(s.acidGlobs, []);
  // also through a descent: empty right after the midpoint swap (fade still running)
  s.hazards.push({ id: 4 }); s.acidGlobs.push({ id: 5 });
  beginDescent(s);
  updateLevel(s, LEVELS_CFG.fadeSeconds / 2 + 0.01);
  assert.ok(s.transition, 'still fading');
  assert.equal(s.hazards.length + s.acidGlobs.length, 0);
});

test('FIX-3 (balance #4): loop levels sell upgraded wall guns, letters kept, base untouched', () => {
  const up = LEVELS_CFG.loopWallUpgrade;
  assert.ok(up && typeof up === 'object');
  for (const [from, to] of Object.entries(up)) {
    assert.ok(WEAPONS[from] && WEAPONS[to], `${from} -> ${to} known`);
    assert.ok((WEAPONS[to].tier || 1) > (WEAPONS[from].tier || 1), `${from} -> ${to} is an upgrade`);
  }
  const baseL1 = { ...LEVELS[0].wallbuys };
  for (let pos = 0; pos < N; pos++) {
    const base = LEVELS[pos];
    const l0 = createLevelState(pos), lv = createLevelState(N + pos);
    assert.equal(l0.def.wallbuys, base.wallbuys, 'loop 0 keeps the authored def');
    assert.notEqual(lv.def, base); assert.notEqual(lv.def.wallbuys, base.wallbuys);
    assert.deepEqual(Object.keys(lv.def.wallbuys).sort(), Object.keys(base.wallbuys).sort(), 'letters kept');
    // WO9 (INT): upgraded unless the target gun is already on that level's walls (no duplicates).
    const vals = Object.values(lv.def.wallbuys);
    assert.equal(new Set(vals).size, vals.length, `${base.id}: no gun sold twice in the loop variant`);
    for (const [k, id] of Object.entries(base.wallbuys)) {
      const got = lv.def.wallbuys[k];
      assert.ok(got === (up[id] || id) || (got === id && vals.includes(up[id])), `${base.id} ${k}: ${id} -> ${got}`);
    }
    assert.equal(createLevelState(N + pos).def, lv.def, 'memoized');
    assert.deepEqual(createLevelState(2 * N + pos).def.wallbuys, lv.def.wallbuys, 'same upgrade every loop');
  }
  assert.deepEqual(LEVELS[0].wallbuys, baseL1, 'base def not mutated');
  // level 4 (BUNKER II) sells tier-3 guns: the requested level-1 swaps
  const l4 = createLevelState(N).def.wallbuys;
  const ids = new Set(Object.values(l4));
  for (const id of ['m8a7', 'peacekeeper', 'hg40']) assert.ok(ids.has(id), `level 4 sells ${id}`);
  for (const id of ['sheiva', 'kn44', 'kuda', 'lcar9', 'rk5', 'krm262', 'argus', 'hvk30', 'icr1', 'bootlegger']) {
    assert.ok(!ids.has(id), `level 4 no longer sells ${id}`);
  }
  // level 5 (CATACOMBS II) upgrades tier 2 -> tier 3 where it makes sense
  const l5 = new Set(Object.values(createLevelState(N + 1).def.wallbuys));
  for (const id of ['hg40', 'm8a7', 'peacekeeper']) assert.ok(l5.has(id), `level 5 sells ${id}`);
  assert.deepEqual(loopWallbuys(null), {});
  assert.deepEqual(loopWallbuys({ x: 'nope' }), { x: 'nope' });
});

test('FIX-3: the real map loader builds level 4 wall buys (tier-3 gun + ammo) from the loop def', () => {
  setLoadMapFunction(null);
  const def = createLevelState(N).def;
  const m = mapMod.loadMap(def);
  const wb = (m.wallBuys || m.wallbuys || []).map((w) => w.weaponId);
  assert.ok(wb.length > 0, 'wall buys parsed');
  assert.ok(wb.includes('peacekeeper') && wb.includes('m8a7') && wb.includes('hg40'));
  assert.ok(!wb.includes('kn44'));
  setLoadMapFunction(fakeLoad);
});

test('FIX-3 (balance #5): loop speed cap 1.3 lets speed rise past level 3', () => {
  assert.equal(LEVELS_CFG.loop.speedMultCap, 1.3);
  const s3 = levelDifficulty(N - 1).speedMult, s4 = levelDifficulty(N).speedMult, s5 = levelDifficulty(N + 1).speedMult;
  assert.ok(s4 > s3 && s5 > s4, `${s3} < ${s4} < ${s5}`);
  assert.equal(levelDifficulty(N + 20).speedMult, 1.3);
});

test('WO8 Phase 4a (economy #1): mega door cost 250 / 500 / 750 / 1000 per level, loop levels continue', async () => {
  const { megaDoorCost } = await import('../src/level.js');
  const { DOORS } = await import('../src/config.js');
  assert.equal(DOORS.megaCostPerLevel, 250);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(megaDoorCost), [250, 500, 750, 1000, 1250, 1500]);
  // startLevel stamps the price on the loaded map's mega door (real loader, every authored level + loop 1)
  setLoadMapFunction(null);
  for (let i = 0; i <= N; i++) {
    const s = setup();
    setLoadMapFunction(null);
    startLevel(s, i);
    assert.ok(s.map.megaDoor, `level ${i} has a mega door`);
    assert.equal(s.map.megaDoor.cost, 250 + 250 * i, `level ${i}`);
  }
  // a map without a mega door is left alone
  const s = setup();
  startLevel(s, 2);
  assert.equal(s.map.megaDoor, undefined);
  setLoadMapFunction(fakeLoad);
});

test('cleanup: restore default loader', () => {
  setLoadMapFunction(null);
  events.clearAll();
});

// ---------------------------------------------------------------------------
// WO8 (INT): a gun inside the Pack-a-Punch machine comes back upgraded on a level swap.
// ---------------------------------------------------------------------------
import { createWeapon, isUpgraded, UPGRADES } from '../src/weapons.js';
import * as shopMod from '../src/shop.js';

function papSetup() {
  const s = setup();
  s.player.weapons = [createWeapon('mr6'), null];
  s.player.activeSlot = 0;
  s.player.tempWeapon = null;
  return s;
}

test('WO8 startLevel: working gun returns upgraded to its empty slot, counted once, machine idle', () => {
  const s = papSetup();
  s.player.points = 5000;
  s.map = { pap: null };
  s.player.weapons = [createWeapon('mr6'), createWeapon('kn44')];
  s.player.activeSlot = 1;
  assert.equal(shopMod.startPap(s), true);
  assert.equal(s.player.weapons[1], null);
  const inside = s.shop.pap.weapon;
  const equips = record('weapon:equipped');
  const dones = record('pap:done');
  startLevel(s, 1);
  assert.equal(s.player.weapons[1], inside, 'same object back in slot 1');
  assert.equal(isUpgraded(inside), true);
  assert.equal(inside.def, UPGRADES.kn44);
  assert.equal(inside.mag, UPGRADES.kn44.mag);
  assert.equal(inside.reserve, UPGRADES.kn44.reserve);
  assert.equal(s.player.activeSlot, 1);
  assert.equal(s.stats.papCount, 1);
  assert.deepEqual(s.shop.pap, { state: 'idle', timer: 0, weapon: null, slot: -1, baseId: null });
  assert.deepEqual(equips, [{ weaponId: 'kn44', slot: 1 }]);
  assert.deepEqual(dones, [], 'no pap:done on a level swap');
  // A second swap does nothing more.
  startLevel(s, 2);
  assert.equal(s.stats.papCount, 1);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['mr6', 'kn44']);
});

test('WO8 startLevel: ready gun whose slot was refilled goes to the first empty / active slot', () => {
  const s = papSetup();
  const g = createWeapon('mr6');
  shopMod.updatePap(s, 0); // no-op on idle
  s.shop.pap = { state: 'ready', timer: 0, weapon: g, slot: 0, baseId: 'mr6' };
  s.player.weapons = [createWeapon('kn44'), createWeapon('rk5')]; // both filled meanwhile
  s.player.activeSlot = 1;
  startLevel(s, 1);
  assert.equal(s.player.weapons[1], g, 'replaces the active gun');
  assert.equal(isUpgraded(g), true, 'upgraded even if it was not yet');
  assert.equal(s.stats.papCount, 1);
  assert.equal(s.shop.pap.state, 'idle');
});

test('WO8 startLevel: same id bought again meanwhile is replaced, no duplicate', () => {
  const s = papSetup();
  const g = createWeapon('mr6');
  s.shop.pap = { state: 'working', timer: 2, weapon: g, slot: 1, baseId: 'mr6' };
  s.player.weapons = [createWeapon('mr6'), null];
  s.player.activeSlot = 0;
  startLevel(s, 1);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['mr6', null]);
  assert.equal(s.player.weapons[0], g);
});

test('WO8 startLevel: idle machine changes nothing; papCount untouched', () => {
  const s = papSetup();
  const before = s.player.weapons.slice();
  startLevel(s, 1);
  assert.deepEqual(s.player.weapons, before);
  assert.equal(s.stats.papCount, 0);
  assert.equal(s.shop.pap.state, 'idle');
});

test('WO8 FIX-A (playtest #4): a returned gun is announced with a gold "<NAME> RETURNED" text near the player', () => {
  const s = papSetup();
  s.player.weapons = [createWeapon('mr6'), createWeapon('kn44')];
  s.player.activeSlot = 1;
  s.player.points = 5000;
  assert.equal(shopMod.startPap(s), true);
  startLevel(s, 1);
  const texts = s.effects.filter((e) => e.type === 'text');
  assert.equal(texts.length, 1);
  const t = texts[0];
  assert.equal(t.text, `${UPGRADES.kn44.name.toUpperCase()} RETURNED`);
  assert.equal(t.color, '#ffd36b');
  assert.ok(t.ttl > 0 && t.maxTtl === t.ttl);
  assert.ok(Math.abs(t.x - s.player.x) < 1 && Math.abs(t.y - s.player.y) < 60);
  // nothing in the machine: no text
  startLevel(s, 2);
  assert.equal(s.effects.filter((e) => e.type === 'text').length, 0);
});

// ---------------------------------------------------------------------------
// WO9 (INT): teleportTo, loop theme hints, wall-buy dedupe
// ---------------------------------------------------------------------------
import { teleportTo } from '../src/level.js';

test('WO9 teleportTo: fresh level with arrival relief, emits level:start (teleport) + level:teleport', () => {
  const s = setup();
  s.transition = { t: 0.1, dur: 1, nextIndex: 3, swapped: false };
  const starts = record('level:start'), tps = record('level:teleport');
  const lv = teleportTo(s, 4);
  assert.equal(lv.index, 4); assert.equal(s.level.index, 4);
  assert.equal(s.transition, null, 'a running descent is cancelled');
  assert.equal(s.player.health, s.player.maxHealth, 'healed');
  assert.equal(s.rounds.round, 7, 'round kept');
  assert.equal(s.rounds.phase, 'break');
  assert.equal(s.rounds.timer, LEVELS_CFG.arrivalBreak);
  // WO9 FIX-3: topped up to LEVEL_SELECT.minPoints x 4 when below it (1234 < 1600)
  assert.equal(s.player.points, Math.max(1234, LEVEL_SELECT.minPoints * 4), 'points kept or topped up');
  assert.equal(s.player.weapons.length, 2, 'weapons kept');
  assert.equal(starts.length, 1); assert.equal(starts[0].teleport, true); assert.equal(starts[0].index, 4);
  assert.deepEqual(tps, [{ from: 0, to: 4, name: LEVELS[4].name }]);
  // index 0 also gets the arrival relief (unlike a boot / restart)
  s.player.health = 10;
  teleportTo(s, 0);
  assert.equal(s.player.health, s.player.maxHealth);
  assert.equal(s.rounds.timer, LEVELS_CFG.arrivalBreak);
  assert.deepEqual(tps[1], { from: 4, to: 0, name: LEVELS[0].name });
  // plain startLevel(0) keeps the boot behaviour and has no teleport flag
  s.player.health = 10;
  startLevel(s, 0);
  assert.equal(s.player.health, 10);
  assert.equal(starts[starts.length - 1].teleport, undefined);
  assert.equal(teleportTo(null, 1), null);
});

test('WO9 teleportTo hands back a gun left in the Pack-a-Punch (as on a descent)', () => {
  const s = setup();
  const w = { id: 'rk5', def: { name: 'RK5' }, upgraded: true };
  s.player.weapons = [{ id: 'm1911' }, null];
  s.player.activeSlot = 0;
  s.shop = { pap: { state: 'ready', timer: 0, weapon: w, slot: 1, baseId: 'rk5' } };
  teleportTo(s, 2);
  assert.ok(s.player.weapons.includes(w), 'gun returned');
  assert.equal(s.shop.pap.state, 'idle');
});

test('WO9 loopTheme keeps the render style and level hint keys', () => {
  for (const base of LEVELS) {
    const t = createLevelState(N + LEVELS.indexOf(base)).def.theme;
    for (const k of ['style', 'curtainRow', 'seatRows', 'stageRows', 'snow', 'water', 'spores', 'ice', 'iceDeep', 'hutWood',
      'waterDeep', 'waterLight', 'moss', 'vine', 'glyph', 'curtain', 'seat', 'lamp', 'grain']) {
      assert.deepEqual(t[k], base.theme[k], `${base.id} ${k}`);
    }
  }
  const kino = LEVELS.find((d) => d.id === 'kino');
  if (kino) assert.equal(loopTheme(kino.theme, 1).style, 'kino');
});

test('WO9 loopWallbuys skips an upgrade whose target is already on the walls', () => {
  // xr2 -> m8a7 collides with an authored m8a7; icr1 -> gorgon collides with gorgon.
  assert.deepEqual(loopWallbuys({ 1: 'icr1', 2: 'xr2', 5: 'm8a7', 7: 'gorgon' }),
    { 1: 'icr1', 2: 'xr2', 5: 'm8a7', 7: 'gorgon' });
  // two different guns upgrading to the same target: only the first stays un-upgraded
  const out = loopWallbuys({ a: 'kn44', b: 'manowar' });
  assert.equal(new Set(Object.values(out)).size, 2);
  assert.ok(Object.values(out).includes('peacekeeper'));
  // CATACOMBS: hvk30 -> manowar is fine because manowar itself -> peacekeeper
  const l2 = createLevelState(N + 1).def.wallbuys;
  assert.equal(l2['1'], 'manowar');
  assert.equal(l2['4'], 'peacekeeper');
});

test('WO9 startLevel clears the frost slow on every entry path', () => {
  const s = setup();
  s.player.slowT = 1.5;
  startLevel(s, 4);
  assert.equal(s.player.slowT, 0);
  s.player.slowT = 2;
  teleportTo(s, 1);
  assert.equal(s.player.slowT, 0);
  s.player.slowT = 2;
  beginDescent(s);
  updateLevel(s, LEVELS_CFG.fadeSeconds);
  assert.equal(s.player.slowT, 0);
});

// ---------------------------------------------------------------------------
// WO9 FIX-3: practice teleport points floor (QA kino #5, outpost #8), loop floorZones
// ---------------------------------------------------------------------------
import { teleportMinPoints } from '../src/level.js';

test('WO9 FIX-3 teleportTo tops points up to LEVEL_SELECT.minPoints x index, never lowers, never on descent', () => {
  assert.ok(LEVEL_SELECT.minPoints > 0);
  assert.equal(teleportMinPoints(0), 0);
  assert.equal(teleportMinPoints(3), LEVEL_SELECT.minPoints * 3);
  const s = setup();
  const pts = record('points:changed');
  s.player.points = 50;
  const earned = s.stats.pointsEarned;
  teleportTo(s, 3);
  assert.equal(s.player.points, LEVEL_SELECT.minPoints * 3);
  assert.deepEqual(pts, [{ delta: LEVEL_SELECT.minPoints * 3 - 50, total: LEVEL_SELECT.minPoints * 3 }]);
  assert.equal(s.stats.pointsEarned, earned, 'a grant is not counted as earned');
  // already above the floor: untouched, no event
  s.player.points = 99999;
  teleportTo(s, 5);
  assert.equal(s.player.points, 99999);
  assert.equal(pts.length, 1);
  // index 0: no floor
  s.player.points = 0;
  teleportTo(s, 0);
  assert.equal(s.player.points, 0);
  // a descent (and a plain startLevel) never grants points
  s.player.points = 0;
  beginDescent(s);
  updateLevel(s, LEVELS_CFG.fadeSeconds);
  assert.equal(s.level.index, 1);
  assert.equal(s.player.points, 0);
  startLevel(s, 4);
  assert.equal(s.player.points, 0);
  assert.equal(pts.length, 1);
});

test('WO9 FIX-3 loopTheme copies floorZones (entries not shared with the base theme)', () => {
  const zones = [{ x0: 1, y0: 2, x1: 5, y1: 6, floor: '#123456' }, { x0: 10, y0: 0, x1: 12, y1: 3, floor: '#abcdef' }];
  const t = loopTheme({ floor: '#303030', style: 'kino', floorZones: zones }, 1);
  assert.deepEqual(t.floorZones, zones);
  assert.notEqual(t.floorZones, zones);
  assert.notEqual(t.floorZones[0], zones[0]);
  assert.equal(loopTheme({ floor: '#303030' }, 1).floorZones, undefined);
  for (const base of LEVELS) {
    if (!base.theme || base.theme.floorZones === undefined) continue;
    assert.deepEqual(createLevelState(N + LEVELS.indexOf(base)).def.theme.floorZones, base.theme.floorZones, base.id);
  }
});
