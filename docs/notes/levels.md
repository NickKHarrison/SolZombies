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


## WO7 (Agent I) — perk machines on every level + LABORATORY

Files: `level1.js`, `level2.js` (perk letters only), `level3.js` (new layout), `levels.js`
(unchanged: registry `[LEVEL1, LEVEL2, LEVEL3]` from Phase 0), `tests/levels.test.js`.

Legend additions: perk machines are wall tiles with the `PERKS.list` letters
`J` jugg, `Q` revive, `C` speed, `N` dtap, `U` stamin, `K` mule (map.js `TILE_PERK`, Agent G).
Wall-buy keys stay digits/lowercase, so no clash (tested).

### Placement rules (3.4; all tested on every level in `LEVELS`)
- Exactly 6 machines, one per perk; each replaces a wall tile whose 4-neighbours are walls,
  other machines/wall buys and floor of **one zone only** (never a window, pocket or door).
- Reachable with all doors open; none inside the arena or within 2 tiles (Chebyshev) of any
  arena tile (they are also in the FIX-1 "interactable through the arena wall" list).
- >= 6 tiles (Manhattan) from every wall buy.
- Q in the start zone, K in the deepest zone (behind H, the zone the mega door leaves from),
  Juggernog behind >= 1 door; plus the per-level named zone (door step 0 = start, 1-5 = D-H).
- Level 1 test "edit confined to the arena/vault block" now turns perk letters back into `#`
  (and asserts each replaced a WO4 wall) before comparing with WO4.

| Level | Q revive | C speed | J jugg | N dtap | U stamin | K mule |
|-------|----------|---------|--------|--------|----------|--------|
| 1 BUNKER | hub (24,27) | courtyard/E (8,16) | corridor/D (41,10) | bunker/F (5,13) | armory/G (31,29) | vault/H (57,34) |
| 2 CATACOMBS | chapel (22,11) | ossuary/D (30,2) | west crypts/E (2,19) | bone chamber/F (57,6) | charnel pit/G (26,37) | sanctum/H (34,37) |
| 3 LABORATORY | lobby (21,30) | corridor/D (28,14) | west labs/E (6,37) | containment/F (20,2) | cryo/G (32,2) | reactor/H (50,9) |

Nearest wall buy per machine is 6-8 tiles (e.g. L1 C 8 from HVK-30, L3 C 8 from XR-2 and
Peacekeeper); nearest arena tile >= 6 tiles on every level.

### Level 1 — BUNKER (WO5 layout + perks)

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
10 ###........##...########...##############J.....#####.....###
11 ###.............########...###############.....#####.....###
12 ###.............########...###############.....#####.....###
13 #####N#######8##########...###############.....#####.....###
14 ########################DDD######1########.....#####.....###
15 #####################................#####...............###
16 ########C############................#####..............O###
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
27 ###..............#######Q####W###########X...............###
28 ###..............############S#######################MMM####
29 ###..............##############U######9#########.........###
30 ###...##....##...###.........................###.........WS#
31 ###...##....##...###.........................###.........###
32 ###................G.......##.......##.........H...###...###
33 ###................G.......##.......##.........H...###...###
34 ##4................G...........................H.........K##
35 ###..............###.........................###.........###
36 ###..............###.O................B......###.........###
37 #########W##############7########W##################c#######
38 #########S#######################S##########################
39 ############################################################
```

### Level 2 — CATACOMBS (WO5 layout + perks)

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 ############S###############################################
 2 ############W#######2#########C###################4#########
 3 ###O........................................###........#####
 4 ###.........................................##..........####
 5 ###.....##.....##.....##..........##....##..F............###
 6 ###.....##.....##.....##..........##....##..F............N##
 7 ###.........................................F............###
 8 ###.........................................#.....##.....###
 9 ###########################...######3########.....##.....WS#
10 ##########6################...###############............###
11 ###................###Q####DDD###############............###
12 ###................###.............##########............###
13 ###...###...###....##...............##########..........####
14 #SW...###...###....#.................##########........#####
15 ###................#....##.....##....WS###########5#########
16 ###................E....##.....##....#######################
17 ###...###...###....E.................#######################
18 ###...###...###....E........P........#######################
19 ##J................#....##.....##....#######X......X.....X##
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
37 ############W#############U#######K###W#####################
38 ############S#########################S#####################
39 ############################################################
```

### Level 3 — LABORATORY (new)

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 ##########S#########################S#######################
 2 ##########W#########N###########U###W#########7#######8#####
 3 ###.....#....#....#....#..O...#...........#..............###
 4 ###.....#....#....#....#......#...........#..............###
 5 ###.....#....#....#....#......#...#...#...#..............WS#
 6 ###...........................G...#...#...H.....#####....###
 7 ###...........................G...........H.....#####....###
 8 ##5...##.............##.......G...........H.....#####....###
 9 ###...##.............##.......#...#...#...#.....##K##....###
10 ###...........................#...#...#...#.#...........####
11 ###...........................#...........#.#...........####
12 ###...........................#...........#..............###
13 ##############...##################6#######..............###
14 ##############FFF###2#######C####################MMM########
15 ###...................................O...##X...........X###
16 ###.......................................##.............###
17 #SW...##.....##.....##.....##.....##......##..##.....##..###
18 ###.......................................##..##.....##..###
19 ###.......................................##.............###
20 ########EEE#################DDD#####3#######X.....Z......###
21 ########...#################...#############.............###
22 ###.................##................######.............###
23 ###.................##................######..##.....##..###
24 ###.................##................######..##.....##..###
25 ###...###########...##................######.............###
26 ###.................##.......P........######X...........X###
27 #SW.................##................###########TTT########
28 ###.................##...##.....##....######################
29 ###...###########...##...##.....##....######################
30 ###.................#Q................######################
31 ###.................##................WS####################
32 ##4.................##................######################
33 ###...###########...##...##.....##....######################
34 ###.................##...##.....##....######################
35 ###.................##................######################
36 ###..............B..##................######################
37 ######J#####W#############W######1##########################
38 ############S#############S#################################
39 ############################################################
```

Structure: a long **sterile corridor** (rows 15-19) with a line of glass tanks runs across the
middle; the labs hang off it. The start **decon lobby** is south of it, the **west labs** (three
long benches) south-west, the **containment cells** (open-front cells along the north wall,
specimen tanks) north-west, the **cryo vault** (four pods) north-centre and the **reactor room**
(5x4 core, coolant pipes) north-east. The arena (test chamber) sits south of the reactor, sealed
from the corridor by a 2-thick wall; its stairs are in the south wall. Zone graph is a tree:
Lobby -D-> Corridor -E-> West Labs; Corridor -F-> Containment -G-> Cryo -H-> Reactor -M-> Arena.
Doors in 2-thick walls sit in 1-tile vestibules (lobby (28-30,21), labs (8-10,21), containment
(14-16,13)) so every wall buy / machine faces a single zone.

| Zone | Door (letter, tiles) | Wall buys | Perk | Spawns | Cover / decor |
|------|----------------------|-----------|------|--------|---------------|
| Decon Lobby (start, rows 22-36, cols 22-37) | -- | `1` ICR-1 (33,37) | Q (21,30) | W (26,37), W (38,31) | 4 decon-shower blocks |
| Sterile Corridor (rows 15-19, cols 3-41) | D (28-30,20) h | `2` XR-2 (20,14), `3` HG 40 (36,20) | C (28,14) | W (2,17), O (38,15) | 5 glass tanks (row 17) |
| West Labs (rows 22-36, cols 3-19) | E (8-10,20) h | `4` Haymaker 12 (2,32), box (17,36) | J (6,37) | W (2,27), W (12,37) | 3 lab benches |
| Containment Cells (rows 3-12, cols 3-29) | F (14-16,14) h | `5` M8A7 (2,8) | N (20,2) | W (10,2), O (26,3) | 5 cells, 2 specimen tanks |
| Cryo Vault (rows 3-12, cols 31-41) | G (30,6-8) v | `6` Peacekeeper MK2 (35,13) | U (32,2) | W (36,2) | 4 cryo pods |
| Reactor Room (deepest, rows 3-13, cols 43-56) | H (42,6-8) v | `7` Gorgon (46,2), `8` Drakon (54,2) | K (50,9, on the core) | W (57,5) | reactor core (loop), 2 pipes |
| Arena (rows 15-26, cols 44-56, 13x12, 140 tiles) | M (49-51,14) h, from the reactor | -- | -- | Z (50,20), X (44,15) (56,15) (44,26) (56,26) (44,20); stairs T (49-51,27) h | 4 pillars |

Wall-buy map `{1: icr1, 2: xr2, 3: hg40, 4: haymaker12, 5: m8a7, 6: peacekeeper, 7: gorgon,
8: drakon}` (8 buys, all pairs >= 8 apart; start buy 15 from P). Cheaper guns early (ICR-1 150,
XR-2 225, Haymaker 12 250), tier-3 in the middle zones (HG 40 behind D, M8A7 behind F,
Peacekeeper behind G), Gorgon + Drakon behind H. Box behind D + E. Stairs 13 tiles from M.

Theme refined for a clinical look: floor `#5f6d66` / floorAlt `#67766e` (pale green-grey
checker), accent `#e6eee9` (white grout), wall `#1d2a38`, wallEdge `#5a7d9e` (steel blue),
doorWood `#3a4a5a`, doorIron `#2a3846`; ambient, `torch: false`, `flicker: true`, boss and
difficulty unchanged from the scaffold.

### Tests added (`tests/levels.test.js`)
- Parser knows `J Q C N U K` (own `PERK_LETTERS` table, independent of map.js); KNOWN_WEAPONS
  gains hg40 / m8a7 / peacekeeper.
- `validatePerks` on every level + the 3.4 named-zone plan per level id.
- Negative cases: missing machine, duplicate perk, Q/K swapped, machine 5 from a wall buy,
  machine in the arena wall, machine in a wall between two zones, named zones swapped.
- Lab: > 25 % of tiles differ from levels 1 and 2, tier-3 + Gorgon/Drakon on its walls,
  Gorgon + Drakon exactly the buys behind H, start buy not tier 3, tier-3 guns behind a door,
  >= 12 free-standing decor blocks; difficulty and theme (flicker, torch false, checker floor,
  boss) asserted.
- Verified with map.js (Agent G's parser): `loadMap` yields 6 `perkMachines` per level at the
  positions above. Full `npm test` 496/496 green at time of writing.

### Notes for others
- Render (C): level 3 has many small free-standing wall blocks (tanks, pods, benches) that
  should read as glass tanks; perk machine K on level 3 sits on the reactor core's south face.
- Level-1 perk tiles moved no WO4 gameplay tile (only walls became machines).

## WO8 (Agent C) — Pack-a-Punch machine `A` on every level

Files: `level1.js`, `level2.js`, `level3.js` (one tile each, a `#` became `A`; header comments
updated), `tests/levels.test.js`. Legend addition: `A` = Pack-a-Punch machine (map.js
`TILE_PAP = 11`, Agent B), a wall tile like a perk machine; `A` is never a wall-buy key (tested).

### Placement rules (WO8 1.1; `validatePap`, tested on every level in `LEVELS`)
- Exactly one `A`; its 4-neighbours are only `#` and floor, the floor all of **one zone**.
- That zone is the deepest normal zone: it borders the mega door `M` and first becomes reachable
  when H opens (door step 5); not the arena. Reachable with all doors open.
- > 2 tiles (Chebyshev) from every arena tile (same rule as the FIX-1 interactables; `A` was also
  added to that interactable list in `validateArena`).
- >= 6 tiles (Manhattan) from every wall buy and every perk machine.
- Positions pinned per level (`PAP_PLAN`); level-1 "edit confined to the arena/vault block" test
  turns `A` back into `#` as well.

| Level | Zone | `A` at | Stands on | Faces | Nearest buy / perk | Mega door |
|-------|------|--------|-----------|-------|--------------------|-----------|
| 1 BUNKER | vault (H) | (51,32) | NW corner of the vault's 3x2 pillar (51-53,32-33) | N (51,31), W (50,32) | ICR-1 (52,37) 6, Mule Kick (57,34) 8 | (53-55,28), 6 |
| 2 CATACOMBS | sanctum (H) | (38,31) | NE corner of the 2x2 altar (37-38,31-32) | N (38,30), E (39,31) | Gorgon (37,25) 7, Drakon (43,34) 8, Mule Kick (34,37) 10 | (43,27-29), 7 |
| 3 LABORATORY | reactor room (H) | (56,11) | east wall, inner corner | W (55,11), S (56,12) | Drakon (54,2) 11, Mule Kick (50,9) 8 | (49-51,14), 8 |

Distances are Manhattan unless noted. Nearest arena tile (Chebyshev): L1 5, L2 6, L3 4. Nearest
door-H tile: L1 4, L2 7, L3 17 — so the PaP prompt never competes with door H or `M` at the
64 px interact range.

Changed rows (column ruler as above):

```
      012345678901234567890123456789012345678901234567890123456789
L1 32 ###................G.......##.......##.........H...A##...###
L2 31 ###.....##......##......##......#....#A....#################
L3 11 ###...........................#...........#.#...........A###
```

### Tests added (`tests/levels.test.js`)
- Own parser knows `A` (`PAP_LETTER`, in `LEGEND`, `L.paps`), independent of map.js.
- `validatePap` on every level + the pinned positions.
- Negative cases: no machine, two machines, machine in the start zone (L1 hub), machine behind G
  (L1 armory), 2 tiles from a wall buy, 2 tiles from a perk machine, 2 tiles from the arena, in a
  wall between two zones (L2 chapel/crypts), buried in rock (faces no floor), `A` as a wall-buy key.
- Verified with Agent B's map.js: `loadMap(level).pap` = (51,32) / (38,31) / (56,11).
- `tests/levels.test.js` 22/22 green; full `npm test` 531/531 green at time of writing.

### Notes for others
- Render (D): L1 and L2 machines stand on free-standing blocks (vault pillar, sanctum altar), so
  they are visible from two sides; L3 is in a concave corner of the reactor room's east wall.
