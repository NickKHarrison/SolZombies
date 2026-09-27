// tests/scores.test.js — WO7 T4 high-score table (Agent J).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadScores, saveScores, recordRun, topScores, clearScores, formatTime, bestScore,
  createMemoryStorage, createGuardedStorage, compareEntries, normalizeEntry, SCHEMA_VERSION, loadRecord,
} from '../src/scores.js';
import { SCORES } from '../src/config.js';

const KEY = SCORES.key;
const MAX = SCORES.max;

function stats(o = {}) {
  return {
    kills: 0, shotsFired: 0, shotsHit: 0, pointsEarned: 0, roundReached: 0,
    timeSurvived: 0, levelReached: 1, bossesKilled: 0, powerupsCollected: 0, doorsOpened: 0,
    meleeKills: 0, perksBought: 0, bestWeaponId: null,
    ...o,
  };
}
const run = (round, points = 0, timeSurvived = 0) => stats({ roundReached: round, pointsEarned: points, timeSurvived });

function throwingStorage(err = 'QuotaExceededError') {
  const fail = () => { const e = new Error('nope'); e.name = err; throw e; };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

test('recordRun: entry fields come from stats (+extra), per WO7 1.4', () => {
  const st = createMemoryStorage();
  const r = recordRun(stats({
    roundReached: 12, pointsEarned: 3450, kills: 211, levelReached: 3, bossesKilled: 2,
    timeSurvived: 754.9, bestWeaponId: 'm8a7',
  }), { perks: ['jugg', 'speed'] }, st);
  const e = r.entry;
  assert.equal(e.round, 12);
  assert.equal(e.points, 3450);
  assert.equal(e.kills, 211);
  assert.equal(e.level, 3);
  assert.equal(e.bosses, 2);
  assert.equal(e.timeSec, 754, 'time floored');
  assert.equal(e.weapon, 'm8a7');
  assert.deepEqual(e.perks, ['jugg', 'speed']);
  assert.ok(!Number.isNaN(Date.parse(e.date)), 'ISO date');
  assert.equal(new Date(e.date).toISOString(), e.date);
  assert.deepEqual(Object.keys(e).sort(), ['bosses', 'date', 'kills', 'level', 'pap', 'perks', 'points', 'round', 'timeSec', 'weapon']);
  assert.equal(r.rank, 1);
  assert.equal(r.isBestRound, true);
  assert.equal(r.isBestPoints, true);
  assert.deepEqual(r.best, { round: 12, points: 3450 });
  assert.deepEqual(loadScores(st), [e]);
});

test('recordRun: extra overrides stats fields; missing / garbage stats give a sane entry', () => {
  const st = createMemoryStorage();
  const r = recordRun(stats({ roundReached: 5 }), { round: 7, weapon: 'knife', date: '2026-01-01T00:00:00.000Z' }, st);
  assert.equal(r.entry.round, 7);
  assert.equal(r.entry.weapon, 'knife');
  assert.equal(r.entry.date, '2026-01-01T00:00:00.000Z');
  const g = recordRun(null, null, createMemoryStorage()).entry;
  assert.deepEqual({ ...g, date: '' }, { round: 0, points: 0, kills: 0, level: 1, bosses: 0, timeSec: 0, pap: 0, perks: [], weapon: null, date: '' });
  const n = recordRun({ roundReached: NaN, pointsEarned: Infinity, kills: -4, timeSurvived: 'x', levelReached: 0 }, {}, createMemoryStorage()).entry;
  assert.equal(n.round, 0);
  assert.equal(n.points, 0);
  assert.equal(n.kills, 0);
  assert.equal(n.timeSec, 0);
  assert.equal(n.level, 1);
});

test('ranking: round desc, then points desc, then time desc', () => {
  const st = createMemoryStorage();
  recordRun(run(5, 1000, 100), {}, st);
  recordRun(run(8, 500, 100), {}, st);
  recordRun(run(5, 2000, 100), {}, st);
  recordRun(run(5, 1000, 300), {}, st);
  const top = topScores(10, st).map((e) => [e.round, e.points, e.timeSec]);
  assert.deepEqual(top, [[8, 500, 100], [5, 2000, 100], [5, 1000, 300], [5, 1000, 100]]);
  assert.ok(compareEntries({ round: 2, points: 0, timeSec: 0 }, { round: 1, points: 9, timeSec: 9 }) < 0);
});

test('ranking: ranks returned per insertion; exact ties rank below the older run', () => {
  const st = createMemoryStorage();
  assert.equal(recordRun(run(5, 1000, 60), {}, st).rank, 1);
  assert.equal(recordRun(run(3, 100, 60), {}, st).rank, 2);
  assert.equal(recordRun(run(4, 100, 60), {}, st).rank, 2);
  const tie = recordRun(run(5, 1000, 60), { weapon: 'newer' }, st);
  assert.equal(tie.rank, 2, 'full tie goes below the existing entry');
  assert.equal(tie.isBestRound, false, 'strict: equal round is not a new best');
  assert.equal(tie.isBestPoints, false);
  const list = topScores(10, st);
  assert.equal(list[1].weapon, 'newer');
  assert.deepEqual(list.map((e) => e.round), [5, 5, 4, 3]);
});

test('trimming: keeps at most SCORES.max; a run below the table gets rank null', () => {
  const st = createMemoryStorage();
  for (let i = 1; i <= MAX + 5; i++) recordRun(run(i, i * 10), {}, st);
  const list = loadScores(st);
  assert.equal(list.length, MAX);
  assert.equal(list[0].round, MAX + 5);
  assert.equal(list[MAX - 1].round, 6);
  const low = recordRun(run(1, 5), {}, st);
  assert.equal(low.rank, null);
  assert.equal(low.isBestRound, false);
  assert.equal(low.entry.round, 1, 'entry still returned');
  assert.equal(loadScores(st).length, MAX);
  assert.ok(loadScores(st).every((e) => e.round >= 6));
  const last = recordRun(run(6, 61), {}, st);
  assert.equal(last.rank, MAX, 'just squeezes in at the bottom');
  assert.equal(JSON.parse(st.getItem(KEY)).scores.length, MAX);
  // saveScores also trims and sorts
  const many = Array.from({ length: 25 }, (_, i) => ({ round: i, points: 0 }));
  assert.equal(saveScores(many, st), true);
  assert.deepEqual(loadScores(st).map((e) => e.round), Array.from({ length: MAX }, (_, i) => 24 - i));
});

test('best flags: isBestRound / isBestPoints are independent and strict; best = table maxima', () => {
  const st = createMemoryStorage();
  recordRun(run(10, 1000), {}, st);
  let r = recordRun(run(8, 5000), {}, st);
  assert.equal(r.isBestRound, false);
  assert.equal(r.isBestPoints, true);
  assert.equal(r.rank, 2);
  assert.deepEqual(r.best, { round: 10, points: 5000 });
  r = recordRun(run(11, 10), {}, st);
  assert.equal(r.isBestRound, true);
  assert.equal(r.isBestPoints, false);
  assert.equal(r.rank, 1);
  assert.deepEqual(r.best, { round: 11, points: 5000 });
  assert.deepEqual(bestScore(st), { round: 11, points: 5000 });
  assert.equal(bestScore(createMemoryStorage()), null);
});

test('topScores: default n, n clamps, garbage n', () => {
  const st = createMemoryStorage();
  for (let i = 1; i <= 7; i++) recordRun(run(i), {}, st);
  assert.equal(topScores(undefined, st).length, 7);
  assert.equal(topScores(5, st).length, 5);
  assert.equal(topScores(5, st)[0].round, 7);
  assert.equal(topScores(0, st).length, 0);
  assert.equal(topScores(-3, st).length, 0);
  assert.equal(topScores(2.9, st).length, 2);
  assert.equal(topScores('nope', st).length, 7);
});

test('storage format: versioned envelope; clearScores removes it', () => {
  const st = createMemoryStorage();
  recordRun(run(3, 30), {}, st);
  const data = JSON.parse(st.getItem(KEY));
  assert.equal(data.v, SCHEMA_VERSION);
  assert.equal(KEY, 'solzombies.scores.v1');
  assert.ok(Array.isArray(data.scores));
  assert.equal(clearScores(st), true);
  assert.equal(st.getItem(KEY), null);
  assert.deepEqual(loadScores(st), []);
  assert.equal(recordRun(run(1), {}, st).rank, 1, 'fresh table after clear');
});

test('corrupt storage: bad JSON / wrong shapes / wrong version / NaN read as empty or repaired', () => {
  const cases = ['{not json', 'null', '42', '"str"', '{}', '{"v":99,"scores":[{"round":5,"points":1}]}',
    '{"v":1,"scores":"x"}', '{"scores":[{"round":1,"points":1}]}', 'true'];
  for (const raw of cases) {
    const st = createMemoryStorage();
    st.setItem(KEY, raw);
    assert.deepEqual(loadScores(st), [], raw);
    const r = recordRun(run(2, 20), {}, st);
    assert.equal(r.rank, 1, `recovers from ${raw}`);
    assert.equal(loadScores(st).length, 1, `overwritten ${raw}`);
  }
  // mixed good / bad records: bad ones dropped, good ones repaired
  const st = createMemoryStorage();
  st.setItem(KEY, JSON.stringify({
    v: 1,
    scores: [
      null, 7, 'x', [1, 2], { round: 'NaN', points: 1 }, { round: 3 }, { points: 3 },
      { round: 4, points: 40, kills: 'lots', timeSec: -5, perks: ['jugg', 3, null, ''], weapon: 12, level: 'x', date: 5 },
      { round: 9, points: 90 },
    ],
  }));
  const list = loadScores(st);
  assert.deepEqual(list.map((e) => e.round), [9, 4]);
  assert.deepEqual(list[1], { round: 4, points: 40, kills: 0, level: 1, bosses: 0, timeSec: 0, pap: 0, perks: ['jugg'], weapon: null, date: '' });
  // legacy bare array (Phase 0 stub format) still loads
  const legacy = createMemoryStorage();
  legacy.setItem(KEY, JSON.stringify([{ round: 2, points: 5 }, { round: 6, points: 1 }]));
  assert.deepEqual(loadScores(legacy).map((e) => e.round), [6, 2]);
  // storage returning a non-string
  assert.deepEqual(loadScores({ getItem: () => 123, setItem() {}, removeItem() {} }), []);
});

test('normalizeEntry never throws and always yields the full shape', () => {
  for (const v of [undefined, null, 0, 'x', [], { round: Infinity }, { perks: 'jugg' }, Object.create(null)]) {
    const e = normalizeEntry(v);
    assert.deepEqual(Object.keys(e).sort(), ['bosses', 'date', 'kills', 'level', 'pap', 'perks', 'points', 'round', 'timeSec', 'weapon']);
    for (const k of ['round', 'points', 'kills', 'level', 'bosses', 'timeSec']) assert.ok(Number.isFinite(e[k]), k);
  }
});

test('throwing storage: nothing throws; recordRun still reports a result', () => {
  const bad = throwingStorage();
  assert.deepEqual(loadScores(bad), []);
  assert.equal(saveScores([{ round: 1, points: 1 }], bad), false);
  assert.equal(clearScores(bad), false);
  assert.deepEqual(topScores(5, bad), []);
  const r = recordRun(run(4, 40), {}, bad);
  assert.equal(r.rank, 1);
  assert.equal(r.entry.round, 4);
  // missing / malformed storage objects
  for (const s of [null, {}, { getItem: 1 }]) {
    assert.deepEqual(loadScores(s), []);
    assert.equal(saveScores([], s), false);
    assert.doesNotThrow(() => recordRun(run(1), {}, s));
    assert.doesNotThrow(() => clearScores(s));
  }
});

test('guarded storage: falls back to memory on SecurityError / quota and keeps working', () => {
  const g = createGuardedStorage(throwingStorage('SecurityError'));
  assert.equal(recordRun(run(3, 30), {}, g).rank, 1);
  assert.equal(g.usingFallback, true);
  assert.equal(recordRun(run(5, 50), {}, g).rank, 1);
  assert.deepEqual(topScores(10, g).map((e) => e.round), [5, 3], 'persisted in the fallback');
  // a storage that works for reads but fails on write (quota exceeded) mid-session
  const real = createMemoryStorage();
  let quota = false;
  const flaky = {
    getItem: (k) => real.getItem(k),
    setItem: (k, v) => { if (quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } real.setItem(k, v); },
    removeItem: (k) => real.removeItem(k),
  };
  const g2 = createGuardedStorage(flaky);
  recordRun(run(2), {}, g2);
  assert.equal(g2.usingFallback, false);
  quota = true;
  assert.doesNotThrow(() => recordRun(run(9), {}, g2));
  assert.equal(g2.usingFallback, true);
  assert.deepEqual(topScores(10, g2).map((e) => e.round), [9, 2], 'table carried into the fallback by the failed write');
  // getter that throws (e.g. localStorage access denied) and a null primary
  const g3 = createGuardedStorage(() => { throw new Error('SecurityError'); });
  assert.equal(recordRun(run(1), {}, g3).rank, 1);
  assert.equal(topScores(10, g3).length, 1);
  const g4 = createGuardedStorage(null);
  assert.equal(recordRun(run(1), {}, g4).rank, 1);
});

test('FIX-3 (L3): all-time best survives eviction from the round-sorted top 10', () => {
  const st = createMemoryStorage();
  recordRun(run(1, 99999), {}, st);
  for (let r = 10; r < 20; r++) recordRun(run(r, 100), {}, st);
  assert.ok(!topScores(10, st).some((e) => e.points === 99999), 'evicted from the table');
  assert.deepEqual(bestScore(st), { round: 19, points: 99999 }, 'menu best keeps the evicted points');
  const r = recordRun(run(2, 500), {}, st);
  assert.equal(r.isBestPoints, false, 'no false NEW BEST SCORE');
  assert.equal(r.rank, null);
  assert.deepEqual(r.best, { round: 19, points: 99999 });
  const r2 = recordRun(run(3, 100000), {}, st);
  assert.equal(r2.isBestPoints, true);
  assert.deepEqual(bestScore(st), { round: 19, points: 100000 });
  // stored next to the table, same version
  const data = JSON.parse(st.getItem(KEY));
  assert.equal(data.v, SCHEMA_VERSION);
  assert.deepEqual(data.best, { round: 19, points: 100000 });
  assert.equal(data.scores.length, MAX);
  // clear resets it
  clearScores(st);
  assert.equal(bestScore(st), null);
});

test('FIX-3: records without best (pre-FIX-3) load with best = table maxima; bad best ignored', () => {
  const st = createMemoryStorage();
  st.setItem(KEY, JSON.stringify({ v: 1, scores: [{ round: 4, points: 700 }, { round: 6, points: 300 }] }));
  assert.deepEqual(bestScore(st), { round: 6, points: 700 });
  assert.equal(recordRun(run(5, 800), {}, st).isBestPoints, true);
  for (const best of ['x', null, [1], { round: 'NaN', points: -5 }]) {
    const t = createMemoryStorage();
    t.setItem(KEY, JSON.stringify({ v: 1, scores: [{ round: 2, points: 20 }], best }));
    assert.deepEqual(loadRecord(t).best, { round: 2, points: 20 });
  }
  // a stored best larger than the table is honoured
  const u = createMemoryStorage();
  u.setItem(KEY, JSON.stringify({ v: 1, scores: [{ round: 2, points: 20 }], best: { round: 30, points: 9000 } }));
  assert.deepEqual(bestScore(u), { round: 30, points: 9000 });
  assert.equal(recordRun(run(29, 8999), {}, u).isBestRound, false);
});

test('FIX-3: a round-0 run is never a best round (or best points with 0 points)', () => {
  const st = createMemoryStorage();
  const r = recordRun(run(0, 0), {}, st);
  assert.equal(r.isBestRound, false);
  assert.equal(r.isBestPoints, false);
  assert.equal(recordRun(run(0, 40), {}, createMemoryStorage()).isBestRound, false);
  assert.equal(recordRun(run(1, 10), {}, st).isBestRound, true);
});

test('FIX-3 (L4): full quota from the start -> read-only: table still loads, writes kept in memory', () => {
  const real = createMemoryStorage();
  recordRun(run(12, 1200), {}, real);
  recordRun(run(8, 800), {}, real);
  const saved = real.getItem(KEY);
  const quota = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const full = { getItem: (k) => real.getItem(k), setItem: quota, removeItem: quota };
  const g = createGuardedStorage(() => full);
  assert.deepEqual(topScores(10, g).map((e) => e.round), [12, 8], 'saved table visible');
  assert.deepEqual(bestScore(g), { round: 12, points: 1200 });
  const r = recordRun(run(5, 50), {}, g);
  assert.equal(r.rank, 3, 'ranked against the saved table, not #1');
  assert.equal(r.isBestRound, false);
  assert.equal(g.usingFallback, true); assert.equal(g.readOnly, true);
  assert.deepEqual(topScores(10, g).map((e) => e.round), [12, 8, 5], 'session writes visible');
  assert.equal(real.getItem(KEY), saved, 'localStorage untouched');
  assert.equal(clearScores(g), true);
  assert.deepEqual(loadScores(g), [], 'clear applies for the session');
  assert.equal(real.getItem(KEY), saved);
});

test('FIX-3 (L4): a read failing mid-session returns the last known table', () => {
  const real = createMemoryStorage();
  let readsFail = false;
  const flaky = {
    getItem: (k) => { if (readsFail) throw new Error('SecurityError'); return real.getItem(k); },
    setItem: (k, v) => real.setItem(k, v),
    removeItem: (k) => real.removeItem(k),
  };
  const g = createGuardedStorage(flaky);
  recordRun(run(7, 70), {}, g);
  recordRun(run(3, 30), {}, g);
  readsFail = true;
  assert.deepEqual(topScores(10, g).map((e) => e.round), [7, 3]);
  assert.equal(g.readFailed, true);
  const r = recordRun(run(4, 40), {}, g);
  assert.equal(r.rank, 2, 'not #1 on an empty table');
  assert.deepEqual(topScores(10, g).map((e) => e.round), [7, 4, 3], 'last write remembered');
  readsFail = false;
  assert.deepEqual(topScores(10, g).map((e) => e.round), [7, 4, 3], 'persisted to the real storage');
});

test('defaultStorage works in Node (in-memory fallback) without throwing', () => {
  assert.doesNotThrow(() => clearScores());
  const r = recordRun(run(3, 33));
  assert.ok(r.rank === null || r.rank >= 1);
  assert.ok(topScores().length >= 1);
  assert.doesNotThrow(() => clearScores());
  assert.deepEqual(loadScores(), []);
});

test('formatTime: m:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(59.99), '0:59');
  assert.equal(formatTime(60), '1:00');
  assert.equal(formatTime(754), '12:34');
  assert.equal(formatTime(3725), '62:05');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(undefined), '0:00');
  assert.equal(formatTime(null), '0:00');
  assert.equal(formatTime(Infinity), '0:00');
  assert.equal(formatTime('90'), '1:30');
});

test('WO8: entry stores pap (stats.papCount); old records without it load as 0', () => {
  const st = createMemoryStorage();
  const r = recordRun({ roundReached: 9, pointsEarned: 900, papCount: 2 }, {}, st);
  assert.equal(r.entry.pap, 2);
  assert.equal(loadScores(st)[0].pap, 2);
  const x = recordRun({ roundReached: 8, pointsEarned: 800, papCount: 1 }, { pap: 3 }, st);
  assert.equal(x.entry.pap, 3, 'extra overrides');
  const old = createMemoryStorage();
  old.setItem(SCORES.key, JSON.stringify({ v: 1, scores: [{ round: 5, points: 50, kills: 3 }] }));
  assert.equal(loadScores(old)[0].pap, 0);
  assert.equal(normalizeEntry({ pap: 'x' }).pap, 0);
  assert.equal(normalizeEntry({ pap: -4 }).pap, 0);
});
