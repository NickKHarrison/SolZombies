// shop.js (Agent I): wall buys, wall ammo, mystery box, barricade repair.
// Pure logic: no DOM. See WORK_ORDER.md 5.9 and docs/notes/shop.md.
import { PLAYER, POINTS, PRICES, MYSTERY_BOX, SHOP, DOORS } from './config.js';
import * as events from './events.js';
import { WEAPONS, WALL_WEAPON_IDS, BOX_WEAPON_IDS, WONDER_WEAPON_IDS, refillAll, ammoCost } from './weapons.js';
import * as weaponsMod from './weapons.js';

// WO5 3.4: only the level-1 wall guns get the 'wall' box weight; level-2 wall guns keep boxOnly.
// weapons.BOX_WALL_WEIGHT_IDS when present (namespace read so an older weapons.js still links).
const BOX_WALL_IDS = Array.isArray(weaponsMod.BOX_WALL_WEIGHT_IDS) ? weaponsMod.BOX_WALL_WEIGHT_IDS : WALL_WEAPON_IDS;
import { spendPoints, giveWeapon, addPoints } from './player.js';
import { nearestInteractable, repairBoard } from './map.js';
// WO4 doors: namespace import so shop.js links even before map.js exports openDoor.
import * as mapMod from './map.js';
// WO5: level transition (stairs). Namespace import, called lazily.
import * as levelMod from './level.js';

// Tunables live in config.js SHOP (moved by integrator); re-exported for tests.
export const REPAIR_INTERVAL = SHOP.repairInterval;       // seconds of holding F per board
export const BOX_CYCLE_INTERVAL = SHOP.boxCycleInterval;  // seconds between cosmetic weapon swaps while spinning
// Per-CLASS weights { wall, boxOnly, wonder } (config SHOP.boxWeights). Not to be confused with
// weapons.BOX_WEIGHTS, which is the per-weapon-id map (same shape as boxWeights() below).
// BOX_CLASS_WEIGHTS is the unambiguous alias; BOX_WEIGHTS is kept for existing importers.
export const BOX_WEIGHTS = SHOP.boxWeights;
export const BOX_CLASS_WEIGHTS = BOX_WEIGHTS;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests; not part of the 3.6 contract)
// ---------------------------------------------------------------------------

/** Ids of the weapons in the player's two slots (tempWeapon ignored). */
export function heldWeaponIds(player) {
  if (!player || !Array.isArray(player.weapons)) return [];
  return player.weapons.filter(Boolean).map((w) => w.id);
}

/** { id: weight } for every box weapon, per 5.4 (3 wall gun, 2 box-only, 1 wonder weapon: ray gun / thundergun). */
export function boxWeights(boxIds = BOX_WEAPON_IDS, wallIds = BOX_WALL_IDS) {
  const wall = new Set(wallIds);
  const wonder = new Set(WONDER_WEAPON_IDS);
  const out = {};
  for (const id of boxIds) {
    out[id] = wonder.has(id) ? BOX_WEIGHTS.wonder : wall.has(id) ? BOX_WEIGHTS.wall : BOX_WEIGHTS.boxOnly;
  }
  return out;
}

// Default per-id weights, computed once (the weapon lists are static) so the per-frame tickBox and
// the box roll do not rebuild them. Frozen: callers must not mutate it.
const DEFAULT_BOX_WEIGHTS = Object.freeze(boxWeights());
const DEFAULT_BOX_IDS = Object.freeze(Object.keys(DEFAULT_BOX_WEIGHTS));

/**
 * Weighted box roll that never returns a held weapon. Equivalent to "re-roll until not held":
 * held ids are removed from the pool before the weighted pick. Falls back to the full pool if
 * everything is held (impossible with 2 slots, kept for safety). Returns null on an empty pool.
 */
export function pickBoxWeapon(rng, heldIds = [], weights = DEFAULT_BOX_WEIGHTS) {
  const held = new Set(heldIds);
  const filtered = {};
  let any = false;
  for (const [id, w] of Object.entries(weights)) {
    if (w > 0 && !held.has(id)) { filtered[id] = w; any = true; }
  }
  const id = rng.weighted(any ? filtered : weights);
  return id === undefined ? null : id;
}

/** Fire Sale check read straight from state (same semantics as powerups.isActive). */
export function fireSaleActive(state) {
  const active = state && state.powerups && state.powerups.active;
  const exp = active ? active.fireSale : undefined;
  return typeof exp === 'number' && exp > (state.time || 0);
}

function weaponName(id) {
  const def = WEAPONS[id];
  return (def && def.name) || String(id);
}

function weaponCost(id) {
  const def = WEAPONS[id];
  return def && typeof def.cost === 'number' ? def.cost : null;
}

function ownedWeapon(player, weaponId) {
  if (!player || !Array.isArray(player.weapons)) return null;
  return player.weapons.find((w) => w && w.id === weaponId) || null;
}

function reserveFull(w) {
  return !!(w && w.def && w.reserve >= w.def.reserve);
}

function resetBox(box) {
  box.state = 'idle';
  box.timer = 0;
  box.weaponId = null;
  box.cycleT = 0;
}

/**
 * Advances the mystery box state machine. `weights` is injectable for tests.
 * idle -> spinning (spinSeconds, cosmetic cycle every 0.1 s) -> offering (offerSeconds) -> idle.
 * Emits box:opened when the offer is revealed. An expired offer is lost.
 */
export function tickBox(state, dt, weights = DEFAULT_BOX_WEIGHTS) {
  const box = state.shop.box;
  if (box.state === 'spinning') {
    box.timer -= dt;
    box.cycleT = (box.cycleT || 0) + dt;
    if (box.timer <= 0) {
      box.state = 'offering';
      box.timer = MYSTERY_BOX.offerSeconds;
      box.cycleT = 0;
      box.weaponId = pickBoxWeapon(state.rng, heldWeaponIds(state.player), weights);
      events.emit('box:opened', { weaponId: box.weaponId });
    } else if (box.cycleT >= BOX_CYCLE_INTERVAL) {
      box.cycleT = 0;
      const ids = weights === DEFAULT_BOX_WEIGHTS ? DEFAULT_BOX_IDS : Object.keys(weights);
      if (ids.length) box.weaponId = state.rng.pick(ids);
    }
  } else if (box.state === 'offering') {
    box.timer -= dt;
    if (box.timer <= 0) resetBox(box);
  }
}

/**
 * Builds the prompt for an interactable hit ({kind, ref, dist} from map.nearestInteractable).
 * Shape documented in docs/notes/shop.md.
 */
export function buildPrompt(state, hit) {
  if (!hit || !state.player) return null;
  const pts = state.player.points || 0;
  if (hit.kind === 'wallbuy') {
    const id = hit.ref.weaponId;
    const owned = ownedWeapon(state.player, id);
    if (owned) {
      const cost = ammoCost(id);
      const full = reserveFull(owned);
      return {
        kind: 'ammo', weaponId: id, cost, canAfford: pts >= cost, blocked: full,
        text: full ? `${weaponName(id)} ammo full` : `Press F to buy ammo [${cost}]`,
      };
    }
    const cost = weaponCost(id);
    return {
      kind: 'wallbuy', weaponId: id, cost, canAfford: cost != null && pts >= cost, blocked: false,
      text: `Press F to buy ${weaponName(id)} [${cost}]`,
    };
  }
  if (hit.kind === 'box') {
    const box = state.shop.box;
    if (box.state === 'idle') {
      const cost = boxPrice(state);
      return {
        kind: 'box', weaponId: null, cost, canAfford: pts >= cost, blocked: false,
        text: `Press F for Mystery Box [${cost}]${fireSaleActive(state) ? ' FIRE SALE' : ''}`,
      };
    }
    if (box.state === 'offering' && box.weaponId) {
      return {
        kind: 'boxOffer', weaponId: box.weaponId, cost: 0, canAfford: true, blocked: false,
        text: `Press F to take ${weaponName(box.weaponId)}`,
      };
    }
    return null; // spinning: nothing to press
  }
  if (hit.kind === 'door') {
    const d = hit.ref;
    if (!d || d.open) return null;
    const cost = d.cost;
    return {
      kind: 'door', weaponId: null, doorId: d.id, cost, canAfford: pts >= cost, blocked: false,
      text: `Press F to open door [${cost}]`,
    };
  }
  if (hit.kind === 'megadoor') {
    const d = hit.ref;
    if (!d || d.open || d.sealed) return null;
    const cost = DOORS.megaCost;
    const blocked = !allDoorsOpenFor(state.map);
    return {
      kind: 'megadoor', weaponId: null, doorId: d.id != null ? d.id : 'mega', cost,
      canAfford: pts >= cost, blocked,
      text: blocked ? MEGA_BLOCKED_TEXT : `Press F to open MEGA DOOR [${cost}]`,
    };
  }
  if (hit.kind === 'stairs') {
    const st = hit.ref;
    if (!st || !st.open) return null;
    return {
      kind: 'stairs', weaponId: null, cost: 0, canAfford: true, blocked: false,
      text: STAIRS_TEXT,
    };
  }
  if (hit.kind === 'barricade') {
    const b = hit.ref;
    if (b && b.boards < b.maxBoards) {
      return {
        kind: 'barricade', weaponId: null, cost: 0, canAfford: true, blocked: false,
        barricadeId: b.id, text: 'Hold F to rebuild barricade',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contract API (3.6)
// ---------------------------------------------------------------------------

export function initShop(state) {
  if (!state.shop) state.shop = {};
  state.shop.prompt = null;
  state.shop.box = { state: 'idle', timer: 0, weaponId: null, cycleT: 0 };
  if (state.player) state.player.repairTimer = 0;
}

export function boxPrice(state) {
  return fireSaleActive(state) ? PRICES.fireSaleBox : PRICES.mysteryBox;
}

export function buyWallWeapon(state, wallBuy) {
  const player = state.player;
  if (!player || !wallBuy) return false;
  const id = wallBuy.weaponId;
  if (ownedWeapon(player, id)) return buyAmmo(state, id);
  const cost = weaponCost(id);
  if (cost == null) return false;
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'weapon', cost, have });
    return false;
  }
  giveWeapon(state, id);
  events.emit('purchase:made', { kind: 'weapon', id, cost });
  return true;
}

export function buyAmmo(state, weaponId) {
  const player = state.player;
  const w = ownedWeapon(player, weaponId);
  if (!w) return false;
  if (reserveFull(w)) return false; // refused, no charge, no event
  const cost = ammoCost(weaponId);
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'ammo', cost, have });
    return false;
  }
  refillAll(w);
  events.emit('purchase:made', { kind: 'ammo', id: weaponId, cost });
  return true;
}

export function spinBox(state) {
  const box = state.shop.box;
  const player = state.player;
  if (!player || box.state !== 'idle') return false;
  const cost = boxPrice(state);
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'box', cost, have });
    return false;
  }
  box.state = 'spinning';
  box.timer = MYSTERY_BOX.spinSeconds;
  box.cycleT = 0;
  const ids = DEFAULT_BOX_IDS;
  box.weaponId = ids.length ? state.rng.pick(ids) : null;
  events.emit('purchase:made', { kind: 'box', id: 'box', cost });
  return true;
}

export function takeBoxWeapon(state) {
  const box = state.shop.box;
  if (box.state !== 'offering' || !box.weaponId || !state.player) return false;
  const id = box.weaponId;
  const owned = ownedWeapon(state.player, id);
  // Player bought the same gun off a wall during the offer: top it up instead of duplicating.
  if (owned) refillAll(owned);
  else giveWeapon(state, id);
  resetBox(box);
  return true;
}

// WO4: floating label shown where a door was opened (render draws type 'text').
export const DOOR_TEXT = 'DOOR OPENED';
const DOOR_TEXT_TTL = 1.2;
const DOOR_TEXT_COLOR = '#ffd36b';

function doorCentre(door) {
  if (Number.isFinite(door.cx) && Number.isFinite(door.cy)) return { x: door.cx, y: door.cy };
  if (Number.isFinite(door.x) && Number.isFinite(door.y)) {
    return { x: door.x + (door.w || 0) / 2, y: door.y + (door.h || 0) / 2 };
  }
  return { x: NaN, y: NaN };
}

// state.map.openDoor (a function on the map object) wins over map.js's export: test injection.
function openDoorFn(map) {
  if (map && typeof map.openDoor === 'function') return map.openDoor;
  return typeof mapMod.openDoor === 'function' ? mapMod.openDoor : null;
}

/**
 * Buys a closed door (WO4 2.3): spendPoints, then map.openDoor(state.map, door.id).
 * Emits purchase:made {kind:'door', id, cost} or purchase:denied {kind:'door', cost, have},
 * and pushes a 'DOOR OPENED' text effect at the door centre. Returns a bool.
 */
export function buyDoor(state, door) {
  const player = state.player;
  if (!player || !door || door.open || !state.map) return false;
  const open = openDoorFn(state.map);
  if (!open) return false;
  const cost = door.cost;
  if (!(cost >= 0)) return false;
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'door', cost, have });
    return false;
  }
  if (open(state.map, door.id) === false) {
    player.points += cost; // could not open (unknown id): refund, no event
    return false;
  }
  events.emit('purchase:made', { kind: 'door', id: door.id, cost });
  const c = doorCentre(door);
  if (!Array.isArray(state.effects)) state.effects = [];
  state.effects.push({
    type: 'text', x: c.x, y: c.y, text: DOOR_TEXT, color: DOOR_TEXT_COLOR,
    ttl: DOOR_TEXT_TTL, maxTtl: DOOR_TEXT_TTL,
  });
  return true;
}

// ---------------------------------------------------------------------------
// WO5 3.3: mega door and stairs
// ---------------------------------------------------------------------------

export const MEGA_BLOCKED_TEXT = 'MEGA DOOR — open all doors first';
export const MEGA_TEXT = 'MEGA DOOR OPENED';
export const STAIRS_TEXT = 'Press F to descend';

// map.allDoorsOpen when map.js has it, else every map.doors[] entry is open.
function allDoorsOpenFor(map) {
  if (!map) return false;
  if (typeof mapMod.allDoorsOpen === 'function') return !!mapMod.allDoorsOpen(map);
  return !Array.isArray(map.doors) || map.doors.every((d) => d && d.open);
}

// state.map.openMegaDoor (a function on the map object) wins over map.js's export: test injection.
function openMegaDoorFn(map) {
  if (map && typeof map.openMegaDoor === 'function') return map.openMegaDoor;
  return typeof mapMod.openMegaDoor === 'function' ? mapMod.openMegaDoor : null;
}

/**
 * Buys the mega door: requires every normal door open and the mega door neither open nor sealed.
 * spendPoints(DOORS.megaCost), then map.openMegaDoor(state.map). Emits purchase:made
 * {kind:'megadoor', id:'mega', cost} or purchase:denied {kind:'megadoor', cost, have}.
 * While blocked (a normal door still closed) it returns false with no charge and no event.
 */
export function buyMegaDoor(state) {
  const player = state && state.player;
  const map = state && state.map;
  const d = map && map.megaDoor;
  if (!player || !d || d.open || d.sealed || state.transition) return false;
  if (!allDoorsOpenFor(map)) return false;
  const open = openMegaDoorFn(map);
  if (!open) return false;
  const cost = DOORS.megaCost;
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'megadoor', cost, have });
    return false;
  }
  if (open(map) === false) {
    player.points += cost; // map refused (not unlockable): refund, no event
    return false;
  }
  events.emit('purchase:made', { kind: 'megadoor', id: 'mega', cost });
  const c = doorCentre(d);
  if (!Array.isArray(state.effects)) state.effects = [];
  state.effects.push({
    type: 'text', x: c.x, y: c.y, text: MEGA_TEXT, color: DOOR_TEXT_COLOR,
    ttl: DOOR_TEXT_TTL, maxTtl: DOOR_TEXT_TTL,
  });
  return true;
}

/** Stairs: starts the descent (level.beginDescent) when the stairs are open. Returns a bool. */
export function useStairs(state) {
  const st = state && state.map && state.map.stairs;
  if (!st || !st.open || state.transition) return false;
  if (typeof levelMod.beginDescent !== 'function') return false;
  return levelMod.beginDescent(state) !== false;
}

export function updateShop(state, input, dt) {
  const shop = state.shop;
  if (!shop.box) shop.box = { state: 'idle', timer: 0, weaponId: null, cycleT: 0 };
  // WO5: nothing is interactable while the level fade runs.
  if (state.transition) {
    shop.prompt = null;
    if (state.player) state.player.repairTimer = 0;
    return;
  }
  tickBox(state, dt);

  const player = state.player;
  const map = state.map;
  if (!player || !map || player.down) {
    shop.prompt = null;
    if (player) player.repairTimer = 0;
    return;
  }

  const hit = nearestInteractable(map, player.x, player.y, PLAYER.interactRange);
  shop.prompt = buildPrompt(state, hit);
  const inp = input || {};

  // Barricade repair (held). Zombies may tear the same barricade concurrently (BO3 race).
  if (hit && hit.kind === 'barricade' && shop.prompt && inp.interactHeld) {
    const b = hit.ref;
    player.repairTimer = (player.repairTimer || 0) + dt;
    while (player.repairTimer >= REPAIR_INTERVAL) {
      player.repairTimer -= REPAIR_INTERVAL;
      if (!repairBoard(map, b.id)) { player.repairTimer = 0; break; }
      if ((player.boardsThisRound || 0) < POINTS.barricadeBoardsPerRoundCap) {
        addPoints(state, POINTS.barricadeBoard, b.x + b.w / 2, b.y + b.h / 2);
      }
      player.boardsThisRound = (player.boardsThisRound || 0) + 1;
      if (b.boards >= b.maxBoards) { player.repairTimer = 0; break; }
    }
    shop.prompt = buildPrompt(state, hit);
    return;
  }
  player.repairTimer = 0;

  if (!inp.interact || !hit) return;
  if (hit.kind === 'wallbuy') {
    buyWallWeapon(state, hit.ref);
  } else if (hit.kind === 'door') {
    buyDoor(state, hit.ref);
  } else if (hit.kind === 'megadoor') {
    buyMegaDoor(state);
  } else if (hit.kind === 'stairs') {
    useStairs(state);
    if (state.transition) { shop.prompt = null; return; }
  } else if (hit.kind === 'box') {
    if (shop.box.state === 'idle') spinBox(state);
    else if (shop.box.state === 'offering') takeBoxWeapon(state);
  }
  shop.prompt = buildPrompt(state, hit);
}
