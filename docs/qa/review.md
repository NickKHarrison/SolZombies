# QA-2 Code review (correctness)

Scope: every file in `src/`, checked against WORK_ORDER Sections 3 and 5. I did not edit anything
under `src/` or `tests/`. `npm test` passes (147/147).

Suspected bugs were checked with Node scripts in the session scratch area. The scripts import the
real modules and run the 3.7 update order headlessly, with an aim-and-shoot bot and `render.updateEffects`
stubbed. Confidence: **verified** means reproduced by a script. **Reasoned** means traced end to end
but not executed.

---

## Blocker

### 1. A zombie that re-enters a spawn pocket after crossing its window never tears the rebuilt barricade, so the round soft-locks
- **Where:** `src/zombie.js:212` `updateChasing` (and `:273-276`, where `updateZombies` sets `z.inside`).
- **Code:**
  ```js
  if (!z.inside && z.barricadeId != null && state.map && !barricadeOpen(state.map, z.barricadeId)) {
    if (tileTypeAt(state.map, z.x, z.y) === TILE_POCKET) { z.mode = 'tearing'; ... }
  }
  ```
  The fallback to `tearing` only runs when `z.inside === false`. `inside` is latched to `true` the
  first time the zombie's centre touches a floor tile and is never cleared. The check also needs `z.barricadeId`,
  which is `null` for zombies from the open spawns.
- **How it happens:** a zombie that is already inside can end up back in a pocket while that window is open.
  Zombie Blood wandering (random directions for 30 s) does this. Crowd separation near an open window can also do it.
  Then the barricade is rebuilt, either by the player holding F or by a Carpenter. The zombie is in `chasing` mode.
  The flow field treats windows as walkable, so it points through the window. `resolveCircle` blocks the window
  because `boards > 0`. The zombie pushes against the boards forever and never tears them.
  Hitscan cannot reach it because windows block rays (5.1). `rounds.alive` never reaches 0, so the round never ends.
  Only a Nuke or ray-gun splash can clear it.
- **Repro (verified):**
  - Scratch `t6.mjs`: a zombie with `inside = true` sits in the pocket of barricade 3 in `wandering` mode.
    Zombie Blood is applied, then `repairAll`. After 60 s of simulation the zombie is still in `mode chasing`,
    `inside true`, on tile code 3 (pocket), with `boards 6`, `alive 1` and the round phase still `active`.
  - Scratch `t7.mjs` shows it happens without forcing it:
    1. Open every window and spawn 3 zombies per window.
    2. Let them enter for 12 s.
    3. Apply Zombie Blood for 29 s, then apply a Carpenter.
    4. Simulate 30 s more.

    In 4 of 20 seeds a zombie was left stuck in a pocket in `chasing` mode (5 zombies in total).
- **Expected:** a zombie standing in a pocket whose barricade has boards goes back to `tearing`
  (5.5 step 1). **Actual:** it stays in `chasing` forever and the round cannot end.
- **Fix:**
  - Drop the `!z.inside` condition, or clear `z.inside` whenever the zombie stands on a pocket or window tile.
  - Look up the barricade from the pocket tile, not from `z.barricadeId`. Each pocket has exactly one adjacent `W`
    (map test), and `map.spawnPoints` already pairs pocket to barricade. Set `z.barricadeId` to that barricade before
    switching to `tearing`, so open-spawn zombies are covered too.
  - Optionally, stop wandering zombies from entering pocket tiles.
- **Resolution (FIX-1):** fixed in `src/zombie.js`.
  - Any zombie standing on a pocket tile looks up the barricade from the tile, through `map.spawnPoints` with the adjacent barricade as a fallback.
  - It sets `barricadeId` and switches to `tearing` if that barricade has boards, whatever its `inside`, `barricadeId` or mode.
  - `inside` is now recomputed every frame.
  - Zombie Blood wanderers in the play area no longer step into window or pocket tiles.
  - Regression tests are in `tests/zombie.test.js`. The QA `t7` repro now leaves 0 of 20 seeds stuck, and 900 s stress runs found no soft-lock.

---
## Major

None found. The core loops checked out: round flow, points, power-ups, shop, restart and listener handling.
Headless runs covered 6 seeds x 2 frame rates, 900 s each, reaching round 13-14, with no NaN.
Points always equalled `10 * kills`. The round length never went past about 125 s, and no entity array grew without bound.

---

## Minor

### 2. Uncapped separation can throw stacked zombies through walls and out of the map (soft-lock if it happens)
- **Where:** `src/zombie.js:87-104` `separation`, used by `updateTearing` (`:204-205`), `updateChasing` and
  `updateWandering`. Combined with `src/map.js:234-242` `resolveCircle`, where a circle whose centre ends up inside
  a blocking tile is pushed out through the tile's nearest edge without checking that the destination is walkable.
- **Reasoning:** zombies spawned at the same spawn point share an identical `x, y`. For exactly stacked pairs,
  separation adds `±separationForce` (120 px/s) along x once per neighbour, and the sum is never clamped.
  With k stacked zombies a new one moves `120*k*dt` px in one frame. Once that is more than about 20 px, its centre
  lands inside the pocket's side wall. At 30 fps (`FIXED_DT_CAP`) that takes about 6 zombies. Once in a wall,
  `resolveCircle` can push it further out, even past x < 0. The zombie then cannot be hit by hitscan and keeps `alive > 0`.
- **Repro (verified, scratch `t4.mjs` / `t5.mjs`):** spawn N zombies in the same frame at one window spawn point
  (the same as `__game.debug.spawnZombie(N, id)`):
  - N=12 at dt=1/30: zombies were left inside walls at 6 of 10 spawn points.
  - N=24 at dt=1/60, spawn point 3: 4 zombies were thrown to x = -14 to -54 (outside the map) on the very first
    frame. They cannot be killed from any floor tile.
  - Normal play did not trigger it: waves spawn at most one zombie every 0.5 s or more. The maximum was 9 in one
    pocket, with no ejection (`run1.mjs`, `run2.mjs`, `t9.mjs`).
  - Reaching it takes `debug.spawnZombie(n, spawnPointId)` or a sustained low frame rate with a crowded pocket.
- **Expected:** zombies stay in walkable tiles. **Actual:** they are ejected into walls or out of bounds.
- **Fix:**
  - Clamp the separation vector's magnitude, for example to `ZOMBIE.separationForce`.
  - Seed exact-stack nudges with a small random or angle-based offset instead of a pure x push.
  - In `resolveCircle`'s centre-inside branch, pick the nearest edge whose neighbour tile is walkable.
- **Resolution (FIX-2, map side):** `src/map.js` `resolveCircle` now guarantees the returned centre is in bounds, on a
  tile walkable for the mover, and not overlapping any blocking tile. Pushes that would land in another blocking tile use
  the smallest axis exit into a walkable neighbour; centre-inside exits only toward walkable neighbours; last resort is the
  nearest safe spot of the nearest walkable tile. Normal movement output is byte-identical to before (tested). Regression
  tests in `tests/map.test.js` (wall-to-wall, off-map x = -54, whole-map fuzz). Separation capping in `zombie.js` is FIX-1's.
- **Resolution (FIX-1, zombie side):**
  - The summed steering separation is clamped to `separationForce`.
  - Exactly stacked zombies fan out along an angle derived from their ids.
  - Overlap resolution moves a zombie at most `ZOMBIE.separationMaxPush` (6 px) per pass.
  - Every move ends with `resolveCircle` plus a clamp to the map bounds.
  - Checked: 24 zombies spawned on one point, at all 10 spawn points, at dt 1/30 and 1/60. All stayed on walkable tiles with both the old and the new `map.js`. A test was added.
  - The `resolveCircle` exit-edge choice is left to the map fix.

### 3. Rebuilding a window while a zombie is inside the window tile lets it pass through the new boards
- **Where:** `src/map.js:234-242` `resolveCircle`, centre-inside branch. Reached from `zombie.js moveAndCollide`.
- **Repro (verified, scratch `t1.mjs`, `t3.mjs`):**
  - For zombies at legal positions inside a window tile, set `boards` from 0 to 1 and call `resolveCircle`:
    72 of 507 positions ended in a wall tile or were still in the window tile.
  - In the full `updateZombies` simulation over all 8 windows, about 2/3 of the zombies caught in the window
    finished inside the play area with the barricade at 6 boards. They went through the rebuilt boards without tearing.
  - No soft-lock was found: zombies pushed back into the pocket correctly go back to tearing.
- **Expected:** a zombie that is mid-window when a board goes up is pushed back into its pocket, or is treated as
  already through, but is never placed inside a wall. **Actual:** it can be pushed into the wall tile above or below
  the window for a frame, and usually walks through.
- **Fix:** same as #2. Choose an exit edge that leads to a zombie-walkable tile, preferring the pocket side when `!z.inside`.
- **Resolution (FIX-2):** midline rule in `resolveCircle`: a zombie whose centre is in a window tile when boards go up is
  pushed back into its pocket if it is on the pocket side of the midline (ties included), otherwise pushed inside. It is never
  left in the window tile or overlapping the adjacent wall tiles. Regression test covers all 8 windows with random positions.

### 4. Ray-gun splash ignores walls, and its kills can drop power-ups in spawn pockets the player cannot reach
- **Where:**
  - `src/weapons.js:259-265` `detonate`: the splash loop has no line-of-sight or wall test.
  - `src/powerups.js:75-79` `rollDrop`: the drop is placed at the kill position.
- **Reasoning (not executed):**
  - A ray-gun bolt fired at a window detonates on the window face. It is a ray-blocking tile, so this is about
    40-60 px from the pocket centre.
  - The pocket zombie is inside `splashRadius + radius` (90 + 14), so it takes 300 damage with `cause 'weapon'`.
    That can roll a drop at the pocket centre.
  - The player can never stand in a pocket tile, and the closest player position is at least 74 px from the pocket
    centre. That is more than `pickupRadius + player.radius` (42), so the item cannot be collected. It still counts
    against `maxPerRound` (4).
  - The same missing wall test lets splash hurt zombies on the far side of any wall.
- **Expected:** power-ups can be collected, and splash respects walls. **Actual:** drops can land out of reach,
  and splash goes through walls.
- **Fix:**
  - In `detonate`, skip targets where `raycastWalls(map, x, y, dir to target, d) < d`, backing the origin off the
    impact point by 1 px so a window-face hit does not self-block.
  - Or, in `rollDrop`, skip or clamp drops whose tile is not player-walkable.
- **Resolution (FIX-4, Phase 4):** both fixes applied.
  - 4a: `detonate` now skips splash (zombies and the self-splash on the player) unless `raycastWalls` from the impact point, backed off 1 px against the bolt direction, reaches the target's nearest edge (0.5 px tolerance). Regression test: `tests/weapons.test.js` "ray gun splash does not pass through a window or wall (review #4a)".
  - 4b: `rollDrop` keeps the kill position only if its tile is player-walkable (`isWalkable(map, tx, ty, false)`); otherwise it moves the drop to the nearest player-walkable tile centre within 3 tiles (the window's inside neighbour for a pocket), or skips the drop without counting it toward `maxPerRound`. Regression tests: `tests/powerups.test.js` "(review #4b)" x2.

---

## Checked and found correct (no action)
- **Event names:** every `emit`/`on` literal in `src/` is one of the 22 canonical names.
- **Restart and listeners:**
  - `events.clearAll()` runs before re-init.
  - `initPlayer`, `initRounds`, `initPowerups`, `initRender`, `initHud` and `initAudio` all drop their previous
    subscriptions first.
  - `initInput` removes its DOM listeners.
  - main's own `keydown`/`click` listeners are registered once.
- **Timers:** everything uses `dt` or `state.time`, so timers freeze correctly while paused. This covers power-up
  expiry (absolute `state.time`), box spin and offer, repair, tear, regen, wander, the nuke stagger and bullet ttl.
- **Division by zero and NaN:**
  - `norm`, `getFlowDir`, `lifeFrac` and HUD accuracy all have guards.
  - `setTimeScale(0)` gives one sub-step with dt 0 and no division.
  - In long simulations, zombie positions and player points stayed finite.
- **Rounds:**
  - Counts match 5.6: `zombiesForRound(10) = 29`.
  - `round:start` and `round:end` fire once each. `alive` is clamped at 0.
  - Debug `skipToRound` kills zombies before it resets `alive`.
- **Iteration and removal:**
  - Zombies are removed by an in-place compaction after the update loop.
  - Power-up items are spliced while iterating backwards.
  - Bullets are rebuilt into a `keep` list.
  - Effects are compacted and capped at 400.
  - `killZombie` never splices, so a kill in the middle of a hitscan or splash loop is safe.
- **Section 5 values:** points (10 per kill, nuke +40, carpenter +20, boards 1 each capped at 10 per round, ×2 applied
  inside `addPoints`), power-up durations and re-pickup reset, max ammo refilling reserve only, prices (box 95 or 10,
  ammo `round(cost*0.5)`), and box logic (held guns excluded at reveal, offer expires) all match.
- **Player collision:** fuzzed with 400k frames of random movement at sprint speed and dt = 1/30. The player was never
  inside or overlapping a blocking tile.
