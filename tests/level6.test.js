// tests/level6.test.js — WO9 Agent C: level 6 TEMPLE (sunken jungle temple).
// Full validity suite via tests/helpers/levelcheck.js plus TEMPLE-specific layout asserts:
// left/right symmetry, bridges as <= 2-wide chokepoints over water, long sight-lines across the
// pool, zone contents, theme hints, and difference from every other level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVEL6 } from '../src/levels/level6.js';
import { LEVELS } from '../src/levels/levels.js';
import * as mapMod from '../src/map.js';
import {
  assertValidLevel, validateLevel, parseLevel, playerBfs, walkFn, bfs, reached, touches, key,
  openingStep, tileDiff, freeStandingBlocks, zones, FLOORISH, PIT, COLS, ROWS, DOOR_LETTERS, N4,
} from './helpers/levelcheck.js';

const PERK_PLAN = { revive: 0, dtap: 1, speed: 2, stamin: 3, jugg: 4, mule: 5 };
const PAP_POS = [50, 1];
const L = parseLevel(LEVEL6);

// Bridges (all walked north/south): tile rectangle x0..x1, y0..y1.
const BRIDGES = [
  { name: 'west canal', x0: 17, x1: 18, y0: 22, y1: 23 },
  { name: 'east canal', x0: 41, x1: 42, y0: 22, y1: 23 },
  { name: 'south (G)', x0: 29, x1: 30, y0: 24, y1: 26 },
  { name: 'north (H)', x0: 29, x1: 30, y0: 16, y1: 18 },
];
const bridgeTiles = (b) => {
  const out = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) out.push({ x, y });
  return out;
};
// Tile class for the symmetry score.
const cls = (c) => (c === PIT ? 'pit' : FLOORISH.has(c) ? 'floor' : /[D-HMT]/.test(c) ? 'door' : 'solid');

test('TEMPLE: full validity suite (WO4/WO5/WO7/WO8/WO9 guns) with the perk plan and PaP position', () => {
  assert.deepEqual(validateLevel(LEVEL6, { wo9Guns: true, perkPlan: PERK_PLAN, papPos: PAP_POS }), []);
  assert.ok(assertValidLevel(LEVEL6, { wo9Guns: true, perkPlan: PERK_PLAN, papPos: PAP_POS }).start);
});

test('TEMPLE: id/name/boss/difficulty pinned, theme refined (style temple, water, spores)', () => {
  assert.equal(LEVEL6.id, 'temple');
  assert.equal(LEVEL6.name, 'TEMPLE');
  assert.deepEqual(LEVEL6.boss, { name: 'THE DROWNED KING', tint: '#3fd6a8', ability: 'tide' });
  assert.deepEqual(LEVEL6.difficulty, { healthMult: 3.5, speedMult: 1.26, countMult: 1.8, sprintShift: 11 });
  const t = LEVEL6.theme;
  assert.equal(t.style, 'temple');
  assert.equal(t.water, true);
  assert.equal(t.spores, true);
  for (const k of ['waterDeep', 'waterLight', 'moss', 'vine', 'glyph']) assert.match(t[k], /^#[0-9a-f]{6}$/i, k);
  assert.match(t.ambient, /^rgba\(/);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // mossy green-grey floor: green channel dominates
  for (const k of ['floor', 'floorAlt']) { const [r, g, b] = rgb(t[k]); assert.ok(g > r && g > b, k); }
  // sandstone wall: warm (red > green > blue)
  const [wr, wg, wb] = rgb(t.wall);
  assert.ok(wr > wg && wg > wb, 'sandstone wall');
});

test('TEMPLE: strong left/right symmetry (tile classes mirror about the centre line)', () => {
  let same = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (cls(LEVEL6.ascii[y][x]) === cls(LEVEL6.ascii[y][COLS - 1 - x])) same++;
  }
  const score = same / (COLS * ROWS);
  assert.ok(score >= 0.99, `symmetry ${score.toFixed(4)}`);
  // every door tile is centred or has its mirror twin (E <-> F)
  for (const dr of L.doors) for (const t of dr.tiles) {
    assert.equal(cls(L.at(COLS - 1 - t.x, t.y)), 'door', `door ${dr.letter} at ${t.x},${t.y} unmirrored`);
  }
  // windows, pockets and open spawns pair up across the axis
  for (const t of [...L.windows, ...L.pockets, ...L.opens]) {
    assert.equal(L.at(COLS - 1 - t.x, t.y), t.ch, `${t.ch} at ${t.x},${t.y} unmirrored`);
  }
});

test('TEMPLE: plenty of water; pool, canals and arena pools are see-through pits', () => {
  const pits = L.find((c) => c === PIT);
  assert.ok(pits.length >= 150, `${pits.length} water tiles`);
  for (const p of pits) for (const [dx, dy] of N4) {
    assert.ok(!['S', 'W'].includes(L.at(p.x + dx, p.y + dy)), `pit ${p.x},${p.y} next to a spawn`);
  }
  // the arena "Flooded pit" holds water
  const dA = bfs([L.boss[0]], walkFn(L, new Set()));
  const arenaPits = pits.filter((p) => touches(dA, p));
  assert.ok(arenaPits.length >= 8, `${arenaPits.length} arena water tiles`);
});

test('TEMPLE: bridges are <= 2 tiles wide, flanked by water, and are chokepoints', () => {
  for (const b of BRIDGES) {
    assert.ok(b.x1 - b.x0 + 1 <= 2, `${b.name}: width`);
    for (const t of bridgeTiles(b)) {
      const c = L.at(t.x, t.y);
      assert.ok(FLOORISH.has(c) || DOOR_LETTERS.includes(c), `${b.name}: ${t.x},${t.y} is '${c}'`);
    }
    for (let y = b.y0; y <= b.y1; y++) {
      assert.equal(L.at(b.x0 - 1, y), PIT, `${b.name}: water west of row ${y}`);
      assert.equal(L.at(b.x1 + 1, y), PIT, `${b.name}: water east of row ${y}`);
    }
    // chokepoint: with every door open, blocking the bridge cuts a large part of the map off
    const tiles = new Set(bridgeTiles(b).map((t) => key(t.x, t.y)));
    const open = walkFn(L, new Set(DOOR_LETTERS));
    const dWith = bfs([L.start], open);
    const dWithout = bfs([L.start], (x, y) => !tiles.has(key(x, y)) && open(x, y));
    let lost = 0;
    for (let k = 0; k < dWith.length; k++) if (dWith[k] >= 0 && !tiles.has(k) && dWithout[k] < 0) lost++;
    assert.ok(lost >= 40, `${b.name}: blocking it only cuts off ${lost} tiles`);
  }
  // doors G and H sit on the bridges, capped by water / wall
  const at = (letter) => L.doors.find((d) => d.letter === letter).tiles.map((t) => [t.x, t.y]);
  assert.deepEqual(at('G'), [[29, 25], [30, 25]]);
  assert.deepEqual(at('H'), [[29, 15], [30, 15]]);
  assert.equal(L.at(28, 25), PIT);
  assert.equal(L.at(31, 25), PIT);
});

test('TEMPLE: long sight-lines over water (rays cross the pool, movers cannot)', () => {
  // row 17: west terrace to east terrace, 30 tiles, no wall, mostly water
  const row = LEVEL6.ascii[17].slice(15, 45);
  assert.ok(!row.includes('#'), row);
  assert.ok([...row].filter((c) => c === PIT).length >= 18, row);
  // row 20: west terrace across the pool to the island (idol hall), a different zone
  const Z = zones(L);
  assert.notEqual(Z.comp[key(17, 20)], Z.comp[key(25, 20)]);
  assert.ok(!LEVEL6.ascii[20].slice(15, 28).includes('#'));
  // map.js (Agent D): water blocks walking but not rays, once TILE_PIT has landed
  if (typeof mapMod.TILE_PIT !== 'number') return;
  const m = mapMod.loadMap(LEVEL6);
  assert.equal(m.tiles[17 * m.cols + 25], mapMod.TILE_PIT);
  assert.equal(mapMod.isWalkable(m, 25, 17), false);
  assert.equal(mapMod.isWalkable(m, 25, 17, true), false);
  const T = m.width / m.cols;
  const d = mapMod.raycastWalls(m, 15.5 * T, 17.5 * T, 1, 0);
  assert.ok(d >= 29 * T, `ray across the pool stopped at ${d}`);
});

test('TEMPLE: zones, spawns, guns and box where the design puts them', () => {
  const step = (t) => openingStep(L, t);
  // spawns per door step: gate 2 W, courtyard 2 W, each cloister 1 W, idol hall 2 O, sanctum 2 W
  const spawnSteps = [...L.windows, ...L.opens].map((t) => t.ch + step(t)).sort();
  assert.deepEqual(spawnSteps, ['O4', 'O4', 'W0', 'W0', 'W1', 'W1', 'W2', 'W3', 'W5', 'W5']);
  // guns: KN-44 at the gate; tier-3 + tier-2 behind doors; Gorgon / Drakon deepest
  const gun = Object.fromEntries(L.buys.map((b) => [b.weaponId, step(b)]));
  assert.deepEqual(gun, { kn44: 0, peacekeeper: 1, manowar: 1, hg40: 2, haymaker12: 2, m8a7: 3, marshal16: 3, gorgon: 5, drakon: 5 });
  // box on the idol's east face (behind D + G)
  assert.deepEqual([L.boxes[0].x, L.boxes[0].y], [31, 21]);
  assert.equal(step(L.boxes[0]), 4);
  // arena: centred mega door, stairs in the north wall, 4 X
  assert.deepEqual(L.mega.map((t) => [t.x, t.y]), [[29, 12], [30, 12]]);
  assert.deepEqual(L.stairs.map((t) => [t.x, t.y]), [[29, 1], [30, 1]]);
  assert.equal(L.minions.length, 4);
  // colonnades: many free-standing pillars (cloister columns, statues, idol, arena pillars)
  const blocks = freeStandingBlocks(LEVEL6);
  assert.ok(blocks >= 30, `${blocks} free-standing blocks`);
  // the start room touches no water; the west terrace is reachable with all doors open
  const d0 = playerBfs(L, []);
  assert.ok(!L.find((c) => c === PIT).some((p) => touches(d0, p)));
  assert.ok(reached(playerBfs(L, DOOR_LETTERS), { x: 17, y: 17 }));
});

test('TEMPLE: layout differs from every other level in > 25 % of tiles', () => {
  for (const other of LEVELS) {
    if (other === LEVEL6) continue;
    const diff = tileDiff(LEVEL6, other);
    assert.ok(diff > COLS * ROWS * 0.25, `only ${diff} tiles differ from ${other.id}`);
  }
});

test('TEMPLE: data file is pure (no imports, no randomness, no DOM)', () => {
  const src = readFileSync(new URL('../src/levels/level6.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b/m.test(src));
  assert.ok(!/Math\.random|\bdocument\.\w|\bwindow\.\w/.test(src));
});

// ---- WO9 FIX-1 (QA docs/qa/wo9-temple.md #1) ------------------------------------------------------

test('TEMPLE FIX-1: arena side inlets are 1 tile wide (2-tile lanes round the pillars)', () => {
  assert.equal(LEVEL6.ascii[6], '#SW.....###.....#####~................~#####.....###.....WS#');
  assert.equal(LEVEL6.ascii[7], '###.....###.....#####~.......Z........~#####.....###.....###');
  for (const y of [6, 7]) {
    assert.equal(L.at(22, y), '.'); assert.equal(L.at(37, y), '.');
    assert.equal(L.at(21, y), PIT); assert.equal(L.at(38, y), PIT);
  }
});
