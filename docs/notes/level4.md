# level4 notes — KINO (Agent A, WO9 1.2)

Files: `src/levels/level4.js` (`LEVEL4`, pure data, no imports), `tests/level4.test.js`.
An original top-down homage to the feel and flow of a haunted-theatre map (no real geometry, text
or art copied; generic room names). id `kino`, name `KINO`, boss THE PROJECTIONIST
(`#d9b25a`, `charge`), difficulty `{2.4, 1.22, 1.6, 7}` — all unchanged from the Phase 0 stub.

## WO9 layout

```
   012345678901234567890123456789012345678901234567890123456789
 0 ############################################################
 1 ########################6#########################K#########
 2 ##X............X#......................................O####
 3 ##..............M...................A...................####
 4 ##.........##...M.......................................####
 5 ##..###....##...M.......................................####
 6 #T.......Z......#...#################################...####
 7 #T..............#.......................................####
 8 #T........#.....#..################...################..####
 9 ##...##...#.....#.......................................####
10 ##...##...#.....#.......................................WS##
11 ##..............#..################...################..####
12 ##X.....X......X#.......................................####
13 #################.......................................7###
14 #################..################...################..####
15 ###..........#..#.......................................####
16 #SW.............#####...............................########
17 ###...####......#...#...............................#...####
18 ###..........#..#.......................................####
19 ########C#####..###################HHH######################
20 ###..........#..####.........................G......########
21 ###.............###5........###.....##.......G........######
22 ###...####......####.........................G...........U##
23 ###..........#..#########################J#W##...........###
24 ##############..###SW....................##S##...........###
25 ###B.........#..#####....................N####...........###
26 ###.............E........#####2######....#####...##......###
27 ###...####......E........................####4...........###
28 ###..........#..E........................#####...........WS#
29 #######3######..#############DDD##############...........###
30 ###..........#..#####....................#####...........###
31 #SW.............####......................####.......##..###
32 ###...####......###.........######.........###.......##..###
33 ###..........#..##..........######..........##...........###
34 ##############..#............................F..#........###
35 ###..........#..#.............P..............F..#........###
36 ###.............#............................F..........O###
37 #################Q####W################W####1#######8#######
38 ######################S################S####################
39 ############################################################
```

Flow: Lobby -D-> Foyer -E-> Dressing rooms; Lobby -F-> Alley -G-> (fire escape) Projection room
-H-> Theatre -M-> Backstage vault (arena). Tree, D..H is a legal opening order, every door adds
spawns, the box needs D + E.

| Zone | Door (tiles) | Wall buys | Perk | Spawns | Decor |
|------|--------------|-----------|------|--------|-------|
| Lobby (start, rows 30-36, cols 17-44) | -- | `1` KN-44 (19,31) | Q (30,33) | W (22,37), W (39,37) | ticket booth (28-33,32-33), two stepped staircases in the upper corners |
| Foyer (rows 24-28, cols 21-40 + vestibule 17-20) | D (29-31,29) h | `2` Marshal 16 (30,26) on the railing | N (41,25) | W (20,24) | balcony railing row 26 (ring around it) |
| Dressing rooms (cols 3-12 rooms, corridor 14-15, rows 15-36) | E (16,26-28) v | `3` Gorgon (7,29) | C (8,19) | W (2,16), W (2,31) | 5 rooms, costume racks; box B (3,25) |
| Alley (rows 20-36, cols 46-56) | F (45,34-36) v | `4` Drakon (45,27), `8` Man-O-War (52,37) | U (57,22) | W (57,28), O (56,36) | trash bins, stepped fire escape (52-56,20-21) |
| Projection room (rows 20-22, cols 20-44) | G (45,20-22) v | `5` M8A7 (19,21) | J (37,21) | W (43,23) | projector (28-30,21), reel cabinet (36-37,21) |
| Theatre (deepest, rows 2-18, cols 17-55) | H (35-37,19) h | `6` HG 40 (24,1), `7` Peacekeeper (56,13) | K (50,1) | W (56,10), O (55,2) stage door | stage rows 2-5, **A (36,3) centre-stage**, curtain line row 6 (20-52), seat rows 8/11/14 (19-34, 38-53), rear balcony boxes |
| Arena "Backstage vault" (rows 2-12, cols 2-15, 140 tiles) | M (16,3-5) v from the stage-left wing | -- | -- | Z (9,6), X (2,2) (15,2) (2,12) (15,12) (8,12); stairs T (1,6-8) | 4 clusters: flat (4-6,5), crates (11-12,4-5), crates (5-6,9-10), flat (10,8-10) |

Perk plan (door step): revive 0, dtap 1, speed 2, stamin 3, jugg 4, mule 5.

Deviation from 1.2 (forced by the frozen checker): Mule Kick, Pack-a-Punch and the mega door must
share the deepest zone (behind H), and Pack-a-Punch belongs centre-stage, so the **theatre is the
deepest zone (door H)** and the **projection room is behind G** (holding Juggernog, so every zone
keeps one perk). The projection room still sits above the back of the auditorium and H leads
from it down into the stalls. Mule Kick stands on the stage backdrop; the mega door opens from
the stage-left wing into the backstage vault.

Tile diff vs other levels: bunker 826, catacombs 907, lab 863, outpost 827, temple 863 (all > 600).
Free-standing decor blocks: 26.

## Theme

`style: 'kino'`, floor `#5a1218` / floorAlt `#6a1a20` (deep red carpet), wall `#2a1a10` (dark
wood), wallEdge `#b8913e` + accent `#d9b25a` (gold trim / diamonds), doors `#4a2a18` / `#3a2616`,
ambient `rgba(255,196,120,0.045)`, `torch: true`, `flicker: false`. Optional hints for render (F),
dropped by `loopTheme`: `curtain` `#8a1020`, `seat` `#3e0a10`, `lamp` `#ffd9a0`, `grain` 0.035,
`stageRows [2,5]`, `curtainRow 6`, `seatRows [8,11,14]`.

## Tests (`tests/level4.test.js`, 11)
Full `validateLevel`/`assertValidLevel` with `{ wo9Guns, perkPlan, papPos: [36,3] }`; pinned
meta; A centre-stage (stage row, centred, surrounded by stage floor of the theatre zone, behind
H; M in the stage-left wall); curtain row shape; three seat rows with two >= 12-seat sections,
side + centre aisles and fully open 2-tile cross aisles; zone flow by door step, box behind
D+E, lobby exits exactly D and F; gun set / start gun / tier 3 deep / >= 8 apart; spawns per
zone; > 25 % different from every other level; theme colours; purity.

## Browser check (port 8301)
`setLevel(3)`, `openAllDoors`, teleport: lobby (booth, stepped stairs, foyer ring above), the
auditorium (seat rows read as long rows with a clear centre aisle and cross aisles) and the stage
(Pack-a-Punch centre-stage, HG 40 and Mule Kick on the backdrop) all read clearly with the
current (pre-F) renderer; dressing rooms read as rooms off a corridor. No console errors.
Observation for F: the generic torch finder puts lamps on every seat row, which looks busy in the
auditorium — consider skipping torches on `seatRows` / free-standing blocks for `kino`.

## WO9 FIX-1 (QA docs/qa/wo9-kino.md #1, #2, #3)
- **#1 Juggernog sequence break:** J moved from (41,23) (the foyer wall, diagonal to the foyer
  floor (40,24), buyable from the foyer with only D open) to (37,21) on the reel cabinet in the
  projection room: 94 px from the foyer and theatre floors.
- **#3 HUD corners:** Quick Revive (17,37) -> (30,33), the ticket booth's south face above the
  start. KN-44 (44,37) -> (19,31), the west staircase face, not the QA-suggested (20,30): that
  spot is 54 px from the foyer floor on row 28 across one wall row and fails the new
  interact-reach check. (19,31) has two wall rows to the foyer (94 px) and three columns to the
  dressing corridor. It is 15 tiles from P and at least 13 from every other wall buy.
- **#2 room floors (data only):** `theme.floorZones` = inclusive tile rects `{ x0, y0, x1, y1, floor }`:
  boards (3,15)-(15,36) for the dressing rooms and corridor, asphalt (46,20)-(56,36) for the alley,
  concrete (2,2)-(15,12) for the backstage vault arena. Each rect is exactly its zone's bounding
  box and holds no other zone's floor (pinned in tests/level4.test.js). FIX-2 paints them in
  render.js; FIX-3 copies the key in loopTheme.
- **levelcheck:** `checkInteractReach` was added to `tests/helpers/levelcheck.js` and runs in
  `validateLevel` for every level. Every wall buy, perk machine, Pack-a-Punch and the box must face
  exactly one zone. It must also be more than `PLAYER.interactRange` (64 px) from the player
  centre on any floor tile of another zone. The player centre is anywhere in the tile, inset by
  `PLAYER.radius` on sides that block movement, so diagonal and corner reach counts. tests/level4
  pins that the old Juggernog spot and the (20,30) KN-44 spot both fail the check.
- **Levels 1-3 edits made by the new check** (documented in each file's header): L2 XR-2
  (10,10) -> (2,11). L3 Peacekeeper (35,13) -> (38,2), XR-2 (20,14) -> (2,16), Speed Cola
  (28,14) -> (27,17), HG 40 (36,20) -> (35,17), Quick Revive (21,30) -> (38,24). All of these sat
  in 2-thick walls and were buyable at 54 px from the next zone.
