// scores.js — local high-score table (WO7 1.4 / 3.3). Pure logic + guarded storage access.
// Owner: Agent J (finished from the Phase 0 stub by Agent 0).
//
// Storage is anything with getItem/setItem/removeItem (Web Storage shape). `defaultStorage` is a
// guarded wrapper: on first use it probes globalThis.localStorage (read through globalThis, never
// a browser global name) with a read, else an in-memory store (Node, storage disabled,
// SecurityError). If a write later throws (quota, revoked permission) the wrapper goes read-only:
// the table still loads from localStorage, writes stay in memory for the session (FIX-3, L4).
// Every public function catches storage/JSON failures: this module never throws.
//
// Persisted format (schema version 1): JSON `{ "v": 1, "scores": Entry[], "best": { round, points } }`
// under SCORES.key. `best` (WO7 FIX-3) is optional: records without it load with best = table maxima.
// A bare Entry[] (the Phase 0 stub format) is also accepted on load. Anything else (corrupt JSON,
// wrong shape, unknown version) reads as an empty table and is overwritten on the next save.
import { SCORES } from './config.js';

export const SCHEMA_VERSION = 1;
const KEY = (SCORES && SCORES.key) || 'solzombies.scores.v1';
const MAX = (SCORES && Number.isInteger(SCORES.max) && SCORES.max > 0) ? SCORES.max : 10;
const MAX_PERKS = 16;
const MAX_STR = 64;

export function createMemoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// Wraps `primary` (a storage, or a function returning one / null) so no call ever throws.
// WO7 FIX-3 (QA review L4): read-only mode instead of an all-or-nothing switch.
//   - No usable primary (missing, getter throws): everything lives in the in-memory store.
//   - A failing write (quota full, revoked permission): from then on every write of the session
//     goes to an in-memory overlay (setItem / removeItem), while keys never written still read
//     from the primary. The saved table stays visible; nothing is surfaced to the player.
//   - A failing read: returns the last value successfully read or written for that key (null if
//     none), so a table seen earlier in the session does not vanish.
export function createGuardedStorage(primary) {
  const overlay = new Map(); // key -> string | null (null = removed this session)
  const lastKnown = new Map(); // key -> last value read from / written to the primary
  let active = null;
  let resolved = false;
  let noPrimary = false;
  let writeFailed = false;
  let readFailed = false;
  const resolve = () => {
    if (!resolved) {
      resolved = true;
      let p = null;
      try { p = typeof primary === 'function' ? primary() : primary; } catch { p = null; }
      if (!p || typeof p.getItem !== 'function' || typeof p.setItem !== 'function') noPrimary = true;
      else active = p;
    }
    return active;
  };
  const getItem = (k) => {
    const p = resolve();
    if (overlay.has(k)) return overlay.get(k);
    if (!p) return null;
    try {
      const v = p.getItem(k);
      lastKnown.set(k, v);
      return v;
    } catch {
      readFailed = true;
      return lastKnown.has(k) ? lastKnown.get(k) : null;
    }
  };
  const write = (k, v) => { // v: string, or null to remove
    const p = resolve();
    if (p && !writeFailed) {
      try {
        if (v === null) { if (typeof p.removeItem === 'function') p.removeItem(k); } else p.setItem(k, v);
        lastKnown.set(k, v);
        return;
      } catch {
        writeFailed = true; // read-only for the rest of the session
      }
    }
    overlay.set(k, v);
  };
  return {
    getItem,
    setItem: (k, v) => { write(k, String(v)); },
    removeItem: (k) => { write(k, null); },
    // true once any write goes to memory (no primary, or read-only mode).
    get usingFallback() { resolve(); return noPrimary || writeFailed; },
    get readOnly() { return writeFailed && !noPrimary; },
    get readFailed() { return readFailed; },
  };
}

// Probes with a read only (QA review L4): a full quota must not hide a table that still reads.
// A write that fails later switches the guarded wrapper to read-only mode.
function probeLocalStorage() {
  try {
    const ls = globalThis.localStorage; // the getter itself may throw SecurityError
    if (!ls) return null;
    ls.getItem('__solzombies_probe__');
    return ls;
  } catch {
    return null;
  }
}

// Resolved lazily (first call), so importing the module never touches storage.
export const defaultStorage = createGuardedStorage(probeLocalStorage);

// ---------------------------------------------------------------------------- validation

function num(v, d = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  return d;
}
const count = (v, d = 0) => Math.max(0, Math.floor(num(v, d)));
const str = (v) => (typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_STR) : null);

// Coerces any value into a well-formed Entry (never throws).
export function normalizeEntry(e) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    round: count(o.round),
    points: count(o.points),
    kills: count(o.kills),
    level: Math.max(1, count(o.level, 1)),
    bosses: count(o.bosses),
    timeSec: count(o.timeSec),
    perks: Array.isArray(o.perks)
      ? o.perks.filter((p) => typeof p === 'string' && p.length > 0).slice(0, MAX_PERKS).map((p) => p.slice(0, MAX_STR))
      : [],
    weapon: str(o.weapon),
    date: typeof o.date === 'string' ? o.date.slice(0, MAX_STR) : '',
  };
}

// A stored record is kept only if it is a plain object whose round and points are finite numbers
// (the ranking keys); the other fields are repaired by normalizeEntry.
function isValidStored(e) {
  return !!e && typeof e === 'object' && !Array.isArray(e)
    && typeof e.round === 'number' && Number.isFinite(e.round)
    && typeof e.points === 'number' && Number.isFinite(e.points);
}

// Ranking: round desc, then points desc, then time survived desc. Array.prototype.sort is stable,
// so on a full tie the older entry keeps the higher rank.
export function compareEntries(a, b) {
  return (b.round - a.round) || (b.points - a.points) || (b.timeSec - a.timeSec);
}

function rankList(list) {
  return list.map(normalizeEntry).sort(compareEntries).slice(0, MAX);
}

// ---------------------------------------------------------------------------- public API

// All-time best kept next to the table (WO7 FIX-3, QA review L3): the table is sorted by round
// first, so a low-round / high-points run can be evicted from the top 10; `best` remembers it.
function readBest(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { round: 0, points: 0 };
  return { round: count(b.round), points: count(b.points) };
}
function mergeBest(best, list) {
  const out = readBest(best);
  for (const e of list) {
    out.round = Math.max(out.round, e.round);
    out.points = Math.max(out.points, e.points);
  }
  return out;
}

// -> { scores: Entry[] (ranked, <= SCORES.max), best: { round, points } (all-time maxima: the
// stored best merged with the table) }. Never throws; unreadable data -> empty record.
export function loadRecord(storage = defaultStorage) {
  const empty = { scores: [], best: { round: 0, points: 0 } };
  try {
    if (!storage || typeof storage.getItem !== 'function') return empty;
    const raw = storage.getItem(KEY);
    if (typeof raw !== 'string' || raw === '') return empty;
    const data = JSON.parse(raw);
    let arr = null, best = null;
    if (Array.isArray(data)) arr = data; // Phase 0 stub format
    else if (data && typeof data === 'object' && data.v === SCHEMA_VERSION && Array.isArray(data.scores)) {
      arr = data.scores;
      best = data.best; // optional (absent in pre-FIX-3 records)
    }
    if (!arr) return empty;
    const scores = rankList(arr.filter(isValidStored));
    return { scores, best: mergeBest(best, scores) };
  } catch {
    return empty;
  }
}

export function loadScores(storage = defaultStorage) {
  return loadRecord(storage).scores;
}

// Saves the ranked table. `best` ({ round, points }) is merged with the stored all-time best and
// the table maxima, so saving never lowers it (clearScores resets it).
export function saveScores(list, storage = defaultStorage, best = null) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const scores = rankList((Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object'));
    const prevBest = loadRecord(storage).best;
    const merged = mergeBest(prevBest, scores);
    const b = readBest(best);
    merged.round = Math.max(merged.round, b.round);
    merged.points = Math.max(merged.points, b.points);
    storage.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, scores, best: merged }));
    return true;
  } catch {
    return false;
  }
}

// stats: state.stats (WO7 fields); extra: overrides for any Entry field (INT passes { perks }).
// -> { rank (1-based, or null if it did not make the top SCORES.max), entry, isBestRound,
//      isBestPoints, best: { round, points } (all-time maxima including this run) }
// isBestRound / isBestPoints are strict against the all-time best (not just the stored top 10);
// a run with round 0 (or 0 points) is never a best. The result is computed even when saving fails.
// main.js does not record runs that die before round 1 (QA playtest #13).
export function recordRun(stats, extra = {}, storage = defaultStorage) {
  const s = stats && typeof stats === 'object' ? stats : {};
  const x = extra && typeof extra === 'object' ? extra : {};
  const entry = normalizeEntry({
    round: s.roundReached, points: s.pointsEarned, kills: s.kills, level: s.levelReached,
    bosses: s.bossesKilled, timeSec: s.timeSurvived, weapon: s.bestWeaponId,
    date: new Date().toISOString(),
    ...x,
  });
  const rec = loadRecord(storage);
  const prev = rec.scores;
  const isBestRound = entry.round > 0 && entry.round > rec.best.round;
  const isBestPoints = entry.points > 0 && entry.points > rec.best.points;
  const list = prev.concat([entry]).sort(compareEntries); // stable: ties rank below older runs
  const idx = list.indexOf(entry);
  const rank = idx >= 0 && idx < MAX ? idx + 1 : null;
  const best = {
    round: Math.max(rec.best.round, entry.round),
    points: Math.max(rec.best.points, entry.points),
  };
  saveScores(list.slice(0, MAX), storage, best);
  return { rank, entry, isBestRound, isBestPoints, best };
}

export function topScores(n = MAX, storage = defaultStorage) {
  const k = Math.max(0, Math.floor(num(n, MAX)));
  return loadScores(storage).slice(0, k);
}

// All-time best round / best points (may come from different runs, and from runs no longer on
// the top-10 table), or null when nothing was ever recorded.
export function bestScore(storage = defaultStorage) {
  const { scores, best } = loadRecord(storage);
  if (!scores.length && best.round <= 0 && best.points <= 0) return null;
  return { round: best.round, points: best.points };
}

export function clearScores(storage = defaultStorage) {
  try {
    if (storage && typeof storage.removeItem === 'function') storage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// Seconds -> 'm:ss' (minutes are not wrapped into hours: 3725 -> '62:05'). Bad input -> '0:00'.
export function formatTime(sec) {
  const t = Math.max(0, Math.floor(num(sec)));
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
