# QA-1 Playtest report (Phase 3)

- Build under test: working tree at `D:\GitHub\Sol Game`, served with `python -m http.server 8081`.
- Browser: Chrome through the automation extension, `http://localhost:8081/?debug=1`, in a new tab.
- The automation tab reports `document.visibilityState === 'hidden'`, so rAF never ticks. Gameplay was advanced with
  `__game.debug.step(seconds, frameDt, inputOverrides)`, which calls the same `tick()` as the rAF loop.
- A small in-page bot aims at the nearest visible zombie and alternates fire. It drove rounds 1-5, rounds 1-3 again,
  round 10 and round 15.
- Real input was used where the tooling delivered it:
  - canvas click to start
  - F to buy a wall gun
  - 1 and Q to swap
  - Esc to pause and P to resume
  - left click to fire
  - Enter to restart
- Everything else went through `step` input overrides (`interact`, `interactHeld`, `fire`, `moveX`, `sprint`, `swap`, `reload`) or `__game.debug.*` hooks.
- Console: `read_console_messages` was armed before a full reload. A probe `console.warn` confirmed capture works.
  - The console stayed empty for menu, rounds 1-3, death, the real Enter restart and more play. The probe was the only message.
  - `console.error`/`console.warn` were also wrapped in page and recorded nothing across the whole session (about 20 simulated minutes).
  - There were no `[main] frame error` messages.

## Findings

1. **Major: attacking zombies stack on top of each other, and an unlimited number can attack at once.**
   - Where: `src/zombie.js`. `updateAttacking` (no movement or separation) and `updateChasing` (separation force 120 is weaker than sprint speed 210).
   - Repro:
     1. Run `__game.debug.god(true); __game.debug.skipToRound(15)`.
     2. Step until 24 zombies are alive with the player standing in the hub.
     3. Measure the pairwise distances of the zombies that are not dying.
   - Expected: zombies keep roughly `separationRadius` (26 px) apart and form a readable crowd, so only the front ring can reach the player.
   - Actual: at round 15, 27 zombie pairs are closer than 14 px (one pair is 0.1 px apart) and 60 pairs are closer than 28 px.
     - All 24 zombies were in `attacking` mode within 44-47 px of the player, drawn as one blob.
     - In a mortal run at round 3, six zombies took the player from 150 hp to down in 106 frames (1.77 s).
     - The screenshot at round 15 shows one clump of overlapping circles with stacked debug labels.
   - Clause: 5.5 behavior step 2, "Add separation steering from other zombies within `separationRadius`". It is only applied while
     chasing, and chasing zombies override it, so crowds collapse. It also works against 5.10 readability and the Section 6
     expectation of a fair "takes 50 per hit" pace.
   - Suggested fix: keep separation while `attacking` (or make zombie-zombie contact a hard constraint), or cap simultaneous attackers.
   - **Resolution (FIX-1):**
     - Separation steering now also runs while `attacking`.
     - Chasing zombies stop pushing into zombies they are touching.
     - A capped positional overlap pass keeps zombies in the play area from overlapping: `separationMinDist` 28, 2 passes, then `resolveCircle`.
     - The crowd forms a ring. About 10 zombies fit at attack range, so geometry limits the number of attackers and no explicit cap was needed.
     - A test checks that 24 converging zombies never come closer than 1.5 x radius. In 900 s headless runs, pairs under 21 px dropped from about 13% of samples to 0.

2. **Minor: two zombies on one window tear 2 boards per second.**
   - Where: `src/zombie.js` `updateTearing`. Every zombie in the pocket calls `tearBoard` on its own timer.
   - Repro: at round 1, both zombies spawned at spawn point 1. The `barricade:board {by:'zombie'}` log shows boards 3→2 at t=6.02 and
     t=6.03, and 1→0 at 7.02 and 7.03.
   - Expected: according to the checklist ("Zombies tear boards one at a time"), a window loses boards one at a time.
     BO3 allows several zombies on one window, so this may be intended.
   - Actual: tear rate scales with the number of zombies in the pocket.
   - Clause: Section 6, "Zombies tear boards one at a time and enter when boards hit 0". The wording is ambiguous, so the
     integrator should decide.
   - **Resolution (FIX-1, lead decision):** only one zombie tears a barricade at a time.
     - The other zombies queue in the pocket.
     - When the tearer gets through or dies, the next one takes over with a fresh tear clock.
     - A window therefore loses at most one board per `boardTearTime`. A test was added.

3. **Minor (visual): wall-buy chalk art is hard to read.** `src/render.js` (wall-buy drawing)
   - Repro: start a game and look at any wall buy, e.g. Sheiva above the hub or RK5 and KN-44 on the vertical walls, or zoom a screenshot.
   - Expected: the chalk outline of the weapon plus its name and price are readable (5.10).
   - Actual: the gun outline is drawn over the name text, so letters are crossed by strokes ("SHEIVA", "ARGUS").
     - The font is very small (about 6-7 px at 1280x720).
     - On vertical walls the text is rotated 90°, and the name and price are close to unreadable without zooming.
     - The price in yellow is the only easily legible part.
   - Clause: 5.10, "chalk-white weapon outline text rotated onto the wall with the name and price".
   - **Resolution (FIX-3, Phase 4):** the wall tile shows a chalk gun silhouette by weapon class. The name and price are a horizontal bold 12px label on a dark plate, placed on each open floor side of the wall and kept in the static layer. See docs/notes/render.md "Phase 4 fixes".

4. **Minor (visual): the mystery box spin label is small and hidden by the player.** `src/render.js` (box drawing and draw order)
   - Repro:
     1. Stand at the box.
     2. Spin it (`interact`).
     3. Step 1 s and screenshot.
   - Expected: the cycling weapon name is visible while `spinning` (5.10).
   - Actual: the name is drawn in a small label directly above the box, where the player stands to use it, so the player circle covers the middle of the text ("Boo..ge..").
     Drawing the label higher, or after the player, would fix it.
   - Clause: 5.10, "box (wooden box with glowing `?`, spinning weapon name while `spinning`)".
   - **Resolution (FIX-3, Phase 4):** the label is drawn after the player: bold 17px on a backing plate, 44px above the box, and it flips below when the player is above. While offering it turns gold and shows a countdown bar.

5. **Minor (visual): damage vignette and Zombie Blood tint together cover the whole screen.** `src/render.js` (vignette and tint)
   - Repro:
     1. Pick up Zombie Blood.
     2. Take 100 damage (`__game.debug.damagePlayer(100)` with god off).
     3. Screenshot.
   - Expected: the red edge vignette, plus a 25% orange tint.
   - Actual: at 50/150 hp with Zombie Blood active, almost the entire viewport is saturated red. Zombies and the layout are hard to
     see, and only the hub centre stays partially visible.
     - Each effect alone looks fine (the vignette at 100/150 is a tasteful edge).
     - This is expected from the spec formula (`alpha = 1 - hp/max`) but hurts readability at low health.
   - Clause: 5.10, damage vignette (cosmetic tuning only).
   - **Resolution (FIX-3, Phase 4):** both overlays are elliptical edge-only vignettes and the centre stays clear. The damage alpha is `(1-hp/max)*0.7`, times 0.6 under Zombie Blood. Zombie Blood is now a 6% flat orange tint plus an orange edge vignette, down from the 25% flat tint.

No blockers were found. No console errors or warnings appeared at any point.

### Observations that are not defects (for context)
- Tooling: the extension sometimes drops real clicks and keys after a page reload. No DOM events reached the page, and the page
  recovered after a screenshot. Real mouse-wheel scroll from the tool never reached the canvas. A synthetic `WheelEvent` on the
  canvas swapped weapons correctly, so wheel swap works.
- Holding keys (WASD, Shift, holding F) cannot be done with the tool, so those were driven through `step` overrides. Movement speed
  was 220 px/s walking and 297 px/s sprinting (1.35x). Sprint was cancelled while firing (220 px/s, `sprinting=false`).
- HUD turns the **magazine** red at 0 as well as the reserve. This is an addition, not a contradiction of 5.11.
- `skipToRound(1)` after a higher round lowers `stats.roundReached`, so game over said "1 ROUND". This happens only with the debug hook, as the spec says.
- Nuke and Carpenter bonuses have no floating `+N` because their `points:changed` carries no x,y. This is allowed by 5.7 ("when provided").
- Only 10 of the 13 `WALLBUY_MAP` guns are placed on the map (VMP, Vesper and Pharo have none). This is within the "8-10 wall buys" in 5.1.
- Ray gun self-splash: firing at a wall 14 px away cost the player exactly 30 hp. The explosion renders.
- Real mouse aim scaling is correct: a click at screen x=1000 mapped to canvas x=850.5 with the CSS-scaled canvas.

## Section 6 checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Zombies spawn at multiple windows and both open spawns across a round | PASS | Spawn point ids 1-10 were all used across rounds 1-10, including open spawns 9 and 10. Round 10 alone used 3-10. |
| 2 | Zombies tear boards one at a time and enter at 0 | PASS (see finding 2) | One board per `boardTearTime` (1.0 s) per zombie with `by:'zombie'`. Zombies switch to `chasing` at 0 and reach the hub. The player is blocked by a window whether it has 6 or 0 boards. |
| 3 | Round advances only after the last zombie dies, after an 8 s break | PASS | `round:end` → `round:start` gap is 8.02 s every time: 32.88→40.90, 100.17→108.18, 345.35→353.37, 410.38→418.40. |
| 4 | Round 10 spawns 29 zombies, health and speed scale | PASS | 29 spawned. hp 1045 at round 10 and 1683 at round 15, both matching `healthForRound`. Round 10 tiers were 5 walk, 11 jog and 13 sprint, with speeds 63-230. Round 15 numeral "15" rendered in red serif. |
| 5 | Each kill +10 (+20 under Double Points) with floating +10 | PASS | 49/49 kills paid exactly 10 in rounds 1-5, and 20 each under Double Points. Floating `+10`/`+20` text effects were confirmed in the render and in screenshots. |
| 6 | Power-ups drop rarely, blink before vanishing, all 8 work per 5.8 | PASS | 1 natural drop in 49 weapon kills (Double Points), which expired after 30 s. Canvas pixel sampling confirmed the blink below ttl 10. Re-pickup reset Double Points from 20 s to 30 s, and `powerup:expired` fired. |
| 7 | Nuke: stagger, white flash, +40, 3 s spawn pause | PASS | 12/12 zombies killed at 0.08 s intervals with cause `nuke` and no drops. Flash effect ttl 0.5 and shake 8. +160 = 40 + 12×10. `pausedUntil` = t+3.02 with no spawns in the window. |
| 8 | Carpenter restores every board, +20 | PASS | All 8 barricades went from 2 to 6 boards. 8 `by:'carpenter'` events and +20. |
| 9 | Fire Sale box price 10 for 30 s | PASS | The prompt showed "Press F for Mystery Box [10] FIRE SALE" and the spin charged 10. The FIRE SALE! banner and chip appeared. After 30 s the price was back to 95. |
| 10 | Death Machine 30 s, infinite ammo, then returns gun | PASS | Active weapon was `deathmachine` and the HUD showed ∞. Swap and slot were blocked. 40 shots in 2 s at 1200 rpm with no reload. Max Ammo during it was harmless. After 30 s the previous gun returned: Haymaker in one run, and a Sheiva bought during the Death Machine in another. |
| 11 | Zombie Blood: wander and ignore player 30 s | PASS | All zombies outside the pockets were `wandering` from the next frame. 0 damage in 28 s with god off. They went back to `chasing` after expiry, and the orange tint rendered. |
| 12 | Max Ammo fills reserves of both guns, not the magazine | PASS | `kn44 3/0, icr1 3/0` became `kn44 3/240, icr1 3/240`. |
| 13 | Every wall buy sells at listed price, then ammo at half | PASS | All 10 wall buys charged their listed price: lcar9 75, bootlegger 100, sheiva 50, kn44 150, rk5 50, krm262 75, argus 150, kuda 125, hvk30 125, icr1 150. Ammo cost 38/50/25/75/25/38/75/63/63/75. The real F key bought the Sheiva. At full reserve the prompt said "ammo full". All wall buys and the box are reachable from the start by player BFS. |
| 14 | Two-slot inventory, third purchase replaces active, swap works | PASS | 10 purchases in a row kept `[mr6, <latest>]` and replaced the active slot. Real `1` gave slot 0 and real `Q` gave slot 1. Wheel works with a synthetic event (the tool's wheel did not arrive). Swapping cancelled a reload. |
| 15 | Box spins 3 s, offers 10 s, charges correctly, never offers held gun | PASS | Spinning to offering took 3.02 s and offering to idle 10.00 s, and an unclaimed offer was lost. Over 60 spins the charge was always 95 and no offered gun was already held. 15 weapon names cycled during the spin, and the ray gun appeared in the cycle. |
| 16 | Barricade rebuild pays 1 per board up to 10 per round | PASS | The first window paid +6 and the second +4 for the remaining boards. The third paid 0 while `boardsThisRound` kept counting. 0.8 s per board. |
| 17 | 50 per hit, regen after 4 s, down at 0, game over stats, Enter restarts cleanly | PASS | `player:damaged {amount:50}`. Health stayed at 100 for 4.0 s, then regen started at 60/s. Down at 0, with no damage events after going down. Game over showed "YOU SURVIVED N ROUNDS", kills, points earned and accuracy. After a real Enter restart: round 0, 150 hp, MR6 only, and 6/6 kills paid exactly +10 (no doubled listeners). |
| 18 | Pause works | PASS | Real Esc gave `paused`, 0 s advanced over 2 s of steps, and the PAUSED overlay showed. Real P resumed. |
| 19 | Sound for shots, kills, power-ups, round changes, no autoplay errors | PASS (not heard) | One AudioContext was created on the real click start and was `running`. Oscillator and buffer nodes were created on each shot, kill, power-up and round event. There were no autoplay warnings. Audio output could not be heard by automation. |
| 20 | 60 fps at round 15 with 24 zombies | NOT VERIFIABLE (partial) | rAF does not run in the hidden automation tab. With 24 zombies (23 on screen) and 200 effects, a full update plus render tick cost 0.5 ms median and 1.1 ms p95 of CPU. One 50 ms outlier looked like GC or first-frame. A flow-field rebuild took 0.074 ms. The budget looks fine, but real fps and GPU cost need a visible-tab check (QA-3). |

Also verified: the served page loads with zero console errors from the menu through round 3, a death and a restart (Section 6, bullet 2).

## Visual check (screenshots)
- The menu is clean and readable: red serif title and a controls list.
- The map reads well: dark floor with a subtle grid, black walls with light edges, near-black spawn pockets, and an 8-window layout with a corridor, courtyard and bunker.
  - Barricades show brown planks, and damaged windows visibly lose planks (3-board and 6-board windows side by side are clearly distinguishable).
  - The box is a small wooden crate with a cyan `?`.
- HUD:
  - Points are large yellow digits at the bottom left, with +N flicks.
  - Weapon, mag/reserve and the small second slot sit at the bottom right. RELOADING pulses red.
  - Round tallies ("I", "II") are at the left centre, becoming the numeral "15" in red serif italic. They brighten during breaks.
  - Power-up chips at the top centre show a countdown.
  - The prompt at the bottom centre greys out when blocked.
- Zombies are tier-coloured circles: walk and jog are green, sprint is orange-brown. Dying zombies fade.
- Power-ups are green glowing rounded squares with initials (IK, NU, MA) and are easy to spot.
- Weak spots: findings 1 and 3-5.

## Final verification (Integrator, after Phase 4 fixes)

- Build: working tree after FIX-1/FIX-3 (zombie.js, map.js, render.js, weapons.js, powerups.js, config.js), served with `python -m http.server 8084`, Chrome, `http://localhost:8084/?debug=1` in a new tab.
- The tab was hidden (no rAF), so play was advanced with `__game.debug.step`, driven by the same aim-and-fire bot. The game was started with a real canvas click and restarted with a real Enter key.
- Console: `read_console_messages` was armed before a full reload, and `console.error`/`console.warn`, `window.onerror` and `unhandledrejection` were wrapped in the page. Across menu, rounds 1-3, death, restart and about 40 simulated minutes of further checks, there were zero messages and no `[main] frame error`.
- `npm test`: 163/163 pass. `node --check` passes on every `src/*.js`.
- **Regressions found: none. No code changes were made in this pass.**

### Targeted confirmations
- **Crowd ring (FIX-1):** at round 15 with 24 zombies alive and all inside, the minimum zombie-zombie distance was 28.0 px, and 0 pairs were under 21 px (previously 27 pairs under 14 px).
  - 8 zombies were attacking at once. Distances to the player were spread over 28-104 px. 28 px is radius+radius, so zombies touch the player but do not overlap.
  - The screenshot shows a readable ring of distinct circles around the player.
  - The same pattern appeared in a round 2 mortal run: 6 attackers spread around the player at about 47 px.
- **One tearer per window (FIX-1):** 4 zombies were spawned at each of three windows. `barricade:board {by:'zombie'}` events were exactly 1.00 s apart on every window (6→0 over 5 s), with no double tears.
- **Zombie Blood, then Carpenter:** 4 trials at rounds 5-8. Zombie Blood was collected while zombies were tearing or in pockets, then Carpenter was collected while 1-2 zombies were still outside in pockets.
  - Every round still ended, in 55-70 simulated seconds with the bot.
  - No zombie was left stuck in a pocket. The zombies left outside went back to tearing the restored boards.
- **All 8 power-ups:** each of the 8 was collected and applied.
  - instaKill: active, 30 s.
  - doublePoints: 20 per kill.
  - maxAmmo: `mr6 3/80, kn44 3/240`, magazines untouched.
  - nuke: 9 kills with cause `nuke`, 0 left alive, spawn pause 3.0 s.
  - carpenter: all 8 windows went from 1 to 6 boards.
  - fireSale: price 10, back to 95 after 30 s.
  - deathMachine: 60 shots in 3 s with no reload, then KN-44 returned.
  - zombieBlood: all zombies outside pockets `wandering`, 0 damage in 28 s with god off, back to `chasing` after expiry.
  - Timed ones fired `powerup:expired`. A floor drop blinked in its last 10 s and was gone at 30 s.
  - Nuke and Carpenter bonuses were doubled because Double Points was still active: +260 = 2×(40+9×10) and +40. This is consistent with Double Points doubling all income.
- **MR6:** `damage 50, mag 8, reserve 80` on a new game and after restart (8/80).
- **Points:** in rounds 1-3 all 27 kills paid exactly +10 (270 on game over). Under Double Points, 4/4 kills paid exactly +20.
- **Restart:** after a real Enter: round 0, 150 hp, MR6 8/80, 0 points. The next 5 kills gave 5 `points:changed` events of +10, totalling +50, so points did not double.
- **Legibility (screenshots):** wall-buy labels (SHEIVA 50, KN-44 150, RK5 50, KRM-262 75, ARGUS 150, ICR-1 150) are crisp bold plates beside the chalk gun icons, including on vertical walls. The box spin label ("DRAKON") is on a plate below the box, because the player stood above it, and is fully visible.

### Section 6 checklist (final)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Spawns at multiple windows and both open spawns across a round | PASS | Round 11 used spawn ids 1-10. Rounds 12 and 13 each used both open spawns 9 and 10. |
| 2 | Tear boards one at a time, enter at 0 | PASS | One board per 1.00 s per window with 4 zombies queued. Zombies go `chasing` and `inside` at 0. |
| 3 | Round advances only after last kill, 8 s break | PASS | `round:end` to `round:start`: 28.15→36.17, 202.62→210.63, 245.02→253.03. |
| 4 | Round 10 = 29 zombies, scaling | PASS | 29 spawned in round 10, hp 1045. |
| 5 | +10 per kill (+20 Double Points) | PASS | 27/27 and 5/5 kills paid +10. 4/4 paid +20 under Double Points. |
| 6 | Power-ups rare, blink, all 8 work | PASS | See "All 8 power-ups" above. |
| 7 | Nuke stagger, flash, +40, 3 s pause | PASS | 9 nuke kills, +40 bonus (doubled while Double Points was active), 3.0 s spawn pause. |
| 8 | Carpenter restores all boards, +20 | PASS | All 8 windows at 6 boards. |
| 9 | Fire Sale box 10 for 30 s | PASS | 10, then 95 after 30 s. |
| 10 | Death Machine 30 s, infinite ammo, returns gun | PASS | 60 shots in 3 s with no reload. KN-44 returned after 30 s. |
| 11 | Zombie Blood wander 30 s | PASS | All zombies outside pockets `wandering`, 0 damage in 28 s, `chasing` afterwards. |
| 12 | Max Ammo fills reserves, not magazine | PASS | `3/0` became `3/80` (MR6) and `3/240` (KN-44). |
| 13 | Wall buys at price, then ammo at half | PASS | lcar9 75/38, bootlegger 100/50, sheiva 50/25, kn44 150/75, rk5 50/25, krm262 75/38, argus 150/75, kuda 125/63, hvk30 125/63, icr1 150/75. |
| 14 | Two-slot inventory, replace active, swap | PASS | Slots stayed `[mr6, <latest>]` through 10 buys and box takes. |
| 15 | Box 3 s spin / 10 s offer, charge, no held gun | PASS | `offering` at 3 s, `idle` after 10 s. 40 spins all charged 95, and 0 offered a gun already held. |
| 16 | Rebuild pays 1 per board, cap 10 per round | PASS | +7, then +3, then +0 while `boardsThisRound` kept counting. |
| 17 | 50 per hit, regen after 4 s, down, game over, clean restart | PASS | Every hit was 50. Health held at 100 for 3.9 s, then regenerated to 123 by 4.4 s. Game over showed 4 rounds, 27 kills, 270 points and 36% accuracy. The real-Enter restart was clean with no doubled points. |
| 18 | Pause | PASS | A pause edge gave `paused`, 0.000 s advanced over 2 s of steps, and the next pause edge resumed. |
| 19 | Sound, no autoplay errors | PASS (not heard) | The audio module was initialised on a real click. There were no autoplay warnings and the console was empty. |
| 20 | 60 fps at round 15 with 24 zombies | NOT VERIFIABLE here | The tab is hidden so rAF does not run. The CPU budget check from Phase 3 still applies, and a visible-tab check by QA-3 is still needed. |

The served page had zero console errors or warnings from the menu through round 3, a death and a restart (Section 6, bullet 2). No fixes were required in this pass.
