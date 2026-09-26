// player.js (Agent B) — pure logic, no DOM.
// Movement, aiming, firing/reload/swap orchestration, health + regen, points, inventory.

import { PLAYER, POINTS } from './config.js';
import { emit, on } from './events.js';
import { nextId, norm, clamp } from './math.js';
import * as weapons from './weapons.js';
import * as map from './map.js';
import * as powerups from './powerups.js';

// Distance beyond the player's radius at which shots originate (WORK_ORDER 5.3).
const MUZZLE_OFFSET = PLAYER.muzzleOffset; // config.js (moved by integrator)
// Slot value reported in weapon:equipped when the temporary (death machine) weapon is equipped.
const TEMP_SLOT = -1;

// Unsubscribers from the most recent initPlayer, so a re-init never duplicates listeners
// even if events.clearAll() was not called first.
let unsubs = [];

export function createPlayer(x, y) {
  return {
    id: nextId(),
    x, y,
    radius: PLAYER.radius,
    angle: 0,
    health: PLAYER.maxHealth,
    maxHealth: PLAYER.maxHealth,
    regenTimer: 0,
    points: 0,
    weapons: new Array(PLAYER.weaponSlots).fill(null),
    activeSlot: 0,
    tempWeapon: null,
    down: false,
    moving: false,
    sprinting: false,
    invulnerable: false,
    repairTimer: 0,
    boardsThisRound: 0,
  };
}

export function initPlayer(state) {
  for (const u of unsubs) u();
  unsubs = [
    on('zombie:killed', (p) => {
      if (!p || p.cause === 'debug') return;
      state.stats.kills++;
      addPoints(state, POINTS.perKill, p.x, p.y);
    }),
    on('zombie:hit', (p) => {
      if (POINTS.perHit) addPoints(state, POINTS.perHit, p && p.x, p && p.y);
    }),
    on('round:start', () => {
      if (state.player) state.player.boardsThisRound = 0;
    }),
  ];
}

function cancelReload(w) {
  if (w && w.reloading) { w.reloading = false; w.reloadT = 0; }
}

function selectSlot(state, slot) {
  const p = state.player;
  if (p.tempWeapon) return false;
  if (slot === p.activeSlot || slot < 0 || slot >= p.weapons.length || !p.weapons[slot]) return false;
  cancelReload(p.weapons[p.activeSlot]);
  p.activeSlot = slot;
  emit('weapon:equipped', { weaponId: p.weapons[slot].id, slot });
  return true;
}

export function updatePlayer(state, input, aim, dt) {
  const p = state.player;
  if (!p || p.down) return;
  input = input || {};

  tickRegen(p, dt);

  // --- Aim ---
  if (aim) {
    const ax = aim.x - p.x, ay = aim.y - p.y;
    if (ax !== 0 || ay !== 0) p.angle = Math.atan2(ay, ax);
  }

  // --- Movement ---
  const mv = norm(input.moveX || 0, input.moveY || 0);
  p.moving = mv.x !== 0 || mv.y !== 0;
  p.sprinting = !!input.sprint && p.moving && !input.fire; // firing cancels sprint
  if (p.moving) {
    const speed = PLAYER.speed * (p.sprinting ? PLAYER.sprintMult : 1);
    let nx = p.x + mv.x * speed * dt;
    let ny = p.y + mv.y * speed * dt;
    if (state.map) {
      const r = map.resolveCircle(state.map, nx, ny, p.radius);
      nx = r.x; ny = r.y;
    }
    p.x = nx; p.y = ny;
  }

  // --- Swap (1/2 digit, Q/wheel). Not allowed while holding a temporary weapon. ---
  if (!p.tempWeapon) {
    const slot = input.slot | 0;
    if (slot >= 1) selectSlot(state, slot - 1);
    else if (input.swap) {
      const n = p.weapons.length;
      for (let i = 1; i < n; i++) {
        if (selectSlot(state, (p.activeSlot + i) % n)) break;
      }
    }
  }

  // --- Weapon tick, reload, fire ---
  const w = getActiveWeapon(p);
  if (!w) return;
  weapons.updateWeapon(w, dt);

  if (input.reload && !p.tempWeapon) weapons.startReload(w);

  if (input.fire) {
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    const off = p.radius + MUZZLE_OFFSET;
    const fired = weapons.tryFire(state, w, p.x + dx * off, p.y + dy * off, dx, dy);
    if (!fired && w.mag <= 0 && !w.reloading && w.reserve > 0) weapons.startReload(w);
  }
  w.triggerHeld = !!input.fire;
}

export function damagePlayer(state, amount) {
  const p = state.player;
  if (!p || p.down || p.invulnerable || !(amount > 0)) return;
  p.health = clamp(p.health - amount, 0, p.maxHealth);
  p.regenTimer = PLAYER.regenDelay;
  emit('player:damaged', { amount, health: p.health });
  if (p.health <= 0) {
    p.down = true;
    p.moving = false;
    p.sprinting = false;
    const round = (state.rounds && state.rounds.round) || state.stats.roundReached || 0;
    emit('player:down', { round, kills: state.stats.kills, points: p.points });
  }
}

// Health regen, ticked from updatePlayer: after regenDelay without damage, +regenPerSec.
function tickRegen(p, dt) {
  if (p.regenTimer > 0) {
    p.regenTimer = Math.max(0, p.regenTimer - dt);
    return;
  }
  if (p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + PLAYER.regenPerSec * dt);
}

export function addPoints(state, amount, x, y) {
  const p = state.player;
  if (!p || !amount) return 0;
  const delta = Math.round(amount * (powerups.isActive(state, 'doublePoints') ? 2 : 1));
  p.points += delta;
  state.stats.pointsEarned += delta;
  const payload = { delta, total: p.points };
  if (x !== undefined && y !== undefined) { payload.x = x; payload.y = y; }
  emit('points:changed', payload);
  return delta;
}

export function spendPoints(state, amount) {
  const p = state.player;
  if (!p || !(amount >= 0) || p.points < amount) return false;
  if (amount === 0) return true;
  p.points -= amount;
  emit('points:changed', { delta: -amount, total: p.points });
  return true;
}

export function getActiveWeapon(player) {
  if (!player) return null;
  return player.tempWeapon || player.weapons[player.activeSlot] || null;
}

export function giveWeapon(state, weaponId) {
  const p = state.player;
  const w = typeof weaponId === 'string' ? weapons.createWeapon(weaponId) : weaponId;
  let slot = p.weapons.indexOf(null);
  if (slot === -1) slot = p.activeSlot;
  else cancelReload(p.weapons[p.activeSlot]);
  p.weapons[slot] = w;
  p.activeSlot = slot;
  emit('weapon:equipped', { weaponId: w.id, slot });
  return w;
}

export function hasWeapon(player, weaponId) {
  if (!player) return false;
  return player.weapons.some((w) => w && w.id === weaponId);
}

export function equipTemporary(state, weapon) {
  const p = state.player;
  if (!p || !weapon) return;
  cancelReload(p.weapons[p.activeSlot]);
  p.tempWeapon = weapon;
  emit('weapon:equipped', { weaponId: weapon.id, slot: TEMP_SLOT });
}

export function clearTemporary(state) {
  const p = state.player;
  if (!p || !p.tempWeapon) return;
  p.tempWeapon = null;
  const w = p.weapons[p.activeSlot];
  if (w) emit('weapon:equipped', { weaponId: w.id, slot: p.activeSlot });
}
