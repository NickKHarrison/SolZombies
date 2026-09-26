# scores.js notes

## WO7 (Agent J, T4)

`src/scores.js` is the local high-score table. It is pure apart from a guarded `globalThis.localStorage` probe and never throws. Tests are in `tests/scores.test.js` (14 tests).

### API (3.3 plus extras)
- `loadScores(storage = defaultStorage) -> Entry[]`: returns the entries sorted and trimmed to `SCORES.max`.
- `saveScores(list, storage) -> bool`: normalizes, sorts and trims the list, then writes the versioned envelope. Returns false when the write fails.
- `recordRun(stats, extra = {}, storage) -> { rank, entry, isBestRound, isBestPoints, best }`
  - `rank` is 1-based, or `null` when the run did not make the top `SCORES.max`.
  - The best flags are strict: the run must beat every previous entry, and both are true on an empty table. They are independent of each other.
  - `best = { round, points }` holds the table maxima including this run. The two values may come from different runs.
  - The result is computed even when the save fails.
- `topScores(n = SCORES.max, storage)`: `n` is floored and clamped to at least 0. A non-numeric `n` falls back to max.
- `clearScores(storage) -> bool`.
- `formatTime(sec) -> 'm:ss'`: the value is floored, and negative or NaN input gives `'0:00'`. Minutes do not wrap into hours, so 3725 becomes `'62:05'`.
- Extras: `bestScore(storage) -> {round, points} | null` (for the menu line), `createMemoryStorage()`, `createGuardedStorage(primaryOrGetter)`, `defaultStorage`, `compareEntries`, `normalizeEntry`, `SCHEMA_VERSION`.

### Entry
`{ round, points, kills, level, bosses, timeSec, perks, weapon, date }`, mapped from `state.stats` as follows:
- `roundReached` → `round`
- `pointsEarned` → `points`
- `kills` → `kills`
- `levelReached` → `level` (minimum 1)
- `bossesKilled` → `bosses`
- `timeSurvived` → `timeSec` (floored)
- `bestWeaponId` → `weapon` (string or null)
- `date` is `new Date().toISOString()`

`extra` overrides any field. INT passes `{ perks: player.perks.slice() }`. Numbers are coerced to finite non-negative integers, and NaN or Infinity becomes 0. `perks` keeps only non-empty strings.

### Ranking
The sort order is round desc, then points desc, then timeSec desc. The sort is stable, so on a full tie the older run keeps the higher rank.

### Storage
- **Format:** `solzombies.scores.v1` holds `{"v":1,"scores":[...]}`. The Phase 0 bare-array format still loads.
- **Unreadable data:** corrupt JSON, a wrong shape or an unknown `v` reads as an empty table, and the next save overwrites it.
- **Bad records:** a stored record is dropped unless it is an object with finite numeric `round` and `points`. Other fields are repaired.
- **`defaultStorage`:** a guarded wrapper, resolved lazily so importing touches nothing. It uses `globalThis.localStorage` if a probe write works. Otherwise it uses an in-memory store (Node, private mode, SecurityError on the getter).
- **Write failures:** the first exception from the real storage (for example a quota error mid-session) switches the wrapper to memory for the rest of the session. The failing write lands in memory, so the table carries over.
- **Node tests:** the default storage is a shared module-level fallback. Tests pass `createMemoryStorage()` explicitly.

### Purity
The code never names `window` or `document`. It reads `globalThis.localStorage` inside try/catch. The contract purity test passes.

### For INT / D
- Call `recordRun(state.stats, { perks: player.perks.slice() })` once on game over, then emit `score:recorded { rank, entry, isBestRound, isBestPoints }`.
- For the menu, use `bestScore()` and `topScores(5)`.
- The debug hook can call `clearScores()`.

## WO7 FIX-3

- **L3, all-time best:** the envelope stays `{ v: 1, scores }` and gains an optional `best: { round, points }`.
  - On load, the stored best is merged with the table maxima. Old records without `best`, or with a bad one, fall back to the table maxima.
  - `saveScores(list, storage, best?)` never lowers the stored best. `clearScores` removes it.
  - `recordRun` flags and `best`, and `bestScore()`, use the all-time best, so a run evicted from the round-sorted top 10 is still remembered.
  - `isBestRound` requires `round > 0`, and `isBestPoints` requires `points > 0`.
  - New `loadRecord(storage) -> { scores, best }`.
- **L4, read-only mode:** the probe only reads `localStorage`.
  - The first failing write switches `createGuardedStorage` to read-only mode. From then on, writes and removes go to an in-memory overlay for the session, while keys never written still read from `localStorage`.
  - A failing read returns the last value read or written for that key.
  - Nothing is shown to the player. Getters: `usingFallback` (no primary, or read-only), `readOnly`, `readFailed`.
- **Playtest #13:** `main.js` does not call `recordRun` for runs with `roundReached === 0` (see integration-wo7.md).
