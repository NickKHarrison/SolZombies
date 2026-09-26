// levels/level1.js — level 1 "BUNKER" data (pure, no imports). WO5 3.5 (Agent A).
// The WO4 layout (zones, doors D-H, wall buys, windows) edited to add the boss arena:
//   - east hall of the corridor zone shortened to rows 15-16 (open spawn 9 moved (56,19) -> (56,16));
//   - arena carved from the rock above the vault: floor cols 41-56, rows 18-27 (16x10), four 2x2
//     pillars, boss spawn Z (48,22), minion spawns X on the edge, stairs T (40,21-23) on the west
//     (far) wall;
//   - vault (behind H) now rows 29-36; mega door M (53-55,28) in its north wall; its pillar moved to
//     (51-53,32-33); ICR-1 wall buy moved (52,23) -> (52,37) on the vault's south wall.
//   - FIX (WO5 QA review L1): Argus wall buy moved (42,29) -> (38,29) on the hall's north wall, so it
//     is >= 3 tiles (Chebyshev) from every arena tile and out of interact range from inside the arena.
// WO7 3.4 (Agent I): six perk machines replace wall tiles (letters J Q C N U K, see map.js TILE_PERK):
//   Q hub (24,27), J corridor (41,10), C courtyard (8,16), N bunker (5,13), U armory (31,29),
//   K vault (57,34); each faces one zone's floor, >= 6 tiles (Manhattan) from every wall buy.
// Apart from those perk tiles, everything outside cols 38-58 / rows 16-37 is byte-identical to WO4. See docs/notes/levels.md.
// This file must NOT import anything (map.js imports the level registry; avoid a load-time cycle).

export const LEVEL1 = {
  id: 'bunker',
  name: 'BUNKER',
  ascii: [
    '############################################################', //  0
    '########S###########################S#######################', //  1
    '########W#####################2#####W#######################', //  2
    '###...............F......................................###', //  3
    '###...............F..............##......................###', //  4
    '###...............F..............##......................###', //  5
    '##5...##........###......................................###', //  6
    '###...##........########...###############...............###', //  7
    '###.............########...###############.....#####.....a##', //  8
    '###........##...########...###############.....#####.....###', //  9
    '###........##...########...##############J.....#####.....###', // 10
    '###.............########...###############.....#####.....###', // 11
    '###.............########...###############.....#####.....###', // 12
    '#####N#######8##########...###############.....#####.....###', // 13
    '########################DDD######1########.....#####.....###', // 14
    '#####################................#####...............###', // 15
    '########C############................#####..............O###', // 16
    '###..............####................#######################', // 17
    '###..............####...##...........####X......X.......X###', // 18
    '###.................E...##...........WS##................###', // 19
    '###.................E................####...##.....##....###', // 20
    '###...##....##......E...........##...###T...##.....##....###', // 21
    '###...##....##...####...........##...###T.......Z.......X###', // 22
    '###..............####................###T................###', // 23
    '###..............####.......P........####...##.....##....###', // 24
    '###..............####................####...##.....##....###', // 25
    '#SW..............3###................####................###', // 26
    '###..............#######Q####W###########X...............###', // 27
    '###..............############S#######################MMM####', // 28
    '###..............##############U######9#########.........###', // 29
    '###...##....##...###.........................###.........WS#', // 30
    '###...##....##...###.........................###.........###', // 31
    '###................G.......##.......##.........H...###...###', // 32
    '###................G.......##.......##.........H...###...###', // 33
    '##4................G...........................H.........K##', // 34
    '###..............###.........................###.........###', // 35
    '###..............###.O................B......###.........###', // 36
    '#########W##############7########W##################c#######', // 37
    '#########S#######################S##########################', // 38
    '############################################################', // 39
  ],
  // Must stay exactly the WO4 WALLBUY_MAP (level 1 guns unchanged).
  wallbuys: { '1': 'sheiva', '2': 'rk5', '3': 'krm262', '4': 'kuda', '5': 'vmp', '6': 'vesper', '7': 'kn44', '8': 'hvk30', '9': 'argus', 'a': 'lcar9', 'b': 'pharo', 'c': 'icr1', 'd': 'bootlegger' },
  // Current greys (config COLORS at WO4). floorAlt = floor (WO4 floor is flat, no checker);
  // accent/doorWood/doorIron approximate render.js WO4 door panel colours (rivet, plank, band).
  theme: {
    name: 'BUNKER',
    floor: '#2a2a2e', floorAlt: '#2a2a2e', wall: '#0e0e10', wallEdge: '#3c3c44',
    accent: '#9aa0a8', doorWood: '#3e2412', doorIron: '#2b2d31',
    ambient: null,        // no screen tint
    torch: false,
  },
  boss: { name: 'THE WARDEN', tint: '#7a1f1f', ability: 'charge' },
  // WO5 1.3 base difficulty (level.js multiplies per loop).
  difficulty: { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 },
};
