import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowField, getFlowDir, distanceAt } from '../src/pathfinding.js';
import { TILE } from '../src/config.js';

// Build a fake Map from ASCII: '#' wall(1), '.' floor(0), 'W' window(2), 'S' spawnpocket(3),
// 'B' box(4), 'X' wallbuy(5), 'O' openspawn(6).
const CODES = { '.': 0, '#': 1, W: 2, S: 3, B: 4, X: 5, O: 6 };
function fakeMap(rowsAscii) {
  const rows = rowsAscii.length;
  const cols = rowsAscii[0].length;
  const tiles = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tiles[y * cols + x] = CODES[rowsAscii[y][x]];
  return { cols, rows, width: cols * TILE, height: rows * TILE, tiles };
}
const C = (t) => (t + 0.5) * TILE; // tile center in world units
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('straight corridor yields direct vectors and correct distances', () => {
  const map = fakeMap([
    '##########',
    '#........#',
    '##########',
  ]);
  const flow = buildFlowField(map, C(8), C(1));
  for (let x = 1; x < 8; x++) {
    const d = getFlowDir(flow, C(x), C(1));
    assert.ok(near(d.x, 1) && near(d.y, 0), `tile ${x}: ${d.x},${d.y}`);
    assert.equal(distanceAt(flow, C(x), C(1)), 8 - x);
  }
  // Off-center positions within the corridor still point along it.
  const d = getFlowDir(flow, C(2) + 13, C(1) - 7);
  assert.ok(near(d.x, 1) && near(d.y, 0));
  assert.equal(distanceAt(flow, C(8), C(1)), 0);
});

test('open room gives a diagonal toward a diagonal target', () => {
  const map = fakeMap([
    '#######',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ]);
  const flow = buildFlowField(map, C(4), C(4));
  const d = getFlowDir(flow, C(1), C(1));
  assert.ok(near(d.x, Math.SQRT1_2) && near(d.y, Math.SQRT1_2), `${d.x},${d.y}`);
});

test('obstacle: path routes around a wall', () => {
  const map = fakeMap([
    '#######',
    '#.....#',
    '#.###.#',
    '#.#.#.#',
    '#.#.#.#',
    '#######',
  ]);
  // Target at bottom of the left column; start at bottom of the right column.
  const flow = buildFlowField(map, C(1), C(4));
  assert.equal(distanceAt(flow, C(5), C(4)), 3 + 4 + 3);
  const d = getFlowDir(flow, C(5), C(4));
  assert.ok(near(d.x, 0) && near(d.y, -1), `must go up first: ${d.x},${d.y}`);
  // Following the field from the start reaches the target without entering a wall.
  let x = C(5), y = C(4);
  for (let step = 0; step < 400 && distanceAt(flow, x, y) > 0; step++) {
    const v = getFlowDir(flow, x, y);
    x += v.x * 5; y += v.y * 5;
    const ti = Math.floor(y / TILE) * map.cols + Math.floor(x / TILE);
    assert.notEqual(map.tiles[ti], 1, `walked into a wall at ${x},${y}`);
  }
  assert.equal(distanceAt(flow, x, y), 0);
});

test('unreachable tiles return Infinity and {0,0}', () => {
  const map = fakeMap([
    '#######',
    '#..#..#',
    '#..#..#',
    '#######',
  ]);
  const flow = buildFlowField(map, C(1), C(1));
  assert.equal(distanceAt(flow, C(5), C(1)), Infinity);
  assert.deepEqual(getFlowDir(flow, C(5), C(2)), { x: 0, y: 0 });
  // Walls and out-of-bounds.
  assert.equal(distanceAt(flow, C(3), C(1)), Infinity);
  assert.equal(distanceAt(flow, -100, -100), Infinity);
  assert.deepEqual(getFlowDir(flow, 99999, 5), { x: 0, y: 0 });
});

test('no diagonal corner cutting past a wall corner', () => {
  const map = fakeMap([
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ]);
  // From (2,3) the diagonal (1,2) is closer to target (1,1), but orthogonal (2,2) is a wall,
  // so the diagonal must be rejected and the tile must point pure west.
  const flow = buildFlowField(map, C(1), C(1));
  const i = 3 * map.cols + 2;
  assert.ok(flow.dirX[i] === -1 && flow.dirY[i] === 0, `${flow.dirX[i]},${flow.dirY[i]}`);
  const d = getFlowDir(flow, C(2), C(3));
  assert.ok(near(d.x, -1) && near(d.y, 0), `expected pure west, got ${d.x},${d.y}`);
});

test('diagonal neighbor through a pinched gap is not connected', () => {
  const map = fakeMap([
    '####',
    '#.##',
    '##.#',
    '####',
  ]);
  const flow = buildFlowField(map, C(1), C(1));
  assert.equal(distanceAt(flow, C(2), C(2)), Infinity);
});

test('windows, spawn pockets, open spawns are walkable; box and wallbuy block', () => {
  const map = fakeMap([
    '#########',
    '#SW..BO.#',
    '#####X###',
  ]);
  const flow = buildFlowField(map, C(3), C(1));
  assert.equal(distanceAt(flow, C(1), C(1)), 2); // S through W
  assert.equal(distanceAt(flow, C(2), C(1)), 1);
  assert.equal(distanceAt(flow, C(5), C(1)), Infinity); // box
  assert.equal(distanceAt(flow, C(6), C(1)), Infinity); // O cut off by the box
  assert.equal(distanceAt(flow, C(5), C(2)), Infinity); // wallbuy
});

test('target tile points at the exact target; target inside a wall still works', () => {
  const map = fakeMap([
    '#####',
    '#...#',
    '#...#',
    '#####',
  ]);
  const flow = buildFlowField(map, C(2) + 10, C(1));
  const d = getFlowDir(flow, C(2) - 5, C(1));
  assert.ok(d.x > 0.99, `${d.x},${d.y}`);
  const wf = buildFlowField(map, C(0), C(1)); // target inside the left wall
  assert.equal(distanceAt(wf, C(1), C(1)), 0);
  assert.ok(Number.isFinite(distanceAt(wf, C(3), C(2))));
});

test('null / empty inputs are safe', () => {
  const flow = buildFlowField(null, 0, 0);
  assert.equal(distanceAt(flow, 0, 0), Infinity);
  assert.deepEqual(getFlowDir(flow, 0, 0), { x: 0, y: 0 });
  assert.equal(distanceAt(null, 0, 0), Infinity);
  assert.deepEqual(getFlowDir(null, 0, 0), { x: 0, y: 0 });
});

test('returned directions are unit length everywhere reachable', () => {
  const map = fakeMap([
    '##########',
    '#....#...#',
    '#.##.#.#.#',
    '#..#...#.#',
    '##########',
  ]);
  const flow = buildFlowField(map, C(8), C(3));
  for (let y = TILE; y < 4 * TILE; y += 7) for (let x = TILE; x < 9 * TILE; x += 7) {
    const dd = distanceAt(flow, x, y);
    if (dd === Infinity || dd === 0) continue;
    const d = getFlowDir(flow, x, y);
    assert.ok(near(Math.hypot(d.x, d.y), 1, 1e-4), `at ${x},${y}`);
  }
});

test('perf: buildFlowField on 60x40 averages well under budget', () => {
  const cols = 60, rows = 40;
  const rowsAscii = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) {
      const border = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      const pillar = x % 6 === 3 && y % 5 !== 0; // wall strips with gaps
      s += border || pillar ? '#' : '.';
    }
    rowsAscii.push(s);
  }
  const map = fakeMap(rowsAscii);
  for (let i = 0; i < 10; i++) buildFlowField(map, C(30 + (i % 2)), C(20)); // warm-up
  const runs = 50;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) buildFlowField(map, C(1 + (i % 50)), C(1 + (i % 38)));
  const avg = (performance.now() - t0) / runs;
  console.log(`buildFlowField 60x40 avg: ${avg.toFixed(3)} ms over ${runs} runs`);
  assert.ok(avg < 5, `avg ${avg} ms (target < 2 ms)`);
});
