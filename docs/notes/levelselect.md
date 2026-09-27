# levelselect.js notes (WO9 Agent G)

`src/levelselect.js` is a self-contained DOM module (WO9 1.5 / 3.4). It injects its own
`<style id="levelselect-style">` once and builds `.ls-overlay` inside the root element. Importing it
under node is safe (no DOM at module top level); the DOM entry points are no-ops without a DOM.

## API
- `initLevelSelect(rootEl, { levels, onPick(index), onClose() })` - idempotent. Same root: only
  updates options (cards are rebuilt if the level list changed). **Recommended root: `#stage`**
  (overlay z-index 50, above `#hud` and `#touch`). Mounting in `#hud` also works: the overlay forces
  `pointer-events:auto !important` for itself, and while open `<html>` gets class `ls-open`, which
  hides `#touch` and disables its pointer events. `levels` defaults to `LEVELS` from the registry.
- `openLevelSelect(state)` - `state.level.index % levels.length` (or a plain number) is the
  highlighted CURRENT card and the initial selection; shows, focuses. Emits `levelselect:open {}`
  on a closed -> open change only.
- `closeLevelSelect()` - hides, emits `levelselect:close {}` on an open -> closed change only.
  Does **not** call `onClose`.
- `isLevelSelectOpen()`.
- `levelThumbnail(def, scale = LEVEL_SELECT.thumbScale)` - 60*scale x 40*scale canvas, cached per
  `id@scale`; the same element is returned each time (drawImage it for a second copy). `null` in node.
- Pure extras (tested in node): `thumbnailColors(def)` (rows x cols of `#rrggbb`), `difficultyLine(def)`
  (`"HP x2.4 · SPD x1.22"`), `cardInfo(def, i)`, `currentIndexOf(stateOrIndex, n)`, `mixHex`.

## Behaviour (for INT)
- Card click / tap, or Enter / Space / NumpadEnter -> `onPick(index)`. The overlay stays open:
  main teleports and then calls `closeLevelSelect()` (if no `onPick` is given, it just closes).
- Esc or the X button -> `closeLevelSelect()` then `onClose()` (main restores the previous phase).
- Arrows move the selection (up/down by the live grid column count: 3 desktop, 2 phone), 1-6 /
  numpad select, Tab cycles. Mouse hover selects.
- **Shift+M is not handled by the overlay**: it passes through to input.js -> `getInput().levelSelect`,
  and main toggles (close = `closeLevelSelect()` + restore phase, as for Esc's `onClose`).
- Consumed keys are stopped in a `window` keydown **capture** listener, so input.js never sees them
  (Enter/Space do not start/restart the game, Esc does not pause). keyup of Space/Enter is also
  swallowed while open (no native button re-activation).
- Events: levelselect.js emits `levelselect:open` / `levelselect:close` itself, so **main should
  not emit them again**. `level:teleport` is main's.
- Thumbnail colours: floor/floorAlt checker, walls touching floor = wall mixed with wallEdge,
  deep rock darker, pockets/spawns darker floor, windows accent+sky blue, doors D-H light door wood,
  mega door red, stairs cream, pit `~` = `theme.pit` / `theme.water` / dark blue, box cyan,
  PaP purple, perks in their colours, wall buys gold, boss/minion spawns from the boss tint, start white.
- Card: `L<n>` + name (+ CURRENT badge), thumbnail, `BOSS <name>` (boss tint), difficulty line;
  left border = theme wallEdge. Footer: "Teleporting marks this run as a PRACTICE RUN (not ranked)."
- Layout: container query on the overlay; height <= 480px (phone 844x390 stage) switches to two
  columns with larger text and a scrollable grid.

## Verified (Chrome, port 8307)
`?debug=1`: driven from the console on `#stage`: six cards 3x2 fit without scrolling at 1390x782,
current highlight (index 7 -> L2), arrows / digit 3 selection, Enter -> `pick2`, Space pick, Esc
-> close + onClose with no `pause` edge, P suppressed while open, plain M no edge, Shift+M
`levelSelect` true while open and while closed, open/close events. `?debug=1&touch=1` with `#stage`
forced to 844x390 and the overlay mounted in `#hud`: 2 columns, scrolls, `#touch` hidden, a mouse
click on the L5 card -> `pick4`. No console errors.

## WO9 FIX-2
- Thumbnail water: `pit` falls back to `mix(waterDeep, waterLight, 0.25)` when a theme has no hex
  `pit` / `water` (TEMPLE: teal instead of navy). OUTPOST unchanged.
- Card: the `L<n>` number uses `--ls-num` = the level accent lifted toward white until its luminance
  is >= 0.55, on a dark chip with a text shadow. The difficulty row keeps `difficultyLine` (pinned by
  tests) and appends a smaller `.ls-diff-x` span from the new pure `difficultyExtra(def)`
  (`"COUNT x1.6 · SPRINT +7"`, sprint = rounds earlier); `cardInfo` has `difficultyExtra` too, and
  the aria-label includes it.
