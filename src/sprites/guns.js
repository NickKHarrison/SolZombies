// WO2 3.4 — gun sprites (Agent B). All guns face +x (right), side-profile silhouettes read from above.
// grip   = point (sprite-px corner coords) that sits on the torso hand anchor.
// muzzle = front tip of the barrel, where flashes and tracers start (muzzle.x > grip.x).
// Pure data + lookup; Node-safe. Art authored as ASCII grids in PALETTE chars (see docs/notes/guns.md).
import { parseGrid } from './pixel.js';

function gun(rows, grip, muzzle, pose, weight) {
  return Object.freeze({ sprite: parseGrid(rows), grip: Object.freeze(grip), muzzle: Object.freeze(muzzle), pose, weight });
}

export const GUN_SPRITES = Object.freeze({
  pistol: gun([
    'kkkkkkkk',
    'kWWWWWWk',
    'kKKKKKmk',
    'kKmkkkkk',
    'kKmk....',
    'kkkk....',
  ], { x: 2, y: 2 }, { x: 8, y: 2 }, 'onehand', 1),

  smg: gun([
    '...kkkkkkkk...',
    'kkkkWWWWWWkkkk',
    'kKKkMMMMMMMMMk',
    'kKKKmmmmmmKkkk',
    'kkkkkkmMkkkk..',
    '.....kmMk.....',
    '.....kmMk.....',
    '.....kmMk.....',
    '.....kkkk.....',
  ], { x: 4, y: 2 }, { x: 14, y: 2 }, 'twohand', 1),

  ar: gun([
    '......kkkkkkk.........',
    'kkkkkkkWWWWWk.........',
    'kKKKKkkMkkkMkkkkkkkkkk',
    'kKKKKKMMMMMMMKKKKMMMMk',
    'kKKKkkmmmmmmmKKKKkkkkk',
    'kkkkkkkkkkookkkkkk....',
    '.........kkookk.......',
    '..........kkook.......',
    '...........kkkk.......',
  ], { x: 6, y: 3 }, { x: 22, y: 3 }, 'twohand', 1),

  shotgun: gun([
    '....kkkkkkkkkkkkkk',
    'kkkkkWWWWWWWWWWWWk',
    'ktOOOMMMMMMMMMMMMk',
    'kOOokmmkktOOOOkkkk',
    'kkkkkkkkkkkkkkk...',
  ], { x: 6, y: 2 }, { x: 18, y: 2 }, 'twohand', 1),

  sniper: gun([
    '.....kkkkkkkkk..........',
    '.....keWWWWWek..........',
    'kkkkkkKKKKKKKkkkkkkkkkkk',
    'kLGGGGGMMMMMMMMMMMMMMMMk',
    'kggkkkkmKkkkkkkkkkkkkkkk',
    'kkkk..kkkk..............',
  ], { x: 7, y: 3 }, { x: 24, y: 3 }, 'twohand', 1),

  lmg: gun([
    '....kkkkkkk.............',
    'kkkkkKKKKKkkkkkkkkk.....',
    'kKKKKMMMMMMmKmKmKmkkkkkk',
    'kKKKKMMMMMMMMMMMMMMMMMMk',
    'kKKkkmmmmmmmKmKmKmkkkkkk',
    'kkkkkyGGGGGkkkkkkWWWkk..',
    '....koOtttOk...kWkkkWk..',
    '....kyOOOOOk...kkk.kkk..',
    '....koGGGGGk............',
    '....kkkkkkkk............',
  ], { x: 5, y: 3 }, { x: 24, y: 3 }, 'heavy', 1.6),

  raygun: gun([
    '..kkkkkk........',
    '.kkWWWWkkkkkk...',
    'kkWMMMMMnNnNkkkk',
    'kWMMMMMMnNnNmnwk',
    'kmMMMMMMnNnNmnwk',
    'kkmmmmKmnNnNkkkk',
    '.kkkkKKkkkkkk...',
    '....kKKk........',
    '....kkkk........',
  ], { x: 4, y: 4 }, { x: 16, y: 4 }, 'onehand', 1),

  thundergun: gun([
    '.................kkkk',
    '....kkkkkkkkkkk.kkWWk',
    'kkkkkKKKKckckckkkMMWk',
    'kOoMMMMMMcCcCcCMMMmKk',
    'kOoMMMMMMcCcCcCMMmmKk',
    'kkkkkmmkkCkCkCkkkmmmk',
    '....kkkkkkkkkkk.kkmmk',
    '.................kkkk',
  ], { x: 5, y: 4 }, { x: 21, y: 4 }, 'heavy', 1.6),

  deathmachine: gun([
    '....kkkkkk.........',
    'kkkkkKKKKkkkkkkkkkk',
    'kKKKKmmmmWWWWWmWWWk',
    'kKmmmMMMMmmmmmMmmmk',
    'kKmmmMMMMWWWWWmWWWk',
    'kKmmmMMMMmmmmmMmmmk',
    'kKKKKmmmmWWWWWmWWWk',
    'kkkkkKKkkkkkkkkkkkk',
    '....kkkk...........',
  ], { x: 5, y: 4 }, { x: 19, y: 4 }, 'heavy', 1.6),

  // WO5 3.4 (Agent D): level-2 guns. Keys = weapon ids (defs set `sprite` to the same key).
  manowar: gun([
    '....kkkkkkkkk..........',
    'kkkkkWWWWWWWkkkkkkkk...',
    'kKKKKMMMMMMMMmKmKmmkkkk',
    'kKKKKMMMMMMMMMMMMMMMMMk',
    'kKKKKmmmmmmmmmKmKmmkkkk',
    'kKKkkKmmmmmKkkkkkkkk...',
    'kkkkkmMWWWMmk..........',
    '....kmWmmmWmk..........',
    '....kmMWWWMmk..........',
    '....kkmmmmmkk..........',
    '.....kkkkkkk...........',
  ], { x: 6, y: 3 }, { x: 23, y: 3 }, 'twohand', 1),

  xr2: gun([
    '...kkkkkkkkkkkkkk.........',
    'kkkkWWWWWWWWWWWWkkkkkkkkkk',
    'kKWWWWppppWWWWWWWWMMMMMMMk',
    'kKKKKmmmmmmmKmmmmWWkkkkkkk',
    'kkkkKmmKkkkKmkkkkkkk......',
    '...kkkkkk.kkKmk...........',
    '...........kkkk...........',
  ], { x: 7, y: 2 }, { x: 26, y: 2 }, 'twohand', 1),

  weevil: gun([
    '.kkkkkkkkkkkkk...',
    'kkKKkWWWWWWWWkkkk',
    'kKKKKMMMMMMMMMMMk',
    'kKKkKMMMMMMMMmmkk',
    'kkkkKmmmmmmmmKkk.',
    '...kkKmKkmMkkkk..',
    '....kKKkkmMk.....',
    '....kkkkkmMk.....',
    '........kkkk.....',
  ], { x: 4, y: 2 }, { x: 17, y: 2 }, 'twohand', 1),

  marshal16: gun([
    '....kkkkkkkkkkkkk',
    'kkkkkmWWWWWWWWWWk',
    'ktOOOmMMMMMMMMMMk',
    'kOOOOmkkkkkkkkkkk',
    'kOoooMWWWWWWWWWWk',
    'kokkkmMOOOOOOMMMk',
    'kkk.kkkkkkkkkkkkk',
  ], { x: 6, y: 3 }, { x: 17, y: 3 }, 'twohand', 1),

  gorgon: gun([
    '....kkkkkkkkk...............',
    'kkkkkKKKKKKKkkkkkkkkkk......',
    'kKKKKMMMMMMMMmKmKmKmKkkkkkkk',
    'kKKKKMMMMMMMMMMMMMMMMMMMmWmk',
    'kKKKkmmmmmmmmmKmKmKmKkkkkmkk',
    'kkkyGGGGGGGkkkkKmkkkkk..kkk.',
    '..koGLLLLLGk.kKkkKk.........',
    '..kyGGGGGGGk.kkkkkk.........',
    '..kogggggggk................',
    '..kkkkkkkkkk................',
  ], { x: 5, y: 3 }, { x: 28, y: 3 }, 'heavy', 1.6),

  dredge48: gun([
    '....kkkkkkkkkk.............',
    'kkkkkKKKKKKKKkkkkkkkk......',
    'kKKKKMMMMMMMMMMmmmmmkkkkkkk',
    'kKKKKMMMMMMMMMMMMMMMMMMMWWk',
    'kKKKKmmmmmmmmmmmmmmmkkkkkkk',
    'kKKkkmmmmmmmmmmmKkkkk......',
    'kkkkkoOOOOOOokkkkk.........',
    '...koOttttttOok............',
    '...koOtmmmmtOok............',
    '...koOttttttOok............',
    '...kkoOOOOOOokk............',
    '....kkooooookk.............',
    '.....kkkkkkkk..............',
  ], { x: 5, y: 3 }, { x: 27, y: 3 }, 'heavy', 1.6),

  default: gun([
    '..kkkkkkkkk..',
    'kkkWWWWWWWkkk',
    'kKKMMMMMMMMMk',
    'kKkkmKkkkkkkk',
    'kkkkkkk......',
  ], { x: 4, y: 2 }, { x: 13, y: 2 }, 'twohand', 1),
});

// Lookup order: weaponDef.sprite, then weaponDef.id (if it names a gun sprite, e.g. 'raygun'),
// then weaponDef.cls, else default. Never returns undefined.
export function gunSpriteFor(weaponDef) {
  if (!weaponDef) return GUN_SPRITES.default;
  for (const k of [weaponDef.sprite, weaponDef.id, weaponDef.cls]) {
    if (k && k !== 'default' && Object.prototype.hasOwnProperty.call(GUN_SPRITES, k)) return GUN_SPRITES[k];
  }
  return GUN_SPRITES.default;
}
