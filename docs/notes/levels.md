# levels notes (Agent A, WO5 3.5)

Files: `src/levels/level1.js` (`LEVEL1`), `src/levels/level2.js` (`LEVEL2`), `src/levels/levels.js`
(`LEVELS`, `levelByIndex`), `tests/levels.test.js`. The level modules are pure data and import
nothing outside `src/levels/` (map.js imports the registry; tested).

Level def shape: `{ id, name, ascii[40 x 60], wallbuys, theme, boss: { name, tint }, difficulty }`.
`difficulty` = WO5 1.3 base values: bunker `{ healthMult: 1, speedMult: 1, countMult: 1,
sprintShift: 0 }`, catacombs `{ 1.5, 1.1, 1.25, 3 }` (level.js applies the loop multipliers).
`levelByIndex(i)` wraps (also for negative i).

Legend (both levels): `#` wall, `.` floor, `P` player start, `W` window, `S` spawn pocket,
`O` open spawn, `B` box, `D-H` doors, `M` mega door, `Z` boss spawn, `X` minion spawn,
`T` stairs; any key of `def.wallbuys` is a wall buy (digits / lowercase only, never a legend
letter; tested).

## Level 1 — BUNKER (WO4 layout + arena)

```
   012345678901234567890123456789012345678901234567890123456789
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
16 #####################................#####..............O###
17 ###..............####................#######################
18 ###..............####...##...........####X......X.......X###
19 ###.................E...##...........WS##................###
20 ###.................E................####...##.....##....###
21 ###...##....##......E...........##...###T...##.....##....###
22 ###...##....##...####...........##...###T.......Z.......X###
23 ###..............####................###T................###
24 ###..............####.......P........####...##.....##....###
25 ###..............####................####...##.....##....###
26 #SW..............3###................####................###
27 ###..............############W###########X...............###
28 ###..............############S#######################MMM####
29 ###..............#########################9#####.........###
30 ###...##....##...###.........................###.........WS#
31 ###...##....##...###.........................###.........###
32 ###................G.......##.......##.........H...###...###
33 ###................G.......##.......##.........H...###...###
34 ##4................G...........................H.........###
35 ###..............###.........................###.........###
36 ###..............###.O................B......###.........###
37 #########W##############7########W##################c#######
38 #########S#######################S##########################
39 ############################################################
```

Edits vs WO4 (all inside cols 38-58, rows 16-37; everything else byte-identical, tested):
- Corridor east hall shortened to rows 15-16 (the ring round the 5x7 block still loops); open
  spawn 9 moved (56,19) -> (56,16).
- Arena carved from the rock above the vault: floor cols 41-56, rows 18-27 (16x10 = 144 tiles
  after pillars), four 2x2 pillars, `Z` (48,22), `X` (41,18) (48,18) (56,18) (56,22) (41,27),
  stairs `T` (40,21-23) in the west wall (the wall farthest from the mega door), backed by rock.
- Vault shortened to rows 29-36 (cols 48-56); its 3x2 pillar moved to (51-53,32-33) so it is
  still a loop; mega door `M` (53-55,28) in its north wall; ICR-1 `c` moved (52,23) -> (52,37)
  on its south wall. Window 6 (57,30) and door H (47,32-34) unchanged.
- Wall buys letters/guns = WO4 `WALLBUY_MAP` exactly. All doors, windows, P and B unchanged.

| Zone | Door (letter, cost, tiles) | Wall buys | Spawns |
|------|----------------------------|-----------|--------|
| Hub (start) | -- | `1` Sheiva (33,14) | W (37,19), W (29,27) |
| Corridor | D 75 (24-26,14) h | `2` RK5 (30,2), `a` L-CAR 9 (57,8) | W (36,2), O (56,16) |
| Courtyard | E 100 (20,19-21) v | `3` KRM-262 (17,26), `4` Kuda (2,34) | W (2,26), W (9,37) |
| Bunker | F 100 (18,3-5) v | `5` VMP (2,6), `8` HVK-30 (13,13) | W (8,2) |
| Armory | G 125 (19,32-34) v | `7` KN-44 (24,37), `9` Argus (42,29), box (38,36) | W (33,37), O (21,36) |
| Vault (deepest) | H 150 (47,32-34) v | `c` ICR-1 (52,37) | W (57,30) |
| Arena | M 250 (53-55,28) h, from the vault | -- | Z (48,22), 5 X; stairs T (40,21-23) v |

## Level 2 — CATACOMBS (new layout)

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 ############S###############################################
 2 ############W#######2#############################4#########
 3 ###O........................................###........#####
 4 ###.........................................##..........####
 5 ###.....##.....##.....##..........##....##..F............###
 6 ###.....##.....##.....##..........##....##..F............###
 7 ###.........................................F............###
 8 ###.........................................#.....##.....###
 9 ###########################...######3########.....##.....WS#
10 ##########6################...###############............###
11 ###................########DDD###############............###
12 ###................###.............##########............###
13 ###...###...###....##...............##########..........####
14 #SW...###...###....#.................##########........#####
15 ###................#....##.....##....WS###########5#########
16 ###................E....##.....##....#######################
17 ###...###...###....E.................#######################
18 ###...###...###....E........P........#######################
19 ###................#....##.....##....#######X......X.....X##
20 ###................#....##.....##....#######..............##
21 ###...###...###....#.................#######...##....##...##
22 ###...###...###....##...............########...##....##...##
23 ###................###.............#########..............T#
24 #SW................#####1######W############.......Z......T#
25 ###................############S#####8######..............T#
26 ###................##############..........#..............##
27 #########GGG#####################..........M......##......##
28 ###............................O#..........M......##......##
29 ###.............................#..........M.............X##
30 ###.............................#..........#...X..........##
31 ###.....##......##......##......#....##....#################
32 ##7.....##......##......##......H....##....#################
33 ###.............................H..........#################
34 ###.............................H..........9################
35 ###.............................#..........#################
36 ###.................B...........#..........#################
37 ############W#########################W#####################
38 ############S#########################S#####################
39 ############################################################
```

Structure: a round-ish chapel in the middle, a long ossuary hall with bone pillars across the
top, a corridor mesh of crypts (six tombs) on the west, a round bone chamber in the north-east,
a long charnel pit along the south and a small sanctum that holds the mega door; the arena
fills the east side. Zone graph is a tree (Chapel -D-> Ossuary -F-> Bone Chamber; Chapel -E->
Crypts -G-> Charnel Pit -H-> Sanctum -M-> Arena), D..H is a legal opening order, each door adds
spawns, the box needs E+G.

| Zone | Door (letter, cost, tiles) | Wall buys | Spawns | Cover |
|------|----------------------------|-----------|--------|-------|
| Chapel (start, octagon rows 12-23, cols 20-36) | -- | `1` HVK-30 (24,24) | W (37,15), W (31,24) | 4 sarcophagi |
| Ossuary Hall (rows 3-8, cols 3-43 + spur 27-29) | D 75 (27-29,11) h | `2` Weevil (20,2), `3` Marshal 16 (36,9) | W (12,2), O (3,3) | 5 bone pillars |
| West Crypts (rows 11-26, cols 3-18) | E 100 (19,16-18) v | `6` XR-2 (10,10) | W (2,14), W (2,24) | 6 tombs (corridor mesh) |
| Bone Chamber (octagon rows 3-14, cols 45-56) | F 100 (44,5-7) v | `4` Man-O-War (50,2), `5` Haymaker 12 (50,15) | W (57,9) | central pile (loop) |
| Charnel Pit (rows 28-36, cols 3-31) | G 125 (9-11,27) h | `7` 48 Dredge (2,32), box (20,36) | W (12,37), O (31,28) | 3 bone piles |
| Sanctum (deepest, rows 26-36, cols 33-42) | H 150 (32,32-34) v | `8` Gorgon (37,25), `9` Drakon (43,34) | W (38,37) | altar (loop) |
| Arena (rows 19-30, cols 44-57, 14x12) | M 250 (43,27-29) v, from the sanctum | -- | Z (51,24), X (44,19) (51,19) (57,19) (57,29) (47,30); stairs T (58,23-25) v | 3 pillars |

Wall-buy map: `{1: hvk30, 2: weevil, 3: marshal16, 6: xr2, 4: manowar, 5: haymaker12,
7: dredge48, 8: gorgon, 9: drakon}` — all eight new guns are on the walls; the start room sells
a level-1 gun (the player arrives with their level-1 loadout anyway); the best guns (Gorgon,
Drakon, 300 each) sit behind H. Prices come from `WEAPONS[id].cost` (Agent D).

## Tests (`tests/levels.test.js`)

A self-contained ASCII parser + BFS (no map.js) runs on every level in `LEVELS`:
- WO4 suite (as in tests/map.test.js): 40x60, wall border, known legend, one P/B, 8 W + 8 S +
  2 O, 8-10 wall buys with known unique weapon ids, every W has one S and faces one floor tile,
  pockets sealed, doors D-H present as straight 2-3 runs with walkable tiles on both sides and
  wall caps, no pocket reachable with any subset (prefix) of doors/M/T open, everything reachable
  with all doors open, every spawn reaches P (zombie walk), exactly 7 zones (6 + arena) with the
  5 doors each joining two zones and connecting all six (tree: no door-less links), start room
  has exactly the 2 windows, D..H approachable in order and each strictly grows the active set
  to 10, one wall buy in the start room >= 8 from P, all wall-buy pairs >= 8 apart (Manhattan),
  box unreachable with any single door.
- Arena (3.5): one Z, 4-6 X on the arena edge, M and T straight 2-3 runs, arena (reachable from
  Z with M/T closed) is 130-220 tiles with a bbox >= 12x10, only `.`/Z/X inside and nothing but
  wall/M/T around it, 2-4 pillars, M joins the arena and the zone behind H, arena unreachable
  (player and zombies) with all doors open but M closed and fully reachable with M open, T faces
  the arena, is backed by wall, is not walkable while closed, opening it adds only its own tiles,
  and is >= 10 tiles from M.
- Plus: registry/wrap, difficulty, theme fields, level 1 = WO4 outside the edited block (doors,
  windows, P, B identical; letter counts equal; wall buys = WO4 map), level 2 differs from level 1
  in > 25 % of tiles and places all new guns with Gorgon + Drakon deepest, purity/import rule,
  and negative checks proving the suite catches a broken border, a missing M and a leak into the
  arena.

## Decisions / notes for others
- The arena is a real zone of its own (7th component); X tiles are not spawn points and are not
  reachable from any W/S/O without M.
- Level 1 moved two gameplay things: open spawn 9 (east hall) now (56,16), ICR-1 now (52,37).
  Coordinate-based tests elsewhere that used (56,19) or (52,23) would need updating (none found:
  full `npm test` 370/370 green at time of writing, with map.js loading both levels).
- Level 2 has 9 wall buys (the WO4 test range is 8-10).

## WO5 FIX-1 (QA review L1)
- Level 1 Argus `9` moved (42,29) -> (38,29), still on the hall's north wall (same zone, faces
  (38,30)). It was one wall row below the arena floor and could be bought/refilled from inside the
  sealed arena (interact range 64 px, no line of sight). Now 3 tiles (Chebyshev) from the nearest
  arena tile, 3 from the start room, >= 8 (Manhattan) from every other buy.
- `validateArena` now asserts no wall buy, box, window or door D..H lies within 2 tiles
  (Chebyshev) of any arena tile, for both levels; the old Argus position is a negative case.
  Level 2 already complied (nearest: none within 3).
