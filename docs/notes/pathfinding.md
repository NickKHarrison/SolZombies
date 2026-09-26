# pathfinding.js notes (Agent E)

## What was built
`src/pathfinding.js` implements the 3.6 contract:

- `buildFlowField(map, targetX, targetY) -> FlowField`
- `getFlowDir(flow, x, y) -> {x, y}` (unit vector or `{0,0}`)
- `distanceAt(flow, x, y) -> tiles | Infinity`

FlowField shape:
```js
{ cols, rows, targetX, targetY, targetTx, targetTy,
  dist: Int32Array,   // BFS steps to target, -1 = blocked/unreachable
  dirX, dirY: Float32Array } // per-tile unit vector toward best neighbor (0,0 at target/unreachable)
```

## Design decisions
- **No dependency on map.js.** Reads `map.tiles`, `map.cols` and `map.rows` directly, and imports only `TILE` from config.js.
  Zombie-walkable for flow = tile codes 0 floor, 2 window (boards ignored so zombies outside can path in),
  3 spawn pocket, 6 open spawn. Blocked = 1 wall, 4 box, 5 wallbuy.
- **Distance metric:** a 4-neighbor BFS, so `dist` is Manhattan steps around obstacles, which is what `distanceAt` returns.
  The direction pass then picks the lowest-dist neighbor among all 8, so diagonal movement comes out naturally.
  In open space a diagonal step lowers dist by 2, so the result is an octile-style "diagonal, then straight" path.
  On ties, orthogonal neighbors win because they are safer near walls.
- **No corner cutting:** a diagonal neighbor is only considered when both orthogonal tiles it passes are reachable.
  The same rule means a pinched diagonal gap (two floor tiles touching only at a corner) is not connected.
- **Target tile:** its stored vector is 0. `getFlowDir` swaps in a live unit vector toward the exact `(targetX, targetY)`
  for any target tile it samples, so zombies close in smoothly instead of stopping at the tile edge.
- **Target outside the grid or in a blocked tile:** it is clamped into the grid. If the tile is blocked,
  its walkable 8-neighbors are seeded as dist 0.
- **Bilinear blending:** `getFlowDir` samples the 4 tiles whose centers surround the point.
  Unreachable tiles are skipped and the weights renormalized. Tiles whose dist differs from the query tile's by more than 2
  are also skipped, because they are not locally connected (for example across a diagonal wall gap).
  If the blend comes out near zero (opposing vectors), it falls back to the query tile's own vector.
  If the query tile is unreachable, it returns `{0,0}`.
- **Robustness:** a null or empty map produces an empty field. A null flow gives `{0,0}` and `Infinity`.
- **Allocation:** 3 typed arrays plus a queue per build, which is fine at a 0.2 s rebuild rate.
  `getFlowDir` returns a fresh object on every call.

## Performance
60x40 map with wall strips, 50 runs: average about **0.11 ms** (budget 2 ms). The test asserts under 5 ms to avoid flakiness.

## Tests (`tests/pathfinding.test.js`, all passing)
Straight corridor, open-room diagonal, obstacle detour (it also walks the field and never enters a wall),
unreachable/walls/out of bounds give Infinity and `{0,0}`, no corner cutting, pinched diagonal gap,
tile-code walkability (W/S/O walkable, B/X blocking), target-tile live vector, target in a wall, null inputs,
unit-length output everywhere, and the perf test.

## Notes for others
- When `npm test` was run, player/powerups/waves tests were failing because the in-progress `map.js`
  does not yet export `barricadeOpen` / `raycastWalls`. This is unrelated to pathfinding.
- Zombie code (Agent D) should treat `{0,0}` from `getFlowDir` as "no path" (for example, fall back to steering straight at the player
  or holding still). The target tile returns a live vector toward the player, so it is never zero unless the zombie is exactly on the target.
- No constants need moving to config.
