# powerups.js notes (Agent G)

## What was built
`src/powerups.js` implements the full 3.6 contract and 5.8 spec:

- `POWERUP_TYPES`, `POWERUP_LABEL` (frozen).
- `initPowerups(state)` subscribes `zombie:killed` (drop roll) and `round:start`
  (`dropsThisRound = 0`). Returns an unsubscribe function (extra; harmless if ignored).
- Drop roll: only `cause === 'weapon'`; respects `maxPerRound`; `rng.chance(dropChance)` then
  `rng.weighted(weights)`. Drop position is the event's `x,y` (falls back to `zombie.x/y`).
- `spawnPowerup(state, type, x, y)` pushes `{ id, type, x, y, ttl: lifetime, bob: 0 }`, emits
  `powerup:spawned`, returns the item. It does **not** increment `dropsThisRound` (only natural
  drops do), so debug spawns do not eat into the per-round cap.
- `updatePowerups(state, dt)`: item `ttl -= dt`, `bob += dt`, remove at `ttl <= 0`; pickup when
  `dist < pickupRadius + player.radius` (skipped while `player.down` or `state.player` null) ->
  `applyPowerup` then emit `powerup:collected`. Then expiry of timed entries (delete, deathMachine
  -> `player.clearTemporary`, emit `powerup:expired`). Then staggered nuke kills.
- `applyPowerup`: timed types set `active[type] = time + duration` (re-pickup resets to full);
  deathMachine also calls `player.equipTemporary(state, weapons.createDeathMachine())` on every
  pickup. maxAmmo -> `weapons.refillReserve` on each non-null slot. nuke -> queue of non-dying
  zombie ids, `{type:'flash', ttl:0.5, maxTtl:0.5}` pushed directly to `state.effects`,
  `player.addPoints(nukeBonus)`, `waves.pauseSpawning(nukeSpawnPause)`. carpenter ->
  `map.repairAll(state.map)` + `player.addPoints(carpenterBonus)`. fireSale / zombieBlood /
  instaKill / doublePoints only set the timer; other modules poll `isActive`.
- `isActive` / `timeLeft` are pure reads of `state.powerups.active[type]` vs `state.time`
  (`isActive` becomes false the instant time passes, even before `updatePowerups` deletes it).

## Decisions / assumptions
- **No repeat drops**: when the rolled type equals the previous spawned type, it re-rolls once
  with that type removed from the weights, which guarantees "never twice in a row". The last
  type is stored as `state.powerups.lastType` (new field in my own slice; set by `spawnPowerup`).
- **Nuke queue**: first kill happens after one `nukeStagger` (not instantly). Zombies already
  `dying` are excluded at queue time and skipped at kill time; ids no longer in
  `state.zombies` are skipped. A second nuke during an active one appends new ids to the
  existing queue. `state.powerups.nuke` returns to `null` when the queue drains. Nuke kills use
  cause `'nuke'`, so they never roll drops.
- Bonus points (nuke/carpenter) pass the player's x,y to `addPoints` so render can float `+N`.
- Imports of sibling modules are **namespace imports** (`import * as player from ...`) and are
  only dereferenced inside functions. This keeps the player<->powerups cycle safe and means a
  sibling missing an export does not break module linking for everything that imports powerups.
  `updatePowerups` uses `pl` for the local player to avoid shadowing the `player` namespace.

## Tests (`tests/powerups.test.js`)
Pure (always run): labels/types, ~2% drop rate over 10 000 kills (seeded), per-round cap and
reset on `round:start`, non-weapon kills never drop, no repeat type over ~800 drops, item shape,
ttl/bob/removal, pickup + `powerup:collected`, downed player cannot pick up, timer reset on
re-pickup, expiry event emitted exactly once.
Cross-module (auto-skipped while the dependency is a Phase 0 stub): maxAmmo fills reserve only,
deathMachine equip/clear, carpenter bonus, nuke flash/bonus/staggered kills of all alive.

## Status at hand-off
`node --check src/powerups.js` passes. At the time of my last run, `npm test` could not load
`tests/powerups.test.js` because `src/zombie.js` (Agent D, in progress) imports
`barricadeOpen` from `src/map.js`, which Agent H had only partially written (file had constants
and `MAP_ASCII` only). This is a transient parallel-build state, not a powerups bug; the
integrator should rerun once map.js is complete. The same load failure hits the player, shop,
waves and weapons test files too.

To check my own module in isolation I copied the repo to a scratch folder and swapped in a map.js
stub that exports every contract function. There, 14 of 15 powerups tests passed and none
failed. That run used the real player, weapons, zombie and waves modules as they stood, so the
maxAmmo, deathMachine and nuke tests exercised real code. The carpenter test was skipped because
map was a stub.

## For the integrator
- No new config constants needed. `NUKE_FLASH_TTL = 0.5` is local (spec value).
- Render should blink items when `item.ttl < POWERUPS.blinkAt` and handle `type:'flash'` effects.
- main.js must call `initPowerups(state)` after `events.clearAll()` on each (re)start.

## Phase 4 fixes (FIX-4)
- **review.md #4b, unreachable drops:** `rollDrop` now places the item via
  `reachableDropPos`. If the kill position's tile is player-walkable
  (`map.isWalkable(map, tx, ty, false)` via `map.worldToTile`) it is kept exactly. Otherwise the
  drop moves to the nearest player-walkable tile centre within 3 tiles (Chebyshev), which for a
  spawn pocket is the window's inside neighbour. If there is none, the drop is skipped and
  **not** counted toward `maxPerRound` (and `lastType` is not updated). With no `state.map`
  (unit tests) the kill position is kept. The rng is consumed exactly as before, so the 2% drop
  rate is unchanged. `DROP_SNAP_TILES = 3` is local.
- Tests: two regression tests (pocket drop snaps to the inside tile and counts; no reachable
  tile means no spawn and no count). Contract signatures unchanged.
