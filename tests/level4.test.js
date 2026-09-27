// tests/level4.test.js — WO9 1.2 level 4 KINO (Agent A).
// Full validity suite from tests/helpers/levelcheck.js (frozen) plus KINO-specific layout checks:
// Pack-a-Punch centre-stage inside the theatre (deepest zone), seat rows with aisles, zone flow
// (lobby -> foyer -> dressing rooms / alley -> projection room -> theatre -> arena), gun mix, theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEVEL4 } from '../src/levels/level4.js';
import { LEVELS } from '../src/levels/levels.js';
import {
  COLS, ROWS, DOOR_LETTERS, FLOORISH, TIER3_GUNS,
  assertValidLevel, validateLevel, parseLevel, zones, key, playerBfs, touches, openingStep,
  neighbourZones, tileDiff, freeStandingBlocks, checkInteractReach,
} from './helpers/levelcheck.js';

const here = dirname(fileURLToPath(import.meta.url));
const PERK_PLAN = { revive: 0, dtap: 1, speed: 2, stamin: 3, jugg: 4, mule: 5 };
const PAP = [36, 3];
const OPTS = { wo9Guns: true, perkPlan: PERK_PLAN, papPos: PAP };
// Theatre interior (the zone behind H) and its landmarks.
const TH = { x0: 17, x1: 55, y0: 2, y1: 18 };
const STAGE = [2, 5], CURTAIN_ROW = 6, SEAT_ROWS = [8, 11, 14];

const L = parseLevel(LEVEL4);
const Z = zones(L);
const zoneOf = (x, y) => Z.comp[key(x, y)];
const hZones = () => [...neighbourZones(Z, L.doors.find((d) => d.letter === 'H').tiles)];
const theatreZone = () => {
  // the side of H not reachable with D..G open
  const d = playerBfs(L, ['D', 'E', 'F', 'G']);
  return hZones().find((z) => { for (let k = 0; k < Z.comp.length; k++) if (Z.comp[k] === z) return d[k] < 0; return false; });
};

test('KINO: registry slot, id/name/boss/difficulty pinned', () => {
  assert.equal(LEVELS[3], LEVEL4);
  assert.equal(LEVEL4.id, 'kino');
  assert.equal(LEVEL4.name, 'KINO');
  assert.deepEqual(LEVEL4.boss, { name: 'THE PROJECTIONIST', tint: '#d9b25a', ability: 'charge' });
  assert.deepEqual(LEVEL4.difficulty, { healthMult: 2.4, speedMult: 1.22, countMult: 1.6, sprintShift: 7 });
});

test('KINO: passes the full level validity suite (WO4/5/7/8/9)', () => {
  assert.deepEqual(validateLevel(LEVEL4, OPTS), []);
  assertValidLevel(LEVEL4, OPTS);
});

test('KINO: Pack-a-Punch stands centre-stage inside the theatre (deepest zone)', () => {
  const [a] = L.paps;
  assert.deepEqual([a.x, a.y], PAP);
  assert.ok(a.y >= STAGE[0] && a.y <= STAGE[1], 'A on a stage row');
  assert.ok(Math.abs(a.x - (TH.x0 + TH.x1) / 2) <= 1, 'A centred on the stage');
  // free-standing: all four neighbours are stage floor of the theatre zone
  const tz = theatreZone();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    assert.ok(FLOORISH.has(L.at(a.x + dx, a.y + dy)), 'A surrounded by stage floor');
    assert.equal(zoneOf(a.x + dx, a.y + dy), tz, 'A faces the theatre zone');
  }
  assert.equal(openingStep(L, a), 5, 'A behind H');
  // the stage rows are floor across the theatre except A; the mega door leaves from the stage wing
  for (let y = STAGE[0]; y <= STAGE[1]; y++) for (let x = TH.x0; x <= TH.x1; x++) {
    if (x === a.x && y === a.y) continue;
    assert.ok(FLOORISH.has(L.at(x, y)), `stage floor at ${x},${y}`);
  }
  assert.ok(neighbourZones(Z, L.mega).has(tz), 'mega door opens off the theatre');
  assert.ok(L.mega.every((m) => m.y >= STAGE[0] && m.y <= STAGE[1] && m.x === TH.x0 - 1), 'M in the stage-left wing wall');
});

test('KINO: curtain line in front of the stage with steps up at both ends', () => {
  const row = L.def.ascii[CURTAIN_ROW].slice(TH.x0, TH.x1 + 1);
  assert.match(row, /^\.{2,4}#{25,}\.{2,4}$/, `curtain row: ${row}`);
});

test('KINO: auditorium has long seat rows with aisles between them', () => {
  const tz = theatreZone();
  for (const y of SEAT_ROWS) {
    const row = L.def.ascii[y].slice(TH.x0, TH.x1 + 1);
    const runs = row.match(/#+/g) || [];
    assert.equal(runs.length, 2, `seat row ${y}: two sections (${row})`);
    for (const r of runs) assert.ok(r.length >= 12, `seat row ${y}: section of ${r.length} seats`);
    // side aisles and a centre aisle cut every row
    assert.match(row, /^\.{2}#+\.{2,4}#+\.{2}$/, `seat row ${y}: side + centre aisles`);
  }
  // 2-tile cross aisles between consecutive seat rows, open across the whole auditorium
  for (let i = 1; i < SEAT_ROWS.length; i++) {
    assert.equal(SEAT_ROWS[i] - SEAT_ROWS[i - 1], 3, 'seat rows 3 apart');
    for (let y = SEAT_ROWS[i - 1] + 1; y < SEAT_ROWS[i]; y++) {
      for (let x = TH.x0; x <= TH.x1; x++) {
        assert.ok(FLOORISH.has(L.at(x, y)), `aisle floor at ${x},${y}`);
        assert.equal(zoneOf(x, y), tz);
      }
    }
  }
  // seat blocks are free-standing (not joined to the outer walls); the map has lots of decor blocks
  assert.ok(freeStandingBlocks(LEVEL4) >= 12, `free-standing decor blocks: ${freeStandingBlocks(LEVEL4)}`);
});

test('KINO: zone flow lobby -> foyer/alley -> dressing/projection -> theatre', () => {
  const step = (x, y) => openingStep(L, { x, y });
  assert.equal(step(30, 34), 0, 'lobby is the start');
  assert.equal(step(30, 24), 1, 'foyer behind D');
  assert.equal(step(8, 16), 2, 'dressing rooms behind E');
  assert.equal(step(50, 30), 3, 'alley behind F');
  assert.equal(step(24, 21), 4, 'projection room behind G');
  assert.equal(step(36, 12), 5, 'theatre behind H');
  // the box is in the dressing rooms (behind D + E)
  assert.equal(openingStep(L, L.boxes[0]), 2);
  assert.ok(L.boxes[0].x <= 15 && L.boxes[0].y >= 15, 'box in the dressing rooms');
  // the lobby has exactly the two doors out (D north, F east)
  const d0 = playerBfs(L, []);
  const out = L.doors.filter((dr) => dr.tiles.some((t) => touches(d0, t))).map((dr) => dr.letter);
  assert.deepEqual(out, ['D', 'F']);
  // Mule Kick, Pack-a-Punch and the mega door share the theatre zone
  const tz = theatreZone();
  const k = L.perks.find((p) => p.perkId === 'mule');
  assert.equal(zoneOf(k.x, k.y + 1), tz);
});

test('KINO: wall guns (tier 3 behind doors, tier 2 mix, cheap lobby gun, >= 8 apart)', () => {
  const ids = L.buys.map((b) => b.weaponId).sort();
  assert.deepEqual(ids, ['drakon', 'gorgon', 'hg40', 'kn44', 'm8a7', 'manowar', 'marshal16', 'peacekeeper']);
  const d0 = playerBfs(L, []);
  const start = L.buys.filter((b) => touches(d0, b));
  assert.deepEqual(start.map((b) => b.weaponId), ['kn44']);
  for (const b of L.buys.filter((x) => TIER3_GUNS.includes(x.weaponId))) assert.ok(openingStep(L, b) >= 4, `${b.weaponId} deep`);
  for (let i = 0; i < L.buys.length; i++) for (let j = i + 1; j < L.buys.length; j++) {
    const a = L.buys[i], b = L.buys[j];
    assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= 8);
  }
});

test('KINO: spawns per zone (lobby 2 W, alley 1 W + 1 O, stage-door O)', () => {
  const d0 = playerBfs(L, []);
  assert.equal(L.windows.filter((w) => touches(d0, w)).length, 2);
  const alley = L.opens.find((o) => o.x >= 46 && o.y >= 20);
  assert.ok(alley, 'alley open spawn');
  assert.equal(openingStep(L, alley), 3);
  assert.equal(L.windows.filter((w) => openingStep(L, w) === 3).length, 1, 'alley has one window');
  const stage = L.opens.find((o) => o.y >= STAGE[0] && o.y <= STAGE[1]);
  assert.ok(stage, 'stage door open spawn');
  assert.equal(openingStep(L, stage), 5);
});

test('KINO: differs from every other level in > 25 % of tiles', () => {
  for (const other of LEVELS) {
    if (other === LEVEL4) continue;
    const n = tileDiff(LEVEL4, other);
    assert.ok(n > COLS * ROWS * 0.25, `${other.id}: only ${n} tiles differ`);
  }
});

test('KINO: theme is red carpet / dark wood / gold, warm lamps, no flicker', () => {
  const t = LEVEL4.theme;
  assert.equal(t.style, 'kino');
  assert.equal(t.name, 'KINO');
  assert.equal(t.torch, true);
  assert.equal(t.flicker, false);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const k of ['floor', 'floorAlt']) {
    const [r, g, b] = rgb(t[k]);
    assert.ok(r > 2 * g && r > 2 * b && r < 140, `${k} is deep red`);
  }
  const [wr, wg, wb] = rgb(t.wall);
  assert.ok(wr + wg + wb < 150 && wr >= wg && wg >= wb, 'wall is dark wood');
  const [ar, ag, ab] = rgb(t.accent);
  assert.ok(ar > 180 && ag > 140 && ab < 120, 'accent is gold');
  const alpha = Number(/,\s*([0-9.]+)\)$/.exec(t.ambient)[1]);
  assert.ok(alpha > 0 && alpha <= 0.08, 'subtle ambient');
});

test('KINO: level file is pure data (no imports, no DOM, no Math.random)', () => {
  const src = readFileSync(join(here, '..', 'src', 'levels', 'level4.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/\bimport\b/.test(code));
  assert.ok(!/Math\.random|window\.|document\./.test(code));
  assert.equal(DOOR_LETTERS.every((d) => L.doors.find((x) => x.letter === d).tiles.length === 3), true, 'all doors 3 wide');
});

// ---- WO9 FIX-1 (QA docs/qa/wo9-kino.md #1, #2, #3) -----------------------------------------------

test('KINO FIX-1: Juggernog on the reel cabinet; Quick Revive on the booth; KN-44 on the west stairs', () => {
  const at = (ch) => L.find((c) => c === ch).map((t) => [t.x, t.y]);
  assert.deepEqual(at('J'), [[37, 21]]);
  assert.deepEqual(at('Q'), [[30, 33]]);
  assert.deepEqual(at('1'), [[19, 31]]);
  checkInteractReach(LEVEL4);
});

test('KINO FIX-1: the interact-reach check catches the old foyer-diagonal Juggernog (41,23)', () => {
  const put = (r, x, ch) => r.slice(0, x) + ch + r.slice(x + 1);
  const old = { ...LEVEL4, ascii: LEVEL4.ascii.map((r, y) => (y === 21 ? put(r, 37, '#') : y === 23 ? put(r, 41, 'J') : r)) };
  assert.throws(() => checkInteractReach(old), /jugg.*41,23.*in interact range/);
  assert.match(validateLevel(old).join(), /interact reach/);
  // the QA-suggested KN-44 spot (20,30) is 54 px from the foyer floor (row 28) across one wall row
  const kn = { ...LEVEL4, ascii: LEVEL4.ascii.map((r, y) => (y === 31 ? put(r, 19, '#') : y === 30 ? put(r, 20, '1') : r)) };
  assert.throws(() => checkInteractReach(kn), /kn44.*from floor \d+,28 /);
});

test('KINO FIX-1: theme.floorZones cover exactly the dressing rooms, the alley and the vault', () => {
  const fz = LEVEL4.theme.floorZones;
  assert.deepEqual(fz.map((z) => z.floor), ['boards', 'asphalt', 'concrete']);
  const want = [zoneOf(8, 16), zoneOf(50, 30), Z.comp[key(L.boss[0].x, L.boss[0].y)]];
  fz.forEach((r, i) => {
    for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Number.isInteger(r[k]), `${r.floor}.${k}`);
    assert.ok(r.x0 <= r.x1 && r.y0 <= r.y1 && r.x0 >= 0 && r.y0 >= 0 && r.x1 < COLS && r.y1 < ROWS);
    // every floor tile inside the rect is the zone's, and every tile of the zone is inside the rect
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const z = Z.comp[key(x, y)];
      const inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      if (inside && z >= 0) assert.equal(z, want[i], `${r.floor}: ${x},${y} belongs to another zone`);
      if (z === want[i]) assert.ok(inside, `${r.floor}: zone tile ${x},${y} outside the rect`);
    }
  });
});
