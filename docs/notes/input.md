# input.js notes (Agent A)

## What I built
`src/input.js` implements `initInput(canvas)`, `getInput()`, `endFrame()` per WORK_ORDER 3.6 / 5.2.

- Keys are matched by `KeyboardEvent.code` (layout independent: WASD stays WASD on AZERTY positions).
- Move: WASD / arrows. Diagonals normalized to unit length (`1/sqrt2` each axis).
- `Shift` (either) = `sprint` (held). `R` = `reload` (edge). `F`/`E` = `interact` (edge) + `interactHeld` (held).
- `Q` = `swap` (edge). `1`/`2` (and numpad) = `slot` (edge). Mouse wheel = `swap` + `wheel` direction.
- `Enter`/`Space`/`NumpadEnter` set both `start` and `restart` (edge); main decides which applies by phase.
- `Esc`/`P` = `pause` (edge). Backquote = `debugKey` (edge).
- Mouse: `mousemove` on `window`, converted to canvas backing-store coords via
  `canvas.width / rect.width` (CSS scaling safe). Aiming keeps updating when the cursor leaves the canvas.
  `mousedown` (left) on the canvas; `mouseup` on window so releasing outside the canvas still releases.
- Context menu prevented on the canvas. Wheel listener is non-passive and prevents page scroll.
- `preventDefault` on Space, arrows and Backquote keydown/keyup so the page never scrolls.
- Blur and `visibilitychange` (hidden) release all keys/buttons and clear edges.
- Key auto-repeat never retriggers edge flags.
- `initInput` is idempotent: calling it again (e.g. on restart) removes the previous listeners first.
- Importing the module under node is safe (no DOM access at module top level); `getInput()` /
  `endFrame()` work without `initInput()` (return a neutral snapshot).

## Additions to the contract
- `slot`: `0` when no digit pressed this frame, else `1` or `2` (1-based; player should use `slot - 1`
  as `activeSlot`).
- `wheel`: `-1` (up), `0`, `1` (down) for this frame. A wheel step also sets `swap = true`, so the
  player can just use `swap` (only two slots, direction is irrelevant) and ignore `wheel`.
- `resetInput()` extra export: releases everything. Optional; nothing depends on it.

## Behaviour choices / assumptions
- `fire` = left button held OR `firePressed` this frame. This guarantees a very fast click that
  begins and ends between two frames still produces one shot.
- Edge flags persist until `endFrame()`, so a press between frames is never lost.
- Pressing `Q` and a digit in the same frame sets both `swap` and `slot`; player should prefer `slot`.
- `start` and `restart` are the same physical keys; main must only act on `restart` in `gameover`
  and `start` in `menu`. Canvas-click start (5.13) can use `firePressed` while in the menu.
- `mouseX/mouseY` start at 0,0 until the first mouse move.

## Constants to move to config (optional)
- `WHEEL_THRESHOLD = 1` (min |deltaY| per wheel step). Key binding arrays could also live in config if
  rebinding is ever wanted.

## Bugs found elsewhere
None.

## WO6 (touch)
- `input.js` imports `touch.js`. `getInput()` gains `aimVector` (`{x, y}` unit, last non-zero touch
  aim; `null` on desktop / before any touch aim) and `autoFire` (true while the touch aim stick is
  past 0.35).
- When `touch.isTouchActive()`: move stick overrides WASD when deflected; sprint/fire/firePressed/
  reload/swap/interact/interactHeld/pause are OR-ed with keyboard/mouse; a layer tap sets both
  `start` and `restart`. Keyboard and mouse keep working.
- `endFrame()` also calls `touch.endTouchFrame()`.
- player.js: after firing, `if (input.autoFire && w.mag > 0) w.triggerHeld = false` so semi-autos
  cycle at their rpm (kept held on an empty mag so `weapon:empty` isn't emitted every frame).
  Covered by `tests/autofire.test.js`.

## WO7 (Agent K) — knife + Mule Kick slot
- `getInput().melee`: edge, true for the frame `V` (`KeyV`) is first pressed (auto-repeat ignored),
  cleared by `endFrame()`. With touch active it is OR-ed with `getTouchState().melee` (KNIFE button).
- `Digit3` / `Numpad3` sets `slot = 3` (third weapon slot from Mule Kick). player.js decides whether
  slot 3 exists (ignore it when `weaponSlots < 3`).
- Tests: `tests/input.test.js` (new, node): `getInput().melee` false by default and after
  `endFrame()`, `getTouchState().melee` false while touch is inactive. `tests/autofire.test.js`
  untouched and green.
- Verified in Chrome (`?debug=1&touch=1`): KeyV keydown -> `melee` true, false after `endFrame()`;
  Digit3 -> `slot === 3`.

## WO9 (Agent G) - level select
- `getInput().levelSelect`: edge, true for the frame `Shift+KeyM` is first pressed (`LEVEL_SELECT.key`
  / `requireShift` from config). Plain M never sets it; Shift+M sets no other edge (Shift still
  counts as `sprint` while held).
- input.js imports `levelselect.js` (namespace, guarded). While `isLevelSelectOpen()`: keydowns are
  not recorded as held and set no edge except `levelSelect`; `getInput()` returns a neutral snapshot
  (no move / fire / reload / interact / swap / sprint / start / restart / pause / debugKey / slot /
  wheel / melee / touch aim), keeping only `mouseX/mouseY` and `levelSelect`. Keyups still release
  held keys. The overlay's own keys (arrows, digits, Enter, Space, Esc, Tab) are stopped before
  input.js sees them (window capture listener in levelselect.js).
- Tests: `tests/levelselect.test.js` (levelSelect boolean + cleared by endFrame).
- Verified in Chrome with real key presses (see levelselect.md).
