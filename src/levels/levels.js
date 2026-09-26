// levels/levels.js — level registry (pure). WO5 3.5.
// Imports only the level data modules; must NOT import map.js (map.js imports this registry).
import { LEVEL1 } from './level1.js';
import { LEVEL2 } from './level2.js';
import { LEVEL3 } from './level3.js'; // WO7

export const LEVELS = [LEVEL1, LEVEL2, LEVEL3];

// Wraps past the last authored level (endless loop; level.js tracks the loop count).
export function levelByIndex(i) {
  const n = LEVELS.length;
  const k = ((Math.floor(i) % n) + n) % n;
  return LEVELS[k];
}
