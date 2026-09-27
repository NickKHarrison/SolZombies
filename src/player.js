// player.js (Agent B) — pure logic, no DOM.
// Movement, aiming, firing/reload/swap orchestration, health + regen, points, inventory.

import { PLAYER, POINTS, PERKS, MELEE, BOSS } from './config.js';
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
    // WO7 T2/T3
    perks: [],          // perk ids in purchase order (PERKS.list keys)
    reviveUses: 0,      // Quick Revive purchases this game (incremented by shop.buyPerk)
    invulnT: 0,         // seconds of post-revive invulnerability left
    downT: 0,           // seconds of Quick Revive "down" pause left
    meleeCd: 0,         // knife cooldown left (set by weapons.meleeAttack)
    meleeT: 0,          // knife swing animation time left (set by weapons.meleeAttack)
    // WO9 frost (THE WENDIGO): seconds of frost slow left (movement x BOSS.frost.slowMult).
    slowT: 0,
  };
}

// --- WO7 perks -------------------------------------------------------------

const perkDef = (id) => (PERKS && PERKS.list && PERKS.list[id]) || null;

export function hasPerk(player, perkId) {
  return !!(player && Array.isArray(player.perks) && player.perks.includes(perkId));
}

// Combined multipliers from the perks the player holds (all 1 / base values with none).
export function perkMods(player) {
  const m = {
    reloadMult: 1, rpmMult: 1, bulletDamageMult: 1, speedMult: 1, sprintMult: 1,
    weaponSlots: PLAYER.weaponSlots, maxHealth: PLAYER.maxHealth,
  };
  const list = (player && Array.isArray(player.perks)) ? player.perks : [];
  for (const id of list) {
    const d = perkDef(id);
    if (!d) continue;
    if (d.reloadMult) m.reloadMult *= d.reloadMult;
    if (d.rpmMult) m.rpmMult *= d.rpmMult;
    if (d.bulletDamageMult) m.bulletDamageMult *= d.bulletDamageMult;
    if (d.speedMult) m.speedMult *= d.speedMult;
    if (d.sprintMult) m.sprintMult *= d.sprintMult;
    if (d.weaponSlots) m.weaponSlots = Math.max(m.weaponSlots, d.weaponSlots);
    if (d.maxHealth) m.maxHealth = Math.max(m.maxHealth, d.maxHealth);
  }
  return m;
}

// Adds a perk: refuses unknown ids, duplicates and a full bar (PERKS.maxPerks). Applies the
// immediate effects (Juggernog: new maxHealth + full heal; Mule Kick: third weapon slot) and
// counts stats.perksBought. Quick Revive's use limit is enforced by shop.buyPerk (reviveUses).
export function addPerk(state, perkId) {
  const p = state && state.player;
  if (!p || !perkDef(perkId)) return false;
  if (!Array.isArray(p.perks)) p.perks = [];
  if (p.perks.includes(perkId) || p.perks.length >= PERKS.maxPerks) return false;
  p.perks.push(perkId);
  applyPerkStats(p);
  if (perkId === 'jugg') p.health = p.maxHealth;
  if (state.stats) state.stats.perksBought = (state.stats.perksBought || 0) + 1;
  return true;
}

// Syncs maxHealth / weapon slot count to the held perks. Health is clamped to the new max.
function applyPerkStats(p) {
  const m = perkMods(p);
  p.maxHealth = m.maxHealth;
  if (p.health > p.maxHealth) p.health = p.maxHealth;
  while (p.weapons.length < m.weaponSlots) p.weapons.push(null);
  if (p.weapons.length > m.weaponSlots) p.weapons.length = m.weaponSlots;
}

// Removes every perk (Quick Revive self-revive, debug). Emits perk:lost per perk. Losing Mule
// Kick drops the third weapon (switching to the first filled slot if it was active); losing Juggernog clamps
// maxHealth/health back to PLAYER.maxHealth.
export function removeAllPerks(state, reason = 'debug') {
  const p = state && state.player;
  if (!p || !Array.isArray(p.perks) || p.perks.length === 0) return;
  const lost = p.perks.slice();
  p.perks = [];
  const slots = perkMods(p).weaponSlots;
  if (p.weapons.length > slots && p.activeSlot >= slots) {
    cancelReload(p.weapons[p.activeSlot]);
    p.weapons.length = slots;
    // WO8 FIX-A (QA review M1): slot 0 may be empty (its gun is inside the Pack-a-Punch), so
    // switch to the first FILLED slot; none filled -> slot 0 with empty hands, no event.
    let k = 0;
    for (let i = 0; i < slots; i++) if (p.weapons[i]) { k = i; break; }
    p.activeSlot = k;
    const w = p.weapons[k];
    if (w && !p.tempWeapon) emit('weapon:equipped', { weaponId: w.id, slot: k });
  }
  applyPerkStats(p);
  for (const perkId of lost) emit('perk:lost', { perkId, reason });
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
    // WO7 knife: the kill itself is paid by zombie:killed (perKill); a knife kill adds
    // MELEE.bonusPoints on top and counts stats.meleeKills.
    on('melee:hit', (p) => {
      if (!p || !p.killed) return;
      state.stats.meleeKills = (state.stats.meleeKills || 0) + 1;
      const pl = state.player;
      const x = p.x !== undefined ? p.x : pl && pl.x;
      const y = p.y !== undefined ? p.y : pl && pl.y;
      addPoints(state, MELEE.bonusPoints, x, y);
    }),
    on('round:start', () => {
      if (state.player) state.player.boardsThisRound = 0;
    }),
    // WO9: the frost slow never survives a restart or a level change.
    on('game:restart', () => { if (state.player) state.player.slowT = 0; }),
    on('level:descend', () => { if (state.player) state.player.slowT = 0; }),
    on('level:teleport', () => { if (state.player) state.player.slowT = 0; }),
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

  // WO7 Quick Revive: while down nothing moves or fires; when the pause ends, revive.
  if (p.downT > 0) {
    p.moving = false;
    p.sprinting = false;
    const w0 = getActiveWeapon(p);
    if (w0) w0.triggerHeld = false;
    p.downT = Math.max(0, p.downT - dt);
    if (p.downT <= 0) revive(state);
    return;
  }
  if (p.invulnT > 0) p.invulnT = Math.max(0, p.invulnT - dt);
  // WO9 frost slow: the multiplier applies for this whole frame, then the timer counts down.
  const slowed = p.slowT > 0;
  if (slowed) p.slowT = Math.max(0, p.slowT - dt);
  if (p.meleeCd > 0) p.meleeCd = Math.max(0, p.meleeCd - dt);
  if (p.meleeT > 0) p.meleeT = Math.max(0, p.meleeT - dt);

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
    const mods = perkMods(p);
    const speed = PLAYER.speed * mods.speedMult * (p.sprinting ? PLAYER.sprintMult * mods.sprintMult : 1)
      * (slowed ? slowMult() : 1);
    let nx = p.x + mv.x * speed * dt;
    let ny = p.y + mv.y * speed * dt;
    if (state.map) {
      const r = map.resolveCircle(state.map, nx, ny, p.radius);
      nx = r.x; ny = r.y;
    }
    p.x = nx; p.y = ny;
  }

  // --- Knife (V / KNIFE). weapons.meleeAttack enforces the cooldown and cancels reloads. ---
  if (input.melee && typeof weapons.meleeAttack === 'function') weapons.meleeAttack(state, p);

  // --- Swap (1/2/3 digit, Q/wheel; slot 3 only exists with Mule Kick). Not allowed while holding a temporary weapon. ---
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

  if (input.reload && !p.tempWeapon) weapons.startReload(w, state);

  // No shooting during the knife swing.
  if (input.fire && !(p.meleeT > 0)) {
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    const off = p.radius + MUZZLE_OFFSET;
    const fired = weapons.tryFire(state, w, p.x + dx * off, p.y + dy * off, dx, dy);
    if (!fired && w.mag <= 0 && !w.reloading && w.reserve > 0) weapons.startReload(w, state);
  }
  w.triggerHeld = !!input.fire;
  // WO6: touch auto-fire releases the trigger each frame so semi-autos cycle at their rpm.
  // Keep it held on an empty mag so 'weapon:empty' is not re-emitted every frame.
  if (input.autoFire && w.mag > 0) w.triggerHeld = false;
}

export function damagePlayer(state, amount) {
  const p = state.player;
  if (!p || p.down || p.invulnerable || p.downT > 0 || p.invulnT > 0 || !(amount > 0)) return;
  p.health = clamp(p.health - amount, 0, p.maxHealth);
  p.regenTimer = PLAYER.regenDelay;
  emit('player:damaged', { amount, health: p.health });
  if (p.health <= 0 && hasPerk(p, 'revive')) {
    // WO7 Quick Revive: a short down pause instead of game over (see updatePlayer / revive).
    const reviveIn = perkDef('revive').downSeconds;
    p.downT = reviveIn;
    p.moving = false;
    p.sprinting = false;
    emit('player:downed', { reviveIn });
    return;
  }
  if (p.health <= 0) {
    p.down = true;
    p.moving = false;
    p.sprinting = false;
    const round = (state.rounds && state.rounds.round) || state.stats.roundReached || 0;
    emit('player:down', { round, kills: state.stats.kills, points: p.points });
  }
}

// End of the Quick Revive pause: all perks go (incl. revive itself), full health at the base
// max, invulnT = invulnSeconds. reviveUses is unchanged (counted at purchase).
function revive(state) {
  const p = state.player;
  const invuln = perkDef('revive').invulnSeconds;
  removeAllPerks(state, 'revive');
  p.downT = 0;
  p.health = p.maxHealth;
  p.regenTimer = 0;
  p.invulnT = invuln;
  p.slowT = 0;
  emit('player:revived', { health: p.health });
}

// WO9: movement multiplier while player.slowT > 0 (stacks multiplicatively with Stamin-Up).
export function slowMult() {
  const m = BOSS && BOSS.frost && BOSS.frost.slowMult;
  return Number.isFinite(m) && m > 0 ? m : 0.55;
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
