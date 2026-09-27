import { createRng } from './math.js';

export function createEmptyState(seed = Date.now()) {
  return {
    phase: 'menu',            // 'menu' | 'playing' | 'paused' | 'gameover'
    time: 0, dt: 0,           // seconds since game start, last frame delta
    rng: createRng(seed),
    seed,
    camera: { x: 0, y: 0 },   // top-left of viewport in world units (main computes)
    zoom: 1,                  // camera zoom (CAMERA.mobileZoom on touch devices); render scales world space by it
    map: null,                // map.loadMap()
    player: null,             // player.createPlayer()
    zombies: [],
    bullets: [],              // ray gun projectiles
    effects: [],              // transient visuals { type, ttl, maxTtl, ... }
    flow: null,               // pathfinding flow field
    rounds: null,             // waves.createRoundState()
                              // WO5: rounds.suspended (bool, default false/absent) — while true
                              // updateRounds does no spawning and no round-end check (boss fight).
    powerups: { items: [], active: {}, dropsThisRound: 0, nuke: null },
    shop: {
      prompt: null, box: { state: 'idle', timer: 0, weaponId: null },
      // WO8: Pack-a-Punch machine. state 'idle' | 'working' | 'ready'; weapon = the weapon object inside.
      pap: { state: 'idle', timer: 0, weapon: null, slot: -1, baseId: null },
    },
    stats: {
      kills: 0, shotsFired: 0, shotsHit: 0, pointsEarned: 0, roundReached: 0,
      // WO7 (main.js increments these from events; see docs/notes/wo7-scaffold.md)
      timeSurvived: 0, levelReached: 1, bossesKilled: 0, powerupsCollected: 0, doorsOpened: 0,
      meleeKills: 0, perksBought: 0, bestWeaponId: null,
      // WO8: Pack-a-Punch upgrades bought this run (shop.takePap increments)
      papCount: 0,
    },
    debug: false,
    // WO5
    level: null,              // level.createLevelState(): { index, loop, def, difficulty, name }
    boss: null,               // boss.createBossState(): { phase, bossId, name, hp, maxHp, ... }
    transition: null,         // level.beginDescent(): { t, dur, nextIndex, swapped } while fading
    // WO7
    hazards: [],              // boss.js acid pools { id, kind: 'acid', x, y, r, ttl, maxTtl, dps }
  };
}
