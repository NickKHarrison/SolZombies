import { createRng } from './math.js';

export function createEmptyState(seed = Date.now()) {
  return {
    phase: 'menu',            // 'menu' | 'playing' | 'paused' | 'gameover'
    time: 0, dt: 0,           // seconds since game start, last frame delta
    rng: createRng(seed),
    seed,
    camera: { x: 0, y: 0 },   // top-left of viewport in world units (main computes)
    map: null,                // map.loadMap()
    player: null,             // player.createPlayer()
    zombies: [],
    bullets: [],              // ray gun projectiles
    effects: [],              // transient visuals { type, ttl, maxTtl, ... }
    flow: null,               // pathfinding flow field
    rounds: null,             // waves.createRoundState()
    powerups: { items: [], active: {}, dropsThisRound: 0, nuke: null },
    shop: { prompt: null, box: { state: 'idle', timer: 0, weaponId: null } },
    stats: { kills: 0, shotsFired: 0, shotsHit: 0, pointsEarned: 0, roundReached: 0 },
    debug: false,
  };
}
