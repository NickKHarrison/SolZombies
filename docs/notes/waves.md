# waves.js notes (Agent F)

## What was built
`src/waves.js` implements WORK_ORDER 5.6 against the 3.6 contract:
`createRoundState, initRounds, updateRounds, zombiesForRound, pauseSpawning, skipToRound`.
Tests: `tests/waves.test.js` (11 tests; they drive counters by emitting `zombie:spawned` /
`zombie:killed` through a fake spawner, so they don't depend on zombie.js).

## Extra exports (not in the contract)
- `pickSpawnPoint(state)` returns a weighted pick from `state.map.spawnPoints`. Weight is
  `ROUNDS.nearSpawnWeight` if the point is within `ROUNDS.nearSpawnRadius` of the player, else 1.
  Uses `state.rng.next()`. Returns `null` if there are no spawn points. All spawn points are
  eligible, whether window or open and whatever their barricade state.
- `spawnIntervalForRound(round)` returns `max(spawnIntervalMin, spawnIntervalStart * decay^(round-1))`.
- `setSpawnFunction(fn|null)` is a test hook that replaces `zombie.spawnZombie`. `null` restores
  the default. Main should never call it.

## Behavior and decisions
- **Subscriptions:** each `initRounds(state)` call first unsubscribes whatever the previous call
  registered, then subscribes once to `zombie:spawned` (`alive++`) and `zombie:killed`
  (`alive--`, `killedThisRound++`). The handlers close over the `state` passed in and read
  `state.rounds` when they fire. So either `events.clearAll()` followed by a re-init, or calling
  `initRounds` twice, is safe.
- `alive` is clamped at 0. This matters after `skipToRound`, which zeroes `alive` while old
  zombies may still be on the map. Every kill cause, `'debug'` included, decrements `alive`.
- Break and spawn timers use `dt`. `pausedUntil` is compared against `state.time`, so main must
  advance `state.time` as usual.
- When a round starts, `spawnTimer = 0`, so the first zombie spawns on the first active frame.
  After that there is at most one spawn per `updateRounds` call, and the timer resets to
  `spawnInterval`. The spawn timer keeps counting down while spawning is paused or capped, so
  spawning resumes as soon as the block lifts.
- If a spawn point is missing, `toSpawn` is not decremented, so the round stalls rather than
  losing zombies.
- `round:end` is checked in `updateRounds` (when `toSpawn === 0 && alive === 0`), not inside the
  kill handler.
- `killedThisRound` resets on `round:start`.
- `stats.roundReached` is set on each `round:start`.
- Zombies spawned by main's debug `spawnZombie(n)` still emit `zombie:spawned`, so `alive`
  counts them. The round then waits for them to die.

## Spec discrepancy (please review)
Section 5.6 says tests should check "33 for round 10 (±1)". The mandated formula
`round(0.000058 r^3 + 0.074032 r^2 + 0.718119 r + 14.738699)` gives **29** at round 10
(round 20 gives 59). I kept the formula exactly as written and changed the test to assert 29.
If 33 is actually wanted, the formula (or an offset) has to change in `zombiesForRound`, and
the integrator should decide which.

## Constants
None added. Everything comes from `ROUNDS` and `ZOMBIE.maxAlive` in config.js.

## WO4 (Agent C, WORK_ORDER_4 2.3): only opened zones spawn

- `pickSpawnPoint` now considers only spawn points where `map.isSpawnActive(state.map, sp.id)`
  (from `./map.js`, imported as a namespace so it links before Agent B's export exists; the
  fallback checks `map.activeSpawnIds.has(id)` directly). If the filter leaves nothing, all
  points are used. Maps without `activeSpawnIds` (test fakes) skip the filter entirely, so they
  allocate nothing and keep the old behavior (every point is active).
- New export `spawnPointActive(map, sp)` (helper, used by the filter).
- Tests: only active ids are picked, an empty active set falls back to all, a fake map without
  `activeSpawnIds` treats all as active, and `updateRounds` spawns only from the active point.
