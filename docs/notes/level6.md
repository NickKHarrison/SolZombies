# level6 notes — TEMPLE (WO9 Agent C)

Files: `src/levels/level6.js` (`LEVEL6`), `tests/level6.test.js`. `id`/`name`/`boss`/`difficulty`
unchanged from the Phase 0 stub (THE DROWNED KING, `tide`; `{3.5, 1.26, 1.8, 11}`).

## WO9 — layout

A left/right-symmetric ring-and-cross ruin (mirror axis between cols 29 and 30; tile-class
symmetry score 1.00 — only letter identities differ: E/F, perks, gun keys, P, Z, B/J, K/A, Q/KN-44).
`~` = water channel (map.js `TILE_PIT`): blocks the player, zombies and pathfinding, not bullets
or sight. 176 water tiles.

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 #########K###################TT###################A#########
 2 ###.............#####X................X#####.............###
 3 ###.............#####..................#####.............###
 4 ###...#.....#...#####...##..~~~~..##...#####...#.....#...###
 5 ###.............#####...##..~~~~..##...#####.............###
 6 #SW.....###.....#####~~..............~~#####.....###.....WS#
 7 ###.....###.....#####~~......Z.......~~#####.....###.....###
 8 ###.....###.....#####...##........##...#####.....###.....###
 9 ###.............#####...##........##...#####.............###
10 ###...#.....#...#####..................#####...#.....#...###
11 ##8.............#####X................X#####.............9##
12 ###.............#############MM#############.............###
13 ###......................................................###
14 ###......................................................###
15 #############################HH#############################
16 #######C#######.....~~~~~~~~~..~~~~~~~~~.....#######U#######
17 ###.........##N.....~~~~~~~~~..~~~~~~~~~.....###.........###
18 ###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###
19 ###..#...#..###.....~~~~O..........O~~~~.....###..#...#..###
20 ###..........E......~~~~....####....~~~~......F..........###
21 ###..........E......~~~~....J##B....~~~~......F..........###
22 ##4..#...#..###~~..~~~~~....####....~~~~~..~~###..#...#..6##
23 ###.........###~~..~~~~~............~~~~~..~~###.........###
24 ###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###
25 ###..#...#..##2.....~~~~~~~~~GG~~~~~~~~~.....3##..#...#..###
26 ###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###
27 ###.........###..............................###.........###
28 ###..#...#..###..............................###..#...#..###
29 ###.........###..............................###.........###
30 #SW.........####W############DD############W####.........WS#
31 ###..#...#..####S###....................###S####..#...#..###
32 ###.........########....................########.........###
33 ###.........#######Q...##..........##...1#######.........###
34 ###..#...#..########...##....P.....##...########..#...#..###
35 ###.........########....................########.........###
36 ###.........########....................########.........###
37 #######5###############W############W###############7#######
38 #######################S############S#######################
39 ############################################################
```

Flow: Outer gate (south) -D-> Sunken courtyard: a U of terraces round the pool; the side terraces
are only reachable over 2-wide bridges across canals (rows 22-23), the island in the pool is the
Idol hall (door G on the south bridge), and the north bridge crosses the pool to door H and the
Inner sanctum (two wings joined by a processional walk under the arena). The mega door M sits
centred in the arena's south wall; stairs T in its north wall (11 tiles from M).

| Zone | Door (letter, tiles) | Wall buys | Perks / other | Spawns |
|------|----------------------|-----------|---------------|--------|
| Outer gate (start, rows 31-36) | -- | `1` KN-44 (40,33) | Q revive (19,33); 2 guardian statues | W (23,37), W (36,37) |
| Sunken courtyard (terraces rows 16-29) | D (29-30,30) h | `2` Peacekeeper (14,25), `3` Man-O-War (45,25) | N dtap (14,17); canal bridges (17-18 / 41-42, 22-23) | W (16,30), W (43,30) |
| West cloister (colonnade, cols 3-11) | E (13,20-21) v | `4` HG 40 (2,22), `5` Haymaker 12 (7,37) | C speed (2,28); 12 pillars | W (2,30) |
| East cloister (mirror) | F (46,20-21) v | `6` M8A7 (57,22), `7` Marshal 16 (52,37) | U stamin (57,28); 12 pillars | W (57,30) |
| Idol hall (island, rows 19-23) | G (29-30,25) h, on the south bridge, capped by water | -- | J jugg (28,21) and box B (31,21) on the idol | O (24,19), O (35,19) |
| Inner sanctum (deepest) | H (29-30,15) h, end of the north bridge | `8` Gorgon (2,11), `9` Drakon (57,11) | K mule (9,1), Pack-a-Punch A (50,1); altars + pillars | W (2,6), W (57,6) |
| Arena "Flooded pit" (cols 21-38, rows 2-11, 152 floor tiles) | M (29-30,12) h | -- | Z (29,7), X x4 corners, 4 pillars, central pool + 2 one-tile side inlets (21,6-7) / (38,6-7) | stairs T (29-30,1) |

Perk plan `{ revive: 0, dtap: 1, speed: 2, stamin: 3, jugg: 4, mule: 5 }`, PaP `[50, 1]`. Box
behind D + G. Tier-3 guns all behind a door; the gate sells the cheap KN-44.

Chokepoints: the four bridges (west/east canal, south G, north H) are all 2 tiles wide with water
on both sides; blocking any of them cuts off >= 40 tiles (tested). Sight-lines: row 17 is 30 tiles
of terrace/water/bridge without a wall (west terrace to east terrace); the island is visible and
shootable from every terrace.

## Theme

`style: 'temple'`, floor `#4a5646` / floorAlt `#55614c` (mossy green-grey flagstones), wall
`#9a8356` / wallEdge `#d1b775` (carved sandstone), accent `#b9d15a` (gold-green glyph glow),
doorWood `#4a3a22`, doorIron `#4d5a3c`, ambient `rgba(170,210,110,0.07)`, torch/flicker false.
Hints for render (F): `water: true` (animated water on `~`), `waterDeep #123f3a`,
`waterLight #3fd6a8`, `moss #6f8a3e`, `vine #3f6b2a`, `glyph #e0c872`, `spores: true`.

## Tests (`tests/level6.test.js`, 9 tests)

Full suite via `assertValidLevel(LEVEL6, { wo9Guns, perkPlan, papPos })`; pinned meta + theme
(green floor, warm wall, water/spores); symmetry >= 0.99 with mirrored doors/windows/pockets/O;
water >= 150 tiles, >= 8 inside the arena, none next to a window/pocket; bridges <= 2 wide,
water-flanked, chokepoints; G/H on bridges; sight-lines over water + (guarded on
`map.TILE_PIT`) map.js load: pit not walkable for either mover, a ray crosses the pool; spawn /
gun / box / M / T / X placement; >= 30 free-standing blocks; > 25 % different from every level
(diffs: bunker 957, catacombs 952, lab 1036, kino 973, outpost 902 of 2400).

## Browser check (port 8303)

`setLevel(5)` + `openAllDoors`: TEMPLE loads with no console errors (map.js TILE_PIT present);
the player is stopped at the island edge by the water; mega door + arena + THE DROWNED KING spawn
fine. At check time render.js had no pit/temple styling yet (water drew as plain floor), so the
look is pending Agent F.

## WO9 FIX-1 (QA docs/qa/wo9-temple.md #1 + interact-reach check)
- **#1 boss wedge:** rows 6 and 7 are now exactly as in the QA report. The side inlets are 1 tile
  wide ((21,6-7) and (38,6-7)), so the lanes between the pillars and the inlets are 2 tiles
  (80 px). Water goes from 176 to 172 tiles, arena water from 16 to 12, and the arena from 148 to
  152 tiles. Symmetry is kept. Pinned in tests/level6.test.js.
- **New levelcheck `checkInteractReach`** (see level4.md): Speed Cola (7,16) and Stamin-Up (52,16)
  sat in the 2-thick cloister north walls, 54 px from the sanctum walk (row 14). They moved to the
  cloisters' outer walls, (2,28) and (57,28), which are mirrored. Each is 6 tiles from HG 40 /
  M8A7 and in the same zone and step.
