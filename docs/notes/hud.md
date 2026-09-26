# HUD notes (Agent J) — `src/hud.js`, `styles.css`

## What was built
- `initHud(rootEl)` builds the whole overlay inside `#hud` (falls back to `document.getElementById('hud')`)
  and subscribes to `points:changed`, `round:start`, `powerup:collected`. It is **idempotent**: calling it
  again (restart flow) unsubscribes its previous listeners, clears the root and rebuilds, so it works
  whether or not main calls `events.clearAll()` first.
- `updateHud(state)` reads state each frame; every DOM write goes through `setText` / `setClass` /
  `setHidden`, which cache the last value on the element and skip unchanged writes.
- Widgets (per 5.11):
  - Bottom-left points (yellow). `points:changed` spawns a floating `+N` (or red `-N` for spending) that
    removes itself on `animationend` (max 6 concurrent), and positive deltas give the number a small bump.
  - Left-center round: Georgia italic blood red. Rounds 1-4 are tally strokes, round 5 is four strokes plus
    a diagonal slash, round 6+ a numeral, round 0 (pre-round-1 delay) shows nothing.
    `.break` class (while `rounds.phase === 'break'` and round > 0) fades to a brighter red via CSS
    transition and back when the next round goes active; `round:start` plays a white-to-red flash.
  - Bottom-right weapon: active = `tempWeapon || weapons[activeSlot]`; secondary name (small, above) is the
    other slot, or the active slot weapon while a Death Machine is held. Death Machine
    (`def.id === 'deathmachine'` or a non-finite mag) shows `∞`. Reserve (and mag) turn red at 0.
    `reloading` pulses the block red and shows "RELOADING".
  - Top-center power-up chips: one per key of `state.powerups.active`, label + `ceil(expiresAt - time)`
    seconds, flashing when <= 5 s. Insta-Kill chip has a skull glyph pulse.
  - Bottom-center prompt from `state.shop.prompt.text`, grey when `canAfford === false`. Only shown while
    `phase === 'playing'`. A "FIRE SALE!" banner animates for 3 s on `powerup:collected {type:'fireSale'}`.
  - Center screens for `menu` (title, start hint, controls list), `paused`, `gameover` ("YOU SURVIVED N
    ROUNDS", kills, points earned, accuracy, restart hint). Rebuilt only on phase change.
- Null-safe: `state.player`, `state.rounds`, `state.shop.prompt` may be null; widgets hide.

## Layout / styles
- `#stage` is absolutely centered with `width: min(100vw, 100vh*16/9)`, `height: min(100vh, 100vw*9/16)`
  on a black page; canvas fills it (`image-rendering: auto`, `cursor: crosshair`).
- `#hud` is `position:absolute; inset:0; pointer-events:none; container-type:size`. All HUD sizes use
  `cqh` so the HUD scales exactly with the canvas; a `vmin` fallback is declared for the main font sizes.
- Menu/gameover/paused screens also have `pointer-events: none`, so a canvas click still starts the game.

## Assumptions / decisions
- `POWERUP_LABEL` is imported from `powerups.js`; missing keys fall back to a local label map (same text as 5.8).
- Health is not shown in the HUD (spec gives it to render's damage vignette).
- Gameover round count uses `stats.roundReached`, falling back to `rounds.round`.
- Accuracy = `round(shotsHit / shotsFired * 100)%`, 0% when no shots.
- Colors mirror `COLORS.hudText/hudPoints/hudRound` as CSS variables (CSS cannot import config.js).

## No contract deviations. No constants for config.js
(`CHIP_FLASH_SECONDS = 5` and `MAX_POINT_FLICKS = 6` are HUD-local presentation constants.)

## WO2 (Agent F) — 3.8 status bezel + face

### Built
- `.hud-status` bezel at bottom centre: bevelled steel plate (CSS gradients, light top/left and dark
  bottom/right borders, corner rivets via radial gradients, faint striations). Three children:
  `.hud-status-health` ("HEALTH" + `NN%`), `.hud-face` (dark recessed window around a
  `<canvas width=24 height=30 class=hud-face-canvas>` shown at 13.333cqh x 16.667cqh = 4x at 720p,
  `image-rendering: pixelated`), and `.hud-status-kills` ("KILLS" + `state.stats.kills`). The readout wells are
  recessed (inverted bevel). The font is bold `"Courier New"`/monospace with a hard offset shadow, and no web fonts.
- Health % = `ceil(health/maxHealth*100)` (0 when down). Class `warn` (yellow) below 65 %, class `crit` (red, with a
  2-step dark-red pulse in the well, frozen on pause/gameover) below 25 % or when down.
- The bezel height is fixed (`--status-h: 21.5cqh`, `--status-bottom: 1cqh`). `.hud-bottom-center` (prompt + FIRE SALE
  banner) is placed at `bottom: calc(--status-bottom + --status-h + 1.2cqh)`, so it always sits just above the bezel.
  The banner's intro scale now uses `transform-origin: center bottom`, so it grows upward and never over the bezel.
- The bezel is hidden in `menu` (CSS `[data-phase]`) and when `state.player` is null. It stays visible on `gameover` and
  `paused`, with `z-index: 2` so it sits above the dimmed overlay and shows the dead face.
- Face: `faceState = createFaceState(1)` on every `initHud`. Each `updateHud` calls
  `updateFaceState(fs, frac, player.down, dt)`, where dt = `state.dt` only while `phase === 'playing'`. Otherwise
  it is 0, because `state.dt` is stale while paused. `composeFace` + `putImageData` runs only when `faceFrameKey`
  changes. The sprite pixels are copied into a fresh `ImageData`, and sprites with a size mismatch are skipped.
- Listeners (all dropped on re-init via `unsubs`):
  - `player:damaged` → `faceEvent('hurt')`.
  - `powerup:collected` → grin.
  - `weapon:equipped` with `slot >= 0` → grin. Slot -1, the Death Machine, is already covered by its power-up grin.
  - `game:start` and `game:restart` set a 1 s grin block, which is also set on `initHud`. The block counts down with
    the same playing-only dt.

### Verified
- In the browser on port 8095, stepped with `__game.debug.step`:
  - Tiers: 74 % white, 60 % yellow, 20 % red. Game over shows 0 % red with the bezel over the overlay.
  - Face redraws, counted by spying `putImageData`: suppressed for 1 s after restart, grin on a new gun after that
    and on a max-ammo pickup, hurt on damage, and each timer's expiry redraws.
- 1920x958 stage: points right edge 176 px < bezel 633–1287 px < weapon 1479 px. Prompt bottom 731 px < bezel top 742 px.
- Forced 480x270 stage (narrow-window equivalent): the same proportions hold, with no overlaps.
- `node --check src/hud.js` OK.
- `npm test`: 240/241. The only failure is "art complete: no placeholder sprites", from the soldier art that is still
  a placeholder (Agent A's area), which is unrelated to the HUD.

### Notes for others
- `main.js` restart does `clearAll` → `initAll` (initHud) → `game:restart` → `game:start`, so the grin block
  works either way.
- While testing, `render.js` was briefly broken mid-edit (`resetAnim` undefined); it was fixed by Agent E shortly after.

## FIX-4 (QA visual #7, review #1)
- **Bezel width (#7):** `.hud-status-cell` is `flex: none; box-sizing: border-box; width: 26cqh; white-space: nowrap; overflow: hidden`, with padding `0.6cqh 1cqh`. The bezel width no longer depends on the text. It was measured at a constant 726.2 px (1568-px stage) for 100/67/45/14/4/0 %.
- **Grin only on a genuinely new weapon (review #1):**
  - `seenWeapons` is a `WeakSet` of weapon objects. It is filled from `player.weapons` at the end of every `updateHud`, and it and `seenPlayer` are reset on `initHud`.
  - `onWeaponEquipped` (slot >= 0) looks up `seenPlayer.weapons[slot]` and grins only if that object is unseen, as when buying or taking from the box, where `giveWeapon` stores the new object before emitting.
  - Swaps and Death Machine expiry re-emit with an already-seen object, so they do not grin.
  - A new player object after a restart is marked silently.
  - The Death Machine still grins via `powerup:collected`. The 1 s post-start grin block is kept.
  - No new events, and `player.js` is unchanged.
- **Verified in browser:**
  - Grins: a new gun, replacing a gun, and a power-up.
  - No grin: a swap, Death Machine equip/expiry by direct call, restart, and idle.

## WO3 (Agent A) — status bezel lower-left at 0.8 scale
- **Only `styles.css` changed** (no DOM or JS change).
- **Variables** in `:root`:
  - `--status-scale: 0.8`, `--status-left: 3cqh`, `--status-bottom: 3cqh` (was 1cqh).
  - `--status-h: calc(21.5cqh * scale)`, so it holds the *scaled* height.
  - `--status-w: calc(76cqh * scale)` is the approximate outer bezel width. It is used only to keep the prompt clear of the bezel.
- **Bezel:** `.hud-status` is anchored `left: var(--status-left); bottom: var(--status-bottom)`, with no `translateX`.
  - Every bezel size is now `calc(<WO2 value> * var(--status-scale))`: padding, gap, border, radius, rivet gradients, striations, box/text shadows, cell width/padding/border, label/value fonts, face padding/border, and the face canvas size.
  - The face canvas is still 24x30 backing pixels, drawn pixelated.
  - Cells keep the FIX-4 fixed width, now 20.8cqh.
- **Points:** `.hud-points` has `left: var(--status-left); bottom: calc(--status-bottom + --status-h + 1.2cqh)`, so it sits directly above the bezel.
  - Its font, text shadow and the `+N` / spend flicks are unchanged.
- **Prompt and banner:** `.hud-bottom-center` is back at `bottom: 6cqh`, centred.
  - Its width is now `calc(100% - 2*(--status-left + --status-w + 1.5cqh))`, which is about 47cqh at 16:9. It was 70%.
  - It also has `text-wrap: balance`. The one prompt too long for that width, `Press F for Mystery Box [950] FIRE SALE`, wraps to two lines instead of running under the bezel. All other prompts stay on one line.
- **Fire Sale banner:** the intro scale is now 1.6 → 1.3, so its first frame (428 px wide on a 1604-px stage) stays clear of the bezel.
- **Measured** in the browser (`?debug=1`, stepped):
  - **1280x720 forced stage:**
    - Bezel is 436.8 x 123.8 px (17.2cqh).
    - Face is 76.8 x 96 px.
    - Each health/kills cell is 149.8 px wide (20.8cqh).
  - **Default 1604x902 stage:**

    | Element | Position / size |
    |---|---|
    | Bezel | x 27–574, y 3–20.2cqh from the bottom |
    | Points value | 21.4–29.4cqh from the bottom |
    | Round counter | bottom edge 43.5cqh from the bottom |
    | Prompt | x 641–962, 6.0–10.3cqh from the bottom |
    | Banner | 11.8–18.4cqh from the bottom |
    | Weapon | x 1464+ |
    | Chips | top |

    - Gap between the bezel and the Sheiva prompt: 68 px.
    - Worst-case prompt gap: 15.5 px for the wrapped Mystery Box prompt, 19 px for Haymaker 12 [1500].
    - No rect overlaps among round, points, bezel, prompt, banner (at 1.3x and at 1x), weapon and chips.
  - **960x540 forced stage:**
    - Bezel is 326.4 x 92.9 px, at x 16–343.
    - Prompt starts at x 384.
    - No overlaps. The worst-case prompt gap is 10 px.
  - **Bezel width:** constant at 100/67/45/30/10/7/1 % health: 546.45 px (1604 stage) and 326.36 px (960 stage).
  - **Phases:** game over shows the bezel with 0 % and hides points; the menu rules are unchanged.
  - Zero console errors. `npm test`: 263/263 pass.

## WO4 (lead, direct change): face top-left, plain health/kills bottom-left

User request: the bottom status bezel still covered gameplay. The face moves to the top-left corner
inside its own small steel box; HEALTH and KILLS lose their recessed wells and adopt the weapon/ammo
readout style (no background, HUD sans font, 5cqh weight-800 value, 2cqh dim uppercase label),
placed in the bottom-left. Points sit directly above them.

- DOM (`hud.js` `build`): the single `.hud-status` bezel is replaced by `.hud-facebox` (steel frame
  containing `.hud-face` + the 24x30 canvas) and `.hud-vitals` (`.hud-vital-health`,
  `.hud-vital-kills`, each `.hud-vital-label` + `.hud-vital-value`). `els.status` became
  `els.faceBox` + `els.vitals`; `updateStatus` hides both when there is no player. The warn/crit
  classes still go on the health element. No behaviour change to the face state machine.
- CSS: `--status-top` added; `--status-h` (9cqh) and `--status-w` (34cqh) now describe the
  bottom-left readout block, so the points block and the bottom-centre prompt width cap still work.
  Face keeps the WO3 0.8 scale (77x96 px at 720p). Health has a 13.5cqh min width so "100%"->"7%"
  never shifts KILLS. Crit health blinks the number (opacity) instead of the old well background.
- Verified in Chrome at a 1604x902 stage: face box 137x156 px top-left; vitals 214x80 px
  bottom-left; points directly above; no rectangle overlaps among face box, vitals, points, round
  counter (round 7), weapon readout, power-up chips and the widest prompt ("Press F for Mystery
  Box [10] FIRE SALE"). Game over shows the dead face and red 0%; menu hides face box and vitals;
  zero console errors through start, death and restart. `npm test` 263/263.
