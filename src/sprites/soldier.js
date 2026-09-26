// WO2 3.4 - soldier sprites (Agent A; redrawn by FIX-1, feet reworked by WO4). Pure data,
// Node-safe (no DOM).
//
// Every sprite is an ASCII grid of PALETTE chars ('.' = transparent) parsed once at module load
// with pixel.parseGrid. All sprites face +x (right) at angle 0; +y is the soldier's right side.
// Anchors are sprite-pixel CORNER coordinates (the centre of a 16x16 is (8, 8)).
//
// Layers (render order): shadow ellipse -> legs (rotate to movement) -> torso (rotate to aim)
// -> gun (grip placed on torso.hand[pose]) -> torso.helmet (same transform as the torso, so the
// head is never hidden by a long gun; the gun passes under it like a cheek weld).
//
// Colour plan (FIX-1): fatigues are dark olive 'g' with 'G' only as the lit top-left of each
// shoulder lobe and an 'L' rim on the lit (left) shoulder; the helmet is the brightest olive
// ('L' dome, 'G'/'g' shade, 'o' chin strap) so the head pops out of the shoulders; tan 'O'/'t'
// backpack; 's'/'S' bare forearms. Nothing large uses 'G', the v1 zombie colour.
// WO4: the rear of both shoulder lobes (torso rows 0-3 and 12-15) is 2 px slimmer than FIX-1,
// so the backpack is the rearmost part and a trailing boot shows behind the shoulders.
//
// Legs (WO4): 26x26 grids, anchor (13, 13). Boots are tucked under the body: lanes 5.5 px either
// side of the centre line (rows 6-8 and 17-19), so the boots never reach past the shoulders
// (torso half-width 8 incl. outline). Boot = 6 long x 3 wide, 'K' leather, a 1-px 'o' trouser
// cuff on the hip side, and a 'W'/'M' shine on the far end: toe shine when the boot is ahead of
// the hip, heel shine when it is behind. Olive 'g' trouser strips (2 rows) join boot and hip.
// Run gait, 8 frames, frame 0 = passing (the idle stance). L = left-boot offset along +x, the
// right boot is the same cycle shifted by 4 frames; P = planted, - = in the air:
//   0 passing  L  0 P  R +2 -      4 passing  L +2 -  R  0 P
//   1 push-off L -5 P  R +4 -      5 push-off L +4 -  R -5 P
//   2 flight   L -4 -  R +5 -      6 flight   L +5 -  R -4 -
//   3 contact  L -2 -  R +5 P      7 contact  L +5 P  R -2 -
// A planted boot moves back 5 sprite px per frame (+5 -> 0 -> -5), so with SPRITES.scale 2 and
// SPRITES.strideLength 80 (10 world px per frame) it stays put on the ground.
// Torso poses: onehand (pistol in the right hand, left arm free: it swings in torso.walk),
// twohand (left hand on the handguard above the gun, right hand on the grip below it), heavy
// (gun at the right hip, left arm reaching wide over the top). Reload frames: 0 = left hand
// pulled back to the chest holding a fresh magazine ('m'/'K'; an 'o'/'O' belt for heavy), right
// arm pulled in with the gun (reloadGunOffset); 1 = left hand forward seating it at the gun.
// See docs/notes/soldier.md for the design notes.
import { parseGrid } from './pixel.js';

const LEGS0 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........kkkkkk..........',
  '.........koKKKKMk.........',
  '.........koKKKKWk.........',
  '.........koKKKKKk.........',
  '..........kkkkkk..........',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '............kkkkkk........',
  '...........koKKKKKk.......',
  '...........koKKKKWk.......',
  '...........koKKKKMk.......',
  '............kkkkkk........',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS1 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '.....kkkkkk...............',
  '....kMKKKKokkk............',
  '....kWKKKKogggk...........',
  '....kKKKKKogggk...........',
  '.....kkkkkkkkk............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '............kkkkkkkk......',
  '...........kggoKKKKKk.....',
  '...........kggoKKKKWk.....',
  '............kkoKKKKMk.....',
  '..............kkkkkk......',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS2 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '......kkkkkk..............',
  '.....kMKKKKokk............',
  '.....kWKKKKoggk...........',
  '.....kKKKKKoggk...........',
  '......kkkkkkkk............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '............kkkkkkkkk.....',
  '...........kgggoKKKKKk....',
  '...........kgggoKKKKWk....',
  '............kkkoKKKKMk....',
  '...............kkkkkk.....',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS3 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '........kkkkkk............',
  '.......kMKKKKok...........',
  '.......kWKKKKok...........',
  '.......kKKKKKok...........',
  '........kkkkkk............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '............kkkkkkkkk.....',
  '...........kgggoKKKKKk....',
  '...........kgggoKKKKWk....',
  '............kkkoKKKKMk....',
  '...............kkkkkk.....',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS4 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '............kkkkkk........',
  '...........koKKKKMk.......',
  '...........koKKKKWk.......',
  '...........koKKKKKk.......',
  '............kkkkkk........',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........kkkkkk..........',
  '.........koKKKKKk.........',
  '.........koKKKKWk.........',
  '.........koKKKKMk.........',
  '..........kkkkkk..........',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS5 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..............kkkkkk......',
  '............kkoKKKKMk.....',
  '...........kggoKKKKWk.....',
  '...........kggoKKKKKk.....',
  '............kkkkkkkk......',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '.....kkkkkkkkk............',
  '....kKKKKKogggk...........',
  '....kWKKKKogggk...........',
  '....kMKKKKokkk............',
  '.....kkkkkk...............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS6 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '...............kkkkkk.....',
  '............kkkoKKKKMk....',
  '...........kgggoKKKKWk....',
  '...........kgggoKKKKKk....',
  '............kkkkkkkkk.....',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '......kkkkkkkk............',
  '.....kKKKKKoggk...........',
  '.....kWKKKKoggk...........',
  '.....kMKKKKokk............',
  '......kkkkkk..............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

const LEGS7 = [
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '...............kkkkkk.....',
  '............kkkoKKKKMk....',
  '...........kgggoKKKKWk....',
  '...........kgggoKKKKKk....',
  '............kkkkkkkkk.....',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '........kkkkkk............',
  '.......kKKKKKok...........',
  '.......kWKKKKok...........',
  '.......kMKKKKok...........',
  '........kkkkkk............',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
  '..........................',
];

// Helmet overlay: the helmet pixels alone, registered to the 16x16 torso grid (anchor 8,8).
const HELMET = [
  '................',
  '................',
  '................',
  '................',
  '......kkkk......',
  '.....kLLLGk.....',
  '....kLLLLGgk....',
  '....kLLLGGgk....',
  '....kLGGGggk....',
  '....kGGGggok....',
  '.....kgggok.....',
  '......kkkk......',
  '................',
  '................',
  '................',
  '................',
];

const ONEHAND = [
  '....kkkkk.......',
  '...kLLLLLkkkk...',
  '...kGGGGgGLssk..',
  '...kGgggggGSsk..',
  '.kkgggkkkkkkkk..',
  'kOtggkLLLGkk....',
  'kOtOkLLLLGgk....',
  'kOOOkLLLGGgk....',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgkk..',
  '.kkgggkkkkgsSsk.',
  '...kGggggGssSk..',
  '...kGGGGGskkk...',
  '...kgggggk......',
  '....kkkkk.......',
];

// Onehand walk arm swing: the free LEFT arm swings opposite the left leg. Only rows 0-4 differ.
const ONEHAND_REST = ONEHAND.slice(5);
const ONEHANDFWD = [
  '....kkkkk.......',
  '...kLLLLLkkkkkk.',
  '...kGGGGgGLLLssk',
  '...kGgggggGGSssk',
  '.kkgggkkkkkkkkkk',
  ...ONEHAND_REST,
];
const ONEHANDBACK = [
  'kkkkkkkkk.......',
  'ksSLLLLLLk......',
  'kSsGGGGGgk......',
  '.kkgggggggk.....',
  '.kggggkkkkk.....',
  ...ONEHAND_REST,
];

const ONEHANDR0 = [
  '....kkkkk.......',
  '...kLLLLLkk.....',
  '...kGGGGgGLk....',
  '...kGgggggGsk...',
  '.kkgggkkkkkSskk.',
  'kOtggkLLLGkgsmKk',
  'kOtOkLLLLGgkkkkk',
  'kOOOkLLLGGgk....',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgk...',
  '.kkgggkkkkgssk..',
  '...kGggggGsSk...',
  '...kGGGGGgkk....',
  '...kgggggk......',
  '....kkkkk.......',
];

const ONEHANDR1 = [
  '....kkkkk.......',
  '...kLLLLLkkk....',
  '...kGGGGgGLLk...',
  '...kGgggggGssk..',
  '.kkgggkkkkkkSsk.',
  'kOtggkLLLGkgksSk',
  'kOtOkLLLLGgkkmKk',
  'kOOOkLLLGGgkkkkk',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgk...',
  '.kkgggkkkkgssk..',
  '...kGggggGsSk...',
  '...kGGGGGgkk....',
  '...kgggggk......',
  '....kkkkk.......',
];

const TWOHAND = [
  '....kkkkk.......',
  '...kLLLLLkkk....',
  '...kGGGGgGLLk...',
  '...kGgggggGsskk.',
  '.kkgggkkkkkkSssk',
  'kOtggkLLLGkgkssk',
  'kOtOkLLLLGgkkSSk',
  'kOOOkLLLGGgk.kk.',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgkkk.',
  '.kkgggkkkkgkSssk',
  '...kGggggGLssSSk',
  '...kGGGGGgkkkkk.',
  '...kgggggk......',
  '....kkkkk.......',
];

const TWOHANDR0 = [
  '....kkkkk.......',
  '...kLLLLLkk.....',
  '...kGGGGgGLk....',
  '...kGgggggGsk...',
  '.kkgggkkkkkSsk..',
  'kOtggkLLLGkgkmKk',
  'kOtOkLLLLGgksSmk',
  'kOOOkLLLGGgkgkkk',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgk...',
  '.kkgggkkkkgsSk..',
  '...kGggggGLssk..',
  '...kGGGGGgkkk...',
  '...kgggggk......',
  '....kkkkk.......',
];

const TWOHANDR1 = [
  '....kkkkk.......',
  '...kLLLLLkkk....',
  '...kGGGGgGLLk...',
  '...kGgggggGssk..',
  '.kkgggkkkkkkSsk.',
  'kOtggkLLLGkgksSk',
  'kOtOkLLLLGgkkssk',
  'kOOOkLLLGGgkkmKk',
  'kOOOkLGGGggk.kk.',
  'kOOokGGGggok....',
  'kooogkgggokgkk..',
  '.kkgggkkkkgsSsk.',
  '...kGggggGLssSk.',
  '...kGGGGGgkkkk..',
  '...kgggggk......',
  '....kkkkk.......',
];

const HEAVY = [
  '....kkkkk.......',
  '...kLLLLLkkkk...',
  '...kGGGGgGLLLkk.',
  '...kGgggggGGssk.',
  '.kkgggkkkkkkkssk',
  'kOtggkLLLGkgkssk',
  'kOtOkLLLLGgkkSsk',
  'kOOOkLLLGGgk.kSk',
  'kOOOkLGGGggk..k.',
  'kOOokGGGggok....',
  'kooogkgggokgk...',
  '.kkgggkkkkgGk...',
  '...kGgggsSGLk...',
  '...kGGGGsSGk....',
  '...kgggggkk.....',
  '....kkkkk.......',
];

const HEAVYR0 = [
  '....kkkkk.......',
  '...kLLLLLkk.....',
  '...kGGGGgGLk....',
  '...kGgggggGsk...',
  '.kkgggkkkkkSsk..',
  'kOtggkLLLGkgkoOk',
  'kOtOkLLLLGgksSok',
  'kOOOkLLLGGgkgkk.',
  'kOOOkLGGGggk....',
  'kOOokGGGggok....',
  'kooogkgggokgk...',
  '.kkgggkkkkgGk...',
  '...kGgggsSGLk...',
  '...kGGGGsSGk....',
  '...kgggggkk.....',
  '....kkkkk.......',
];

const HEAVYR1 = [
  '....kkkkk.......',
  '...kLLLLLkkk....',
  '...kGGGGgGLLk...',
  '...kGgggggGssk..',
  '.kkgggkkkkkkSsk.',
  'kOtggkLLLGkgkssk',
  'kOtOkLLLLGgkkSsk',
  'kOOOkLLLGGgkkoOk',
  'kOOOkLGGGggk.kok',
  'kOOokGGGggok..k.',
  'kooogkgggokgk...',
  '.kkgggkkkkgGk...',
  '...kGgggsSGLk...',
  '...kGGGGsSGk....',
  '...kgggggkk.....',
  '....kkkkk.......',
];

// WO7 (T3) knife pose, 2 frames, drawn for MELEE.swingTime with NO gun. Rows 4-11 cols 4-11 keep the
// helmet pixels so the helmet overlay still registers. Frame 0 = cocked: right hand pulled back onto
// the right shoulder (rows 13-14), knife pointing forward ('K' grip, 4-px 'WWWW' blade at row 13 with
// a 'www' edge highlight above it), left arm raised forward as a guard (the ONEHANDFWD rows).
// Frame 1 = thrust: right arm driven forward and in toward the aim line, fist at cols 10-11 (row 11)
// with a 4-px 'WWWW' blade at cols 12-15 and a 'wwww' edge above it (row 10), left arm swung back
// for balance (the ONEHANDBACK rows). Rows 5-9 are the onehand body. (WO7 FIX-4: blade was 1-2 px.)
const KNIFE_BODY = ONEHAND.slice(5, 10);
const KNIFE0 = [
  ...ONEHANDFWD.slice(0, 5),
  ...KNIFE_BODY,
  'kooogkgggokk....',
  '.kkgggkkkkgk....',
  '...kGggggGgkwwwk',
  '...kGGGGsSKWWWWk',
  '...kgggsSkkkkkk.',
  '....kkkkk.......',
];
const KNIFE1 = [
  ...ONEHANDBACK.slice(0, 5),
  'kOtggkLLLGkk....',
  'kOtOkLLLLGgk....',
  'kOOOkLLLGGgk....',
  'kOOOkLGGGggk....',
  'kOOokGGGggokkkkk',
  'kooogkgggokkwwww',
  '.kkgggkkkksSWWWW',
  '...kGggggGsskkkk',
  '...kGGGGGgkk....',
  '...kgggggk......',
  '....kkkkk.......',
];

const DOWN = [
  '...............kk...',
  '..............kssk..',
  '.............ksssk..',
  '..........kkkGSsk...',
  '........kkGLLGGk....',
  '.kkk...kGLLLLGGk....',
  'kKKKk.kGLLGGGGkkkk..',
  'kKmmGkgGGooGGkGLLGk.',
  '.kKGGGgGotOokGLLLGGk',
  '..kkGGgGOtOokGLLGGgk',
  '....kggGOOOokGGGGggk',
  '....kggGOOOokgGGgggk',
  '..kkGGgGoOOoGkgggok.',
  '.kKgGGgGGooGGGkkkk..',
  'kKmmGkkggGGGGggk....',
  'kKKKk..kggggggk.....',
  '.kkk...kSgggkk......',
  '......ksSskk........',
  '......kssk..........',
  '.......kk...........',
];

const P = (g) => parseGrid(g);

export const SOLDIER = {
  legs: { frames: [LEGS0, LEGS1, LEGS2, LEGS3, LEGS4, LEGS5, LEGS6, LEGS7].map(P), anchor: { x: 13, y: 13 } },
  torso: {
    idle: { onehand: P(ONEHAND), twohand: P(TWOHAND), heavy: P(HEAVY) },
    reload: {
      onehand: [P(ONEHANDR0), P(ONEHANDR1)],
      twohand: [P(TWOHANDR0), P(TWOHANDR1)],
      heavy: [P(HEAVYR0), P(HEAVYR1)],
    },
    // WO7 (T3): knife swing, [cocked, thrust]; drawn instead of the pose torso (and without the gun)
    // while animator pose === 'knife', frame = anim.meleeFrame. Same 16x16 grid and anchor.
    knife: [P(KNIFE0), P(KNIFE1)],
    // Walk frames indexed by legs frame (only poses with a free arm): left arm forward while the
    // left boot is back (frames 1-3), back while it is forward (5-7); 0 and 4 are passing frames.
    walk: {
      onehand: [ONEHAND, ONEHANDFWD, ONEHANDFWD, ONEHANDFWD, ONEHAND, ONEHANDBACK, ONEHANDBACK, ONEHANDBACK].map(P),
    },
    // Drawn AFTER the gun with the torso's transform (helmet.anchor on torso.anchor), so long guns
    // pass under the head. The idle/reload/walk torsos already contain the same helmet pixels.
    helmet: { sprite: P(HELMET), anchor: { x: 8, y: 8 } },
    // While reloading the gun (grip) is drawn offset from hand[pose] by this many sprite px per
    // reload frame: pulled back and in (frame 0, magazine out) then most of the way (frame 1, seating it).
    reloadGunOffset: [{ x: -3, y: 1 }, { x: -1, y: 0 }],
    anchor: { x: 8, y: 8 },
    // Guns sit right of the centre line (cheek weld / hip), leaving the helmet and both hands visible.
    hand: { onehand: { x: 13, y: 10 }, twohand: { x: 12, y: 9 }, heavy: { x: 11, y: 12 } },
  },
  down: { sprite: P(DOWN), anchor: { x: 10, y: 10 } },
  shadow: { rx: 7, ry: 5 },
};
