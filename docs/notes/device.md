# WO6: `src/device.js`, `index.html`, `main.js` mobile wiring (Agent C)

## device.js
- `isMobile(env?)`: memoized per page load. Order: `?touch=1` true, `?touch=0` false, then
  `matchMedia('(pointer: coarse)')`, then `navigator.maxTouchPoints > 0` with the shorter screen
  side (`screen.width/height`, falling back to `innerWidth/innerHeight`) under 900 css px.
  Passing `env` detects against it and refreshes the cache (tests).
- `detectMobile(env?)`: the same logic, not memoized.
- `isPortrait(env?)`: `innerHeight > innerWidth`; false with no window.
- `requestImmersive(env?)`: `requestFullscreen({navigationUI:'hide'})` (or webkit), then
  `screen.orientation.lock('landscape')` once fullscreen resolves (locking usually needs
  fullscreen). All errors and rejections are swallowed; it never throws.
- `_resetForTests()`: clears the memo.
- `env` = `{ window, navigator, location, screen, document }`; missing fields come from
  `env.window`. Every browser global is guarded, so the module imports fine in Node.

## index.html
- Viewport: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`.
- `<meta name="mobile-web-app-capable" content="yes">`.
- `<div id="touch"></div>` after `#hud` inside `#stage`.

## main.js
- `mobile = device.isMobile()` at boot, before the first `initAll`.
- `initAll` ends with `applyMobile()`: `touch.initTouch(#touch, canvas)`,
  `touch.setTouchEnabled(true)`, `hud.setMobileHud(true)`. It also runs on restart. It sits after
  `hud.initHud`, so a HUD rebuild keeps mobile mode. Every touch/hud mobile call is guarded with
  `typeof fn === 'function'`.
- Each frame (only when mobile): `updateTouchPrompt` runs after the HUD update and `updateOrientation` runs after pause handling, before the gameplay update.
  - ACTION label: `state.shop.prompt.text` with a leading `Press F to ` / `Press F for ` /
    `Hold F to ` removed and the first letter capitalised. It is null when there is no prompt or
    the phase is not `playing`. `setTouchPrompt` is called only when the label changes.
  - Portrait: `hud.setRotateOverlay(portrait)` is called when the value changes. Portrait while
    `playing` switches to `paused` and sets `rotatePaused`. When landscape returns and
    `rotatePaused` is set, a still-`paused` game goes back to `playing`. A manual pause is never
    auto-resumed.
- Aim: `inp.aimVector` present gives `player + aimVector * 300`. Otherwise mouse + camera.
- `input.endFrame()` still runs at the end of every tick. Agent A's `endFrame` clears the touch
  edges.
- `#stage` has a capture-phase `pointerdown` handler that does nothing unless mobile. When mobile
  it calls `device.requestImmersive()`, then `startGame()` in `menu` or `restartGame()` in
  `gameover`. That tap is the user gesture: `game:start` creates or resumes audio. The desktop
  keyboard and click start path is unchanged.
- Debug: `__game.debug.mobile()` returns the boot detection boolean. `__game.modules` gains
  `touch` and `device`.
