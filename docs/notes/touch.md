# touch.js notes (WO6 Agent A)

`src/touch.js` implements the WO6 section 3 contract: `initTouch`, `setTouchEnabled`,
`setTouchPrompt`, `getTouchState`, `endTouchFrame`, `isTouchActive`. No DOM access at module top
level, so `input.js` can import it and the node tests stay DOM-free.

## DOM (built inside the layer by `initTouch`; styled by styles.css / Agent B)
- `.tj-zone.tj-left`, `.tj-zone.tj-right` (each has `data-stick`), each holding `.tj-base` + `.tj-knob`.
  Base/knob are hidden with inline `display:none` until touched; when shown their inline
  `left`/`top` are set in **% of the zone** at the touch origin / knob position (so the CSS should
  centre them with `transform: translate(-50%, -50%)` and `position:absolute`). A zone gets class
  `.active` while its stick is held.
- `.tbtn.tbtn-reload` "RELOAD", `.tbtn.tbtn-swap` "SWAP", `.tbtn.tbtn-pause` "‖",
  `.tbtn.tbtn-action` > `span.tbtn-label`. `.pressed` while held. ACTION is hidden with inline
  `display:none` while there is no prompt (inline so a `.tbtn { display:flex }` rule can't override).
- No positioning is set by JS apart from the stick base/knob; zones/buttons need CSS layout.
- `setTouchEnabled` sets the layer's inline `display` ('' / 'none') and toggles class `.on`.

## Behaviour
- Pointer events: `pointerType` touch/pen always; mouse (left button) too when the URL has `touch=1`.
  `pointerdown` on the layer; `pointermove/up/cancel` on window; `lostpointercapture` on the layer.
  Each stick/button tracks one `pointerId` (setPointerCapture, best effort) so multi-touch works:
  a second finger in an owned zone does not steal the stick.
- Stick radius = 13 % of layer height. Offset clamped to magnitude 1.
- Move stick: deadzone 0.08; `sprint` when magnitude > 0.92.
- Aim stick: direction updates above 0.12 magnitude; `fire` while magnitude > 0.35
  (`firePressed` on the rising edge). Releasing keeps `aimX/aimY` (last aim); before any aim they are 0,0.
- Buttons: RELOAD/SWAP/PAUSE set edges on press; ACTION sets `interact` (edge) and `interactHeld` (held).
- `start`: any accepted pointerdown on the layer that is not a button (including one that spawns a
  stick). main decides by phase (input.js maps it to both `start` and `restart`).
- `preventDefault` on `touchstart`, `touchmove`, `contextmenu`, `dblclick` inside the layer
  (non-passive), and on mouse pointerdown. Events are not stopped, so main's stage `pointerdown`
  (fullscreen / audio gesture) still sees them.
- Blur / hidden tab / `setTouchEnabled(false)` release everything.
- `initTouch` is idempotent (same layer = no-op; a different layer tears down the old one).
- `setTouchPrompt` ignores repeated identical text (safe to call every frame).

## Verified
Chrome `?debug=1&touch=1`, temp div in #stage, synthetic touch PointerEvents with distinct ids:
half/full move (0.5, sprint at full), aim up/right, auto-fire + firePressed edge, edge clearing by
`input.endFrame()`, last-aim retention after release, simultaneous stick + 3 buttons, ACTION
label/show/hide/held, mouse-as-touch with `touch=1`, touchmove preventDefault, disable. No console errors.
A real phone test is still needed.

## Fixed sticks (lead, direct change)

User request: the sticks should sit at fixed positions and always show, instead of spawning
under the finger. Both bases and knobs are now always visible (idle at 55 % / 70 % opacity,
full while held). CSS fixes their centres via `--tj-x/--tj-y`: left stick 40cqh from the left,
right stick 36cqh from the right, both 20cqh above the bottom, clear of health/points, the
ammo readout and RELOAD/SWAP. A touch within 2.2 stick radii of a free stick grabs the nearest
one and the offset is measured from its fixed centre (so touching off-centre applies at once);
touches further away grab nothing (they still count as a start/restart tap). Only the knob moves
and it springs back to the base centre on release. The ACTION pill is capped to the gap between
the sticks, and mobile banners moved up to 36cqh so they clear the sticks.
