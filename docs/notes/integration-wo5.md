# WO5 Phase 2 integration (Integrator)

`npm test` 370/370, `node --check` clean on every file in `src/`, `src/levels/`, `src/sprites/`.
Browser run: `python -m http.server 8161`, new Chrome tab, `/?debug=1`, driven through
`__game.debug.step(dt, dt, inputOverrides)`.

## Changes

- **src/main.js**
  - `buildState` creates the player at (0,0) and the rounds first, then calls `level.startLevel(state, 0)`.
    That call loads the level-1 map, moves the player to `playerStart` and resets per-level state.
    `map.loadMap()` is no longer called directly. Restart goes through `buildState`, so it always
    returns to index 0.
  - `initAll` also calls `boss.initBoss(s)`.
  - `update()` order:
    1. `level.updateLevel` runs first.
    2. While `state.transition` is set, only the camera and `render.updateEffects` run, then the
       function returns. Render and HUD still run from `tick`.
    3. Otherwise: player, rounds, flow, zombies, **`boss.updateBoss`**, bullets, power-ups, shop,
       effects.
  - The flow field is also rebuilt at once when `state.map` changes (new level) or `map.version`
    changes (a door, the mega door opening, seal or unseal, the stairs opening). The map and version
    are tracked in `flowMap`/`flowVersion`.
  - New debug hooks: `openMegaDoor()`, `startBoss()`, `killBoss()`, `boss()`, `descend()`,
    `setLevel(i)` and `setDifficulty(obj)`. `__game.modules` gains `boss` and `level`. The existing
    hooks still work on any level, including `openAllDoors`, `doors` and `spawnZombie`.
    - `openMegaDoor()` opens all doors for free, then the mega door.
    - `startBoss()` teleports the player to the arena tile nearest the mega door, then calls
      `boss.startFight`.
    - `killBoss()` calls `killZombie(boss, 'weapon')`, which pays 10 + 190.
    - `descend()` opens the stairs if they are closed, then calls `level.beginDescent`.
    - `setLevel(i)` calls `startLevel` directly, with no fade.
- **src/weapons.js**: a Thundergun hit on the boss now goes through the new dep `pushZombie`.
  - The default dep is `zombie.pushZombie`, which moves the boss exactly 60 px (near) or 40 px (far)
    with wall collision and no stun.
  - Before this change, the far cone went through `applyKnockback(bossKnock(40))`, which moves
    `min(|v|/k, 60)` = 40 + stunMinSpeed/k px, so it overshot 40 px.
  - `bossKnock` stays as the fallback when zombie.js has no `pushZombie`, and it is still exported.
  - `tests/weapons.test.js`: `coneSetup` records `push` calls, and the 3 WO5 boss-cone tests now
    assert exact push distances.
- **src/config.js**
  - `RENDER.bossStartShake`, `bossDeathShake`, `bossDeathFlash`, `megaDoorShake`, `bossPoolTtl`,
    `bossScale` and `minionScale`: render.js reads these, with its old literals kept as fallbacks.
  - `AUDIO.bossHitMinInterval: 0.12`: audio.js already read `AUDIO.bossHitMinInterval ?? 0.12`.
- **README.md**: covers the mega door, boss, power-up rules vs the boss, stairs, levels, loop,
  the new guns and the new debug hooks.

## Acceptance (Section 5) — browser run-through

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Mega door blocked until all 5 doors open | PASS | Prompt `MEGA DOOR — open all doors first`, `blocked`, grey (`cant-afford`). Interact spent 0 and did not open. |
| 1 | Buy via the real shop path, cost 250 | PASS | After `openAllDoors`: `Press F to open MEGA DOOR [250]`. Interact spent 250 and emitted `purchase:made {kind:'megadoor', cost:250}`. |
| 2 | Entering the arena seals, banner, bar, boss + minions | PASS | Walked north 0.33 s. Result: `sealed:true`, `boss:start {THE WARDEN, maxHp 5440 (=4000x1.36 at round 3), level 0}`, banner `BOSS: THE WARDEN`, bar shown, 1 boss + 4 minions. |
| 2 | Normal spawning stops; outside zombies stay | PASS | `rounds.suspended:true`. `toSpawn` stayed 11 for 7 s. The 2 outside normals remained. |
| 3 | Charge telegraph / dash / wall stop / recover | PASS | 30 s run: 4 `boss:charge` events. Phases telegraph, dash, recover and idle were all seen, including `charge.wall = true` (a wall stop). The boss stayed in the arena. |
| 3 | Summons every 12 s, cap 10 | PASS | Max 10 live minions, 10 spawned. Minion radius 10, speed 235, hp 158 (45 % of 350), damage 25. |
| 3 | Insta-Kill on boss = 5 % | PASS | A 30-damage hit under Insta-Kill took 0.05 x maxHp, and the boss stayed alive. |
| 3 | Nuke = 10 % to boss, minions die | PASS | The boss took 0.10 x maxHp. Live minions went from 10 to 0. |
| 3 | Thundergun near 15 % + 60 px, far 40 px, no stun | PASS | Near: 0.15 x maxHp, pushed exactly 60 px on a clear line (54 px when it hit a pillar). Far: 0 damage, 40 px. Stun 0 in both. |
| 4 | Boss kill: +200, Max Ammo, minions die free, door unseals, stairs open, banner, rounds resume | PASS | Points +200 exactly, from 10 via player.js and 190 via boss.js. The 4 minions died with cause `debug` and paid 0. One `maxAmmo` item dropped. `megaDoor.open`, `!sealed`, `stairs.open`. `round:end`, then phase `break`. `suspended:false`. Banner `STAIRS OPENED`, bar hidden. |
| 5 | Stairs prompt, fade, level 2 | PASS | Prompt `Press F to descend`, then interact. The transition swapped at t = 0.6 (bunker at t = 0.3, catacombs after swap) and cleared at 1.2. `level:descend {0->1}`, `level:start {1, CATACOMBS}`. |
| 5 | Catacomb look, torches, new layout | PASS | Screenshot: brown checker floor with bone flecks, red-brown brick walls, amber torches, amber tint. |
| 5 | Doors closed, box reset, points/weapons/health/round kept | PASS | 5 doors closed, box idle, 0 zombies. Points 5110 before and after, health 150, weapons `[mr6, raygun]`, round 3 in a fresh break. HUD label `L2 CATACOMBS`, banner `LEVEL 2 — CATACOMBS`. |
| 6 | Level 2 walls sell new guns 200–350 | PASS | Wall buys: hvk30, weevil, marshal16, manowar, haymaker12, xr2, dredge48, gorgon, drakon. Weevil bought through interact for 200. |
| 6 | Zombies tougher/faster | PASS | Round 3 hp is 525 on L2 vs 350 on L1 (x1.5). Speed is x1.1, and the sprintShift of 3 gives mostly joggers at round 3. |
| 6 | Level 2 boss named | PASS | `THE BONE PRIEST`, maxHp 8160 (=4000x1.5x1.36), 5 minions per wave (4 + levelIndex). Kill paid exactly +200. |
| 6 | Stairs from L2 lead to L3 (L1 layout, loop scaling) | PASS* | Index 2, loop 1, `bunker` layout, doors reset, difficulty `{health 1.4, speed 1.05, count 1.15, sprintShift 3}`. Round 3 zombie hp 490. *See Findings 1. |
| 7 | Restart returns to L1 clean, no duplicated listeners | PASS | Restarted from level 2 mid-boss fight, then 2 more restarts. Result: index 0, bunker, boss idle, round 0, 0 points, mega door and stairs closed. A zombie kill paid exactly 10 and a boss kill exactly 200. Death during the fight led to game over, and Enter restarted at L1 with `suspended:false`. |
| 8 | `npm test` green | PASS | 370/370. |
| 8 | Zero console errors | PASS | A console.error/error hook ran through the whole run and caught nothing. `read_console_messages` found no errors after a fresh reload and a full L1 to L2 debug run. |
| 8 | Frame cost < 3 ms (boss + 10 minions + 24 zombies) | PASS | 0.41 ms per `step(1/60)` (update + render + HUD), averaged over 300 frames with the player moving and firing. |

## Findings for QA / Phase 4

1. **Loop difficulty dips at level 3.** Level 3 is loop 1 of level 1's base, so `healthMult` is
   1 x 1.4 = 1.4. That is below level 2's 1.5, and count (1.15 < 1.25) and speed (1.05 < 1.1) are
   also lower. This follows 1.3 literally: the loop factors multiply the looped level's base. It is
   harder than level 1 but slightly easier than level 2.
   - Balance QA should decide whether the loop factors should multiply the base of the last level
     instead, or whether that is intended.
   - Level 3 uses the BUNKER theme again, because there are only two themes.
   - **Resolved (FIX-1):** difficulty now compounds on the previous level per descent
     (`LEVELS_CFG.loop` 1.2 / 1.1 / 1.03 capped 1.15 / +2), and loop levels get a derived theme and
     numbered names ("BUNKER II", "THE WARDEN II"). See `docs/notes/level.md` "WO5 FIX-1".
2. After an index-0 `startLevel` at boot, `level:start` reaches no listener, because it runs before
   `initAll`. HUD and audio ignore index 0 anyway.
3. The screenshots are 0.5-scale captures (784x368), converted to PNG.

## Screenshots
- `docs/screenshots/wo5-megadoor-blocked.png`: prompt blocked, doors still closed.
- `docs/screenshots/wo5-megadoor-buyable.png`: all doors open, `Press F to open MEGA DOOR [250]`.
- `docs/screenshots/wo5-boss-fight.png`: THE WARDEN bar, sealed mega door, boss, minions.
- `docs/screenshots/wo5-stairs-opened.png`: open stairs with the DESCEND plate, `Press F to descend`.
- `docs/screenshots/wo5-level2-catacombs.png`: catacomb theme, torches, L2 label.
- `docs/screenshots/wo5-level2-wallgun.png`: Weevil wall buy just purchased (48/288).

## FIX-1 (WO5 QA fixes: level progression)
- `src/level.js`: monotonic `levelDifficulty`, loop variants (`loopTheme`, `romanNumeral`, derived
  memoized defs), arrival heal + `LEVELS_CFG.arrivalBreak` first break on index > 0.
- `src/main.js` `update()`: active power-up expiries shifted by `dt` during `state.transition`.
- `src/levels/level1.js`: Argus (42,29) -> (38,29), out of interact range of the arena.
- `src/config.js` `LEVELS_CFG`: new `loop` values + `speedMultCap`, `arrivalBreak: 10`.
- Tests: `tests/level.test.js` (difficulty, monotonic, variants, arrival), `tests/levels.test.js`
  (no interactable within 2 tiles of the arena). `npm test` green.

## Final verification (post Phase 4)

I ran this pass once in a new Chrome tab at `/?debug=1` (`python -m http.server 8181`), driving the game through `__game.debug.step(1/60, 1/60, overrides)`.
- God mode was off for every fight. The only helpers used were `addPoints`, `giveWeapon` and `skipToRound`.
- I bought every door, the mega door, the stairs and the wall gun through the real `interact` path, after teleporting next to each one.
- I fought both bosses with real aimed fire from a scripted kiting bot.
- `npm test`: 386/386 before and after this run. No code changed in this pass, because I found no regression.

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Mega door blocked until the 5 doors are open; costs 250 | PASS | `MEGA DOOR — open all doors first` (blocked), and interact spent 0. The doors took 75/100/100/125/150 through interact. The mega door then showed `Press F to open MEGA DOOR [250]`, spent 250 and emitted `purchase:made {megadoor, 250}`. |
| 2 | Entering the arena: seal, banner, bar, boss + first wave, spawning stops | PASS | I walked in at 60 HP. The door was `sealed`, the banner read `BOSS: THE WARDEN` and the bar showed. There was 1 boss plus 4 minions, `rounds.suspended`, and the 2 outside zombies stayed. |
| 3 | Full heal at fight start | PASS | 60 -> 150 HP on `boss:start` (both levels). |
| 4 | Red charge lane | PASS | A pulsing red lane with chevrons runs from the boss to the aim point, and the body has a red outline (`wo5-final-charge-lane.png`). The boss charged several times over the fight, with telegraph -> dash -> recover. |
| 5 | Minion look | PASS | Small near-black purple bodies with a red outline and red eyes on the L1 grey floor (checked zoomed in). |
| 6 | Mid-fight Max Ammo at 50 % | PASS | `boss.midDrop` flipped at hp 3506/7200 (48.7 %), and one `maxAmmo` spawned at the boss position (R5 attempt). The R3 run that won also dropped one. |
| 7 | Boss death: +200, Max Ammo visible, door unseals, stairs, banner, rounds resume | PASS | THE WARDEN (R3, 6120 HP) died to KN-44 + Ray Gun fire. Points went 2280 -> 2480 (exactly +200), and `boss:defeated` fired. The mega door is open and unsealed, the stairs are open, the banner read `STAIRS OPENED`, the bar is hidden and `suspended:false`. Both Max Ammo items were on the floor. The death drop is drawn on top of the boss pool once the 2 s corpse animation ends (`wo5-final-boss-death-maxammo.png`). *Note:* during the 2 s dying animation the corpse covers the drop, which sits at its centre. The round was still `active` after the kill because 2 outside zombies were alive; that is the `endRoundNow` contract, and the round ends when they die. |
| 8 | Descent: arrival heal, 10 s break, power-up timer kept | PASS | Stairs prompt, interact, fade, then `level:descend {0->1}` and `level:start CATACOMBS`. HP went 80 -> 150 and the break timer read 9.88 s (10 s minus 0.12 s stepped after the fade). Insta-Kill had 11.80 s left before and 11.67 s after, so only the time after the fade was used. Points, weapons, ammo and round 3 were kept. The doors were closed, the box idle and there were 0 zombies. The banner read `LEVEL 2 — CATACOMBS` and the label `L2 CATACOMBS`. |
| 9 | Level 2 look + new gun, clearly faster than KN-44 | PASS | Catacomb floor, brick walls, torches and amber tint. I bought the Gorgon for 300 at the wall through interact (`wo5-final-level2-gorgon.png`). TTK on a stationary L2 R4 zombie (675 HP) at 200 px, 5 trials each: Gorgon 24-30 frames (0.40-0.50 s), KN-44 48-52 frames (0.80-0.87 s), about 0.57x. |
| 10 | Level 2 boss | PASS | `THE BONE PRIEST`, maxHp 9990 (= 4500 x 1.5 x 1.48 at R4), 5 minions per wave. It was killed with Gorgon + KN-44 fire in about 30 s, taking 2 minion hits, and `boss:defeated {level:1}` fired. My first attempt died after 5.6 s (a weak bot, not a bug), and the game over and restart were clean. For the winning attempt I reloaded L2 with `setLevel(1)` and then bought the doors and entered the arena normally. |
| 11 | Level 3 "BUNKER II", distinct theme, harder than L2 | PASS | Stairs interact led to `level:start {2, BUNKER II, loop 1}`, the label `L3 BUNKER II` and the banner `LEVEL 3 — BUNKER II`. The theme is teal-slate checker with dark slate brick, distinct from both earlier levels (`wo5-final-level3-bunker2.png`). The boss is named `THE WARDEN II`. The difficulty went from `{1.5, 1.1, 1.25, 3}` on L2 to `{1.8, 1.133, 1.375, 5}` on L3. At R4 a zombie has 810 HP vs 675, mean speed is 175.5 vs 138.0 px/s (tiers 1/9/10 walk/jog/sprint vs 7/7/6), and the round count is 25 vs 23. |
| 12 | Restart from level 3 returns cleanly to level 1 | PASS | After the restart: index 0 `BUNKER`, difficulty `{1,1,1,0}`, round 0, 0 points, `[mr6]`, boss idle, mega door and stairs closed, 0 doors open, no power-ups, label `L1 BUNKER`. An MR6 kill paid exactly 10, with 1 `points:changed` event, so no listeners were duplicated. |
| 13 | Zero console errors | PASS | A `console.error`, `error` and `unhandledrejection` hook ran for the whole run and caught nothing. `read_console_messages` (errors only) showed none, including after a fresh reload. |
| 14 | Frame cost < 3 ms with boss + 10 minions + 24 zombies | PASS | I held the counts at 1 / 10 / 24 with the player moving and firing, and timed each `step(1/60)` (update + render + HUD). Over 300 frames the mean was 0.53 ms, the median 0.30 ms and p95 1.0 ms; over 600 frames the mean was 0.60 ms. A few frames spiked at irregular positions (for example frames 304, 386 and 579: 22, 11 and 77 ms). They did not repeat at the same frame, which looks like browser GC or the automation host rather than game work. |
| 15 | `npm test` | PASS | 386/386. |

Screenshots (full-window captures converted to PNG):
- `docs/screenshots/wo5-final-charge-lane.png`: THE WARDEN telegraphing, with the red lane and chevrons toward the player, bar, sealed door, mid-fight MA on the floor.
- `docs/screenshots/wo5-final-boss-death-maxammo.png`: after the kill, both Max Ammo drops, the boss pool, the open stairs (`DESCEND`) and `Press F to descend`.
- `docs/screenshots/wo5-final-level2-gorgon.png`: L2 CATACOMBS with the Gorgon just bought and in hand.
- `docs/screenshots/wo5-final-level3-bunker2.png`: L3 BUNKER II theme and label.
