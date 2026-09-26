# WO7 code review (QA-2)

Scope: the WO7 changes in `player.js`, `weapons.js`, `shop.js`, `map.js`, `zombie.js`, `boss.js`, `scores.js`, `main.js`, `level.js`, `render.js`, `hud.js`, `audio.js`, `input.js` and `touch.js`, checked against WORK_ORDER_7 sections 0, 3 and 4, the WO7 sections of `docs/notes/`, and `integration-wo7.md`.

Method: I read the code, then checked each suspicion with Node scripts that import the real `src/` modules. The harness copies `main.update()` in order: level, player, rounds, flow, zombies, `updateHazards`, boss, bullets, power-ups, shop. It skips DOM modules. For the listener count, a loader hook adds a count export to `events.js`; `src/` itself is not modified. The scripts are in the session scratchpad and are not part of the repo.

`npm test` passes 496/496.

**Result: no Critical, High or Medium bugs were found.** There are 6 Low findings and 2 Info notes, listed below.

---

## Low

### L1. Acid pools and globs from the old level are drawn on the new map during the fade-in
- **Where:** `src/level.js` `startLevel()` (line 178) and `src/boss.js` `updateHazards()` (lines 96-98).
  - `startLevel` resets `zombies`, `bullets`, `effects` and power-ups. It does not reset `state.hazards` or `state.acidGlobs`.
  - `updateHazards` clears them only when it sees a new `state.map`. `main.update()` returns early while `state.transition` is set, so it cannot run until the fade ends.
  - `render.render` still calls `drawHazards` and `drawAcidGlobs` during the fade.
- **Repro** (`t2.mjs`):
  1. On LABORATORY, `lobAcid` twice, which gives 3 pools and 3 globs.
  2. `beginDescent`.
  3. After the midpoint swap (frame 35), BUNKER II is loaded, yet `hazards.length + acidGlobs.length` is 6 for the rest of the fade. They are only cleared on the first update after the fade.
- **Expected:** the new level starts with no hazards.
- **Actual:** frozen L3 pools and mid-air globs are drawn at their old world coordinates on the new map for about half the fade. They deal no damage, because the first `updateHazards` clears them before any damage.
- **Fix:** in `startLevel`, next to `state.bullets = []`, add `state.hazards = []; state.acidGlobs = [];`, or call `bossMod.clearHazards(state)`, which is guarded like `createBossState`.
- **Resolution (FIX-3):** `level.startLevel` sets `state.hazards = []` and `state.acidGlobs = []` next to bullets/effects, so the new level is hazard-free from the midpoint swap. Tests in `tests/level.test.js` (direct and mid-fade); verified in the browser (LABORATORY -> BUNKER II, 0 pools/globs right after the swap).

### L2. The Quick Revive machine on a new level shows "available" for the whole fade-in after a sell-out
- **Where:** `src/shop.js` `updateShop()` (line 408). It returns on `state.transition` before calling `syncPerkMachines` (line 513). The new map from `loadMap` has `soldOut: false`.
- **Repro** (`t6.mjs`):
  1. Set `reviveUses = 3`, then run one update. L1 shows the machine sold out.
  2. Descend. For 36 frames of the fade-in, the new level's Q machine has `soldOut === false`, so render paints a lit machine with a price. It flips to SOLD OUT on the first playable frame.
  3. Q is in the start zone by rule, so this happens right where the player arrives.
- **Expected:** the machine is sold out from the first rendered frame.
- **Actual:** it is visible and lit for about 0.35 s, then goes dark.
- **Fix:** call `shop.syncPerkMachines(state)` before the transition early-return in `updateShop`. It is pure and cheap. Alternatively, call it at the end of `level.startLevel`.
- **Resolution (FIX-3):** `shop.updateShop` calls `syncPerkMachines(state)` first, before the transition early-return. Test in `tests/shop.test.js`; verified in the browser (sold-out Q on BUNKER II on the first frame after the swap).

### L3. The "best" flags and the menu best line only look at the stored top 10, so an evicted high-points run is forgotten
- **Where:** `src/scores.js` `recordRun()` (line 169, `isBestPoints`) and `bestScore()` (line 198).
  - The table is sorted by round first. A low-round, high-points run is dropped once 10 higher-round runs exist.
  - `isBestPoints` then compares only against what is left.
- **Repro** (`t4.mjs`):
  1. Record R1 with 99999 points, then 10 runs of R10 to R19 with 100 points each.
  2. The menu best is `{ round: 19, points: 100 }`.
  3. A new R2 run with 500 points returns `isBestPoints: true` with `rank: null`. The HUD shows "NEW BEST SCORE!" with no rank and no highlighted row.
- **Expected:** "best points" means the all-time best, or the flag is at least consistent with the ranked table.
- **Actual:** a false "NEW BEST SCORE!" and a menu best-points value that goes down.
- **Fix:** either store the all-time maxima (`bestRound`, `bestPoints`) in the envelope next to `scores`, or only set `isBestPoints` when `rank !== null`.
- **Resolution (FIX-3):** the envelope stays `v: 1` and gains `best: { round, points }` (all-time maxima, merged with the table on load, never lowered by a save; old records without it load with best = table maxima). `recordRun` flags and `best`, and `bestScore`, use it. `isBestRound` needs `round > 0`, `isBestPoints` needs `points > 0`. New `loadRecord()`. Tests in `tests/scores.test.js`.

A related cosmetic issue: on an empty table, a round-0 run (death before round 1) returns `isBestRound: true`, so the game over shows "NEW BEST ROUND!". The menu best line hides round < 1. Setting `isBestRound = entry.round > 0 && ...` would make the two consistent.

### L4. Scores fall back to memory for the whole session when localStorage is full, even though reading still works
- **Where:** `src/scores.js` `probeLocalStorage()` (line 70). The probe does a `setItem` write. On `QuotaExceededError` the guarded wrapper switches to memory permanently, before it has read anything.
- **Repro (reasoned; the code path is clear):**
  1. The origin's storage is full. GitHub Pages project sites share `user.github.io` and its 5 MB quota with every other Pages project of that user.
  2. `loadScores` returns `[]`, the menu shows no best, and every run ranks #1 with "NEW BEST ROUND!". The saved table is hidden but not lost.
- **Mid-session variant:** a `getItem` that throws after an earlier success has the same effect. The memory store starts empty, so the stored table disappears for the session and the next run claims #1.
- **Expected:** reads still work when writes fail.
- **Actual:** the saved table is hidden for the session.
- **Fix:** probe with `getItem` only. Let the first failing `setItem` do the switch, as it already does. On a switch, copy the last successful read into the memory store: `memory.setItem(KEY, lastRaw)`.
- **Resolution (FIX-3):** the probe only reads. `createGuardedStorage` goes read-only on the first failing write: later writes/removes go to an in-memory overlay for the session, and keys not written still read from localStorage. A failing read returns the last value read or written for that key. Nothing is shown to the player (`usingFallback` / `readOnly` / `readFailed` getters for debugging). Tests: full quota from the start, and a read failing mid-session.

### L5. A Mule Kick third gun is never shown in the HUD unless it is the active weapon
- **Where:** `src/hud.js` `updateWeapon()` (lines 788-793). The secondary weapon is `weapons[activeSlot === 0 ? 1 : 0]`, which assumes 2 slots.
- **Repro:** give Mule Kick and weapons `[mr6, kn44, rk5]`.
  - With slot 0 active, the readout shows mr6 and kn44 only.
  - With slot 1 active, it shows kn44 and mr6.
  - rk5 is only visible while it is active.
- **Expected:** all held guns are visible, or at least "next in the Q cycle".
- **Actual:** the third gun is invisible. The player cannot tell what Q or 3 will select.
- **Fix:** show the next non-null slot in cycle order, `weapons[(activeSlot + i) % n]`, or list both other slots when `weapons.length > 2`. On mobile the secondary is hidden anyway.
- **Resolution (FIX-2):** both other slots are listed (slot order, with the slot digit on desktop; one compact line on mobile). See playtest #2.

### L6. The player collects power-ups during the Quick Revive down pause
- **Where:** `src/powerups.js` `updatePowerups()` (line 118). The pickup test is `pl && !pl.down && dist < ...`. It does not check `downT`.
- **Repro:** set `downT` > 0 and put a Max Ammo, Nuke or Death Machine item within the pickup radius. It is collected on the next frame. A Death Machine collected while down is equipped and then runs out its timer while the player cannot fire.
- **Expected** (BO3 rule, matching the "no movement, fire, swap, knife, buy" rule in the notes): no pickup while `downT > 0`.
- **Actual:** the pickup happens, and a timed power-up can be wasted.
- **Fix:** change the pickup test to `!pl.down && !(pl.downT > 0)`.
- **Resolution (FIX-3):** applied. Items stay on the floor (ttl still runs), and active timers keep running. Test in `tests/powerups.test.js`.

---

## Info (not bugs; recorded for the Phase 4 fixers)

- **I1.** `shop.buyPerk` refunds with `player.points += cost` and no `points:changed` event, when `addPerk` refuses after `perkBlockReason` has passed. It is unreachable today, because both use the same checks. If it ever happens, the HUD points would be wrong until the next change. Use `addPoints`, or emit `points:changed`.
- **I2.** Acid pools call `damagePlayer` every frame, so `player:damaged` fires 60 times a second and the HUD face wince is re-triggered every frame. The render shake filter `amount < 1` stays valid at the 1/30 dt cap (25 × 1/30 = 0.83). It would break if `BOSS.acid.dps` were raised to 30 or more. Consider a `tick: true` flag in the payload instead of the magnitude test.

---

## Verified OK (probed; no bug)

| Area | Evidence |
|------|----------|
| Quick Revive down with Mule Kick, slot 3 active, Death Machine held | `t1.mjs`: after the revive, `[mr6, kn44]`, `activeSlot` 0, DM still held, 150 HP, `invulnT` about 2. No `weapon:equipped` is sent while the DM is held. `clearTemporary` later equips slot 0. |
| Revive in a boss fight, acid, nuke or round change | `t8.mjs`: L3 boss fight with 3 revive cycles, knife every 20 frames and fire. Health always stays within [0, max], `activeSlot` is always below `weapons.length`, and there are never more than 4 perks. No attacks, charges or spits land while `downT` or `invulnT` is set. `updateHazards` skips while down or invulnerable. Round changes and nukes do not touch the player. |
| Down during a transition | This cannot happen. `updateShop` refuses the stairs while `downT > 0`, and no gameplay runs during the fade. |
| Restart while `downT > 0` | Only possible through debug `restart()`. `buildState` gives a new player, and `game:restart` clears hazards and the render tracker. |
| Buying a perk while down or during a transition | `buyPerk` refuses both, and `updateShop` hides the prompt. |
| Perk cap through debug `givePerk` | `addPerk` enforces the cap and uniqueness. |
| Death Machine and perks | `weaponPerkMods` exempts `deathmachine`. It does not reload, so Speed Cola has no effect on it. |
| Knife and reload cancel with Speed Cola / Double Tap | The knife cancels the active reload. The next reload uses `reloadMult`. There is no fire during `meleeT`. The knife runs before reload and fire in `updatePlayer`, so V+R in the same frame gives a swing and then a fresh reload. |
| Knife through closed doors, windows, walls and perk machines | `t3.mjs` placed the player and zombie on opposite sides of each tile type at an edge gap of 38.5 px (reach 44). Every case gave 0 hits. `blocksRay` includes `TILE_PERK`, `TILE_DOOR`, `TILE_WINDOW` and `TILE_STAIRS`. Zombies in pockets behind windows cannot be knifed, which matches hitscan. |
| Knife vs boss | Damage goes through `damageZombie` and `bossHitDamage`, so the per-hit cap and Insta-Kill multiplier apply and there is no one-shot. |
| Knife kill payout | 10 from `zombie:killed` plus 5 from `melee:hit`, for 15 total. Under Double Points it is 20 + 10 = 30. This is consistent and is not a double payment. weapons.js does not pay anything. |
| `meleeKills`, `perksBought`, `bestWeaponId` | Each is counted by exactly one owner. For every knife target, `zombie:killed` is emitted before `melee:hit`, and nothing in between re-enters `zombie:killed` (the boss listener does not call `finishFight` synchronously). The gun-to-knife transfer in `main.js` is therefore exact, including multi-target swings and boss kills. |
| Listener leaks | `t7.mjs`: event-bus listener count is 10 after each of 5 restarts × 3 descents, re-initialised without `clearAll`. Descents subscribe nothing. The DOM inits (input, touch, hud) were already idempotent, and WO7 adds no new DOM listeners. |
| Render memory | `zTrack` is pruned every 64 frames (entries unseen for 120 frames, only when size ≥ 8) and cleared on restart. `rotCache` is capped at 4096. The tint and white caches are WeakMaps keyed by stable sprites. No sprite is built per frame. |
| Input melee edge with time scale | `withoutEdges` clears `melee`, so one swing happens per press at 10×. |
| Touch KNIFE button | The button hit is resolved before the stick grab (Agent K verified this in Chrome). |
| Scores: corrupt JSON, junk records, quota on write, rank ties, `formatTime` | `t4.mjs`: all are handled and nothing throws. On a write failure, the list lands in memory. Ties rank the older run higher. `formatTime(Infinity / NaN / -1)` gives `0:00`. |
| Boss ability per level, perk machines per level | `t5.mjs`: indices 0-5 and 8 all have 6 machines, one per perk. The LABORATORY loops (2, 5, 8) use `acid` and the others use `charge`. |
