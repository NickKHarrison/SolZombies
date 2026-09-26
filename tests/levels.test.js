// tests/levels.test.js — WO5 3.5 level data (Agent A).
// Parses each level's ASCII independently (no map.js) and runs the WO4 layout validity suite
// (as in tests/map.test.js) plus the WO5 arena rules on every level in the registry.
// WO7 3.4 (Agent I): perk machines (J Q C N U K, wall tiles) parsed here independently of map.js;
// perk placement rules checked on every level; level 3 LABORATORY layout checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEVELS, levelByIndex } from '../src/levels/levels.js';
import { LEVEL1 } from '../src/levels/level1.js';
import { LEVEL2 } from '../src/levels/level2.js';
import { LEVEL3 } from '../src/levels/level3.js'; // WO7 Phase 0

const COLS = 60, ROWS = 40;
const DOOR_LETTERS = ['D', 'E', 'F', 'G', 'H'];
// WO7 1.2: perk machine letters -> perk ids (config PERKS.list letters).
const PERK_LETTERS = { J: 'jugg', Q: 'revive', C: 'speed', N: 'dtap', U: 'stamin', K: 'mule' };
const LEGEND = new Set(['#', '.', 'P', 'W', 'S', 'O', 'B', 'M', 'Z', 'X', 'T', ...DOOR_LETTERS, ...Object.keys(PERK_LETTERS)]);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Every weapon id a level may put on a wall (WO4 guns + WO5 3.4 new guns).
const KNOWN_WEAPONS = new Set(['sheiva', 'rk5', 'krm262', 'kuda', 'vmp', 'vesper', 'kn44', 'hvk30',
  'argus', 'lcar9', 'pharo', 'icr1', 'bootlegger', 'manowar', 'xr2', 'weevil', 'marshal16', 'gorgon',
  'dredge48', 'haymaker12', 'drakon', 'hg40', 'm8a7', 'peacekeeper']);
const TIER3_GUNS = ['hg40', 'm8a7', 'peacekeeper']; // WO7 1.5
const NEW_GUNS = ['manowar', 'xr2', 'weevil', 'marshal16', 'gorgon', 'dredge48', 'haymaker12', 'drakon'];

// WO4 level-1 layout (map.js MAP_ASCII before WO5), to prove the edit stays local.
const WO4_ASCII = [
  '############################################################',
  '########S###########################S#######################',
  '########W#####################2#####W#######################',
  '###...............F......................................###',
  '###...............F..............##......................###',
  '###...............F..............##......................###',
  '##5...##........###......................................###',
  '###...##........########...###############...............###',
  '###.............########...###############.....#####.....a##',
  '###........##...########...###############.....#####.....###',
  '###........##...########...###############.....#####.....###',
  '###.............########...###############.....#####.....###',
  '###.............########...###############.....#####.....###',
  '#############8##########...###############.....#####.....###',
  '########################DDD######1########.....#####.....###',
  '#####################................#####...............###',
  '#####################................#####...............###',
  '###..............####................#####...............###',
  '###..............####...##...........#####...............###',
  '###.................E...##...........WS###..............O###',
  '###.................E................#######################',
  '###...##....##......E...........##...#######################',
  '###...##....##...####...........##...#######################',
  '###..............####................###############c#######',
  '###..............####.......P........###########.........###',
  '###..............####................###########.........###',
  '#SW..............3###................###########.........###',
  '###..............############W##################.........###',
  '###..............############S##################.........###',
  '###..............#########################9#####...###...###',
  '###...##....##...###.........................###...###...WS#',
  '###...##....##...###.........................###.........###',
  '###................G.......##.......##.........H.........###',
  '###................G.......##.......##.........H.........###',
  '##4................G...........................H.........###',
  '###..............###.........................###.........###',
  '###..............###.O................B......###.........###',
  '#########W##############7########W##########################',
  '#########S#######################S##########################',
  '############################################################',
];
const WO4_WALLBUYS = { '1': 'sheiva', '2': 'rk5', '3': 'krm262', '4': 'kuda', '5': 'vmp', '6': 'vesper',
  '7': 'kn44', '8': 'hvk30', '9': 'argus', 'a': 'lcar9', 'b': 'pharo', 'c': 'icr1', 'd': 'bootlegger' };

// ---- independent parser ---------------------------------------------------------------------

function parseLevel(def) {
  const g = def.ascii;
  const at = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS ? '#' : g[y][x]);
  const find = (pred) => {
    const out = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (pred(g[y][x])) out.push({ x, y, ch: g[y][x] });
    return out;
  };
  const buyKeys = new Set(Object.keys(def.wallbuys));
  return {
    def, at, find, buyKeys,
    start: find((c) => c === 'P')[0],
    boxes: find((c) => c === 'B'),
    windows: find((c) => c === 'W'),
    pockets: find((c) => c === 'S'),
    opens: find((c) => c === 'O'),
    buys: find((c) => buyKeys.has(c)).map((t) => ({ ...t, weaponId: def.wallbuys[t.ch] })),
    doors: DOOR_LETTERS.map((L) => ({ letter: L, tiles: find((c) => c === L) })),
    mega: find((c) => c === 'M'),
    stairs: find((c) => c === 'T'),
    boss: find((c) => c === 'Z'),
    minions: find((c) => c === 'X'),
    perks: find((c) => c in PERK_LETTERS).map((t) => ({ ...t, perkId: PERK_LETTERS[t.ch] })),
  };
}

const key = (x, y) => y * COLS + x;
const FLOORISH = new Set(['.', 'P', 'O', 'Z', 'X']);

// Player-walkable given a set of open door letters ('M' and 'T' count as letters too).
function walkFn(L, open) {
  return (x, y) => {
    const c = L.at(x, y);
    return FLOORISH.has(c) || open.has(c);
  };
}

function bfs(starts, passable) {
  const d = new Int32Array(COLS * ROWS).fill(-1);
  const q = [];
  for (const s of starts) { d[key(s.x, s.y)] = 0; q.push(s); }
  for (let i = 0; i < q.length; i++) {
    const { x, y } = q[i];
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const k = key(nx, ny);
      if (d[k] >= 0 || !passable(nx, ny)) continue;
      d[k] = d[key(x, y)] + 1; q.push({ x: nx, y: ny });
    }
  }
  return d;
}

const touches = (d, t) => N4.some(([dx, dy]) => {
  const nx = t.x + dx, ny = t.y + dy;
  return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && d[key(nx, ny)] >= 0;
});
const reached = (d, t) => d[key(t.x, t.y)] >= 0;
const playerBfs = (L, open) => bfs([L.start], walkFn(L, new Set(open)));
const zombieWalk = (L, open) => {
  const w = walkFn(L, new Set(open));
  return (x, y) => w(x, y) || L.at(x, y) === 'W' || L.at(x, y) === 'S';
};

// Active spawns as map.js recomputeActiveSpawns does: BFS from P over floor + windows + pockets
// + open spawns (+ open doors); a window counts if its tile is reached, an O if reached.
function activeSpawns(L, open) {
  const d = bfs([L.start], zombieWalk(L, open));
  const ids = new Set();
  L.windows.forEach((t, i) => { if (reached(d, t)) ids.add(`W${i}`); });
  L.opens.forEach((t, i) => { if (reached(d, t)) ids.add(`O${i}`); });
  return ids;
}

// A straight run of 2-3 tiles in a wall, optionally with walkable tiles on both sides across it.
function checkRun(L, tiles, name, { bothSides = true } = {}) {
  assert.ok(tiles.length >= 2 && tiles.length <= 3, `${name}: ${tiles.length} tiles`);
  const xs = new Set(tiles.map((t) => t.x)), ys = new Set(tiles.map((t) => t.y));
  assert.ok(xs.size === 1 || ys.size === 1, `${name}: straight`);
  const axis = ys.size === 1 ? 'h' : 'v';
  const along = tiles.map((t) => (axis === 'h' ? t.x : t.y)).sort((a, b) => a - b);
  for (let i = 1; i < along.length; i++) assert.equal(along[i], along[i - 1] + 1, `${name}: contiguous`);
  const [ox, oy] = axis === 'h' ? [0, 1] : [1, 0];
  if (bothSides) {
    for (const t of tiles) {
      assert.ok(FLOORISH.has(L.at(t.x + ox, t.y + oy)), `${name}: walkable side + at ${t.x},${t.y}`);
      assert.ok(FLOORISH.has(L.at(t.x - ox, t.y - oy)), `${name}: walkable side - at ${t.x},${t.y}`);
    }
  }
  // the run's two ends are capped by wall
  const lo = along[0] - 1, hi = along[along.length - 1] + 1, c = axis === 'h' ? tiles[0].y : tiles[0].x;
  const cap = (v) => (axis === 'h' ? L.at(v, c) : L.at(c, v));
  assert.equal(cap(lo), '#', `${name}: capped`); assert.equal(cap(hi), '#', `${name}: capped`);
  return axis;
}

// Connected components of walkable tiles with every door / M / T closed.
function zones(L) {
  const comp = new Int32Array(COLS * ROWS).fill(-1);
  const w = walkFn(L, new Set());
  let n = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!w(x, y) || comp[key(x, y)] >= 0) continue;
    const d = bfs([{ x, y }], w);
    for (let k = 0; k < d.length; k++) if (d[k] >= 0) comp[k] = n;
    n++;
  }
  return { comp, n };
}
function neighbourZones(Z, tiles) {
  const s = new Set();
  for (const t of tiles) for (const [dx, dy] of N4) {
    const nx = t.x + dx, ny = t.y + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && Z.comp[key(nx, ny)] >= 0) s.add(Z.comp[key(nx, ny)]);
  }
  return s;
}

// ---- WO4 validity suite ---------------------------------------------------------------------

function validateWO4(def) {
  const L = parseLevel(def);
  const id = def.id;
  // shape, legend, borders
  assert.equal(def.ascii.length, ROWS, `${id} rows`);
  for (const row of def.ascii) assert.equal(row.length, COLS, `${id} cols`);
  for (const k of L.buyKeys) assert.ok(!LEGEND.has(k) && k.length === 1, `${id}: wall-buy key '${k}' clashes with the legend`);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = def.ascii[y][x];
    assert.ok(LEGEND.has(c) || L.buyKeys.has(c), `${id}: unknown char '${c}' at ${x},${y}`);
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) assert.equal(c, '#', `${id}: border at ${x},${y}`);
  }
  // counts
  assert.ok(L.start, `${id}: P`);
  assert.equal(L.find((c) => c === 'P').length, 1, `${id}: one P`);
  assert.equal(L.boxes.length, 1, `${id}: one box`);
  assert.equal(L.windows.length, 8, `${id}: 8 windows`);
  assert.equal(L.pockets.length, 8, `${id}: 8 pockets`);
  assert.equal(L.opens.length, 2, `${id}: 2 open spawns`);
  assert.ok(L.buys.length >= 8 && L.buys.length <= 10, `${id}: 8-10 wall buys`);
  for (const b of L.buys) assert.ok(KNOWN_WEAPONS.has(b.weaponId), `${id}: unknown weapon ${b.weaponId}`);
  for (const w of Object.values(def.wallbuys)) assert.ok(KNOWN_WEAPONS.has(w), `${id}: unknown weapon ${w}`);
  assert.equal(new Set(L.buys.map((b) => b.weaponId)).size, L.buys.length, `${id}: weapon ids unique on the wall`);
  // windows <-> pockets, pockets sealed
  for (const w of L.windows) {
    assert.equal(N4.filter(([dx, dy]) => L.at(w.x + dx, w.y + dy) === 'S').length, 1, `${id}: window ${w.x},${w.y} has one pocket`);
    assert.equal(N4.filter(([dx, dy]) => FLOORISH.has(L.at(w.x + dx, w.y + dy))).length, 1, `${id}: window ${w.x},${w.y} faces one floor tile`);
  }
  for (const s of L.pockets) {
    for (const [dx, dy] of N4) {
      const c = L.at(s.x + dx, s.y + dy);
      assert.ok(c === '#' || c === 'W', `${id}: pocket ${s.x},${s.y} leaks to '${c}'`);
    }
    assert.equal(N4.filter(([dx, dy]) => L.at(s.x + dx, s.y + dy) === 'W').length, 1, `${id}: pocket ${s.x},${s.y} has one window`);
  }
  // wall buys and box face floor
  for (const t of [...L.buys, ...L.boxes]) {
    assert.ok(N4.some(([dx, dy]) => FLOORISH.has(L.at(t.x + dx, t.y + dy))), `${id}: '${t.ch}' at ${t.x},${t.y} faces floor`);
  }
  // doors: D..H present, straight 2-3 runs in a 1-thick wall
  for (const dr of L.doors) {
    assert.ok(dr.tiles.length > 0, `${id}: door ${dr.letter} present`);
    checkRun(L, dr.tiles, `${id} door ${dr.letter}`);
  }
  // no pocket reachable, whatever doors (and M, T) are open
  const all = [...DOOR_LETTERS, 'M', 'T'];
  for (let k = 0; k <= all.length; k++) {
    const d = playerBfs(L, all.slice(0, k));
    for (const s of L.pockets) assert.ok(!reached(d, s), `${id}: pocket ${s.x},${s.y} reachable with ${k} doors`);
  }
  // all doors open: every buy, the box, every window reachable; zombies reach P from every spawn
  const dAll = playerBfs(L, DOOR_LETTERS);
  for (const b of L.buys) assert.ok(touches(dAll, b), `${id}: wallbuy ${b.weaponId} reachable`);
  assert.ok(touches(dAll, L.boxes[0]), `${id}: box reachable`);
  for (const w of L.windows) assert.ok(touches(dAll, w), `${id}: window ${w.x},${w.y} reachable`);
  for (const o of L.opens) assert.ok(reached(dAll, o), `${id}: open spawn ${o.x},${o.y} reachable`);
  const dz = bfs([L.start], zombieWalk(L, DOOR_LETTERS));
  for (const s of [...L.pockets, ...L.opens]) assert.ok(reached(dz, s), `${id}: spawn ${s.x},${s.y} reaches the start`);
  // zones: 6 zones + the arena; the doors form a tree over the 6 zones (no door-less links)
  const Z = zones(L);
  assert.equal(Z.n, 7, `${id}: 6 zones + arena`);
  const startZone = Z.comp[key(L.start.x, L.start.y)];
  const arenaZone = L.boss.length ? Z.comp[key(L.boss[0].x, L.boss[0].y)] : -1;
  const edges = L.doors.map((dr) => {
    const s = neighbourZones(Z, dr.tiles);
    assert.equal(s.size, 2, `${id}: door ${dr.letter} joins exactly two zones`);
    const [a, b] = s;
    assert.ok(a !== arenaZone && b !== arenaZone, `${id}: door ${dr.letter} opens the arena`);
    return [dr.letter, a, b];
  });
  const linked = new Set([startZone]);
  for (let pass = 0; pass < 5; pass++) for (const [, a, b] of edges) if (linked.has(a) || linked.has(b)) { linked.add(a); linked.add(b); }
  assert.equal(linked.size, 6, `${id}: doors connect all 6 zones (tree: 5 doors, 6 zones)`);
  // closed: only the start room's 2 windows; opening D..H in order: approachable, strictly grows to 10
  let prev = activeSpawns(L, []);
  assert.equal(prev.size, 2, `${id}: start room has 2 spawns`);
  const dStart = playerBfs(L, []);
  assert.equal(L.windows.filter((w) => touches(dStart, w)).length, 2, `${id}: start room has 2 windows`);
  const opened = [];
  for (const dr of L.doors) {
    assert.ok(dr.tiles.some((t) => touches(playerBfs(L, opened), t)), `${id}: door ${dr.letter} approachable in D..H order`);
    opened.push(dr.letter);
    const cur = activeSpawns(L, opened);
    for (const s of prev) assert.ok(cur.has(s), `${id}: door ${dr.letter} dropped a spawn`);
    assert.ok(cur.size > prev.size, `${id}: door ${dr.letter} adds spawns`);
    prev = cur;
  }
  assert.equal(prev.size, 10, `${id}: all 10 spawns active`);
  // wall buys: exactly one in the start room, across the room from P; all pairs >= 8 apart
  const startBuys = L.buys.filter((b) => touches(dStart, b));
  assert.equal(startBuys.length, 1, `${id}: one wall buy in the start room`);
  assert.ok(Math.abs(startBuys[0].x - L.start.x) + Math.abs(startBuys[0].y - L.start.y) >= 8, `${id}: start buy across the room`);
  for (let i = 0; i < L.buys.length; i++) for (let j = i + 1; j < L.buys.length; j++) {
    const a = L.buys[i], b = L.buys[j];
    const md = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.ok(md >= 8, `${id}: ${a.weaponId} / ${b.weaponId} only ${md} apart`);
  }
  // box behind >= 2 doors
  for (let only = -1; only < L.doors.length; only++) {
    const d = playerBfs(L, only >= 0 ? [L.doors[only].letter] : []);
    assert.ok(!touches(d, L.boxes[0]), `${id}: box reachable with only door #${only + 1}`);
  }
  return { L, Z, edges, startZone, arenaZone };
}

// ---- WO5 arena rules (3.1 / 3.5) ------------------------------------------------------------

function validateArena(def) {
  const { L, Z, edges, startZone, arenaZone } = validateWO4(def);
  const id = def.id;
  assert.equal(L.boss.length, 1, `${id}: one Z`);
  assert.ok(L.minions.length >= 4 && L.minions.length <= 6, `${id}: 4-6 X`);
  assert.ok(L.mega.length > 0 && L.stairs.length > 0, `${id}: M and T present`);
  checkRun(L, L.mega, `${id} mega door`);
  const tAxis = checkRun(L, L.stairs, `${id} stairs`, { bothSides: false });
  // arena = tiles reachable from Z with M and T closed
  const dA = bfs([L.boss[0]], walkFn(L, new Set()));
  const inA = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && dA[key(x, y)] >= 0;
  const tiles = [];
  for (let k = 0; k < dA.length; k++) if (dA[k] >= 0) tiles.push({ x: k % COLS, y: Math.floor(k / COLS) });
  // every X inside, on the edge (next to a wall)
  for (const x of L.minions) {
    assert.ok(inA(x.x, x.y), `${id}: X ${x.x},${x.y} in arena`);
    assert.ok(N4.some(([dx, dy]) => L.at(x.x + dx, x.y + dy) === '#'), `${id}: X ${x.x},${x.y} on the arena edge`);
  }
  // about 14x12 of open floor; no windows/pockets/open spawns/box/wall buys/doors in or next to it
  assert.ok(tiles.length >= 130 && tiles.length <= 220, `${id}: arena size ${tiles.length}`);
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  assert.ok(bx1 - bx0 + 1 >= 12 && by1 - by0 + 1 >= 10, `${id}: arena bbox ${bx1 - bx0 + 1}x${by1 - by0 + 1}`);
  for (const t of tiles) {
    assert.ok(['.', 'Z', 'X'].includes(L.at(t.x, t.y)), `${id}: '${L.at(t.x, t.y)}' inside arena at ${t.x},${t.y}`);
    for (const [dx, dy] of N4) {
      const c = L.at(t.x + dx, t.y + dy);
      assert.ok(['.', 'Z', 'X', '#', 'M', 'T'].includes(c), `${id}: '${c}' next to arena at ${t.x + dx},${t.y + dy}`);
    }
  }
  // 2-4 pillars: wall blobs inside the arena's bounding box that do not touch its edge
  const seen = new Uint8Array(COLS * ROWS);
  let pillars = 0;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    if (L.at(x, y) !== '#' || seen[key(x, y)]) continue;
    const d = bfs([{ x, y }], (nx, ny) => nx >= bx0 && nx <= bx1 && ny >= by0 && ny <= by1 && L.at(nx, ny) === '#');
    let edge = false;
    for (let k = 0; k < d.length; k++) if (d[k] >= 0) {
      seen[k] = 1;
      const px = k % COLS, py = Math.floor(k / COLS);
      if (px === bx0 || px === bx1 || py === by0 || py === by1) edge = true;
    }
    if (!edge) pillars++;
  }
  assert.ok(pillars >= 2 && pillars <= 4, `${id}: ${pillars} pillars`);
  // M joins the arena and the deepest zone (the side of door H not reachable without H)
  const mz = neighbourZones(Z, L.mega);
  const [, hA, hB] = edges.find((e) => e[0] === 'H');
  const dNoH = playerBfs(L, ['D', 'E', 'F', 'G']);
  const zoneReached = (z) => { for (let k = 0; k < Z.comp.length; k++) if (Z.comp[k] === z) return dNoH[k] >= 0; return false; };
  const deepest = zoneReached(hA) ? hB : hA;
  assert.notEqual(deepest, startZone);
  assert.deepEqual([...mz].sort(), [arenaZone, deepest].sort(), `${id}: M joins the deepest zone and the arena`);
  // arena reachable only through M
  const withDoors = playerBfs(L, DOOR_LETTERS);
  for (const t of tiles) assert.ok(!reached(withDoors, t), `${id}: arena tile ${t.x},${t.y} reachable without M`);
  const withMega = playerBfs(L, [...DOOR_LETTERS, 'M']);
  for (const t of tiles) assert.ok(reached(withMega, t), `${id}: arena tile ${t.x},${t.y} unreachable through M`);
  const dz = bfs([...L.pockets, ...L.opens], zombieWalk(L, DOOR_LETTERS));
  assert.ok(!reached(dz, L.boss[0]), `${id}: zombies reach the arena without M`);
  // stairs: on the arena boundary, backed by wall, unreachable until opened, a dead end, far from M
  const [ox, oy] = tAxis === 'h' ? [0, 1] : [1, 0];
  for (const t of L.stairs) {
    const sides = [[t.x + ox, t.y + oy], [t.x - ox, t.y - oy]];
    assert.equal(sides.filter(([x, y]) => inA(x, y)).length, 1, `${id}: stairs ${t.x},${t.y} face the arena`);
    assert.ok(sides.some(([x, y]) => L.at(x, y) === '#'), `${id}: stairs ${t.x},${t.y} backed by wall`);
    assert.ok(!reached(withMega, t), `${id}: stairs walkable while closed`);
  }
  const withStairs = playerBfs(L, [...DOOR_LETTERS, 'M', 'T']);
  let extra = 0;
  for (let k = 0; k < withStairs.length; k++) if (withStairs[k] >= 0 && withMega[k] < 0) extra++;
  assert.equal(extra, L.stairs.length, `${id}: opening the stairs only adds the stair tiles`);
  let far = Infinity;
  for (const m of L.mega) for (const t of L.stairs) far = Math.min(far, Math.abs(m.x - t.x) + Math.abs(m.y - t.y));
  assert.ok(far >= 10, `${id}: stairs only ${far} tiles from the mega door`);
  // FIX-1 (QA review L1): no interactable (wall buy, box, window/barricade, door D..H) within
  // 2 tiles (Chebyshev) of any arena tile, so none can be used through the arena wall
  // (PLAYER.interactRange 64 < 2 tiles of wall at TILE 40).
  // WO7 3.4: perk machines are interactables too.
  const inter = [...L.buys, ...L.boxes, ...L.windows, ...L.perks, ...L.doors.flatMap((dr) => dr.tiles)];
  for (const it of inter) {
    let dmin = Infinity;
    for (const t of tiles) dmin = Math.min(dmin, Math.max(Math.abs(t.x - it.x), Math.abs(t.y - it.y)));
    assert.ok(dmin > 2, `${id}: '${it.ch}' at ${it.x},${it.y} is ${dmin} tiles from the arena (interactable through the wall)`);
  }
}

// ---- WO7 3.4 perk machines -------------------------------------------------------------------

// Index of the door (in D..H order) whose opening first exposes a tile: 0 = start zone,
// 1 = behind D, ... 5 = behind H.
function openingStep(L, t) {
  for (let k = 0; k <= DOOR_LETTERS.length; k++) if (touches(playerBfs(L, DOOR_LETTERS.slice(0, k)), t)) return k;
  return -1;
}

// expected (optional): { perkId: step } per the level's 3.4 placement list.
function validatePerks(def, expected) {
  const L = parseLevel(def);
  const id = def.id;
  assert.equal(L.perks.length, 6, `${id}: 6 perk machines`);
  assert.deepEqual(L.perks.map((p) => p.perkId).sort(), Object.values(PERK_LETTERS).sort(), `${id}: one machine per perk`);
  const Z = zones(L);
  const dAll = playerBfs(L, DOOR_LETTERS);
  const dA = bfs([L.boss[0]], walkFn(L, new Set()));
  const arena = [];
  for (let k = 0; k < dA.length; k++) if (dA[k] >= 0) arena.push({ x: k % COLS, y: Math.floor(k / COLS) });
  for (const p of L.perks) {
    const tag = `${id}: ${p.perkId} (${p.ch}) at ${p.x},${p.y}`;
    // a wall tile: 4-neighbours are floor of exactly one zone plus walls; never a pocket/window/door
    const nb = N4.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy, c: L.at(p.x + dx, p.y + dy) }));
    const floor = nb.filter((n) => FLOORISH.has(n.c));
    assert.ok(floor.length >= 1, `${tag}: faces floor`);
    assert.equal(new Set(floor.map((n) => Z.comp[key(n.x, n.y)])).size, 1, `${tag}: faces one zone only`);
    for (const n of nb) assert.ok(FLOORISH.has(n.c) || n.c === '#' || n.c in PERK_LETTERS || L.buyKeys.has(n.c), `${tag}: next to '${n.c}'`);
    assert.ok(touches(dAll, p), `${tag}: reachable with all doors open`);
    for (const b of L.buys) {
      const md = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
      assert.ok(md >= 6, `${tag}: only ${md} tiles from wall buy ${b.weaponId}`);
    }
    for (const t of arena) {
      assert.ok(Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > 2, `${tag}: within 2 tiles of the arena`);
    }
  }
  const step = Object.fromEntries(L.perks.map((p) => [p.perkId, openingStep(L, p)]));
  assert.equal(step.revive, 0, `${id}: Quick Revive in the start zone`);
  assert.equal(step.mule, DOOR_LETTERS.length, `${id}: Mule Kick in the deepest zone (behind H)`);
  assert.ok(step.jugg >= 1, `${id}: Juggernog behind >= 1 door`);
  // Mule Kick's zone is the one the mega door leads out of
  const mule = L.perks.find((p) => p.perkId === 'mule');
  const [mx, my] = N4.map(([dx, dy]) => [mule.x + dx, mule.y + dy]).find(([x, y]) => FLOORISH.has(L.at(x, y)));
  const muleZone = Z.comp[key(mx, my)];
  assert.ok(neighbourZones(Z, L.mega).has(muleZone), `${id}: Mule Kick shares the zone with the mega door`);
  if (expected) assert.deepEqual(step, expected, `${id}: perk zones per 3.4`);
  return L;
}

// ---- tests ----------------------------------------------------------------------------------

test('levels registry: LEVELS = [LEVEL1, LEVEL2, LEVEL3], levelByIndex wraps', () => {
  // WO7 Phase 0: third level registered (was length 2).
  assert.equal(LEVELS.length, 3);
  assert.equal(LEVELS[0], LEVEL1); assert.equal(LEVELS[1], LEVEL2); assert.equal(LEVELS[2], LEVEL3);
  assert.equal(levelByIndex(0), LEVEL1); assert.equal(levelByIndex(1), LEVEL2); assert.equal(levelByIndex(2), LEVEL3);
  assert.equal(levelByIndex(3), LEVEL1); assert.equal(levelByIndex(7), LEVEL2);
  assert.equal(levelByIndex(-1), LEVEL3);
  assert.equal(LEVEL3.id, 'lab'); assert.equal(LEVEL3.name, 'LABORATORY');
  assert.equal(LEVEL1.id, 'bunker'); assert.equal(LEVEL1.name, 'BUNKER');
  assert.equal(LEVEL2.id, 'catacombs'); assert.equal(LEVEL2.name, 'CATACOMBS');
  assert.equal(LEVEL1.boss.name, 'THE WARDEN'); assert.equal(LEVEL2.boss.name, 'THE BONE PRIEST');
});

test('difficulty objects per WO5 1.3', () => {
  assert.deepEqual(LEVEL1.difficulty, { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 });
  assert.deepEqual(LEVEL2.difficulty, { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 });
  assert.deepEqual(LEVEL3.difficulty, { healthMult: 2.0, speedMult: 1.2, countMult: 1.5, sprintShift: 5 }); // WO7 1.5
});

test('themes: level 1 = WO4 greys, no tint/torches; level 2 = catacombs with tint + torches', () => {
  assert.equal(LEVEL1.theme.ambient, null); assert.equal(LEVEL1.theme.torch, false);
  assert.equal(LEVEL2.theme.torch, true);
  assert.match(LEVEL2.theme.ambient, /^rgba\(/);
  // WO7 1.5 / scaffold note 4: lab keeps torch false, flicker true, a checker floor
  assert.equal(LEVEL3.theme.torch, false); assert.equal(LEVEL3.theme.flicker, true);
  assert.notEqual(LEVEL3.theme.floor, LEVEL3.theme.floorAlt);
  assert.match(LEVEL3.theme.ambient, /^rgba\(/);
  assert.deepEqual(LEVEL3.boss, { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' });
  for (const def of LEVELS) for (const k of ['floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'doorWood', 'doorIron']) {
    assert.match(def.theme[k], /^#[0-9a-f]{6}$/i, `${def.id}.theme.${k}`);
  }
});

test('the suite itself: WO4 layout passes the WO4 checks, fails the arena rules', () => {
  const wo4 = { id: 'wo4', ascii: WO4_ASCII, wallbuys: WO4_WALLBUYS };
  assert.throws(() => validateWO4(wo4), /6 zones \+ arena/); // no arena: 6 components, not 7
  assert.throws(() => validateArena({ ...LEVEL2, ascii: LEVEL2.ascii.map((r) => r.replace(/M/g, '#')) }), /M and T present|6 zones/);
  const leaky = LEVEL1.ascii.map((r, y) => (y === 26 ? r.slice(0, 37) + '....' + r.slice(41) : r)); // hub east wall hole into the arena
  assert.throws(() => validateArena({ ...LEVEL1, ascii: leaky }), /zones|arena/);
  // WO5-review L1 layout (Argus at 42,29, one wall row below the arena) must fail the new rule
  const oldArgus = LEVEL1.ascii.map((r, y) => (y === 29 ? r.slice(0, 38) + '#' + r.slice(39, 42) + '9' + r.slice(43) : r));
  assert.throws(() => validateArena({ ...LEVEL1, ascii: oldArgus }), /interactable through the wall/);
  const broken = LEVEL1.ascii.map((r, y) => (y === 20 ? '.' + r.slice(1) : r));
  assert.throws(() => validateWO4({ ...LEVEL1, ascii: broken }), /border/);
});

for (const def of LEVELS) {
  test(`${def.id}: WO4 layout validity suite`, () => { validateWO4(def); });
  test(`${def.id}: WO5 arena rules`, () => { validateArena(def); });
}

test('bunker: WO4 wall buys unchanged; edit confined to the arena/vault block (+ WO7 perk tiles)', () => {
  assert.deepEqual(LEVEL1.wallbuys, WO4_WALLBUYS);
  // WO7: perk machines replace WO4 wall tiles; compare with them turned back into wall
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (LEVEL1.ascii[y][x] in PERK_LETTERS) assert.equal(WO4_ASCII[y][x], '#', `perk at ${x},${y} replaced a wall`);
  }
  const plain = LEVEL1.ascii.map((r) => r.replace(/[JQCNUK]/g, '#'));
  const changed = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (plain[y][x] !== WO4_ASCII[y][x]) changed.push([x, y]);
  }
  assert.ok(changed.length > 0);
  for (const [x, y] of changed) assert.ok(x >= 38 && x <= 58 && y >= 16 && y <= 37, `unexpected edit at ${x},${y}`);
  // same number of every door / spawn / buy letter (ICR-1 'c' and open spawn 9 moved)
  const count = (rows, ch) => rows.join('').split(ch).length - 1;
  for (const ch of ['D', 'E', 'F', 'G', 'H', 'W', 'S', 'O', 'B', 'P', ...Object.keys(WO4_WALLBUYS)]) {
    assert.equal(count(plain, ch), count(WO4_ASCII, ch), `count of '${ch}'`);
  }
  const now = parseLevel({ ...LEVEL1, ascii: plain }), old = parseLevel({ ascii: WO4_ASCII, wallbuys: WO4_WALLBUYS });
  for (const dr of now.doors) assert.deepEqual(dr.tiles, old.doors.find((o) => o.letter === dr.letter).tiles, `door ${dr.letter} unchanged`);
  assert.deepEqual(now.windows, old.windows, 'windows unchanged');
  assert.deepEqual(now.start, old.start, 'start unchanged');
  assert.deepEqual(now.boxes, old.boxes, 'box unchanged');
});

// WO7 3.4: perk steps (0 = start zone, 1..5 = behind D..H) per the named zones.
const PERK_PLAN = {
  // L1: Q hub, J corridor (D), C courtyard (E), N bunker (F), U armory (G), K vault (H)
  bunker: { revive: 0, jugg: 1, speed: 2, dtap: 3, stamin: 4, mule: 5 },
  // L2: Q chapel, C ossuary (D), J west crypts (E), N bone chamber (F), U charnel pit (G), K sanctum (H)
  catacombs: { revive: 0, speed: 1, jugg: 2, dtap: 3, stamin: 4, mule: 5 },
  // L3: Q lobby, C sterile corridor (D), J west labs (E), N containment (F), U cryo (G), K reactor (H)
  lab: { revive: 0, speed: 1, jugg: 2, dtap: 3, stamin: 4, mule: 5 },
};

for (const def of LEVELS) {
  test(`${def.id}: WO7 perk machines (6, one per perk, Q start, K deepest, reachable, clear of arena and wall buys)`, () => {
    validatePerks(def, PERK_PLAN[def.id]);
  });
}

test('the perk checks catch broken placements', () => {
  const swap = (def, fn) => ({ ...def, ascii: def.ascii.map((r, y) => fn(r, y)) });
  const put = (r, x, ch) => r.slice(0, x) + ch + r.slice(x + 1);
  // a missing machine
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace('U', '#'))), /6 perk machines/);
  // a duplicate perk instead of another one
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace('U', 'N'))), /one machine per perk/);
  // Quick Revive and Mule Kick swapped
  assert.throws(() => validatePerks(swap(LEVEL2, (r) => r.replace(/[QK]/g, (c) => (c === 'Q' ? 'K' : 'Q')))), /Quick Revive|Mule Kick/);
  // too close to a wall buy: L1 Quick Revive moved along the hub's south wall to (21,27), 5 from KRM-262 (17,26)
  assert.throws(() => validatePerks(swap(LEVEL1, (r, y) => (y === 27 ? put(put(r, 24, '#'), 21, 'Q') : r))), /wall buy/);
  // next to the arena: L1 Juggernog moved into the arena's west wall (40,19)
  assert.throws(() => validatePerks(swap(LEVEL1, (r, y) => (y === 10 ? put(r, 41, '#') : y === 19 ? put(r, 40, 'J') : r))), /reachable|arena/);
  // a machine in a 1-thick wall between two zones (L1 hub / courtyard wall at (20,18) is 4 thick; use L2 chapel octagon (19,20): crypts one side, chapel the other)
  assert.throws(() => validatePerks(swap(LEVEL2, (r, y) => (y === 11 ? put(r, 22, '#') : y === 20 ? put(r, 19, 'Q') : r))), /one zone only/);
  // named zones: L1 Stamin-Up and Double Tap swapped
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace(/[NU]/g, (c) => (c === 'N' ? 'U' : 'N'))), PERK_PLAN.bunker), /perk zones/);
});

test('lab: new layout; tier-3 guns on the walls, Gorgon + Drakon deepest, cheap gun in the lobby', () => {
  for (const other of [LEVEL1, LEVEL2]) {
    let diff = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (LEVEL3.ascii[y][x] !== other.ascii[y][x]) diff++;
    assert.ok(diff > COLS * ROWS * 0.25, `only ${diff} tiles differ from ${other.id}`);
  }
  const L = parseLevel(LEVEL3);
  const placed = new Set(L.buys.map((b) => b.weaponId));
  for (const g of [...TIER3_GUNS, 'gorgon', 'drakon']) assert.ok(placed.has(g), `${g} on a lab wall`);
  const dNoH = playerBfs(L, ['D', 'E', 'F', 'G']);
  assert.deepEqual(L.buys.filter((b) => !touches(dNoH, b)).map((b) => b.weaponId).sort(), ['drakon', 'gorgon']);
  const startBuy = L.buys.filter((b) => touches(playerBfs(L, []), b));
  assert.equal(startBuy.length, 1);
  assert.ok(!TIER3_GUNS.includes(startBuy[0].weaponId) && !['gorgon', 'drakon'].includes(startBuy[0].weaponId));
  for (const b of L.buys.filter((x) => TIER3_GUNS.includes(x.weaponId))) assert.ok(openingStep(L, b) >= 1, `${b.weaponId} behind a door`);
  // glass tanks / pods / benches: free-standing wall blocks inside rooms (not joined to the outer rock)
  const seen = new Uint8Array(COLS * ROWS);
  let blocks = 0;
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (L.at(x, y) !== '#' || seen[key(x, y)]) continue;
    const d = bfs([{ x, y }], (nx, ny) => L.at(nx, ny) === '#');
    let border = false;
    for (let k = 0; k < d.length; k++) if (d[k] >= 0) {
      seen[k] = 1;
      const px = k % COLS, py = Math.floor(k / COLS);
      if (px === 0 || py === 0 || px === COLS - 1 || py === ROWS - 1) border = true;
    }
    if (!border) blocks++;
  }
  assert.ok(blocks >= 12, `lab has ${blocks} free-standing decor blocks`);
});

test('catacombs: new layout; all new guns on the walls, best guns deepest', () => {
  let diff = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (LEVEL2.ascii[y][x] !== LEVEL1.ascii[y][x]) diff++;
  assert.ok(diff > COLS * ROWS * 0.25, `only ${diff} tiles differ from level 1`);
  const L = parseLevel(LEVEL2);
  const placed = new Set(L.buys.map((b) => b.weaponId));
  for (const g of NEW_GUNS) assert.ok(placed.has(g), `${g} on a level-2 wall`);
  // the zone behind H sells gorgon + drakon; the start room sells no new gun
  const dNoH = playerBfs(L, ['D', 'E', 'F', 'G']);
  assert.deepEqual(L.buys.filter((b) => !touches(dNoH, b)).map((b) => b.weaponId).sort(), ['drakon', 'gorgon']);
  const startBuy = L.buys.filter((b) => touches(playerBfs(L, []), b));
  assert.ok(!NEW_GUNS.includes(startBuy[0].weaponId));
});

test('levels/*.js are pure and import nothing outside src/levels/', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\/[\w-]+\.js$/, `${f} imports ${m[1]}`);
    }
    assert.ok(!/\bimport\s*\(/.test(src), `${f}: dynamic import`);
    assert.ok(!/Math\.random|\bdocument\.\w|\bwindow\.\w/.test(src), `${f}: impure`);
  }
});
