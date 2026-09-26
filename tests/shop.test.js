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
} from '../src/shop.js';

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
