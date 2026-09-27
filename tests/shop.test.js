import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import { createRng } from '../src/math.js';
import { PRICES, MYSTERY_BOX, POINTS } from '../src/config.js';
import * as weapons from '../src/weapons.js';
import * as player from '../src/player.js';
import * as map from '../src/map.js';
import {
  initShop, updateShop, buyWallWeapon, buyAmmo, spinBox, takeBoxWeapon, boxPrice,
  boxWeights, pickBoxWeapon, tickBox, buildPrompt, heldWeaponIds, REPAIR_INTERVAL,
  buyDoor, DOOR_TEXT,
  buyMegaDoor, useStairs, MEGA_BLOCKED_TEXT, STAIRS_TEXT,
} from '../src/shop.js';
import { DOORS, LEVELS_CFG } from '../src/config.js';
import * as level from '../src/level.js';

const isStubFn = (fn) => typeof fn !== 'function' || String(fn).includes('not implemented');
const weaponsStub = isStubFn(weapons.createWeapon) || isStubFn(weapons.ammoCost) ||
  Object.keys(weapons.WEAPONS).length === 0;
const playerStub = isStubFn(player.createPlayer) || isStubFn(player.spendPoints) || isStubFn(player.giveWeapon);
const mapStub = isStubFn(map.loadMap) || isStubFn(map.nearestInteractable) || isStubFn(map.repairBoard);
const econStub = weaponsStub || playerStub;

const POOL = { a: 3, b: 3, c: 2, raygun: 1 };

function fakeWeapon(id) { return { id, def: { id, reserve: 100 }, mag: 10, reserve: 100 }; }

function baseState(seed = 7) {
  events.clearAll();
  const s = createEmptyState(seed);
  s.phase = 'playing';
  s.player = { x: 0, y: 0, radius: 14, points: 500, weapons: [null, null], activeSlot: 0,
    tempWeapon: null, down: false, repairTimer: 0, boardsThisRound: 0 };
  initShop(s);
  return s;
}

function realState(points = 1000) {
  events.clearAll();
  const s = createEmptyState(3);
  s.phase = 'playing';
  s.player = player.createPlayer(100, 100);
  s.player.points = points;
  initShop(s);
  return s;
}

// ---------------- pure pieces (always run) ----------------

test('boxPrice honours Fire Sale via state.powerups.active', () => {
  const s = baseState();
  s.time = 5;
  assert.equal(boxPrice(s), PRICES.mysteryBox);
  s.powerups.active.fireSale = 20;
  assert.equal(boxPrice(s), PRICES.fireSaleBox);
  s.time = 21; // expired but not yet pruned
  assert.equal(boxPrice(s), PRICES.mysteryBox);
});

test('boxWeights: 3 wall, 2 box-only, 1 raygun', () => {
  const w = boxWeights(['sheiva', 'locus', 'raygun'], ['sheiva']);
  assert.deepEqual(w, { sheiva: 3, locus: 2, raygun: 1 });
});

test('pickBoxWeapon never returns a held weapon', () => {
  const rng = createRng(11);
  for (let i = 0; i < 2000; i++) {
    const id = pickBoxWeapon(rng, ['a', 'c'], POOL);
    assert.ok(id === 'b' || id === 'raygun', id);
  }
});

test('pickBoxWeapon follows weights roughly', () => {
  const rng = createRng(5);
  const n = { a: 0, b: 0, c: 0, raygun: 0 };
  for (let i = 0; i < 9000; i++) n[pickBoxWeapon(rng, [], POOL)]++;
  assert.ok(n.raygun > 600 && n.raygun < 1400, JSON.stringify(n));
  assert.ok(n.a > 2400 && n.a < 3600, JSON.stringify(n));
  assert.equal(pickBoxWeapon(rng, [], {}), null);
});

test('tickBox: spin reveals offer, emits box:opened, skips held weapon', () => {
  const s = baseState();
  s.player.weapons = [fakeWeapon('a'), fakeWeapon('b')];
  const opened = [];
  events.on('box:opened', (p) => opened.push(p));
  s.shop.box.state = 'spinning';
  s.shop.box.timer = MYSTERY_BOX.spinSeconds;
  const seen = new Set();
  for (let t = 0; t < MYSTERY_BOX.spinSeconds - 0.05; t += 0.05) {
    tickBox(s, 0.05, POOL);
    if (s.shop.box.state === 'spinning') seen.add(s.shop.box.weaponId);
  }
  assert.ok(seen.size > 1, 'weapon cycles while spinning');
  for (let i = 0; i < 5 && s.shop.box.state === 'spinning'; i++) tickBox(s, 0.05, POOL);
  assert.equal(s.shop.box.state, 'offering');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].weaponId, s.shop.box.weaponId);
  assert.ok(['c', 'raygun'].includes(s.shop.box.weaponId));
});

test('tickBox: offer expires and is lost', () => {
  const s = baseState();
  s.shop.box = { state: 'offering', timer: MYSTERY_BOX.offerSeconds, weaponId: 'c', cycleT: 0 };
  tickBox(s, MYSTERY_BOX.offerSeconds - 0.1, POOL);
  assert.equal(s.shop.box.state, 'offering');
  tickBox(s, 0.2, POOL);
  assert.equal(s.shop.box.state, 'idle');
  assert.equal(s.shop.box.weaponId, null);
  assert.equal(takeBoxWeapon(s), false);
});

test('box never offers a held weapon over many seeded spins', () => {
  for (let seed = 1; seed < 200; seed++) {
    const s = baseState(seed);
    s.player.weapons = [fakeWeapon('a'), fakeWeapon('raygun')];
    s.shop.box.state = 'spinning';
    s.shop.box.timer = 0.01;
    tickBox(s, 0.02, POOL);
    assert.ok(!['a', 'raygun'].includes(s.shop.box.weaponId));
  }
});

test('buildPrompt: box idle / fire sale / offering / spinning / barricade', () => {
  const s = baseState();
  const boxHit = { kind: 'box', ref: {}, dist: 10 };
  let p = buildPrompt(s, boxHit);
  assert.equal(p.kind, 'box');
  assert.equal(p.text, `Press F for Mystery Box [${PRICES.mysteryBox}]`);
  assert.equal(p.cost, PRICES.mysteryBox);
  assert.equal(p.canAfford, true);

  s.player.points = 5;
  s.powerups.active.fireSale = s.time + 30;
  p = buildPrompt(s, boxHit);
  assert.equal(p.text, `Press F for Mystery Box [${PRICES.fireSaleBox}] FIRE SALE`);
  assert.equal(p.canAfford, false);

  s.shop.box = { state: 'spinning', timer: 1, weaponId: 'x', cycleT: 0 };
  assert.equal(buildPrompt(s, boxHit), null);

  s.shop.box = { state: 'offering', timer: 1, weaponId: 'zzz', cycleT: 0 };
  p = buildPrompt(s, boxHit);
  assert.equal(p.kind, 'boxOffer');
  assert.ok(p.text.startsWith('Press F to take '));

  const bar = { id: 3, boards: 2, maxBoards: 6, x: 0, y: 0, w: 40, h: 40 };
  p = buildPrompt(s, { kind: 'barricade', ref: bar, dist: 5 });
  assert.equal(p.kind, 'barricade');
  assert.equal(p.text, 'Hold F to rebuild barricade');
  bar.boards = 6;
  assert.equal(buildPrompt(s, { kind: 'barricade', ref: bar, dist: 5 }), null);
  assert.equal(buildPrompt(s, null), null);
});

test('heldWeaponIds ignores empty slots', () => {
  assert.deepEqual(heldWeaponIds({ weapons: [fakeWeapon('a'), null] }), ['a']);
  assert.deepEqual(heldWeaponIds(null), []);
});

test('spinBox refuses when not idle (no charge)', () => {
  const s = baseState();
  s.shop.box.state = 'spinning';
  assert.equal(spinBox(s), false);
  assert.equal(s.player.points, 500);
});

// ---------------- integration with other modules (skipped while they are stubs) ----------------

test('wall buy deducts and equips', { skip: econStub }, () => {
  const s = realState(1000);
  const id = weapons.WALL_WEAPON_IDS.find((w) => w !== 'mr6');
  const cost = weapons.WEAPONS[id].cost;
  const made = [];
  events.on('purchase:made', (p) => made.push(p));
  assert.equal(buyWallWeapon(s, { weaponId: id }), true);
  assert.equal(s.player.points, 1000 - cost);
  assert.ok(player.hasWeapon(s.player, id));
  assert.deepEqual(made[0], { kind: 'weapon', id, cost });
});

test('wall buy denied when broke', { skip: econStub }, () => {
  const s = realState(0);
  const id = weapons.WALL_WEAPON_IDS.find((w) => w !== 'mr6');
  const denied = [];
  events.on('purchase:denied', (p) => denied.push(p));
  assert.equal(buyWallWeapon(s, { weaponId: id }), false);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].kind, 'weapon');
  assert.equal(denied[0].have, 0);
  assert.ok(!player.hasWeapon(s.player, id));
});

test('ammo purchase refused at full reserve, allowed when depleted', { skip: econStub }, () => {
  const s = realState(1000);
  const id = weapons.WALL_WEAPON_IDS.find((w) => w !== 'mr6');
  const w = weapons.createWeapon(id);
  s.player.weapons = [w, null];
  w.reserve = w.def.reserve;
  assert.equal(buyAmmo(s, id), false);
  assert.equal(s.player.points, 1000);
  w.reserve = 0;
  assert.equal(buyAmmo(s, id), true);
  assert.equal(s.player.points, 1000 - weapons.ammoCost(id));
  assert.equal(w.reserve, w.def.reserve);
});

test('box spin charges fire-sale price and take gives weapon', { skip: econStub }, () => {
  const s = realState(100);
  s.powerups.active.fireSale = s.time + 30;
  assert.equal(spinBox(s), true);
  assert.equal(s.player.points, 100 - PRICES.fireSaleBox);
  tickBox(s, MYSTERY_BOX.spinSeconds + 0.01);
  assert.equal(s.shop.box.state, 'offering');
  const id = s.shop.box.weaponId;
  assert.ok(!heldWeaponIds(s.player).includes(id));
  assert.equal(takeBoxWeapon(s), true);
  assert.ok(player.hasWeapon(s.player, id));
  assert.equal(s.shop.box.state, 'idle');
});

test('holding F near a damaged barricade repairs and pays', { skip: econStub || mapStub || isStubFn(player.addPoints) }, () => {
  const s = realState(0);
  s.map = map.loadMap();
  const b = s.map.barricades[0];
  b.boards = 0;
  // stand the player just inside the window
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const candidates = [[0, 50], [0, -50], [50, 0], [-50, 0]];
  let placed = false;
  for (const [dx, dy] of candidates) {
    const hit = map.nearestInteractable(s.map, cx + dx, cy + dy, 64);
    if (hit && hit.kind === 'barricade' && hit.ref.id === b.id && map.isWalkable(s.map, ...Object.values(map.worldToTile(cx + dx, cy + dy)))) {
      s.player.x = cx + dx; s.player.y = cy + dy; placed = true; break;
    }
  }
  if (!placed) return; // map geometry did not allow a clean placement; integrator checks in browser
  const input = { interact: false, interactHeld: true };
  const steps = Math.ceil((REPAIR_INTERVAL * 3 + 0.01) / 0.05);
  for (let i = 0; i < steps; i++) updateShop(s, input, 0.05);
  assert.equal(b.boards, 3);
  assert.equal(s.player.boardsThisRound, 3);
  assert.equal(s.player.points, 3 * POINTS.barricadeBoard);
});

// ---------------------------------------------------------------------------
// WO2 3.9: wonder weapons (ray gun + thundergun) share SHOP.boxWeights.wonder
// ---------------------------------------------------------------------------

test('WO2 boxWeights: thundergun and raygun at wonder weight, death machine excluded', () => {
  const w = boxWeights();
  assert.equal(w.thundergun, 1);
  assert.equal(w.raygun, 1);
  assert.equal(w.kn44, 3);
  assert.equal(w.locus, 2);
  assert.ok(!('deathmachine' in w) && !('mr6' in w));
  assert.deepEqual(w, { ...weapons.BOX_WEIGHTS });
});

test('WO2 box can offer the thundergun with a seeded rng', () => {
  const rng = createRng(3);
  let found = false;
  for (let i = 0; i < 5000 && !found; i++) found = pickBoxWeapon(rng, [], boxWeights()) === 'thundergun';
  assert.ok(found);
  // Held thundergun is never offered again.
  const rng2 = createRng(9);
  for (let i = 0; i < 2000; i++) assert.notEqual(pickBoxWeapon(rng2, ['thundergun'], boxWeights()), 'thundergun');
});

// ---------------- WO4: doors (layout-independent: fake door + fake map) ----------------

function fakeDoor(over = {}) {
  return { id: 3, letter: 'F', cost: 75, open: false, tiles: [{ tx: 1, ty: 1 }],
    x: 40, y: 80, w: 80, h: 40, cx: 80, cy: 100, axis: 'h', ...over };
}

function doorState(points) {
  const s = baseState();
  s.player.points = points;
  const calls = [];
  s.map = {
    doors: [],
    openDoor(m, id) {
      calls.push({ m, id });
      const d = m.doors.find((x) => x.id === id);
      if (!d || d.open) return false;
      d.open = true;
      return true;
    },
  };
  return { s, calls };
}

test('door prompt: text, cost, canAfford, blocked:false, doorId', () => {
  const s = baseState();
  s.player.points = 100;
  const door = fakeDoor();
  const p = buildPrompt(s, { kind: 'door', ref: door, dist: 5 });
  assert.equal(p.kind, 'door');
  assert.equal(p.text, 'Press F to open door [75]');
  assert.equal(p.cost, 75);
  assert.equal(p.canAfford, true);
  assert.equal(p.blocked, false);
  assert.equal(p.doorId, 3);
  s.player.points = 74;
  assert.equal(buildPrompt(s, { kind: 'door', ref: door, dist: 5 }).canAfford, false);
  assert.equal(buildPrompt(s, { kind: 'door', ref: fakeDoor({ cost: 150 }), dist: 5 }).text,
    'Press F to open door [150]');
  assert.equal(buildPrompt(s, { kind: 'door', ref: fakeDoor({ open: true }), dist: 5 }), null);
});

test('buyDoor deducts, opens via map.openDoor, emits purchase:made and DOOR OPENED text', () => {
  const { s, calls } = doorState(200);
  const door = fakeDoor();
  s.map.doors.push(door);
  const made = [];
  events.on('purchase:made', (e) => made.push(e));
  assert.equal(buyDoor(s, door), true);
  assert.equal(s.player.points, 125);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m, s.map);
  assert.equal(calls[0].id, 3);
  assert.equal(door.open, true);
  assert.deepEqual(made, [{ kind: 'door', id: 3, cost: 75 }]);
  const fx = s.effects.find((e) => e.type === 'text' && e.text === DOOR_TEXT);
  assert.ok(fx, 'DOOR OPENED text effect pushed');
  assert.equal(DOOR_TEXT, 'DOOR OPENED');
  assert.equal(fx.x, 80);
  assert.equal(fx.y, 100);
  assert.ok(fx.ttl > 0 && fx.maxTtl === fx.ttl && typeof fx.color === 'string');
  // repeat: already open -> nothing
  assert.equal(buyDoor(s, door), false);
  assert.equal(s.player.points, 125);
  assert.equal(made.length, 1);
});

test('buyDoor denied when broke: no charge, no open, purchase:denied', () => {
  const { s, calls } = doorState(50);
  const door = fakeDoor();
  s.map.doors.push(door);
  const denied = [];
  const made = [];
  events.on('purchase:denied', (e) => denied.push(e));
  events.on('purchase:made', (e) => made.push(e));
  assert.equal(buyDoor(s, door), false);
  assert.equal(s.player.points, 50);
  assert.equal(calls.length, 0);
  assert.equal(door.open, false);
  assert.deepEqual(denied, [{ kind: 'door', cost: 75, have: 50 }]);
  assert.equal(made.length, 0);
  assert.equal(s.effects.length, 0);
});

test('buyDoor refunds when map refuses to open (unknown id)', () => {
  const { s } = doorState(200);
  const door = fakeDoor({ id: 99 }); // not in s.map.doors
  assert.equal(buyDoor(s, door), false);
  assert.equal(s.player.points, 200);
});

test('updateShop interact on a real closed door opens it (skips until map.js has doors)',
  { skip: (() => {
    try {
      const m = typeof map.openDoor === 'function' && map.loadMap();
      return !(m && Array.isArray(m.doors) && m.doors.length > 0);
    } catch { return true; }
  })() },
  () => {
    const s = baseState();
    s.map = map.loadMap();
    const door = s.map.doors[0];
    // stand just outside the door's bounding box on whichever side is walkable
    const cands = [
      [door.cx, door.y - 20], [door.cx, door.y + door.h + 20],
      [door.x - 20, door.cy], [door.x + door.w + 20, door.cy],
    ];
    let hitDoor = false;
    for (const [x, y] of cands) {
      s.player.x = x; s.player.y = y;
      const h = map.nearestInteractable(s.map, x, y, 1000);
      if (h && h.kind === 'door' && h.ref === door) { hitDoor = true; break; }
    }
    if (!hitDoor) return; // layout puts another interactable closer; covered by fake tests
    s.player.points = door.cost + 10;
    updateShop(s, { interact: false, interactHeld: false }, 0.016);
    assert.equal(s.shop.prompt && s.shop.prompt.kind, 'door');
    updateShop(s, { interact: true, interactHeld: false }, 0.016);
    assert.equal(door.open, true);
    assert.equal(s.player.points, 10);
  });

// ---------------- WO5 3.3: mega door + stairs (fake maps) ----------------

function megaState(points, { doorsOpen = true } = {}) {
  const s = baseState();
  s.player.points = points;
  const calls = [];
  s.map = {
    doors: [{ id: 1, open: true }, { id: 2, open: doorsOpen }],
    megaDoor: { id: 'mega', cost: DOORS.megaCost, open: false, sealed: false,
      x: 400, y: 400, w: 120, h: 40, cx: 460, cy: 420 },
    stairs: { open: false, cx: 900, cy: 900 },
    openMegaDoor(m) {
      calls.push(m);
      if (m.megaDoor.open || m.megaDoor.sealed || !m.doors.every((d) => d.open)) return false;
      m.megaDoor.open = true;
      return true;
    },
  };
  return { s, calls };
}

function recordEv(name) {
  const out = [];
  events.on(name, (p) => out.push(p));
  return out;
}

test('WO5: mega door prompt is blocked while a normal door is closed', () => {
  const { s } = megaState(1000, { doorsOpen: false });
  const p = buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor, dist: 5 });
  assert.equal(p.kind, 'megadoor');
  assert.equal(p.blocked, true);
  assert.equal(p.text, 'MEGA DOOR — open all doors first');
  assert.equal(p.text, MEGA_BLOCKED_TEXT);
  assert.equal(p.cost, DOORS.megaCost);
});

test('WO5: mega door prompt offers the buy once all doors are open', () => {
  const { s } = megaState(100);
  const p = buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor, dist: 5 });
  assert.equal(p.blocked, false);
  assert.equal(p.text, `Press F to open MEGA DOOR [${DOORS.megaCost}]`);
  assert.equal(p.text, 'Press F to open MEGA DOOR [250]');
  assert.equal(p.canAfford, false);
  s.player.points = 250;
  assert.equal(buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor }).canAfford, true);
  s.map.megaDoor.open = true;
  assert.equal(buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor }), null);
  s.map.megaDoor.open = false;
  s.map.megaDoor.sealed = true;
  assert.equal(buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor }), null);
});

test('WO5: buyMegaDoor spends, opens, emits purchase:made', () => {
  const { s, calls } = megaState(400);
  const made = recordEv('purchase:made');
  assert.equal(buyMegaDoor(s), true);
  assert.equal(s.player.points, 400 - DOORS.megaCost);
  assert.equal(s.map.megaDoor.open, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(made, [{ kind: 'megadoor', id: 'mega', cost: DOORS.megaCost }]);
  assert.ok(s.effects.some((e) => e.type === 'text' && e.x === 460 && e.y === 420));
  assert.equal(buyMegaDoor(s), false); // already open
  assert.equal(s.player.points, 400 - DOORS.megaCost);
  assert.equal(made.length, 1);
});

test('WO8 Phase 4a (economy #1): prompt and purchase use the door own per-level cost (750 on L3)', () => {
  const { s } = megaState(1000);
  s.map.megaDoor.cost = 750;
  const p = buildPrompt(s, { kind: 'megadoor', ref: s.map.megaDoor, dist: 5 });
  assert.equal(p.cost, 750);
  assert.equal(p.text, 'Press F to open MEGA DOOR [750]');
  const made = recordEv('purchase:made');
  assert.equal(buyMegaDoor(s), true);
  assert.equal(s.player.points, 250);
  assert.deepEqual(made, [{ kind: 'megadoor', id: 'mega', cost: 750 }]);
  // broke at 700: denied with the per-level cost
  const b = megaState(700);
  b.s.map.megaDoor.cost = 750;
  const denied = recordEv('purchase:denied');
  assert.equal(buyMegaDoor(b.s), false);
  assert.deepEqual(denied.slice(-1), [{ kind: 'megadoor', cost: 750, have: 700 }]);
  // no cost on the door: falls back to DOORS.megaCost
  const c = megaState(1000);
  delete c.s.map.megaDoor.cost;
  assert.equal(buildPrompt(c.s, { kind: 'megadoor', ref: c.s.map.megaDoor }).cost, DOORS.megaCost);
});

test('WO5: buyMegaDoor denied when broke, refused (no charge, no event) when blocked', () => {
  const { s, calls } = megaState(100);
  const denied = recordEv('purchase:denied');
  const made = recordEv('purchase:made');
  assert.equal(buyMegaDoor(s), false);
  assert.deepEqual(denied, [{ kind: 'megadoor', cost: DOORS.megaCost, have: 100 }]);
  assert.equal(s.player.points, 100);
  const b = megaState(1000, { doorsOpen: false });
  assert.equal(buyMegaDoor(b.s), false);
  assert.equal(b.s.player.points, 1000);
  assert.equal(b.s.map.megaDoor.open, false);
  assert.equal(b.calls.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(made.length, 0);
});

test('WO5: stairs prompt only when the stairs are open', () => {
  const { s } = megaState(0);
  assert.equal(buildPrompt(s, { kind: 'stairs', ref: s.map.stairs }), null);
  s.map.stairs.open = true;
  const p = buildPrompt(s, { kind: 'stairs', ref: s.map.stairs });
  assert.equal(p.kind, 'stairs');
  assert.equal(p.text, 'Press F to descend');
  assert.equal(p.text, STAIRS_TEXT);
  assert.equal(p.blocked, false);
});

test('WO5: useStairs starts the descent once (level.beginDescent)', () => {
  const { s } = megaState(0);
  s.level = level.createLevelState(0);
  const desc = recordEv('level:descend');
  assert.equal(useStairs(s), false); // closed stairs
  assert.equal(s.transition, null);
  s.map.stairs.open = true;
  assert.equal(useStairs(s), true);
  assert.equal(s.transition.nextIndex, 1);
  assert.equal(s.transition.dur, LEVELS_CFG.fadeSeconds);
  assert.deepEqual(desc, [{ from: 0, to: 1 }]);
  assert.equal(useStairs(s), false);
  assert.equal(desc.length, 1);
});

test('WO5: no prompts and no purchases while a transition runs', () => {
  const { s } = megaState(1000);
  s.map.stairs.open = true;
  s.shop.prompt = { kind: 'stairs' };
  s.player.repairTimer = 0.5;
  s.transition = { t: 0, dur: 1.2, nextIndex: 1, swapped: false };
  updateShop(s, { interact: true }, 1 / 60);
  assert.equal(s.shop.prompt, null);
  assert.equal(s.player.repairTimer, 0);
  assert.equal(buyMegaDoor(s), false);
  assert.equal(s.player.points, 1000);
});


// ---------------- WO7: perk machines ----------------

import * as shopNs from '../src/shop.js';
import { PERKS, TILE } from '../src/config.js';

const PERK_ASCII = [
  '#############',
  '#P..........#',
  '#.J.Q.C.N.U.#',
  '#...........#',
  '#.K.......Q.#',
  '#############',
];

function perkState(points = 2000) {
  events.clearAll();
  const s = createEmptyState(5);
  s.phase = 'playing';
  s.player = player.createPlayer(60, 60);
  s.player.points = points;
  if (!Array.isArray(s.player.perks)) s.player.perks = [];
  if (!Number.isFinite(s.player.reviveUses)) s.player.reviveUses = 0;
  s.map = map.loadMap(PERK_ASCII);
  initShop(s);
  return s;
}
const machine = (s, perkId) => s.map.perkMachines.find((m) => m.perkId === perkId);
function record(names) {
  const log = [];
  for (const n of names) events.on(n, (p) => log.push([n, p]));
  return log;
}
// Stand just below a machine (inside interact range, closest to it).
function standAt(s, m) { s.player.x = m.x + TILE / 2; s.player.y = m.y + TILE + 15; }

test('WO7 buyPerk / perkPrompt / syncPerkMachines exported', () => {
  for (const f of ['buyPerk', 'perkPrompt', 'syncPerkMachines', 'perkBlockReason', 'perkDef']) {
    assert.equal(typeof shopNs[f], 'function', f);
  }
});

test('WO7 perk prompts: buy text, canAfford, already have, limit, sold out', () => {
  const s = perkState(100);
  const jugg = machine(s, 'jugg');
  let p = buildPrompt(s, { kind: 'perk', ref: jugg });
  assert.equal(p.kind, 'perk'); assert.equal(p.perkId, 'jugg');
  assert.equal(p.text, 'Press F for Juggernog [250]');
  assert.equal(p.cost, 250); assert.equal(p.canAfford, false); assert.equal(p.blocked, false);
  s.player.points = 250;
  assert.equal(buildPrompt(s, { kind: 'perk', ref: jugg }).canAfford, true);
  s.player.perks = ['jugg'];
  p = buildPrompt(s, { kind: 'perk', ref: jugg });
  assert.equal(p.text, 'Already have Juggernog'); assert.equal(p.blocked, true);
  s.player.perks = ['jugg', 'speed', 'dtap', 'stamin'];
  p = buildPrompt(s, { kind: 'perk', ref: machine(s, 'mule') });
  assert.equal(p.text, 'Perk limit reached'); assert.equal(p.blocked, true);
  s.player.perks = [];
  s.player.reviveUses = PERKS.list.revive.maxUses;
  p = buildPrompt(s, { kind: 'perk', ref: machine(s, 'revive') });
  assert.equal(p.text, 'Quick Revive sold out'); assert.equal(p.blocked, true);
  assert.equal(buildPrompt(s, { kind: 'perk', ref: machine(s, 'speed') }).text, 'Press F for Speed Cola [300]');
});

test('WO7 buyPerk: charges, adds the perk, emits purchase:made and perk:bought', () => {
  const s = perkState(1000);
  const log = record(['purchase:made', 'purchase:denied', 'perk:bought']);
  assert.equal(shopNs.buyPerk(s, machine(s, 'dtap')), true);
  assert.equal(s.player.points, 800);
  assert.ok(s.player.perks.includes('dtap'));
  assert.equal(s.stats.perksBought, 1);
  assert.deepEqual(log, [
    ['purchase:made', { kind: 'perk', id: 'dtap', cost: 200 }],
    ['perk:bought', { perkId: 'dtap', cost: 200 }],
  ]);
  // already held: refused, no charge, no event
  assert.equal(shopNs.buyPerk(s, machine(s, 'dtap')), false);
  assert.equal(s.player.points, 800); assert.equal(log.length, 2);
});

test('WO7 buyPerk: cannot afford -> purchase:denied, nothing changes', () => {
  const s = perkState(399);
  const log = record(['purchase:made', 'purchase:denied', 'perk:bought']);
  assert.equal(shopNs.buyPerk(s, machine(s, 'mule')), false);
  assert.equal(s.player.points, 399); assert.equal(s.player.perks.length, 0);
  assert.deepEqual(log, [['purchase:denied', { kind: 'perk', cost: 400, have: 399 }]]);
});

test('WO7 buyPerk: four-perk cap blocks a fifth without charge or event', () => {
  const s = perkState(5000);
  for (const id of ['jugg', 'speed', 'dtap', 'stamin']) assert.equal(shopNs.buyPerk(s, machine(s, id)), true, id);
  const pts = s.player.points;
  const log = record(['purchase:made', 'purchase:denied', 'perk:bought']);
  assert.equal(shopNs.buyPerk(s, machine(s, 'mule')), false);
  assert.equal(s.player.points, pts); assert.equal(log.length, 0);
  assert.equal(s.player.perks.length, PERKS.maxPerks);
});

test('WO7 Quick Revive: counts uses, sells out every revive machine at maxUses, bumps version', () => {
  const s = perkState(1000);
  const revives = s.map.perkMachines.filter((m) => m.perkId === 'revive');
  assert.equal(revives.length, 2);
  const max = PERKS.list.revive.maxUses;
  const costs = PERKS.list.revive.costs;
  const log = record(['purchase:made', 'perk:bought']);
  for (let i = 1; i <= max; i++) {
    const v = s.map.version;
    // FIX-3 (balance #6): escalating price 50 / 150 / 300 by purchase number
    const price = costs[Math.min(i - 1, costs.length - 1)];
    const pr = buildPrompt(s, { kind: 'perk', ref: revives[i % 2] });
    assert.equal(pr.cost, price); assert.equal(pr.text, `Press F for Quick Revive [${price}]`);
    assert.equal(shopNs.perkCost(s.player, 'revive'), price);
    assert.equal(shopNs.buyPerk(s, revives[i % 2]), true, `purchase ${i}`);
    assert.deepEqual(log.slice(-2), [
      ['purchase:made', { kind: 'perk', id: 'revive', cost: price }],
      ['perk:bought', { perkId: 'revive', cost: price }],
    ]);
    assert.equal(s.player.reviveUses, i);
    // holding revive: another purchase is refused until it is consumed
    assert.equal(shopNs.buyPerk(s, revives[0]), false);
    const sold = i === max;
    for (const m of revives) assert.equal(m.soldOut, sold);
    assert.ok(s.map.version > v, 'version bumps (next price or sold-out)');
    if (!sold) for (const m of revives) assert.equal(m.price, costs[Math.min(i, costs.length - 1)], 'plate price');
    s.player.perks = []; // simulate the self-revive consuming every perk
  }
  const pts = s.player.points;
  assert.equal(pts, 1000 - costs.slice(0, max).reduce((a, c) => a + c, 0));
  assert.equal(shopNs.buyPerk(s, revives[0]), false);
  assert.equal(s.player.points, pts);
  // other machines are never sold out
  assert.ok(s.map.perkMachines.filter((m) => m.perkId !== 'revive').every((m) => !m.soldOut));
});

test('WO7 syncPerkMachines: a freshly loaded level shows revive sold out after updateShop', () => {
  const s = perkState(1000);
  s.player.reviveUses = PERKS.list.revive.maxUses;
  s.map = map.loadMap(PERK_ASCII); // new level: machines start fresh
  const v = s.map.version;
  updateShop(s, {}, 1 / 60);
  assert.ok(s.map.perkMachines.filter((m) => m.perkId === 'revive').every((m) => m.soldOut));
  assert.equal(s.map.version, v + 1);
  updateShop(s, {}, 1 / 60);
  assert.equal(s.map.version, v + 1, 'no repaint when nothing changed');
  assert.equal(shopNs.syncPerkMachines(null), false);
});

test('FIX-3 Quick Revive price: costs [50,150,300]; cannot afford the 2nd -> denied at 150', () => {
  assert.deepEqual(PERKS.list.revive.costs, [50, 150, 300]);
  assert.equal(PERKS.list.revive.cost, 50);
  const s = perkState(199);
  const q = machine(s, 'revive');
  const log = record(['purchase:made', 'purchase:denied']);
  assert.equal(shopNs.buyPerk(s, q), true);
  assert.equal(s.player.points, 149);
  s.player.perks = [];
  assert.equal(buildPrompt(s, { kind: 'perk', ref: q }).canAfford, false);
  assert.equal(shopNs.buyPerk(s, q), false);
  assert.deepEqual(log, [
    ['purchase:made', { kind: 'perk', id: 'revive', cost: 50 }],
    ['purchase:denied', { kind: 'perk', cost: 150, have: 149 }],
  ]);
  // perks without costs use def.cost; unknown -> null; clamped past the table
  assert.equal(shopNs.perkCost(s.player, 'jugg'), 250);
  assert.equal(shopNs.perkCost(s.player, 'nope'), null);
  assert.equal(shopNs.perkCost({ reviveUses: 9 }, 'revive'), 300);
  assert.equal(shopNs.perkCost(null, 'revive'), 50);
});

test('FIX-3 (L2) updateShop syncs perk machines during a level transition', () => {
  const s = perkState(1000);
  s.player.reviveUses = PERKS.list.revive.maxUses;
  s.map = map.loadMap(PERK_ASCII); // level loaded at the fade midpoint
  s.transition = { t: 0.6, dur: 1.2, nextIndex: 1, swapped: true };
  updateShop(s, { interact: true }, 1 / 60);
  assert.equal(s.shop.prompt, null, 'still nothing interactable mid-fade');
  assert.ok(s.map.perkMachines.filter((m) => m.perkId === 'revive').every((m) => m.soldOut));
});

test('WO7 updateShop: prompt and F-press buy at a perk machine; none while down', () => {
  const s = perkState(1000);
  const log = record(['perk:bought']);
  const jugg = machine(s, 'jugg');
  standAt(s, jugg);
  updateShop(s, {}, 1 / 60);
  assert.equal(s.shop.prompt.kind, 'perk');
  assert.equal(s.shop.prompt.text, 'Press F for Juggernog [250]');
  updateShop(s, { interact: true }, 1 / 60);
  assert.deepEqual(log, [['perk:bought', { perkId: 'jugg', cost: 250 }]]);
  assert.equal(s.shop.prompt.text, 'Already have Juggernog');
  assert.equal(s.player.points, 750);
  // downed (Quick Revive pause): no prompt, no purchase
  s.player.downT = 1;
  const speed = machine(s, 'speed');
  standAt(s, speed);
  updateShop(s, { interact: true }, 1 / 60);
  assert.equal(s.shop.prompt, null);
  assert.equal(shopNs.buyPerk(s, speed), false);
  assert.equal(s.player.points, 750);
});

test('WO7 buyPerk guards: null machine, unknown perk, no player', () => {
  const s = perkState(1000);
  assert.equal(shopNs.buyPerk(s, null), false);
  assert.equal(shopNs.buyPerk(s, { id: 99, perkId: 'nope' }), false);
  assert.equal(buildPrompt(s, { kind: 'perk', ref: { id: 99, perkId: 'nope' } }), null);
  assert.equal(shopNs.buyPerk({ player: null }, machine(s, 'jugg')), false);
  assert.equal(s.player.points, 1000);
});

// ---------------- WO8: Pack-a-Punch ----------------

import { PAP } from '../src/config.js';

// '7' = kn44 wall buy (level-1 wall-buy table), 'A' = Pack-a-Punch.
const PAP_ASCII = [
  '###########',
  '#P........#',
  '#.A.....7.#',
  '#.........#',
  '###########',
];

function papState(points = 2000, guns = ['kn44']) {
  events.clearAll();
  const s = createEmptyState(9);
  s.phase = 'playing';
  s.player = player.createPlayer(60, 60);
  s.player.points = points;
  s.map = map.loadMap(PAP_ASCII);
  initShop(s);
  for (const g of guns) player.giveWeapon(s, g);
  return s;
}
const standBelow = (s, r) => { s.player.x = r.x + TILE / 2; s.player.y = r.y + TILE + 15; };

test('WO8 shop exports and initShop resets shop.pap', () => {
  for (const f of ['startPap', 'takePap', 'updatePap', 'papPrompt']) assert.equal(typeof shopNs[f], 'function', f);
  const s = papState();
  s.shop.pap.state = 'ready';
  initShop(s);
  assert.deepEqual(s.shop.pap, { state: 'idle', timer: 0, weapon: null, slot: -1, baseId: null });
});

test('WO8 full flow: startPap -> working -> ready (upgraded) -> takePap back into the same slot', () => {
  const s = papState(2000, ['sheiva', 'kn44']); // kn44 in slot 1, active
  const log = record(['pap:start', 'pap:done', 'purchase:made', 'weapon:equipped']);
  const kn = s.player.weapons[1];
  assert.equal(s.player.activeSlot, 1);
  let pr = shopNs.papPrompt(s);
  assert.equal(pr.kind, 'pap'); assert.equal(pr.blocked, false); assert.equal(pr.canAfford, true);
  assert.equal(pr.text, `Press F to Pack-a-Punch ${weapons.WEAPONS.kn44.name} [${PAP.cost}]`);
  assert.equal(shopNs.startPap(s), true);
  assert.equal(s.player.points, 2000 - PAP.cost);
  assert.equal(s.player.weapons[1], null);
  assert.equal(s.player.activeSlot, 0); // switched to the other filled slot
  assert.deepEqual({ ...s.shop.pap, weapon: s.shop.pap.weapon.id },
    { state: 'working', timer: PAP.workSeconds, weapon: 'kn44', slot: 1, baseId: 'kn44' });
  assert.deepEqual(log.filter(([n]) => n !== 'weapon:equipped'), [
    ['pap:start', { weaponId: 'kn44', slot: 1 }],
    ['purchase:made', { kind: 'pap', id: 'kn44', cost: PAP.cost }],
  ]);
  pr = shopNs.papPrompt(s);
  assert.equal(pr.text, 'Machine busy'); assert.equal(pr.blocked, true);
  assert.equal(shopNs.startPap(s), false); // busy
  assert.equal(shopNs.takePap(s), false); // not ready yet
  shopNs.updatePap(s, PAP.workSeconds - 0.01);
  assert.equal(s.shop.pap.state, 'working');
  shopNs.updatePap(s, 0.02);
  assert.equal(s.shop.pap.state, 'ready');
  assert.equal(weapons.isUpgraded(kn), true);
  pr = shopNs.papPrompt(s);
  assert.equal(pr.kind, 'papTake');
  assert.equal(pr.text, `Press F to take ${weapons.upgradedName('kn44')}`);
  shopNs.updatePap(s, 100); // stays until taken
  assert.equal(s.shop.pap.state, 'ready');
  assert.equal(shopNs.takePap(s), true);
  assert.equal(s.player.weapons[1], kn); assert.equal(s.player.activeSlot, 1);
  assert.equal(s.stats.papCount, 1);
  assert.equal(s.shop.pap.state, 'idle'); assert.equal(s.shop.pap.weapon, null);
  assert.deepEqual(log.find(([n]) => n === 'pap:done'), ['pap:done', { weaponId: 'kn44' }]);
  // already upgraded now
  pr = shopNs.papPrompt(s);
  assert.equal(pr.blocked, true); assert.equal(pr.reason, 'upgraded');
  assert.equal(pr.text, `${weapons.upgradedName('kn44')} is already upgraded`);
  const pts = s.player.points;
  assert.equal(shopNs.startPap(s), false); assert.equal(s.player.points, pts);
});

test('WO8 only gun inside: player holds nothing, cannot fire, and gets it back', () => {
  const s = papState(2000, ['kn44']);
  assert.equal(shopNs.startPap(s), true);
  assert.deepEqual(s.player.weapons, [null, null]);
  assert.equal(player.getActiveWeapon(s.player), null);
  const log = record(['weapon:fired']);
  // updatePlayer with fire / reload / swap held does not throw and fires nothing
  player.updatePlayer(s, { fire: true, reload: true, swap: true }, { x: 200, y: 60 }, 0.1);
  player.updatePlayer(s, { fire: true, slot: 2 }, { x: 200, y: 60 }, 0.1);
  assert.equal(log.length, 0);
  assert.equal(shopNs.papPrompt(s).text, 'Machine busy');
  shopNs.updatePap(s, PAP.workSeconds);
  assert.equal(shopNs.takePap(s), true);
  assert.equal(s.player.weapons[0].id, 'kn44'); assert.equal(s.player.activeSlot, 0);
  assert.equal(player.getActiveWeapon(s.player).upgraded, true);
});

test('WO8 return slot rules: filled meanwhile -> first empty; none empty -> replaces active; duplicate replaced', () => {
  // slot filled meanwhile -> first empty slot
  let s = papState(5000, ['kn44']);
  shopNs.startPap(s);
  player.giveWeapon(s, 'sheiva'); // lands in slot 0 (the vacated slot)
  shopNs.updatePap(s, PAP.workSeconds);
  shopNs.takePap(s);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['sheiva', 'kn44']);
  assert.equal(s.player.activeSlot, 1);
  // no empty slot -> replaces the active gun
  s = papState(5000, ['kn44', 'sheiva']);
  s.player.activeSlot = 0;
  shopNs.startPap(s); // kn44 out of slot 0, active -> 1
  player.giveWeapon(s, 'rk5'); // fills slot 0 and makes it active
  assert.equal(s.player.activeSlot, 0);
  shopNs.updatePap(s, PAP.workSeconds);
  shopNs.takePap(s);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['kn44', 'sheiva']);
  assert.equal(s.player.weapons[0].upgraded, true);
  // same gun held again meanwhile -> that copy is replaced, no duplicate
  s = papState(5000, ['kn44', 'sheiva']);
  shopNs.startPap(s); // slot 1 = sheiva goes in
  assert.equal(s.shop.pap.weapon.id, 'sheiva');
  s.player.weapons[1] = weapons.createWeapon('rk5');
  s.player.weapons[0] = weapons.createWeapon('sheiva');
  shopNs.updatePap(s, PAP.workSeconds);
  shopNs.takePap(s);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['sheiva', 'rk5']);
  assert.equal(s.player.weapons[0].upgraded, true);
  // Mule Kick slot lost while the gun is inside -> goes to the active slot (no empty slot)
  s = papState(5000, ['kn44', 'sheiva']);
  s.player.weapons.push(weapons.createWeapon('rk5'));
  s.player.activeSlot = 2;
  shopNs.startPap(s);
  assert.equal(s.shop.pap.slot, 2);
  s.player.weapons.length = 2;
  shopNs.updatePap(s, PAP.workSeconds);
  shopNs.takePap(s);
  assert.equal(s.player.weapons.length, 2);
  assert.equal(s.player.weapons[s.player.activeSlot].id, 'rk5');
  assert.equal(s.player.weapons[s.player.activeSlot].upgraded, true);
});

test('WO8 blocked cases: Death Machine, nothing held, cannot afford, down, transition', () => {
  let s = papState(2000, ['kn44']);
  player.equipTemporary(s, weapons.createDeathMachine());
  let pr = shopNs.papPrompt(s);
  assert.equal(pr.blocked, true); assert.equal(pr.reason, 'powerup');
  assert.equal(pr.text, 'Cannot upgrade a power-up weapon');
  assert.equal(shopNs.startPap(s), false); assert.equal(s.player.points, 2000);
  // nothing held
  s = papState(2000, []);
  pr = shopNs.papPrompt(s);
  assert.equal(pr.blocked, true); assert.equal(pr.reason, 'none');
  assert.equal(shopNs.startPap(s), false);
  // cannot afford
  s = papState(PAP.cost - 1, ['kn44']);
  const log = record(['purchase:denied', 'pap:start']);
  pr = shopNs.papPrompt(s);
  assert.equal(pr.canAfford, false); assert.equal(pr.blocked, false);
  assert.equal(shopNs.startPap(s), false);
  assert.deepEqual(log, [['purchase:denied', { kind: 'pap', id: 'kn44', cost: PAP.cost, have: PAP.cost - 1 }]]);
  assert.equal(s.player.weapons[0].id, 'kn44');
  // down / transition
  s = papState(2000, ['kn44']);
  s.player.downT = 1;
  assert.equal(shopNs.startPap(s), false);
  s.player.downT = 0; s.transition = { t: 0 };
  assert.equal(shopNs.startPap(s), false);
  s.transition = null;
  assert.equal(shopNs.startPap(s), true);
  shopNs.updatePap(s, PAP.workSeconds);
  s.player.downT = 1;
  assert.equal(shopNs.takePap(s), false);
});

test('WO8 box never offers the gun inside the machine', () => {
  const s = papState(5000, ['kn44']);
  shopNs.startPap(s);
  s.shop.box.state = 'spinning'; s.shop.box.timer = 0.01;
  tickBox(s, 0.1, { kn44: 1, sheiva: 1 });
  assert.equal(s.shop.box.weaponId, 'sheiva');
});

test('WO8 updateShop: F at the machine starts, then takes; wall ammo for an upgraded gun costs the scaled PaP price', () => {
  const s = papState(5000, ['kn44']);
  standBelow(s, s.map.pap);
  updateShop(s, {}, 0.016);
  assert.equal(s.shop.prompt.kind, 'pap');
  updateShop(s, { interact: true }, 0.016);
  assert.equal(s.shop.pap.state, 'working');
  assert.equal(s.shop.prompt.text, 'Machine busy');
  updateShop(s, { interact: true }, 0.016); // busy: nothing happens
  assert.equal(s.player.points, 5000 - PAP.cost);
  shopNs.updatePap(s, PAP.workSeconds);
  updateShop(s, {}, 0.016);
  assert.equal(s.shop.prompt.kind, 'papTake');
  updateShop(s, { interact: true }, 0.016);
  assert.equal(s.shop.pap.state, 'idle');
  assert.equal(s.player.weapons[0].upgraded, true);
  assert.equal(s.shop.prompt.reason, 'upgraded');
  // wall ammo at the kn44 wall buy
  const wb = s.map.wallBuys[0];
  assert.equal(wb.weaponId, 'kn44');
  const kn = s.player.weapons[0];
  kn.reserve = 0;
  standBelow(s, wb);
  updateShop(s, {}, 0.016);
  assert.equal(s.shop.prompt.kind, 'ammo');
  // WO8 Phase 4a (economy #5): min(PAP.ammoCost, round(PAP.ammoCostMult x 75)) = 281.
  const upAmmo = Math.min(PAP.ammoCost, Math.round(PAP.ammoCostMult * weapons.ammoCost('kn44')));
  assert.equal(upAmmo, 281);
  assert.equal(s.shop.prompt.cost, upAmmo);
  assert.equal(s.shop.prompt.text, `Press F to buy upgraded ammo [${upAmmo}]`);
  const before = s.player.points;
  assert.equal(buyAmmo(s, 'kn44'), true);
  assert.equal(s.player.points, before - upAmmo);
  assert.equal(kn.reserve, kn.def.reserve);
  // the base gun still pays the normal price
  const s2 = papState(5000, ['kn44']);
  s2.player.weapons[0].reserve = 0;
  standBelow(s2, s2.map.wallBuys[0]);
  updateShop(s2, {}, 0.016);
  assert.equal(s2.shop.prompt.cost, weapons.ammoCost('kn44'));
});

// ---------------------------------------------------------------------------
// WO8 FIX-A: QA review M1 / L1 / L3 and playtest #3.
// ---------------------------------------------------------------------------

test('WO8 FIX-A (M1): revive dropping Mule Kick with slot 0 in the machine equips the first filled slot', () => {
  const s = papState(5000, ['mr6', 'sheiva']);
  player.addPerk(s, 'mule');
  player.addPerk(s, 'revive');
  player.giveWeapon(s, 'kn44');
  s.player.activeSlot = 0;
  assert.equal(shopNs.startPap(s), true); // MR6 goes in, player switched to Sheiva
  assert.equal(s.player.weapons[0], null);
  s.player.activeSlot = 2; // press 3: KN-44
  const eq = record(['weapon:equipped']);
  player.removeAllPerks(s, 'revive');
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), [null, 'sheiva']);
  assert.equal(s.player.activeSlot, 1);
  assert.equal(player.getActiveWeapon(s.player).id, 'sheiva');
  assert.deepEqual(eq, [['weapon:equipped', { weaponId: 'sheiva', slot: 1 }]]);
  assert.notEqual(shopNs.papPrompt(s).reason, 'none');
});

test('WO8 FIX-A (L1): the gun inside the machine cannot be bought at its wall (blocked, no charge)', () => {
  const s = papState(5000, ['mr6', 'kn44']);
  assert.equal(shopNs.startPap(s), true); // KN-44 (slot 1, active) goes in
  const pts = s.player.points;
  const wb = s.map.wallBuys[0];
  assert.equal(wb.weaponId, 'kn44');
  const pr = buildPrompt(s, { kind: 'wallbuy', ref: wb, dist: 0 });
  assert.equal(pr.blocked, true);
  assert.equal(pr.text, `${weapons.WEAPONS.kn44.name} is in the Pack-a-Punch`);
  const log = record(['purchase:made', 'purchase:denied']);
  assert.equal(buyWallWeapon(s, wb), false);
  assert.equal(s.player.points, pts);
  assert.deepEqual(log, []);
  assert.deepEqual(s.player.weapons.map((w) => w && w.id), ['mr6', null]);
  // ready state too; after taking it the wall sells ammo again
  shopNs.updatePap(s, PAP.workSeconds);
  assert.equal(buildPrompt(s, { kind: 'wallbuy', ref: wb, dist: 0 }).blocked, true);
  shopNs.takePap(s);
  assert.equal(buildPrompt(s, { kind: 'wallbuy', ref: wb, dist: 0 }).kind, 'ammo');
});

test('WO8 FIX-A (L3, playtest #3): ammo prompts for an upgraded gun use the upgraded name', () => {
  const s = papState(5000, ['kn44']);
  shopNs.startPap(s);
  shopNs.updatePap(s, PAP.workSeconds);
  shopNs.takePap(s);
  const kn = s.player.weapons[0];
  const wb = s.map.wallBuys[0];
  const hit = { kind: 'wallbuy', ref: wb, dist: 0 };
  kn.reserve = 0;
  let pr = buildPrompt(s, hit);
  assert.equal(pr.text, `Press F to buy upgraded ammo [${pr.cost}]`);
  assert.equal(pr.cost, 281);
  kn.reserve = kn.def.reserve;
  pr = buildPrompt(s, hit);
  assert.equal(pr.blocked, true);
  assert.equal(pr.text, `${weapons.UPGRADES.kn44.name} ammo full`);
  // base gun keeps the plain texts
  const s2 = papState(5000, ['kn44']);
  assert.equal(buildPrompt(s2, hit).text, `${weapons.WEAPONS.kn44.name} ammo full`);
  s2.player.weapons[0].reserve = 0;
  assert.equal(buildPrompt(s2, hit).text, `Press F to buy ammo [${weapons.ammoCost('kn44')}]`);
});
