# WO9 QA — Level 5 OUTPOST

## Run setup
- **Server:** `python -m http.server 8323`. A new Chrome tab at `/?debug=1`, then `/?debug=1&touch=1` with `#stage` forced to 844x390 (mobile zoom 1.96).
- **Visibility:** the tab stayed `document.hidden`, because other agents' windows shared the Chrome session. `requestAnimationFrame` never ran. I drove frames with `__game.debug.step(dt, dt, overrides)`, and the canvas was still drawn every step. Screenshots came from the real rendered page.
- **Getting to OUTPOST:** a real **Shift+M**, then **5** and **Enter**, on the level select. This produced `phase levelselect`, then OUTPOST with practice = true. Later resets used `levelSelect(4)`.
- **Player driver:** an in-page BFS walker (`moveX/moveY`) plus an aim/fire bot (`aimVector`, alternating `fire` for semi-autos). All buys went through the real interact path (`interact: true`).
- **Code state:** after Phase 2 integration. `npm test` passed 643/643, and `tests/level5.test.js` passed 12/12.

## What was played
1. **Landing pad (god off).**
   - Bought KN-44 (150) and Quick Revive (50) via F.
   - Rounds 1–3 in the open with a kiting bot.
   - An arrival at round 1 with the MR6 is brutal on OUTPOST (zombie HP 435 at round 1, 725 at round 2). The first two runs ended at rounds 1 and 2; see #8.
2. **Full route (god on), buying everything with real interact.** Each item showed the right prompt and charged the right price:
   - D 75, HG 40 350, Marshal 16 225, Speed Cola 300, E 100, M8A7 375, Stamin-Up 200.
   - Mystery Box (95 during a fire sale; gave Marshal 16, then Haymaker 12).
   - F 100, Man-O-War 250, Drakon 300, Double Tap II 200, G 125, Peacekeeper MK2 400.
   - Juggernog 250 (after clearing the perk cap), H 150, Gorgon 300, Mule Kick 400.
   - **Pack-a-Punch** 500 (Gorgon became Medusa's Gaze after 3 s).
   - **Mega door** 1250.
   - Every wall buy, perk, box and PaP is reachable. Nothing is blocked by an ice hole. The perk cap (4) is the only denial.
3. **Ice holes.**
   - The player cannot cross them. Pushing straight into the radar pond for 2 s stops at the shore (y 426 against edge 440, x 506 against 520). A sprint on the diagonal slides along the edge.
   - `isWalkable` is false for all 63 `~` tiles, for both the player and zombies.
   - In 14,511 zombie position samples during a 20 s chase around the pond, 0 were on a pit tile.
   - Zombie routes are sensible. For example, spawns at W (24,38) and the shed go around the pond via gate E, then (12,17) to (15,16).
4. **Shooting across holes.**
   - Across a hole, bullets hit: pad to barracks over (21,27); pad to fuel over (26,23); greenhouse to command over (43,5); across the radar pond. Each gave 4–6 hits in 20 frames with a clear ray.
   - Closed gates block the shot, as intended: F, H and G each gave 0 hits.
5. **Open-field pathing.**
   - All doors open, and 2 zombies from every active spawn walked to the player at 4 positions: bunker, radar NW, greenhouse and hut row. In 40 s, 13–19 of 20 arrived.
   - The rest were queueing in a crowd ring around the player. At the bunker they queued at the 1-tile east entrance (54,14), which is expected for a choke.
   - No zombie was stuck on geometry.
6. **THE WENDIGO, god off.**
   - Arena entered by walking through the bought mega door. `boss:start`, max HP 22,446.
   - Frost: `boss:frost` fires every 6.0 s; 0.6 s telegraph, then breath. A hit does 30 damage, sets `slowT` to 2 and gives 129 px/s movement (0.55 of 235). The SLOWED badge shows (ice icon plus "SLOWED" in the HEALTH row), the player sprite gets ice crystals, and there is a frost vignette.
   - Boss melee does 75.
   - Six bot fights (loadout: PaP'd KN-44, Man-O-War, Drakon or Peacekeeper, with Jugg, Speed, Double Tap and Stamin-Up):
     - three kills: 13.7 s, 21 s and 33.9 s;
     - three deaths, all from melee plus minions in the cramped arena.
   - The boss **permanently wedges** next to both arena ice holes. This is #1, the main finding.
7. **Touch (844x390).**
   - Teleport works.
   - Snowfield crowd, doors and the frost telegraph are readable at mobile zoom.
   - The HUD labels and the move stick are washed out on snow (#3).
8. **Errors:** 0 console errors (`read_console_messages` onlyErrors, plus an in-page `console.error` and `onerror` hook), on both desktop and touch.

## Frame cost
Scenario: OUTPOST arena with the boss, 10 minions and 24 normal zombies. Timing covers the whole `step(1/60)` (update + render + HUD), over 300 frames. The tab was hidden; I could not get it visible because the Chrome window was shared with other agents.

| Measurement | avg | p95 | max |
|---|---|---|---|
| CPU (update + canvas draw calls) | **0.47 ms** | **0.80 ms** | 10.3 ms (one GC/first-frame spike) |
| 30 zombies on the open pad, CPU | 0.58 ms | 0.70 ms | – |
| Same with a forced GPU flush (`getImageData(0,0,1,1)` every frame) | 8.9 ms | 11.3 ms | – |
| Level 1 with the forced flush, for comparison | 8.85 ms | 13.1 ms | – |

- The forced-flush numbers are dominated by the read-back stall. They are the same on L1, so OUTPOST's snow floor, snowfall and fences add no measurable GPU cost.
- CPU is well under 3 ms: **PASS**, with the hidden-tab caveat.

## Findings

### 1. MAJOR — THE WENDIGO gets permanently stuck in both 1-tile lanes beside the arena ice holes
- **Files:** `src/levels/level5.js` rows 27 and 33 (arena); `src/zombie.js` boss movement (`getFlowDir` / `resolveCircle`, radius 34).
- **Repro:**
  1. `startBoss()`, god on.
  2. Walk (55,31) → (56,29) → (56,27) → (56,26) → (53,26) → (45,27).
  3. The boss stops at **(56.5, 28.5)** and never moves again, while still `chasing`.
  4. The mirror case: walk (45,30) → (44,31) → (44,33) → (44,35), then away. The boss stops at **(44.5, 32.5)**.
- **Scale:** a sweep of all 136 arena tiles as player positions (7 s each) failed 127/136. The boss wedged early and stayed there for the whole sweep. The same thing happened in the natural bot fight: the boss sat at (56.5, 26.5) for all 4 frosts.
- **Expected:** the boss (diameter 68 px) keeps chasing.
- **Actual:**
  - The flow field routes it into the 40 px lanes at x56 (between the pit at 54-55,27 and the east wall) and at x44 (between the pit at 45-46,33 and the west wall). `resolveCircle` pins it there.
  - The fight becomes a free kill: stand more than 260 px away and shoot across the ice. Frost and melee never land.
  - Screenshot: `wo9-qa-outpost-boss-stuck-ne.png` (the boss is also drawn half inside the rock).
- **Fix (layout, verified):** close the lanes so each hole touches the wall. This keeps the test-pinned pits (45,33) and (54,27):
  ```
  row 27  '###..#####...........~....................##..........~~.###'
       -> '###..#####...........~....................##..........~~~###'
  row 33  '###............#S#...~....................##.~~##...##...###'
       -> '###............#S#...~....................##~~~##...##...###'
  ```
- **Verification (in-memory patch of `LEVEL5.ascii` in the browser):**
  - The same 134-tile sweep: **0 fails**.
  - Both lures: the boss follows to (46.9, 26.7) and (53.8, 34.9).
  - In a scratch copy with this patch (plus #2 and #4 below), `npm test` passes **643/643**.
- **Also recommended (robustness, for every boss arena):** in `zombie.js` boss steering, if a `chasing` boss moves less than 2 px over 0.5 s, steer straight at the player for 0.5 s, or slide along the blocked axis. Alternatively, build the boss flow field with a 1-tile clearance (treat tiles orthogonally next to a wall or pit as blocked for radius > 20).
- **Resolution (FIX-1):** layout fix applied: row 27 `~~~###` and row 33 `##~~~##`. The pinned pits (45,33) and (54,27) are unchanged. tests/level5 now pins that there is no 1-tile lane beside an arena ice hole. The zombie.js unstick is not part of FIX-1.
- **Resolution (WO9 FIX-3, robustness part):** the layout fix is FIX-1's. In `src/zombie.js`, zombies with radius > TILE/2 (the boss) now follow a clearance flow field. It is built on a copy of the grid where walkable tiles the circle cannot fit anywhere on (checked on a half-tile lattice) count as walls. 1-tile lanes close and 2-wide lanes stay open. Where the clearance field has no route, the boss falls back to the shared flow. A watchdog catches any remaining snag: moving < 4 px over 0.75 s while chasing (not swinging, telegraphing or touching the player) starts stage 1, a steer along the best probed direction (a neighbouring tile's flow, a perpendicular slide or direct pursuit). Stage 2 seeks the nearest lattice point where the circle fits, and stage 3+ nudges straight to it. Check: with both lanes re-opened in memory, a sweep over all 136 arena tiles (7 s each) had 0 stand-stills over 1.5 s and 0 watchdog triggers. The boss reached 135/136 tiles; the last one timed out while the boss was still moving. It routed around the holes. Tests: `tests/zombie.test.js` "WO9 FIX-3" (inline map with a 1-tile gap).

### 2. MEDIUM — the M8A7 wall buy (2,14) is drawn under the desktop HUD's left column
- **File:** `src/levels/level5.js` row 14 (and row 9 for the new spot).
- **Repro:** walk to the radar's west edge (4,14). The camera clamps at x = 0, and the wall-buy icon sits under the kill-tally marks and the "L5 OUTPOST" plate. Only part of the label is visible (`wo9-qa-outpost-m8a7-under-hud.png`).
- **Expected:** gun wall buys are readable.
- **Fix:** move it onto the south face of the radar dish plinth. It then faces only (9,10), in the radar zone. This is verified with all tests passing.
  ```
  row  9  '####....###......#...~......##.....##......H.............###'
       -> '####....#4#......#...~......##.....##......H.............###'
  row 14  '##4..................#....................##..#..........###'
       -> '###..................#....................##..#..........###'
  ```
- **Resolution (FIX-1):** M8A7 moved (2,14) -> (9,9), as proposed.

### 3. MEDIUM — HUD labels and touch sticks wash out on the white snow (OUTPOST only)
- **Files:** `styles.css` `.hud-vital-label` (color `var(--hud-dim)` #8a8a8a, no shadow); `.tj-base` / `.tj-knob` (white borders and fills).
- **Repro:** OUTPOST, standing on the open pad. HEALTH and KILLS are faint grey on #e3ecf4. On touch, the idle move stick (white at opacity 0.55) almost disappears (`wo9-qa-outpost-mobile-hud-contrast.png`). "100%" and the kill count stay readable only thanks to their shadow.
- **Expected:** HUD legible on every level.
- **Fix:**
  - `.hud-vital-label { text-shadow: 0 0.1em 0.2em rgba(0,0,0,0.85), 0 0 0.4em rgba(0,0,0,0.5); }`. This is harmless on dark levels.
  - Set `stage.dataset.levelStyle = theme.style` on `level:start` (hud.js `onLevelStart`), then add:
    ```css
    #stage[data-level-style="outpost"] .tj-base { border-color: rgba(30,50,70,0.55); background: radial-gradient(circle, rgba(20,35,55,0.06) 0 55%, rgba(20,35,55,0.2) 100%); }
    #stage[data-level-style="outpost"] .tj-knob { border-color: rgba(30,50,70,0.8); background: radial-gradient(circle at 40% 35%, rgba(255,255,255,0.7), rgba(120,140,165,0.45) 70%); }
    ```

- **Resolution (WO9 FIX-4):** fixed in `styles.css` and `src/hud.js`. A new `--hud-outline` (a dark 4-way edge plus halo) is used on `.hud-vital-label`, `.hud-vital-value` and `.hud-points-value` on every level. `hud.js` `updateLevelStyle` copies the level theme style to `#stage` and `#hud` `[data-level-style]`. It polls every frame, because the first level's `level:start` fires before the HUD listens. On `outpost` the labels get lighter, the stick rings and knobs get dark navy rings and backings, and idle opacity goes from 0.55/0.7 to 0.8/0.9. The touch buttons get a darker fill and a thin light halo. Browser check (`&touch=1`, `#stage` 844x390, on snow): before, the move stick was barely visible and the aim stick was a faint pink ring. After, both are clearly outlined, and HEALTH/KILLS, 100% and the points read crisply.

### 4. MEDIUM — the barracks spawn window (2,25) sits under the kill-tally HUD
- **File:** `src/levels/level5.js` rows 25, 37 and 38.
- **Repro:** stand at (10,25). The boarded window, and zombies climbing out of it, are hidden behind the red tally marks (`wo9-qa-outpost-barracks-window-under-hud.png`). You cannot see or rebuild the barricade.
- **Fix:** move the window and its pocket into the south border at x14, which is clear of the bottom-left HUD. This is verified with 643/643 passing. The pocket stays behind a wall and the window faces barracks floor (14,36).
  ```
  row 25  '#SW..................#.#................#.##X...........X###'
       -> '###..................#.#................#.##X...........X###'
  row 37  '########3###############W###1#######Q##W#########TTT########'
       -> '########3#####W#########W###1#######Q##W#########TTT########'
  row 38  '########################S##############S####################'
       -> '##############S#########S##############S####################'
  ```
- **Resolution (FIX-1):** window/pocket moved to (14,37)/(14,38), as proposed. The new interact-reach check also moved Double Tap (42,16) -> (38,18) and the box (20,4) -> (18,2); both were 54 px from a neighbouring zone.

### 5. MEDIUM (feel) — the frost breath is only dodgeable at close range or by strafing that was already under way
- **File:** `src/config.js` `BOSS.frost`; `src/zombie.js` `updateBossFrost` / `inFrostCone`.
- **Measured** on open snow, boss still, angle locked at telegraph start, player speed 235 (with Stamin-Up). "Reaction" is the delay before the player starts moving perpendicular:

  | Distance | react 0 s | 0.15 s | 0.25 s | 0.35 s |
  |---|---|---|---|---|
  | 60 px | dodge | dodge | dodge | dodge |
  | 100 px | dodge | dodge | dodge | hit |
  | 150 px | dodge | dodge | **hit** | hit |
  | 200 px | dodge | **hit** | hit | hit |
  | 250 px | dodge | hit | hit | hit |

  Backing straight out also works from ≥ ~190 px, because the range is 260.
- **Readability:** the telegraph (dashed pale cone plus a cold glow on the boss) reads on the grey arena floor. It would be very faint on snow (`wo9-qa-outpost-frost-telegraph.png`, `…-mobile-frost-telegraph.png`).
- **Why it feels unfair:** at normal shooting range (150–250 px), a human with a ~0.25 s reaction gets hit unless they were already circle-strafing. The 30 damage is mild, but the 2 s slow at 0.55 is what lets the 75-damage melee and the minions land.
- **Fix (config only):** `frost: { telegraph: 0.8 }`, keeping everything else. At 0.8 s, a 0.25 s reaction covers 129 px of strafe, which dodges out to about 200 px. Also, in `drawFrostCone`, raise the telegraph fill alpha on light floors (for example ×1.6 when `theme.style === 'outpost'`), since the arena is the only non-snow floor.
- **Otherwise fair:**
  - The SLOWED badge is clear (ice icon plus pale-blue "SLOWED" replacing HEALTH, readable over rock).
  - The slow is exactly 2 s at 55 %.
  - Damage is sensible: 30 per breath, at most one hit per breath.

- **Resolution (WO9 FIX-3, config part):** `BOSS.frost.telegraph` 0.6 -> 0.8 (`src/config.js`, `zombie.js` `FROST_DEFAULTS` too). The pinned value in `tests/contracts.test.js` is updated. The light-floor alpha boost in `drawFrostCone` is render work and not part of FIX-3.
- **Resolution (FIX-2):** render part done: the frost telegraph fill is 1.6x brighter on the OUTPOST style (the telegraph duration is a config item for another fix agent).

### 6. LOW (art) — the greenhouse dome renders as half wooden hut, half concrete bunker
- **File:** `src/render.js` `paintOutpostWalls` → `kindOf`.
- **Repro:** look at the dome at x28-37, y4-10 (`wo9-qa-outpost-greenhouse-split-materials.png`). The E/W doorways split it into two connected components. The top half holds no machine, so it becomes `hut` (wood planks). The bottom half holds Juggernog, so it becomes `bunker` (concrete with orange stripes). It does not read as a greenhouse or dome at all.
- **Fix:**
  - In `kindOf`, merge hollow components whose bounding boxes overlap or touch within 2 tiles before choosing a kind. If any member holds a machine, use one material for all.
  - Better, add a `glass` kind for a building of width ≥ 8 with diagonal (octagonal) corners: pale cyan `#bfe6f5` panes, white `#f4fbff` mullions every 10 px, a frost gradient at the top edge and green plant specks inside the floor area.
- **Resolution (FIX-2):** the two dome halves are merged and drawn as a glass dome (cyan panes, mullions, frost, planting beds and faint dome ribs inside), detected by shape (merged hollow group >= 8x5 with cut corners).

### 7. LOW (art) — the radar array has no radar, and the storage shed looks like a fuel tank
- **File:** `src/render.js` `paintOutpostWalls`.
- **Details:**
  - The "dish plinth" (7-11, 6-9) is painted as a grey rock blob, and the "small dish" (15-16, 4-5) as an ice column (`wo9-qa-outpost-radar-array.png`).
  - The barracks storage shed (15-17, 32-34) is a solid 3x3 with a pocket, so it matches `tank` and draws as an orange-ringed fuel cylinder (`…-barracks-window-under-hud.png`).
- **Fix:**
  - Add hints to `LEVEL5.theme`: `dish: [9, 7]` and `shed: [16, 33]`.
  - In the free-block loop, draw a radar dish at the dish hint: white/grey disc with an offset feed-horn arm and a red beacon dot.
  - For the shed, use `hut` planks with a corrugated metal roof stripe instead of a tank.
- **Resolution (FIX-2):** the dish plinth draws a large radar dish (rings, feed horn on struts, red beacon), the small 2x2 block a small dish (arena ice columns unchanged), and the isolated shed a plank shed with a corrugated metal roof (optional `dish` / `shed` theme hints are honoured).

### 8. LOW (balance, level select) — teleporting to OUTPOST at round 0–1 with the MR6 is close to unwinnable
- **Repro:** fresh run → Shift+M → 5 → Enter → play. Zombies have 435 HP at round 1 and 725 at round 2 (healthMult 2.9), and 3 hits kill (50 each).
- **Result:** a kiting bot died in round 1 (1 kill), and died again in round 2 even with the KN-44. It ran dry of ammo on the KN-44 in round 3.
- **Expected:** practice teleport is a level browser, so the first rounds should be survivable.
- **Fix:** in `level.teleportTo` (or `pickLevel`), when the current round is below `index * 3` for the target level, skip the round counter to `max(round, index * 3)`, **or** grant a starting wall gun / 1500 points on a teleport into levels 4–6. Either is a practice-only change; the ranking is unaffected because practice runs are unranked.

- **Resolution (WO9 FIX-3):** `src/level.js` `teleportTo` now tops the player up to `teleportMinPoints(index)` = `LEVEL_SELECT.minPoints` (400, `src/config.js`) x the level index when the player has less. It never lowers points and it emits the usual `points:changed` (the grant is not added to `stats.pointsEarned`). It applies only on a teleport, never on a descent or a plain `startLevel`. OUTPOST (index 4) arrives with at least 1600 points, enough for a door and a wall gun. The round counter is unchanged.

### 9. LOW (art) — open spawns `O` are flat pinkish squares on the snow
- **File:** `src/render.js`, static layer, `code === T_OPEN` (`rgba(90,10,10,0.35)` square).
- **Details:** at (19,15) and (41,21) they read as a UI glitch or placeholder on white snow (see radar and fuel screenshots).
- **Fix:** when `th.style === 'outpost'`, draw a dug-up snow hole instead: a `#9fb4c8` ellipse (r 14x10) with a darker `#5f7488` inner ellipse (r 8x5) and 3-4 white clods at the rim.
- **Resolution (FIX-2):** open spawns on OUTPOST are drawn as a churned snow hole with clods and claw scrapes.

### 10. LOW — the "SEALED" label below the sealed mega door overlaps the player during the fight
- **File:** `src/render.js`, sealed mega-door labels (`sealedMegaBox`).
- **Details:** labels are drawn on both sides. The arena-side one sits right on the player when the player stands next to the door, and it is drawn over the player's gun (`wo9-qa-outpost-frost-telegraph.png`).
- **Fix:** draw the "SEALED" label only on the side facing away from `inArena(player)`, or fade it (alpha 0.35) when the player is within 60 px.
- **Resolution (FIX-2):** mega door plates (arena-side SEALED included) are re-blitted over the player at 35 % alpha.

### 11. INFO
- God mode also pauses the frost cooldown (`playerTargetable` excludes `invulnerable`), so screenshot sessions with god on never see a frost. This is intended, but worth knowing.
- Snowfall uses wall time, so it keeps falling while paused or in the level select. It looks pleasant and is not distracting: 120 small flakes with a subtle blue drop shadow, three depths, a wind wobble, and 36 static flakes under reduced motion.
- A label is drawn on both sides of every single-thickness wall item (HG 40 hut wall, Speed Cola, Juggernog). This matches the other levels.

## Art direction verdict (1.3)
**Strong:**
- **Open and different:** unmistakably unlike levels 1–4. It is a bright open snowfield with long sight lines, and the fights are in the open.
- **Fences and ice:** the chain-link fences with orange hazard rails and snow-capped posts look good, and the ice holes (dark water, bright jagged ice rim, cracks) read clearly at both zooms.
- **Buildings:** the fuel tanks, huts and the concrete command bunker look good.
- **Arena:** the "Ice cavern" (grey rock floor, faceted ice columns) is distinct.

**Contrast on snow:**
- Tan zombies read very well; dark-grey zombies with white heads read well.
- The green player is clear, and the boss (dark grey/white with a cold halo) is clear on both snow and arena.
- The only contrast problems are the HUD elements (#3).

**Weak:**
- The greenhouse (#6) and the radar array (#7) do not sell their names.
- The open spawns (#9) look unfinished.

## Pass / fail — Section 5, OUTPOST items
| Item | Result |
|---|---|
| Six levels in order; 5 passes the full validity suite and looks unmistakably different | **PASS** (`level5.test.js` 12/12; visually unique) |
| OUTPOST plays in the open with see-through ice holes | **PASS** (bullets and sight pass over all 63 pits; nobody walks on them; zombies path around) |
| Snowfall overlay | **PASS** |
| THE WENDIGO's frost breath is telegraphed, damages and slows | **PASS** functionally (0.6 s telegraph, 30 damage, 2 s at 55 %, SLOWED badge). **FAIL for fight quality** until #1 (boss wedge) is fixed; #5 is recommended |
| Level select reaches OUTPOST (Shift+M, 5, Enter; practice marked, game over "PRACTICE RUN — NOT RANKED") | **PASS** |
| `npm test` green | **PASS** (643/643) |
| Zero console errors on OUTPOST | **PASS** (0, desktop and touch) |
| Frame cost < 3 ms with boss + 10 minions + 24 zombies | **PASS\*** (0.47 avg / 0.80 p95 ms CPU; hidden tab, visible tab not obtainable) |

## Screenshots (`docs/screenshots/`)
- `wo9-qa-outpost-boss-stuck-ne.png` — #1, the boss wedged beside the NE ice hole
- `wo9-qa-outpost-m8a7-under-hud.png` — #2
- `wo9-qa-outpost-mobile-hud-contrast.png` — #3 (844x390)
- `wo9-qa-outpost-barracks-window-under-hud.png` — #4, #7 (shed as tank)
- `wo9-qa-outpost-frost-telegraph.png`, `wo9-qa-outpost-mobile-frost-telegraph.png` — #5, #10
- `wo9-qa-outpost-slowed-hud.png` — SLOWED badge, frosted player
- `wo9-qa-outpost-greenhouse-split-materials.png` — #6
- `wo9-qa-outpost-radar-array.png` — #7, #9
- `wo9-qa-outpost-fuel-depot.png`, `wo9-qa-outpost-command-bunker-pap.png` — zone looks, PaP, Mule Kick, Double Tap
- `wo9-qa-outpost-mobile-snowfield-crowd.png` — crowd contrast on snow at mobile zoom
- `wo9-qa-outpost-gameover-practice.png` — practice game over after a boss death
