// shop.js (Agent I): wall buys, wall ammo, mystery box, barricade repair.
// Pure logic: no DOM. See WORK_ORDER.md 5.9 and docs/notes/shop.md.
import { PLAYER, POINTS, PRICES, MYSTERY_BOX, SHOP, DOORS } from './config.js';
import * as events from './events.js';
import * as config from './config.js';
import { WEAPONS, WALL_WEAPON_IDS, BOX_WEAPON_IDS, WONDER_WEAPON_IDS, refillAll, ammoCost } from './weapons.js';
import * as weaponsMod from './weapons.js';

// WO5 3.4: only the level-1 wall guns get the 'wall' box weight; level-2 wall guns keep boxOnly.
// weapons.BOX_WALL_WEIGHT_IDS when present (namespace read so an older weapons.js still links).
const BOX_WALL_IDS = Array.isArray(weaponsMod.BOX_WALL_WEIGHT_IDS) ? weaponsMod.BOX_WALL_WEIGHT_IDS : WALL_WEAPON_IDS;
import { spendPoints, giveWeapon, addPoints } from './player.js';
// WO7 perks: player.addPerk / hasPerk (Agent E) read through the namespace, guarded.
import * as playerMod from './player.js';
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
  if (hit.kind === 'perk') {
    return perkPrompt(state, hit.ref);
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
  // WO7 FIX-3 (QA review L2): machines on a level loaded mid-fade show the sold-out state from
  // the first rendered frame, so sync before the transition early-return.
  syncPerkMachines(state);
  // WO5: nothing is interactable while the level fade runs.
  if (state.transition) {
    shop.prompt = null;
    if (state.player) state.player.repairTimer = 0;
    return;
  }
  tickBox(state, dt);

  const player = state.player;
  const map = state.map;
  syncPerkMachines(state);
  if (!player || !map || player.down || player.downT > 0) {
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
  } else if (hit.kind === 'perk') {
    buyPerk(state, hit.ref);
  } else if (hit.kind === 'box') {
    if (shop.box.state === 'idle') spinBox(state);
    else if (shop.box.state === 'offering') takeBoxWeapon(state);
  }
  shop.prompt = buildPrompt(state, hit);
}

// ---------------------------------------------------------------------------
// WO7 1.2 / 3.3: perk machines
// ---------------------------------------------------------------------------

function perkList() {
  return (config.PERKS && config.PERKS.list) || {};
}

function maxPerks() {
  const n = config.PERKS && config.PERKS.maxPerks;
  return Number.isFinite(n) ? n : 4;
}

/** Perk definition from config PERKS.list, or null. */
export function perkDef(perkId) {
  const list = perkList();
  return Object.prototype.hasOwnProperty.call(list, perkId) ? list[perkId] : null;
}

function reviveMaxUses() {
  const d = perkDef('revive');
  return d && Number.isFinite(d.maxUses) ? d.maxUses : 3;
}

function playerPerks(player) {
  return player && Array.isArray(player.perks) ? player.perks : [];
}

function holdsPerk(player, perkId) {
  if (typeof playerMod.hasPerk === 'function') return !!playerMod.hasPerk(player, perkId);
  return playerPerks(player).includes(perkId);
}

/**
 * Price of the next purchase of `perkId` for `player` (WO7 FIX-3, balance #6). A perk with a
 * `costs` array (Quick Revive: [50, 150, 300]) charges costs[purchases so far] (clamped to the
 * last entry; Quick Revive purchases = player.reviveUses); otherwise def.cost. null if unknown.
 */
export function perkCost(player, perkId) {
  const def = perkDef(perkId);
  if (!def) return null;
  const steps = Array.isArray(def.costs) ? def.costs.filter((c) => Number.isFinite(c) && c >= 0) : [];
  if (steps.length) {
    const n = perkId === 'revive' ? Math.max(0, Math.floor(Number(player && player.reviveUses) || 0)) : 0;
    return steps[Math.min(n, steps.length - 1)];
  }
  return Number.isFinite(def.cost) ? def.cost : 0;
}

/** True when Quick Revive can no longer be bought this game (reviveUses >= maxUses). */
export function reviveSoldOut(player) {
  return !!player && (player.reviveUses || 0) >= reviveMaxUses();
}

/**
 * Marks every Quick Revive machine on state.map sold out (or not) from player.reviveUses, and sets
 * machine.price to the next purchase price (perkCost; FIX-3).
 * Bumps map.version when a flag changes so render repaints. Called every updateShop and after a
 * purchase, so machines on a newly loaded level pick up the sold-out state too. Returns a bool
 * (whether anything changed).
 */
export function syncPerkMachines(state) {
  const map = state && state.map;
  if (!map || !Array.isArray(map.perkMachines) || !state.player) return false;
  const out = reviveSoldOut(state.player);
  let changed = false;
  for (const m of map.perkMachines) {
    if (!m) continue;
    const want = m.perkId === 'revive' ? out : false;
    if (!!m.soldOut !== want) { m.soldOut = want; changed = true; }
    // FIX-3: current price (escalating Quick Revive) for the machine plate; bumps version too.
    const price = perkCost(state.player, m.perkId);
    if (price !== null && m.price !== price) { m.price = price; changed = true; }
  }
  if (changed) map.version = (map.version || 0) + 1;
  return changed;
}

/**
 * Why a perk cannot be bought right now: 'soldout' | 'owned' | 'limit' | 'unknown' | null.
 * Order: sold out, already held, cap reached.
 */
export function perkBlockReason(player, machine) {
  const id = machine && machine.perkId;
  if (!perkDef(id)) return 'unknown';
  if (id === 'revive' && (machine.soldOut || reviveSoldOut(player))) return 'soldout';
  if (holdsPerk(player, id)) return 'owned';
  if (playerPerks(player).length >= maxPerks()) return 'limit';
  return null;
}

/** Prompt for a perk machine: "Press F for Juggernog [250]" or a blocked text (1.2). */
export function perkPrompt(state, machine) {
  const player = state && state.player;
  if (!player || !machine) return null;
  const def = perkDef(machine.perkId);
  if (!def) return null;
  const cost = perkCost(player, machine.perkId);
  const pts = player.points || 0;
  const reason = perkBlockReason(player, machine);
  let text = `Press F for ${def.name} [${cost}]`;
  if (reason === 'soldout') text = `${def.name} sold out`;
  else if (reason === 'owned') text = `Already have ${def.name}`;
  else if (reason === 'limit') text = 'Perk limit reached';
  return {
    kind: 'perk', weaponId: null, perkId: machine.perkId, machineId: machine.id, cost,
    canAfford: pts >= cost, blocked: !!reason, text,
  };
}

// Fallback when player.addPerk is missing (sibling not landed): list only, no effects.
function addPerkFallback(state, perkId) {
  const p = state.player;
  if (!Array.isArray(p.perks)) p.perks = [];
  if (p.perks.includes(perkId) || p.perks.length >= maxPerks()) return false;
  p.perks.push(perkId);
  if (state.stats) state.stats.perksBought = (state.stats.perksBought || 0) + 1;
  return true;
}

/**
 * Buys the perk sold by `machine` (3.3). Blocked (sold out / already held / cap) -> false with no
 * charge and no event. Cannot afford -> purchase:denied {kind:'perk', cost, have}. Otherwise
 * spendPoints, player.addPerk (refund if it refuses), Quick Revive increments player.reviveUses
 * and sells out every revive machine at maxUses, then purchase:made {kind:'perk', id, cost} and
 * perk:bought {perkId, cost}.
 */
export function buyPerk(state, machine) {
  const player = state && state.player;
  if (!player || !machine || state.transition || player.down || player.downT > 0) return false;
  const def = perkDef(machine.perkId);
  if (!def) return false;
  if (perkBlockReason(player, machine)) return false;
  const perkId = machine.perkId;
  const cost = perkCost(player, perkId); // FIX-3: escalating Quick Revive price
  const have = player.points;
  if (have < cost || !spendPoints(state, cost)) {
    events.emit('purchase:denied', { kind: 'perk', cost, have });
    return false;
  }
  const add = typeof playerMod.addPerk === 'function' ? playerMod.addPerk : addPerkFallback;
  if (add(state, perkId) === false) {
    player.points += cost; // player refused (cap / duplicate): refund, no event
    return false;
  }
  if (perkId === 'revive') {
    player.reviveUses = (player.reviveUses || 0) + 1;
    syncPerkMachines(state);
  }
  events.emit('purchase:made', { kind: 'perk', id: perkId, cost });
  events.emit('perk:bought', { perkId, cost });
  return true;
}
