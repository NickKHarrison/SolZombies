import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.js';
import { LEVELS_CFG, ROUNDS } from '../src/config.js';
import { createEmptyState } from '../src/state.js';
import { LEVELS, levelByIndex } from '../src/levels/levels.js';
import {
  createLevelState, levelDifficulty, startLevel, beginDescent, updateLevel, nextLevelIndex,
  setLoadMapFunction, loopTheme, romanNumeral,
} from '../src/level.js';

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
  // Past the last authored level: compound on the previous level (FIX-1, QA balance #1/#2).
  const L = LEVELS_CFG.loop;
  const dl = levelDifficulty(N);
  assert.ok(close(dl.healthMult, 1.5 * L.healthMult));
  assert.ok(close(dl.countMult, 1.25 * L.countMult));
  assert.ok(close(dl.speedMult, Math.min(L.speedMultCap, 1.1 * L.speedMult)));
  assert.equal(dl.sprintShift, 3 + L.sprintShift);
  const dl2 = levelDifficulty(2 * N + 1);
  assert.ok(close(dl2.healthMult, 1.5 * L.healthMult ** 4));
  assert.ok(close(dl2.countMult, 1.25 * L.countMult ** 4));
  assert.equal(dl2.sprintShift, 3 + 4 * L.sprintShift);
  assert.ok(close(dl2.speedMult, L.speedMultCap));
  // Balance report table: L3 1.8 / 1.375 / 1.133 / 5, L4 2.16 / 1.5125 / 1.15 / 7.
  const l3 = levelDifficulty(2), l4 = levelDifficulty(3);
  assert.ok(close(l3.healthMult, 1.8) && close(l3.countMult, 1.375) && close(l3.speedMult, 1.133) && l3.sprintShift === 5);
  assert.ok(close(l4.healthMult, 2.16) && close(l4.countMult, 1.5125) && close(l4.speedMult, 1.15) && l4.sprintShift === 7);
  // `loop` argument is ignored beyond compatibility: the index decides.
  assert.deepEqual(levelDifficulty(3, 0), levelDifficulty(3));
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
    if (i >= N) assert.ok(d.speedMult <= L.speedMultCap + 1e-12, `speed cap ${i}`);
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

test('cleanup: restore default loader', () => {
  setLoadMapFunction(null);
  events.clearAll();
});
