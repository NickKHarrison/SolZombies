# WO9 QA: Level 4 KINO playtest and look

## Run setup
- **Server:** `python -m http.server 8322`, stopped afterwards. The tab was closed.
- **Desktop:** a new Chrome tab at `/?debug=1` with a 1280×720 canvas. The tab reported `visibilityState: hidden` because other QA tabs shared the window, so `requestAnimationFrame` never ran. I drove the game with `__game.debug.step(1/60, 1/60, overrides)`, which gives a synchronous render + HUD every frame. Screenshots show the live canvas and DOM.
- **Touch:** `/?debug=1&touch=1` with `#stage` forced to 844×390. `mobile()` returned true and the zoom was 1.96.
- **Driver:** a small in-page bot:
  - BFS pathing to a target tile, moving with `moveX/moveY`;
  - aim with `aimVector` at the nearest zombie in line of sight, and fire on every fourth frame;
  - `interact` edges for purchases.

  Every door, perk, wall buy, box, Pack-a-Punch and mega-door purchase went through the **real interact path** (`purchase:made` events recorded). Points were topped up with `addPoints`; see finding 5 for why. `god` was used only for the traversal and screenshots. The fairness runs were played with god off.
- **Code state:** Phase 2 integration. `npm test` passed **643 / 643**.

## What was played
1. **Level select.** Started BUNKER with a real Enter key. A real **Shift+M** opened the overlay (phase `levelselect`). A real `4` selected KINO and a real **Enter** teleported. Result: the banner "TELEPORTED — L4 KINO", `practice: true`, a full heal, and the round kept.
2. **Lobby, rounds 1–3.**
   - With the MR6 only, a stationary bot died in round 1 (see finding 5).
   - I bought the KN-44 at the lobby wall (150) and fought rounds 1–3 in the lobby centre.
3. **Doors in order, all bought through interact.**
   - D (75): foyer. Double Tap was at hand, and **Juggernog could be bought from the foyer** (finding 1).
   - E (100): dressing rooms. I bought Speed Cola (300) and the box (95), which rolled a Drakon.
   - F (100): alley. I bought Stamin-Up (200).
   - G (125): projection room. I bought the M8A7 (375).
   - H (150): theatre.
4. **Theatre.** I walked the centre aisle to the stage. Pack-a-Punch on the M8A7 gave Pulsar (500): "Machine busy" for 3 s, then take. I fought rounds 5–6 in the centre aisle with god **off**, Jugg only, and a stationary bot. It survived: the lowest HP was 92/250, and zombies filed along the cross aisles.
5. **Mega door.** Bought through interact (1000) from the stage-left wing. THE PROJECTIONIST started (`#d9b25a`, `charge`, 18,576–19,872 HP). I saw the charge telegraph. A stationary bot was killed by 75-damage charges; that is expected for a bot that doesn't dodge.
6. **Touch.**
   - Pause, then a real click on **LEVELS**, then scrolled the 2-column overlay and clicked the KINO card. This teleported to KINO with practice set.
   - I took screenshots of the stage with Pack-a-Punch, the aisles and the boss.
   - Plain `m`: nothing happened. Shift+M opened the overlay and froze `state.time`. Esc restored `playing`.
7. **Zombie flow.** One zombie from each of the 10 spawns, all doors open, targeting the stage, the lobby, the projection room and the box room.
   - No zombie got stuck on geometry. The only "late" ones were queued in the crowd within 3 tiles of the player.
   - From the far lobby and dressing windows to the stage takes about 44 s.

**Console errors: none.** An `error` / `console.error` hook ran on both pages and caught nothing, and `read_console_messages` (onlyErrors) was empty.

**Frame cost** (update + render + HUD per `step`, hidden tab): boss + ≥10 minions (16 spawned) + 24 extra zombies (28–35 alive) gave **avg 0.62 ms, p95 1.1 ms** over 600 frames. Isolated `render.render` in each area measured avg 0.06–0.24 ms. There were occasional single-frame spikes of 16–22 ms (max). These show up in every area, including the empty stage view, so they look like hidden-tab canvas flushes or GC rather than a KINO cost. **PASS** (< 3 ms).

## Verdict as a player / art director
- **Clearly the homage:**
  - the theatre is excellent: long dark-red seat-back rows with gold trim, a 3-wide centre aisle, 2-wide cross and side aisles, zombies filing down the rows, and a red velvet pleated curtain line;
  - the stage has wood boards, and the **purple Pack-a-Punch dead centre on the stage** reads instantly on desktop and on the phone;
  - the lobby has a red carpet with a gold diamond pattern, dark wood walls with gold trim, and warm lamps;
  - door order, prices and flow feel good.
- **Weak spots:**
  - everything except the stage is the same lobby carpet: dressing rooms, the "outdoor" alley and the backstage vault (finding 2);
  - one sequence break (Jugg through the wall);
  - HUD corners sit on the lobby purchasables and on the arena.
- **Film grain:** subtle and static (a screen-space noise tile, peak alpha ≈ 0.12). It reads as a faint lens texture and does not flicker. **OK.**
- **Lamps:** warm amber-white sconces at an even spacing along the walls, and none on the seat rows (the busy-seat note from level4.md is fixed). **OK.**

## Findings

### 1. HIGH: Juggernog can be bought from the foyer through the wall (sequence break)
- **Where:** `src/levels/level4.js`, the ASCII layout. J sits at (41,23), in the one-tile wall between the projection room (row 22) and the foyer (row 24).
- **Repro:** open D only, then walk to the foyer's north-east corner at about (40,24), pixel (1620,975). The prompt reads "Press F for Juggernog [250]", and F buys it (`perk:bought {jugg}`). See `wo9-qa-kino-jugg-bought-from-foyer.png`.
- **Why it happens:** `map.nearestInteractable` measures distance to the machine's rect only. There is no wall or zone check, and `PLAYER.interactRange` is 64. The foyer tile (40,24) is diagonal to J, so a player there is 28–55 px from J's rect.
- **Why the tests miss it:** the checker's `validatePerks` "faces one zone only" rule only looks at the four orthogonal neighbours (N4). This was the only cross-zone leak my in-page scan found across all wall buys, perks, the box and Pack-a-Punch. The other hits from the scan are harmless and are listed in finding 8.
- **Expected:** Juggernog only after F + G, per the 3.4 perk plan (`jugg: 4`).
- **Actual:** Juggernog costs 75 points of doors (D only).
- **Fix (ASCII; validated in a scratch copy with `validateLevel(... OPTS) = []`, 25 free-standing blocks):** move J onto the reel cabinet in the middle of the projection room. It is then 94 px from both the theatre and the foyer floor.
  ```
  row 21  '###.............###5........###.....##.......G........######'
       -> '###.............###5........###.....#J.......G........######'   (37,21) '#' -> 'J'
  row 23  '###..........#..#########################J#W##...........###'
       -> '###..........#..###########################W##...........###'   (41,23) 'J' -> '#'
  ```
  Update the Juggernog location in `docs/notes/level4.md` to match.
- **Hardening (test owner, optional):** in `tests/helpers/levelcheck.js` `validatePerks` / `validatePap`, also require that no floor tile of another zone lies within Chebyshev distance 1 of the machine (the eight surrounding tiles). That is the same idea as the existing FIX-1 arena rule.
- **Resolution (FIX-1):** fixed as proposed. J moved (41,23) -> (37,21), onto the reel cabinet. The hardening landed as `checkInteractReach` in `tests/helpers/levelcheck.js`, run by `validateLevel` on all six levels. It measures from the player centre on any floor tile of another zone, inset by the player radius on blocked sides, so diagonal reach counts. It also flagged 2-thick-wall leaks in L2, L3, L5 and L6, all fixed (see docs/notes/level4.md). tests/level4 pins that the old spot fails.

### 2. MEDIUM: dressing rooms, alley and backstage vault reuse the lobby carpet, so the homage flattens into one building
- **Where:** `src/render.js`, `paintStyleFloor` (kino branch paints carpet on every floor tile) and `paintKinoWalls` (only the stage gets `paintStageBoards`). Also `src/levels/level4.js` theme hints.
- **Repro:** look at `wo9-qa-kino-alley-carpet.png`, `wo9-qa-kino-dressing-rooms-box.png` and `wo9-qa-kino-mega-door-arena.png`.
- **Expected (1.2):**
  - the alley is an **outdoor** strip with brick walls, trash bins and a fire escape;
  - the dressing rooms have mirrors and costume racks;
  - the vault holds scenery flats and prop crates.
- **Actual:**
  - all three use the red and gold diamond lobby carpet and gold-trimmed wood walls;
  - the trash bins, costume racks, crates and flats are identical gold-trimmed wood blocks;
  - the alley reads as another foyer, and the vault reads as more auditorium.
- **Fix:**
  1. In `level4.js`, add the theme hint below:
     ```
     floorZones: [
       { kind: 'boards',   x0: 3,  y0: 15, x1: 15, y1: 36 },  // dressing rooms + corridor
       { kind: 'asphalt',  x0: 46, y0: 20, x1: 56, y1: 36 },  // alley
       { kind: 'concrete', x0: 2,  y0: 2,  x1: 15, y1: 12 },  // backstage vault
     ],
     ```
  2. In `level.js`, add `floorZones` to the `loopTheme` verbatim hint keys.
  3. In `render.js`, handle the zones in `paintKinoWalls` right after `if (stage) paintStageBoards(...)`:
     - `boards`: call `paintStageBoards(c, map, z, cols)`;
     - `asphalt` / `concrete`: a flat grey fill (`#2a2a2e` / `#4a4640`) plus deterministic `ihash` specks, on `T_FLOOR` tiles only;
     - walls whose open side faces an asphalt tile: a brick course (`#5a2a1e` rows, `#3a1a12` mortar) instead of wood panels;
     - free-standing blocks inside the zones: skip the gold trim. Flats and crates get plain wood with cross-bracing; alley bins get dark green-grey lids.
  4. Optional: small mirror rectangles (pale blue-grey, 10×6 px) on dressing-room wall faces.
- **Resolution (FIX-1, data part):** `theme.floorZones` added to `level4.js`: `{ x0, y0, x1, y1, floor }` with boards (3,15)-(15,36), asphalt (46,20)-(56,36) and concrete (2,2)-(15,12). The key is `floor`, not `kind`. Painting is FIX-2 (render.js); the loopTheme copy is FIX-3.
- **Resolution (FIX-2):** KINO floor zones painted in `render.js` (boards / asphalt with cracks and puddles / concrete slabs), walls facing the alley are brick, vault walls cinder block, dressing-room walls plain wood with mirrors; zone props are bins, crates, scenery flats and costume racks without gold trim (see `docs/notes/render.md` WO9 FIX-2).

### 3. MEDIUM: on desktop, the lobby's Quick Revive and KN-44 always sit under the HUD corners
- **Where:** `src/levels/level4.js`: Q (17,37) and `1` KN-44 (44,37), both in the lobby's bottom wall. The camera is clamped to the map's bottom edge whenever you are in the lobby (camera y = 880), so the bottom wall is always at screen y 600–640.
- **Repro:**
  - Arrive in KINO. The Quick Revive cabinet is covered by the points counter and the perk/health block; only its "QUICK REVIVE 50" plate shows.
  - The KN-44 chalk outline is covered by the weapon HUD (holstered-name row).
  - See `wo9-qa-kino-lobby-hud-covers-revive.png`.
- **Expected:** the start room's perk and cheap gun are visible at a glance.
- **Actual:** both are hidden or half-hidden behind the HUD for the whole lobby phase.
- **Fix (ASCII; validated with `validateLevel = []`):** put Quick Revive on the ticket booth's south face, right above the start. Move the KN-44 to the west staircase face at screen x ≈ 220, clear of the HUD.
  ```
  row 33  '###..........#..##..........######..........##...........###'
       -> '###..........#..##..........##Q###..........##...........###'   (30,33) '#' -> 'Q'
  row 37  '#################Q####W################W####1#######8#######'
       -> '######################W################W#############8#######'   (17,37) 'Q' -> '#', (44,37) '1' -> '#'
  row 30  '###..........#..#####....................#####...........###'
       -> '###..........#..####1....................#####...........###'   (20,30) '#' -> '1'
  ```
  - The KN-44 is still 15 tiles (Manhattan) from P and at least 10 from every other wall buy.
  - Quick Revive is 7 tiles from the Marshal 16 and 18 from the KN-44.
  - (20,30) is also in reach from the foyer tile (20,28). That is harmless for the cheap lobby gun.
  - If the booth-mounted Quick Revive feels wrong, the camera fix in finding 4 also solves this without ASCII changes.
- **Resolution (FIX-1):** Quick Revive moved (17,37) -> (30,33), as proposed. KN-44 moved (44,37) -> **(19,31)**, not (20,30): (20,30) is 54 px from the foyer floor on row 28 and fails the new interact-reach check. (19,31) is the same west staircase face, one step down.

### 4. MEDIUM: the arena (backstage vault) and stairs sit under the top-left HUD
- **Where:**
  - `src/main.js` `updateCamera`: it clamps the camera to `[0, map.width - vw]`.
  - The KINO arena is in the map's top-left corner (cols 2–15, rows 2–12).
- **Repro:** start the boss and fight in the vault's west half. See `wo9-qa-kino-boss-under-hud.png`.
  - The round numeral "7" and the "L4 KINO" chip are drawn over the player, the boss and the telegraph.
  - The X minion spawn at (2,2) is under the portrait.
  - The stairs T (1,6–8), where the player must go after the kill, are next to the round numeral.
- **Expected:** the boss fight is readable, with no HUD over the action.
- **Actual:** HUD elements sit on top of the fight at the left edge.
- **Fix:** let the camera run past the map edge by a HUD-safe margin. This helps every level with edge content: the KINO lobby, the box at (3,25), HG 40 at (24,1) next to the portrait, and the arena. The area beyond the map already renders as black void.
  ```js
  const PAD_X = 140, PAD_Y = 80; // world px; ~HUD width / portrait height at zoom 1
  cx = m.width  <= vw ? (m.width  - vw) / 2 : Math.max(-PAD_X, Math.min(m.width  - vw + PAD_X, cx));
  cy = m.height <= vh ? (m.height - vh) / 2 : Math.max(-PAD_Y, Math.min(m.height - vh + PAD_Y, cy));
  ```
  - Scale the pads by `1 / z` on touch.
  - Put the constants in `CAMERA` (`config.js`).
  - An ASCII-only alternative is not practical: the arena must stay 130–220 tiles, and the whole 60-column map is already used.

- **Resolution (WO9 FIX-4):** fixed in `src/main.js` `updateCamera`. The camera may now run past each map edge by a HUD-safe margin (`CAM_PAD`: left/right 0.20, top/bottom 0.16 of the canvas height, divided by the zoom, so the on-screen margin is the same on desktop and mobile). Browser check (KINO, 1280x720): in the lobby bottom row the camera goes to y 995 (was 880) and the Quick Revive / KN-44 wall sit above the vitals and weapon rows. In the arena (player at 4,4) the camera is at (-144, -115), so the vault, the X spawn and the stairs clear the portrait and the round/level chips. The void outside the map renders as the `#050506` background. Mouse aim was checked with the negative camera: the player angle matched the cursor's world point (-0.158 rad both). The constants live in main.js, not `config.js` (not FIX-4's file).

### 5. LOW (practice only): teleporting to KINO at round 1 with the start pistol runs out of ammo in round 1–2
- **Where:** a `level.teleportTo` / KINO difficulty interaction. This is by design ("round counter kept, player keeps weapons").
- **Repro:** from a new BUNKER run, Shift+M, then 4, then Enter. KINO round-1 zombies have 360 HP (150 × 2.4). The MR6 does 50 damage with 88 rounds, which is about 10 kills or 100 points. That is too little to reach the KN-44 (150) plus door D (75), so a player with only the pistol has to fall back on the knife.
- **Expected:** practice teleport is a free level browser.
- **Actual:** the level is nearly unplayable from a fresh run without the knife.
- **Fix (optional, config/integration):** on `teleport: true`, grant a minimum of `LEVELS_CFG.teleportStartPoints` (for example 500) if the player has less. Or show a one-line hint in the level-select footer: "Tip: teleporting from round 1 keeps your pistol". No change is needed for the real descent path.

- **Resolution (WO9 FIX-3):** `src/level.js` `teleportTo` now tops the player up to `teleportMinPoints(index)` = `LEVEL_SELECT.minPoints` (400, `src/config.js`) x the level index when the player has less. It never lowers points and it emits the usual `points:changed` (the grant is not added to `stats.pointsEarned`). It applies only on a teleport, never on a descent or a plain `startLevel`. KINO (index 3) arrives with at least 1200: enough for door D (75) plus the KN-44 (150) and its ammo. Tests: `tests/level.test.js` "WO9 FIX-3 teleportTo tops points up".

### 6. LOW: the mega door "SEALED" / "MEGA DOOR 1000" plates draw over the player
- **Where:** `src/render.js`, plate labels drawn after entities.
- **Repro:** stand in the stage-left wing at (17,4), or call `startBoss()`, which places the player next to M. See `wo9-qa-kino-touch-boss-sealed-plate.png` and `wo9-qa-kino-mega-door-arena.png`.
- **Actual:** the plate covers the player sprite at the start of the boss fight.
- **Fix:** fade the plate to 0.35 alpha while the player is within 1 tile of the plate rect. Or offset the mega door plates 1 tile further out than normal door plates. The same issue was noted in WO8 for the PaP plate, so this is general and not specific to KINO.
- **Resolution (FIX-2):** mega door plates (SEALED and MEGA DOOR) are re-blitted over the player at the 35 % buy-plate alpha (`render.js`).

### 7. LOW: some decor reads as generic blocks
- **Lobby staircases:** they are stepped wall notches, not "stepped floor". Fix in render: stair-tread lines (3 px darker stripes every 8 px) on the floor tiles in the notch.
- **Ticket booth:** a plain block. Fix: a lighter counter strip and a brass grille.
- **Projector and reel cabinet:** plain gold-trimmed blocks (`wo9-qa-kino-projection-room.png`). Fix: a lens circle and beam cone toward the auditorium, drawn once in the static layer from `projector` hint coordinates.
- **Balcony boxes:** plain blocks.
- **THE PROJECTIONIST:** reads mostly grey. The tint `#d9b25a` only shows as a small gold patch. Fix (boss sprite tint strength, `render.js` boss draw): raise the tint mix for the `charge` boss, or add a gold coat band.
- **Resolution (FIX-2):** lobby staircases get stair treads with brass nosing, the ticket booth a counter strip, dark glass and brass grille, the projector reels + lens + a faint beam toward the seats, the reel cabinet film cans; THE PROJECTIONIST body is washed in its gold tint (mix 0.42). Balcony boxes unchanged.

### 8. LOW: cross-wall reach that is harmless
- The in-page scan (every interactable against every zone's floor, 64 px range, player radius 14) found these reaches besides finding 1:
  - the foyer window (20,24) can be repaired from the projection room;
  - the lobby KN-44 (44,37) is reachable from the alley's corner;
  - the lobby Quick Revive is reachable from the dressing corridor;
  - door G is reachable from the theatre.
- None of these breaks progression. Listed for completeness; the finding 1 hardening would flag the perk ones.

### 9. LOW: level-select card detail
- **Where:** the `src/levelselect.js` card.
- **Card number:** the "L1…L6" number is low-contrast dark-on-dark, especially on touch (`wo9-qa-kino-levelselect-touch.png`).
- **Difficulty row:** the card shows `HP x2.4 · SPD x1.22` only. 1.5 asks for "the difficulty row", and the level's count and sprint values are left out.
- **Fix:** brighten the number to the level accent at full opacity. Optionally append `· ×1.6 · SPRINT R7` in a smaller span.
- **Resolution (FIX-2):** `levelselect.js`: the L-number uses the level accent lifted to readable luminance on a dark chip; the difficulty row now also shows `COUNT xN · SPRINT +N` (`difficultyExtra`).

### 10. INFO: flow deviation from 1.2, accepted
- 1.2 has the projection room behind H with Mule Kick and the mega door. The build puts it behind G, holding Juggernog. The theatre is the deepest zone with Mule Kick, and the mega door is in the stage-left wing.
- level4.md documents this as forced by the frozen checker (Mule Kick, Pack-a-Punch and M share the deepest zone, and Pack-a-Punch belongs centre-stage).
- In play it feels right: you climb the fire escape into the booth above the stalls and drop down into the theatre.
- The box sits in a dead-end dressing room with a 2-tile doorway and a costume rack. It is tense but fair, as in the original.

## Section 5 status (KINO + level select)
| Item | Result | Notes |
|------|--------|-------|
| Six levels in order; KINO passes the full validity suite and looks unmistakably different | **PASS** | `validateLevel(LEVEL4, OPTS) = []`; `npm test` 643/643; red and gold theatre, unlike levels 1–3, 5 and 6 |
| KINO reads as the theatre homage (lobby, foyer, dressing rooms, alley, auditorium with seat rows and aisles, Pack-a-Punch centre-stage, projection room, red-and-gold look) | **PARTIAL** | Lobby, foyer, auditorium, stage, Pack-a-Punch and the red-and-gold look pass. The dressing rooms, alley and vault don't read as their rooms (finding 2). The Jugg sequence break is finding 1 |
| Shift+M opens the level select with thumbnails; teleport works on desktop and touch; paused while open; practice not ranked; plain M does nothing | **PASS** | Real Shift+M, 4, Enter; touch LEVELS click and KINO card click; `state.time` frozen while open; Esc closes; "PRACTICE RUN — NOT RANKED" on game over; plain `m` did nothing |
| Difficulty rises (KINO 2.4 / 1.22) | **PASS** (KINO) | Round-1 zombie HP 360 = 150 × 2.4; the card shows HP ×2.4 / SPD ×1.22 |
| Zero console errors | **PASS** | Desktop and touch |
| Frame cost < 3 ms with boss + 10 minions + 24 zombies | **PASS** | avg 0.62 ms, p95 1.1 ms (hidden-tab caveat, see above) |

## Screenshots (`docs/screenshots/`)
- `wo9-qa-kino-levelselect-desktop.png`: Shift+M overlay with KINO selected by key `4`.
- `wo9-qa-kino-levelselect-touch.png`: touch overlay (2 columns, scrolled), KINO card.
- `wo9-qa-kino-lobby-arrival.png`: lobby on arrival: booth, stepped corners, foyer ring and Marshal 16 railing. The debug flow arrows were still on in this shot.
- `wo9-qa-kino-lobby-hud-covers-revive.png`: Quick Revive under the points and HUD, KN-44 under the weapon HUD (finding 3).
- `wo9-qa-kino-jugg-bought-from-foyer.png`: Juggernog bought from the foyer with only D open (finding 1).
- `wo9-qa-kino-dressing-rooms-box.png`: dressing rooms, Speed Cola, Gorgon and the box offering a Drakon; carpet everywhere (finding 2).
- `wo9-qa-kino-alley-carpet.png`: the alley in lobby carpet (finding 2).
- `wo9-qa-kino-projection-room.png`: projection room, projector and cabinet blocks, M8A7.
- `wo9-qa-kino-theatre-seats.png`: entering the stalls through H: seat rows and centre aisle.
- `wo9-qa-kino-stage-pap-desktop.png`: stage boards, curtain, Pack-a-Punch centre-stage, Mule Kick and HG 40.
- `wo9-qa-kino-aisle-fight.png`: zombies filing along the cross aisles, Pulsar in hand.
- `wo9-qa-kino-mega-door-arena.png`: mega door plates and the carpeted vault.
- `wo9-qa-kino-boss-under-hud.png`: THE PROJECTIONIST's charge telegraph under the round numeral (finding 4).
- `wo9-qa-kino-touch-stage-pap.png`: touch: Pack-a-Punch centre-stage, clearly visible.
- `wo9-qa-kino-touch-aisles.png`: touch: seat rows and aisles at mobile zoom.
- `wo9-qa-kino-touch-boss-sealed-plate.png`: touch: SEALED plate over the player (finding 6).
