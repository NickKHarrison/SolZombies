# WO5 QA-2 — Code review

Scope: WO5 changes in `boss.js`, `level.js`, `levels/*.js`, `map.js` (mega door, stairs, arena),
`zombie.js` (kinds, boss AI, charge, `pushZombie`, minions), `powerups.js`, `weapons.js`, `waves.js`,
`shop.js`, `main.js`, and the WO5 parts of `render.js`, `hud.js` and `audio.js`.

**Method:** I read the code against WORK_ORDER_5 Sections 1 and 3. Then I checked suspected issues
with headless Node scripts that import the real modules. The harness copies `main.js`
`buildState`, `initAll` and `update` exactly, including the transition gating and the flow rebuild
on a map or version change. The scripts live in the session scratchpad under `qa2wo5/`
(`h.mjs` is the harness, `t1`–`t8.mjs` are the scenarios). No `src/` or `tests/` file was edited.

**Result:** no Critical or High bugs. The boss state machine, the seal/unseal flow, round
bookkeeping, descent and restart all behaved correctly in every scenario I ran. Two gameplay bugs
are verified: a Medium one and a Low one. There is also one Low spec deviation and a few Info notes.

---

## Medium

### M1. Insta-Kill's 5 % is applied per hit and per pellet, so the boss dies in about 1 second
- **Where:** `src/zombie.js` `damageZombie`, around line 307:
  `if (powerupActive(state, 'instaKill')) dmg = Math.max(dmg, BOSS.instaKillFrac * maxHp);`
- **Repro (verified with t1.mjs and t8.mjs):** Level 1, round 1, boss max HP 4480.
  - With Insta-Kill and a Haymaker 12 at point blank, the boss dies in **3 trigger pulls**. Each
    pull fires 8 pellets, and each pellet is raised to 5 %, so one pull deals 40 %. That is about
    0.6 s at 300 rpm.
  - With Insta-Kill and Death Machine, the boss dies in **20 shots**, which is **1.0 s** at 1200 rpm.
  - The Marshal 16 (8 pellets) deals 40 % per shot. Every auto gun kills the boss in 20 hits.
- **Expected:** WO5 1.2 says Insta-Kill hits deal 5 % "(not a kill)". The intent is that Insta-Kill
  cannot trivialise the boss. Per-hit and per-pellet flooring turns any 20-hit burst into a kill.
  The 45–75 s TTK target becomes about 1 s whenever an Insta-Kill drop is live. Minions drop
  power-ups at the normal rate during the fight, so this happens in real play.
- **Actual:** boss TTK under Insta-Kill = 20 hits, whatever the gun.
- **Fix (pick one):**
  - (a) Rate-limit the bonus per boss, e.g. `z.instaT` so the 5 % floor applies at most once per
    0.25 s. Other hits deal normal damage.
  - (b) Apply the floor once per `tryFire` call rather than once per pellet. For example, pass a
    shot id and keep the first hit of each shot only. Auto guns still benefit a lot, so (a) is the
    more robust fix.
  - (c) Make Insta-Kill add +5 % max HP per second of exposure instead.
  - Also add a test that fires a Death Machine and a Haymaker 12 with Insta-Kill active and
    asserts the boss survives more than N seconds.
- **Resolution (FIX-2):** lead decision replaces the 5 % floor with x2 damage (`BOSS.instaKillMult`) plus a per-hit cap of 3 % max HP (`BOSS.maxHitFrac`) in `zombie.bossHitDamage`/`damageZombie`, so pellets and Death Machine bullets no longer stack a floor. Test: 20 Death-Machine-sized hits under Insta-Kill leave the boss alive. Measured KN-44 + Argus L1 R10 with Insta-Kill: 17.4 s median (was 5.1 s; 45.7 s without Insta-Kill).

## Low

### L1. The Argus wall buy can be bought and refilled from inside the sealed level-1 arena, through the wall
- **Where:** `src/levels/level1.js` ascii, where the wall buy `9` (Argus) sits at tile (42,29).
  Only one wall row (row 28) separates it from the arena floor at (42..43,27).
  `map.nearestInteractable` uses only rect distance (`PLAYER.interactRange` 64) with no line of
  sight.
- **Repro (verified with t7.mjs):**
  1. Open all doors, open and then seal the mega door.
  2. Put the player at (1720,1100), which is arena tile (43,27).
  3. `nearestInteractable` returns `wallbuy:argus` at dist 60.
  4. `shop.updateShop(..., {interact:true})` **buys the Argus** (the player now holds
     `['mr6','argus']`). The next prompt is the ammo refill for 75.
  - A scan of every arena position found no other interactable. Level 2 has none.
- **Expected:** WO5 1.1 says the arena has "no wall buys". The fight should not offer an ammo or
  gun shop behind a sealed door.
- **Actual:** mid-fight Argus purchase plus unlimited ammo refills from the arena's south edge.
  `tests/levels.test.js` checks only that no buy letter is inside the arena tiles, so this passes.
- **Fix:** do one of these:
  - Move the `9` wall buy at least one tile further from the arena, or put it on another armory wall.
  - Make the arena's south wall two tiles thick there.
  - In `nearestInteractable`, skip wall buys, the box and barricades whose tile is not on the
    player's side (for example `raycastWalls` from the player to the rect's nearest point).
  - Also extend the levels test: no wall buy, box or window may be within `interactRange + radius`
    of any arena tile.

- **Resolution (FIX-1):** Argus `9` moved (42,29) -> (38,29) on the hall's north wall: 3 tiles (Chebyshev) from the nearest arena tile, >= 8 from every other buy, same zone. `validateArena` in `tests/levels.test.js` now fails any wall buy, box, window or door D..H within 2 tiles of an arena tile (both levels), with a negative case for the old position. Browser probe: from every arena tile `nearestInteractable` finds only the mega door; Argus is still buyable from the hall.

### L2. Timed power-ups keep running during the 1.2 s descent fade
- **Where:** `src/main.js` `update()`. `s.time += dt` runs before the `if (s.transition) return`
  gate, while `powerups.active[type]` stores absolute expiry times.
- **Repro (verified with t5.mjs):**
  1. Death Machine has 30.00 s left.
  2. Use the stairs and step 1.3 s.
  3. 28.68 s are left. About 1.2 s were used up while nothing could be played. The same happens to
     Insta-Kill, Double Points, Fire Sale and Zombie Blood.
- **Expected:** WO5 1.3 says "Player keeps … active power-ups".
- **Actual:** each timed power-up loses about 1.2 s per descent. The loss is small, but the player
  cannot act during the fade.
- **Fix:** in the transition branch of `update()`, shift every `state.powerups.active[type]` by
  `+dt` before returning. Alternatively, do not advance `s.time` while `s.transition` is set, but
  check the render/HUD animations that read `state.time`. The first option is simpler.

- **Resolution (FIX-1):** `main.js` `update()` pushes every numeric `state.powerups.active[type]` forward by `dt` while `state.transition` is set. Browser: Double Points 29.92 s left before `descend()`, 29.80 s after 1.3 s of stepping (only the 0.1 s after the fade ended elapsed).

## Info (no change required, or a design call)

- **I1. Descending mid-round skips that round's end.** Verified with t5.mjs. If normal zombies
  from round N are still alive when the player descends, `startLevel` resets the rounds to a
  3 s break with the round number kept. No `round:end` fires, and round N+1 starts on the new
  level. This matches 1.3 ("round counter continues; fresh break"). Stating it here so balance
  QA knows that the stairs can end a round early.
- **I2. `finishFight` kills the leftover minions with cause `'debug'`.** This is correct (no
  points, no drops, no stats). However, every kill emits `zombie:killed`, so `audio.js` plays up
  to 10+ `zombieKilled` SFX in the same frame as the victory sting. Cosmetic. If it is audible,
  skip the SFX when `cause === 'debug'` and `kind === 'minion'`.
  - **Resolution (FIX-3):** `audio.js` skips the death groan for `cause === 'debug'` and plays at most one groan per frame (12 ms gap).
- **I3. Boss death FX are pushed twice.** `zombie.killZombie` pushes a blood pool (r 44), a flash
  and a shake. `render.onZombieKilled` pushes its own `bossDeath` pool, flash and shake. Shake and
  flash take the max, not the sum, so the only visible result is two overlapping pools. Harmless.
  One owner would be cleaner.
  - **Resolution (FIX-3):** render no longer pushes its own pool; zombie.js's boss `blood` effect is the only pool (render draws it large and lobed). Render keeps the flash, shake and a 0.6 s shock ring (`RENDER.bossRingTtl`).
- **I4. Level-3 difficulty dip** (already raised in integration-wo5.md Findings 1). Level 3 (loop 1
  of level 1) has health ×1.4, which is lower than level 2's ×1.5. That is a balance QA call.

## Checked and found correct

Each item was verified with a script unless marked as code reading.

- **Seal and fight start:** the player entering the arena seals the mega door, sets
  `suspended = true`, spawns 1 boss and 4 + levelIndex minions, and emits `boss:start` once.
  Normal zombies outside stay and keep their `alive` count (t1, t2).
- **Boss containment:** in 20 000 frames per level of random 60 px pushes, forced charges and
  random player positions, the boss centre was never in a blocked tile and never outside
  `arenaTiles` (t6). Charges into the sealed door or the closed stairs stop and go to `recover`.
- **Boss pathing:** in both arenas, from spawn, the boss reached melee on every sampled arena
  tile within 8 s (21 of 21 tiles on L1, 23 of 23 on L2). It never got stuck on the pillars (t2).
- **Outside zombies after unseal:** the flow rebuilds on the version bump, and the stuck outside
  zombies walk the long way round into the arena (t4). `endRoundNow` keeps the round active with
  `alive` = live normal zombies and `toSpawn = 0`.
  - When a nuke has already cleared the outside zombies, `round:end` fires right away and the
    break starts (t8).
- **Power-ups:**
  - The nuke deals exactly 10.0 % to the boss, kills every minion and every outside normal zombie,
    and never queues the boss (t8).
  - A boss killed by `nuke` or `weapon` pays exactly 200 in total. The only boss drop is the
    guaranteed Max Ammo (t1, t8).
  - The Thundergun rules and `pushZombie` distances match the integration notes (code reading).
- **Minion cap:** `spawnMinions` limits each wave to the room left under `maxMinions` of live
  minions (code reading). The summon timer still resets when the cap is hit.
- **Descent:** chained 3 times (L1, then L2, then L3 on loop 1, then L4 CATACOMBS on loop 1).
  - At every swap: zombies, bullets, the nuke queue, items, the box, the boss and the doors reset.
  - The player moved to `playerStart` each time. Points, weapons, the Death Machine temp weapon
    and the round number carried over.
  - Difficulty per loop matched 1.3.
  - `beginDescent` re-entrancy is guarded, and the shop is inert during the fade (t5).
- **Listeners:** after 3 descents, a normal kill paid exactly +10 and `alive` dropped by exactly 1.
  - No module subscribes on descent: `startLevel`, `beginDescent` and `updateLevel` never call `on`
    (code reading).
  - Restart runs `events.clearAll()` and then `initAll`. Every init also drops its own previous
    unsubs (`boss.initBoss` included).
- **Restart mid-fight or mid-transition:** `buildState` builds a fresh state (transition null,
  boss idle, index 0). The `game:restart` reset in `initBoss` closes over the new state. The
  player cannot die during a fade because nothing that deals damage is updated then.
- **Static layer and HUD:** the static layer cache key includes map identity, level id, theme
  signature and mega-door/stairs flags. The HUD boss-bar lag is keyed by the globally unique
  `bossId` (code reading).
- **Level-2 wall ammo** = `round(cost × 0.5)`: 100 to 150 for the new guns. The box pool is
  unchanged by level. Fire Sale only changes the price and carries across a descent as an active
  power-up (code reading).
