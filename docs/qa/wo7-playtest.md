# WO7 QA-1 — Playtest

Run setup:
- Server: `python -m http.server 8222`.
- Desktop: Chrome at `/?debug=1`, 1920×902 viewport.
- Touch: `/?debug=1&touch=1` inside an 844×390 iframe, which is a landscape phone. Zoom was 1.96.
- Driver: `__game.debug.step(dt, dt, overrides)`. A small in-page bot aimed with `aimVector`, knifed or fired at the nearest zombie, and kited and strafed around walls.

What was played for real:
- **Level 1, rounds 1–3, knife only (V path, `melee: true`).** First run: 21 knife kills, exactly 15 points each (315). The bot stood still and died on round 3, which gave the first game over.
- **Second run, perks.** Every perk was bought by walking up to its machine and pressing interact. Nothing was granted with `givePerk`:
  - Quick Revive: 50.
  - Juggernog: 250, bought at 70/150 HP. It healed to 250/250.
  - Speed Cola: 300.
  - Double Tap II: 200.
  - Stamin-Up and Mule Kick were refused with "Perk limit reached" and cost 0.
  - `perkMods`: reload 0.5, rpm 1.33, bullet damage ×2.
- **Quick Revive.** I went down with 4 perks. The overlay showed "REVIVING…" with a progress bar. After 1.5 s the player revived at 150/150 with 2 s of invulnerability, and every perk was stripped.
- **Rebuy.** I bought Quick Revive again, then Mule Kick and Juggernog. Three guns were held.
- **Level 1 boss.** THE WARDEN was fought with real fire, god mode off. It died in under 30 s and I was at 2 HP at one point. Then I walked to the stairs and pressed F.
- **Level 2.** Shortcut: `startBoss`, plus Gorgon via `giveWeapon`. THE BONE PRIEST was killed with real fire. Then the stairs led to **LABORATORY**.
- **Level 3.** I played round 4 for real. `openAllDoors` was used to look around.
- **THE SUBJECT.** Started with `startBoss`, fought with real fire (Peacekeeper MK2) and god mode off. There were 3 acid volleys, and the fight lasted about 47 s. Afterwards, standing idle among 16 round-6 zombies:
  - I went down and Quick Revive fired.
  - I died about 2.5 s after the invulnerability ended.
  - That was the real game over: round 6, L3, 3 bosses.
- **Reload.** The menu showed "BEST: ROUND 6 · 1,070 PTS" and the top-runs table.
- **Touch.** Menu, zombie tiers at 1.96× zoom, a real click on **KNIFE** (a kill for 15), the revive overlay and the game-over screen, all on the 844×390 phone viewport.

Console errors: **none**. An `error`/`unhandledrejection`/`console.error` hook ran on every page and caught nothing. `read_console_messages` with onlyErrors found nothing. `npm test`: 496/496.

Harness notes:
- The Chrome extension changed browsers twice mid-session. Each time the tab group was lost and I reselected the local browser.
- Audio (swipe and wet hit) was verified only through the events (`melee:swing` and `melee:hit`); I did not listen to it.
- To capture short effects (slash, globs), the game was advanced with `step()` and then frozen with `setTimeScale(0)`.

## Findings

1. **MAJOR — The LABORATORY flicker is a full-screen strobe. It is too frequent and could trigger photosensitive seizures.**
   - **File/function:** `src/render.js` `flickerAlpha()` / `drawFlicker()`, `FLICKER_WINDOW = 0.9`.
   - **Repro:** play any LABORATORY level (flicker also stays on LABORATORY II and later loops). Or simulate `flickerAlpha` over 10 minutes. I did this with the same hash function in node.
   - **Expected:** an occasional, subtle failing-tube dim that adds mood.
   - **Actual:**
     - About 13 bursts a minute. The median gap is 3 s and the minimum is 0.47 s.
     - Each burst covers the whole canvas with `#02040a` at up to 55 % alpha.
     - Each burst is 2–4 dark/light cycles packed into 0.10–0.35 s. A single dark phase can be 12–45 ms, which is more than 3 flashes per second.
     - It is on screen 4.9 % of the time.
     - As a player it reads as constant screen stutter during fights, not ambience. It also breaks the WCAG 2.3.1 "three flashes" guideline for a full-screen luminance change.
   - **Fix:**
     - Limit the strobe to at most 3 transitions per second: make each phase at least 0.17 s, or use a single dip per burst.
     - Cap the alpha at about 0.2.
     - Make bursts rarer: roll once per 6–10 s window with p ≈ 0.35.
     - Prefer dimming a local region, meaning one "tube" rectangle of the room, over the whole screen.
     - Skip the flicker when `matchMedia('(prefers-reduced-motion: reduce)')` matches.
   - **Resolution (FIX-1):** `flickerAlpha` rewritten. Each `RENDER.flicker.period` (14 s) window holds one burst at a hashed offset, so bursts start 8-20 s apart (≈4/min). A burst is 1-2 smooth sin² dips of 0.24 s whose starts are 0.42 s apart, so there are never more than 2 flashes in any second. Darkening alpha is 0.08-0.18. The effect is skipped when `prefers-reduced-motion: reduce` matches. Simulated over 10 min: max alpha 0.177, darkened 2.0 % of the time, min dip spacing 0.41 s, burst gaps 8.9-17.8 s.

2. **MAJOR — With Mule Kick, the weapon HUD shows only one of the two inactive guns.**
   - **File/function:** `src/hud.js` `updateWeapon()`. The secondary is `player.weapons[activeSlot === 0 ? 1 : 0]`.
   - **Repro:** buy Mule Kick, hold `[mr6, argus, kn44]`, then select slot 3.
   - **Expected:** the panel lists both holstered guns, so the player knows what digit 1, 2 or 3 selects.
   - **Actual:** it shows "MR6 / KN-44" and the Argus is not shown anywhere. With slot 2 active, the third gun is hidden instead. Screenshot: `wo7-qa-l1-boss-mule-hud.png`.
   - **Fix:** render every non-null weapon other than the active one as a stacked secondary line, for example "1 MR6 · 2 ARGUS". Use `weapons.filter((w, i) => w && i !== activeSlot)`.
   - **Resolution (FIX-2):** `hud.updateWeaponSecondary` lists every held weapon other than the active one (all slot weapons while a temp weapon is out), in slot order, as dimmed lines with a slot-digit key ("1 MR6" / "2 KN-44"). Touch layout: one ellipsised line "MR6 · SHEIVA" (hidden while reloading); measured at 844x390 clear of RELOAD/KNIFE (3 px gap) and the right stick.

3. **MINOR — The perk label plate is drawn over the player exactly where you stand to buy.**
   - **File/function:** `src/render.js` `paintPerkMachine()` / the plate placement (the `paintPlate` side rules) and `drawLabelsOverPlayer()`.
   - **Repro:** stand in front of Speed Cola on BUNKER.
   - **Expected:** the player sprite stays visible while buying. The machine is often next to a window, so zombies are close.
   - **Actual:** the plate sits on the adjacent floor tile, and FIX-3's re-blit covers the player at 75 % alpha. The soldier is almost invisible under "SPEED COLA 300". Screenshots: `wo7-qa-jugg-machine-zoom.png` and the Speed Cola case in the notes.
   - **Fix:** for perk machines, draw the plate *on* the machine's floor-facing edge, overlapping the box by about 8 px, rather than 3 px past it. Or leave perk plates out of `labelRects` so the player draws on top. The plate is only 19 px tall.
   - **Resolution (FIX-1):** wall-buy and perk plates are tagged `buy` when painted. `drawLabelsOverPlayer` re-blits them over the player at `RENDER.buyPlateOverPlayerAlpha` (35 %) instead of 75 %. The soldier stays clearly visible while buying, and the HUD prompt carries the name and price. Door, mega door and stairs plates keep 75 %. Verified at Quick Revive and Double Tap on L3.

4. **MINOR — Acid pools land inside walls and outside the arena.**
   - **File/function:** `src/zombie.js` `lobAcid()`. The target is only clamped to the map bounds: `tx = clamp(tx, 0, m.width)`.
   - **Repro:** fight THE SUBJECT with the player near a pillar or the arena wall.
   - **Expected:** every glob lands on reachable floor.
   - **Actual:** in one volley, one pool was drawn on top of a pillar and one past the arena's east wall. That is 2 of 3 globs wasted, and the green puddle looks glued onto the wall art (`wo7-qa-subject-acid-pools.png`).
   - **Fix:** after computing `(tx, ty)`, pull it back along the boss→target ray with `map.raycastWalls` minus about 20 px. Or snap it to the nearest `arenaTiles` tile.
   - **Resolution (FIX-5):** `zombie.lobAcid` now snaps each target via `acidLandingPoint`: kept if on a walkable arena tile (boss in arena) / walkable tile (otherwise), else the centre of the nearest such tile, else the player's position. Tests in `tests/zombie.test.js`.

5. **MINOR — The LABORATORY look is missing the spec's hazard stripes and glass tanks. The walls read as navy brick.**
   - **File/function:** `src/render.js` static-layer wall painting (theme-driven); `src/levels/level3.js` theme.
   - **Repro:** walk the Sterile Corridor on L3.
   - **Expected (1.5):** "steel-blue walls with hazard stripes beside doors, glass tanks as decor blocks".
   - **Actual:** the floor is good: pale green-grey with grout, and clearly distinct from BUNKER and CATACOMBS. But the walls use the same brick courses as the other levels, only recoloured. There are no stripes by the doors. The "line of glass tanks" is plain brick blocks (`wo7-qa-lab-corridor-tanks.png`).
   - **Fix:**
     - Add a theme `wallStyle: 'panel'`: flat steel panels with rivets and a light top edge.
     - Add yellow/black diagonal stripes on the wall tiles on each side of a door.
     - Paint the corridor/cell decor blocks as tanks: a glass rim, a lighter cyan fill, a highlight streak and a floating silhouette. They could be marked in the level (e.g. a `tanks` list of tiles) so render knows which blocks are tanks.
   - **Resolution (FIX-1):** LABORATORY themes (name matches /LABORATORY/, or `theme.wallStyle: 'panel'`) paint walls as steel panels with seams, a lit top edge and corner rivets. Free-standing wall clusters that do not touch the map border and have ≤ `RENDER.labTankMaxTiles` (6) wall tiles are painted as glass specimen tanks: steel base, translucent cyan-green glass, a liquid level, a floating silhouette, bubbles, a highlight and a rim. This covers the decon blocks, the corridor tanks, the cryo pods and the arena pillars. Yellow/black hazard stripes are painted on a 12 px band of the wall tile at each end of every door and the mega door.

6. **MINOR — The game-over summary shows "Perks: None" after a Quick Revive death, which is the usual way a perked player dies.**
   - **File/function:** `src/main.js` game-over handler (passes the current `p.perks`); `src/hud.js` `setGameOverSummary` (line ~369).
   - **Repro:** buy perks including Quick Revive, go down, get revived, then die.
   - **Expected:** the summary reflects what the player built during the run.
   - **Actual:** "Perks: None" on both of my perked runs (`wo7-qa-gameover-l3-desktop.png`, `wo7-qa-gameover-phone-844x390.png`).
   - **Fix:** track `stats.perksHeld` as a Set of every perk bought, and show it as "Perks drunk". Or snapshot `p.perks` at the first down, before the revive strip.
   - **Resolution (FIX-2 HUD part):** the summary row is now "Perks used" and reads `summary.perksRun` (FIX-3, main.js) first, de-duplicated, falling back to `summary.perks` / the held list.
   - **Resolution (FIX-3 data part):** `main.js` keeps `perksRun`: every `perk:bought` perk id this run, in order, de-duplicated, reset in `initStats` (restart). It is passed as `summary.perksRun` to `setGameOverSummary`, and there is a debug hook `__game.debug.perksRun()`. Verified in the browser.

7. **MINOR — The score tables and small HUD text are too small on a phone.**
   - **File/function:** the `src/hud.js` injected CSS for `.screen-top` table `th`/`td`, `.screen-top-title`, `.hud-level` and `.hud-vital-label`.
   - **Repro:** `?touch=1` at 844×390 (landscape phone), on the menu or game over.
   - **Expected:** at least about 10–11 CSS px.
   - **Actual:** these are the computed font sizes:

     | Element | Size |
     |---|---|
     | Table headers (`th`) | 5.85 px |
     | Table cells (`td`) | 8.58 px |
     | "TOP RUNS" | 7.8 px |
     | Summary rows | 10.1 px |
     | "HEALTH" and "L1 BUNKER" labels | 7.4–7.8 px |

     The headers cannot be read on a real phone (`wo7-qa-menu-phone-844x390.png`). On desktop the tables are fine (`wo7-qa-menu-top-runs-desktop.png`).
   - **Fix:** set a floor on the scaled sizes, for example `font-size: max(10px, …)` for `td`, `max(9px, …)` for `th` and `max(10px, …)` for the titles. Or drop the TIME and LVL columns below 500 px width.
   - **Resolution (FIX-2):** `#hud.mobile` floors: table cells 11.5 px, headers / TOP RUNS / controls 11 px, summary rows 11.5 px, HEALTH/KILLS/level labels 10 px (measured at 844x390). The mobile top-5 drops KILLS and LVL (# / ROUND / POINTS / TIME); menu and game over still fit.

8. **MINOR — The game-over screen has no backdrop, so world art shows through the summary.**
   - **File/function:** `src/hud.js` game-over screen CSS.
   - **Repro:** die near a labelled machine.
   - **Actual:**
     - Desktop: the "QUICK REVIVE 50" plate sits behind the "Time 1:12" row (`wo7-qa-gameover-desktop.png`).
     - Phone: a zombie sprite sits behind the TOP RUNS table and the joysticks stay drawn (`wo7-qa-gameover-phone-844x390.png`).
     - Still legible, but it looks unfinished.
   - **Fix:** put a `rgba(0,0,0,0.55)` rounded panel behind the stats block and the table, or darken the whole overlay to about 0.7. Hide the touch sticks while the phase is gameover.
   - **Resolution (FIX-2):** the menu / game-over overlay is darker (0.78→0.93 radial), and the controls list and run summary sit on dark rounded panels like TOP RUNS. The stick zones are hidden on menu and game over (`#hud[data-phase] ~ #touch .tj-zone`); a tap still starts / restarts (verified in the browser via the #stage pointerdown handler).

9. **MINOR — Walker and jogger are separated only by shirt colour, and the player's olive uniform shares the zombie green.**
   - **File/function:** `src/sprites/zombie.js` variant palettes; `src/sprites/soldier.js` palette.
   - **Repro:** spawn 3×3 mixed tiers next to the player (`wo7-qa-tiers-desktop.png`, `wo7-qa-tiers-mobile-zoom.png`).
   - **What works:** the art reads well as zombies, even in a crowd and at mobile zoom: faces, outlines, blood overlay below 50 % HP and corpses are all clear. Sprinters (dark, red eyes) stand out.
   - **Actual:**
     - Walker (grey rags) and jogger (brown rags) have the same green skin. At desktop 1× zoom they need a second look.
     - The soldier is also olive green with a similar value, so in a crowd the player sprite is the hardest thing to find.
     - Sprinters are low-contrast on the dark BUNKER floor.
   - **Fix:**
     - Shift the jogger skin toward yellow-ochre and add more blood.
     - Give sprinters a 1-px lighter rim or a brighter eye glow.
     - Give the player a faint light ground ring or a slightly warmer, lighter uniform.
   - **Resolution (FIX-1, render part):** the player now has a faint light ground ring (`RENDER.playerRing`, 40 % alpha, dark underline) drawn under the legs. Sprite palettes are not render.js scope.
   - **Resolution (FIX-4, art part):** `src/sprites/zombie.js` tiers now differ by silhouette as well as palette, and no normal-zombie body, tearing frame or corpse uses the soldier's olive `G`/`g`/`L`. Walker: slumped wide hunch, drooped head, one arm reaching and one dangling back, faded blue shirt `C`, bluish-grey skin `M`/`m`. Jogger: upright compact torso, both arms straight forward, torn brown jacket with flapping tails, sickly yellow-ochre skin `h`/`H`, more blood. Sprinter: lean, forward-leaning, arms swept back, white face with red eyes and a light `W` rim inside the outline. Sizes, anchors, frame counts and the boss `'p'` marker are unchanged, and the damaged overlay (12 px) sits inside all 3 bodies and 3 tearing frames. Checked in the preview and in-game on BUNKER and CATACOMBS (3x3 mixed crowd, 1x and `&touch=1`): the olive player is now the only green sprite, and all three tiers read apart at a glance. The soldier's body art was not touched.

10. **MINOR — Perk machines read as coloured blocks rather than BO3 machines. The letter is tiny.**
    - **File/function:** `src/render.js` `paintPerkMachine()`.
    - **Repro:** look at any machine (`wo7-qa-jugg-machine-zoom.png`, `wo7-qa-perk-hud-desktop.png`).
    - **What works:** the colours are right (Juggernog red, Speed Cola green, Quick Revive cyan, Double Tap orange, Stamin-Up yellow, Mule Kick purple) and the label plates are crisp.
    - **Actual:** the machine is one 40×40 tile with a bottle glyph drawn sideways on east- and west-facing machines, and a letter of about 5 px. It reads as a lit crate. There is no "tall vending box" silhouette.
    - **Fix:**
      - Keep the bottle glyph upright in screen space regardless of facing.
      - Draw a darker cabinet frame with a lighter logo panel, and a 2–3 px "top cap" band in the perk colour.
      - Make the letter about 9 px on the panel.
      - Optional: a slow glow pulse, drawn dynamically rather than in the static layer.
    - **Resolution (FIX-1):** `paintPerkMachine` redrawn as a vending cabinet:
      - A dark frame and a perk-colour body with side trims.
      - When there is wall behind, the cabinet rises 8 px into it for a taller silhouette.
      - A lit top sign (marquee) in the perk colour, with glow and a bulb row.
      - A logo panel with a 15 px bold perk letter.
      - A dispenser alcove with a bottle, a steel coin-slot plate and an LED.
      - The letter and the bottle are always upright in screen space.
      - The price plate shows `m.price` (FIX-3's escalating Quick Revive 50/150/300) when it is finite, else `def.cost`. The static layer repaints through `map.version`, which was verified by setting `reviveUses = 1` in the browser: the plate changed to 150.

11. **MINOR — The Quick Revive HUD badge is ambiguous.**
    - **File/function:** `src/hud.js` perk row (`usesLeft = maxUses - reviveUses`).
    - **Repro:** after the first purchase the Q bottle shows "2"; after `givePerk` it shows "3".
    - **Actual:** the number is purchases left at the machine, but a player reads it as revives in hand. They only ever have one.
    - **Fix:** show the badge only on the machine plate ("2 LEFT"), or change it to "×1" / pips that make its meaning explicit.
    - **Resolution (FIX-2):** the Q bottle badge now shows the revives in hand, always "×1" while the perk is held; purchases left are left to the machine prompt (FIX-3 escalating prices).

12. **MINOR — Points popups overlap after chained knife kills.**
    - **File/function:** `src/player.js` melee bonus `addPoints(..., x, y)` at the player position; render `text` effects.
    - **Repro:** knife 2–3 zombies in quick succession on desktop.
    - **Actual:** "+5" popups spawn on the player, and successive ones stack on each other and on "+10" into a smear that reads like "++5" (`wo7-qa-knife-slash-desktop.png`). A single kill on touch was clean.
    - **Fix:** emit a single "+15" at the zombie for a knife kill, or offset the bonus popup by about 12 px along the swing angle.
    - **Resolution (FIX-1):** points popups are merged in `flushPending`. A new `+N` spawned within `RENDER.textMergeTime` (0.3 s) of an existing popup, and within `textMergeDist` (44 px) of it, is added into that popup as one accumulating "+N". The popup keeps its current height, so it does not jump. Verified: a chained +10/+5/+10/+5 shows a single "+30".

13. **MINOR — Runs that die before round 1 are recorded and ranked.**
    - **File/function:** `src/main.js` game-over → `scores.recordRun`.
    - **Repro:** start and die within 10 s.
    - **Actual:** the screen says "YOU SURVIVED 0 ROUNDS" and "#4 ALL TIME", and a 0/0/0 row appears in the table.
    - **Fix:** skip `recordRun` when `roundReached === 0` (show "No run recorded"), or at least say "DIED BEFORE ROUND 1".
    - **Resolution (FIX-2 HUD part):** when the summary carries `rankText` (FIX-3 sets "Not ranked" for pre-round-1 deaths), the game-over rank line shows that text in place of "NEW BEST …" / "#N ALL TIME".
   - **Resolution (FIX-3 data part):** `main.recordGameOver` skips `scores.recordRun` (and `score:recorded`) when `stats.roundReached === 0`. It still calls `setGameOverSummary` with `rank: null`, no best flags, `recorded: false` and `rankText: 'Not ranked'`. `scores.recordRun` also never flags a round-0 run as best round. Verified in the browser: dying at round 0 leaves localStorage unchanged and shows "Not ranked".

14. **INFO — THE SUBJECT is fair and well telegraphed, but not threatening.**
    - **Telegraph:** a 0.5 s green ring around the boss, a glob in its mouth, and dashed landing circles at the three targets. The lobbed globs have an arc. Everything is readable (`wo7-qa-subject-telegraph.png`, `wo7-qa-subject-globs-landing-rings.png`).
    - **Dodging:** the pools land where the player *was*, so any movement escapes them. My simple strafing bot took **0** acid damage over 3 volleys, and **0** damage in total from boss and minions. The boss died in about 47 s to Peacekeeper plus Argus.
    - **Contrast:** the dashed landing rings are thin green on a green-grey floor, which is low contrast.
    - **Suggestions:**
      - A brighter, yellow-green, 2 px ring on the lab floor.
      - From loop 2, lead the target by the player's velocity × 0.5 s, or add a 5-glob fan.
      - These are balance calls for QA-3.
    - **Resolution (FIX-1, contrast part):** the landing rings are now a 4 px dark outline under a 2 px bright yellow-green (`#c8ff3a`) dash, at alpha 0.55-0.95. They read clearly on the lab floor.

15. **INFO — The knife feels good, but the blade is barely visible.**
    - One swing kills in rounds 1–3 (150 damage) for 15 points. The white slash arc is clear and nicely sized on desktop and at mobile zoom. The KNIFE button sits left of RELOAD and is easy to hit (`wo7-qa-knife-touch-corpses.png`).
    - The knife pose's blade is 1–2 px and gets lost under the arc. A 3-px bright blade tip on the thrust frame would help.
    - **Resolution (FIX-4):** both `SOLDIER.torso.knife` frames now carry a 4-px light-grey `WWWW` blade with a white `w` edge-highlight row beside it (cocked: row 13 plus `www` on row 12; thrust: cols 12-15 of row 11 plus `wwww` on row 10, fist moved back to cols 10-11). The helmet pixels are unchanged (animator test passes). The blade reads clearly in the preview at 12x and in-game at touch zoom.

What reads well:
- The bosses are large, detailed and clearly different from the horde. THE WARDEN is grey and hulking with claws (`wo7-qa-warden-zoom.png`); THE SUBJECT has its green crown.
- The HUD perk row: coloured bottles with letters, above HEALTH.
- The revive overlay on desktop and phone (`wo7-qa-revive-overlay.png`, `wo7-qa-revive-mobile.png`).
- The desktop game-over summary and menu.
- The corpse sprites.

## Section 5 acceptance

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Pixel zombies in 3 tiers with shamble, minion and boss sprites, corpses, no frame regression | **PASS** | Readable on desktop and at 1.96× zoom. Tier separation could be stronger (#9). I did not re-measure frame cost; integration measured 0.84 ms mean. |
| 2 | Six machines per level, effects immediate, cap 4, Quick Revive once per purchase (max 3) and strips perks, perks survive descents, HUD icons | **PASS** | 6 machines on L1, L2 and L3. Juggernog healed to 250. The cap refused the 5th perk. Revive stripped all perks and the third gun. The perks survived L1→L2→L3. The HUD issue with the third gun is #2. I did not buy the 3rd Quick Revive / SOLD OUT here; integration covered it. |
| 3 | V / KNIFE: animation, arc, sound, 15 points, cancels reload, touch | **PASS** | 21 knife kills at exactly 15 each on desktop. A real click on the touch KNIFE button gave a kill for 15. Sound was checked by events only. |
| 4 | Game over: summary, rank, top-5; menu best; survives reload; private mode safe | **PASS** | "NEW BEST ROUND! #1 ALL TIME" and the table. After a reload the menu showed "BEST: ROUND 6 · 1,070 PTS" and the top runs. I did not re-test private mode (integration #10). Legibility issues are #7 and #8; the perks line is #6. |
| 5 | L3 LABORATORY via L2 stairs: look, flicker, tier-3 guns, perks, THE SUBJECT acid hurts; L4 BUNKER II harder | **PASS with issues** | Reached through the real L2 stairs interact. The HG 40, M8A7 and Peacekeeper are on the walls. THE SUBJECT's spit fired and 3 pools landed. The flicker is present but too aggressive (#1). Art gaps are #5 and pools in walls are #4. I died on L3, so L4 was not re-verified in this run (integration #13). |
| 6 | `npm test` green, zero console errors through a full run, restart clean | **PASS** | 496/496. Zero errors through L1→L3 plus 3 game overs, restarts and reloads. |

## Screenshots (`docs/screenshots/`)

- `wo7-qa-tiers-desktop.png`: 3×3 walker, jogger and sprinter, with the damaged overlay, at 1× zoom.
- `wo7-qa-tiers-mobile-zoom.png`: the same crowd at 1.96× on an 844×390 phone.
- `wo7-qa-knife-slash-desktop.png`: slash arc, corpses and overlapping popups (#12).
- `wo7-qa-knife-touch-corpses.png`: touch KNIFE kill with the arc, "+10" / "+5" and corpse sprites.
- `wo7-qa-jugg-machine-zoom.png`: the Juggernog machine and plate over the player (#3, #10).
- `wo7-qa-perk-hud-desktop.png`: HUD perk row Q(2) J C N, with the Juggernog machine.
- `wo7-qa-revive-overlay.png` / `wo7-qa-revive-mobile.png`: the REVIVING… overlay on desktop and phone.
- `wo7-qa-l1-boss-mule-hud.png`: THE WARDEN fight. The weapon HUD shows only MR6 / KN-44 (#2).
- `wo7-qa-warden-zoom.png`: boss sprite close-up.
- `wo7-qa-lab-start-room.png`, `wo7-qa-lab-corridor-tanks.png`: the LABORATORY look (#5).
- `wo7-qa-subject-telegraph.png`: THE SUBJECT telegraph ring.
- `wo7-qa-subject-globs-landing-rings.png`: lobbed globs and dashed landing rings.
- `wo7-qa-subject-acid-pools.png`: pools, including one on a pillar and one past the wall (#4).
- `wo7-qa-gameover-desktop.png`, `wo7-qa-gameover-l3-desktop.png`: summary, rank and the top table (#6, #8).
- `wo7-qa-gameover-phone-844x390.png`: phone game over (#7, #8).
- `wo7-qa-menu-top-runs-desktop.png`, `wo7-qa-menu-touch.png`, `wo7-qa-menu-phone-844x390.png`: the menu best line and table.
