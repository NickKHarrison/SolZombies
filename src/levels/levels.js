// levels/levels.js — level registry (pure). WO5 3.5.
// Imports only the level data modules; must NOT import map.js (map.js imports this registry).
import { LEVEL1 } from './level1.js';
import { LEVEL2 } from './level2.js';
import { LEVEL3 } from './level3.js'; // WO7
import { LEVEL4 } from './level4.js'; // WO9 KINO
import { LEVEL5 } from './level5.js'; // WO9 OUTPOST
import { LEVEL6 } from './level6.js'; // WO9 TEMPLE

export const LEVELS = [LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5, LEVEL6];

// Wraps past the last authored level (endless loop; level.js tracks the loop count).
export function levelByIndex(i) {
  const n = LEVELS.length;
  const k = ((Math.floor(i) % n) + n) % n;
  return LEVELS[k];
}
