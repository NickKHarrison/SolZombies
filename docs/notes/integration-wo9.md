# WO9 integration (Phase 2)

Integrator run against Phase 1 (A-I). `src/render.js` (Agent F) was still in progress and was not
edited; visuals were only looked at, not judged (see "Visual notes for F / QA").

## Changes

- **src/level.js**
  - `teleportTo(state, index)` (new export): cancels a running descent fade, then
    `startLevel(state, index, { arrive: true, teleport: true })`. You get the arrival relief as on a
    descent (full heal, `LEVELS_CFG.arrivalBreak`), also for index 0. A gun left in the Pack-a-Punch
    comes back upgraded through the existing `returnPapWeapon`. Round, points, weapons, perks and
    stats are kept. It emits `level:start { index, name, loop, teleport: true }` and then
    `level:teleport { from, to, name }`. `level.js` owns the `level:teleport` emit, so main does not
    emit it again. It returns `state.level`.
  - `startLevel(state, index, opts?)`: the optional third argument is backwards compatible.
  - Agent F reported that the frost slow carried over through the debug `setLevel` hook. Fixed:
    `startLevel` now resets `player.slowT = 0`, so every way into a level is covered (boot,
    restart, descent, teleport, `setLevel`). Covered by a new unit test. In the browser: slowed on
    OUTPOST with `slowT` 2, then `setLevel(2)` gives 0 with the SLOWED badge hidden, and a teleport
    gives 0.
  - `loopTheme` copies `style`, `wallStyle` and the level hint keys verbatim: `curtainRow`,
    `seatRows`, `stageRows`, `curtain`, `seat`, `lamp`, `grain`, `snow`, `ice`, `iceDeep`, `hutWood`,
    `water`, `spores`, `waterDeep`, `waterLight`, `moss`, `vine`, `glyph` and `pit`. KINO II,
    OUTPOST II and TEMPLE II keep their render style (checked in the browser).
  - `loopWallbuys` dedupe: an upgrade whose target is already on that level's walls (authored, or
    produced by an earlier upgrade) is skipped, and that letter keeps its authored gun. It repeats
    until stable and is deterministic. This fixes the LABORATORY II duplicates (`icr1 -> gorgon`,
    `xr2 -> m8a7`) and the new KINO/OUTPOST/TEMPLE II duplicates (`kn44 -> peacekeeper` and
    `manowar -> peacekeeper`).
- **src/main.js**
  - The level select is mounted in `#stage` with
    `initLevelSelect(stage, { levels: LEVELS, onPick, onClose })`.
  - `inp.levelSelect` toggles the overlay. It opens only from `playing` or `paused`, never from
    menu, game over or a descent fade. It stores the previous phase and sets phase `levelselect`,
    so the game is paused. Toggling again, or Esc / X (`onClose`), restores the previous phase.
  - `pickLevel(i)` calls `level.teleportTo`, sets `stats.practice = true`, forces a flow-field
    rebuild, closes the overlay, sets phase `playing` and calls `input.resetInput()`, so a card
    click fires no shot.
  - While the overlay is open, edges are stripped with `withoutEdges`, which now includes
    `levelSelect`.
  - The LEVELS button is wired through one channel only, `hud.onLevelsButton`, and only while
    paused. `touch.onLevelsButton` is not used.
  - Practice runs skip `scores.recordRun`. The summary gets `practice: true`, `recorded: false`
    and rank `null`. Ranked runs pass `practice: false`.
  - A restart closes the overlay.
  - Debug hooks: `levelSelect()` toggles and `levelSelect(i)` picks. `__game.modules.levelselect`
    was added.
- **src/hud.js** (integration fix)
  - A `level:teleport` listener queues `TELEPORTED — L<n> <NAME>` and drops any older TELEPORTED
    banner that is still waiting in the queue.
  - `onLevelStart` skips the "LEVEL n" banner when `p.teleport` is set.
- **tests/level.test.js**
  - The FIX-3 loop wall-buy test now asserts that no gun is sold twice. Each letter must be either
    the upgrade or the authored gun, and it may only stay authored when the upgrade would collide.
  - Four WO9 tests were added: teleport relief, events and fade cancel; the PaP hand-back; the loop
    theme hints; and the dedupe.
- **README**: covers levels 4-6 with their bosses and abilities, the level select (Shift+M /
  LEVELS, practice runs are not ranked), the Shift+M controls row, mega door prices 1250 / 1500, the
  PaP locations and the new debug hooks.

## Results

`npm test`: **643 / 643** pass, including `WO9 new exports`. `node --check` passes on every file in
`src/` and `src/levels/`.

Browser runs used port 8321 in a new tab. The tab was hidden, so `requestAnimationFrame` never ran
and frames were driven with `__game.debug.step`. Real key presses and mouse clicks were used where
noted below.

| Check | Result |
|-------|--------|
| Shift+M on the menu does nothing; plain M while playing does nothing | PASS |
| Shift+M opens the overlay (real key) with 6 cards, thumbnails, bosses, difficulty and the current card highlighted | PASS |
| Game paused while open (`state.time` frozen, hud phase `levelselect`) | PASS |
| Shift+M again closes it (restores `playing`); Esc from a paused game restores `paused` without also unpausing | PASS |
| Keyboard teleport: real `5` + Enter goes to OUTPOST; digits 1-6 + Enter reach all six levels (synthetic keydowns) | PASS |
| Mouse click on the L6 card teleports to TEMPLE with no stray shot | PASS |
| Banner "TELEPORTED — L5 OUTPOST" / "— L6 TEMPLE" / "— L4 KINO" | PASS |
| Heal to full, arrival break 10 s, round kept | PASS |
| Desktop pause-screen LEVELS button (real click) opens the overlay exactly once | PASS |
| Touch (`&touch=1`, `#stage` 844x390): 2-column scrolling overlay; real click on the KINO card teleports; a touch-pointer tap on LEVELS gives exactly 1 `levelselect:open`; the X button restores `paused` | PASS |
| Not openable during a descent fade or at game over | PASS |
| Practice game over shows "PRACTICE RUN — NOT RANKED" and the score table is unchanged; after a restart practice is false and a normal run is recorded (#1). Test scores were cleared afterwards | PASS |
| Descend 3 -> 4 -> 5 -> 6 -> BUNKER II through startBoss / killBoss / stairs / descend | PASS |
| Difficulty 2.4/2.9/3.5/4.2 health; mega door 1000/1250/1500/1750 | PASS |
| Loop variants: KINO II / OUTPOST II / TEMPLE II keep their style and hints; no duplicate wall guns (LABORATORY II fixed) | PASS |
| THE PROJECTIONIST (`#d9b25a`) charges (telegraph / dash / recover) and reaches 10 minions; killing it opens the stairs | PASS |
| THE WENDIGO: `boss:frost`, telegraph then breath, never charges; the hit sets `slowT = 2`; move speed ~121 px/s while slowed (55 %); HUD shows SLOWED | PASS |
| THE DROWNED KING: `boss:tide`, ring grows to ~416-420; in the open, one hit of 40 plus knockback; behind a pillar (no clear shot), no hit. "Outrun" means staying beyond the 420 radius, which is covered by unit tests | PASS |
| Frame cost (update + render + hud per `step`) with boss + 10 minions + 24 zombies: KINO avg 0.63 / p95 0.8 ms, OUTPOST 0.63 / 0.8, TEMPLE 0.60 / 0.9 (< 3 ms) | PASS* |
| Console errors from the game | PASS (0; the only errors came from a Chrome extension) |

\* Measured in a hidden tab, where the canvas is still drawn. QA should re-measure in a visible
tab with the final render.js.

## Notes / follow-ups

- **Balance (loops):** with the dedupe, KINO II, OUTPOST II and TEMPLE II sell exactly the same
  guns as loop 0. Their only upgradable guns (`kn44`, `manowar`) map to `peacekeeper`, which they
  already sell, and gorgon, drakon and marshal16 have no upgrade target. LABORATORY II now keeps
  `icr1` and `xr2`. If loops of levels 3-6 should feel stronger, add different upgrade targets in
  `LEVELS_CFG.loopWallUpgrade` (config) in Phase 4.
- The tide knockback measured 35 px at one spot near geometry: `resolveCircle` stops it at walls,
  as intended. Knockback in open floor is unit-tested at 120 px.
- A mouse click on the touch pause button in the hidden test tab did not pause the game. A
  touch-type pointer event did. This is pre-existing touch behaviour (buttons react to touch
  pointers), not WO9.
- Rapid repeated teleports: only the newest TELEPORTED banner waits in the queue. The one already
  showing plays out.

## Visual notes for F / QA (render.js not judged)

- Level select thumbnails and cards read well on desktop (3x2 fits) and on the phone (2 columns,
  scrolls).
- OUTPOST: the snow field, blue ice holes, the chain-link/spiky fences and the hazard stripes on
  gates are visible.
- TEMPLE II: water channels, flagstones and vines are visible and keep the temple look under the
  loop tint.
- KINO: red carpet with the diamond pattern, dark wood and gold trim, and lamps are visible.


## WO9 FIX-4 — camera over-scroll and bright-level contrast (QA KINO #4, OUTPOST #3, TEMPLE #9)

- **Camera (`src/main.js` `updateCamera`).** The clamp is now `[-padL, map.width - vw + padR]` (and the same for y). `CAM_PAD = { left: 0.2, right: 0.2, top: 0.16, bottom: 0.16 }` is a fraction of `canvas.height`, divided by `state.zoom`. The HUD is sized in cqh, so the margin matches the HUD corners on both desktop (zoom 1) and mobile (zoom 1.96). Small maps are still centred. The player stays centred except within one pad of an edge. The mouse-aim conversion (`mouseX / zoom + camera.x`) is unchanged and correct for negative offsets: in the browser the angle matched the cursor. `render.js` already clears to `#050506` before the world pass, so the void is dark.
- **Contrast (`styles.css`, `src/hud.js`).** `--hud-outline` is applied to the vitals labels and values and to the points value. `hud.updateLevelStyle(state)` sets `data-level-style` on `#hud` and `#stage`, taken from `map.theme.style` or else `level.def.theme.style`, and cleared on the menu. The CSS hooks `#stage[data-level-style="outpost"] …` cover `.tj-base`, `.tj-knob`, `.tbtn` and `.hud-vital-label`. Other bright levels can reuse this by adding their style name to the selectors.
- Verified in Chrome: KINO lobby and arena on desktop, and OUTPOST snow with `&touch=1` (844x390), with before/after screenshots. `node --check` passes for main.js and hud.js. `npm test`: 637/643. The 6 failures are level-validity checks from FIX-1's new interact-reach rule on the level data (other agents' in-progress files), not from this change.

## Final verification

Final pass after all WO9 fixes. `npm test`: **654 / 654**. Browser: `python -m http.server 8341`, new tabs
`/?debug=1` (1280x720 canvas) and `/?debug=1&touch=1` (`#stage` forced to 844x390, zoom 1.96).
Frames were driven with `__game.debug.step`, plus real key presses, mouse hover and clicks where
noted. No regressions were found, so no code was changed in this pass.

| Check | Result |
|-------|--------|
| Plain M does nothing. Real Shift+M opens the overlay with 6 cards, readable thumbnails, boss names and difficulty rows. The game is paused (`state.time` frozen) | PASS |
| Desktop teleport by real keys (Shift+M, digit, Enter) to all six levels: BUNKER, CATACOMBS, LABORATORY, KINO, OUTPOST, TEMPLE | PASS |
| Touch: a real click on the pause-screen LEVELS button gives exactly 1 `levelselect:open`. The 2-column list scrolls. A real click on the OUTPOST card teleports with 0 shots fired | PASS |
| Teleport top-up: from 20 points, KINO arrives with 1200 and OUTPOST / TEMPLE with 1600 / 2000. It never lowers points (L2 after KINO stays at 1200) and `pointsEarned` is unchanged | PASS |
| Practice game over shows "PRACTICE RUN — NOT RANKED" and the score table is unchanged | PASS |
| KINO: sweep of foyer rows 24-26, cols 28-42, pushing into the walls and pressing interact. Juggernog is never bought (only Double Tap and Marshal 16, both foyer items). Juggernog is buyable from the projection room | PASS |
| KINO: Quick Revive and KN-44 sit above the vitals/weapon HUD in the lobby bottom row (camera y 995). Floors are boards / asphalt / concrete. The booth grille, projector reels and reel-cabinet film cans are visible | PASS |
| KINO: THE PROJECTIONIST is gold (`#d9b25a`). The fight runs in the concrete vault. The faded SEALED plate is drawn over the player. Killing the boss opens the stairs and pays 200 | PASS |
| OUTPOST (touch): HUD labels, points, move/aim sticks and buttons read clearly on snow (`data-level-style="outpost"`). The glass dome, radar dishes and plank shed are visible | PASS |
| OUTPOST: THE WENDIGO was lured to 11 spots around both ice-hole lanes, 6 s each. It reached melee range (59-74 px) at every spot. The longest stand-still (1.17 s) was the frost cast itself, not a snag | PASS |
| OUTPOST: the frost telegraph lasts 0.80 s. Standing still in the cone gives -30 HP and `slowT` 2. A sideways dodge in the open during the telegraph avoids it 3/3 (176 px moved). A dodge pinned against a wall at melee range was hit once, which is expected | PASS |
| TEMPLE: THE DROWNED KING repro (player at (37,3), then (37,10)), repeated with the west corners and the centre. The boss reached every spot (59-68 px, within 2.1-7.1 s) with no stand-still over 0.02 s | PASS |
| TEMPLE: the tide telegraph and wave ring are cut at pillars and walls. The reach circle only shows along unobstructed rays, as FIX-2 designed. Pillar glyph bands (eye / pyramid) are visible | PASS |
| Camera over-scroll on all six levels: at the top-left corner the camera is at (-144, -115), and at the bottom-right it is 144 / 115 past the map edge | PASS |
| Mouse aim with a negative camera (OUTPOST corner, real hover): player angle 0.416 rad = the cursor's world angle 0.416 rad | PASS |
| Descent from TEMPLE -> BUNKER II (index 6, loop 1) | PASS |
| Restart after a practice game over: BUNKER, practice false, no perks, `slowT` 0. One kill pays exactly 10 | PASS |
| Console errors (hooked `console.error` + `window.onerror`, and the Chrome console) in both tabs | PASS (0) |
| Frame cost (update + render + HUD per step) with boss + minions + zombies = 35 alive. Desktop: KINO 0.25 / p95 0.5 ms, OUTPOST 0.48 / 0.9 ms (one 13 ms outlier), TEMPLE 0.23 / 0.4 ms. Touch 844x390: KINO 0.54 / 1.3 ms, OUTPOST 0.53 / 1.1 ms, TEMPLE 0.42 / 1.1 ms | PASS (< 3 ms) |

Notes (by design, not regressions):
- Wall-buy and perk plates are drawn on every open floor side. The KINO Juggernog on the reel
  cabinet shows 3 plates, and the OUTPOST Double Tap shows 4.
- The red slash next to the level chip is the round tally (`.hud-round-tally .stroke`).
- The tabs were mostly hidden, so frames were stepped. The canvas is drawn on every step, and the
  timings above are CPU time.

Screenshots: `docs/screenshots/wo9-final-levelselect-desktop.png`, `wo9-final-levelselect-phone.png`,
`wo9-final-kino-stage-pap.png`, `wo9-final-kino-alley.png`, `wo9-final-outpost-snowfield.png`,
`wo9-final-outpost-boss-frost.png`, `wo9-final-temple-bridges.png`, `wo9-final-temple-tide.png`.
