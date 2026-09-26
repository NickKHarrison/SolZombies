// pathfinding.js — Agent E. Flow field for zombie navigation (WORK_ORDER 3.6, 5.5).
// Pure logic: no DOM access. Reads map.tiles / map.cols / map.rows directly so it does not
// depend on map.js at runtime.
import { TILE } from './config.js';

// Tile codes (WORK_ORDER 5.1): 0 floor, 1 wall, 2 window, 3 spawnpocket, 4 box, 5 wallbuy, 6 openspawn.
// Zombie-walkable for flow purposes: floor, window (regardless of boards), spawn pocket, open spawn.
const ZOMBIE_WALKABLE = new Uint8Array(256);
ZOMBIE_WALKABLE[0] = 1;
ZOMBIE_WALKABLE[2] = 1;
ZOMBIE_WALKABLE[3] = 1;
ZOMBIE_WALKABLE[6] = 1;

const INV_SQRT2 = Math.SQRT1_2;

// Neighbor order: orthogonals first so they win ties against diagonals (safer near walls).
const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * FlowField shape:
 * { cols, rows, targetX, targetY, targetTx, targetTy,
 *   dist: Int32Array   // tiles to target (4-neighbor BFS steps), -1 = unreachable/blocked
 *   dirX, dirY: Float32Array // unit vector toward the best neighbor, 0,0 at target/unreachable
 * }
 */
export function buildFlowField(map, targetX, targetY) {
  const cols = map && map.cols ? map.cols | 0 : 0;
  const rows = map && map.rows ? map.rows | 0 : 0;
  const n = cols * rows;
  const dist = new Int32Array(n).fill(-1);
  const dirX = new Float32Array(n);
  const dirY = new Float32Array(n);
  const flow = { cols, rows, targetX, targetY, targetTx: -1, targetTy: -1, dist, dirX, dirY };
  if (n === 0 || !map.tiles) return flow;
  const tiles = map.tiles;

  // Target tile, clamped into the grid.
  let tx = Math.floor(targetX / TILE);
  let ty = Math.floor(targetY / TILE);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return flow;
  tx = tx < 0 ? 0 : tx >= cols ? cols - 1 : tx;
  ty = ty < 0 ? 0 : ty >= rows ? rows - 1 : ty;
  flow.targetTx = tx;
  flow.targetTy = ty;

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const ti = ty * cols + tx;
  if (ZOMBIE_WALKABLE[tiles[ti]]) {
    dist[ti] = 0;
    queue[tail++] = ti;
  } else {
    // Target stands in a blocked tile (should not happen for the player): seed from the
    // walkable 8-neighbors instead so zombies still converge on the spot.
    for (let k = 0; k < 8; k++) {
      const nx = tx + NDX[k];
      const ny = ty + NDY[k];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (ZOMBIE_WALKABLE[tiles[ni]] && dist[ni] < 0) {
        dist[ni] = 0;
        queue[tail++] = ni;
      }
    }
  }

  // 4-neighbor BFS (Manhattan steps). Diagonal moves are handled in the gradient pass.
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    const x = i % cols;
    if (x + 1 < cols) { const j = i + 1; if (dist[j] < 0 && ZOMBIE_WALKABLE[tiles[j]]) { dist[j] = d; queue[tail++] = j; } }
    if (x > 0) { const j = i - 1; if (dist[j] < 0 && ZOMBIE_WALKABLE[tiles[j]]) { dist[j] = d; queue[tail++] = j; } }
    if (i + cols < n) { const j = i + cols; if (dist[j] < 0 && ZOMBIE_WALKABLE[tiles[j]]) { dist[j] = d; queue[tail++] = j; } }
    if (i - cols >= 0) { const j = i - cols; if (dist[j] < 0 && ZOMBIE_WALKABLE[tiles[j]]) { dist[j] = d; queue[tail++] = j; } }
  }

  // Gradient: for every reached tile pick the 8-neighbor with the lowest dist.
  // Diagonals are only allowed when both adjacent orthogonal tiles are walkable (no corner cutting).
  for (let q = 0; q < tail; q++) {
    const i = queue[q];
    let best = dist[i];
    if (best === 0) continue; // target tile(s): live vector handled in getFlowDir
    const x = i % cols;
    const y = (i - x) / cols;
    let bdx = 0;
    let bdy = 0;
    for (let k = 0; k < 8; k++) {
      const dx = NDX[k];
      const dy = NDY[k];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nd = dist[ny * cols + nx];
      if (nd < 0 || nd >= best) continue;
      if (dx !== 0 && dy !== 0) {
        if (dist[y * cols + nx] < 0 || dist[ny * cols + x] < 0) continue;
      }
      best = nd;
      bdx = dx;
      bdy = dy;
    }
    if (bdx !== 0 && bdy !== 0) {
      dirX[i] = bdx * INV_SQRT2;
      dirY[i] = bdy * INV_SQRT2;
    } else {
      dirX[i] = bdx;
      dirY[i] = bdy;
    }
  }
  return flow;
}

function tileIndex(flow, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (!(tx >= 0 && ty >= 0 && tx < flow.cols && ty < flow.rows)) return -1;
  return ty * flow.cols + tx;
}

/** Tiles (BFS steps) from the tile containing (x, y) to the target, or Infinity. */
export function distanceAt(flow, x, y) {
  if (!flow || !flow.dist) return Infinity;
  const i = tileIndex(flow, x, y);
  if (i < 0) return Infinity;
  const d = flow.dist[i];
  return d < 0 ? Infinity : d;
}

/**
 * Unit direction to follow at world point (x, y). Bilinearly blends the vectors of the 4 tiles
 * whose centers surround the point (blocked/unreachable tiles are skipped and weights renormalized).
 * Target tiles contribute a live vector pointing at the exact target position.
 * Returns {0,0} if the point's own tile is unreachable or out of bounds.
 */
export function getFlowDir(flow, x, y) {
  if (!flow || !flow.dist) return { x: 0, y: 0 };
  const own = tileIndex(flow, x, y);
  if (own < 0 || flow.dist[own] < 0) return { x: 0, y: 0 };

  const { cols, rows, dist, dirX, dirY } = flow;
  const ownD = dist[own];
  const fx = x / TILE - 0.5;
  const fy = y / TILE - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const wx = fx - x0;
  const wy = fy - y0;

  // Live vector toward the target point (used for tiles with dist 0).
  let lx = flow.targetX - x;
  let ly = flow.targetY - y;
  const ll = Math.hypot(lx, ly);
  if (ll > 1e-6) { lx /= ll; ly /= ll; } else { lx = 0; ly = 0; }

  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let c = 0; c < 4; c++) {
    const ox = c & 1;
    const oy = c >> 1;
    const tx = x0 + ox;
    const ty = y0 + oy;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
    const i = ty * cols + tx;
    const d = dist[i];
    if (d < 0) continue;
    // Skip tiles not locally connected to ours (e.g. across a diagonal wall gap).
    const dd = d - ownD;
    if (dd > 2 || dd < -2) continue;
    const w = (ox ? wx : 1 - wx) * (oy ? wy : 1 - wy);
    if (w <= 0) continue;
    if (d === 0) { sx += lx * w; sy += ly * w; } else { sx += dirX[i] * w; sy += dirY[i] * w; }
    sw += w;
  }

  let len = sw > 0 ? Math.hypot(sx, sy) : 0;
  if (len < 1e-4) {
    // Degenerate blend (opposing vectors or nothing usable): fall back to own tile's vector.
    if (dist[own] === 0) { sx = lx; sy = ly; } else { sx = dirX[own]; sy = dirY[own]; }
    len = Math.hypot(sx, sy);
    if (len < 1e-6) return { x: 0, y: 0 };
  }
  return { x: sx / len, y: sy / len };
}
