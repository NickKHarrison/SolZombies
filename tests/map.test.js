import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE, PLAYER, ZOMBIE } from '../src/config.js';
import * as events from '../src/events.js';
import {
  MAP_ASCII, WALLBUY_MAP, loadMap, worldToTile, tileToWorld, isWalkable, resolveCircle,
  raycastWalls, tearBoard, repairBoard, repairAll, barricadeOpen, nearestInteractable,
  TILE_DOOR, DOOR_MAP, openDoor, recomputeActiveSpawns, isSpawnActive,
  TILE_ARENA_SPAWN, TILE_STAIRS, allDoorsOpen, megaDoorUnlockable, openMegaDoor, sealMegaDoor,
  unsealMegaDoor, openStairs, inArena, isBossActiveBlocking,
} from '../src/map.js';
import { DOORS } from '../src/config.js';
import { LEVELS } from '../src/levels/levels.js';
import { LEVEL1 } from '../src/levels/level1.js';

const WEAPON_IDS = ['sheiva', 'rk5', 'krm262', 'kuda', 'vmp', 'vesper', 'kn44', 'hvk30', 'argus',
  'lcar9', 'pharo', 'icr1', 'bootlegger'];

function bfs(map, startTiles, passable) {
  const seen = new Uint8Array(map.cols * map.rows);
  const d = new Int32Array(map.cols * map.rows).fill(-1);
  const q = [];
  for (const [tx, ty] of startTiles) { seen[ty * map.cols + tx] = 1; d[ty * map.cols + tx] = 0; q.push([tx, ty]); }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
      const k = ny * map.cols + nx;
      if (seen[k] || !passable(nx, ny)) continue;
      seen[k] = 1; d[k] = d[y * map.cols + x] + 1; q.push([nx, ny]);
    }
  }
  return d;
}

const startTile = (map) => { const t = worldToTile(map.playerStart.x, map.playerStart.y); return [t.tx, t.ty]; };
const code = (map, tx, ty) => map.tiles[ty * map.cols + tx];

test.beforeEach(() => events.clearAll());

test('map parses to 60x40 with expected contents', () => {
  assert.equal(MAP_ASCII.length, 40);
  for (const row of MAP_ASCII) assert.equal(row.length, 60);
  const m = loadMap();
  assert.equal(m.cols, 60); assert.equal(m.rows, 40);
  assert.equal(m.width, 60 * TILE); assert.equal(m.height, 40 * TILE);
  assert.ok(m.tiles instanceof Uint8Array);
  assert.equal(m.barricades.length, 8);
  assert.equal(m.spawnPoints.filter((s) => s.kind === 'window').length, 8);
  assert.equal(m.spawnPoints.filter((s) => s.kind === 'open').length, 2);
  assert.ok(m.wallBuys.length >= 8 && m.wallBuys.length <= 10);
  assert.ok(m.box && m.box.w === TILE);
  assert.ok(m.walls.length > 0);
  const [sx, sy] = startTile(m);
  assert.equal(code(m, sx, sy), 0, 'P is floor');
  for (const wb of m.wallBuys) assert.ok(WEAPON_IDS.includes(wb.weaponId));
  for (const id of Object.values(WALLBUY_MAP)) assert.ok(WEAPON_IDS.includes(id));
  // weapon ids unique on the wall
  assert.equal(new Set(m.wallBuys.map((w) => w.weaponId)).size, m.wallBuys.length);
  // tile codes
  for (const b of m.barricades) assert.equal(code(m, b.tx, b.ty), 2);
  for (const wb of m.wallBuys) assert.equal(code(m, wb.tx, wb.ty), 5);
  assert.equal(code(m, m.box.tx, m.box.ty), 4);
  for (const sp of m.spawnPoints.filter((s) => s.kind === 'open')) {
    const t = worldToTile(sp.x, sp.y); assert.equal(code(m, t.tx, t.ty), 6);
  }
  // merged wall rects cover exactly the wall tiles
  let area = 0; for (const r of m.walls) area += (r.w / TILE) * (r.h / TILE);
  assert.equal(area, [...m.tiles].filter((c) => c === 1).length);
});

test('barricades and spawn points are linked; every W has exactly one adjacent S', () => {
  const m = loadMap();
  for (const b of m.barricades) {
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (code(m, b.tx + dx, b.ty + dy) === 3) n++;
    assert.equal(n, 1, `window ${b.id}`);
    const sp = m.spawnPoints.find((s) => s.id === b.spawnPointId);
    assert.equal(sp.barricadeId, b.id);
    assert.equal(sp.kind, 'window');
    const t = worldToTile(sp.x, sp.y);
    assert.equal(code(m, t.tx, t.ty), 3);
    assert.equal(Math.abs(t.tx - b.tx) + Math.abs(t.ty - b.ty), 1);
    assert.equal(b.boards, 6); assert.equal(b.maxBoards, 6);
  }
  // every S belongs to exactly one window
  const pockets = [...m.tiles].filter((c) => c === 3).length;
  assert.equal(pockets, 8);
});

// --- WO4 layout validity (doors) ---------------------------------------------

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const playerBfs = (m) => bfs(m, [startTile(m)], (x, y) => isWalkable(m, x, y, false));
// An interactable tile (wall buy / box / window / door) is reachable if a 4-neighbour was reached.
const touches = (m, d, tx, ty) => N4.some(([dx, dy]) => {
  const nx = tx + dx, ny = ty + dy;
  return nx >= 0 && ny >= 0 && nx < m.cols && ny < m.rows && d[ny * m.cols + nx] >= 0;
});
const openAll = (m) => { for (const dr of m.doors) openDoor(m, dr.id); };

test('doors parse: D..H, one straight 2-3 tile run each, costs from DOOR_MAP', () => {
  const m = loadMap();
  assert.equal(TILE_DOOR, 7);
  assert.deepEqual(DOOR_MAP, { D: 75, E: 100, F: 100, G: 125, H: 150 });
  assert.deepEqual(m.doors.map((dr) => dr.letter), ['D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(m.doors.map((dr) => dr.id), [1, 2, 3, 4, 5]);
  assert.equal(m.version, 0);
  for (const dr of m.doors) {
    assert.equal(dr.cost, DOOR_MAP[dr.letter]);
    assert.equal(dr.open, false);
    assert.ok(dr.tiles.length >= 2 && dr.tiles.length <= 3, `door ${dr.letter} width`);
    const xs = new Set(dr.tiles.map((t) => t.tx)), ys = new Set(dr.tiles.map((t) => t.ty));
    assert.ok(xs.size === 1 || ys.size === 1, `door ${dr.letter} straight`);
    assert.equal(dr.axis, ys.size === 1 ? 'h' : 'v');
    assert.equal(dr.axis === 'h' ? dr.w : dr.h, dr.tiles.length * TILE);
    assert.equal(dr.axis === 'h' ? dr.h : dr.w, TILE);
    assert.equal(dr.cx, dr.x + dr.w / 2); assert.equal(dr.cy, dr.y + dr.h / 2);
    for (const t of dr.tiles) {
      assert.equal(code(m, t.tx, t.ty), TILE_DOOR);
      assert.ok(t.tx * TILE >= dr.x && t.tx * TILE < dr.x + dr.w && t.ty * TILE >= dr.y && t.ty * TILE < dr.y + dr.h);
    }
    // a real doorway: floor on both sides across the run
    const [ox, oy] = dr.axis === 'h' ? [0, 1] : [1, 0];
    for (const t of dr.tiles) {
      assert.equal(code(m, t.tx + ox, t.ty + oy), 0, `door ${dr.letter} side +`);
      assert.equal(code(m, t.tx - ox, t.ty - oy), 0, `door ${dr.letter} side -`);
    }
  }
  // map.walls only holds code-1 tiles (doors excluded)
  let area = 0; for (const r of m.walls) area += (r.w / TILE) * (r.h / TILE);
  assert.equal(area, [...m.tiles].filter((c) => c === 1).length);
  assert.throws(() => loadMap(['#D#', '###', '#D#', '#P#']), /door 'D'/);
});

test('no spawn pocket is reachable by the player, whatever doors are open', () => {
  const m = loadMap();
  for (let k = 0; k <= m.doors.length; k++) {
    if (k > 0) openDoor(m, m.doors[k - 1].id);
    const d = playerBfs(m);
    for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === 3) assert.equal(d[i], -1, `pocket ${i} after ${k} doors`);
  }
});

test('all doors open: every spawn, wall buy, box and barricade reachable from the start', () => {
  const m = loadMap();
  openAll(m);
  const d = playerBfs(m);
  for (const wb of m.wallBuys) assert.ok(touches(m, d, wb.tx, wb.ty), `wallbuy ${wb.weaponId}`);
  assert.ok(touches(m, d, m.box.tx, m.box.ty), 'box');
  for (const b of m.barricades) assert.ok(touches(m, d, b.tx, b.ty), `barricade ${b.id}`);
  // zombie side: every spawn point reaches the start (windows open)
  const dz = bfs(m, [startTile(m)], (x, y) => isWalkable(m, x, y, true) || code(m, x, y) === 2);
  for (const sp of m.spawnPoints) {
    const t = worldToTile(sp.x, sp.y);
    assert.ok(dz[t.ty * m.cols + t.tx] >= 0, `spawn ${sp.id} unreachable`);
  }
  assert.equal(m.activeSpawnIds.size, 10);
  // each door can be walked up to once the doors before it (D..) are open
  const m2 = loadMap();
  for (const dr of m2.doors) {
    const d2 = playerBfs(m2);
    assert.ok(dr.tiles.some((t) => touches(m2, d2, t.tx, t.ty)), `door ${dr.letter} approachable`);
    openDoor(m2, dr.id);
  }
});

test('all doors closed: only hub spawns active; opening D..H only grows the set to all 10', () => {
  const m = loadMap();
  assert.ok(m.activeSpawnIds instanceof Set);
  assert.ok(m.activeSpawnIds.size > 0);
  // hub = player-reachable area with doors closed; hub spawns = its windows + open spawns in it
  const d = playerBfs(m);
  const hub = new Set();
  for (const b of m.barricades) if (touches(m, d, b.tx, b.ty)) hub.add(b.spawnPointId);
  for (const sp of m.spawnPoints.filter((s) => s.kind === 'open')) {
    const t = worldToTile(sp.x, sp.y);
    if (d[t.ty * m.cols + t.tx] >= 0) hub.add(sp.id);
  }
  const sorted = (it) => [...it].sort((a, b) => a - b);
  assert.deepEqual(sorted(m.activeSpawnIds), sorted(hub));
  assert.equal(hub.size, 2, 'hub has 2 windows');
  let prev = new Set(m.activeSpawnIds);
  for (const dr of m.doors) {
    assert.equal(openDoor(m, dr.id), true);
    for (const id of prev) assert.ok(m.activeSpawnIds.has(id), `door ${dr.letter} dropped spawn ${id}`);
    assert.ok(m.activeSpawnIds.size > prev.size, `door ${dr.letter} adds spawns`);
    prev = new Set(m.activeSpawnIds);
  }
  assert.equal(prev.size, 10);
  // boards do not matter for activity
  const m3 = loadMap();
  for (const b of m3.barricades) b.boards = 0;
  assert.deepEqual(sorted(recomputeActiveSpawns(m3)), sorted(hub));
});

test('isSpawnActive: real map and fake maps without activeSpawnIds', () => {
  const m = loadMap();
  for (const sp of m.spawnPoints) assert.equal(isSpawnActive(m, sp.id), m.activeSpawnIds.has(sp.id));
  assert.equal(isSpawnActive({ spawnPoints: [] }, 3), true);
  assert.equal(isSpawnActive({ activeSpawnIds: new Set([2]) }, 3), false);
  assert.equal(isSpawnActive({ activeSpawnIds: new Set([2]) }, 2), true);
});

test('wall buys spread out: hub has exactly one (Sheiva), all pairs >= 8 tiles apart', () => {
  const m = loadMap();
  const d = playerBfs(m);
  const hubBuys = m.wallBuys.filter((wb) => touches(m, d, wb.tx, wb.ty));
  assert.equal(hubBuys.length, 1);
  assert.equal(hubBuys[0].weaponId, 'sheiva');
  assert.ok(!touches(m, d, m.box.tx, m.box.ty), 'no box in the hub');
  for (let i = 0; i < m.wallBuys.length; i++) {
    for (let j = i + 1; j < m.wallBuys.length; j++) {
      const a = m.wallBuys[i], b = m.wallBuys[j];
      const md = Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
      assert.ok(md >= 8, `${a.weaponId} / ${b.weaponId} only ${md} apart`);
    }
  }
  // the Sheiva sits across the room from the start
  const [sx, sy] = startTile(m);
  assert.ok(Math.abs(hubBuys[0].tx - sx) + Math.abs(hubBuys[0].ty - sy) >= 8);
});

test('the box needs at least two doors open', () => {
  const n = loadMap().doors.length;
  for (let only = -1; only < n; only++) {
    const m = loadMap();
    if (only >= 0) openDoor(m, m.doors[only].id);
    assert.ok(!touches(m, playerBfs(m), m.box.tx, m.box.ty), `box reachable with only door #${only + 1}`);
  }
});

test('openDoor: tiles to floor, version bump, false on repeat or unknown id', () => {
  const m = loadMap();
  const dr = m.doors[0];
  assert.equal(openDoor(m, 999), false);
  assert.equal(m.version, 0);
  assert.equal(openDoor(m, dr.id), true);
  assert.equal(dr.open, true);
  assert.equal(m.version, 1);
  for (const t of dr.tiles) { assert.equal(code(m, t.tx, t.ty), 0); assert.ok(isWalkable(m, t.tx, t.ty)); }
  assert.equal(openDoor(m, dr.id), false);
  assert.equal(m.version, 1);
  assert.equal(openDoor(m, m.doors[1].id), true);
  assert.equal(m.version, 2);
  assert.equal(openDoor({ doors: [] }, 1), false);
});

test('nearestInteractable returns a closed door, not once it is open', () => {
  const m = loadMap();
  const range = PLAYER.interactRange;
  const dr = m.doors[0]; // D: horizontal run in the hub's north wall
  const px = dr.cx, py = dr.y + dr.h + 20;
  const hit = nearestInteractable(m, px, py, range);
  assert.equal(hit.kind, 'door'); assert.equal(hit.ref, dr); assert.equal(hit.dist, 20);
  const h2 = nearestInteractable(m, dr.cx, dr.y - 20, range); // other side
  assert.equal(h2.kind, 'door'); assert.equal(h2.ref, dr);
  openDoor(m, dr.id);
  const h3 = nearestInteractable(m, px, py, range);
  assert.ok(!h3 || h3.kind !== 'door');
});

test('closed door blocks raycasts and resolveCircle for both movers; open door does not', () => {
  const m = loadMap();
  for (const dr of m.doors) {
    const t = dr.tiles[1];
    assert.equal(isWalkable(m, t.tx, t.ty, false), false);
    assert.equal(isWalkable(m, t.tx, t.ty, true), false);
    const [ux, uy] = dr.axis === 'h' ? [0, 1] : [1, 0]; // across the doorway
    const cx = (t.tx + 0.5) * TILE, cy = (t.ty + 0.5) * TILE;
    for (const s of [1, -1]) {
      // ray from 80 px in front of the door centre, straight at it: hits the door face at 60
      const ox = cx - s * ux * 80, oy = cy - s * uy * 80;
      assert.ok(Math.abs(raycastWalls(m, ox, oy, s * ux, s * uy, 1000) - 60) < 1e-6, `ray ${dr.letter} ${s}`);
      // circles trying to step into the doorway are pushed back to their side
      for (const [r, fz] of [[PLAYER.radius, false], [ZOMBIE.radius, true]]) {
        const p = resolveCircle(m, cx - s * ux * 25, cy - s * uy * 25, r, fz);
        const along = ((p.x - cx) * ux + (p.y - cy) * uy) * s;
        assert.ok(along <= -TILE / 2 - r + 1e-6, `door ${dr.letter} blocks ${fz ? 'zombie' : 'player'} (${s})`);
      }
    }
  }
  const m2 = loadMap();
  openAll(m2);
  for (const dr of m2.doors) {
    const t = dr.tiles[1];
    const [ux, uy] = dr.axis === 'h' ? [0, 1] : [1, 0];
    const cx = (t.tx + 0.5) * TILE, cy = (t.ty + 0.5) * TILE;
    assert.equal(raycastWalls(m2, cx - ux * 80, cy - uy * 80, ux, uy, 160), Infinity, `open ray ${dr.letter}`);
    for (const [r, fz] of [[PLAYER.radius, false], [ZOMBIE.radius, true]]) {
      assert.deepEqual(resolveCircle(m2, cx, cy, r, fz), { x: cx, y: cy }, `open door ${dr.letter}`);
    }
  }
});

test('worldToTile / tileToWorld', () => {
  assert.deepEqual(worldToTile(45, 81), { tx: 1, ty: 2 });
  assert.deepEqual(tileToWorld(1, 2), { x: 60, y: 100 });
});

test('isWalkable per tile kind and window boards', () => {
  const m = loadMap();
  const b = m.barricades[0];
  const sp = m.spawnPoints.find((s) => s.id === b.spawnPointId);
  const st = worldToTile(sp.x, sp.y);
  assert.equal(isWalkable(m, -1, 0), false);
  assert.equal(isWalkable(m, 0, 0), false);
  assert.equal(isWalkable(m, st.tx, st.ty, false), false);
  assert.equal(isWalkable(m, st.tx, st.ty, true), true);
  assert.equal(isWalkable(m, b.tx, b.ty, false), false);
  assert.equal(isWalkable(m, b.tx, b.ty, true), false);
  b.boards = 0;
  assert.equal(isWalkable(m, b.tx, b.ty, true), true);
  assert.equal(isWalkable(m, b.tx, b.ty, false), false);
  assert.equal(isWalkable(m, m.box.tx, m.box.ty, true), false);
  const [sx, sy] = startTile(m);
  assert.equal(isWalkable(m, sx, sy), true);
});

test('resolveCircle pushes out of walls and slides', () => {
  const m = loadMap();
  const r = PLAYER.radius;
  const s = m.playerStart;
  // free space: unchanged
  assert.deepEqual(resolveCircle(m, s.x, s.y, r), { x: s.x, y: s.y });
  // bunker row 3 has a wall row 2 above it; overlap from below
  const wallBottom = 3 * TILE;
  const p = resolveCircle(m, 10 * TILE + 20, wallBottom + 5, r);
  assert.ok(Math.abs(p.y - (wallBottom + r)) < 1e-6);
  assert.equal(p.x, 10 * TILE + 20, 'slides: x preserved');
  // deep inside a wall tile gets ejected to a walkable spot
  const q = resolveCircle(m, 10 * TILE + 20, 2 * TILE + 35, r);
  const qt = worldToTile(q.x, q.y);
  assert.ok(isWalkable(m, qt.tx, qt.ty));
  // concave corner (bunker top-left at tile 3,3): pushed out on both axes
  const c = resolveCircle(m, 3 * TILE + 2, 3 * TILE + 2, r);
  assert.ok(c.x >= 3 * TILE + r - 1e-6 && c.y >= 3 * TILE + r - 1e-6);
});

test('resolveCircle: window blocks player always, zombie only while boarded', () => {
  const m = loadMap();
  const b = m.barricades.find((bb) => MAP_ASCII[bb.ty - 1][bb.tx] === '.'); // pocket below (hub south)
  const x = b.x + TILE / 2, y = b.y - 5; // overlapping the window from the room side
  const r = ZOMBIE.radius;
  assert.ok(resolveCircle(m, x, y, r, false).y <= b.y - r + 1e-6);
  assert.ok(resolveCircle(m, x, y, r, true).y <= b.y - r + 1e-6);
  b.boards = 0;
  assert.equal(resolveCircle(m, x, y, r, true).y, y, 'zombie passes open window');
  assert.ok(resolveCircle(m, x, y, r, false).y <= b.y - r + 1e-6, 'player still blocked');
});

test('raycastWalls hits walls and windows, passes open floor', () => {
  const m = loadMap();
  // from the bunker straight up into the north wall (row 2 bottom edge at y=120)
  const ox = 10 * TILE + 20, oy = 4 * TILE + 20;
  assert.ok(Math.abs(raycastWalls(m, ox, oy, 0, -1, 5000) - (oy - 3 * TILE)) < 1e-6);
  // maxDist too short -> Infinity
  assert.equal(raycastWalls(m, ox, oy, 0, -1, 10), Infinity);
  // window: boards irrelevant
  const b = m.barricades.find((bb) => MAP_ASCII[bb.ty - 1][bb.tx] === '.');
  const wx = b.x + TILE / 2, wy = b.y - 100;
  assert.ok(Math.abs(raycastWalls(m, wx, wy, 0, 1, 5000) - 100) < 1e-6);
  b.boards = 0;
  assert.ok(Math.abs(raycastWalls(m, wx, wy, 0, 1, 5000) - 100) < 1e-6);
  // diagonal ray eventually hits something finite
  const t = raycastWalls(m, m.playerStart.x, m.playerStart.y, Math.SQRT1_2, Math.SQRT1_2);
  assert.ok(Number.isFinite(t) && t > 0);
  // origin inside wall -> 0
  assert.equal(raycastWalls(m, 5, 5, 1, 0, 100), 0);
  // leftward ray into west wall
  const lt = raycastWalls(m, ox, oy, -1, 0, 5000);
  assert.ok(Math.abs(lt - (ox - 3 * TILE)) < 1e-6);
});

test('tearBoard / repairBoard / repairAll counts and events', () => {
  const m = loadMap();
  const log = [];
  events.on('barricade:board', (p) => log.push(p));
  const id = m.barricades[2].id;
  for (let i = 0; i < 6; i++) assert.equal(tearBoard(m, id), true);
  assert.equal(tearBoard(m, id), false);
  assert.equal(barricadeOpen(m, id), true);
  assert.equal(log.length, 6);
  assert.deepEqual(log[5], { barricadeId: id, boards: 0, by: 'zombie' });
  assert.equal(repairBoard(m, id), true);
  assert.deepEqual(log[6], { barricadeId: id, boards: 1, by: 'player' });
  assert.equal(barricadeOpen(m, id), false);
  tearBoard(m, m.barricades[0].id);
  log.length = 0;
  repairAll(m);
  assert.equal(log.length, 2);
  assert.ok(log.every((p) => p.by === 'carpenter' && p.boards === 6));
  assert.equal(repairBoard(m, id), false, 'full barricade');
  assert.equal(log.length, 2);
  assert.equal(tearBoard(m, 9999), false);
});

test('nearestInteractable finds wall buys, box, damaged barricades', () => {
  const m = loadMap();
  const range = PLAYER.interactRange;
  assert.equal(nearestInteractable(m, m.playerStart.x, m.playerStart.y, range), null);
  const wb = m.wallBuys[0];
  const c = tileToWorld(wb.tx, wb.ty + 1);
  const hit = nearestInteractable(m, c.x, c.y, range);
  assert.equal(hit.kind, 'wallbuy'); assert.equal(hit.ref, wb); assert.equal(hit.dist, 20);
  const bc = tileToWorld(m.box.tx, m.box.ty - 1);
  assert.equal(nearestInteractable(m, bc.x, bc.y, range).kind, 'box');
  const b = m.barricades.find((bb) => MAP_ASCII[bb.ty - 1][bb.tx] === '.');
  const inside = tileToWorld(b.tx, b.ty - 1);
  assert.equal(nearestInteractable(m, inside.x, inside.y, range), null, 'full barricade ignored');
  tearBoard(m, b.id);
  const h2 = nearestInteractable(m, inside.x, inside.y, range);
  assert.equal(h2.kind, 'barricade'); assert.equal(h2.ref, b);
});

// ---------------------------------------------------------------------------
// Phase 4 regression tests (QA review #2 and #3)
// ---------------------------------------------------------------------------

// Deterministic PRNG for fuzzing (tests only).
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Asserts the post-conditions resolveCircle guarantees: centre in map and on a walkable tile,
// and no blocking tile overlapped.
function assertSettled(m, p, r, forZombie, msg) {
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${msg}: finite`);
  assert.ok(p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height, `${msg}: in bounds (${p.x},${p.y})`);
  const t = worldToTile(p.x, p.y);
  assert.ok(isWalkable(m, t.tx, t.ty, forZombie), `${msg}: centre on walkable tile (${t.tx},${t.ty})`);
  for (let ty = t.ty - 1; ty <= t.ty + 1; ty++) {
    for (let tx = t.tx - 1; tx <= t.tx + 1; tx++) {
      if (isWalkable(m, tx, ty, forZombie)) continue;
      const nx = Math.min(Math.max(p.x, tx * TILE), tx * TILE + TILE);
      const ny = Math.min(Math.max(p.y, ty * TILE), ty * TILE + TILE);
      assert.ok(Math.hypot(p.x - nx, p.y - ny) >= r - 1e-4, `${msg}: overlaps blocked tile (${tx},${ty})`);
    }
  }
}

// Verbatim copy of the pre-Phase-4 resolveCircle, used to prove normal movement is unchanged.
function legacyResolve(map, x, y, r, forZombie = false) {
  let px = x, py = y;
  const reach = Math.max(1, Math.ceil(r / TILE));
  const clampv = (v, a, b) => (v < a ? a : v > b ? b : v);
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const ctx = Math.floor(px / TILE), cty = Math.floor(py / TILE);
    for (let ty = cty - reach; ty <= cty + reach; ty++) {
      for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
        if (isWalkable(map, tx, ty, forZombie)) continue;
        const rx = tx * TILE, ry = ty * TILE;
        const nx = clampv(px, rx, rx + TILE), ny = clampv(py, ry, ry + TILE);
        const dx = px - nx, dy = py - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d;
          px += (dx / d) * push; py += (dy / d) * push;
        } else {
          const left = px - rx, right = rx + TILE - px, top = py - ry, bottom = ry + TILE - py;
          const mm = Math.min(left, right, top, bottom);
          if (mm === left) px = rx - r;
          else if (mm === right) px = rx + TILE + r;
          else if (mm === top) py = ry - r;
          else py = ry + TILE + r;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

test('resolveCircle (#2): centre inside a wall never exits into another wall', () => {
  const m = loadMap();
  const r = ZOMBIE.radius;
  // Courtyard west window W(2,26) with pocket S(1,26). Tile (1,25) is wall above the pocket,
  // (1,24) is wall too; a centre near the top of (1,25) used to be pushed up into (1,24).
  const p = resolveCircle(m, 1 * TILE + 20, 25 * TILE + 8, r, true);
  assertSettled(m, p, r, true, 'pocket side wall');
  assert.deepEqual(worldToTile(p.x, p.y), { tx: 1, ty: 26 }, 'lands in the pocket');
  // Deep inside a solid block with no walkable 4-neighbour: nearest walkable tile.
  const q = resolveCircle(m, 5 * TILE + 20, 1 * TILE + 20, r, true);
  assertSettled(m, q, r, true, 'deep wall');
});

test('resolveCircle (#2): out-of-map centres are brought back onto walkable tiles', () => {
  const m = loadMap();
  const r = ZOMBIE.radius;
  for (const [x, y] of [[-14, 26 * TILE + 20], [-54, 26 * TILE + 20], [-300, -300],
    [m.width + 50, m.height + 50], [m.width + 5, 4 * TILE + 20]]) {
    assertSettled(m, resolveCircle(m, x, y, r, true), r, true, `zombie ${x},${y}`);
    assertSettled(m, resolveCircle(m, x, y, PLAYER.radius, false), PLAYER.radius, false, `player ${x},${y}`);
  }
  // The QA repro (moved to the WO4 layout): thrown out the west side next to pocket (1,26).
  const p = resolveCircle(m, -54, 26 * TILE + 20, r, true);
  assert.deepEqual(worldToTile(p.x, p.y), { tx: 1, ty: 26 });
});

test('resolveCircle (#2): fuzz over the whole map always settles (zombie and player)', () => {
  const m = loadMap();
  const rnd = lcg(12345);
  for (let i = 0; i < 20000; i++) {
    const forZombie = i % 2 === 0;
    if (i % 1000 === 0) for (const b of m.barricades) b.boards = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 6);
    const r = forZombie ? ZOMBIE.radius : PLAYER.radius;
    const x = -100 + rnd() * (m.width + 200), y = -100 + rnd() * (m.height + 200);
    assertSettled(m, resolveCircle(m, x, y, r, forZombie), r, forZombie, `fuzz #${i} ${x},${y}`);
  }
});

test('resolveCircle (#2): normal movement is identical to the pre-fix behaviour', () => {
  const m = loadMap();
  const rnd = lcg(777);
  const step = PLAYER.speed * PLAYER.sprintMult / 30; // biggest normal per-frame step (dt 1/30)
  for (const forZombie of [false, true]) {
    const r = forZombie ? ZOMBIE.radius : PLAYER.radius;
    let x = m.playerStart.x, y = m.playerStart.y;
    let a = 0;
    for (let i = 0; i < 60000; i++) {
      if (i % 20 === 0) a = rnd() * Math.PI * 2;
      const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
      const got = resolveCircle(m, nx, ny, r, forZombie);
      const want = legacyResolve(m, nx, ny, r, forZombie);
      assert.deepEqual(got, want, `step ${i} from ${x},${y}`);
      x = got.x; y = got.y;
    }
  }
});

test('resolveCircle (#3): window rebuilt under a zombie pushes it to the correct side', () => {
  const m = loadMap();
  const r = ZOMBIE.radius;
  const rnd = lcg(4242);
  for (const b of m.barricades) {
    const sp = m.spawnPoints.find((s) => s.id === b.spawnPointId);
    const pocket = worldToTile(sp.x, sp.y);
    const ox = pocket.tx - b.tx, oy = pocket.ty - b.ty; // unit vector window -> pocket
    const inside = { tx: b.tx - ox, ty: b.ty - oy };
    for (let i = 0; i < 300; i++) {
      b.boards = 0;
      // A legal zombie position with the centre in the open window tile.
      const pos = resolveCircle(m, b.x + rnd() * TILE, b.y + rnd() * TILE, r, true);
      const t = worldToTile(pos.x, pos.y);
      if (t.tx !== b.tx || t.ty !== b.ty) continue;
      // Signed offset from the window midline towards the pocket.
      const along = ox ? (pos.x - (b.x + TILE / 2)) * ox : (pos.y - (b.y + TILE / 2)) * oy;
      b.boards = 1 + (i % 6);
      const p = resolveCircle(m, pos.x, pos.y, r, true);
      assertSettled(m, p, r, true, `barricade ${b.id} pos ${pos.x},${pos.y}`);
      const pt = worldToTile(p.x, p.y);
      const expected = along >= 0 ? pocket : inside;
      assert.deepEqual(pt, { tx: expected.tx, ty: expected.ty },
        `barricade ${b.id}: along=${along} should go ${along >= 0 ? 'back to pocket' : 'inside'}`);
    }
    // Exactly on the midline -> back to the pocket.
    b.boards = 3;
    const mid = resolveCircle(m, b.x + TILE / 2, b.y + TILE / 2, r, true);
    assert.deepEqual(worldToTile(mid.x, mid.y), { tx: pocket.tx, ty: pocket.ty });
  }
});

// ---------------------------------------------------------------------------
// WO5: mega door, arena, stairs, level defs (3.1)
// ---------------------------------------------------------------------------

// Small fixture: start room | door D | middle room (open spawn) | mega door M | arena (Z, 2 X) | stairs T.
const ARENA_ASCII = [
  '##############',
  '#P..#....#..X#',
  '#...D....M.Z.T',
  '#...#.O..#X..#',
  '##############',
];
const at = (tx, ty) => tileToWorld(tx, ty);

test('WO5 legacy exports and level-def loading', () => {
  assert.equal(MAP_ASCII, LEVEL1.ascii);
  assert.equal(WALLBUY_MAP, LEVEL1.wallbuys);
  assert.equal(TILE_ARENA_SPAWN, 8); assert.equal(TILE_STAIRS, 9);
  const m = loadMap();
  assert.equal(m.levelId, LEVELS[0].id); assert.equal(m.name, LEVELS[0].name);
  assert.equal(m.theme, LEVELS[0].theme); assert.equal(m.wallbuyMap, LEVELS[0].wallbuys);
  // raw ascii: level-1 theme and wall buys
  const r = loadMap(['#####', '#P.1#', '#####']);
  assert.equal(r.theme, LEVEL1.theme); assert.equal(r.wallbuyMap, WALLBUY_MAP);
  assert.equal(r.wallBuys[0].weaponId, WALLBUY_MAP['1']);
  // level def with its own wall-buy letters and theme
  const theme = { name: 'T' };
  const d = loadMap({ id: 'x', name: 'X', ascii: ['#####', '#Pe.#', '#####'], wallbuys: { e: 'gorgon' }, theme });
  assert.equal(d.levelId, 'x'); assert.equal(d.name, 'X'); assert.equal(d.theme, theme);
  assert.equal(d.wallBuys[0].weaponId, 'gorgon');
  assert.throws(() => loadMap({ id: 'y', ascii: ['#####', '#P1.#', '#####'], wallbuys: { e: 'gorgon' } }), /unknown tile/);
  // opts override
  assert.equal(loadMap(['###', '#P#', '###'], { theme }).theme, theme);
  // every registry level loads, wall buys resolve through the level's own table
  for (const def of LEVELS) {
    const lm = loadMap(def);
    assert.equal(lm.levelId, def.id);
    for (const wb of lm.wallBuys) assert.equal(wb.weaponId, def.wallbuys[def.ascii[wb.ty][wb.tx]]);
  }
});

test('WO5 parse: mega door, boss spawn, arena spawns, stairs, arena tiles', () => {
  const m = loadMap(ARENA_ASCII);
  assert.equal(m.doors.length, 1, 'mega door is not in map.doors');
  const md = m.megaDoor;
  assert.ok(md);
  assert.deepEqual(md.tiles, [{ tx: 9, ty: 2 }]);
  assert.equal(md.cost, DOORS.megaCost); assert.equal(md.open, false); assert.equal(md.sealed, false);
  assert.equal(md.x, 9 * TILE); assert.equal(md.cx, 9.5 * TILE); assert.equal(md.w, TILE);
  assert.equal(code(m, 9, 2), TILE_DOOR);
  assert.deepEqual(m.bossSpawn, at(11, 2));
  assert.equal(code(m, 11, 2), 0);
  assert.deepEqual(m.arenaSpawns.map((s) => [s.id, s.x, s.y]),
    [[1, at(12, 1).x, at(12, 1).y], [2, at(10, 3).x, at(10, 3).y]]);
  for (const s of m.arenaSpawns) assert.equal(code(m, s.tx, s.ty), 0, 'X stored as floor (pathfinding-walkable)');
  assert.deepEqual(m.stairs.tiles, [{ tx: 13, ty: 2 }]);
  assert.equal(m.stairs.open, false);
  assert.equal(code(m, 13, 2), TILE_STAIRS);
  const expected = [];
  for (let ty = 1; ty <= 3; ty++) for (let tx = 10; tx <= 12; tx++) expected.push(ty * m.cols + tx);
  assert.deepEqual([...m.arenaTiles].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  assert.equal(inArena(m, m.bossSpawn.x, m.bossSpawn.y), true);
  assert.equal(inArena(m, m.playerStart.x, m.playerStart.y), false);
  assert.equal(inArena(m, md.cx, md.cy), false, 'mega door tile is not arena');
  assert.equal(inArena(m, m.stairs.cx, m.stairs.cy), false);
  assert.equal(inArena(m, -50, -50), false);
  // arena spawns are never spawn points and never active
  assert.equal(m.spawnPoints.length, 1);
  assert.equal(m.activeSpawnIds.size, 0);
  openDoor(m, 1);
  assert.deepEqual([...m.activeSpawnIds], [1]);
  openMegaDoor(m); openStairs(m);
  assert.deepEqual([...recomputeActiveSpawns(m)], [1]);
  // errors
  assert.throws(() => loadMap(['#####', '#PZZ#', '#####']), /boss spawn/);
  assert.throws(() => loadMap(['#####', '#PM.#', '###M#', '#####']), /mega door/);
  assert.throws(() => loadMap(['#####', '#PT.#', '###T#', '#####']), /stairs/);
});

test('WO5 walkability and rays: stairs block until opened, X tiles are open floor', () => {
  const m = loadMap(ARENA_ASCII);
  for (const fz of [false, true]) {
    assert.equal(isWalkable(m, 13, 2, fz), false, 'closed stairs');
    assert.equal(isWalkable(m, 9, 2, fz), false, 'closed mega door');
    assert.equal(isWalkable(m, 10, 3, fz), true, 'arena spawn');
    assert.equal(isWalkable(m, 11, 2, fz), true, 'boss spawn');
  }
  // ray east along row 2 from inside the arena hits the stairs face
  const o = at(10, 2);
  assert.ok(Math.abs(raycastWalls(m, o.x, o.y, 1, 0, 1000) - (13 * TILE - o.x)) < 1e-6);
  // ray over the X tile (row 3, westward from (12,3)) is not stopped by it
  const o3 = at(12, 3);
  assert.ok(Math.abs(raycastWalls(m, o3.x, o3.y, -1, 0, 1000) - (o3.x - 10 * TILE)) < 1e-6);
  // circle pushed off the closed stairs
  const p = resolveCircle(m, 13 * TILE - 5, o.y, PLAYER.radius, false);
  assert.ok(p.x <= 13 * TILE - PLAYER.radius + 1e-6);
  // hand-set code 8 is walkable too and does not block rays
  m.tiles[3 * m.cols + 10] = TILE_ARENA_SPAWN;
  assert.equal(isWalkable(m, 10, 3, true), true);
  assert.equal(isWalkable(m, 10, 3, false), true);
  assert.equal(raycastWalls(m, o3.x, o3.y, -1, 0, 70), Infinity);
});

test('WO5 mega door: locked until all doors open, open, seal, unseal', () => {
  const m = loadMap(ARENA_ASCII);
  const md = m.megaDoor;
  const range = PLAYER.interactRange;
  const front = { x: md.x - 20, y: md.cy };
  assert.equal(allDoorsOpen(m), false);
  assert.equal(megaDoorUnlockable(m), false);
  assert.equal(openMegaDoor(m), false);
  assert.equal(m.version, 0);
  // locked mega door is still offered (shop shows the blocked prompt)
  let h = nearestInteractable(m, front.x, front.y, range);
  assert.equal(h.kind, 'megadoor'); assert.equal(h.ref, md); assert.equal(h.dist, 20);
  openDoor(m, 1);
  assert.equal(allDoorsOpen(m), true);
  assert.equal(megaDoorUnlockable(m), true);
  const v = m.version;
  assert.equal(openMegaDoor(m), true);
  assert.equal(md.open, true); assert.equal(code(m, 9, 2), 0); assert.equal(m.version, v + 1);
  assert.ok(isWalkable(m, 9, 2) && isWalkable(m, 9, 2, true));
  assert.equal(openMegaDoor(m), false); assert.equal(megaDoorUnlockable(m), false);
  h = nearestInteractable(m, front.x, front.y, range);
  assert.ok(!h || h.kind !== 'megadoor');
  // seal
  assert.equal(isBossActiveBlocking(m), false);
  assert.equal(sealMegaDoor(m), true);
  assert.equal(md.open, false); assert.equal(md.sealed, true); assert.equal(code(m, 9, 2), TILE_DOOR);
  assert.equal(m.version, v + 2);
  assert.equal(isBossActiveBlocking(m), true);
  assert.equal(megaDoorUnlockable(m), false); assert.equal(openMegaDoor(m), false);
  assert.equal(sealMegaDoor(m), false);
  h = nearestInteractable(m, front.x, front.y, range);
  assert.ok(!h || h.kind !== 'megadoor', 'sealed door has no prompt');
  assert.equal(isWalkable(m, 9, 2, true), false);
  const o = at(11, 2);
  assert.ok(Math.abs(raycastWalls(m, o.x, o.y, -1, 0, 1000) - (o.x - 10 * TILE)) < 1e-6, 'sealed door blocks rays');
  // unseal
  assert.equal(unsealMegaDoor(m), true);
  assert.equal(md.open, true); assert.equal(md.sealed, false); assert.equal(code(m, 9, 2), 0);
  assert.equal(m.version, v + 3);
  assert.equal(isBossActiveBlocking(m), false);
  assert.equal(unsealMegaDoor(m), false);
});

test('WO5 stairs: openStairs makes them walkable floor and interactable', () => {
  const m = loadMap(ARENA_ASCII);
  const st = m.stairs;
  const range = PLAYER.interactRange;
  const front = { x: st.x - 20, y: st.cy };
  let h = nearestInteractable(m, front.x, front.y, range);
  assert.ok(!h || h.kind !== 'stairs', 'closed stairs not offered');
  assert.equal(openStairs(m), true);
  assert.equal(st.open, true); assert.equal(code(m, 13, 2), 0); assert.equal(m.version, 1);
  assert.ok(isWalkable(m, 13, 2) && isWalkable(m, 13, 2, true));
  h = nearestInteractable(m, front.x, front.y, range);
  assert.equal(h.kind, 'stairs'); assert.equal(h.ref, st);
  assert.equal(openStairs(m), false); assert.equal(m.version, 1);
});

test('WO5 null safety: maps without M/Z/X/T and null maps', () => {
  const m = loadMap(['#####', '#P..#', '#####']);
  assert.equal(m.megaDoor, null); assert.equal(m.stairs, null); assert.equal(m.bossSpawn, null);
  assert.deepEqual(m.arenaSpawns, []); assert.equal(m.arenaTiles.size, 0);
  assert.equal(allDoorsOpen(m), true);
  for (const mm of [m, null, undefined, {}, { doors: [] }]) {
    assert.equal(megaDoorUnlockable(mm), false);
    assert.equal(openMegaDoor(mm), false);
    assert.equal(sealMegaDoor(mm), false);
    assert.equal(unsealMegaDoor(mm), false);
    assert.equal(openStairs(mm), false);
    assert.equal(inArena(mm, 60, 60), false);
    assert.equal(isBossActiveBlocking(mm), false);
  }
  assert.equal(allDoorsOpen(null), false);
  assert.equal(m.version, 0);
  assert.equal(nearestInteractable(m, 60, 60, 1000), null);
});

test('WO5 registry levels with an arena: arena is clean and reachable once everything is open', () => {
  for (const def of LEVELS) {
    const m = loadMap(def);
    if (!m.bossSpawn) continue; // arena not authored yet (Phase 1 stub)
    const L = def.id;
    assert.ok(m.megaDoor && m.stairs, `${L}: mega door and stairs`);
    assert.ok(m.arenaSpawns.length >= 4 && m.arenaSpawns.length <= 6, `${L}: 4-6 X tiles`);
    const forbidden = new Set(['W', 'S', 'O', 'B', ...Object.keys(def.wallbuys)]);
    for (const k of m.arenaTiles) {
      const tx = k % m.cols, ty = (k - tx) / m.cols;
      assert.ok(!forbidden.has(def.ascii[ty][tx]), `${L}: '${def.ascii[ty][tx]}' in arena at ${tx},${ty}`);
      for (const [dx, dy] of N4) {
        const c = code(m, tx + dx, ty + dy);
        assert.ok(c !== 2 && c !== 4 && c !== 5, `${L}: window/box/wall buy next to arena tile ${tx},${ty}`);
      }
    }
    for (const sp of m.spawnPoints) assert.equal(inArena(m, sp.x, sp.y), false, `${L}: spawn ${sp.id} in arena`);
    for (const x of m.arenaSpawns) assert.equal(inArena(m, x.x, x.y), true, `${L}: X ${x.id} outside arena`);
    const adj = (list) => list.some((t) => N4.some(([dx, dy]) => m.arenaTiles.has((t.ty + dy) * m.cols + t.tx + dx)));
    assert.ok(adj(m.megaDoor.tiles), `${L}: mega door borders the arena`);
    assert.ok(adj(m.stairs.tiles), `${L}: stairs border the arena`);
    assert.equal(inArena(m, m.playerStart.x, m.playerStart.y), false);
    // arena unreachable until the mega door opens, reachable after
    openAll(m);
    const zt = worldToTile(m.bossSpawn.x, m.bossSpawn.y);
    assert.equal(playerBfs(m)[zt.ty * m.cols + zt.tx], -1, `${L}: arena reachable before mega door`);
    assert.equal(openMegaDoor(m), true);
    assert.ok(playerBfs(m)[zt.ty * m.cols + zt.tx] >= 0, `${L}: arena unreachable with mega door open`);
    const active = m.activeSpawnIds.size;
    openStairs(m);
    assert.equal(m.activeSpawnIds.size, active, `${L}: stairs open no spawns`);
  }
});

// ---------------- WO7: perk machines ----------------

import * as mapNs from '../src/map.js';
import { PERKS } from '../src/config.js';
import { buildFlowField, distanceAt } from '../src/pathfinding.js';

const PERK_FIXTURE = [
  '###########',
  '#P........#',
  '#.J.Q.C.N.#',
  '#.........#',
  '#.U.K.....#',
  '###########',
];

test('WO7 TILE_PERK and letter table come from config PERKS', () => {
  assert.equal(mapNs.TILE_PERK, 10);
  const want = {};
  for (const [id, p] of Object.entries(PERKS.list)) want[p.letter] = id;
  assert.deepEqual(mapNs.PERK_LETTERS, want);
  assert.deepEqual(Object.keys(want).sort(), ['C', 'J', 'K', 'N', 'Q', 'U']);
});

test('WO7 perk letters collide with no other legend letter (fixed chars, doors, wall buys)', () => {
  const fixed = ['#', '.', 'P', 'W', 'S', 'O', 'B', 'M', 'Z', 'X', 'T', ...Object.keys(DOOR_MAP)];
  for (const ch of Object.keys(mapNs.PERK_LETTERS)) {
    assert.ok(!fixed.includes(ch), `perk letter ${ch} is a fixed legend char`);
    assert.ok(!Object.prototype.hasOwnProperty.call(WALLBUY_MAP, ch), `perk letter ${ch} in WALLBUY_MAP`);
    for (const def of LEVELS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(def.wallbuys || {}, ch), `perk letter ${ch} in ${def.id} wallbuys`);
    }
  }
  // lowercase 'c' is still a level-1 wall buy, distinct from Speed Cola 'C'
  const m = loadMap(['#####', '#PcC#', '#####']);
  assert.equal(m.wallBuys.length, 1); assert.equal(m.perkMachines.length, 1);
  assert.equal(m.perkMachines[0].perkId, 'speed');
  // a level def that reuses a perk letter for a wall buy is rejected
  assert.throws(() => loadMap({ id: 'z', ascii: ['####', '#PJ#', '####'], wallbuys: { J: 'sheiva' } }), /perk machine and a wall buy/);
});

test('WO7 parse: perkMachines ids, perk ids, tiles, rects, soldOut', () => {
  const m = loadMap(PERK_FIXTURE);
  const got = m.perkMachines.map((p) => [p.id, p.perkId, p.tx, p.ty]);
  assert.deepEqual(got, [
    [1, 'jugg', 2, 2], [2, 'revive', 4, 2], [3, 'speed', 6, 2], [4, 'dtap', 8, 2],
    [5, 'stamin', 2, 4], [6, 'mule', 4, 4],
  ]);
  for (const p of m.perkMachines) {
    assert.equal(code(m, p.tx, p.ty), mapNs.TILE_PERK);
    assert.deepEqual([p.x, p.y, p.w, p.h], [p.tx * TILE, p.ty * TILE, TILE, TILE]);
    assert.equal(p.soldOut, false);
  }
  // not merged into wall rects, no wall buys created
  assert.equal(m.wallBuys.length, 0);
  // maps without machines still carry an empty list
  assert.deepEqual(loadMap(['###', '#P#', '###']).perkMachines, []);
});

test('WO7 perk machines block movers, rays and zombie pathing', () => {
  const m = loadMap(PERK_FIXTURE);
  const j = m.perkMachines[0];
  assert.equal(isWalkable(m, j.tx, j.ty, false), false);
  assert.equal(isWalkable(m, j.tx, j.ty, true), false);
  // ray from the left, along row 2, stops at the machine's left edge
  const c = tileToWorld(1, 2);
  const d = raycastWalls(m, c.x, c.y, 1, 0);
  assert.ok(Math.abs(d - (j.x - c.x)) < 1e-6, `ray distance ${d}`);
  // circle pushed out of the machine for both movers
  for (const fz of [false, true]) {
    const r = resolveCircle(m, j.x - 5, j.y + TILE / 2, 14, fz);
    assert.ok(r.x <= j.x - 14 + 1e-6, `pushed x ${r.x}`);
  }
  // pathfinding: machine tiles are unreachable, floor around them is
  const t = tileToWorld(1, 1);
  const flow = buildFlowField(m, t.x, t.y);
  const mc = tileToWorld(j.tx, j.ty);
  assert.ok(!(distanceAt(flow, mc.x, mc.y) >= 0) || distanceAt(flow, mc.x, mc.y) === Infinity,
    'machine tile has no flow distance');
  const nb = tileToWorld(j.tx, j.ty + 1);
  assert.ok(Number.isFinite(distanceAt(flow, nb.x, nb.y)) && distanceAt(flow, nb.x, nb.y) >= 0);
});

test('WO7 nearestInteractable: perk kind, range edge, sold-out still reported, tie order', () => {
  const m = loadMap(PERK_FIXTURE);
  const j = m.perkMachines[0];
  // standing below the Juggernog machine (row 3), 10 px from its bottom edge
  let hit = nearestInteractable(m, j.x + TILE / 2, j.y + TILE + 10, PLAYER.interactRange);
  assert.equal(hit.kind, 'perk'); assert.equal(hit.ref, j);
  assert.ok(Math.abs(hit.dist - 10) < 1e-9);
  // exactly at range: included; just past it: nothing
  assert.equal(nearestInteractable(m, j.x + TILE / 2, j.y + TILE + 15, 15).kind, 'perk');
  assert.equal(nearestInteractable(m, j.x + TILE / 2, j.y + TILE + 15.01, 15), null);
  m.perkMachines[1].soldOut = true;
  const q = m.perkMachines[1];
  hit = nearestInteractable(m, q.x + TILE / 2, q.y + TILE + 5, PLAYER.interactRange);
  assert.equal(hit.kind, 'perk'); assert.equal(hit.ref, q);
  // tie: wall buy beats perk, perk beats a door (machine and neighbours equidistant)
  const tie = loadMap(['#####', '#1.J#', '#.P.#', '#####']);
  const pm = tie.perkMachines[0], wb = tie.wallBuys[0];
  const midX = (wb.x + wb.w + pm.x) / 2; // centre of the floor tile between them
  hit = nearestInteractable(tie, midX, pm.y + TILE / 2, PLAYER.interactRange);
  assert.equal(hit.kind, 'wallbuy');
  const tie2 = loadMap(['#####', '#D.J#', '#.P.#', '#####']);
  const pm2 = tie2.perkMachines[0];
  hit = nearestInteractable(tie2, (tie2.doors[0].x + TILE + pm2.x) / 2, pm2.y + TILE / 2, PLAYER.interactRange);
  assert.equal(hit.kind, 'perk');
});
