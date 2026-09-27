// levels/level4.js — level 4 "KINO" data (pure, no imports). WO9 1.2 (Agent A).
// An original top-down homage to the feel and flow of a haunted-theatre map: no real map geometry,
// text or art is copied; rooms have generic names. Legend as levels 1-3 (see docs/notes/levels.md).
// Zones (tree, one door each, D..H is a valid opening order):
//   Lobby (start, rows 30-36, cols 17-44): central ticket booth (decor block, Quick Revive on its
//     south face), two stepped grand staircases in the upper corners (KN-44 on the west one's
//     face), 2 windows. Two doors out (D, F).
//   D (lobby north wall, centre) -> Foyer (rows 24-28, cols 17-40): the upper-lobby ring round a
//     long balcony railing (Marshal 16 hangs on it), Double Tap, 1 window, west vestibule to E.
//   E (foyer vestibule, west) -> Dressing rooms (cols 3-15, rows 15-36): five small rooms with
//     costume racks off a narrow 2-wide backstage corridor; Speed Cola, Gorgon, the mystery box,
//     2 windows.
//   F (lobby east wall) -> Alley (rows 20-36, cols 46-56): outdoor strip behind the theatre with
//     trash bins and a stepped fire escape; Drakon, Man-O-War, Stamin-Up, 1 window + 1 open spawn.
//   G (alley west wall, top: the fire escape) -> Projection room (rows 20-22, cols 20-44): narrow
//     booth above the back of the auditorium, film projector + reel cabinet (decor; Juggernog on
//     the cabinet, WO9 FIX-1: it was in the foyer wall and could be bought from the foyer), M8A7,
//     1 window.
//   H (projection room north wall) -> Theatre (deepest, rows 2-18, cols 17-55): stage rows 2-5
//     with Pack-a-Punch centre-stage (36,3), curtain line row 6 (steps up at both ends), three seat
//     rows (8, 11, 14) with 2-tile cross aisles and side/centre aisles, rear balcony boxes; HG 40,
//     Peacekeeper, Mule Kick, 1 window + 1 open spawn (stage door). The mega door M (stage-left
//     wing, west wall) leads to the arena.
//   Arena "Backstage vault" (rows 2-12, cols 2-15): stacked scenery flats and prop crates (4 pillar
//     clusters), Z, 5 X, stairs T in the west wall.
// Juggernog sits in the projection room and Mule Kick in the theatre because the checker pins
// Mule Kick, Pack-a-Punch and the mega door to the same deepest zone (behind H), and Pack-a-Punch
// belongs on the stage. Validated by tests/level4.test.js via tests/helpers/levelcheck.js.
// This file must NOT import anything (map.js imports the level registry; avoid a load-time cycle).

export const LEVEL4 = {
  id: 'kino',
  name: 'KINO',
  ascii: [
    '############################################################', //  0
    '########################6#########################K#########', //  1
    '##X............X#......................................O####', //  2
    '##..............M...................A...................####', //  3
    '##.........##...M.......................................####', //  4
    '##..###....##...M.......................................####', //  5
    '#T.......Z......#...#################################...####', //  6
    '#T..............#.......................................####', //  7
    '#T........#.....#..################...################..####', //  8
    '##...##...#.....#.......................................####', //  9
    '##...##...#.....#.......................................WS##', // 10
    '##..............#..################...################..####', // 11
    '##X.....X......X#.......................................####', // 12
    '#################.......................................7###', // 13
    '#################..################...################..####', // 14
    '###..........#..#.......................................####', // 15
    '#SW.............#####...............................########', // 16
    '###...####......#...#...............................#...####', // 17
    '###..........#..#.......................................####', // 18
    '########C#####..###################HHH######################', // 19
    '###..........#..####.........................G......########', // 20
    '###.............###5........###.....#J.......G........######', // 21
    '###...####......####.........................G...........U##', // 22
    '###..........#..###########################W##...........###', // 23
    '##############..###SW....................##S##...........###', // 24
    '###B.........#..#####....................N####...........###', // 25
    '###.............E........#####2######....#####...##......###', // 26
    '###...####......E........................####4...........###', // 27
    '###..........#..E........................#####...........WS#', // 28
    '#######3######..#############DDD##############...........###', // 29
    '###..........#..#####....................#####...........###', // 30
    '#SW.............###1......................####.......##..###', // 31
    '###...####......###.........######.........###.......##..###', // 32
    '###..........#..##..........##Q###..........##...........###', // 33
    '##############..#............................F..#........###', // 34
    '###..........#..#.............P..............F..#........###', // 35
    '###.............#............................F..........O###', // 36
    '######################W################W############8#######', // 37
    '######################S################S####################', // 38
    '############################################################', // 39
  ],
  // ASCII letter -> weapon id. A cheap KN-44 in the lobby; tier 2 in the middle zones; the WO7
  // tier-3 guns behind doors (M8A7 in the projection room, HG 40 + Peacekeeper in the theatre).
  wallbuys: {
    '1': 'kn44',         // lobby (start), west staircase face (19,31) (WO9 FIX-1: off the HUD corner)
    '2': 'marshal16',    // foyer (D), on the balcony railing
    '3': 'gorgon',       // dressing rooms (E), between rooms 3 and 4
    '4': 'drakon',       // alley (F), west wall
    '5': 'm8a7',         // projection room (G), west end
    '6': 'hg40',         // theatre (H), stage backdrop, stage left
    '7': 'peacekeeper',  // theatre (H), east wall
    '8': 'manowar',      // alley (F), south wall
  },
  // WO9 1.2 look: deep red carpet (render adds the gold diamond pattern), dark wood-panelled walls
  // with gold trim, warm amber-white lamp glows (torches), no flicker, subtle warm ambient.
  // Extra keys are optional hints for the 'kino' render style (loopTheme drops them).
  theme: {
    name: 'KINO', style: 'kino',
    floor: '#5a1218', floorAlt: '#6a1a20', wall: '#2a1a10', wallEdge: '#b8913e',
    accent: '#d9b25a',    // gold trim / diamond pattern
    doorWood: '#4a2a18', doorIron: '#3a2616',
    ambient: 'rgba(255,196,120,0.045)',
    torch: true,          // warm lamp-light glows
    flicker: false,
    curtain: '#8a1020',   // red velvet (stage edge, row 6)
    seat: '#3e0a10',      // dark red seat backs (seat rows 8, 11, 14)
    lamp: '#ffd9a0',      // amber-white lamp glow
    grain: 0.035,         // faint static film grain alpha
    stageRows: [2, 5], curtainRow: 6, seatRows: [8, 11, 14],
    // WO9 FIX-1 (QA wo9-kino #2): per-room floor hints, inclusive tile rects (each is exactly the
    // bounding box of its zone and holds no other zone's floor). render.js paints them over the
    // carpet on floor tiles; loopTheme copies the key verbatim.
    floorZones: [
      { x0: 3, y0: 15, x1: 15, y1: 36, floor: 'boards' },    // dressing rooms + backstage corridor
      { x0: 46, y0: 20, x1: 56, y1: 36, floor: 'asphalt' },  // alley (outdoor)
      { x0: 2, y0: 2, x1: 15, y1: 12, floor: 'concrete' },   // arena "Backstage vault"
    ],
  },
  boss: { name: 'THE PROJECTIONIST', tint: '#d9b25a', ability: 'charge' },
  // WO9 1.1 base difficulty (above level 3).
  difficulty: { healthMult: 2.4, speedMult: 1.22, countMult: 1.6, sprintShift: 7 },
};
