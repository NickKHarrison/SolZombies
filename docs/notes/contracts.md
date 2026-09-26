# Contract tests (Agent M)

File: `tests/contracts.test.js`. Run with `npm test` (or `node --test tests/contracts.test.js`).

## What it checks

1. **3.1 config.js**: `TILE`, `FIXED_DT_CAP` are numbers; `CANVAS, POINTS, PLAYER, ZOMBIE, ROUNDS,
   POWERUPS, PRICES, MYSTERY_BOX, COLORS` are objects and contain every key listed in 3.1 with the
   right primitive type (nested: `ZOMBIE.speeds.{walk,jog,sprint}`, all 8 `POWERUPS.weights`, the 5
   `POWERUPS.duration` entries). Values are NOT pinned (tuning is allowed), except
   `POINTS.perKill === 10`, which the order mandates.
2. **3.2 events.js**: `on/off/emit/clearAll` are functions; `on()` returns a working unsubscribe.
   Plus: every literal `emit('name'...)` in `src/*.js` (comments stripped) must be in the canonical
   22-event table. Dynamic names (`emit(someVar)`) are not checked.
3. **3.3 math.js**: all 12 exports are functions; `createRng()` returns an object with
   `next, range, int, pick, chance, weighted`; `nextId()` increases.
4. **3.4 state.js**: `createEmptyState(seed)` returns every top-level key with the right kind
   (`map/player/flow/rounds` are `null`), plus the nested `powerups`, `shop.box`, `stats` keys.
5. **3.6 module APIs**: one test per module (`input, player, weapons, zombie, pathfinding, waves,
   powerups, map, shop, render, hud, audio`). Each test dynamically imports the module, so an
   import-time throw (e.g. a DOM module touching `window` at top level, or a missing named import
   from a sibling module) fails that module's test alone with the stack in the message. Every
   listed export must exist and be a function, except: `WEAPONS`, `POWERUP_LABEL` = plain object;
   `WALL_WEAPON_IDS`, `BOX_WEAPON_IDS`, `POWERUP_TYPES`, `MAP_ASCII` = array (per 5.1 / 5.8 and the
   Phase 0 stubs).
6. **Rules 4 and 6**: for the pure modules (`player, weapons, zombie, pathfinding, waves, powerups,
   map, shop`) the source is read, comments removed and string contents blanked, then scanned for
   `window`, `document` (bare identifiers, not `.window` property access), `requestAnimationFrame`
   and `Math.random`. Failures list the line numbers.

## Decisions / assumptions

- Only shape is tested, never behaviour. Behaviour belongs to each owner's `tests/<module>.test.js`.
- `canvas` (listed in rule 4) is not scanned for: the task brief for Agent M named only
  `window/document/requestAnimationFrame/Math.random`, and `canvas` is a plausible word in pure
  code (for example comments or config names), which would cause false positives.
- The comment stripper is a small scanner (strings, template literals, `//`, `/* */`). It does not
  parse regex literals or `${...}` inside templates, so a reference hidden inside a template
  expression in a pure module will not be caught. Good enough for this codebase.
- A transitive import failure is attributed to every module that imports the broken one. Read the
  message: it names the file and missing export actually at fault.

## Status when written

Export-existence tests pass against the Phase 0 stubs. During my final run, other Phase 1 agents
were still mid-edit: `src/map.js` did not yet export `loadMap`/`repairAll`/etc., so `map`
failed, and so did most other modules transitively (`player, weapons, zombie, waves, powerups,
shop, hud, audio`), because they import `map.js` directly or through `weapons.js`/`zombie.js`.
The source-text (rule 4/6) and event-name checks passed on that run. These failures are expected to clear once Agent H finishes. They are not
problems with the tests. The integrator should re-run `npm test` after Phase 1.

## Observations for the integrator

- There is a circular import graph: `weapons -> player`, `powerups -> player/weapons/zombie/waves/map`,
  etc. ES modules handle cycles, but only because no module uses an imported binding at top level.
  Keep it that way (no top-level calls into sibling modules).
- `state.js` comment lists a `'paused'` phase not in the 3.4 contract text. The test does not pin
  phase values beyond the initial `'menu'`.

## WO2 (Agent K)

### `tests/contracts.test.js` additions
- **Pure scan:** the rule 4/6 check (no `window`/`document`/`requestAnimationFrame`/`Math.random`) now also covers `sprites/palette.js`, `soldier.js`, `guns.js`, `face.js` and `animator.js`. `pixel.js` is deliberately excluded, because its `toCanvas`/`drawSprite` touch the DOM lazily.
- **Event-name scan:** it now also reads `src/sprites/*.js`. WO2 adds no events, and the canonical list is unchanged.
- **`WO2 3.1-3.6 sprites/<m>.js`:** one import-and-exports test per sprite module. `pixel` includes the extra `placeholderSprite`, and `PLACEHOLDER` must be an object.
- **`WO2 3.3 config.SPRITES shape`** and **`WO2 3.4-3.6 sprite data shapes`:** the structure of `SOLDIER`, `GUN_SPRITES` (all 10 keys), `FACE`, `createFaceState()` fields and `createPlayerAnim()` fields.
- **`WO2 new exports`:** `weapons.WONDER_WEAPON_IDS` (an array that contains raygun and thundergun), `zombie.applyKnockback` and `render.getMuzzleWorld`.
- **`WO2 new config and weapon defs`:** `WEAPON_FX.shockwaveTtl`/`thundergunShake`, `ZOMBIE.knockFriction`/`stunMinSpeed`, `SHOP.boxWeights.wonder`, `WEAPONS.thundergun.cone.*`, thundergun in the box, and the Death Machine not in the box.
- **Shockwave:** the contract tests do not check effect-type lists, so there is no `shockwave` assertion here. Behaviour is covered by the weapons tests.

### `tests/sprites.test.js` (new, 3.12)
- **Structural checks.** These must pass for both stubs and final art:
  - Declared sizes: legs and torso 16x16, down 20x20, and every face layer 24x30.
  - Each gun is within about 50% of the 3.4 nominal width, is wider than it is tall, has a valid pose, and has weight 1 or 1.6.
  - `rows` has the right shape, contains only palette chars, and re-parses to identical pixels.
  - Every visible pixel is an opaque palette colour. This also covers sprites with `rows = null`.
  - Anchors, hands, grip and muzzle are in bounds, measured from pixel corners (`0..w`, `0..h` inclusive), and `muzzle.x > grip.x`.
  - Legs have 8 frames and reload has 2 frames per pose.
  - `gunSpriteFor` resolves in the order sprite → id → cls → default. Every `WEAPONS` def resolves: raygun, thundergun and deathmachine get their own sprite, and other weapons get their cls sprite.
  - `healthTier` thresholds are correct, and `composeFace` returns 24x30 for tiers 0-4, wince, grin and dead, memoized per key.
  - A grin has no effect while dead.
  - `quantizeAngle`/`compose`/`placeholderSprite` unit checks.
- **End-state gates.** These are *expected to fail until the art lands*:
  - `art complete: no placeholder sprites`: lists every sprite that is `PLACEHOLDER`, is flagged `placeholder`, has `'x'` in its rows, or has a magenta pixel (this includes `composeFace` outputs).
  - `art complete: FACE.blood[0] (tier 0) is an empty overlay and higher tiers are not`.
  - The integrator must see both gates green before sign-off.

### Status when written
- `npm test`: 241 tests, 239 pass, 2 fail. Both failures are the expected `art complete:` gates.
- The gates currently list 47 placeholders across the soldier (Agent A) and the face (Agent C). The gun art (Agent B) has landed and passes every check.
- G/H/E exports and config have already landed, and the `WO2 new exports` test passes.
