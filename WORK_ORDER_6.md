# WORK ORDER 6 — Mobile auto-detect and touch controls

Goal: when the game is opened on a phone or tablet it detects the touch device and switches to
a twin-stick touch control scheme. Desktop behaviour is unchanged. 3 parallel agents + 1
verifier. House rules from WO1–WO5 apply (one file one owner, `npm test` =
`node --test "tests/*.test.js"`, `node --check`, browser check on your own port, stop server,
close tab, no git, no questions).

## 1. Design

- **Detection** (`src/device.js`): `isMobile()` is true when `?touch=1` is in the URL, false
  when `?touch=0`, else when `matchMedia('(pointer: coarse)')` matches, or when
  `navigator.maxTouchPoints > 0` and the shorter screen side is under 900 css px. Evaluated
  once at boot; `?touch=1` lets desktop Chrome test the scheme.
- **Layout on phones:** the stage already scales to fit 16:9. In portrait a full-screen
  "Rotate your phone" overlay is shown and the game auto-pauses while playing. On the first
  touch the page requests fullscreen and tries `screen.orientation.lock('landscape')` (both
  best-effort, errors ignored). The page must never scroll, zoom or select text on touch.
- **Controls (twin-stick, dynamic sticks):**
  - Left half of the screen: touch anywhere to spawn a **move stick** at the finger; drag to
    move; magnitude > 0.92 = sprint. Release hides it.
  - Right half: **aim stick**. Drag direction = aim direction (the soldier turns); magnitude
    above 0.35 = **auto-fire**. Releasing keeps the last aim direction. Semi-auto guns fire at
    their rate while auto-firing (no tap-per-shot).
  - Buttons (bottom-right cluster above the weapon readout, thumb-sized ≥ 9 % of height):
    **RELOAD**, **SWAP**. Top-right: **PAUSE** (‖). Bottom-centre: a large **ACTION** button
    that appears only when a shop prompt exists, showing the prompt text with "Press F to"
    stripped ("Buy Sheiva [50]", "Open door [75]", "Rebuild" hold-to-repeat). Holding ACTION
    repairs barricades (interactHeld).
  - Menu / game over: tapping anywhere starts / restarts. The HUD text says "Tap to start"
    and the controls list shows the touch scheme instead of keys.
- **Mouse aim is bypassed on touch:** `getInput()` gains `aimVector: {x, y} | null`. When
  set, `main.js` aims at `player + aimVector × 300` in world space instead of mouse + camera.
- **Visuals:** stick base (translucent ring) + knob; buttons are translucent dark rounded
  squares with a light border and bold label, brighter while pressed. Nothing covers the face
  box, health/kills, points, round counter or boss bar. All sizes in `cqh`/`cqw` so they scale.

## 2. Ownership

| Agent | Owns |
|-------|------|
| A | `src/touch.js` (new), `src/input.js`, `src/player.js` (only the `triggerHeld` line for `autoFire`), `docs/notes/touch.md`, `docs/notes/input.md` (append) |
| B | `styles.css`, `src/hud.js`, `docs/notes/hud.md` (append) |
| C | `src/device.js` (new), `index.html`, `src/main.js`, `README.md`, `tests/device.test.js`, `docs/notes/device.md` |
| VER | any file for integration fixes, `docs/notes/integration-wo6.md`, screenshots |

## 3. Contracts

```js
// device.js (C) — safe in Node (guards window/navigator)
export function isMobile()            // memoized per page load; honours ?touch=1|0
export function isPortrait()          // window.innerHeight > window.innerWidth
export function requestImmersive()    // fullscreen + landscape lock, best effort, call inside a user gesture

// touch.js (A) — DOM. Creates its elements inside layerEl (the #touch div, pointer-events: auto)
export function initTouch(layerEl, canvas)     // idempotent; installs pointer listeners (pointerType touch/pen and mouse when ?touch=1), prevents default gestures
export function setTouchEnabled(on)            // show/hide the layer
export function setTouchPrompt(text | null)    // ACTION button label; null hides it
export function getTouchState()
//  { active: bool /* layer enabled */, moveX, moveY /* -1..1 */, sprint, aimX, aimY /* unit or 0,0 */, aimActive, fire,
//    firePressed, reload, swap, interact, interactHeld, pause, start }   // edge flags cleared by endTouchFrame()
export function endTouchFrame()
export function isTouchActive()
// DOM it creates (B styles these):
//   .tj-zone.tj-left / .tj-zone.tj-right (full-height halves, transparent)
//   .tj-base + .tj-knob inside each zone (hidden until touched, positioned at the touch origin)
//   .tbtn.tbtn-reload "RELOAD", .tbtn.tbtn-swap "SWAP", .tbtn.tbtn-pause "‖", .tbtn.tbtn-action (label span .tbtn-label)
//   pressed state: class .pressed

// input.js (A): getInput() merges touch when isTouchActive():
//   moveX/moveY/sprint from the move stick; fire = aim magnitude > 0.35 (firePressed on the rising edge);
//   aimVector = {x,y} (last non-zero aim) or null on desktop; autoFire = true while touch-firing;
//   reload/swap/interact/interactHeld/pause/start/restart from buttons/taps. Keyboard/mouse still work too.
// player.js (A): when input.autoFire, set w.triggerHeld = false after tryFire so semi-autos cycle at their rpm.

// hud.js (B):
export function setMobileHud(on)   // swaps key hints for touch hints (menu controls list, "Tap to start", prompt wording handled by touch ACTION so hide .hud-prompt while mobile)
export function setRotateOverlay(on) // shows/hides .hud-rotate ("Rotate your phone" full-screen plate)

// main.js (C): at boot mobile = device.isMobile(); if mobile: touch.initTouch(document.getElementById('touch'), canvas);
//   touch.setTouchEnabled(true); hud.setMobileHud(true); per frame: touch.setTouchPrompt(state.shop.prompt?.text stripped of "Press F to " / "Hold F to ");
//   aim = inp.aimVector ? player + aimVector*300 : mouse + camera; input.endFrame() also calls touch.endTouchFrame();
//   first pointerdown on the stage: device.requestImmersive() and start/restart per phase (must count as the user gesture for audio);
//   each frame: portrait = mobile && device.isPortrait(); hud.setRotateOverlay(portrait); if portrait && phase==='playing' pause.
// index.html (C): viewport "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
//   <meta name="mobile-web-app-capable" content="yes">, <div id="touch"></div> after #hud inside #stage.
// styles.css (B): #touch { position:absolute; inset:0; pointer-events:none; touch-action:none } and children pointer-events:auto;
//   html/body { touch-action: none; overscroll-behavior: none; -webkit-user-select: none; -webkit-touch-callout: none }
```

## 4. Acceptance (verifier, Chrome with `?touch=1` and synthetic pointer events with pointerType 'touch'; then note that a real phone test is still needed)

- [ ] Desktop without `?touch=1`: no touch layer, everything as before, tests green.
- [ ] `?touch=1`: tap starts the game; left drag moves and sprints at full extension; right drag turns the soldier and auto-fires (pistol fires repeatedly); releasing keeps facing; RELOAD/SWAP/PAUSE work; ACTION appears near a wall buy/door/box/barricade with the right label, buys on tap, repairs while held.
- [ ] Portrait (narrow window with `?touch=1`): rotate overlay shows and the game pauses; landscape hides it.
- [ ] Touch UI never overlaps the face box, health/kills, points, round counter, boss bar, banners.
- [ ] No page scroll/zoom on gestures; zero console errors; frame cost unchanged.
