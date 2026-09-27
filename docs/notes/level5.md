# level5 notes — OUTPOST (WO9, Agent B)

Files: `src/levels/level5.js` (`LEVEL5`), `tests/level5.test.js`. Pure data, no imports.
`id`, `name`, `boss` (THE WENDIGO, `#bfe8ff`, `frost`) and `difficulty` `{2.9, 1.24, 1.7, 9}` are
unchanged from the Phase 0 scaffold.

## WO9 — layout

A **wide open snowfield**, unlike the corridor maps of levels 1-4. The six zones are large
outdoor fields split by single-tile fence lines / rock ridges (`#`) and **ice holes `~`**
(`TILE_PIT`: blocks movers, not bullets or sight). The gates D-H sit in those fence lines, and
most of them are flanked by ice holes, so you can see (and shoot) into the next zone before you
buy its gate. There are small buildings scattered across the snow: barracks huts with doorways,
a storage shed, fuel tanks, a radar dish plinth, a greenhouse dome and the command bunker.

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 ######S#################S###################################
 2 ######W#####U###########W###############6###############7###
 3 ###..................#.....................#.............###
 4 ###.#..........##...B#.......#######.......~.............###
 5 ###............##....~......##.....##......~.............###
 6 ###.....###..........~.....##.......##.....#.............WS#
 7 ###....#####.........~.....................H.............###
 8 ###....#####.........~.....##.......##.....H.............###
 9 ####....###......#...~......##.....##......H.............###
10 ###..................#.......###J###.......#..#########..###
11 ###......#...~~~~~...#.....................~..####A####..###
12 ###......#...~~~~~...#.....................~..#.......#..###
13 ###..........~~~~~...###~~~~~~~~#GGG#~~~~###..#.......#..###
14 ##4..................#....................##..#..........###
15 ###................O.#..###..###..#8#.....##..#.......#..###
16 ###..................#..###..#S#..###.....N#..##K######..###
17 ###..................#..#5#..#W#..###.....##..#########..###
18 #####~~~~#EEE#~~~~####................#...##.............###
19 ###..................#....................##.............###
20 ###.#####..#####.....#....................##.............###
21 ###.#...#..#...#.....#...................O##.............###
22 ###.#..........#.....#....................##.............###
23 ###.#####..#2###.....####~~~~#FFF#~~~~~#####.............###
24 ###..................#....................#######MMM########
25 #SW..................#.#................#.##X...........X###
26 ###..................#....................##.............###
27 ###..#####...........~....................##..........~~.###
28 ###..#...#...........~....................##...##...##...###
29 ###..#...............D.........P..........##...##...##...###
30 ###..##C##...........D....................##X.....Z......###
31 ###..................D....................##.............###
32 ###............###...~....................##...##...##...###
33 ###............#S#...~....................##.~~##...##...###
34 ###............#W#...#..~~................##.............###
35 ###..................#....................##.............###
36 ###..................#....................##X...........X###
37 ########3###############W###1#######Q##W#########TTT########
38 ########################S##############S####################
39 ############################################################
```

| # | Zone | Opened by | Area | Features | Spawns | Guns | Perks / other |
|---|------|-----------|------|----------|--------|------|---------------|
| 0 | Landing pad (start) | - | x22-41, y24-36 | wide open pad, 2 marker posts, ice hole | W (24,37), W (39,37) | `1` KN-44 (28,37) | Q Quick Revive (36,37) |
| 1 | Barracks huts | D (21,29-31), pad west fence between ice holes | x3-20, y19-36 | 3 huts with doorways, storage shed (pocket inside) | W (14,37), shed W (16,34) | `2` HG 40 (12,23), `3` Marshal 16 (8,37) | C Speed Cola (7,30) |
| 2 | Radar array | E (10-12,18), rock ridge with frozen ditches | x3-20, y3-17 | dish plinth, small dish, mast, antenna posts, frozen pond | W (6,2), O (19,15) | `4` M8A7 (9,9) | U Stamin-Up (12,2), box B (18,2) |
| 3 | Fuel depot | F (30-32,23), pad north fence between ice holes | x22-41, y14-22 | 3 fuel tanks (tank 2 holds a pocket) | tank W (30,17), O (41,21) | `5` Man-o-War (25,17), `8` Drakon (35,15) | N Double Tap (38,18) |
| 4 | Greenhouse dome | G (33-35,13), frozen stream | x22-42, y3-12 | octagonal dome with E/W doorways | W (24,2) | `6` Peacekeeper (40,2) | J Juggernog (32,10) |
| 5 | Command bunker (deepest) | H (43,7-9), fence between ice holes | x44-56, y3-23 | bunker building (entrance east side), snow yard | W (57,6) | `7` Gorgon (56,2) | K Mule Kick (48,16), **A Pack-a-Punch (50,11)**, M (49-51,24) |
| - | Arena "Ice cavern" | M | x44-56, y25-36 | 4 ice columns (2x2), 2 ice holes | - | - | Z (50,30), 5 X, stairs T (49-51,37) |

Door tree: Landing -D-> Barracks -E-> Radar; Landing -F-> Fuel -G-> Greenhouse -H-> Command -M-> arena.
Perk plan (`openingStep`): `{ revive: 0, speed: 1, stamin: 2, dtap: 3, jugg: 4, mule: 5 }`, PaP at `[50, 11]`.
Spawns in D..H order: 2 -> 4 -> 6 -> 8 -> 9 -> 10.

Ice-hole sight lines across zone boundaries: Radar|Greenhouse (x21, y5-9), Radar|Barracks (y18),
Barracks|Landing (x21 around D), Landing|Fuel (y23 around F), Fuel|Greenhouse (y13 stream),
Greenhouse|Command (x43 around H). Ice holes inside a zone: the radar frozen pond (13-17, 11-13)
and the pad hole (24-25, 34). In the arena: (45-46, 33) and (54-55, 27).

## Theme

`style: 'outpost'`, snow floor `#e3ecf4` / `#d2e0ec`, grey-blue rock `#5b6a7c` / edge `#a8bccf`,
hazard-orange accent `#ff7a1a`, wooden gate `#7a5636`, iron `#56687a`, ambient
`rgba(140,190,255,0.10)`, `torch: false`, `flicker: false`, **`snow: true`** (snowfall overlay).
Optional render hints (free-form, F may use or ignore them): `ice: '#8cc4e8'`,
`iceDeep: '#2f6f9e'`, `hutWood: '#6e5238'`.

## Tests (`tests/level5.test.js`)

- The full `validateLevel` / `assertValidLevel` suite with `wo9Guns`, the perk plan and the PaP position.
- Openness: at least 100 floor tiles with no wall/door/etc. within 3 tiles (7x7 clear; about 112
  here, compared with 15/0/8 on levels 1-3), at least 3x any of levels 1-3, at least 250 5x5-clear
  tiles, at least 1400 walkable tiles, at least 20 free-standing blocks.
- Ice holes: at least 40 `~`; sight lines over `~` between at least 6 distinct zone pairs; at least 4
  free-standing ice-hole tiles inside zones.
- map.js (guarded on `TILE_PIT`): `loadMap(LEVEL5)`; each cross-zone pit is `TILE_PIT`, not
  walkable for the player or zombies, and `raycastWalls` passes across it.
- Gate positions pinned, gates in ice-hole fence lines, box behind D+E, 2 pockets inside buildings.
- Every wall buy, perk machine and the PaP faces exactly one zone, so nothing can be bought
  through a fence.
- Gun mix: KN-44 at the start, tier-3 plus Gorgon/Drakon/Man-o-War/Marshal behind gates, Gorgon behind H.
- Arena columns and ice holes, the >25 % difference from every level, theme colours, and a purity check.

## Browser check (port 8302)

`?debug=1`, `setLevel(4)`, `openAllDoors`: OUTPOST loaded with no console errors. The snow floor
reads as one open field, the huts, tanks, dome, bunker, Pack-a-Punch, Mule Kick and mega door are
all in place. At the time of the check the ice holes still drew almost like floor (they had no
outpost pit style yet), so Agent F's pit rendering is needed to make them readable.

## WO9 FIX-1 (QA docs/qa/wo9-outpost.md #1, #2, #4 + interact-reach check)
- **#1 boss wedge:** the arena ice holes now touch the walls. Row 27 changed `~~.###` -> `~~~###`
  ((56,27) is ice) and row 33 changed `##.~~##` -> `##~~~##` ((44,33) is ice). The 1-tile lanes
  at x56 and x44 are gone, and the pinned pits (45,33) and (54,27) are unchanged. tests/level5
  pins that no arena floor tile is a 1-tile lane beside an ice hole.
- **#2:** M8A7 moved from (2,14) (under the HUD's left column) to (9,9), the south face of the
  dish plinth. It still faces only the radar zone.
- **#4:** the barracks window and pocket moved from (2,25)/(1,25) to (14,37)/(14,38), in the south
  border, facing barracks floor (14,36).
- **New levelcheck `checkInteractReach`** (see level4.md):
  - Double Tap moved from (42,16) to the free-standing post (38,18) in the fuel depot. At (42,16)
    it sat in a 2-thick wall, 54 px from the command strip floor at x44.
  - The box moved from (20,4) to the radar's north wall (18,2). At (20,4) it was 54 px from the
    greenhouse floor at x22.
