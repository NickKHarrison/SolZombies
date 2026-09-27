// tests/level5.test.js — WO9 Agent B: level 5 "OUTPOST" (arctic research outpost).
// Full validity suite via tests/helpers/levelcheck.js (frozen) plus OUTPOST-specific asserts:
// a wide open snowfield (far more open ground than any corridor level), ice holes '~' that block
// movers but give sight-lines across zone boundaries, pinned perk plan / Pack-a-Punch position,
// the WO9 wall-gun mix and the outpost theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVEL5 } from '../src/levels/level5.js';
import { LEVELS } from '../src/levels/levels.js';
import * as map from '../src/map.js';
import {
  assertValidLevel, validateLevel, parseLevel, zones, openingStep, tileDiff, freeStandingBlocks,
  key, COLS, ROWS, FLOORISH, PIT, N4, TIER3_GUNS,
} from './helpers/levelcheck.js';

const PERK_PLAN = { revive: 0, speed: 1, stamin: 2, dtap: 3, jugg: 4, mule: 5 };
const PAP_POS = [50, 11];
const OPTS = { wo9Guns: true, perkPlan: PERK_PLAN, papPos: PAP_POS };

// Floor tiles whose (2r+1)^2 neighbourhood holds only floor or ice holes (no wall, door, window...).
function openTiles(def, r = 3) {
  const g = def.ascii;
  let n = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!FLOORISH.has(g[y][x])) continue;
    let ok = true;
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) {
      const c = (g[y + dy] || '')[x + dx];
      if (c === undefined || !(FLOORISH.has(c) || c === PIT)) { ok = false; break; }
    }
    if (ok) n++;
  }
  return n;
}
const floorCount = (def) => def.ascii.join('').split('').filter((c) => FLOORISH.has(c)).length;

// Pit tiles with floor straight across them (N-S or E-W) belonging to two different zones:
// sight-lines over impassable ice from one zone into the next.
function crossZonePits(def) {
  const L = parseLevel(def);
  const Z = zones(L);
  const out = [];
  for (const t of L.find((c) => c === PIT)) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = { x: t.x - dx, y: t.y - dy }, b = { x: t.x + dx, y: t.y + dy };
      if (!FLOORISH.has(L.at(a.x, a.y)) || !FLOORISH.has(L.at(b.x, b.y))) continue;
      const za = Z.comp[key(a.x, a.y)], zb = Z.comp[key(b.x, b.y)];
      if (za !== zb) out.push({ pit: t, a, b, pair: [za, zb].sort((p, q) => p - q).join('-') });
    }
  }
  return out;
}

test('OUTPOST: passes the full level validity suite (WO4/WO5/WO7/WO8 + WO9 guns)', () => {
  assert.deepEqual(validateLevel(LEVEL5, OPTS), []);
  assertValidLevel(LEVEL5, OPTS);
});

test('OUTPOST: meta, boss and difficulty unchanged from the scaffold', () => {
  assert.equal(LEVEL5.id, 'outpost');
  assert.equal(LEVEL5.name, 'OUTPOST');
  assert.deepEqual(LEVEL5.boss, { name: 'THE WENDIGO', tint: '#bfe8ff', ability: 'frost' });
  assert.deepEqual(LEVEL5.difficulty, { healthMult: 2.9, speedMult: 1.24, countMult: 1.7, sprintShift: 9 });
  assert.equal(LEVELS[4], LEVEL5);
});

test('OUTPOST: a wide open snowfield, far more open ground than the corridor levels', () => {
  const mine = openTiles(LEVEL5, 3);
  assert.ok(mine >= 100, `only ${mine} floor tiles with 3 tiles of clear ground around them`);
  for (const other of LEVELS.slice(0, 3)) {
    const o = openTiles(other, 3);
    assert.ok(mine >= 3 * Math.max(o, 10), `${other.id}: ${o} open tiles vs outpost ${mine}`);
    assert.ok(floorCount(LEVEL5) > floorCount(other) + 100, `more walkable snow than ${other.id}`);
  }
  assert.ok(openTiles(LEVEL5, 2) >= 250, 'many 5x5 clear patches');
  assert.ok(floorCount(LEVEL5) >= 1400, `floor ${floorCount(LEVEL5)}`);
  // scattered small buildings / rocks (huts, shed, tanks, dish, dome walls, posts, ice columns)
  assert.ok(freeStandingBlocks(LEVEL5) >= 20, `${freeStandingBlocks(LEVEL5)} free-standing blocks`);
});

test('OUTPOST: ice holes are present and give sight-lines across zone boundaries', () => {
  const L = parseLevel(LEVEL5);
  const pits = L.find((c) => c === PIT);
  assert.ok(pits.length >= 40, `${pits.length} ice-hole tiles`);
  const cross = crossZonePits(LEVEL5);
  const pairs = new Set(cross.map((c) => c.pair));
  // Radar|Greenhouse, Radar|Barracks, Barracks|Landing, Landing|Fuel, Fuel|Greenhouse, Greenhouse|Command
  assert.ok(pairs.size >= 6, `ice-hole sight-lines between ${pairs.size} zone pairs`);
  // plus ice holes inside zones / the arena that split nothing (zone count 7 is checked by the
  // suite): the frozen pond, the pad ice hole and two holes in the cavern floor
  const inner = pits.filter((p) => !cross.some((c) => c.pit.x === p.x && c.pit.y === p.y)
    && N4.every(([dx, dy]) => L.at(p.x + dx, p.y + dy) !== '#'));
  assert.ok(inner.length >= 4, `${inner.length} free-standing ice-hole tiles`);
});

test('OUTPOST: map.js loads the level; ice holes block movers but not rays', () => {
  if (typeof map.TILE_PIT !== 'number') return; // Agent D's TILE_PIT not landed yet
  const m = map.loadMap(LEVEL5);
  const cross = crossZonePits(LEVEL5);
  assert.ok(cross.length > 0);
  for (const { pit, a, b } of cross) {
    assert.equal(m.tiles[pit.y * m.cols + pit.x], map.TILE_PIT);
    assert.equal(map.isWalkable(m, pit.x, pit.y), false, `pit ${pit.x},${pit.y} walkable`);
    assert.equal(map.isWalkable(m, pit.x, pit.y, true), false, `pit ${pit.x},${pit.y} walkable for zombies`);
    const pa = map.tileToWorld(a.x, a.y), pb = map.tileToWorld(b.x, b.y);
    const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const hit = map.raycastWalls(m, pa.x, pa.y, pb.x - pa.x, pb.y - pa.y, dist);
    assert.ok(hit >= dist, `ray across pit ${pit.x},${pit.y} blocked at ${hit}`);
  }
});

test('OUTPOST: zones, gates and spawns per the design', () => {
  const L = parseLevel(LEVEL5);
  assert.deepEqual([L.start.x, L.start.y], [31, 29], 'P on the landing pad');
  // gates: D west fence of the pad, E rock ridge, F pad north fence, G frozen stream, H bunker fence
  const at = (d) => L.doors.find((x) => x.letter === d).tiles.map((t) => [t.x, t.y]);
  assert.deepEqual(at('D'), [[21, 29], [21, 30], [21, 31]]);
  assert.deepEqual(at('E'), [[10, 18], [11, 18], [12, 18]]);
  assert.deepEqual(at('F'), [[30, 23], [31, 23], [32, 23]]);
  assert.deepEqual(at('G'), [[33, 13], [34, 13], [35, 13]]);
  assert.deepEqual(at('H'), [[43, 7], [43, 8], [43, 9]]);
  // every gate sits in a boundary that also has ice holes (within 6 tiles along its line)
  for (const d of ['D', 'E', 'F', 'G', 'H']) {
    const tiles = L.doors.find((x) => x.letter === d).tiles;
    const vertical = tiles[0].x === tiles[1].x;
    let ice = false;
    for (const t of tiles) for (let k = -6; k <= 6; k++) {
      if ((vertical ? L.at(t.x, t.y + k) : L.at(t.x + k, t.y)) === PIT) ice = true;
    }
    assert.ok(ice, `gate ${d} in an ice-hole fence line`);
  }
  // box in the radar array (behind D + E)
  assert.equal(openingStep(L, L.boxes[0]), 2);
  // one window in a barracks shed and one in a fuel tank (pockets inside buildings)
  const inside = L.pockets.filter((s) => s.x > 2 && s.x < COLS - 3 && s.y > 2 && s.y < ROWS - 3);
  assert.equal(inside.length, 2, 'two pockets inside buildings');
});

test('OUTPOST: wall guns - cheap KN-44 on the pad, all tier-3 and tier-2 behind gates', () => {
  const L = parseLevel(LEVEL5);
  const step = Object.fromEntries(L.buys.map((b) => [b.weaponId, openingStep(L, b)]));
  assert.equal(step.kn44, 0);
  for (const g of TIER3_GUNS) assert.ok(step[g] >= 1, `${g} behind a gate`);
  for (const g of ['gorgon', 'drakon', 'manowar', 'marshal16']) assert.ok(step[g] >= 1, `${g} on a wall behind a gate`);
  assert.equal(step.gorgon, 5, 'Gorgon in the command bunker');
  assert.equal(L.buys.length, 8);
});

test('OUTPOST: no wall gun or perk can be bought through a fence from a neighbouring zone', () => {
  const L = parseLevel(LEVEL5);
  const Z = zones(L);
  for (const t of [...L.buys, ...L.perks, ...L.paps]) {
    const zs = new Set(N4.map(([dx, dy]) => [t.x + dx, t.y + dy])
      .filter(([x, y]) => FLOORISH.has(L.at(x, y))).map(([x, y]) => Z.comp[key(x, y)]));
    assert.equal(zs.size, 1, `'${t.ch}' at ${t.x},${t.y} faces ${zs.size} zones`);
  }
});

test('OUTPOST: arena "Ice cavern" with 4 ice columns and ice holes', () => {
  const L = parseLevel(LEVEL5);
  assert.equal(L.boss.length, 1);
  assert.equal(L.minions.length, 5);
  assert.deepEqual([L.boss[0].x, L.boss[0].y], [50, 30]);
  for (const [x, y] of [[47, 28], [52, 28], [47, 32], [52, 32]]) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.equal(L.at(x + dx, y + dy), '#', `column ${x},${y}`);
  }
  assert.equal(L.at(45, 33), PIT);
  assert.equal(L.at(54, 27), PIT);
});

test('OUTPOST: layout differs > 25 % from every other level', () => {
  for (const other of LEVELS) {
    if (other === LEVEL5) continue;
    const d = tileDiff(LEVEL5, other);
    assert.ok(d > COLS * ROWS * 0.25, `only ${d} tiles differ from ${other.id}`);
  }
});

test('OUTPOST: theme is white-blue snow, grey-blue rock, orange accent, cold ambient, snowfall', () => {
  const t = LEVEL5.theme;
  assert.equal(t.style, 'outpost');
  assert.equal(t.name, 'OUTPOST');
  assert.equal(t.torch, false);
  assert.equal(t.flicker, false);
  assert.equal(t.snow, true);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const k of ['floor', 'floorAlt']) {
    const [r, g, b] = rgb(t[k]);
    assert.ok(r > 190 && g > 200 && b > 210 && b >= r, `${k} ${t[k]} is white-blue snow`);
  }
  const [wr, , wb] = rgb(t.wall);
  assert.ok(wb > wr && wr < 140, `wall ${t.wall} grey-blue rock`);
  const [ar, ag, ab] = rgb(t.accent);
  assert.ok(ar > 200 && ag > 80 && ag < 160 && ab < 80, `accent ${t.accent} orange`);
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(t.ambient);
  assert.ok(m && +m[3] > +m[1] && +m[4] > 0 && +m[4] <= 0.2, `ambient ${t.ambient} cold blue`);
});

test('OUTPOST: level data stays pure (no imports, no randomness, no DOM)', () => {
  const src = readFileSync(new URL('../src/levels/level5.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /Math\.random|window\.|document\./);
});

// ---- WO9 FIX-1 (QA docs/qa/wo9-outpost.md #1, #2, #4) ---------------------------------------------

test('OUTPOST FIX-1: arena ice holes touch the walls (no 1-tile boss lanes); M8A7 and barracks window moved', () => {
  const L = parseLevel(LEVEL5);
  assert.equal(LEVEL5.ascii[27].slice(52), '..~~~###');
  assert.equal(LEVEL5.ascii[33].slice(42, 49), '##~~~##');
  // no arena floor tile squeezed between a pit and a wall / pit on both sides (a 1-tile lane)
  for (let y = 25; y <= 36; y++) for (let x = 44; x <= 56; x++) {
    if (!FLOORISH.has(L.at(x, y))) continue;
    const solid = (c) => c === '#' || c === PIT;
    const lane = (solid(L.at(x - 1, y)) && solid(L.at(x + 1, y)) && [L.at(x - 1, y), L.at(x + 1, y)].includes(PIT))
      || (solid(L.at(x, y - 1)) && solid(L.at(x, y + 1)) && [L.at(x, y - 1), L.at(x, y + 1)].includes(PIT));
    assert.ok(!lane, `1-tile lane beside an ice hole at ${x},${y}`);
  }
  const m8 = L.buys.find((b) => b.weaponId === 'm8a7');
  assert.deepEqual([m8.x, m8.y], [9, 9]);
  assert.ok(L.windows.some((w) => w.x === 14 && w.y === 37) && L.pockets.some((s) => s.x === 14 && s.y === 38));
  assert.ok(!L.windows.some((w) => w.x === 2 && w.y === 25));
});
