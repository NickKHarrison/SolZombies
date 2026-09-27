// levels/level6.js — level 6 "TEMPLE" data (pure, no imports). WO9 1.4 (sunken jungle temple).
// Layout (Agent C, WO9): a left/right-symmetric ring-and-cross ruin around a flooded courtyard.
// Outer gate (start, south) -D-> Sunken courtyard (U of terraces round a pool; the side terraces
// hang on 2-wide bridges over canals) -E-> West cloister / -F-> East cloister (colonnades),
// courtyard -G (on the south bridge)-> Idol hall (the island in the pool) -H (north bridge)->
// Inner sanctum (two wings + processional walk, deepest: Mule Kick + Pack-a-Punch) -M-> arena
// "Flooded pit" (4 pillars, a sunken pool and two 1-tile side inlets (WO9 FIX-1: 2-wide lanes
// round the pillars so the boss cannot wedge); stairs T in its north wall).
// '~' = water channel (map.js TILE_PIT): blocks movers, not bullets or sight -> long sight-lines
// across the pool, chokepoints on the bridges. See docs/notes/level6.md.
// WO9 FIX-1: Speed Cola (7,16) / Stamin-Up (52,16) sat in the 2-thick cloister north walls and were
// buyable from the sanctum walk (row 14); moved to the cloisters' outer walls (2,28) / (57,28).
// This file must NOT import anything (map.js imports the level registry; avoid a load-time cycle).

export const LEVEL6 = {
  id: 'temple',
  name: 'TEMPLE',
  ascii: [
    '############################################################', //  0
    '#########K###################TT###################A#########', //  1
    '###.............#####X................X#####.............###', //  2
    '###.............#####..................#####.............###', //  3
    '###...#.....#...#####...##..~~~~..##...#####...#.....#...###', //  4
    '###.............#####...##..~~~~..##...#####.............###', //  5
    '#SW.....###.....#####~................~#####.....###.....WS#', //  6
    '###.....###.....#####~.......Z........~#####.....###.....###', //  7
    '###.....###.....#####...##........##...#####.....###.....###', //  8
    '###.............#####...##........##...#####.............###', //  9
    '###...#.....#...#####..................#####...#.....#...###', // 10
    '##8.............#####X................X#####.............9##', // 11
    '###.............#############MM#############.............###', // 12
    '###......................................................###', // 13
    '###......................................................###', // 14
    '#############################HH#############################', // 15
    '###############.....~~~~~~~~~..~~~~~~~~~.....###############', // 16
    '###.........##N.....~~~~~~~~~..~~~~~~~~~.....###.........###', // 17
    '###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###', // 18
    '###..#...#..###.....~~~~O..........O~~~~.....###..#...#..###', // 19
    '###..........E......~~~~....####....~~~~......F..........###', // 20
    '###..........E......~~~~....J##B....~~~~......F..........###', // 21
    '##4..#...#..###~~..~~~~~....####....~~~~~..~~###..#...#..6##', // 22
    '###.........###~~..~~~~~............~~~~~..~~###.........###', // 23
    '###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###', // 24
    '###..#...#..##2.....~~~~~~~~~GG~~~~~~~~~.....3##..#...#..###', // 25
    '###.........###.....~~~~~~~~~..~~~~~~~~~.....###.........###', // 26
    '###.........###..............................###.........###', // 27
    '##C..#...#..###..............................###..#...#..U##', // 28
    '###.........###..............................###.........###', // 29
    '#SW.........####W############DD############W####.........WS#', // 30
    '###..#...#..####S###....................###S####..#...#..###', // 31
    '###.........########....................########.........###', // 32
    '###.........#######Q...##..........##...1#######.........###', // 33
    '###..#...#..########...##....P.....##...########..#...#..###', // 34
    '###.........########....................########.........###', // 35
    '###.........########....................########.........###', // 36
    '#######5###############W############W###############7#######', // 37
    '#######################S############S#######################', // 38
    '############################################################', // 39
  ],
  // ASCII key -> weapon id. A cheap KN-44 at the gate; tier-3 guns (Peacekeeper, HG 40, M8A7) and
  // tier-2 (Man-O-War, Marshal 16) mirrored across the courtyard and cloisters; Gorgon + Drakon
  // in the two sanctum wings (behind H).
  wallbuys: {
    '1': 'kn44',         // outer gate (start)
    '2': 'peacekeeper',  // courtyard, west terrace (D)
    '3': 'manowar',      // courtyard, east terrace (D)
    '4': 'hg40',         // west cloister (E)
    '5': 'haymaker12',   // west cloister (E)
    '6': 'm8a7',         // east cloister (F)
    '7': 'marshal16',    // east cloister (F)
    '8': 'gorgon',       // inner sanctum, west wing (H)
    '9': 'drakon',       // inner sanctum, east wing (H)
  },
  // WO9 1.4 look: mossy green-grey flagstones with cracks, carved sandstone walls with glyph bands,
  // gold-green accent (glyph glow / idol), animated water, hanging vines, green-gold ambient,
  // drifting spores. The 7 hex keys + ambient/torch/flicker are what render requires; the rest
  // are hints for the TEMPLE style (render.js, Agent F) and are free-form.
  theme: {
    name: 'TEMPLE', style: 'temple',
    floor: '#4a5646', floorAlt: '#55614c',   // mossy green-grey flagstones
    wall: '#9a8356', wallEdge: '#d1b775',    // carved sandstone, sunlit edge
    accent: '#b9d15a',                       // gold-green glyph glow
    doorWood: '#4a3a22', doorIron: '#4d5a3c',
    ambient: 'rgba(170,210,110,0.07)',       // green-gold haze
    torch: false,
    flicker: false,
    water: true,                             // animated water on '~' (slow deterministic ripple)
    waterDeep: '#123f3a', waterLight: '#3fd6a8',
    moss: '#6f8a3e', vine: '#3f6b2a', glyph: '#e0c872',
    spores: true,                            // very subtle drifting spores overlay
  },
  boss: { name: 'THE DROWNED KING', tint: '#3fd6a8', ability: 'tide' },
  // WO9 1.1 base difficulty (above level 5).
  difficulty: { healthMult: 3.5, speedMult: 1.26, countMult: 1.8, sprintShift: 11 },
};
