// levels/level3.js — level 3 "LABORATORY" data (pure, no imports). WO7 1.5 / 3.4 (Agent I).
// New 60x40 layout, same legend as levels 1-2 plus perk machines (J Q C N U K, wall tiles).
// Zones (tree, one door each, D..H is a valid order):
//   Decon Lobby (start, rows 22-36, cols 22-37): 4 decon-shower blocks, ICR-1, 2 windows,
//     Quick Revive.
//   D (lobby north wall, via a vestibule) -> Sterile Corridor (rows 15-19, cols 3-41): a line of
//     glass tanks down the middle, XR-2 + HG 40, 1 window + 1 open spawn, Speed Cola.
//   E (corridor south wall, west) -> West Labs (rows 22-36, cols 3-19): three long lab benches,
//     Haymaker 12, mystery box, 2 windows, Juggernog.
//   F (corridor north wall) -> Containment Cells (rows 3-12, cols 3-29): open-front cells along
//     the north wall, specimen tanks, M8A7, 1 window + 1 open spawn, Double Tap II.
//   G (containment east wall) -> Cryo Vault (rows 3-12, cols 31-41): four cryo pods,
//     Peacekeeper MK2, 1 window, Stamin-Up.
//   H (cryo east wall, deepest) -> Reactor Room (rows 3-13, cols 43-56): reactor core (loop),
//     coolant pipes, Gorgon + Drakon, 1 window, Mule Kick on the core; mega door M (49-51,14)
//     in its south wall.
//   Arena / test chamber (rows 15-26, cols 44-56, 13x12): 4 pillars, Z (50,20), 5 X, stairs
//     T (49-51,27) in the south (far) wall.
// See docs/notes/levels.md.
// This file must NOT import anything (map.js imports the level registry; avoid a load-time cycle).

export const LEVEL3 = {
  id: 'lab',
  name: 'LABORATORY',
  ascii: [
    '############################################################', //  0
    '##########S#########################S#######################', //  1
    '##########W#########N###########U###W#########7#######8#####', //  2
    '###.....#....#....#....#..O...#...........#..............###', //  3
    '###.....#....#....#....#......#...........#..............###', //  4
    '###.....#....#....#....#......#...#...#...#..............WS#', //  5
    '###...........................G...#...#...H.....#####....###', //  6
    '###...........................G...........H.....#####....###', //  7
    '##5...##.............##.......G...........H.....#####....###', //  8
    '###...##.............##.......#...#...#...#.....##K##....###', //  9
    '###...........................#...#...#...#.#...........####', // 10
    '###...........................#...........#.#...........####', // 11
    '###...........................#...........#..............###', // 12
    '##############...##################6#######..............###', // 13
    '##############FFF###2#######C####################MMM########', // 14
    '###...................................O...##X...........X###', // 15
    '###.......................................##.............###', // 16
    '#SW...##.....##.....##.....##.....##......##..##.....##..###', // 17
    '###.......................................##..##.....##..###', // 18
    '###.......................................##.............###', // 19
    '########EEE#################DDD#####3#######X.....Z......###', // 20
    '########...#################...#############.............###', // 21
    '###.................##................######.............###', // 22
    '###.................##................######..##.....##..###', // 23
    '###.................##................######..##.....##..###', // 24
    '###...###########...##................######.............###', // 25
    '###.................##.......P........######X...........X###', // 26
    '#SW.................##................###########TTT########', // 27
    '###.................##...##.....##....######################', // 28
    '###...###########...##...##.....##....######################', // 29
    '###.................#Q................######################', // 30
    '###.................##................WS####################', // 31
    '##4.................##................######################', // 32
    '###...###########...##...##.....##....######################', // 33
    '###.................##...##.....##....######################', // 34
    '###.................##................######################', // 35
    '###..............B..##................######################', // 36
    '######J#####W#############W######1##########################', // 37
    '############S#############S#################################', // 38
    '############################################################', // 39
  ],
  // ASCII letter -> weapon id. Cheaper guns early (ICR-1 in the lobby, XR-2 / Haymaker 12),
  // the WO7 tier-3 guns in the middle zones, Gorgon + Drakon behind H.
  wallbuys: {
    '1': 'icr1',         // decon lobby (start)
    '2': 'xr2',          // sterile corridor (D)
    '3': 'hg40',         // sterile corridor (D)
    '4': 'haymaker12',   // west labs (E)
    '5': 'm8a7',         // containment cells (F)
    '6': 'peacekeeper',  // cryo vault (G)
    '7': 'gorgon',       // reactor room (H)
    '8': 'drakon',       // reactor room (H)
  },
  // WO7 1.5: clean pale green-grey tiles with white grout, steel-blue walls, failing
  // fluorescent lights (render dims the ambient tint briefly, deterministic from time).
  theme: {
    name: 'LABORATORY',
    floor: '#5f6d66', floorAlt: '#67766e', wall: '#1d2a38', wallEdge: '#5a7d9e',
    accent: '#e6eee9',    // white grout
    doorWood: '#3a4a5a', doorIron: '#2a3846',
    ambient: 'rgba(200,255,220,0.05)',
    torch: false,
    flicker: true,
  },
  boss: { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' },
  // WO7 1.5 base difficulty (above level 2; level.js multiplies per loop from here).
  difficulty: { healthMult: 2.0, speedMult: 1.2, countMult: 1.5, sprintShift: 5 },
};
