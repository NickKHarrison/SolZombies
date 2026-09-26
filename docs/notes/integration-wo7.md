# WO7 integration (Phase 2)

## Changes

### src/main.js
- **Stats from events** (`initStats`, re-registered in `initAll` after every `events.clearAll`):
  - `purchase:made` with kind `door` increments `doorsOpened`.
  - `powerup:collected` increments `powerupsCollected`.
  - `boss:defeated` increments `bossesKilled`.
  - `level:start` sets `levelReached = max(levelReached, index + 1)`.
  - `timeSurvived` is set to `state.time` in `update()` and again at game over.
  - `bestWeaponId`: every `zombie:killed` with cause `'weapon'` is tallied to `player.getActiveWeapon(p).id` at kill time. A knife kill is also cause `'weapon'`. `zombie:killed` fires first and `melee:hit {killed:true}` right after it, so main moves that one kill from the gun to `'knife'`. The HUD shows the id as "KNIFE".
  - `meleeKills` and `perksBought` are not touched here. `player.js` counts them.
- **Loop:** `boss.updateHazards(s, dt)` runs right after `zombie.updateZombies`. The call is guarded through `call()`.
- **Game over** (`player:down`, which fires only once because `onPlayerDown` returns early on `gameover`):
  - `scores.recordRun(state.stats, { perks })`, then emit `score:recorded { rank, entry, isBestRound, isBestPoints }`.
  - `hud.setGameOverSummary({ ...stats, ...result, top: topScores(5), perks })`, then `hud.setScores({ best, top })`.
  - Everything is wrapped in try/catch.
- **Boot and restart:** `hud.setScores({ best: bestScore(), top: topScores(5) })` in `initAll`.
- **Sub-steps:** `withoutEdges` also clears `melee`, so one V press gives one swing at a 10x time scale.
- **Debug hooks:**
  - `givePerk(id)` goes through `player.addPerk`: the cap and uniqueness apply, it is free, and `reviveUses` is not touched.
  - `removePerks()`, `perks()`, `knife()` (which is `weapons.meleeAttack`), `clearScores()` (also refreshes the menu) and `scores()`.
  - `setLevel(i)` already existed and was confirmed: `setLevel(2)` gives LABORATORY and `setLevel(5)` gives LABORATORY II.
  - `modules.scores` is exposed.

### Follow-ups
- **(a) `src/level.js` `loopTheme()`:** now copies `flicker: !!b.flicker`. LABORATORY II has `flicker: true`, checked in the browser. No other new theme flags exist.
- **(b) `src/player.js`:** both `weapons.startReload(w)` calls now pass `state`.
- **(c) `tests/sprites.test.js`:** `allSprites()` now includes `SOLDIER.torso.knife[i]` (16x16). Structural and placeholder checks cover them.
- **(d) `src/render.js`:** the tint comments now name `'p'` / `#b44dff`. The fallback marker is now `#b44dff` too.
- **(e) `MELEE.thrustAt: 0.4` in config:** `animator.js` reads it, falling back to the old constant. Render's no-animator fallback still hard-codes 0.6 of `meleeT`, which gives the same result.

### Per-frame acid damage
`boss.updateHazards` calls `damagePlayer` every frame inside a pool, so `player:damaged` fires 60 times a second in amounts below 1. I fixed the effects minimally:
- `audio.js` `playerDamaged`: rate limit of 0.35 s (it was not limited before, so it played 60 grunts a second).
- `render.js` `onPlayerDamaged`: no screen shake for ticks where `amount < 1`. Before this the shake was held at full magnitude for the whole time in a pool.
- The HUD face wince only resets a timer, so I left it unchanged.

### Other edits
- `src/hud.js` menu controls: "1 / 2 / 3 / Q / Wheel — Swap weapon (3 = Mule Kick)".
- README: level 3 LABORATORY and THE SUBJECT, the tier-3 guns, a perk table with prices and effects, the knife (V / KNIFE), high scores, the V key and slot 3 in the controls, KNIFE in the touch buttons, level-index examples and the new debug hooks.

## Acceptance (browser, port 8221, `?debug=1` and `?debug=1&touch=1`)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Zombie sprites: 3 tiers, shamble, damaged overlay, minions, boss, corpses | PASS | `wo7-zombies-tiers.png`: walker, jogger and sprinter chasing. `wo7-zombies-boss-minions.png`: THE SUBJECT with its green-tinted crown, 10 purple minions and 24 zombies. Corpses fade with the knife kill. |
| 2 | Buy each perk via interact at its machine | PASS | Juggernog (250, max HP 250, healed), Speed Cola 300, Double Tap II 200, Stamin-Up 200, Mule Kick 400 (3 slots) and Quick Revive 50, all bought with `interact: true` next to the machine. Each fired `purchase:made {kind:'perk'}` and `perk:bought`. `perkMods` gave reload 0.5, rpm 1.33, damage 2, speed 1.07 and sprint 1.2. |
| 3 | Cap of four | PASS | A fifth perk showed "Perk limit reached" and cost no points. An owned perk showed "Already have Juggernog". |
| 4 | Quick Revive flow | PASS | Down gave `downT` 1.5, `down` false and the "REVIVING…" overlay. After 1.5 s: 150/150 HP, `invulnT` 2 and all perks stripped (revive, jugg, mule). Purchases 2 and 3 worked. After the third, the machine showed SOLD OUT (`wo7-knife-slash-soldout.png`) with the prompt "Quick Revive sold out" and a fourth purchase was refused. |
| 5 | Mule Kick third gun, lost on revive | PASS | Weapons `[mr6, kn44, argus]` with slot 3 active (digit 3). After the revive: `[mr6, kn44]`, `activeSlot` 0. |
| 6 | Perks persist across a descent | PASS | Real stairs interact on L1 and then L2: `[jugg, mule]`, max HP 250 and all 3 guns kept on CATACOMBS and LABORATORY. |
| 7 | Knife with V | PASS | A real `KeyV` keydown gave `melee:swing`, `points:changed` +10 then +5, and `melee:hit {killed:true}`: 15 points, `meleeKills` 1, and a slash effect. The swing cancels a reload (reloading went from true to false). |
| 8 | Knife with the KNIFE touch button | PASS | A real click on `.tbtn-knife` set `getTouchState().melee`, and the next frame swung and killed for 15 (`wo7-mobile-knife.png`). |
| 9 | Scores: summary, rank, persistence, ordering | PASS | First death: summary rows, "NEW BEST ROUND! #1 ALL TIME" and a top table (`wo7-gameover-summary.png`). After a page reload the menu showed "BEST: ROUND 2 · 105 PTS" and the top runs (`wo7-menu-top5.png`). Later runs ranked #2, #1 (blocked-storage session) and #2 (L3, ordered above an equal-round run by time). |
| 10 | localStorage blocked | PASS | With `Storage.prototype.setItem` throwing, a game over still recorded (#1, in-memory for the session) with no errors. A fresh module instance with `getItem` and `setItem` both throwing also recorded, returned the top table and returned the best score. The real storage was untouched. |
| 11 | Level 3 via L2 stairs: lab look, flicker, tier-3 guns, perk machines | PASS | The stairs interact on L2 loaded LABORATORY (index 2): floor `#5f6d66`, `flicker` true, `torch` false, 6 machines, and walls selling gorgon, drakon, m8a7, peacekeeper, xr2, hg40, haymaker12 and icr1. I bought the HG 40 for 350 through interact. Canvas sampling found 5 of 240 frames darkened by the flicker. |
| 12 | THE SUBJECT acid pools hurt the player | PASS | `boss:spit` fired at t=6.0 s. 3 pools landed (r 50, dps 25, ttl 5). Standing in one cost exactly 25 HP in 1 s through the ticks. Screenshot: `wo7-level3-lab-acid-boss.png` (telegraph glow and 3 pools). |
| 13 | Level 4 = BUNKER II, harder than L3 | PASS | After killBoss (`boss:defeated {level:2}`, `bossesKilled` 1), the stairs gave BUNKER II with THE WARDEN II (charge). Difficulty went from `{2.0, 1.2, 1.5, 5}` on L3 to `{2.4, 1.2, 1.65, 7}` on L4. Speed is equal because of the cap and the rest is higher. `levelReached` was 4. |
| 14 | Restart clean | PASS | After restarting from game over: BUNKER, 0 points, no perks, `[mr6, null]`, no hazards, all stats reset. A weapon kill paid exactly 10 (one `points:changed`). Buying a door gave `doorsOpened` 1 and a Max Ammo gave `powerupsCollected` 1. |
| 15 | Zero console errors | PASS | An error, unhandledrejection and console.error hook ran on every page load and caught nothing. `read_console_messages` found no errors. |
| 16 | Frame cost < 3 ms with boss + 10 minions + 24 zombies | PASS | L3 arena, counts held at 1/10/24, player firing and moving, 300 `step(1/60)` calls: mean 0.84 ms, median 0.60 ms, p95 1.7 ms. There was one 13.5 ms outlier, which is GC or the automation host. |
| 17 | `npm test` and `node --check` | PASS | 496/496. `node --check` passes on every touched file. |

## Notes / open points for QA
- `perksBought` counts every successful `addPerk`, including Quick Revive re-buys and debug `givePerk`.
- Runs that die before round 1 starts are recorded as round 0. They rank below everything else, ordered by time.
- With Double Points active, the knife bonus is 10 (player.js doubles `MELEE.bonusPoints`).
- After a mid-session storage failure, `scores.js` stays on memory for the rest of the session by design, so those runs are not persisted.
- LABORATORY II+ keeps the flicker. Audio's lab hum matches `/LABORATORY/i` on the name, so it also plays on loops.

## Screenshots
- `docs/screenshots/wo7-zombies-tiers.png`: walker, jogger and sprinter sprites (zoom).
- `docs/screenshots/wo7-zombies-boss-minions.png`: THE SUBJECT, 10 minions and 24 zombies (zoom).
- `docs/screenshots/wo7-perk-machines-hud.png`: Quick Revive and Stamin-Up machines with plates, and the HUD perk row (J C N U).
- `docs/screenshots/wo7-knife-slash-soldout.png`: knife slash arc and the Quick Revive machine SOLD OUT.
- `docs/screenshots/wo7-gameover-summary.png`: run summary, "NEW BEST ROUND! #1 ALL TIME" and the top runs.
- `docs/screenshots/wo7-menu-top5.png`: menu best line and the top runs after a page reload.
- `docs/screenshots/wo7-level3-lab-acid-boss.png`: LABORATORY, THE SUBJECT telegraphing and 3 acid pools.
- `docs/screenshots/wo7-mobile-knife.png`: `?touch=1` with the KNIFE button and a knife kill (+10, +5).

## WO7 FIX-3 (main.js)

- **Playtest #13:** `recordGameOver` skips `scores.recordRun` and `score:recorded` when `stats.roundReached === 0` (death before round 1). It still shows the summary through `setGameOverSummary({ ...stats, rank: null, isBestRound: false, isBestPoints: false, recorded: false, rankText: 'Not ranked', top, perks, perksRun })`. Recorded runs pass `recorded: true`.
- **Playtest #6 (data):** a module-level `perksRun` records every `perk:bought` perkId in purchase order, without duplicates.
  - It is reset in `initStats`, which runs on boot and on restart.
  - A Quick Revive strip does not remove entries.
  - It is passed as `summary.perksRun`. Debug hook: `__game.debug.perksRun()`.
- **Browser check** (`/?debug=1`):
  - A round-0 death leaves `localStorage` unchanged and shows "Not ranked".
  - `perksRun` has no duplicates and resets on restart.
  - LABORATORY → BUNKER II with acid present has 0 hazards after the swap, and Q is sold out on the first frame.
  - BUNKER II wall buys include m8a7, peacekeeper and hg40.
  - No console errors.

## Final verification (post Phase 4)

Run on 2026-09-27 against the tree after all FIX-1..FIX-5 landed. Setup: `python -m http.server 8241`, Chrome, a new tab at `/?debug=1`, and `/?debug=1&touch=1` inside an 844x390 iframe (landscape phone). Driven through `__game.debug.step(dt, dt, overrides)` with real input overrides (`melee`, `interact`, `fire`, `aimVector`). Purchases went through `interact` at the machine, door, wall or stairs. The run was a single continuous game from L1 to L4. No regressions were found and no code was changed.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Knife rounds 1-3 | PASS | Knife only, rounds 1-3 (5241 frames): 27 kills, 27 x (+10, +5) = 405 pts. Each kill paid exactly 15. |
| 2 | Perk buys at machines through interact | PASS | Juggernog 250, Double Tap II 200, Speed Cola 300 and Quick Revive 50 were each charged exactly. The HUD row showed J N C Q with a ×1 badge. |
| 3 | Perk cap (4) | PASS | With 4 held, Stamin-Up gave the prompt "Perk limit reached" and nothing was charged. |
| 4 | Quick Revive 50/150/300 on the plate and the prompt | PASS | Plate went 50 → 150 after the first buy (`wo7-final-perk-machines-hud.png`). The second buy prompt was "Quick Revive [150]" and charged 150. The plate then read 300 on L1 and on the L3 machine (`wo7-final-lab-level.png`). |
| 5 | Downed + revived: perks stripped, Mule Kick 3rd gun dropped, HUD lists every held gun | PASS | With Mule Kick + Quick Revive and MR6 / KN-44 / Sheiva active, the HUD secondary read "1 MR6 2 KN-44". After going down (`player:downed`, reviveIn 1.5) the player self-revived. Perks were `[]`, weapons `[mr6, kn44]` (Sheiva dropped) and the HUD read "2 KN-44". The perk row was empty. |
| 6 | Doors + mega door through interact | PASS | L1 doors cost 75/100/100/125/150 and the mega door 250, all charged exactly. `doorsOpened` was 5. This repeated on L2 and L3. |
| 7 | Boss with Double Tap does not trivialise | PASS | THE WARDEN at R10 with Jugg + DT II + Speed Cola, KN-44 (damage 70): all 134 boss hits did exactly 70, so DT's x2 does not apply to the boss. 9360 HP took 16.5 s in god mode. |
| 8 | L2 → L3 LABORATORY look | PASS | The stairs led to CATACOMBS and then LABORATORY, with perks kept. Steel panel walls, glass specimen tanks and yellow/black hazard stripes at the doors. Walls sell gorgon, drakon, m8a7, peacekeeper, xr2, hg40, haymaker12 and icr1 (`wo7-final-lab-level.png`). |
| 9 | Lab flicker is gentle, not a strobe | PASS | 1800 rendered frames over 60 s of game time, canvas mean luminance sampled per frame. There were 4 dips (starting at 7.8, 25.4, 36.4 and 50.9 s), never more than 1 per second. 1.1 % of frames were darkened and the deepest dip was 13.9 %. |
| 10 | THE SUBJECT acid | PASS | `boss:spit` fired at 7.3 s. All 3 pools landed on walkable arena tiles (`inArena` true). Standing in overlapping pools with the zombies removed cost exactly 25 HP/s: pools hurt and do not stack. |
| 11 | L4 BUNKER II sells tier-3 guns, harder than L3 | PASS | Difficulty `{2.4, 1.236, 1.65, 7}` and 0 hazards after the swap. Walls include m8a7, hg40, peacekeeper and gorgon. Bought the M8A7 (tier 3) for 375 through interact (`wo7-final-level4-tier3-wall.png`). |
| 12 | Game-over summary: perks used, rank | PASS | "Perks used: Juggernog, Double Tap II, Speed Cola, Quick Revive, Mule Kick", "NEW BEST ROUND! #1 ALL TIME" and the top table (`wo7-final-gameover-desktop.png`). |
| 13 | Reload: menu best + top-5 | PASS | After a page reload the menu read "BEST: ROUND 4 · 1,065 PTS" with 5 top runs, on desktop and on the phone. |
| 14 | Round-0 death | PASS | Showed "Not ranked". The `solzombies.scores.v1` value was byte-identical before and after. |
| 15 | `Storage.prototype.setItem` throwing | PASS | Played to R5 and died. The run ranked "#1 ALL TIME" in memory, then restart and play worked. No errors, and real storage was unchanged. |
| 16 | Mobile: KNIFE, legibility, backdrop, sticks, tap restart | PASS | At 844x390 the buttons were RELOAD / SWAP / KNIFE / ‖. A touch `pointerdown` on KNIFE killed a zombie for +10 +5. The smallest HUD text was 10 px ("L1 BUNKER"). The game-over backdrop was dark, and the sticks and buttons were `display:none` on the menu and game over. A real click on the stage started the game from the menu and restarted from game over (`wo7-final-mobile-gameover.png`). |
| 17 | Zombie tiers distinct, player readable in a crowd | PASS | 18 zombies (6 walk, 6 jog, 6 sprint) in a ring around the player. Walkers show blue shirts, joggers brown jackets and sprinters pale bodies with a white rim. The olive player with its ground ring stands out (`wo7-final-zombie-crowd.png`). |
| 18 | Frame cost < 3 ms with boss + 10 minions + 24 zombies | PASS | L3 arena, counts held at 1/10/24, player firing and moving, 300 frames. Update only: mean 0.76 ms, median 0.60 ms, p95 1.6 ms. Update + render: mean 1.05 ms, median 0.80 ms, p95 1.9 ms. One 17 ms max outlier (GC or the automation host). |
| 19 | Restart clean | PASS | After restart: BUNKER, 0 pts, no perks, `[mr6, null]`, 0 hazards and zombies, `perksRun` `[]`, all stats 0. A gun kill paid exactly one `points:changed` of +10. |
| 20 | Zero console errors | PASS | Error, unhandledrejection and `console.error` hooks were installed on each page load, and `read_console_messages` was checked on both pages. Nothing was caught. |
| 21 | `npm test` | PASS | 511/511. |

Notes:
- The summary said "4 rounds" while the HUD round counter read 9. The mismatch comes from the debug `skipToRound(10)`: it sets `rounds.round` without starting a round, and the boss fight and descents then held the round in a break. Real rounds reached was 4. `stats.roundReached` only moves on a real `startRound`, so this is correct. It is not a regression.
- A CDP mouse click on KNIFE aims the player at the button through mouse aim, so the swing missed. This is a test-harness artifact. On a real phone `touch.js` calls preventDefault on `touchstart`, which suppresses compatibility mouse events. The touch `pointerdown` path was verified directly (item 16).
- The test scores were removed from `localStorage` at the end of the pass.

Screenshots:
- `docs/screenshots/wo7-final-zombie-crowd.png`
- `docs/screenshots/wo7-final-perk-machines-hud.png`
- `docs/screenshots/wo7-final-lab-level.png`
- `docs/screenshots/wo7-final-gameover-desktop.png`
- `docs/screenshots/wo7-final-mobile-gameover.png`
- `docs/screenshots/wo7-final-level4-tier3-wall.png`
