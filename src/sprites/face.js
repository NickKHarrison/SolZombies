// WO2 3.5 — Wolfenstein 3D style status face (Agent C, pure: no DOM).
//
// Art: 24x30 ASCII grids (palette chars only). Every layer is a full 24x30 sprite, transparent
// ('.') where unused. Layers are authored as sparse row blocks (full-width 24-char rows placed at
// a start row) so each one stays readable.
//
// Composition (composeFace): base + hair (neat / messy) + eyes[variant] + mouth[variant] +
// blood[tier], optional pale tint for tier 4 (skin 's' -> 'P', shadow 'S' -> 't', done on the
// char grid so the result is still palette art with rows), and a 1-px breathing bob that shifts
// the head (rows above the jaw line split) down while the neck/collar stay put.
// Dead uses the single full FACE.dead sprite.

import { parseGrid } from './pixel.js';
import { createRng } from '../math.js';
import { SPRITES } from '../config.js';

const W = 24;
const H = 30;
const BLANK = '.'.repeat(W);
// Rows >= NECK_Y are neck + collar (never bob); rows above are the head.
const NECK_Y = 24;

// ---------------------------------------------------------------------------------------------
// Grid helpers (char level, pure)

function block(y0, rows) {
  const out = new Array(H).fill(BLANK);
  rows.forEach((r, i) => {
    if (r.length !== W) throw new Error(`face: row ${y0 + i} has ${r.length} chars, expected ${W}: '${r}'`);
    out[y0 + i] = r;
  });
  return out;
}

function over(...grids) {
  const out = grids[0].map((r) => r.split(''));
  for (let g = 1; g < grids.length; g++) {
    const grid = grids[g];
    for (let y = 0; y < H; y++) {
      const r = grid[y];
      for (let x = 0; x < W; x++) if (r[x] !== '.') out[y][x] = r[x];
    }
  }
  return out.map((r) => r.join(''));
}

function mapChars(grid, map) {
  return grid.map((r) => r.replace(/./g, (c) => (c in map ? map[c] : c)));
}

// Shift the head rows (y < NECK_Y) by (dx, dy) over the fixed neck/collar rows.
function shiftHead(grid, dy, dxForRow = () => 0) {
  const body = grid.map((r, y) => (y >= NECK_Y ? r : BLANK));
  const head = new Array(H).fill(BLANK).map((r) => r.split(''));
  for (let y = 0; y < NECK_Y; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    const dx = dxForRow(y);
    for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      const tx = x + dx;
      if (c === '.' || tx < 0 || tx >= W) continue;
      head[ty][tx] = c;
    }
  }
  return over(body, head.map((r) => r.join('')));
}

const PALE = { s: 'P', S: 't' };

// ---------------------------------------------------------------------------------------------
// Art (rows are 24 chars; column 11.5 is the centre line; light from the viewer's left)

const G_BASE = block(0, [
  '........................', //  0
  '........................', //  1
  '........................', //  2
  '......kkkkkkkkkkkk......', //  3
  '.....ksssssssssssSk.....', //  4
  '....ksssssssssssssSk....', //  5
  '....ksssssssssssssSk....', //  6
  '....ksssssssssssssSk....', //  7
  '....ksssssssssssssSk....', //  8
  '....ksssssssssssssSk....', //  9
  '...kksssssssssssssSkk...', // 10
  '..kSSssssssssssssSSSSk..', // 11 ears
  '..kSSssssssSSsssSSSSSk..', // 12
  '..kSSssssssSSssssSSSSk..', // 13
  '..kSSsssssssSssssSSSSk..', // 14
  '...kSssssssssSsssSSSk...', // 15
  '....ksssssSSSSSssSSk....', // 16 nose underside
  '....ksssssskSkSsssSk....', // 17 nostrils
  '....kssssssssssssSSk....', // 18
  '....kSssssssssssssSk....', // 19
  '....kSsssssssssssSSk....', // 20
  '....kSSssssssssssSSk....', // 21
  '.....kSSsssssssSSSk.....', // 22 square jaw
  '......kkSSSSSSSSkk......', // 23 jaw line
  '.......kSSSSSSSSk.......', // 24 thick neck (shadowed under chin)
  '.....kkkSssssssSkkk.....', // 25
  '...kkgGGkSssssSSkGGgkk..', // 26 dark green collar
  '..kgGLGGgkSsssSkgGGGGgk.', // 27
  '.kgGLGGGGgkSSSkgGGGGGggk', // 28
  'kgGGGgGGGGgkkkgGGGGgGGgk', // 29
]);

const G_HAIR_NEAT = block(0, [
  '........................', //  0
  '.......kkkkkkkkkk.......', //  1
  '.....kkhhhhhhhhhhkk.....', //  2
  '....khhhhhhhhhhhhhHk....', //  3
  '...khhhHhhhhhhHhhhHHk...', //  4
  '...khhHhhhHhhHhhHhHHk...', //  5
  '...kHhHHhHHhHHhHHhHHk...', //  6 fringe edge
  '...kHH............HHk...', //  7 sideburns
  '...kH..............Hk...', //  8
  '...kH..............Hk...', //  9
]);

const G_HAIR_MESSY = block(0, [
  '.....k..kk..k..kk.......', //  0 spikes
  '....khk.khkkhkkhhk.k....', //  1
  '...khhhkhhhhhhhhhhkhk...', //  2
  '..khhHhhhhhhHhhhhhHHk...', //  3
  '...khhhHhhHhhhhHhhHHHk..', //  4
  '..khHhHhhHhHhhHHhHhHHk..', //  5
  '...kHhHHhHHH.HHhHH.HHk..', //  6 ragged fringe
  '...kHH.hH...H......HHk..', //  7 loose strands
  '...kH...H..........Hk...', //  8
  '...kH..............Hk...', //  9
]);

// Brows on row 10, eyes on rows 11-12. Left eye cols 6-9, right eye cols 14-17.
const EYE = (r10, r11, r12, r13 = BLANK) => block(10, [r10, r11, r12, r13]);
const G_EYES = {
  center: EYE(
    '.....HHHHH....HHHHH.....',
    '......weew....weew......',
    '......SeeS....SeeS......'),
  left: EYE(
    '.....HHHHH....HHHHH.....',
    '......eeww....eeww......',
    '......eeSS....eeSS......'),
  right: EYE(
    '.....HHHHH....HHHHH.....',
    '......wwee....wwee......',
    '......SSee....SSee......'),
  closed: EYE(
    '.....HHHHH....HHHHH.....',
    '......SSSS....SSSS......',
    '......kkkk....kkkk......'),
  // Both eyes half shut under heavy lids (tiers 3-4); the viewer's-right eye squints harder
  // (iris only, no whites). Both stay visible (FIX-4, QA #9).
  squint: EYE(
    '......kHHHk..kHHHkk.....',
    '......kkkk....kkkk......',
    '......weew....SeeS......'),
  // Screwed shut, brows pinched up in the middle.
  pain: EYE(
    '.....k..kHHkkHHk..k.....',
    '......SkkS....SkkS......',
    '......kSSk....kSSk......'),
};

// Mouth rows 18-22, cols ~7-16.
const MOUTH = (rows) => block(18, rows);
const G_MOUTH = {
  neutral: MOUTH([
    '........................',
    '........kkkkkkkk........',
    '.........SSSSSS.........',
  ]),
  frown: MOUTH([
    '........................',
    '.........kkkkkk.........',
    '........kSSSSSSk........',
  ]),
  grit: MOUTH([
    '........kkkkkkkk........',
    '........kwwwwwwk........',
    '........kkkkkkkk........',
  ]),
  grin: MOUTH([
    '.......k........k.......',
    '.......kkkkkkkkkk.......',
    '........kwwwwwwk........',
    '.........kkkkkk.........',
  ]),
  pain: MOUTH([
    '.........kkkkkk.........',
    '........kwwwwwwk........',
    '........kKKKKKKk........',
    '.........kkkkkk.........',
  ]),
  slack: MOUTH([
    '........................',
    '.........kkkkkk.........',
    '.........kKKKKk.........',
    '.........kKrRKk.........',
    '..........kkkk..........',
  ]),
};

// Blood / damage overlays, cumulative by tier. Eye boxes (rows 10-12, cols 5-9 and 14-18 for the
// brows, 6-9 / 14-17 for the eyes) are kept clear so both eyes always read (FIX-4, QA #9).
// Tier 1: sweat droplets at the temples and jaw (white highlight over a cyan bead).
const B1 = block(7, [
  '..................w.....', //  7 right temple
  '.....w............c.....', //  8 left temple
  '.....c..................', //  9
  '........................', // 10
  '........................', // 11
  '........................', // 12
  '........................', // 13
  '........................', // 14
  '........................', // 15
  '.................w......', // 16 bead running down the right jaw
  '.................c......', // 17
]);
// Tier 2: a short diagonal gash high on the right forehead that drips down past the right
// eye, and a bruise on the left cheek (dark brown/blue core in a skin-shadow halo).
const B2 = over(B1, block(6, [
  '........................', //  6
  '.............rR.........', //  7 gash (down-right diagonal)
  '..............rRR.......', //  8
  '................rR......', //  9
  '..................r.....', // 10 drip runs off the end of the brow
  '..................R.....', // 11
  '..................r.....', // 12
  '..................R.....', // 13 drop
  '......SS................', // 14 bruise
  '.....SoCS...............', // 15
  '.....SCoS...............', // 16
  '......SS................', // 17
]));
// Tier 3: a nick through the left brow, the right streak runs on down to the jaw, a nosebleed
// from the left nostril over the lip, and the bruise darkens and spreads.
const B3 = over(B2, block(8, [
  '........r...............', //  8 left brow nick
  '.......rR...............', //  9
  '........R...............', // 10 (brow pixel, not the eye)
  '........................', // 11
  '........................', // 12
  '........................', // 13
  '.....SSS..........r.....', // 14
  '....SoCoS.........R.....', // 15
  '....SCoCS.........r.....', // 16
  '.....SoS.........rR.....', // 17
  '......S....R.....r......', // 18 nosebleed
  '...........r.....R......', // 19 (drawn over the mouth)
  '...........R............', // 20
  '...........r............', // 21
]));
// Tier 4: face streaked with blood: a run from the hairline down the left temple beside the
// eye, a second streak on the right cheek edge, both nostrils bleeding down over the chin,
// and drips on the collar.
const B4 = over(B3, block(5, [
  '.........r..............', //  5
  '........rR..............', //  6
  '.......rR...............', //  7
  '......rR................', //  8
  '.....rR.................', //  9
  '.....R..................', // 10
  '.....r..............r...', // 11 left run beside (not over) the eye; right cheek-edge streak
  '.....R.............rR...', // 12
  '.....r.............r....', // 13
  '...................R....', // 14
  '....SoCoS..........r....', // 15
  '....SCpCS.......r.......', // 16
  '.....SoS.......rR.......', // 17
  '.....R.....RR....r......', // 18 both nostrils
  '.....r.....rR....R......', // 19
  '...........Rr....r......', // 20
  '............r...........', // 21
  '...........rR...........', // 22
  '............r...........', // 23
  '........................', // 24
  '........................', // 25
  '........................', // 26
  '.........r..R...........', // 27 drips on the collar
  '............r...........', // 28
]));
// Blood never paints over the outline or outside the head: keep only pixels over base skin.
function onSkin(grid) {
  return grid.map((r, y) => r.replace(/./g, (c, x) => {
    const b = G_BASE[y][x];
    return c !== '.' && b !== '.' && b !== 'k' ? c : '.';
  }));
}
const G_BLOOD = [block(0, []), B1, B2, B3, B4].map(onSkin);

// Dead: messy hair, eyes rolled back under heavy lids, slack jaw, blood over most of the face,
// pale. The whole head (rows 0-23) is slumped 1 px down and 1 px to the side as one piece over
// the fixed neck/collar, so the outline stays clean (FIX-4, QA #10: no per-row shear).
const G_DEAD_EYES = block(10, [
  '......HHH......HHH......', // 10 slack brows
  '.....kkkkk....kkkkk.....', // 11 heavy lids
  '......wwwS....Swww......', // 12 whites only: eyes rolled back
  '.......SS......SS.......', // 13 sunken
]);
const G_DEAD_BLOOD = onSkin(over(mapChars(B4, { w: '.', c: '.' }), block(2, [ // no sweat when dead
  '........................', //  2
  '........................', //  3
  '..............r.........', //  4
  '.............rRr........', //  5
  '.......r......Rr........', //  6
  '.......R.......R........', //  7
  '....r..........r........', //  8
  '....R...................', //  9
  '........................', // 10
  '........................', // 11
  '........................', // 12
  '...............r........', // 13
  '...R..........rR........', // 14
  '...r.....r.....r........', // 15
  '.........R..............', // 16
  '.........r..............', // 17
  '........................', // 18
  '........................', // 19
  '........................', // 20
  '........................', // 21
  '.........r.....r........', // 22
  '.........R..............', // 23
  '........................', // 24
  '........................', // 25
  '........rRr.............', // 26
  '.........rR.............', // 27
  '..........r.............', // 28
])));
const G_DEAD = shiftHead(
  mapChars(over(G_BASE, G_HAIR_MESSY, G_DEAD_BLOOD, G_DEAD_EYES, G_MOUTH.slack), PALE),
  1, () => 1,
);

// ---------------------------------------------------------------------------------------------
// Public sprites

const mapObj = (o) => Object.fromEntries(Object.entries(o).map(([k, g]) => [k, parseGrid(g)]));

export const FACE = {
  w: W, h: H,
  base: parseGrid(G_BASE),
  hair: { neat: parseGrid(G_HAIR_NEAT), messy: parseGrid(G_HAIR_MESSY) },
  eyes: mapObj(G_EYES),
  mouth: mapObj(G_MOUTH),
  blood: G_BLOOD.map((g) => parseGrid(g)),
  dead: parseGrid(G_DEAD),
};

// ---------------------------------------------------------------------------------------------
// State machine

// 0 >= 85 %, 1 >= 65 %, 2 >= 45 %, 3 >= 25 %, else 4. (Dead is a separate flag, not a tier.)
export function healthTier(frac) {
  const f = Number.isFinite(frac) ? frac : 0;
  if (f >= 0.85) return 0;
  if (f >= 0.65) return 1;
  if (f >= 0.45) return 2;
  if (f >= 0.25) return 3;
  return 4;
}

// Breathing: full in/out cycle length in seconds per tier (hurt -> faster breathing).
const BREATH_PERIOD = [3.2, 2.8, 2.4, 2.0, 1.6];
const TIER_MOUTH = ['neutral', 'frown', 'grit', 'grit', 'pain'];
const LOOKS = ['left', 'center', 'right'];

export function createFaceState(seed = 1) {
  const F = SPRITES.face;
  const rng = createRng(seed);
  return {
    tier: 0,
    look: 'center',
    lookT: rng.range(F.glanceMin, F.glanceMax),
    blinkT: rng.range(F.blinkMin, F.blinkMax),
    blinkFor: 0,
    winceT: 0,
    grinT: 0,
    breathe: 0,
    breathT: 0,
    dead: false,
    rng,
  };
}

// Deterministic: all randomness comes from fs.rng. Large dt values are handled (loops).
export function updateFaceState(fs, healthFrac, down, dt) {
  const F = SPRITES.face;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  fs.dead = !!down || !(healthFrac > 0);
  fs.tier = healthTier(healthFrac);
  fs.winceT = Math.max(0, fs.winceT - d);
  fs.grinT = Math.max(0, fs.grinT - d);
  if (fs.dead) {
    fs.grinT = 0;
    fs.blinkFor = 0;
    fs.breathe = 0;
    return fs;
  }

  // Glances: pick one of the two other directions whenever the timer runs out.
  fs.lookT -= d;
  let guard = 0;
  while (fs.lookT <= 0 && guard++ < 64) {
    const others = LOOKS.filter((l) => l !== fs.look);
    fs.look = fs.rng.pick(others);
    fs.lookT += fs.rng.range(F.glanceMin, F.glanceMax);
  }
  if (fs.lookT <= 0) fs.lookT = F.glanceMin;

  // Blinks.
  fs.blinkFor = Math.max(0, fs.blinkFor - d);
  fs.blinkT -= d;
  guard = 0;
  while (fs.blinkT <= 0 && guard++ < 64) {
    fs.blinkFor = Math.max(0, F.blinkTime + fs.blinkT); // remaining blink after overshoot
    fs.blinkT += fs.rng.range(F.blinkMin, F.blinkMax);
  }
  if (fs.blinkT <= 0) fs.blinkT = F.blinkMin;

  // Breathing bob (0/1 px), faster when hurt.
  const period = BREATH_PERIOD[fs.tier];
  fs.breathT = (fs.breathT + d) % period;
  fs.breathe = fs.breathT >= period / 2 ? 1 : 0;
  return fs;
}

export function faceEvent(fs, kind) {
  if (kind === 'hurt') fs.winceT = SPRITES.face.winceTime;
  else if (kind === 'grin' && !fs.dead) fs.grinT = SPRITES.face.grinTime;
  return fs;
}

function resolve(fs) {
  const mouth = fs.winceT > 0 ? 'pain' : fs.grinT > 0 ? 'grin' : TIER_MOUTH[fs.tier];
  const blink = fs.blinkFor > 0;
  const eyes = fs.winceT > 0 || blink ? 'closed' : fs.tier >= 3 ? 'squint' : fs.look;
  return { eyes, mouth, blink };
}

// e.g. "t2:left:grit:blink0:b1" (tier : resolved eyes : resolved mouth : blink : breathe).
export function faceFrameKey(fs) {
  if (fs.dead) return 'dead';
  const { eyes, mouth, blink } = resolve(fs);
  return `t${fs.tier}:${eyes}:${mouth}:blink${blink ? 1 : 0}:b${fs.breathe ? 1 : 0}`;
}

const composeCache = new Map();

export function composeFace(fs) {
  const key = faceFrameKey(fs);
  let s = composeCache.get(key);
  if (s) return s;
  if (fs.dead) {
    s = FACE.dead;
  } else {
    const { eyes, mouth } = resolve(fs);
    const tier = fs.tier;
    let g = over(G_BASE, tier >= 3 ? G_HAIR_MESSY : G_HAIR_NEAT, G_EYES[eyes], G_MOUTH[mouth], G_BLOOD[tier]);
    if (tier >= 4) g = mapChars(g, PALE);
    if (fs.breathe) g = shiftHead(g, 1);
    s = parseGrid(g);
  }
  composeCache.set(key, s);
  return s;
}
