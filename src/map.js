// map.js (Agent H) — tile map, collision, raycasts, barricades, interactables.
// Pure logic: no DOM access. Imports only config, events, math.
import { TILE, MAP } from './config.js';
import { emit } from './events.js';
import { clamp, dist } from './math.js';

// Tile codes (read directly by pathfinding.js and render.js; keep stable).
export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_WINDOW = 2;
export const TILE_SPAWN_POCKET = 3;
export const TILE_BOX = 4;
export const TILE_WALLBUY = 5;
export const TILE_OPEN_SPAWN = 6;
export const TILE_DOOR = 7; // closed buyable door; opening sets its tiles to TILE_FLOOR

// Boards per barricade.
const MAX_BOARDS = MAP.maxBoards; // config.js (moved by integrator)

export const WALLBUY_MAP = {
  1: 'sheiva', 2: 'rk5', 3: 'krm262', 4: 'kuda', 5: 'vmp', 6: 'vesper', 7: 'kn44', 8: 'hvk30',
  9: 'argus', a: 'lcar9', b: 'pharo', c: 'icr1', d: 'bootlegger',
};

// Buyable doors: ASCII letter -> cost (BO3 prices / 10). Door ids follow this key order.
export const DOOR_MAP = { D: 75, E: 100, F: 100, G: 125, H: 150 };

// 60 x 40 (WO4 layout, see docs/notes/map.md). Zones, in the order a player opens them:
//   Hub (start, rows 15-26, cols 21-36): Sheiva on the north wall, 2 windows, doors D (north)
//     and E (west).
//   D -> Corridor: stub north of the hub, north hall (rows 3-6) and east hall (cols 42-56);
//     RK5 + L-CAR 9, 1 window + 1 open spawn; the east hall loops around a central block.
//   E -> Courtyard (west, rows 17-36): KRM-262 + Kuda, 2 windows, 4 planters.
//   F (from the corridor's west end) -> Bunker (north-west): VMP + HVK-30, 1 window.
//   G (from the courtyard) -> Armory (south): KN-44 + Argus + mystery box, 1 window + 1 open spawn.
//   H (from the armory, deepest) -> Vault (south-east): ICR-1, 1 window.
export const MAP_ASCII = [
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

const CHAR_CODE = {
  '#': TILE_WALL, '.': TILE_FLOOR, 'P': TILE_FLOOR, 'W': TILE_WINDOW, 'S': TILE_SPAWN_POCKET,
  'O': TILE_OPEN_SPAWN, 'B': TILE_BOX,
};

function charToCode(ch) {
  if (ch in CHAR_CODE) return CHAR_CODE[ch];
  if (ch in WALLBUY_MAP) return TILE_WALLBUY;
  if (ch in DOOR_MAP) return TILE_DOOR;
  throw new Error(`map: unknown tile char '${ch}'`);
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Greedy merge of wall tiles into rectangles (horizontal runs, then extended downward).
function mergeWalls(tiles, cols, rows) {
  const used = new Uint8Array(cols * rows);
  const rects = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx;
      if (tiles[i] !== TILE_WALL || used[i]) continue;
      let w = 1;
      while (tx + w < cols && tiles[i + w] === TILE_WALL && !used[i + w]) w++;
      let h = 1;
      outer: while (ty + h < rows) {
        for (let k = 0; k < w; k++) {
          const j = (ty + h) * cols + tx + k;
          if (tiles[j] !== TILE_WALL || used[j]) break outer;
        }
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let k = 0; k < w; k++) used[(ty + yy) * cols + tx + k] = 1;
      rects.push({ x: tx * TILE, y: ty * TILE, w: w * TILE, h: h * TILE });
    }
  }
  return rects;
}

export function loadMap(ascii = MAP_ASCII) {
  const rows = ascii.length;
  const cols = rows ? ascii[0].length : 0;
  if (!rows || !cols) throw new Error('map: empty ASCII');
  for (const line of ascii) if (line.length !== cols) throw new Error('map: ragged ASCII rows');

  const tiles = new Uint8Array(cols * rows);
  const barricadeIndex = new Int16Array(cols * rows).fill(-1);
  const map = {
    cols, rows, width: cols * TILE, height: rows * TILE, tiles,
    walls: [], barricades: [], spawnPoints: [], wallBuys: [], box: null,
    playerStart: { x: 0, y: 0 },
    doors: [], version: 0, activeSpawnIds: new Set(),
    barricadeIndex, // extra (not in contract): tile index -> index into barricades, or -1
  };

  const windows = [];
  const opens = [];
  const doorTiles = {};
  let foundStart = false;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = ascii[ty][tx];
      const code = charToCode(ch);
      tiles[ty * cols + tx] = code;
      const rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      if (ch === 'P') {
        map.playerStart = tileToWorld(tx, ty);
        foundStart = true;
      } else if (ch === 'W') windows.push({ tx, ty });
      else if (ch === 'O') opens.push({ tx, ty });
      else if (code === TILE_DOOR) (doorTiles[ch] ||= []).push({ tx, ty });
      else if (ch === 'B') map.box = { ...rect, tx, ty };
      else if (code === TILE_WALLBUY) {
        map.wallBuys.push({ id: map.wallBuys.length + 1, weaponId: WALLBUY_MAP[ch], tx, ty, ...rect });
      }
    }
  }
  if (!foundStart) map.playerStart = { x: map.width / 2, y: map.height / 2 };

  // Barricades (row-major order), each paired with its adjacent spawn pocket.
  for (const { tx, ty } of windows) {
    const id = map.barricades.length + 1;
    const spawnPointId = map.spawnPoints.length + 1;
    let pocket = null;
    for (const [dx, dy] of DIRS4) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (tiles[ny * cols + nx] === TILE_SPAWN_POCKET) { pocket = { tx: nx, ty: ny }; break; }
    }
    if (!pocket) throw new Error(`map: window at ${tx},${ty} has no adjacent spawn pocket`);
    const c = tileToWorld(pocket.tx, pocket.ty);
    map.spawnPoints.push({ id: spawnPointId, x: c.x, y: c.y, barricadeId: id, kind: 'window' });
    map.barricades.push({
      id, tx, ty, x: tx * TILE, y: ty * TILE, w: TILE, h: TILE,
      boards: MAX_BOARDS, maxBoards: MAX_BOARDS, spawnPointId,
    });
    barricadeIndex[ty * cols + tx] = id - 1;
  }
  for (const { tx, ty } of opens) {
    const c = tileToWorld(tx, ty);
    map.spawnPoints.push({ id: map.spawnPoints.length + 1, x: c.x, y: c.y, barricadeId: null, kind: 'open' });
  }

  // Doors, ids in DOOR_MAP key order. Each letter must be one 4-connected group.
  for (const letter of Object.keys(DOOR_MAP)) {
    const dt = doorTiles[letter];
    if (!dt) continue;
    const key = (t) => t.ty * cols + t.tx;
    const set = new Set(dt.map(key));
    const seen = new Set([key(dt[0])]);
    const q = [dt[0]];
    for (let i = 0; i < q.length; i++) {
      for (const [dx, dy] of DIRS4) {
        const k = (q[i].ty + dy) * cols + q[i].tx + dx;
        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push({ tx: q[i].tx + dx, ty: q[i].ty + dy }); }
      }
    }
    if (seen.size !== dt.length) throw new Error(`map: door '${letter}' tiles are not one connected group`);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { tx, ty } of dt) {
      x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
    }
    const x = x0 * TILE, y = y0 * TILE, w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
    map.doors.push({
      id: map.doors.length + 1, letter, cost: DOOR_MAP[letter], open: false,
      tiles: dt.map(({ tx, ty }) => ({ tx, ty })), x, y, w, h, cx: x + w / 2, cy: y + h / 2,
      axis: w >= h ? 'h' : 'v', // 'h': tiles run along x (horizontal wall); 'v': along y
    });
  }

  map.walls = mergeWalls(tiles, cols, rows);
  recomputeActiveSpawns(map);
  return map;
}

// Opens a closed door: its tiles become floor, version bumps, active spawns are recomputed.
export function openDoor(map, doorId) {
  const door = map.doors && map.doors.find((d) => d.id === doorId);
  if (!door || door.open) return false;
  for (const { tx, ty } of door.tiles) map.tiles[ty * map.cols + tx] = TILE_FLOOR;
  door.open = true;
  map.version = (map.version || 0) + 1;
  recomputeActiveSpawns(map);
  return true;
}

// BFS from the player start over zombie-walkable tiles, windows passable regardless of boards,
// closed doors (and every other solid) blocking. activeSpawnIds = spawn points whose tile was hit.
export function recomputeActiveSpawns(map) {
  const { cols, rows, tiles } = map;
  const seen = new Uint8Array(cols * rows);
  const s = worldToTile(map.playerStart.x, map.playerStart.y);
  const passable = (c) => c === TILE_FLOOR || c === TILE_OPEN_SPAWN || c === TILE_SPAWN_POCKET || c === TILE_WINDOW;
  const q = [];
  if (s.tx >= 0 && s.ty >= 0 && s.tx < cols && s.ty < rows) { seen[s.ty * cols + s.tx] = 1; q.push(s.ty * cols + s.tx); }
  for (let i = 0; i < q.length; i++) {
    const k = q[i], x = k % cols, y = (k - x) / cols;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nk = ny * cols + nx;
      if (seen[nk] || !passable(tiles[nk])) continue;
      seen[nk] = 1; q.push(nk);
    }
  }
  const active = new Set();
  for (const sp of map.spawnPoints) {
    const t = worldToTile(sp.x, sp.y);
    if (t.tx >= 0 && t.ty >= 0 && t.tx < cols && t.ty < rows && seen[t.ty * cols + t.tx]) active.add(sp.id);
  }
  map.activeSpawnIds = active;
  return active;
}

// True when the map tracks no active set (fake test maps) or the spawn point is active.
export function isSpawnActive(map, spawnPointId) {
  if (!map || !map.activeSpawnIds) return true;
  return map.activeSpawnIds.has(spawnPointId);
}

export function worldToTile(x, y) {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

export function tileToWorld(tx, ty) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

function getBarricade(map, barricadeId) {
  const b = map.barricades[barricadeId - 1];
  if (b && b.id === barricadeId) return b;
  return map.barricades.find((bb) => bb.id === barricadeId) || null;
}

function barricadeAtTile(map, tx, ty) {
  const idx = map.barricadeIndex ? map.barricadeIndex[ty * map.cols + tx] : -1;
  if (idx >= 0) return map.barricades[idx];
  return map.barricades.find((b) => b.tx === tx && b.ty === ty) || null;
}

export function isWalkable(map, tx, ty, forZombie = false) {
  if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return false;
  const code = map.tiles[ty * map.cols + tx];
  switch (code) {
    case TILE_FLOOR:
    case TILE_OPEN_SPAWN:
      return true;
    case TILE_SPAWN_POCKET:
      return !!forZombie;
    case TILE_WINDOW: {
      if (!forZombie) return false;
      const b = barricadeAtTile(map, tx, ty);
      return !b || b.boards <= 0;
    }
    default:
      return false;
  }
}

// Pushes a circle out of every blocking tile in its neighborhood; tangential motion is kept,
// so the circle slides along walls. Out-of-bounds counts as wall.
//
// Robustness guarantees (Phase 4, QA review #2/#3): the returned centre is always inside the
// map, in a tile walkable for this mover, and (for r <= TILE/2) the circle does not overlap any
// blocking tile. A push that would move the centre into another blocking tile is replaced by the
// smallest axis-aligned exit into a walkable neighbour; a centre inside a blocking tile leaves
// through the nearest edge whose neighbour is walkable (ties prefer a spawn pocket, so a zombie
// standing exactly on a rebuilt window's midline goes back outside). If nothing local works, the
// circle is moved to the nearest safe spot of the nearest walkable tile. The normal path (centre
// in a walkable tile, radial pushes landing in walkable tiles) is unchanged.
const RESOLVE_EPS = 1e-6;

function centreWalkable(map, px, py, forZombie) {
  return isWalkable(map, Math.floor(px / TILE), Math.floor(py / TILE), forZombie);
}

// Smallest axis-aligned exit from blocking tile (rx, ry) whose landing tile is walkable.
// Returns false if none; otherwise writes out.x / out.y.
function axisExit(map, px, py, r, rx, ry, forZombie, out) {
  let best = Infinity, bestPocket = false, bx = px, by = py;
  for (let k = 0; k < 4; k++) {
    const ox = k === 0 ? rx - r : k === 1 ? rx + TILE + r : px;
    const oy = k === 2 ? ry - r : k === 3 ? ry + TILE + r : py;
    const tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
    if (!isWalkable(map, tx, ty, forZombie)) continue;
    const d = Math.abs(ox - px) + Math.abs(oy - py);
    const pocket = map.tiles[ty * map.cols + tx] === TILE_SPAWN_POCKET;
    if (d < best - 1e-9 || (d <= best + 1e-9 && pocket && !bestPocket)) {
      best = d; bestPocket = pocket; bx = ox; by = oy;
    }
  }
  if (best === Infinity) return false;
  out.x = bx; out.y = by;
  return true;
}

// True if the centre tile is walkable and no blocking tile is overlapped (beyond RESOLVE_EPS).
function circleClear(map, px, py, r, forZombie) {
  if (!centreWalkable(map, px, py, forZombie)) return false;
  const reach = Math.max(1, Math.ceil(r / TILE));
  const ctx = Math.floor(px / TILE), cty = Math.floor(py / TILE);
  const rr = (r - RESOLVE_EPS) * (r - RESOLVE_EPS);
  for (let ty = cty - reach; ty <= cty + reach; ty++) {
    for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
      if (isWalkable(map, tx, ty, forZombie)) continue;
      const rx = tx * TILE, ry = ty * TILE;
      const dx = px - clamp(px, rx, rx + TILE), dy = py - clamp(py, ry, ry + TILE);
      if (dx * dx + dy * dy < rr) return false;
    }
  }
  return true;
}

// Last resort: nearest point of the nearest walkable tile's interior (inset by r, so the circle
// fits entirely inside that tile; the tile centre when r >= TILE/2). Rare path, ring search.
function nearestSafeSpot(map, px, py, r, forZombie) {
  const inset = Math.min(r, TILE / 2);
  const ctx = clamp(Math.floor(px / TILE), 0, map.cols - 1);
  const cty = clamp(Math.floor(py / TILE), 0, map.rows - 1);
  const maxK = Math.max(map.cols, map.rows);
  let bx = px, by = py, bestD = Infinity;
  for (let k = 0; k <= maxK; k++) {
    for (let ty = cty - k; ty <= cty + k; ty++) {
      const edgeRow = ty === cty - k || ty === cty + k;
      for (let tx = ctx - k; tx <= ctx + k; tx += edgeRow ? 1 : 2 * k) {
        if (!isWalkable(map, tx, ty, forZombie)) continue;
        const sx = clamp(px, tx * TILE + inset, tx * TILE + TILE - inset);
        const sy = clamp(py, ty * TILE + inset, ty * TILE + TILE - inset);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) { bestD = d; bx = sx; by = sy; }
        if (k === 0) break;
      }
    }
    if (bestD < Infinity && k * TILE >= bestD) break;
  }
  return { x: bx, y: by };
}

export function resolveCircle(map, x, y, r, forZombie = false) {
  let px = x, py = y;
  const reach = Math.max(1, Math.ceil(r / TILE));
  const exit = { x: 0, y: 0 };
  let converged = false, unresolved = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    unresolved = false;
    const ctx = Math.floor(px / TILE), cty = Math.floor(py / TILE);
    for (let ty = cty - reach; ty <= cty + reach; ty++) {
      for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
        if (isWalkable(map, tx, ty, forZombie)) continue;
        const rx = tx * TILE, ry = ty * TILE;
        const nx = clamp(px, rx, rx + TILE), ny = clamp(py, ry, ry + TILE);
        const dx = px - nx, dy = py - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d;
          const qx = px + (dx / d) * push, qy = py + (dy / d) * push;
          if (centreWalkable(map, qx, qy, forZombie)) { px = qx; py = qy; }
          else if (axisExit(map, px, py, r, rx, ry, forZombie, exit)) { px = exit.x; py = exit.y; }
          else { unresolved = true; continue; }
        } else if (axisExit(map, px, py, r, rx, ry, forZombie, exit)) {
          // Centre inside the tile: leave through the nearest edge with a walkable neighbour.
          px = exit.x; py = exit.y;
        } else { unresolved = true; continue; }
        moved = true;
      }
    }
    if (!moved) { converged = true; break; }
  }
  if (converged && !unresolved && centreWalkable(map, px, py, forZombie)) return { x: px, y: py };
  if (circleClear(map, px, py, r, forZombie)) return { x: px, y: py };
  return nearestSafeSpot(map, px, py, r, forZombie);
}

function blocksRay(code) {
  return code === TILE_WALL || code === TILE_WINDOW || code === TILE_BOX || code === TILE_WALLBUY ||
    code === TILE_DOOR;
}

// DDA grid march. dx,dy should be a unit vector (normalized defensively).
// Returns the distance to the first ray-blocking tile, 0 if the origin is inside one,
// or Infinity if nothing is hit within maxDist / the map bounds.
export function raycastWalls(map, ox, oy, dx, dy, maxDist = Infinity) {
  const l = Math.hypot(dx, dy);
  if (!(l > 1e-12)) return Infinity;
  dx /= l; dy /= l;
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const inBounds = (a, b) => a >= 0 && b >= 0 && a < map.cols && b < map.rows;
  if (inBounds(tx, ty) && blocksRay(map.tiles[ty * map.cols + tx])) return 0;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX ? TILE / Math.abs(dx) : Infinity;
  const tDeltaY = stepY ? TILE / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? ((tx + 1) * TILE - ox) / dx : stepX < 0 ? (tx * TILE - ox) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((ty + 1) * TILE - oy) / dy : stepY < 0 ? (ty * TILE - oy) / dy : Infinity;

  const limit = Math.min(maxDist, (map.cols + map.rows) * TILE * 2);
  for (;;) {
    let t;
    if (tMaxX < tMaxY) { t = tMaxX; tx += stepX; tMaxX += tDeltaX; }
    else { t = tMaxY; ty += stepY; tMaxY += tDeltaY; }
    if (t > limit) return Infinity;
    if (!inBounds(tx, ty)) return Infinity;
    if (blocksRay(map.tiles[ty * map.cols + tx])) return Math.max(0, t);
  }
}

export function tearBoard(map, barricadeId) {
  const b = getBarricade(map, barricadeId);
  if (!b || b.boards <= 0) return false;
  b.boards--;
  emit('barricade:board', { barricadeId: b.id, boards: b.boards, by: 'zombie' });
  return true;
}

export function repairBoard(map, barricadeId) {
  const b = getBarricade(map, barricadeId);
  if (!b || b.boards >= b.maxBoards) return false;
  b.boards++;
  emit('barricade:board', { barricadeId: b.id, boards: b.boards, by: 'player' });
  return true;
}

export function repairAll(map) {
  for (const b of map.barricades) {
    if (b.boards >= b.maxBoards) continue;
    b.boards = b.maxBoards;
    emit('barricade:board', { barricadeId: b.id, boards: b.boards, by: 'carpenter' });
  }
}

export function barricadeOpen(map, barricadeId) {
  const b = getBarricade(map, barricadeId);
  return !!b && b.boards === 0;
}

function distToRect(x, y, r) {
  return dist(x, y, clamp(x, r.x, r.x + r.w), clamp(y, r.y, r.y + r.h));
}

// Nearest wall buy, box, closed door, or damaged barricade whose tile edge is within range of (x, y).
export function nearestInteractable(map, x, y, range) {
  let best = null;
  const consider = (kind, ref) => {
    const d = distToRect(x, y, ref);
    if (d <= range && (!best || d < best.dist)) best = { kind, ref, dist: d };
  };
  for (const wb of map.wallBuys) consider('wallbuy', wb);
  if (map.box) consider('box', map.box);
  if (map.doors) for (const d of map.doors) if (!d.open) consider('door', d);
  for (const b of map.barricades) if (b.boards < b.maxBoards) consider('barricade', b);
  return best;
}
