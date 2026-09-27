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

## WO5 (Agent F) — boss bar, banner queue, level label

- **Boss bar** (`.hud-boss`, top-centre at `top: 8.2cqh`, 56cqh wide, fixed position below the
  power-up chip row whether or not chips show). Georgia-italic red boss name + a track with a red
  fill (`.hud-boss-fill`) over a white damage-lag bar (`.hud-boss-lag`). Visible only while
  `state.boss?.phase === 'active'`; hidden on menu/game over via `[data-phase]` CSS, shown while
  paused. HP from `bossMod.bossHpFrac(state)` (`import * as bossMod from './boss.js'`, guarded
  with `typeof` + try/catch, clamped 0..1). Lag: on a fresh hit the white bar holds 0.45 s, then
  drains at 0.6 of max HP/s to the fill; heals snap it up; a new `bossId` resets it. Lag timers
  use `state.dt` only while playing (frozen when paused), like the face.
- **Banner queue.** The single `.hud-banner` element (fire-sale style) now plays a queue:
  `FIRE SALE!` (powerup:collected fireSale), `BOSS: <name>` (boss:start), `STAIRS OPENED`
  (boss:defeated), `LEVEL <index+1> — <NAME>` (level:start with `index > 0`; index 0 is
  suppressed per the scaffold note). A banner requested while one is showing waits its turn (max
  4 queued, identical waiting text not duplicated), so nothing clobbers the fire-sale banner.
  Advancing is on `animationend`, with a `performance.now()` fallback in `updateHud` (3.4 s) in
  case the event is lost. The queue is flushed on entering menu/game over (the banner's parent is
  `display:none` there, so its animation never ends) and on `initHud`. Banners longer than 14
  chars get `.long` (4.4cqh, nowrap) so they stay on one line.
- **Level label** (`.hud-level`, inside `.hud-round` below the tally/numeral): `L<index+1> <NAME>`
  from `state.level.name || state.level.def.name`, shown whenever `state.level` exists (small,
  1.9cqh, dim warm grey sans). Hidden with the round block on the menu.
- Megadoor/stairs prompts need nothing new: `state.shop.prompt` with `blocked`/`canAfford:false`
  already renders grey.
- **Verified** on port 8156 (`?debug=1`, stepped, faked `state.level` / `state.boss`, events
  emitted through `__game.modules.events`): queue order FIRE SALE! → BOSS: THE BONE PRIEST →
  STAIRS OPENED → LEVEL 2 — CATACOMBS (level index 0 suppressed); bar 100% → 65% with white lag
  holding at 100%, 85% mid-drain, 65% caught up; bar hidden when phase 'idle', on game over and
  menu, shown when paused. Rects at a 1604x902 stage: face box x185–321, boss bar x707–1212
  y73–126, chips y22–59, long banner x612–1307 (vitals end x399, weapon starts x1621), no
  overlaps. No console errors. `node --check` OK; `npm test` 299/300 (only the expected
  Phase-1 `WO5 new exports` failure, owned by siblings).

### WO5 FIX-3 (playtest #5)
- `.hud-level` is an inline-block with a small dark plate (`rgba(0,0,0,.55)`, 0.5cqh radius), so
  wall-buy labels under "L2 CATACOMBS" no longer bleed through.
- `.hud-weapon` has a faint backing (`rgba(0,0,0,.38)`) for the same reason; the reload pulse
  keyframes now start from a dark-red 0.4 alpha so the plate never lightens while reloading.
- The face box is already an opaque steel frame; no change. No `hud.js` change was needed.

## WO6 (Agent B) — touch layer styles, mobile HUD, rotate overlay

### Built
- **styles.css**
  - `html, body`: `touch-action: none`, `overscroll-behavior: none`, `(-webkit-)user-select: none`,
    `-webkit-touch-callout: none`, transparent tap highlight. `#game` keeps `cursor: crosshair`.
  - `#touch` (sibling of `#hud` in `#stage`): absolute inset 0, `z-index: 3`, `pointer-events: none`,
    `touch-action: none`, and its own `container-type: size` so `cqh` inside it = 1% of stage
    height (same as in `#hud`). Children (zones, buttons) get `pointer-events: auto`; base, knob and
    `.tbtn-label` are `pointer-events: none`.
  - `.tj-zone.tj-left/.tj-right`: transparent full-height halves (z 1). `.tj-base` 26cqh ring
    (touch.js travel radius = 13% of the layer height), `.tj-knob` 10cqh; both absolute and
    centred on the inline `left/top` touch.js sets (percent of the zone) via the individual
    `translate: -50% -50%` property, so an inline `transform` would compose rather than replace.
    `--tj-x/--tj-y` fallback if touch.js ever switches to CSS vars. Right (aim) stick is red-tinted.
  - `.tbtn` (z 2, above the zones): 13x11cqh translucent dark rounded rect, light border, bold
    2.4cqh label; `.pressed` = brighter fill/border + scale 0.95. RELOAD right 3cqh / bottom 19cqh,
    SWAP stacked above (bottom 31.5cqh) — both above the weapon readout (bottom 3cqh, ~12.6cqh tall,
    ~15cqh while "RELOADING"). PAUSE top-right, 8cqh square. ACTION bottom-centre gold pill, 11cqh
    tall, min 34cqh, max width = gap between the health/kills block and its mirror image.
  - Hidden states: touch.js uses inline `display: none` (not fought). Also `#touch .hidden`,
    and ACTION hides when empty or its `.tbtn-label` is empty. Buttons are hidden on menu / game
    over via `#hud[data-phase=...] ~ #touch .tbtn` (tap anywhere starts); while paused only PAUSE
    shows.
  - `#hud.mobile .hud-prompt` hidden; `#hud.mobile .hud-bottom-center` moves to bottom 16cqh so
    banners clear the ACTION pill.
  - `.hud-rotate`: fixed full-viewport plate, z-index 1000, CSS-drawn phone (border + speaker slot
    + home dot) rotating 0 -> -90deg on a loop, "ROTATE YOUR PHONE" + sub line, sized in vmin.
- **hud.js**
  - `setMobileHud(on)`: module flag (survives `initHud`; `initHud` re-applies the `mobile` class).
    Menu sub "Tap to start", touch controls list (Left stick / Right stick / RELOAD / SWAP / ‖ /
    ACTION), game over "Tap to restart", paused "Tap ‖ to resume"; `updatePrompt` never shows
    `.hud-prompt` while mobile. Rebuilds the centre screen immediately if one is showing. Desktop
    text unchanged when off.
  - `setRotateOverlay(on)`: creates one `.hud-rotate` on `<body>` lazily (reuses an existing one,
    so repeated calls / re-init / a second module instance never duplicate it) and toggles
    `.hidden`. It lives on body because in portrait the stage is only a 16:9 strip and `#hud`'s
    size containment would trap `position: fixed`. It takes pointer events (swallows touches and
    prevents touchmove), so a tap on it does not reach the stage's first-gesture listener.

### Verified (port 8192, `?debug=1`, injected sample `#touch` with the contract classes)
- 1604x902 stage: face 185–322 x 27–183; vitals 185–399 x 795–875; points y718–783; round
  x185–311; chips 729–1191 x 23–59; long banner 720–1200 x 698–758; weapon 1622–1735 x 761–875;
  RELOAD 1617–1735 x 631–731; SWAP x 521–615; PAUSE 1663–1735 x 27–99; ACTION 805–1115 x 776–875.
  No overlaps (checked by rect intersection); boss bar (WO5: x707–1212 y73–126) clear of PAUSE.
- Forced 800x450 and 640x360 stages: everything scales, no overlaps.
- Rotate plate covers the full viewport, single instance after repeated calls, top at hit-test;
  hides cleanly. Menu / game over texts switch between touch and desktop wording. No console
  errors. `node --check src/hud.js` OK, `npm test` green.
- Still needs a real-phone check (safe-area insets / notches were not tested).

## WO7 (Agent D) — perk row, revive overlay, KNIFE button, high scores

### hud.js
- **Imports** (namespaces, guarded): `config.js` (`PERKS`) and `weapons.js` (`WEAPONS`, used only
  for the favourite weapon's display name; falls back to the id in upper case).
- **Perk row** `.hud-perks` (bottom-left, above HEALTH/KILLS): one `.hud-perk` bottle per id in
  `player.perks`, in purchase order. The inline `--perk-color` comes from `PERKS.list[id].color`,
  and the letter sits on a dark round label. Quick Revive has a `.hud-perk-uses` badge showing
  `maxUses - player.reviveUses`. The row is rebuilt only when the list or the uses change. `#hud`
  gets `.has-perks` (a direct `classList.toggle`, because `build()` resets `root.className`) so
  the points block moves up by `--perk-row-h`.
- **Down overlay** `.hud-down`: shown while `player.downT > 0` in playing/paused. It shows
  "REVIVING…" and a blue bar that fills over `PERKS.list.revive.downSeconds`
  (`1 - downT/downSeconds`). The HUD reads `downT` only. `player.down` (the real death) is
  unchanged.
- **perk:bought** queues the banner `PERK NAME` (upper case) through the WO5 banner queue.
- **`setScores({ best, top })`**: stored at module level and kept across `initHud`. On the menu
  it adds "BEST: ROUND 12 · 3,450 PTS" under the title (from `best`, else `top[0]`; hidden when
  `round` < 1) and a TOP RUNS table (# / ROUND / POINTS / KILLS / TIME / LVL, max 5) to the right
  of the controls list. If the menu is showing, it is rebuilt immediately.
- **`setGameOverSummary(summary)`**: accepts the stats spread (`roundReached, kills,
  pointsEarned, shotsFired, shotsHit, timeSurvived, levelReached, bossesKilled, bestWeaponId`)
  plus `rank, isBestRound, isBestPoints, top` and optionally `entry` or `perks`.
  - Missing fields fall back to `entry`, then to `state.stats` / `state.player.perks`, so a
    partial summary still renders.
  - Rows shown: Rounds, Kills, Points earned, Accuracy, Time (m:ss), Level reached, Bosses, Perks
    (full names, or "None"), Favourite weapon.
  - Rank line: "NEW BEST ROUND!" (or "NEW BEST SCORE!" when only the points are a best), in the
    banner style with a glow, followed by "#N ALL TIME". The TOP RUNS table highlights this run's
    row.
  - The summary can be set before or after the phase flips to gameover. It is cleared when the
    phase changes to playing or menu (restart), so a stale summary never reaches the next death.
  - Without a summary, the game-over screen shows the same rows from `state.stats`.
  - Deviation: "NEW BEST ROUND!" is drawn inside the game-over screen rather than through the
    banner queue, because `.hud-bottom-center` is `display:none` on game over.
- **Controls lists**: desktop adds `V` Knife and "Buy guns / perks / doors / rebuild (hold)".
  Mobile adds `KNIFE` Melee swing.

### styles.css
- **Bottom-left stack**: vitals (3–12cqh), then the perk row (bottom 12.6cqh, 5.8cqh tall), then
  points (`bottom` now includes `--perk-h`, which is 0 until the first perk). The perk row and
  down overlay are hidden on menu/game over.
- **`.tbtn-knife`**: `right 17.5cqh; bottom 19cqh` (left of RELOAD, 1.5cqh gap), steel-blue tint.
  - To clear it, the right stick moved from `--tj-x: calc(100% - 36cqh)` to `calc(100% - 45cqh)`.
    touch.js reads the base rect, so no JS change is needed.
  - The ACTION pill cap became `calc(100% - 118cqh)` (was 112).
- **Mobile weapon readout**: `max-width: 26cqh`, name at 2.6cqh that may wrap to two lines, and
  the secondary weapon name hidden. This keeps the readout clear of the moved stick and below
  RELOAD/KNIFE even for "PEACEKEEPER MK2" while reloading.
- **Screens**: `.screen-cols` (two columns, max width 100% − 44cqh), `.screen-best`,
  `.screen-rank`, `.screen-top*`. The game-over title shrinks to 9.5cqh and the stats to 2.6cqh
  so the 9 rows and the table fit 16:9. Long perk lists wrap (`.stat-v` max 44cqh).

### Verified (port 8205, 1604x902 stage)
- **Desktop**: the menu shows the best line and top-5. The perk row (4 bottles, Q badge "2")
  measured y736–788, between the points (≤725) and vitals (≥795) with no overlap. The perk:bought
  banner showed "DOUBLE TAP II". The REVIVING bar was at 60% with downT 0.6. The game-over screen
  showed "NEW BEST ROUND! #1 ALL TIME", the summary and the highlighted table, clear of the face
  box and vitals.
- **Mobile (`&touch=1`)**: KNIFE was at 1487–1604 × 631–731, RELOAD at 1617–1735, and the right
  stick base at 1239–1473 × 604–839. The weapon readout (reloading, "Peacekeeper MK2") was at
  1500–1735 × 741–875, and the ACTION pill (long text) at 690–1230, clear of both stick bases
  (left ends at 636). Nothing overlapped. The mobile menu and game over (#3 ALL TIME, wrapped
  perks) fit the screen.
- Restart cleared the game-over summary and hid the perk row. There were no console errors.
- `node --check src/hud.js` passed and `npm test` passed 496/496.

## WO7 FIX-2 — weapon list, perks used, phone legibility, screen backdrops, Q badge

### hud.js
- **Holstered weapons** (playtest #2 / review L5): `updateWeaponSecondary(player)` replaces the
  single secondary name. `.hud-weapon-secondary` holds one `.hud-weapon-sec` line per held weapon
  other than the active one (every slot weapon while a temp weapon is out), in slot order, each
  with a `.hud-weapon-sec-slot` digit and the upper-case name. Rebuilt only when the slot/name key
  changes.
- **Perks used** (playtest #6): the game-over row is labelled "Perks used" and reads
  `summary.perksRun` (FIX-3: every perk bought this run) first, then `summary.perks`, the entry,
  then `player.perks`. Duplicates are removed.
- **Top-5 table**: the KILLS and LVL cells carry `.c-opt` so the touch layout can drop them.
- **Quick Revive badge** (playtest #11): shows the revives in hand, always "×1" while the perk is
  held. It no longer shows `maxUses - reviveUses`; purchases left belong to the machine prompt.
  The perk row key is now the perk list only.

### styles.css
- Desktop: holstered lines with a small outlined slot digit; the menu / game-over overlay is
  darker (radial 0.78 → 0.93) and the controls list, the run summary and TOP RUNS sit on
  `rgba(0,0,0,0.6)` rounded panels.
- Touch (`#hud.mobile`):
  - Holstered weapons on one line (`MR6 · SHEIVA`, no digits, `max(10px, 2.4cqh)`), ellipsised at
    the 26cqh readout width and hidden while reloading.
  - Floors: top-5 cells `max(11.5px, 2.2cqh)`, headers / TOP RUNS title / controls 11 px, summary
    rows 11.5 px, HEALTH/KILLS/level labels 10 px, Q badge 9 px. The top-5 shows
    # / ROUND / POINTS / TIME.
- The stick zones are hidden on menu and game over (`#hud[data-phase=…] ~ #touch .tj-zone`). Taps
  still start / restart through main.js's capture `pointerdown` on `#stage`.

### Verified (port 8232)
- Desktop 1422x800: Mule Kick + kn44 + rk5 (slot 3 active) showed "1 MR6 / 2 KN-44" above RK5. Q badge
  "×1". Game over with `perksRun ['mule','revive','jugg','revive']` showed "Perks used: Mule Kick,
  Quick Revive, Juggernog" on the panel, and the world stayed dimmed behind it.
- Touch, #stage forced to 844x390:
  - The menu fits with the 4-column top-5 (th 11 px, td 11.5 px, controls 11 px).
  - HUD labels are 10 px.
  - The weapon readout with "MR6 · HAYMAKER 12" over "PEACEKEEPER MK2" measured 731–832 × 319–378. It
    clears RELOAD/KNIFE (bottom 316) and the right stick base (right edge 719), including while
    reloading.
  - Game over: the summary (5 perks wrapping to 3 lines) and the top-5 fit with no overlap with the
    face box or vitals. The sticks were hidden, and a tap restarted the game (phase `playing`,
    sticks back).
- There were no console errors. `node --check src/hud.js` passed and `npm test` passed 501/501.
- Follow-up (playtest #13): if `summary.rankText` is set (main.js sends "Not ranked" for runs that
  die before round 1), the game-over rank line shows only that text and drops the best / "#N ALL
  TIME" lines. `npm test` passed 511/511.

## WO8 (Agent E) — Pack-a-Punch names, Upgrades row, pap:done banner

### hud.js
- `isUpgradedWeapon(w)`: `weaponsMod.isUpgraded(w)` when it is a function (guarded by try/catch),
  else `w.upgraded || w.def.upgraded`. `heldName(w)` = `w.def.name || w.id`, so the upgraded def's
  Pack-a-Punch name shows automatically.
- Active weapon name: `'★ ' + name` and class `.upgraded` on `.hud-weapon-name` when upgraded.
  Each holstered line (`updateWeaponSecondary`) gets the same star prefix and a `.hud-weapon-sec.upgraded`
  class. The rebuild key includes the upgraded flag, so an upgrade taken back into the same slot redraws.
- `pap:done { weaponId }` → `queueBanner(papName(id).toUpperCase())` through the WO5 queue.
  `papName` uses `weapons.upgradedName`, then `UPGRADES[id].name`, then the base weapon name.
  The listener is in `unsubs`, so it is dropped and re-added on every `initHud` (re-init safe).
- Game-over "Upgrades" row (after "Perks used") from `summary.papCount`, then `summary.pap`,
  `entry.pap`, `state.stats.papCount`. It is omitted only when none of them exist.

### styles.css
- `--hud-gold: #ffc93c` / `--hud-gold-dim: #d9a92c`. The upgraded active name is gold with a faint
  purple glow; holstered upgraded lines are dim gold.
- Desktop: `.hud-weapon { max-width: 52cqh }`, name and holstered lines are `nowrap` with an ellipsis,
  so no name can push the readout toward the centre column.
- Mobile: the name stays at 2.6cqh and may wrap, but is clamped to 2 lines (`-webkit-line-clamp: 2`,
  `overflow-wrap: anywhere`). The holstered line keeps its FIX-2 single-line ellipsis.

### Verified (port 8256, Agent A's `upgradeWeapon` already live)
- Desktop 1604x902 stage: "★ PORTER'S X2 RAY GUN" in gold (rgb 255,201,60); holstered lines
  "1 ★ NIGHTINGALE" (gold) and "3 KN-44" (plain). Readout x1326–1735, clear of the banner column
  (banner x640–1280).
- Touch, stage forced 844x390: the readout measured 1269–1370 × 575–634, with or without reloading.
  RELOAD/KNIFE bottom was 572 and the right stick's right edge 1257, so there was no overlap. The
  name wraps to "★ PORTER'S / X2 RAY GUN" (2 lines), and the holstered line ellipsises to
  "★ NIGHTINGALE · …".
- `pap:done` banners showed "PORTER'S X2 RAY GUN" (`.long`), "ZEUS CANNON" and "WARDEN'S WRATH"
  (the last after two extra `initHud` calls). The mobile banner sits above the sticks.
- Mobile game over with `papCount: 3` showed "Upgrades 3" between Perks used and Favourite weapon.
  All 10 rows and the top-5 fit the 390-px-high stage. With no summary, the row reads
  `state.stats.papCount`.
- There were no console errors. `node --check src/hud.js` passed and `npm test` passed 531/531.

## WO8 FIX-B (playtest #2): three guns on touch
- `updateWeaponSecondary` also renders a `.hud-weapon-sec-short` span per holstered gun, and sets
  `.multi` on the box when two guns are holstered. `shortWeaponName` returns:
  - names of 7 characters or fewer, whole;
  - otherwise the first word that is not digits only, not 1-2 characters, and not
    GUN/RAY/X2/CANNON/&, with "'S" dropped. For example, "WARDEN'S WRATH" -> WARDEN,
    "PORTER'S X2 RAY GUN" -> PORTER, "48 DREDGE" -> DREDGE.
- **styles.css.** The short span is hidden by default. `#hud.mobile .hud-weapon-secondary.multi`:
  - shows short names, gold when upgraded and without the star;
  - is a flex row (justify end) in a `max(9px, 2.2cqh)` font with letter-spacing 0;
  - has `margin-left: -3.5cqh`, so it may reach left of the 26cqh readout (still right of the right
    stick's base);
  - gives each name `flex: 0 1 auto; min-width: 0` with its own ellipsis, so the longest pair
    still shows the start of both.

  Desktop, and mobile with one holstered gun, are unchanged.
- **Verified at 844x390** (`&touch=1`). The line spans 1259-1366 px and its top is at 578, below
  KNIFE's bottom at 571. The right stick's base ends at 1257. None of the pairs was cut:
  - "WARDEN · GRAVEDIGGER"
  - "JUDGE · SEKHMET"
  - "PORTER · SEKHMET"
- No console errors.

## WO9 (Agent I) — LEVELS button, level-select phase, practice line, slow status

### hud.js
- **Pause screen** (desktop and touch): a `<button class="screen-btn screen-btn-levels" data-action="levels">LEVELS</button>`
  under "Press Esc / P to resume" / "Tap ‖ to resume", plus (desktop only) a small hint line
  "Shift+M — Level select". The button's `click` (mouse or tap) blurs it (so a later Enter / Space
  cannot re-press it) and notifies **both channels once**:
  1. `touch.triggerLevelsButton()` (Agent G, imported as a guarded namespace) → every
     `touch.onLevelsButton(cb)` callback;
  2. every `hud.onLevelsButton(cb)` listener (new export, returns an unsubscribe; module-level set,
     kept across `initHud`; the same function is added once).
  **Integrator: subscribe through exactly ONE of `touch.onLevelsButton` / `hud.onLevelsButton`**,
  or a click fires the toggle twice. Either one alone covers desktop clicks and touch taps.
  No DOM CustomEvent is emitted.
- **Menu controls list**: desktop adds `Shift+M — Level select`; touch adds `‖ → LEVELS — Level select`.
- **Game over**: when `summary.practice` is true (falls back to `state.stats.practice` only when the
  summary has no `practice` field), the rank line is replaced by "PRACTICE RUN — NOT RANKED"
  (`.screen-rank.practice .rank-practice`, ice blue) and the TOP RUNS table has no highlighted row.
  It also wins over `rankText`.
- **Slow status**: while `player.slowT > 0` (Agent E) and the player is not down (and not on menu /
  game over), the HEALTH label row shows an inline-SVG six-armed ice crystal + "SLOWED" instead of
  "HEALTH", and the health value gets a cold blue glow (`.hud-vital-health.slowed`). warn/crit
  colours are unchanged.
- **Phase `levelselect`**: `buildScreen` is not called (the centre screen is hidden); prompts only
  show while playing; face / boss-lag timers already only tick while playing, so they freeze.

### styles.css
- `.screen-btn` (gold-bordered dark-red plate, `pointer-events: auto` over `#hud *`), `.screen-hint`,
  mobile floors (14px font, 40px min height).
- `#hud[data-phase="paused"] ~ #touch .tj-zone { display: none }`: the stick zones (full-height
  halves above `#hud`) step aside while paused, so a tap lands on the LEVELS button itself (PAUSE
  still shows). touch.js's own hit-test forward (`levelsButtonAt`) therefore never sees that tap,
  so there is no double fire.
- `#hud[data-phase="levelselect"]`: gameplay widgets at opacity 0.3, `.hud-screen` / `.hud-prompt`
  hidden, crit/revive pulses stopped, all touch buttons and stick zones hidden.
- `.hud-slow` is absolutely positioned in the (now `position: relative`) health cell so its wider
  text never widens the cell: KILLS stays put (measured 618 px left edge slowed and not slowed at
  844x390; badge ends at 610). Pulse animation off when paused / reduced motion.

### Verified (port 8309)
- Desktop 1920-wide window, `?debug=1`: pause → LEVELS + hint; a real mouse click on the button
  fired the listener once, phase stayed `paused`, focus back on body. SLOWED badge with icon next
  to 100%. Practice game over: "PRACTICE RUN — NOT RANKED", no `.td.me` though `rank: 1` was passed.
  Phase `levelselect`: screen `display:none`, widgets opacity 0.3.
- Touch `&touch=1`, `#stage` forced 844x390: pause screen title 417–464, sub 474–487, button
  900–1020 × 501–541 (hit-test top element = the button), PAUSE still shown, stick zones hidden;
  a real click fired `touch.onLevelsButton` 1× and `hud.onLevelsButton` 1×. Practice game over with
  all 10 rows (5 perks wrapping) + 4-column top-5 fits (326–632 inside the stage 284–674). Menu with
  scores + the extra controls row fits (cols 473–583). levelselect: touch buttons hidden.
- Zero console errors. `node --check src/hud.js` OK. `npm test`: 605/606, the only failure is
  `WO9 new exports` → `level.teleportTo` (INT's, Phase 2).


## WO9 FIX-4 — camera over-scroll and bright-level contrast (QA KINO #4, OUTPOST #3, TEMPLE #9)

- **Camera (`src/main.js` `updateCamera`).** The clamp is now `[-padL, map.width - vw + padR]` (and the same for y). `CAM_PAD = { left: 0.2, right: 0.2, top: 0.16, bottom: 0.16 }` is a fraction of `canvas.height`, divided by `state.zoom`. The HUD is sized in cqh, so the margin matches the HUD corners on both desktop (zoom 1) and mobile (zoom 1.96). Small maps are still centred. The player stays centred except within one pad of an edge. The mouse-aim conversion (`mouseX / zoom + camera.x`) is unchanged and correct for negative offsets: in the browser the angle matched the cursor. `render.js` already clears to `#050506` before the world pass, so the void is dark.
- **Contrast (`styles.css`, `src/hud.js`).** `--hud-outline` is applied to the vitals labels and values and to the points value. `hud.updateLevelStyle(state)` sets `data-level-style` on `#hud` and `#stage`, taken from `map.theme.style` or else `level.def.theme.style`, and cleared on the menu. The CSS hooks `#stage[data-level-style="outpost"] …` cover `.tj-base`, `.tj-knob`, `.tbtn` and `.hud-vital-label`. Other bright levels can reuse this by adding their style name to the selectors.
- Verified in Chrome: KINO lobby and arena on desktop, and OUTPOST snow with `&touch=1` (844x390), with before/after screenshots. `node --check` passes for main.js and hud.js. `npm test`: 637/643. The 6 failures are level-validity checks from FIX-1's new interact-reach rule on the level data (other agents' in-progress files), not from this change.
