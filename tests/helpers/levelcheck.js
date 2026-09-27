// tests/helpers/levelcheck.js — the level validity suite (WO9 Phase 0, Agent 0).
// Extracted verbatim from tests/levels.test.js (WO4 layout rules, WO5 arena rules, WO7 perk
// machines, WO8 Pack-a-Punch) so level agents can validate their maps in their own test files.
// FROZEN after WO9 Phase 0: level agents import it, never edit it (WO9 FIX-1 was allowed to add
// checkInteractReach, run by validateLevel). Not picked up by
// `node --test "tests/*.test.js"` (it lives in tests/helpers/).
//
// Parses a level def's ASCII independently of map.js. Every check* / validate* function throws an
// AssertionError (node:assert) with a descriptive message on the FIRST violation it finds.
// validateLevel(def, opts) runs every check group and returns the list of violations (one entry
// per failing group; [] = valid); assertValidLevel(def, opts) throws one Error listing them all.
// WO9 additions: the pit tile '~' (PIT) is in the legend (walkable for neither player nor
// zombies; may cap a door/mega/stairs run and may border arena floor); checkMeta, checkTheme,
// checkWO9Guns, tileDiff, freeStandingBlocks, validateLevel, assertValidLevel.
// See docs/notes/wo9-scaffold.md.
import assert from 'node:assert/strict';
import { PLAYER, TILE } from '../../src/config.js';

export const COLS = 60, ROWS = 40;
export const DOOR_LETTERS = ['D', 'E', 'F', 'G', 'H'];
// WO7 1.2: perk machine letters -> perk ids (config PERKS.list letters).
export const PERK_LETTERS = { J: 'jugg', Q: 'revive', C: 'speed', N: 'dtap', U: 'stamin', K: 'mule' };
export const PAP_LETTER = 'A'; // WO8 1.1: Pack-a-Punch machine (map.js TILE_PAP)
// WO9 3.2: '~' = pit (ice hole / water channel, map.js TILE_PIT): blocks movers, not bullets/sight.
export const PIT = '~';
export const LEGEND = new Set(['#', '.', 'P', 'W', 'S', 'O', 'B', 'M', 'Z', 'X', 'T', PAP_LETTER, PIT, ...DOOR_LETTERS, ...Object.keys(PERK_LETTERS)]);
export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Every weapon id a level may put on a wall (WO4 guns + WO5 3.4 new guns).
export const KNOWN_WEAPONS = new Set(['sheiva', 'rk5', 'krm262', 'kuda', 'vmp', 'vesper', 'kn44', 'hvk30',
  'argus', 'lcar9', 'pharo', 'icr1', 'bootlegger', 'manowar', 'xr2', 'weevil', 'marshal16', 'gorgon',
  'dredge48', 'haymaker12', 'drakon', 'hg40', 'm8a7', 'peacekeeper']);
export const TIER3_GUNS = ['hg40', 'm8a7', 'peacekeeper']; // WO7 1.5
export const NEW_GUNS = ['manowar', 'xr2', 'weevil', 'marshal16', 'gorgon', 'dredge48', 'haymaker12', 'drakon'];

// WO4 level-1 layout (map.js MAP_ASCII before WO5), to prove the edit stays local.
export const WO4_ASCII = [
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
export const WO4_WALLBUYS = { '1': 'sheiva', '2': 'rk5', '3': 'krm262', '4': 'kuda', '5': 'vmp', '6': 'vesper',
  '7': 'kn44', '8': 'hvk30', '9': 'argus', 'a': 'lcar9', 'b': 'pharo', 'c': 'icr1', 'd': 'bootlegger' };

// ---- independent parser ---------------------------------------------------------------------

export function parseLevel(def) {
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
    paps: find((c) => c === PAP_LETTER), // WO8
  };
}

export const key = (x, y) => y * COLS + x;
export const FLOORISH = new Set(['.', 'P', 'O', 'Z', 'X']);

// Player-walkable given a set of open door letters ('M' and 'T' count as letters too).
export function walkFn(L, open) {
  return (x, y) => {
    const c = L.at(x, y);
    return FLOORISH.has(c) || open.has(c);
  };
}

export function bfs(starts, passable) {
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

export const touches = (d, t) => N4.some(([dx, dy]) => {
  const nx = t.x + dx, ny = t.y + dy;
  return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && d[key(nx, ny)] >= 0;
});
export const reached = (d, t) => d[key(t.x, t.y)] >= 0;
export const playerBfs = (L, open) => bfs([L.start], walkFn(L, new Set(open)));
export const zombieWalk = (L, open) => {
  const w = walkFn(L, new Set(open));
  return (x, y) => w(x, y) || L.at(x, y) === 'W' || L.at(x, y) === 'S';
};

// Active spawns as map.js recomputeActiveSpawns does: BFS from P over floor + windows + pockets
// + open spawns (+ open doors); a window counts if its tile is reached, an O if reached.
export function activeSpawns(L, open) {
  const d = bfs([L.start], zombieWalk(L, open));
  const ids = new Set();
  L.windows.forEach((t, i) => { if (reached(d, t)) ids.add(`W${i}`); });
  L.opens.forEach((t, i) => { if (reached(d, t)) ids.add(`O${i}`); });
  return ids;
}

// A straight run of 2-3 tiles in a wall, optionally with walkable tiles on both sides across it.
export function checkRun(L, tiles, name, { bothSides = true } = {}) {
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
  // WO9: a pit '~' (impassable to movers) may cap a run too, e.g. a gate between ice holes.
  const lo = along[0] - 1, hi = along[along.length - 1] + 1, c = axis === 'h' ? tiles[0].y : tiles[0].x;
  const cap = (v) => (axis === 'h' ? L.at(v, c) : L.at(c, v));
  for (const v of [lo, hi]) assert.ok(cap(v) === '#' || cap(v) === PIT, `${name}: capped (got '${cap(v)}')`);
  return axis;
}

// Connected components of walkable tiles with every door / M / T closed.
export function zones(L) {
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
export function neighbourZones(Z, tiles) {
  const s = new Set();
  for (const t of tiles) for (const [dx, dy] of N4) {
    const nx = t.x + dx, ny = t.y + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && Z.comp[key(nx, ny)] >= 0) s.add(Z.comp[key(nx, ny)]);
  }
  return s;
}

// ---- WO4 validity suite ---------------------------------------------------------------------

export function validateWO4(def) {
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

export function validateArena(def) {
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
      // WO9: pits '~' may border arena floor (water / ice holes inside the arena).
      assert.ok(['.', 'Z', 'X', '#', 'M', 'T', PIT].includes(c), `${id}: '${c}' next to arena at ${t.x + dx},${t.y + dy}`);
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
  // WO7 3.4: perk machines are interactables too. WO8: so is the Pack-a-Punch machine.
  const inter = [...L.buys, ...L.boxes, ...L.windows, ...L.perks, ...L.paps, ...L.doors.flatMap((dr) => dr.tiles)];
  for (const it of inter) {
    let dmin = Infinity;
    for (const t of tiles) dmin = Math.min(dmin, Math.max(Math.abs(t.x - it.x), Math.abs(t.y - it.y)));
    assert.ok(dmin > 2, `${id}: '${it.ch}' at ${it.x},${it.y} is ${dmin} tiles from the arena (interactable through the wall)`);
  }
}

// ---- WO7 3.4 perk machines -------------------------------------------------------------------

// Index of the door (in D..H order) whose opening first exposes a tile: 0 = start zone,
// 1 = behind D, ... 5 = behind H.
export function openingStep(L, t) {
  for (let k = 0; k <= DOOR_LETTERS.length; k++) if (touches(playerBfs(L, DOOR_LETTERS.slice(0, k)), t)) return k;
  return -1;
}

// expected (optional): { perkId: step } per the level's 3.4 placement list.
export function validatePerks(def, expected) {
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

// ---- WO8 1.1 Pack-a-Punch machine ---------------------------------------------------------

// Exactly one 'A' per level: a wall tile facing floor of the deepest zone only (behind H, the zone
// that also holds the mega door), reachable with all doors open, not reachable before H, > 2 tiles
// (Chebyshev, as the FIX-1 interactable rule) from every arena tile, >= 6 (Manhattan) from every
// wall buy and perk machine.
export function validatePap(def) {
  const L = parseLevel(def);
  const id = def.id;
  assert.ok(!L.buyKeys.has(PAP_LETTER), `${id}: 'A' used as a wall-buy key`);
  assert.equal(L.paps.length, 1, `${id}: exactly one Pack-a-Punch machine`);
  const p = L.paps[0];
  const tag = `${id}: Pack-a-Punch at ${p.x},${p.y}`;
  const Z = zones(L);
  const nb = N4.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy, c: L.at(p.x + dx, p.y + dy) }));
  const floor = nb.filter((n) => FLOORISH.has(n.c));
  assert.ok(floor.length >= 1, `${tag}: faces floor`);
  for (const n of nb) assert.ok(FLOORISH.has(n.c) || n.c === '#', `${tag}: next to '${n.c}'`);
  const fz = new Set(floor.map((n) => Z.comp[key(n.x, n.y)]));
  assert.equal(fz.size, 1, `${tag}: faces one zone only`);
  const [zone] = fz;
  // the deepest zone: the one M joins to (besides the arena) and that needs H
  const arenaZone = Z.comp[key(L.boss[0].x, L.boss[0].y)];
  assert.notEqual(zone, arenaZone, `${tag}: inside the arena`);
  assert.ok(neighbourZones(Z, L.mega).has(zone), `${tag}: not in the mega door's zone (deepest)`);
  assert.ok(touches(playerBfs(L, DOOR_LETTERS), p), `${tag}: reachable with all doors open`);
  assert.equal(openingStep(L, p), DOOR_LETTERS.length, `${tag}: not behind door H (deepest zone)`);
  const dA = bfs([L.boss[0]], walkFn(L, new Set()));
  for (let k = 0; k < dA.length; k++) if (dA[k] >= 0) {
    const ax = k % COLS, ay = Math.floor(k / COLS);
    assert.ok(Math.max(Math.abs(ax - p.x), Math.abs(ay - p.y)) > 2, `${tag}: within 2 tiles of the arena`);
  }
  for (const b of L.buys) {
    const md = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
    assert.ok(md >= 6, `${tag}: only ${md} tiles from wall buy ${b.weaponId}`);
  }
  for (const q of L.perks) {
    const md = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    assert.ok(md >= 6, `${tag}: only ${md} tiles from perk machine ${q.perkId}`);
  }
  return p;
}

// ---- WO9 additions --------------------------------------------------------------------------

export const BOSS_ABILITIES = ['charge', 'acid', 'frost', 'tide']; // WO9 3.3
export const THEME_HEX_KEYS = ['floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'doorWood', 'doorIron'];

// id / name / boss / difficulty / wallbuys shape.
export function checkMeta(def) {
  const id = def && def.id;
  assert.ok(typeof id === 'string' && /^[a-z0-9_-]+$/.test(id), `bad id '${id}'`);
  assert.ok(typeof def.name === 'string' && def.name.length > 0 && def.name === def.name.toUpperCase(), `${id}: name upper case`);
  const b = def.boss;
  assert.ok(b && typeof b.name === 'string' && b.name.length > 0, `${id}: boss.name`);
  assert.match(String(b.tint), /^#[0-9a-f]{6}$/i, `${id}: boss.tint`);
  assert.ok(BOSS_ABILITIES.includes(b.ability), `${id}: boss.ability '${b.ability}'`);
  const d = def.difficulty;
  assert.ok(d, `${id}: difficulty`);
  for (const k of ['healthMult', 'speedMult', 'countMult']) assert.ok(Number.isFinite(d[k]) && d[k] > 0, `${id}: difficulty.${k}`);
  assert.ok(Number.isInteger(d.sprintShift) && d.sprintShift >= 0, `${id}: difficulty.sprintShift`);
  assert.ok(def.wallbuys && typeof def.wallbuys === 'object', `${id}: wallbuys`);
}

// Theme: the render-required hex colours, ambient (null or an rgba() string), torch / flicker
// booleans. Extra keys (style, overlay hints, ...) are allowed.
export function checkTheme(def) {
  const id = def.id, t = def.theme;
  assert.ok(t && typeof t === 'object', `${id}: theme`);
  for (const k of THEME_HEX_KEYS) assert.match(String(t[k]), /^#[0-9a-f]{6}$/i, `${id}.theme.${k}`);
  assert.ok(t.ambient === null || /^rgba\(/.test(String(t.ambient)), `${id}.theme.ambient`);
  assert.equal(typeof t.torch, 'boolean', `${id}.theme.torch`);
  if ('flicker' in t) assert.equal(typeof t.flicker, 'boolean', `${id}.theme.flicker`);
}

// WO9 1.1 wall guns for levels 4-6: all three tier-3 guns on the walls, each behind >= 1 door; the
// start room's single gun is a cheaper one (not tier 3, not gorgon / drakon).
export function checkWO9Guns(def) {
  const L = parseLevel(def);
  const id = def.id;
  const placed = new Set(L.buys.map((b) => b.weaponId));
  for (const g of TIER3_GUNS) assert.ok(placed.has(g), `${id}: ${g} on a wall`);
  const start = L.buys.filter((b) => touches(playerBfs(L, []), b));
  assert.equal(start.length, 1, `${id}: one wall buy in the start room`);
  assert.ok(![...TIER3_GUNS, 'gorgon', 'drakon'].includes(start[0].weaponId), `${id}: start room sells ${start[0].weaponId} (want a cheaper gun)`);
  for (const b of L.buys.filter((x) => TIER3_GUNS.includes(x.weaponId))) assert.ok(openingStep(L, b) >= 1, `${id}: ${b.weaponId} behind a door`);
}

// Number of tiles whose char differs between two level defs (or two ascii arrays).
export function tileDiff(a, b) {
  const ga = Array.isArray(a) ? a : a.ascii, gb = Array.isArray(b) ? b : b.ascii;
  let n = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (ga[y][x] !== gb[y][x]) n++;
  return n;
}

// Free-standing wall blobs (decor blocks: tanks, pods, seat rows, huts, ...) not joined to the
// outer border rock. Only '#' counts (pits are not walls).
export function freeStandingBlocks(def) {
  const L = parseLevel(def);
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
  return blocks;
}

// WO9 FIX-1 (QA wo9-kino #1, the KINO Jugg-through-the-wall bug): every wall buy, perk machine and
// Pack-a-Punch must be out of interact range of every zone except its own. map.nearestInteractable
// measures from the player centre to the machine's tile rect (PLAYER.interactRange, 64 px), with no
// wall or zone check. The player centre can stand anywhere in a walkable tile except within
// PLAYER.radius of a side whose 4-neighbour blocks movement (wall, closed door, pit, window...),
// so each floor tile of another zone gives a centre rect: the tile inset by the radius on its
// blocked sides only (conservative, so diagonal / corner reaches count). The interactable's own
// zone is the zone(s) of its 4-neighbour floor, which must be exactly one; the arena is a zone too.
// Rect-to-rect distance <= range = violation. The mystery box is checked too; doors (they join
// zones by design) and windows (repairable from anywhere by design) are not.
export function checkInteractReach(def, { range = PLAYER.interactRange, radius = PLAYER.radius, box = true } = {}) {
  const L = parseLevel(def);
  const id = def.id;
  const Z = zones(L);
  const walk = (x, y) => FLOORISH.has(L.at(x, y));
  const items = [
    ...L.buys.map((b) => ({ ...b, what: `wall buy ${b.weaponId}` })),
    ...L.perks.map((p) => ({ ...p, what: `perk ${p.perkId}` })),
    ...L.paps.map((p) => ({ ...p, what: 'Pack-a-Punch' })),
    ...(box ? L.boxes.map((b) => ({ ...b, what: 'box' })) : []),
  ];
  const reachTiles = Math.ceil((range + radius) / TILE) + 1;
  for (const it of items) {
    const tag = `${id}: ${it.what} ('${it.ch}') at ${it.x},${it.y}`;
    const own = new Set();
    for (const [dx, dy] of N4) if (walk(it.x + dx, it.y + dy)) own.add(Z.comp[key(it.x + dx, it.y + dy)]);
    assert.equal(own.size, 1, `${tag}: faces ${own.size} zones (want exactly one)`);
    const rx0 = it.x * TILE, ry0 = it.y * TILE, rx1 = rx0 + TILE, ry1 = ry0 + TILE;
    for (let y = it.y - reachTiles; y <= it.y + reachTiles; y++) for (let x = it.x - reachTiles; x <= it.x + reachTiles; x++) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS || !walk(x, y)) continue;
      const z = Z.comp[key(x, y)];
      if (own.has(z)) continue;
      // centre rect of the player standing on (x, y)
      const cx0 = x * TILE + (walk(x - 1, y) ? 0 : radius), cx1 = (x + 1) * TILE - (walk(x + 1, y) ? 0 : radius);
      const cy0 = y * TILE + (walk(x, y - 1) ? 0 : radius), cy1 = (y + 1) * TILE - (walk(x, y + 1) ? 0 : radius);
      const gx = Math.max(0, rx0 - cx1, cx0 - rx1), gy = Math.max(0, ry0 - cy1, cy0 - ry1);
      const d = Math.hypot(gx, gy);
      assert.ok(d > range, `${tag}: in interact range (${d.toFixed(1)} px <= ${range}) from floor ${x},${y} of another zone`);
    }
  }
}

// Runs every check group and returns an array of violation strings (empty array = valid). Each
// group stops at its first violation, so fix and re-run.
// opts: { perkPlan?: { perkId: step (0 start .. 5 behind H) }, papPos?: [x, y], wo9Guns?: boolean }
export function validateLevel(def, opts = {}) {
  const out = [];
  const run = (name, fn) => {
    try { fn(); } catch (e) { out.push(`${name}: ${e && e.message ? String(e.message).split('\n')[0] : String(e)}`); }
  };
  run('meta', () => checkMeta(def));
  run('theme', () => checkTheme(def));
  run('layout (WO4)', () => validateWO4(def));
  run('arena (WO5)', () => validateArena(def));
  run('perks (WO7)', () => validatePerks(def, opts.perkPlan));
  run('pack-a-punch (WO8)', () => {
    const p = validatePap(def);
    if (opts.papPos) assert.deepEqual([p.x, p.y], opts.papPos, `${def.id}: Pack-a-Punch at ${p.x},${p.y}, want ${opts.papPos}`);
  });
  if (opts.wo9Guns) run('guns (WO9)', () => checkWO9Guns(def));
  run('interact reach (WO9 FIX-1)', () => checkInteractReach(def));
  return out;
}

// Throws one Error listing every violation; returns the parsed level (parseLevel) when valid.
export function assertValidLevel(def, opts = {}) {
  const v = validateLevel(def, opts);
  if (v.length) throw new Error(`${def && def.id}: ${v.length} level violation(s):\n  - ${v.join('\n  - ')}`);
  return parseLevel(def);
}
