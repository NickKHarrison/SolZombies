// levels/level5.js — level 5 "OUTPOST" data (pure, no imports). WO9 1.3 (arctic research outpost).
// Agent B (WO9 Phase 1): a WIDE OPEN snowfield, unlike the corridor maps of levels 1-4. Six big
// outdoor zones split by chain-link fences / rock ridges (single '#' lines) and ice holes '~'
// (map.js TILE_PIT: blocks movers, not bullets or sight), gates D-H as doors, small scattered
// buildings (barracks huts with doorways, a shed, fuel tanks, a radar dish, a greenhouse dome,
// the command bunker). Ice-hole fence segments give sight-lines into the next zone before its
// gate is bought. Validated by tests/helpers/levelcheck.js in tests/level5.test.js.
// This file must NOT import anything (map.js imports the level registry; avoid a load-time cycle).
//
// Zones (door order D..H):  Landing pad (start, S)  -D->  Barracks huts (SW)  -E->  Radar array (NW)
//   Landing pad -F-> Fuel depot (centre) -G-> Greenhouse dome (N) -H-> Command bunker (NE, deepest)
//   Command bunker -M-> arena "Ice cavern" (SE) with 4 ice columns, 2 ice holes, Z, 5 X, stairs T.
// WO9 FIX-1 (QA wo9-outpost #1/#2/#4 + levelcheck checkInteractReach):
//   - arena ice holes (54-56,27) and (44-46,33) now touch the wall, closing the 1-tile lanes the
//     boss wedged in;
//   - M8A7 moved from the west wall (2,14) to the dish plinth's south face (9,9), clear of the HUD;
//   - the barracks window/pocket moved from (2,25)/(1,25) to the south border (14,37)/(14,38);
//   - Double Tap moved from (42,16) (a 2-thick wall, buyable from the command strip at x44) to the
//     free-standing post (38,18) in the fuel depot;
//   - the box moved from (20,4) (buyable from the greenhouse at x22) to the radar's north wall (18,2).

export const LEVEL5 = {
  id: 'outpost',
  name: 'OUTPOST',
  ascii: [
    '############################################################', //  0
    '######S#################S###################################', //  1
    '######W#####U#####B#####W###############6###############7###', //  2
    '###..................#.....................#.............###', //  3
    '###.#..........##...##.......#######.......~.............###', //  4
    '###............##....~......##.....##......~.............###', //  5
    '###.....###..........~.....##.......##.....#.............WS#', //  6
    '###....#####.........~.....................H.............###', //  7
    '###....#####.........~.....##.......##.....H.............###', //  8
    '####....#4#......#...~......##.....##......H.............###', //  9
    '###..................#.......###J###.......#..#########..###', // 10
    '###......#...~~~~~...#.....................~..####A####..###', // 11
    '###......#...~~~~~...#.....................~..#.......#..###', // 12
    '###..........~~~~~...###~~~~~~~~#GGG#~~~~###..#.......#..###', // 13
    '###..................#....................##..#..........###', // 14
    '###................O.#..###..###..#8#.....##..#.......#..###', // 15
    '###..................#..###..#S#..###.....##..##K######..###', // 16
    '###..................#..#5#..#W#..###.....##..#########..###', // 17
    '#####~~~~#EEE#~~~~####................N...##.............###', // 18
    '###..................#....................##.............###', // 19
    '###.#####..#####.....#....................##.............###', // 20
    '###.#...#..#...#.....#...................O##.............###', // 21
    '###.#..........#.....#....................##.............###', // 22
    '###.#####..#2###.....####~~~~#FFF#~~~~~#####.............###', // 23
    '###..................#....................#######MMM########', // 24
    '###..................#.#................#.##X...........X###', // 25
    '###..................#....................##.............###', // 26
    '###..#####...........~....................##..........~~~###', // 27
    '###..#...#...........~....................##...##...##...###', // 28
    '###..#...............D.........P..........##...##...##...###', // 29
    '###..##C##...........D....................##X.....Z......###', // 30
    '###..................D....................##.............###', // 31
    '###............###...~....................##...##...##...###', // 32
    '###............#S#...~....................##~~~##...##...###', // 33
    '###............#W#...#..~~................##.............###', // 34
    '###..................#....................##.............###', // 35
    '###..................#....................##X...........X###', // 36
    '########3#####W#########W###1#######Q##W#########TTT########', // 37
    '##############S#########S##############S####################', // 38
    '############################################################', // 39
  ],
  // ASCII letter -> weapon id. A cheap KN-44 on the landing pad; tier-3 guns (HG 40, M8A7,
  // Peacekeeper) and tier-2 (Marshal 16, Man-o-War, Drakon, Gorgon) behind the gates.
  wallbuys: {
    '1': 'kn44',         // landing pad (start), south perimeter wall
    '2': 'hg40',         // barracks (D), hut B south wall
    '3': 'marshal16',    // barracks (D), south perimeter wall
    '4': 'm8a7',         // radar array (E), south face of the dish plinth (9,9) (WO9 FIX-1: off the HUD)
    '5': 'manowar',      // fuel depot (F), tank 1
    '8': 'drakon',       // fuel depot (F), tank 3
    '6': 'peacekeeper',  // greenhouse (G), north perimeter wall
    '7': 'gorgon',       // command bunker (H), north perimeter wall
  },
  // WO9 1.3: white-blue snow with drift speckles, grey-blue rock ridges, wooden huts, orange hazard
  // fences, snowfall overlay (render: `snow`), cold blue ambient; no torches, no flicker.
  theme: {
    name: 'OUTPOST', style: 'outpost',
    floor: '#e3ecf4', floorAlt: '#d2e0ec', wall: '#5b6a7c', wallEdge: '#a8bccf',
    accent: '#ff7a1a',    // hazard orange (fences, gates, markings)
    doorWood: '#7a5636', doorIron: '#56687a',
    ambient: 'rgba(140,190,255,0.10)',
    torch: false,
    flicker: false,
    snow: true,           // WO9: snowfall overlay (render, reduced motion -> static flakes)
    ice: '#8cc4e8',       // WO9 hint: ice-hole '~' surface
    iceDeep: '#2f6f9e',   // WO9 hint: ice-hole depth / rim shadow
    hutWood: '#6e5238',   // WO9 hint: wooden hut walls
  },
  boss: { name: 'THE WENDIGO', tint: '#bfe8ff', ability: 'frost' },
  // WO9 1.1 base difficulty (above level 4).
  difficulty: { healthMult: 2.9, speedMult: 1.24, countMult: 1.7, sprintShift: 9 },
};
