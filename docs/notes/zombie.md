# zombie.js notes (Agent D)

## What was built
`src/zombie.js` implements the 3.6 API exactly:
`spawnZombie, updateZombies, damageZombie, killZombie, healthForRound, tierForRound`.
It also exports `HIT_FLASH` (0.08), used by tests.

- `healthForRound(r)`: `150 + 100*(r-1)` for r <= 9, else `round(950 * 1.1^(r-9))`. Values below 1 count as 1.
- `tierForRound(r, rng)`: one `rng.next()` roll against the 5.5 table.
- `spawnZombie(state, sp)`: uses `state.rounds.round` (defaults to 1), speed = tier speed x `rng.range(0.9, 1.1)`.
  It pushes to `state.zombies`, emits `zombie:spawned {zombie}`, and returns the zombie.
  It does NOT check `ZOMBIE.maxAlive`. waves.js does that.
- `damageZombie(state, z, amount, cause='weapon', x, y)`: returns `true` if this hit killed.
  It ignores dying zombies. x,y default to the zombie position. Insta-Kill raises the damage to at least the current hp,
  and the `zombie:hit` payload `amount` is the damage actually applied.
- `killZombie(state, z, cause='weapon')`: returns `true` the first time and `false` afterwards. The guard is the internal
  `z._killed` flag plus `mode==='dying'`, so `zombie:killed` fires exactly once. It awards no points and does not touch `stats`.
  player.js does `stats.kills++` (see 5.3).

## Spawning / window behavior
- Window spawn (`barricadeId != null`): the zombie appears at the spawn point x,y (the pocket tile center) in mode `tearing`.
  It always starts tearing. The first update switches it to `chasing` if the barricade is already open, so spawning makes no map calls.
- Tearing: every `boardTearTime` it calls `map.tearBoard(map, barricadeId)`. It goes to `chasing` once `map.barricadeOpen` is true.
  Tearers get separation steering (and `resolveCircle`) so several at one window do not stack.
- Chasing zombies then follow the flow field through the window tile. Windows count as walkable in the flow field per 5.5.
- Extra field `inside` (bool): it becomes true once the zombie stands on a tile that is neither a pocket (3) nor a window (2).
  If boards are repaired while a not-yet-inside zombie is still on its pocket tile, it goes back to `tearing`.
  If it is standing in the window tile, `resolveCircle` pushes it out.
- Open spawn (`barricadeId == null`): starts `chasing` with `inside = true`.

## Behavior details / decisions
- Chasing: direction = `getFlowDir(state.flow, x, y)`. If that is `{0,0}` (flow missing, or zombie on the player's tile), it heads straight
  at the player. Velocity = dir*speed + separation, then `map.resolveCircle(map, x, y, r, true)`.
  Speed drops to 0 while overlapping the player's body, so zombies do not push into the player.
- Attacking: enter when `dist <= attackRange + player.radius` and the player is not down. Wind-up `attackWindup`.
  Once started, the swing always completes and lands only if the player is still in range. Then `attackCd = attackCooldown`.
  Out of range (and not mid-swing) goes back to chasing. A downed or missing player sends the zombie back to chasing immediately.
- Wandering (Zombie Blood): chasing/attacking zombies switch to wandering. Tearing zombies keep tearing.
  A random direction is picked every 1-2 s (`rng.range`), at 0.5x speed. When Zombie Blood expires, the zombie returns to chasing.
- Dying: corpses skip all logic and separation. `dyingT` counts down, then the zombie is spliced out of `state.zombies` (in place, order kept).
- Power-up checks read `state.powerups.active[type] > state.time` directly (contract 3.5), with no import of powerups.js.
  That keeps damage logic testable and avoids an import cycle. The semantics match `powerups.isActive`.
- Imports used: `map.tearBoard, map.barricadeOpen, map.resolveCircle`, `pathfinding.getFlowDir`, `player.damagePlayer`.
  Tile lookups for `inside` use `map.tiles[ty*cols+tx]` with `TILE` directly (tile codes from 5.1).

## Extra (non-contract) zombie fields
`inside`, `wanderT`, `wanderX`, `wanderY`, `_killed`. Render may ignore them. The debug overlay can show `mode`.

## Effects pushed to `state.effects`
All effects have type `'blood'`:
- Per hit: `{ type:'blood', x, y, ttl:0.6, maxTtl:0.6, radius:7, big:false }` (x,y = hit point).
- On death: `{ type:'blood', x, y, ttl:6.0, maxTtl:6.0, radius:18, big:true }` (x,y = zombie position). This is a floor decal.
  The corpse itself is the zombie in mode `dying` (fade/scale by `dyingT / ZOMBIE.deathLinger`).
Suggested rendering: a `COLORS.blood` circle of `radius`, alpha = `ttl/maxTtl`.

## Constants to move to config (TODO(integrator))
`HIT_FLASH=0.08`, `SPEED_JITTER=0.10`, `WANDER_MIN=1`, `WANDER_MAX=2`, `WANDER_SPEED_MULT=0.5`,
`BLOOD_HIT_TTL=0.6`, `BLOOD_DEATH_TTL=6.0`.

## Tests
`tests/zombie.test.js` covers the stat curves, tier distribution (seeded), spawn shape/events, damage, the kill-once guard,
insta-kill (active and expired), corpse removal, direct chase without flow/map, the attack transition, the downed-player rule,
Zombie Blood wandering, and separation.
Tests that need the real `player.damagePlayer` or map functions are skipped while those are stubs
(`String(fn).includes('not implemented')`). They use an inline 7x7 fake map (pocket, window, room).

## Phase 4 fixes (FIX-1)
- **Pocket soft-lock (review.md #1, blocker).** Every frame, any non-dying zombie whose tile is a spawn pocket (code 3)
  looks up the barricade from the pocket tile itself. The index is built once per map from `map.spawnPoints` (a window
  spawn point sits on its pocket, and spawn ids 1-8 == barricade ids), with a fallback to any barricade 4-adjacent to the
  pocket. It is cached in a `WeakMap`, so the Map shape is untouched.
  - The zombie sets `z.barricadeId` to that barricade and, if it has boards, switches to `tearing`. This happens whatever
    its mode (chasing, attacking or wandering), `z.inside` or previous `barricadeId`.
  - This runs before the Zombie Blood override, so a wanderer in a rebuilt pocket tears its way back out.
  - `z.inside` is now recomputed each frame (false on pocket and window tiles) instead of being latched.
  - Wandering zombies that stand in the play area refuse any step that would put their centre on a window or pocket tile.
    They keep their position and pick a new direction. Zombie Blood can no longer herd zombies into pockets.
- **Crowd blob (playtest.md #1).** Three layers:
  1. Steering separation now also runs in `attacking`. It moves the zombie only; the attack state machine is unchanged.
  2. `blockByContacts`: a chasing zombie in the play area drops the part of its velocity that points at any zombie within
     `separationMinDist + 2`. The back of the crowd slides around or waits instead of compressing the front ring.
  3. `resolveOverlaps` runs after all zombies update. It is a positional relaxation of `ZOMBIE.separationIters` (2) passes:
     - Pairs of play-area zombies closer than `ZOMBIE.separationMinDist` (28 = 2 x radius) are pushed apart, half each.
     - Zombies are pushed out of the player's body.
     - Each zombie's displacement per pass is capped at `ZOMBIE.separationMaxPush` (6 px).
     - `map.resolveCircle` and a map-bounds clamp are applied afterwards.
     - Zombies on pocket or window tiles are excluded, since a one-tile pocket cannot hold a queue without overlap.
       They keep the capped steering only.
  - The crowd now forms a ring at attack range. About 10 zombies fit around the player (a circle of about 48 px radius),
    so the number of attackers is limited by geometry. No explicit attacker cap was added.
  - In headless 900 s runs, pairs of play-area zombies closer than 21 px went from about 13% of sampled pairs to 0.
- **Separation cap and bounds (review.md #2, zombie side).**
  - The summed steering separation is clamped to `separationForce` (120 px/s).
  - Exactly stacked zombies are nudged along a deterministic angle derived from their ids, not all along +x.
  - Every move (`settle`) ends with `resolveCircle` and a clamp to `[r, width-r] x [r, height-r]`. A move that gives a
    non-finite position is skipped.
  - Test: 24 zombies spawned on one point, at each of the 10 spawn points, at dt 1/30 and 1/60. None left walkable tiles,
    with either the old or the new `map.resolveCircle`.
- **One tearer per window (playtest.md #2, lead decision).**
  - New extra field `tearOwner`. At the start of `updateZombies`, the tear-slot owners (one per barricade) are rebuilt
    from alive tearing zombies that have `tearOwner` set.
  - A tearing zombie whose barricade has no owner claims the slot. The others queue in the pocket with `tearTimer = 0`.
  - The slot frees when the owner dies or leaves `tearing`. The next queued zombie claims it on the following update,
    and its tear clock starts from 0. Boards therefore come down at most one per `boardTearTime` per window.
  - When the window opens, every queued zombie goes to `chasing`.
- **Balance (balance.md #6).** `ZOMBIE.speeds.sprint` changed from 210 to 195.
- **New config keys (ZOMBIE block):** `separationMinDist: 28`, `separationMaxPush: 6`, `separationIters: 2`.
- **New tests:**
  - Pocket re-entry regression, while chasing and while wandering under Zombie Blood.
  - Wanderers never enter a window or pocket tile.
  - A single tearer per window, with a queued zombie taking over.
  - Ring formation: 24 zombies at dt 1/60 and 1/30. No pair is closer than 1.5 x radius, some zombies attack but not all,
    and none is inside the player.
  - Heavily stacked spawns on the real map stay on walkable tiles and inside the bounds.
- **Headless verification.** A scratch harness imports the real modules and runs them in the 3.7 order with an
  aim-and-shoot bot.
  - The QA `t7` repro (Zombie Blood, then Carpenter, 20 seeds) left 0 zombies stuck in a pocket. The old code left 6.
  - 900 s god-mode runs used seeds 1-6 at dt 1/60 and 1/30, with random Zombie Blood and Carpenter pickups added as stress.
    They reached rounds 8-10 and found:
    - No soft-lock. The longest gap between kills was one walker coming back from far away, and it kept moving.
    - No zombie ended up in a wall or out of bounds.
    - The only samples of a zombie in a pocket without tearing lasted one frame. That happens when a Carpenter is applied
      after `updateZombies` in the same frame.
  - Without the stress pickups, progress matched the old code: rounds 9-10, against 9 before.
  - Mortal runs (seeds 7-9) also matched the old code: a stationary MR6 bot dies in round 3-4.

## WO2 (Agent H) - Thundergun knockback (WORK_ORDER_2.md 3.10)
- **New export** `applyKnockback(state, z, vx, vy, stunSeconds)`. It sets `z.kvx`, `z.kvy` (replacing any earlier
  knock), `z.stun = max(z.stun, stunSeconds)` and `z.knockAngle = atan2(vy, vx)`, and it cancels any attack
  wind-up (`attackTimer = 0`). It returns `true` if the knock was applied. Dying zombies and zombies in mode
  `tearing` ignore it (return `false`). Non-finite velocity components become 0. A `stunSeconds` that is not a
  positive finite number is rejected (returns `false`, zombie untouched), because `updateStunned` is what clears
  the knock velocity; a knock with no stun would otherwise keep `kvx`/`kvy` forever (review #7).
- **New zombie fields** (initialised in `spawnZombie`): `kvx`, `kvy`, `stun`, `knockAngle`. Render can use
  `z.stun > 0` for a stagger pose and `knockAngle` for its direction. `z.vx/vy` mirror the knock velocity while
  the zombie is sliding.
- **`updateZombies`.** A zombie with `stun > 0` runs `updateStunned` instead of the pocket check, the Zombie Blood
  override and the AI:
  - The slide uses the exact integral of `v0 * e^(-knockFriction * t)`, so the distance does not depend on
    frame rate. The total slide is about `v0 / knockFriction` (720 / 6 = 120 px for the Thundergun).
  - Capped steering separation is added. Then it calls `settle`, which runs `resolveCircle` and clamps to the
    map bounds.
  - When a wall pushed the zombie back, the velocity component into that wall is removed. The zombie stops
    at the wall and does not bounce or tunnel through.
  - Velocity is zeroed below `ZOMBIE.stunMinSpeed`.
  - `stun` counts down. When it ends, the knock velocity is cleared and `attacking` becomes `chasing`. Any
    other mode resumes as it was.
  - `resolveOverlaps` still runs for stunned zombies in the play area.
- **Pockets.** Boarded windows are not walkable for zombies, so a knock can only carry a zombie into a pocket
  through an open window.
  - While stunned, the pocket check is skipped, so the zombie does not tear.
  - From the frame after the stun ends, the normal Phase 4 pocket rule applies:
    - If the window is still open, it walks back in.
    - If the window was boarded meanwhile, it adopts that pocket's barricade and tears from the outside.
  - Queued tearers cannot be knocked, so the single-tearer slot logic is unaffected.
- **`damageZombie` with `Infinity`** (used by Thundergun near-cone kills). A non-finite damage is converted to the
  zombie's remaining hp:
  - `hp` ends at exactly 0, never `-Infinity` or `NaN`.
  - `zombie:hit.amount` is finite, equal to the hp removed.
  - `zombie:killed` fires once.
  - `killZombie` also forces a `NaN` hp to 0 and clears knock and stun.
- **Config (ZOMBIE block):** `knockFriction: 6`, `stunMinSpeed: 20`.
- **Tests added:**
  - Knockback moves the zombie and decays to a stop, with slide distance close to `v0 / friction`.
  - Stun blocks attacks, and attacking resumes as chasing when the stun ends.
  - The zombie chases again after a knock.
  - A wall stops the slide.
  - Tearing zombies ignore knockback.
  - Dying zombies ignore knockback, and knocked zombies can still be killed.
  - `Infinity` damage kills cleanly and emits `zombie:killed` once, with and without insta-kill.
  - A zombie knocked through an open window walks back in.
  - A zombie knocked into a pocket that is then boarded tears back out after the stun.
  - `applyKnockback` with stun 0, negative, NaN, Infinity or non-numeric returns `false` and sets no velocity.
