// tests/levels.test.js — WO5 3.5 level data (Agent A).
// Parses each level's ASCII independently (no map.js) and runs the WO4 layout validity suite
// (as in tests/map.test.js) plus the WO5 arena rules on every level in the registry.
// WO7 3.4 (Agent I): perk machines (J Q C N U K, wall tiles) parsed here independently of map.js;
// perk placement rules checked on every level; level 3 LABORATORY layout checks.
// WO8 1.1 (Agent C): one Pack-a-Punch machine 'A' (wall tile) per level; placement rules checked
// on every level (deepest zone behind H, clear of the arena, >= 6 from wall buys / perks).
// WO9 Phase 0 (Agent 0): suite extracted to tests/helpers/levelcheck.js; six levels registered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEVELS, levelByIndex } from '../src/levels/levels.js';
import { LEVEL1 } from '../src/levels/level1.js';
import { LEVEL2 } from '../src/levels/level2.js';
import { LEVEL3 } from '../src/levels/level3.js'; // WO7 Phase 0

import { LEVEL4 } from '../src/levels/level4.js'; // WO9 Phase 0
import { LEVEL5 } from '../src/levels/level5.js'; // WO9 Phase 0
import { LEVEL6 } from '../src/levels/level6.js'; // WO9 Phase 0
// WO9 Phase 0: the validity suite now lives in tests/helpers/levelcheck.js (frozen; level agents
// import it from their own test files). Behaviour is unchanged apart from the WO9 pit tile '~'.
import {
  COLS, ROWS, PERK_LETTERS, TIER3_GUNS, NEW_GUNS, WO4_ASCII, WO4_WALLBUYS,
  parseLevel, bfs, key, touches, playerBfs, openingStep,
  validateWO4, validateArena, validatePerks, validatePap,
  checkMeta, checkTheme, checkWO9Guns, tileDiff, freeStandingBlocks, validateLevel, assertValidLevel,
} from './helpers/levelcheck.js';

// WO8 placements (docs/notes/levels.md): vault pillar, sanctum altar, reactor room NE corner.
const PAP_PLAN = { bunker: [51, 32], catacombs: [38, 31], lab: [56, 11] };

// ---- tests ----------------------------------------------------------------------------------

test('levels registry: LEVELS = [LEVEL1 .. LEVEL6], levelByIndex wraps', () => {
  // WO7 Phase 0: third level registered (was length 2). WO9 Phase 0: six levels.
  const ALL = [LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5, LEVEL6];
  assert.equal(LEVELS.length, ALL.length);
  const N = LEVELS.length;
  ALL.forEach((d, i) => { assert.equal(LEVELS[i], d); assert.equal(levelByIndex(i), d); assert.equal(levelByIndex(i + N), d); });
  assert.equal(levelByIndex(N), LEVEL1); assert.equal(levelByIndex(N + 1), LEVEL2);
  assert.equal(levelByIndex(-1), LEVELS[N - 1]);
  assert.equal(new Set(LEVELS.map((d) => d.id)).size, N, 'unique ids');
  assert.deepEqual([LEVEL4.id, LEVEL4.name, LEVEL5.id, LEVEL5.name, LEVEL6.id, LEVEL6.name],
    ['kino', 'KINO', 'outpost', 'OUTPOST', 'temple', 'TEMPLE']);
  assert.equal(LEVEL3.id, 'lab'); assert.equal(LEVEL3.name, 'LABORATORY');
  assert.equal(LEVEL1.id, 'bunker'); assert.equal(LEVEL1.name, 'BUNKER');
  assert.equal(LEVEL2.id, 'catacombs'); assert.equal(LEVEL2.name, 'CATACOMBS');
  assert.equal(LEVEL1.boss.name, 'THE WARDEN'); assert.equal(LEVEL2.boss.name, 'THE BONE PRIEST');
});

test('difficulty objects per WO5 1.3', () => {
  assert.deepEqual(LEVEL1.difficulty, { healthMult: 1, speedMult: 1, countMult: 1, sprintShift: 0 });
  assert.deepEqual(LEVEL2.difficulty, { healthMult: 1.5, speedMult: 1.1, countMult: 1.25, sprintShift: 3 });
  assert.deepEqual(LEVEL3.difficulty, { healthMult: 2.0, speedMult: 1.2, countMult: 1.5, sprintShift: 5 }); // WO7 1.5
  // WO9 1.1
  assert.deepEqual(LEVEL4.difficulty, { healthMult: 2.4, speedMult: 1.22, countMult: 1.6, sprintShift: 7 });
  assert.deepEqual(LEVEL5.difficulty, { healthMult: 2.9, speedMult: 1.24, countMult: 1.7, sprintShift: 9 });
  assert.deepEqual(LEVEL6.difficulty, { healthMult: 3.5, speedMult: 1.26, countMult: 1.8, sprintShift: 11 });
  // strictly rising 1 -> 6 (speed never decreases)
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1].difficulty, b = LEVELS[i].difficulty;
    assert.ok(b.healthMult > a.healthMult && b.countMult > a.countMult && b.sprintShift > a.sprintShift && b.speedMult >= a.speedMult, `${LEVELS[i].id} harder than ${LEVELS[i - 1].id}`);
  }
});

test('WO9 bosses: THE PROJECTIONIST (charge), THE WENDIGO (frost), THE DROWNED KING (tide)', () => {
  assert.deepEqual(LEVEL4.boss, { name: 'THE PROJECTIONIST', tint: '#d9b25a', ability: 'charge' });
  assert.deepEqual(LEVEL5.boss, { name: 'THE WENDIGO', tint: '#bfe8ff', ability: 'frost' });
  assert.deepEqual(LEVEL6.boss, { name: 'THE DROWNED KING', tint: '#3fd6a8', ability: 'tide' });
  for (const def of LEVELS) { checkMeta(def); checkTheme(def); }
});

test('themes: level 1 = WO4 greys, no tint/torches; level 2 = catacombs with tint + torches', () => {
  assert.equal(LEVEL1.theme.ambient, null); assert.equal(LEVEL1.theme.torch, false);
  assert.equal(LEVEL2.theme.torch, true);
  assert.match(LEVEL2.theme.ambient, /^rgba\(/);
  // WO7 1.5 / scaffold note 4: lab keeps torch false, flicker true, a checker floor
  assert.equal(LEVEL3.theme.torch, false); assert.equal(LEVEL3.theme.flicker, true);
  assert.notEqual(LEVEL3.theme.floor, LEVEL3.theme.floorAlt);
  assert.match(LEVEL3.theme.ambient, /^rgba\(/);
  assert.deepEqual(LEVEL3.boss, { name: 'THE SUBJECT', tint: '#7fe040', ability: 'acid' });
  for (const def of LEVELS) for (const k of ['floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'doorWood', 'doorIron']) {
    assert.match(def.theme[k], /^#[0-9a-f]{6}$/i, `${def.id}.theme.${k}`);
  }
});

test('the suite itself: WO4 layout passes the WO4 checks, fails the arena rules', () => {
  const wo4 = { id: 'wo4', ascii: WO4_ASCII, wallbuys: WO4_WALLBUYS };
  assert.throws(() => validateWO4(wo4), /6 zones \+ arena/); // no arena: 6 components, not 7
  assert.throws(() => validateArena({ ...LEVEL2, ascii: LEVEL2.ascii.map((r) => r.replace(/M/g, '#')) }), /M and T present|6 zones/);
  const leaky = LEVEL1.ascii.map((r, y) => (y === 26 ? r.slice(0, 37) + '....' + r.slice(41) : r)); // hub east wall hole into the arena
  assert.throws(() => validateArena({ ...LEVEL1, ascii: leaky }), /zones|arena/);
  // WO5-review L1 layout (Argus at 42,29, one wall row below the arena) must fail the new rule
  const oldArgus = LEVEL1.ascii.map((r, y) => (y === 29 ? r.slice(0, 38) + '#' + r.slice(39, 42) + '9' + r.slice(43) : r));
  assert.throws(() => validateArena({ ...LEVEL1, ascii: oldArgus }), /interactable through the wall/);
  const broken = LEVEL1.ascii.map((r, y) => (y === 20 ? '.' + r.slice(1) : r));
  assert.throws(() => validateWO4({ ...LEVEL1, ascii: broken }), /border/);
});

for (const def of LEVELS) {
  test(`${def.id}: WO4 layout validity suite`, () => { validateWO4(def); });
  test(`${def.id}: WO5 arena rules`, () => { validateArena(def); });
}

test('bunker: WO4 wall buys unchanged; edit confined to the arena/vault block (+ WO7 perk tiles)', () => {
  assert.deepEqual(LEVEL1.wallbuys, WO4_WALLBUYS);
  // WO7: perk machines replace WO4 wall tiles; compare with them turned back into wall
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (LEVEL1.ascii[y][x] in PERK_LETTERS) assert.equal(WO4_ASCII[y][x], '#', `perk at ${x},${y} replaced a wall`);
  }
  // WO8: the Pack-a-Punch machine (a vault pillar tile) is turned back into wall too
  const plain = LEVEL1.ascii.map((r) => r.replace(/[JQCNUKA]/g, '#'));
  const changed = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (plain[y][x] !== WO4_ASCII[y][x]) changed.push([x, y]);
  }
  assert.ok(changed.length > 0);
  for (const [x, y] of changed) assert.ok(x >= 38 && x <= 58 && y >= 16 && y <= 37, `unexpected edit at ${x},${y}`);
  // same number of every door / spawn / buy letter (ICR-1 'c' and open spawn 9 moved)
  const count = (rows, ch) => rows.join('').split(ch).length - 1;
  for (const ch of ['D', 'E', 'F', 'G', 'H', 'W', 'S', 'O', 'B', 'P', ...Object.keys(WO4_WALLBUYS)]) {
    assert.equal(count(plain, ch), count(WO4_ASCII, ch), `count of '${ch}'`);
  }
  const now = parseLevel({ ...LEVEL1, ascii: plain }), old = parseLevel({ ascii: WO4_ASCII, wallbuys: WO4_WALLBUYS });
  for (const dr of now.doors) assert.deepEqual(dr.tiles, old.doors.find((o) => o.letter === dr.letter).tiles, `door ${dr.letter} unchanged`);
  assert.deepEqual(now.windows, old.windows, 'windows unchanged');
  assert.deepEqual(now.start, old.start, 'start unchanged');
  assert.deepEqual(now.boxes, old.boxes, 'box unchanged');
});

// WO7 3.4: perk steps (0 = start zone, 1..5 = behind D..H) per the named zones.
const PERK_PLAN = {
  // L1: Q hub, J corridor (D), C courtyard (E), N bunker (F), U armory (G), K vault (H)
  bunker: { revive: 0, jugg: 1, speed: 2, dtap: 3, stamin: 4, mule: 5 },
  // L2: Q chapel, C ossuary (D), J west crypts (E), N bone chamber (F), U charnel pit (G), K sanctum (H)
  catacombs: { revive: 0, speed: 1, jugg: 2, dtap: 3, stamin: 4, mule: 5 },
  // L3: Q lobby, C sterile corridor (D), J west labs (E), N containment (F), U cryo (G), K reactor (H)
  lab: { revive: 0, speed: 1, jugg: 2, dtap: 3, stamin: 4, mule: 5 },
};

for (const def of LEVELS) {
  test(`${def.id}: WO7 perk machines (6, one per perk, Q start, K deepest, reachable, clear of arena and wall buys)`, () => {
    validatePerks(def, PERK_PLAN[def.id]);
  });
}

test('the perk checks catch broken placements', () => {
  const swap = (def, fn) => ({ ...def, ascii: def.ascii.map((r, y) => fn(r, y)) });
  const put = (r, x, ch) => r.slice(0, x) + ch + r.slice(x + 1);
  // a missing machine
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace('U', '#'))), /6 perk machines/);
  // a duplicate perk instead of another one
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace('U', 'N'))), /one machine per perk/);
  // Quick Revive and Mule Kick swapped
  assert.throws(() => validatePerks(swap(LEVEL2, (r) => r.replace(/[QK]/g, (c) => (c === 'Q' ? 'K' : 'Q')))), /Quick Revive|Mule Kick/);
  // too close to a wall buy: L1 Quick Revive moved along the hub's south wall to (21,27), 5 from KRM-262 (17,26)
  assert.throws(() => validatePerks(swap(LEVEL1, (r, y) => (y === 27 ? put(put(r, 24, '#'), 21, 'Q') : r))), /wall buy/);
  // next to the arena: L1 Juggernog moved into the arena's west wall (40,19)
  assert.throws(() => validatePerks(swap(LEVEL1, (r, y) => (y === 10 ? put(r, 41, '#') : y === 19 ? put(r, 40, 'J') : r))), /reachable|arena/);
  // a machine in a 1-thick wall between two zones (L1 hub / courtyard wall at (20,18) is 4 thick; use L2 chapel octagon (19,20): crypts one side, chapel the other)
  assert.throws(() => validatePerks(swap(LEVEL2, (r, y) => (y === 11 ? put(r, 22, '#') : y === 20 ? put(r, 19, 'Q') : r))), /one zone only/);
  // named zones: L1 Stamin-Up and Double Tap swapped
  assert.throws(() => validatePerks(swap(LEVEL1, (r) => r.replace(/[NU]/g, (c) => (c === 'N' ? 'U' : 'N'))), PERK_PLAN.bunker), /perk zones/);
});

for (const def of LEVELS) {
  test(`${def.id}: WO8 Pack-a-Punch machine (one A, deepest zone, clear of arena, wall buys and perks)`, () => {
    const p = validatePap(def);
    // WO9: levels 4-6 pin their PaP position in their own test files (tests/level4-6.test.js).
    if (PAP_PLAN[def.id]) assert.deepEqual([p.x, p.y], PAP_PLAN[def.id], `${def.id}: PaP position per docs/notes/levels.md`);
  });
}

test('the Pack-a-Punch checks catch broken placements', () => {
  const swap = (def, fn) => ({ ...def, ascii: def.ascii.map((r, y) => fn(r, y)) });
  const put = (r, x, ch) => r.slice(0, x) + ch + r.slice(x + 1);
  // missing
  assert.throws(() => validatePap(swap(LEVEL1, (r) => r.replace('A', '#'))), /exactly one/);
  // two machines (second on the L1 vault's west wall, 47,30)
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 30 ? put(r, 47, 'A') : r))), /exactly one/);
  // in the start zone: L1 hub south wall (27,27) instead of the vault
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 27 ? put(r, 27, 'A') : r.replace('A', '#')))), /mega door|door H/);
  // behind G, not H: L1 armory south wall (28,37)
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 37 ? put(r, 28, 'A') : r.replace('A', '#')))), /mega door|door H/);
  // too close to a wall buy: L1 vault south wall (50,37), 2 from ICR-1 (52,37)
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 37 ? put(r, 50, 'A') : r.replace('A', '#')))), /wall buy/);
  // too close to a perk: L1 vault east wall (57,36), 2 from Mule Kick (57,34), 6 from ICR-1
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 36 ? put(r, 57, 'A') : r.replace('A', '#')))), /perk machine/);
  // next to the arena: L1 vault west wall (47,29), 2 rows below the arena floor (47,27)
  assert.throws(() => validatePap(swap(LEVEL1, (r, y) => (y === 29 ? put(r, 47, 'A') : r.replace('A', '#')))), /arena/);
  // in a wall between two zones: L2 chapel octagon (19,20), crypts one side, chapel the other
  assert.throws(() => validatePap(swap(LEVEL2, (r, y) => (y === 20 ? put(r, 19, 'A') : r.replace('A', '#')))), /one zone only/);
  // not facing floor at all (buried in rock)
  assert.throws(() => validatePap(swap(LEVEL3, (r, y) => (y === 38 ? put(r, 50, 'A') : r.replace('A', '#')))), /faces floor/);
  // 'A' as a wall-buy key
  assert.throws(() => validatePap({ ...LEVEL2, wallbuys: { ...LEVEL2.wallbuys, A: 'kn44' } }), /wall-buy key/);
});

test('lab: new layout; tier-3 guns on the walls, Gorgon + Drakon deepest, cheap gun in the lobby', () => {
  for (const other of [LEVEL1, LEVEL2]) {
    let diff = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (LEVEL3.ascii[y][x] !== other.ascii[y][x]) diff++;
    assert.ok(diff > COLS * ROWS * 0.25, `only ${diff} tiles differ from ${other.id}`);
  }
  const L = parseLevel(LEVEL3);
  const placed = new Set(L.buys.map((b) => b.weaponId));
  for (const g of [...TIER3_GUNS, 'gorgon', 'drakon']) assert.ok(placed.has(g), `${g} on a lab wall`);
  const dNoH = playerBfs(L, ['D', 'E', 'F', 'G']);
  assert.deepEqual(L.buys.filter((b) => !touches(dNoH, b)).map((b) => b.weaponId).sort(), ['drakon', 'gorgon']);
  const startBuy = L.buys.filter((b) => touches(playerBfs(L, []), b));
  assert.equal(startBuy.length, 1);
  assert.ok(!TIER3_GUNS.includes(startBuy[0].weaponId) && !['gorgon', 'drakon'].includes(startBuy[0].weaponId));
  for (const b of L.buys.filter((x) => TIER3_GUNS.includes(x.weaponId))) assert.ok(openingStep(L, b) >= 1, `${b.weaponId} behind a door`);
  // glass tanks / pods / benches: free-standing wall blocks inside rooms (not joined to the outer rock)
  const blocks = freeStandingBlocks(LEVEL3);
  assert.ok(blocks >= 12, `lab has ${blocks} free-standing decor blocks`);
});

test('catacombs: new layout; all new guns on the walls, best guns deepest', () => {
  let diff = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (LEVEL2.ascii[y][x] !== LEVEL1.ascii[y][x]) diff++;
  assert.ok(diff > COLS * ROWS * 0.25, `only ${diff} tiles differ from level 1`);
  const L = parseLevel(LEVEL2);
  const placed = new Set(L.buys.map((b) => b.weaponId));
  for (const g of NEW_GUNS) assert.ok(placed.has(g), `${g} on a level-2 wall`);
  // the zone behind H sells gorgon + drakon; the start room sells no new gun
  const dNoH = playerBfs(L, ['D', 'E', 'F', 'G']);
  assert.deepEqual(L.buys.filter((b) => !touches(dNoH, b)).map((b) => b.weaponId).sort(), ['drakon', 'gorgon']);
  const startBuy = L.buys.filter((b) => touches(playerBfs(L, []), b));
  assert.ok(!NEW_GUNS.includes(startBuy[0].weaponId));
});

test('levels/*.js are pure and import nothing outside src/levels/', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\/[\w-]+\.js$/, `${f} imports ${m[1]}`);
    }
    assert.ok(!/\bimport\s*\(/.test(src), `${f}: dynamic import`);
    assert.ok(!/Math\.random|\bdocument\.\w|\bwindow\.\w/.test(src), `${f}: impure`);
  }
});

// ---- WO9 Phase 0 ----------------------------------------------------------------------------

// Levels 4-6 are Phase-0 stubs (copies of level 3) until A / B / C land their layouts.
const isStub = (def) => LEVELS.indexOf(def) >= 3 && tileDiff(def, LEVEL3) === 0;

test('WO9 levelcheck: validateLevel returns [] for every level, lists violations otherwise', () => {
  for (const def of LEVELS) {
    assert.deepEqual(validateLevel(def, { perkPlan: PERK_PLAN[def.id], papPos: PAP_PLAN[def.id] }), [], def.id);
    assert.ok(assertValidLevel(def).start, def.id);
  }
  const broken = { ...LEVEL1, theme: { ...LEVEL1.theme, floor: 'red' }, ascii: LEVEL1.ascii.map((r) => r.replace('A', '#')) };
  const v = validateLevel(broken);
  assert.equal(v.length, 2, v.join(' | '));
  assert.match(v[0], /^theme: /); assert.match(v[1], /^pack-a-punch \(WO8\): .*exactly one/);
  assert.throws(() => assertValidLevel(broken), /2 level violation/);
  assert.match(validateLevel(LEVEL1, { wo9Guns: true }).join(), /guns \(WO9\)/); // bunker sells no tier-3 guns
  assert.match(validateLevel(LEVEL1, { papPos: [1, 1] }).join(), /Pack-a-Punch at 51,32/);
});

test('WO9 levelcheck: pit tiles are legal, block movers and may border arena floor', () => {
  const put = (r, x, ch) => r.slice(0, x) + ch + r.slice(x + 1);
  // a row of pits across level 3's lobby: legal chars; the lobby is split, so the zone count breaks
  const split = { ...LEVEL3, ascii: LEVEL3.ascii.map((r, y) => (y === 28 ? r.slice(0, 22) + '~'.repeat(16) + r.slice(38) : r)) };
  assert.throws(() => validateWO4(split), /zones|reach|spawn|approachable/);
  // a single pit tile in open floor is fine
  const one = { ...LEVEL3, ascii: LEVEL3.ascii.map((r, y) => (y === 24 ? put(r, 30, '~') : r)) };
  assert.deepEqual(validateLevel(one), []);
  // a pit inside the arena (not a pillar) is allowed
  const arenaPit = { ...LEVEL3, ascii: LEVEL3.ascii.map((r, y) => (y === 21 ? put(r, 50, '~') : r)) };
  assert.deepEqual(validateLevel(arenaPit), []);
});

test('WO9 levels 4-6: full validity suite + WO9 wall guns (stubs are copies of level 3)', () => {
  for (const def of [LEVEL4, LEVEL5, LEVEL6]) {
    assertValidLevel(def, { wo9Guns: true });
  }
});

test('WO9 levels 4-6: layouts differ from every other level once authored (skips stubs)', () => {
  const authored = LEVELS.filter((d) => !isStub(d));
  for (const def of authored.filter((d) => LEVELS.indexOf(d) >= 3)) {
    for (const other of authored) {
      if (other === def) continue;
      const diff = tileDiff(def, other);
      assert.ok(diff > COLS * ROWS * 0.25, `${def.id}: only ${diff} tiles differ from ${other.id}`);
    }
  }
});
