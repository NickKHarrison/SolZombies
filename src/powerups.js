// Power-ups (Agent G). Pure logic: no DOM access. See WORK_ORDER.md 3.6 and 5.8.
import { POWERUPS, POINTS } from './config.js';
import * as events from './events.js';
import { dist, nextId } from './math.js';
// Namespace imports: sibling modules are resolved lazily at call time (cycle-safe, and a
// missing export surfaces as a clear TypeError at the call site rather than a link error).
import * as player from './player.js';
import * as weapons from './weapons.js';
import * as zombie from './zombie.js';
import * as waves from './waves.js';
import * as map from './map.js';

export const POWERUP_TYPES = Object.freeze([
  'instaKill', 'doublePoints', 'maxAmmo', 'nuke', 'carpenter', 'fireSale', 'deathMachine', 'zombieBlood',
]);

export const POWERUP_LABEL = Object.freeze({
  instaKill: 'INSTA-KILL',
  doublePoints: 'DOUBLE POINTS',
  maxAmmo: 'MAX AMMO',
  nuke: 'NUKE',
  carpenter: 'CARPENTER',
  fireSale: 'FIRE SALE',
  deathMachine: 'DEATH MACHINE',
  zombieBlood: 'ZOMBIE BLOOD',
});

const TIMED = new Set(['instaKill', 'doublePoints', 'fireSale', 'deathMachine', 'zombieBlood']);
const NUKE_FLASH_TTL = 0.5;

// ---------------------------------------------------------------------------
// Queries (pure reads; called from many modules every frame)

export function isActive(state, type) {
  const t = state?.powerups?.active?.[type];
  return typeof t === 'number' && t > state.time;
}

export function timeLeft(state, type) {
  const t = state?.powerups?.active?.[type];
  if (typeof t !== 'number') return 0;
  const left = t - state.time;
  return left > 0 ? left : 0;
}

// ---------------------------------------------------------------------------
// Setup

// Unsubscriber from the most recent initPowerups call (integrator: makes re-init idempotent,
// matching initPlayer/initRounds/initRender/initHud/initAudio).
let lastUnsub = null;

export function initPowerups(state) {
  if (lastUnsub) lastUnsub();
  const offKilled = events.on('zombie:killed', (p) => rollDrop(state, p));
  const offRound = events.on('round:start', () => { state.powerups.dropsThisRound = 0; });
  const unsub = () => { offKilled(); offRound(); if (lastUnsub === unsub) lastUnsub = null; };
  lastUnsub = unsub;
  return unsub;
}

function rollDrop(state, payload) {
  if (!payload || payload.cause !== 'weapon') return;
  const pu = state.powerups;
  if (pu.dropsThisRound >= POWERUPS.maxPerRound) return;
  if (!state.rng.chance(POWERUPS.dropChance)) return;

  let type = state.rng.weighted(POWERUPS.weights);
  if (type === pu.lastType) {
    // Re-roll once with the previous type excluded so the same type never drops twice in a row.
    const w = { ...POWERUPS.weights };
    delete w[type];
    type = state.rng.weighted(w) ?? type;
  }
  const z = payload.zombie;
  const pos = reachableDropPos(state, payload.x ?? z?.x ?? 0, payload.y ?? z?.y ?? 0);
  if (!pos) return; // no player-reachable tile nearby: skip without counting toward the cap
  pu.dropsThisRound++;
  spawnPowerup(state, type, pos.x, pos.y);
}

// review.md #4b: a kill inside a spawn pocket (or any non-player-walkable tile) must not
// leave an uncollectable item. Keep the position if its tile is player-walkable; otherwise
// move to the nearest player-walkable tile centre within DROP_SNAP_TILES (Chebyshev), which
// for a pocket is the window's inside neighbour. Returns null if none exists.
const DROP_SNAP_TILES = 3;

function reachableDropPos(state, x, y) {
  const m = state.map;
  if (!m || !m.tiles) return { x, y }; // no map (unit tests): keep the kill position
  const { tx, ty } = map.worldToTile(x, y);
  if (map.isWalkable(m, tx, ty, false)) return { x, y };
  let best = null, bestD = Infinity;
  for (let dy = -DROP_SNAP_TILES; dy <= DROP_SNAP_TILES; dy++) {
    for (let dx = -DROP_SNAP_TILES; dx <= DROP_SNAP_TILES; dx++) {
      if (!map.isWalkable(m, tx + dx, ty + dy, false)) continue;
      const c = map.tileToWorld(tx + dx, ty + dy);
      const d = dist(x, y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

// ---------------------------------------------------------------------------
// Items

export function spawnPowerup(state, type, x, y) {
  const item = { id: nextId(), type, x, y, ttl: POWERUPS.lifetime, bob: 0 };
  state.powerups.items.push(item);
  state.powerups.lastType = type;
  events.emit('powerup:spawned', { item });
  return item;
}

export function updatePowerups(state, dt) {
  const pu = state.powerups;
  const pl = state.player;

  // Item lifetime + pickup.
  for (let i = pu.items.length - 1; i >= 0; i--) {
    const item = pu.items[i];
    item.ttl -= dt;
    item.bob += dt;
    if (item.ttl <= 0) { pu.items.splice(i, 1); continue; }
    if (pl && !pl.down &&
        dist(pl.x, pl.y, item.x, item.y) < POWERUPS.pickupRadius + pl.radius) {
      pu.items.splice(i, 1);
      applyPowerup(state, item.type);
      events.emit('powerup:collected', { type: item.type });
    }
  }

  // Timed expiry.
  for (const type of Object.keys(pu.active)) {
    if (pu.active[type] <= state.time) {
      delete pu.active[type];
      if (type === 'deathMachine') player.clearTemporary(state);
      events.emit('powerup:expired', { type });
    }
  }

  // Staggered nuke kills.
  const nuke = pu.nuke;
  if (nuke) {
    nuke.timer += dt;
    while (nuke.queue.length && nuke.timer >= POWERUPS.nukeStagger) {
      nuke.timer -= POWERUPS.nukeStagger;
      const id = nuke.queue.shift();
      const z = state.zombies.find((zz) => zz.id === id);
      if (z && z.mode !== 'dying') zombie.killZombie(state, z, 'nuke');
    }
    if (!nuke.queue.length) pu.nuke = null;
  }
}

// ---------------------------------------------------------------------------
// Effects

export function applyPowerup(state, type) {
  const pu = state.powerups;
  if (TIMED.has(type)) {
    pu.active[type] = state.time + POWERUPS.duration[type]; // re-pickup resets to full
    if (type === 'deathMachine') player.equipTemporary(state, weapons.createDeathMachine());
    return;
  }
  const p = state.player;
  switch (type) {
    case 'maxAmmo':
      if (p) for (const w of p.weapons) if (w) weapons.refillReserve(w);
      break;
    case 'nuke': {
      const ids = state.zombies.filter((z) => z.mode !== 'dying').map((z) => z.id);
      if (pu.nuke) {
        for (const id of ids) if (!pu.nuke.queue.includes(id)) pu.nuke.queue.push(id);
      } else {
        pu.nuke = { queue: ids, timer: 0 };
      }
      state.effects.push({ type: 'flash', ttl: NUKE_FLASH_TTL, maxTtl: NUKE_FLASH_TTL });
      player.addPoints(state, POINTS.nukeBonus, p?.x, p?.y);
      waves.pauseSpawning(state, POWERUPS.nukeSpawnPause);
      break;
    }
    case 'carpenter':
      map.repairAll(state.map);
      player.addPoints(state, POINTS.carpenterBonus, p?.x, p?.y);
      break;
    default:
      break;
  }
}
