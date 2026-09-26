# map.js notes (Agent H; WO4 doors + layout by Agent B)

## What was built
`src/map.js` implements the full 5.1 contract: `MAP_ASCII`, `WALLBUY_MAP`, `loadMap`,
`worldToTile`, `tileToWorld`, `isWalkable`, `resolveCircle`, `raycastWalls`, `tearBoard`,
`repairBoard`, `repairAll`, `barricadeOpen`, `nearestInteractable`. It imports only
`config.js` (TILE), `events.js` (emit) and `math.js` (clamp, dist). No DOM access.
Tests: `tests/map.test.js` (11 tests, all pass; full `npm test` 147/147 at time of writing).

## Map (60 x 40, TILE = 40 -> 2400 x 1600 px) -- WO4 layout (doors)

```
 0 ############################################################
 1 ########S###########################S#######################
 2 ########W#####################2#####W#######################
 3 ###...............F......................................###
 4 ###...............F..............##......................###
 5 ###...............F..............##......................###
 6 ##5...##........###......................................###
 7 ###...##........########...###############...............###
 8 ###.............########...###############.....#####.....a##
 9 ###........##...########...###############.....#####.....###
10 ###........##...########...###############.....#####.....###
11 ###.............########...###############.....#####.....###
12 ###.............########...###############.....#####.....###
13 #############8##########...###############.....#####.....###
14 ########################DDD######1########.....#####.....###
15 #####################................#####...............###
16 #####################................#####...............###
17 ###..............####................#####...............###
18 ###..............####...##...........#####...............###
19 ###.................E...##...........WS###..............O###
20 ###.................E................#######################
21 ###...##....##......E...........##...#######################
22 ###...##....##...####...........##...#######################
23 ###..............####................###############c#######
24 ###..............####.......P........###########.........###
25 ###..............####................###########.........###
26 #SW..............3###................###########.........###
27 ###..............############W##################.........###
28 ###..............############S##################.........###
29 ###..............#########################9#####...###...###
30 ###...##....##...###.........................###...###...WS#
31 ###...##....##...###.........................###.........###
32 ###................G.......##.......##.........H.........###
33 ###................G.......##.......##.........H.........###
34 ##4................G...........................H.........###
35 ###..............###.........................###.........###
36 ###..............###.O................B......###.........###
37 #########W##############7########W##########################
38 #########S#######################S##########################
39 ############################################################
```
(Left column is the row number / ty; columns are tx 0..59.)

Legend: `#` wall, `.` floor, `P` player start (tile code 0), `W` barricaded window,
`S` spawn pocket (zombie-only), `O` open spawn, `B` mystery box, digits/lowercase letters = wall
buys (`WALLBUY_MAP`), uppercase `D E F G H` = buyable doors (tile code 7 while closed).

### Zones and doors (in the order a player opens them)
| Zone | Door (id, cost, tiles) | Wall buys | Spawn points | Cover / loops |
|------|------------------------|-----------|--------------|---------------|
| Hub (start), rows 15-26, cols 21-36 | -- | `1` Sheiva (33,14) on the north wall, across the room from `P` (28,24) | windows 3 (37,19 east) and 5 (29,27 south) | two 2x2 crates to circle |
| Corridor: stub (cols 24-26), north hall (rows 3-6), east hall (cols 42-56, rows 3-19) | `D` id 1, 75, (24-26,14), axis `h`, hub north wall | `2` RK5 (30,2), `a` L-CAR 9 (57,8) | window 2 (36,2 north), open spawn 9 (56,19) | crate in the north hall; east hall is a ring around a 5x7 block (training loop) |
| Courtyard (west), rows 17-36, cols 3-16 | `E` id 2, 100, (20,19-21), axis `v`, hub west wall | `3` KRM-262 (17,26), `4` Kuda (2,34) | windows 4 (2,26 west), 7 (9,37 south) | 4 planters (loops) |
| Bunker (north-west), rows 3-12, cols 3-15 | `F` id 3, 100, (18,3-5), axis `v`, west end of the north hall | `5` VMP (2,6), `8` HVK-30 (13,13) | window 1 (8,2 north) | 2 crates |
| Armory (south), rows 30-36, cols 20-44 | `G` id 4, 125, (19,32-34), axis `v`, courtyard east wall | `7` KN-44 (24,37), `9` Argus (42,29); box `B` (38,36) | window 8 (33,37 south), open spawn 10 (21,36) | two 2x2 pillars |
| Vault (south-east), rows 24-36, cols 48-56 | `H` id 5, 150, (47,32-34), axis `v`, armory east end | `c` ICR-1 (52,23) | window 6 (57,30 east) | 3x2 pillar (loop) |

Coordinates are (tx,ty). Zone graph is a tree: Hub -D-> Corridor -F-> Bunker; Hub -E-> Courtyard
-G-> Armory -H-> Vault. Every door therefore adds new spawn points in any legal order, and the box
needs E+G (2 doors). Loops are inside zones (east-hall ring, planters, pillars) rather than
between zones: any open (door-less) link between two zones would make one of them reachable
without its own door, so a door would sometimes add nothing (see "WO4 notes" below).

### Windows (barricade id = spawn point id -> pocket), row-major order
1: W(8,2)/S(8,1) bunker · 2: W(36,2)/S(36,1) corridor · 3: W(37,19)/S(38,19) hub east ·
4: W(2,26)/S(1,26) courtyard west · 5: W(29,27)/S(29,28) hub south · 6: W(57,30)/S(58,30) vault ·
7: W(9,37)/S(9,38) courtyard south · 8: W(33,37)/S(33,38) armory.
Open spawns: 9 (56,19) corridor east hall, 10 (21,36) armory.
With all doors closed `activeSpawnIds = {3, 5}`; after D +{2, 9}; E +{4, 7}; F +{1}; G +{8, 10};
H +{6} = all 10.

### Wall buys (10), none closer than 8 tiles (Manhattan) to another
`1` sheiva (hub); `2` rk5, `a` lcar9 (corridor); `3` krm262, `4` kuda (courtyard); `5` vmp,
`8` hvk30 (bunker); `7` kn44, `9` argus (armory); `c` icr1 (vault). vesper, pharo, bootlegger are
in `WALLBUY_MAP` but not placed (box-only in practice).

## Decisions / assumptions
- Ids are 1-based (barricades, spawn points, wall buys) so `barricadeId` is never a falsy 0.
- Wall buys and the box are part of the wall/obstacle set; they are **not** in `map.walls`
  (which contains merged rects of code-1 tiles only). Render should draw them separately.
- `loadMap(ascii = MAP_ASCII)` accepts an optional custom ASCII array (handy for other agents'
  tests). Returns a fresh object each call (barricades reset).
- Extra field `map.barricadeIndex` (Int16Array, tile -> barricade index or -1) for O(1) window
  lookups. Extra exports: `TILE_FLOOR ... TILE_OPEN_SPAWN` code constants.
- `isWalkable(..., true)` on a window returns true only when boards == 0; pathfinding is
  expected to treat windows as walkable itself (per 5.5).
- `resolveCircle`: up to 4 relaxation passes over the neighborhood (3x3 for r <= 40); out of
  bounds counts as wall; a center inside a solid tile exits through the nearest edge.
- `raycastWalls`: DDA; blocking = wall, window (any boards), box, wallbuy. Spawn pockets and
  open spawns do not block. Returns 0 if the origin is in a blocking tile, Infinity beyond
  `maxDist` (default Infinity) or the map bounds.
- `nearestInteractable` distance = point to nearest edge of the tile rect; ties keep the first
  found (wall buys, then box, then barricades).

## Constants for config.js
- `MAX_BOARDS = 6` (defined at top of map.js). TODO(integrator): move to config.js.

## Phase 4 fixes (FIX-2: QA review #2 map side, #3)
- `resolveCircle` is now robust (contract signature unchanged). Guarantees on return: centre is
  inside the map, on a tile walkable for the mover, and (for `r <= TILE/2`) the circle overlaps
  no blocking tile.
  - A radial push is accepted only if it lands the centre on a walkable tile; otherwise the
    smallest axis-aligned exit from that tile into a walkable neighbour is used; if none exists
    the tile is skipped this pass.
  - A centre inside a blocking tile (or out of bounds) leaves through the nearest edge whose
    neighbour is walkable, not simply the nearest edge (the old code could eject into another
    wall or past x < 0). Ties prefer a spawn-pocket neighbour.
  - Final check: if the relaxation did not converge cleanly, the result is re-validated; if it
    still fails, the circle is moved to the nearest point of the nearest walkable tile's interior
    (inset by `r`, i.e. the tile centre when `r >= TILE/2`) via a small ring search. Rare path.
  - The normal path is unchanged: a test replays 60k frames of max-speed random movement for both
    player and zombie against a verbatim copy of the old function and requires identical output.
    Cost is ~0.1 us/call on the normal path.
- Window rebuilt under a zombie (#3): decided behaviour is the midline rule. With the centre in
  the window tile, a zombie on the pocket side of the midline (or exactly on it) is pushed back
  into its pocket; one past the midline toward the inside is pushed inside. It is never left in
  the window tile or overlapping the wall tiles beside it. This falls out of the "nearest walkable
  exit" rule (side neighbours of a window are walls), with the pocket tie-break for the midline.
- The zombie-side part of #2 (uncapped separation in `zombie.js`) is not in this file; the map now
  contains the damage (no zombie can end up in a wall or off-map), but the ejection force itself is
  FIX-1's to cap.
- New tests in `tests/map.test.js` (16 total): wall-to-wall ejection, off-map recovery (QA repro
  x = -54 at pocket (1,16)), 20k-point whole-map fuzz for both movers with random board states,
  normal-movement identity vs the legacy function, and the rebuilt-window midline rule for all 8
  windows. The new tests fail against the old implementation (checked).

## WO4: buyable doors (Agent B)
- `TILE_DOOR = 7`, `DOOR_MAP = { D: 75, E: 100, F: 100, G: 125, H: 150 }`. Closed door tiles block
  like walls in `isWalkable` (default branch), `resolveCircle` (via `isWalkable`) and
  `raycastWalls` (`blocksRay`). pathfinding.js only walks codes 0/2/3/6, so no change there.
- `map.doors[]`: `{ id, letter, cost, open, tiles, x, y, w, h, cx, cy, axis }`; ids 1.. in
  `DOOR_MAP` key order (only letters present in the ASCII). `axis` is `'h'` when the tiles run
  along x (door in a horizontal wall, crossed vertically), `'v'` when they run along y. A letter
  whose tiles are not one 4-connected group throws in `loadMap`.
- `map.version` starts at 0 and increments on each `openDoor`. `map.walls` still holds only
  code-1 tiles.
- `openDoor(map, id)`: false if unknown or already open; otherwise tiles -> `TILE_FLOOR`,
  `open = true`, `version++`, `recomputeActiveSpawns`. Emits nothing.
- `recomputeActiveSpawns(map)`: BFS from the player start tile over codes 0, 2, 3, 6 (windows
  passable whatever their boards); returns and stores the `Set` in `map.activeSpawnIds`. Called by
  `loadMap` and `openDoor`.
- `isSpawnActive(map, id)`: true when `map.activeSpawnIds` is missing (fake maps), else `has(id)`.
- `nearestInteractable` also considers closed doors (`kind: 'door'`, distance to the bounding box
  edge, same range rule). Tie order: wall buys, box, doors, barricades.
- Deviation from 2.2: the spec lists 2 windows for the bunker as well, which with hub 2 +
  corridor 1 + courtyard 2 + armory 1 + vault 1 would need 9 windows; the 8-window/2-open budget
  was kept, so the bunker has 1 window. The spawn-point counts (8 windows, 2 open, ids 1-8 / 9-10)
  are unchanged, so no count in other tests moves.
- Loops: the zone graph is a tree on purpose (see above). With only five door letters and each
  door meant to add a zone, an inter-zone loop would force one door to be a no-op shortcut (e.g.
  a bunker-courtyard link made E open the bunker's two guns too). Each zone has its own loop or
  cover instead; every room has at least one spawn point.
- Tests (`tests/map.test.js`, 24 total): door parsing (straight 2-3 runs, bbox, axis, floor on
  both sides), no pocket reachable with any number of doors open, all-open reachability of every
  spawn/wall buy/box/barricade (and each door approachable in D..H order), closed-door active set =
  hub spawns and strict growth D..H to 10, `isSpawnActive` on real and fake maps, hub has exactly
  one wall buy (Sheiva) and all pairs >= 8 apart, box unreachable with <= 1 door open, `openDoor`
  semantics, `nearestInteractable` door kind, door blocks rays/`resolveCircle` from both sides for
  both movers and stops blocking once open. The old "every spawn reaches start" and
  "box is the farthest interactable" tests were replaced; coordinate-based Phase 4 tests were
  moved to the new layout (courtyard pocket (1,26), bunker corner (3,3)).
- Other test files: full `npm test` was green (280/280) with this layout at the time of writing,
  so no test outside map.test.js needed adjusting. Note for others: `spawnPoints[0]` / barricade 1
  is now the bunker window (inactive at start), and the hub windows are ids 3 and 5.

## WO5: mega door, arena, stairs, level defs (Agent B)
- `map.js` imports `./levels/levels.js` (`LEVELS`) and `./levels/level1.js` (`LEVEL1`). Legacy
  exports: `MAP_ASCII = LEVEL1.ascii`, `WALLBUY_MAP = LEVEL1.wallbuys` (same objects).
- `loadMap(levelOrAscii = LEVELS[0], opts = {})`: a level def (`{ id, name, ascii, wallbuys,
  theme }`) or a raw ascii array (legacy: level-1 wall buys, theme, id and name). `opts.wallbuys`
  / `opts.theme` override. Wall-buy letters are resolved through the level's own table (a letter
  not in it throws "unknown tile char"). New fields: `levelId, name, theme, wallbuyMap, megaDoor,
  bossSpawn, arenaSpawns, arenaTiles, stairs`.
- Legend: `M` -> code 7 (`TILE_DOOR`), one 4-connected group (else throws), stored in
  `map.megaDoor = { id: 'mega', letter: 'M', cost: DOORS.megaCost, open, sealed, tiles, x, y, w,
  h, cx, cy, axis }`, NOT in `map.doors`. `Z` -> floor, `map.bossSpawn` = tile centre (more than
  one Z throws). `T` -> code 9 (`TILE_STAIRS`), one connected group, `map.stairs = { tiles, x, y,
  w, h, cx, cy, open }`; blocks movement (both movers) and rays like a wall.
- **Decision: `X` tiles are stored as code 0 (floor)**, positions in `map.arenaSpawns = [{ id, x,
  y, tx, ty }]` (row-major, ids from 1). `TILE_ARENA_SPAWN = 8` stays exported for reference and
  `isWalkable` treats a hand-set 8 as walkable (it never blocks rays), but loadMap never writes
  it. Reason: pathfinding.js only walks codes 0/2/3/6, so no pathfinding change is needed. Same
  for the stairs and mega door: every open transition writes code 0.
- `arenaTiles`: tile indices reachable from Z over codes 0/6/8 at load (mega door and stairs
  closed). Empty Set when there is no Z. `inArena(map, x, y)` looks the tile up (false for null
  maps / no arena / out of bounds).
- `allDoorsOpen` (every `map.doors[]` open; true for a map with no doors, false for null),
  `megaDoorUnlockable` (mega door exists, !open, !sealed, all doors open), `openMegaDoor`,
  `sealMegaDoor` (tiles -> 7, open false, sealed true; false if already sealed),
  `unsealMegaDoor` (tiles -> 0, open true, sealed false; false if already open and unsealed),
  `openStairs` (tiles -> 0, open true). All return bool, bump `map.version` once per change, and
  recompute active spawns; all are null-safe (no mega door / stairs / map -> false).
  `isBossActiveBlocking(map)` = `megaDoor.sealed`.
- `nearestInteractable` adds `'megadoor'` while `!open && !sealed` (even when locked, so the shop
  can show "open all doors first") and `'stairs'` once `stairs.open`. Tie order: wall buys, box,
  doors, mega door, stairs, barricades.
- Arena spawns are not spawn points; `recomputeActiveSpawns` only looks at `map.spawnPoints`, so
  they are never active. `map.walls` still holds only code-1 tiles (stairs are not in it; render
  should draw code 9 itself).
- Tests (7 new, 31 total): inline 14x5 fixture for parsing, walkability/rays, mega-door
  lock/open/seal/unseal, stairs, null safety, legacy exports / level-def loading; plus a
  registry check that runs for every `LEVELS` entry with a `Z` (arena free of W/S/O/B/wall buys
  and not adjacent to windows/box/wall buys, 4-6 X inside, M and T border the arena, no spawn
  point inside, arena reachable only after the mega door opens). It is skipped per level while
  the level has no arena. The older WO4 tests keep a few hard-coded level-1 coordinates (bunker
  corner (3,3), west pocket (1,26), wall (5,1)); they still hold as long as the arena is added
  away from the north-west / west edge.
