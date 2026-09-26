# WORK ORDER 2 — Pixel-art soldier, Wolfenstein status face, wonder weapons

Follow-up to `WORK_ORDER.md` (v1, complete: 163 tests green, playable). This order adds:

1. **An 8-bit, top-down, arcade-quality player sprite**: a strong army soldier with animated arms
   and legs, whose held gun changes graphics per weapon.
2. **A Wolfenstein 3D style status face** at the bottom middle of the screen that shows health
   (blood, bruising, expression) and is slightly animated (glances, blinks, winces, grins).
3. **Ray Gun and Thundergun obtainable from the Mystery Box** (Ray Gun already exists; add the
   Thundergun with its cone blast and knockback).

Same working method as v1: one file, one owner; contracts first; fan out; integrate; QA; fix.
**Up to 11 agents run in parallel in Phase 1.** Read Section 0 and Section 3 before coding.

---

## 0. Rules for every agent (unchanged from v1, plus art rules)

1. **One file, one owner.** Edit only the files listed for your agent in Section 2.1. Bugs in
   other files go in your notes file `docs/notes/<module>.md` (append a "WO2" section).
2. **Frozen after Phase 0 of this order:** `src/sprites/palette.js`, `src/sprites/pixel.js`,
   `src/config.js` `SPRITES` block, `tools/sprite-preview.html`. Everything frozen in v1 stays
   frozen (`events.js`, `math.js`, `state.js`, `index.html`) except where Section 2.1 says
   otherwise.
3. **Code against Section 3 contracts, not against other agents' files.** Stubs exist after
   Phase 0 so imports resolve.
4. **Pure modules never touch the DOM.** All `src/sprites/*.js` except `pixel.js` are pure data
   and logic and must run under `node --test`. `pixel.js` may touch `document` only inside
   `toCanvas`/`drawSprite`.
5. **No image files.** All art is authored as ASCII pixel grids (Section 3.2) using the shared
   palette. No PNGs, no data URIs, no downloads. This keeps art diffable, testable and
   agent-authorable.
6. **Look at your art.** Art agents must open `tools/sprite-preview.html` in the browser (serve
   with `python -m http.server <port>`, use the Chrome tools, take screenshots) and iterate
   until it reads clearly at 1x game scale and 6x preview scale. Do not ship art you have not
   seen.
7. **Verify:** `node --check` on every file you touched; `npm test` (which is
   `node --test "tests/*.test.js"`; note `node --test tests/` does not work on this Node) must
   stay green; logic modules ship tests.
8. **Safety:** no git, no deleting/renaming files you do not own, no global installs, no network
   fetches, stay inside the project directory and your scratchpad. Stop any http server you
   started. Close browser tabs you opened.
9. **Do not expand scope.** Ideas go in notes. Zombie sprites are explicitly out of scope
   (Section 7).
10. **Do not ask questions.** Decide, document, move on.

---

## 1. Visual target

### 1.1 The soldier (top-down, 8-bit)

- Camera is straight down. We see the top of a helmet, broad shoulders, two arms reaching
  forward holding the gun, and boots stepping below the shoulders.
- **"Strong army guy":** shoulders clearly wider than the helmet, thick arms, olive fatigues,
  tan/skin forearms, dark green helmet with a lighter highlight and a chin-strap line, black
  boots, a small tan backpack/webbing patch between the shoulders. 1-px black (`k`) outline
  around the whole silhouette, NES/arcade style. Limited palette only (Section 3.1).
- **Two-layer sprite** (classic twin-stick approach):
  - **Legs layer** rotates to the *movement* direction (or the aim direction when standing
    still). 8-frame walk cycle: boots alternate forward/back with a slight body sway. Frame 0 is
    the neutral stance. Cycle speed is tied to distance travelled so feet never "skate".
  - **Torso layer** (helmet, shoulders, arms, gun) rotates to the *aim* direction. Three arm
    poses: `onehand` (pistols: right arm extended, left arm at side), `twohand` (SMG/AR/shotgun/
    sniper: both arms forward on the gun), `heavy` (LMG, Death Machine, Thundergun: gun held at
    the hip, arms wide).
- **Gun sprites** attach to the torso's hand anchor; each is a distinct top-down silhouette so
  the player can tell a shotgun from an SMG from an LMG at a glance. The Ray Gun is bulbous with
  green rings; the Thundergun is a long thick barrel with a bell muzzle and blue coils; the
  Death Machine is a fat multi-barrel.
- **Animation:** recoil (torso and gun jump back 2–3 px for ~60 ms on every shot; heavy guns
  shake more), reload (two alternating "arms pulled in" frames for the whole reload time),
  sprint (walk cycle at 1.5x speed with a slight forward lean = torso shifted 1 px forward),
  down (lying sprite, unrotated, with a blood pool underneath).
- **Rotation rule:** rotate pre-rendered pixel sprites with image smoothing OFF and quantize the
  drawn angle to `SPRITES.directions` (default 32 steps of 11.25°) so the sprite stays chunky
  and arcade-like. Gameplay aim stays continuous; only the drawing is quantized.
- Scale: 1 sprite pixel = `SPRITES.scale` (2) world pixels. The torso grid is 16×16, so
  the soldier is ~32 px across, matching the current 14 px collision radius. The legs grid is
  26×26 (Phase 2 integration change) so boots stride ~9 sprite px in front of / behind the torso.

### 1.2 The status face (Wolfenstein 3D style)

- Lower-left corner of the screen at 0.8 scale (moved from bottom middle by WORK_ORDER_3),
  inside a grey metal **bezel** panel like the Wolfenstein status
  bar: dark steel plate, lighter bevelled edge, a recessed dark window holding the face.
  Left of the face: `HEALTH` label and a big percentage. Right of the face: `KILLS` and the
  count. The "Press F to buy" prompt stays bottom-centre (WO3); the points readout sits above the bezel.
- Face grid is **24×30** pixels, drawn at `SPRITES.faceScale` (4x = 96×120 css px at 720p,
  scaled with the HUD). `image-rendering: pixelated`.
- Look: BJ Blazkowicz-like. Square jaw, short blond hair, blue eyes, thick neck, dark green
  collar. Front-facing, slight 3/4 shading, 1-px dark outline, 8-bit palette.
- **Health tiers** (by `health / maxHealth`): 0 ≥ 85 %, 1 ≥ 65 %, 2 ≥ 45 %, 3 ≥ 25 %, 4 > 0 %,
  and **dead**. Each tier worsens: tier 0 alert and clean; tier 1 sweat beads, slight frown;
  tier 2 a cut on the forehead with a blood streak, bruised cheek; tier 3 blood from nose and
  brow, one eye squinting, hair messed; tier 4 face streaked with blood, both eyes half shut,
  grimace, pale skin; dead: eyes closed/crossed, mouth slack, blood over most of the face,
  head tilted.
- **Animation** (subtle, arcade style): eyes glance left / centre / right at random every 1–3 s;
  blink every 3–6 s for 0.12 s; **wince** frame (eyes shut, mouth pained) for 0.4 s on taking
  damage; **grin** for 1.0 s on picking up a power-up or getting a new gun (Doom style); a slow
  breathing bob of 1 px. As health regenerates the tiers go back up (blood fades).
- Layered composition (keeps the art count sane): one base head per tier group is not needed;
  instead: `base` head + `hair` + `eyes[variant]` + `mouth[variant]` + `blood[tier]` overlay +
  optional `pale` tint for tier 4, and a single full `dead` sprite. See 3.5.

### 1.3 Wonder weapons

- **Ray Gun** already exists (projectile, splash). Give it its own gun sprite and keep it
  box-only.
- **Thundergun** (box-only): 4 in the "mag", 12 reserve, 3.0 s reload, single shot. Fires a
  **cone of air**: every zombie inside `killRange` and within `halfAngle` of the aim dies
  (normal kill, normal 10 points, can drop power-ups); zombies between `killRange` and `range`
  in the cone are **knocked back** hard and stunned. Big screen shake, a visible expanding
  shockwave cone, and a deep boom. Both wonder weapons share the lowest box weight.

---

## 2. Files and ownership

```
Sol Game/
├─ WORK_ORDER_2.md                      (this file, read-only)
├─ tools/
│  └─ sprite-preview.html               Phase 0 — FROZEN   preview page for all sprite modules
├─ src/
│  ├─ config.js                         Phase 0 adds SPRITES block (frozen); Agent G edits SHOP/WEAPON_FX only
│  ├─ sprites/
│  │  ├─ palette.js                     Phase 0 — FROZEN   shared 8-bit palette
│  │  ├─ pixel.js                       Phase 0 — FROZEN   grid parser, compose, canvas cache, drawSprite
│  │  ├─ soldier.js                     Agent A            legs + torso + down sprites
│  │  ├─ guns.js                        Agent B            per-class/per-weapon gun sprites + anchors
│  │  ├─ face.js                        Agent C            face layers + face state machine
│  │  └─ animator.js                    Agent D            player animation state (legs phase, recoil, reload)
│  ├─ render.js                         Agent E            sprite player drawing, muzzle snapping, shockwave, stunned zombies
│  ├─ hud.js + styles.css               Agent F            status bezel + face canvas, prompt relocation
│  ├─ weapons.js + shop.js              Agent G            Thundergun, cone fire, box weights, sprite ids
│  ├─ zombie.js                         Agent H            knockback + stun
│  ├─ audio.js                          Agent I            Thundergun boom, knockback thud, face wince grunt
│  └─ main.js                           Integrator         debug hooks for face/anim, wiring fixes
└─ tests/
   ├─ sprites.test.js                   Agent K            grid validation for every sprite module
   └─ contracts.test.js                 Agent K            add new modules/exports to the contract checks
```

### 2.1 Ownership table

| Agent | Owns (create/edit)                                                                 | Phase |
|-------|------------------------------------------------------------------------------------|-------|
| 0     | src/sprites/palette.js, src/sprites/pixel.js, tests/pixel.test.js, tools/sprite-preview.html, config.js `SPRITES` block, stubs for soldier.js/guns.js/face.js/animator.js | 0 |
| A     | src/sprites/soldier.js, docs/notes/soldier.md                                       | 1 |
| B     | src/sprites/guns.js, docs/notes/guns.md                                             | 1 |
| C     | src/sprites/face.js, tests/face.test.js, docs/notes/face.md                         | 1 |
| D     | src/sprites/animator.js, tests/animator.test.js, docs/notes/animator.md             | 1 |
| E     | src/render.js, docs/notes/render.md (append)                                        | 1 |
| F     | src/hud.js, styles.css, docs/notes/hud.md (append)                                  | 1 |
| G     | src/weapons.js, src/shop.js, tests/weapons.test.js, tests/shop.test.js, config.js `SHOP` and `WEAPON_FX` blocks only, docs/notes/weapons.md + shop.md (append) | 1 |
| H     | src/zombie.js, tests/zombie.test.js, config.js `ZOMBIE` block only, docs/notes/zombie.md (append) | 1 |
| I     | src/audio.js, docs/notes/audio.md (append)                                          | 1 |
| K     | tests/sprites.test.js, tests/contracts.test.js, docs/notes/contracts.md (append)    | 1 |
| INT   | src/main.js, plus any file to fix integration mismatches                            | 2 |
| QA-1..3 | docs/qa/wo2-*.md only                                                             | 3 |
| FIX-n | files named in the finding group                                                    | 4 |

`config.js` is shared by three agents (0, G, H) but each edits a **different named block** and
must use targeted edits only (never rewrite the file). Phase 0 adds the `SPRITES` block first.

---

## 3. Shared contracts

### 3.1 `src/sprites/palette.js` (Phase 0, frozen)

A single case-sensitive character → CSS colour map. `.` is transparent. Art agents may use only
these characters. Phase 0 writes exactly this set (art agents may request additions in notes;
they will not be added during Phase 1):

```js
export const PALETTE = Object.freeze({
  '.': null,        // transparent
  'k': '#0b0b0d',   // outline black
  'K': '#26262b',   // dark grey
  'm': '#4a4a54',   // gun metal dark
  'M': '#7c7c88',   // gun metal light
  'W': '#b9b9c2',   // steel highlight
  'w': '#f2f2f2',   // white
  'g': '#3f4f26',   // olive dark (fatigues shadow, helmet)
  'G': '#5f7a3a',   // olive
  'L': '#86a050',   // olive highlight
  'o': '#6e4f2a',   // brown dark (boots, straps)
  'O': '#a67c48',   // tan (webbing, backpack)
  't': '#d2a679',   // tan light
  's': '#e5b48f',   // skin
  'S': '#c48a63',   // skin shadow
  'P': '#f0cdb0',   // skin pale (tier 4)
  'h': '#c9a13a',   // hair blond
  'H': '#8a6a1e',   // hair blond shadow
  'e': '#2e6fd6',   // eye blue
  'r': '#8f0f0f',   // blood dark
  'R': '#d92626',   // blood bright
  'y': '#ffd54a',   // yellow (muzzle, tracer)
  'n': '#6cf542',   // ray gun green
  'N': '#2f8f1f',   // ray gun green dark
  'c': '#3ec9ff',   // thundergun cyan
  'C': '#1c6fa8',   // thundergun blue dark
  'p': '#b44dff',   // purple accent
  'x': '#ff00ff',   // placeholder magenta (never ship)
});
```

### 3.2 `src/sprites/pixel.js` (Phase 0, frozen)

A **grid** is an array of equal-length strings of palette characters. A **Sprite** is
`{ w, h, rows, pixels }` where `pixels` is an RGBA `Uint8ClampedArray` of length `w*h*4`.

```js
export function parseGrid(rows, palette = PALETTE)     // -> Sprite. Throws on ragged rows or unknown chars.
export function compose(layers)                         // [{ sprite, dx = 0, dy = 0 }] -> Sprite (size of first layer, later layers drawn over, alpha 0 = skip)
export function tint(sprite, mapFn)                     // mapFn(r,g,b,a,x,y) -> [r,g,b,a]; returns a new Sprite
export function flipX(sprite) / export function flipY(sprite)
export function spriteKey(sprite)                       // stable string id for caching
export function toCanvas(sprite, scale)                 // DOM: cached offscreen canvas at integer scale, smoothing off
export function drawSprite(ctx, sprite, x, y, opts)     // DOM: opts { scale = SPRITES.scale, angle = 0, ax = w/2, ay = h/2, alpha = 1, directions = SPRITES.directions }
                                                        // draws sprite with anchor (ax, ay in sprite px) at world (x, y), rotated by angle quantized to `directions` steps, smoothing off
export function quantizeAngle(angle, directions)        // pure helper; directions <= 0 means continuous
export const PLACEHOLDER                                // 16x16 magenta/black checker Sprite
export function isPlaceholder(sprite)
```

### 3.3 `src/config.js` additions (Phase 0 writes `SPRITES`; G and H edit their own blocks)

```js
export const SPRITES = {
  scale: 2,             // sprite px -> world px
  directions: 32,       // rotation quantization steps (0 = continuous)
  strideLength: 72,     // world px travelled per full 8-frame walk cycle (Phase 2: was 44; matches the 26x26 legs' +-9 px boot swing)
  sprintCycleMult: 1.5,
  recoilPx: 3,          // torso/gun kickback in sprite px (light guns); heavy = x1.6
  recoilTime: 0.06,
  reloadFrameTime: 0.15,
  faceScale: 4,
  face: { glanceMin: 1.0, glanceMax: 3.0, blinkMin: 3.0, blinkMax: 6.0, blinkTime: 0.12, winceTime: 0.4, grinTime: 1.0 },
};
// Agent G adds to WEAPON_FX: shockwaveTtl: 0.45, thundergunShake: { ttl: 0.5, magnitude: 10 }
// Agent G changes SHOP.boxWeights to { wall: 3, boxOnly: 2, wonder: 1 } (raygun -> wonder) and updates shop.js/weapons.js accordingly
// Agent H adds to ZOMBIE: knockFriction: 6, stunMinSpeed: 20
```

### 3.4 `src/sprites/soldier.js` (Agent A) and `src/sprites/guns.js` (Agent B)

All sprites face **+x (right)** at angle 0. Anchors are in sprite pixels.

```js
// soldier.js
export const SOLDIER = {
  legs:        { frames: Sprite[8], anchor: { x: 13, y: 13 } },         // 26x26 each; frame 0 neutral (Phase 2: was 16x16, boots hid under the torso)
  torso: {
    idle:      { onehand: Sprite, twohand: Sprite, heavy: Sprite },      // 16x16
    reload:    { onehand: [Sprite, Sprite], twohand: [Sprite, Sprite], heavy: [Sprite, Sprite] },
    walk:      { onehand: Sprite[8] },                                   // Phase 2, optional per pose: arm swing indexed by legs frame (16x16)
    reloadGunOffset: [{ x, y }, { x, y }],                               // Phase 2: gun grip offset from hand[pose] per reload frame (gun pulled in)
    anchor:    { x: 8, y: 8 },                                           // rotation centre (body centre)
    hand:      { onehand: { x, y }, twohand: { x, y }, heavy: { x, y } }, // where a gun's grip anchor attaches
  },
  down:        { sprite: Sprite /* 20x20 */, anchor: { x: 10, y: 10 } },
  shadow:      { rx: 7, ry: 5 },                                         // ellipse in sprite px
};

// guns.js
export const GUN_SPRITES = {
  pistol, smg, ar, shotgun, sniper, lmg, raygun, thundergun, deathmachine, default:
    { sprite: Sprite, grip: { x, y }, muzzle: { x, y }, pose: 'onehand' | 'twohand' | 'heavy', weight: 1 | 1.6 }
};
export function gunSpriteFor(weaponDef)   // by weaponDef.sprite, else weaponDef.cls, else default
```

Grid sizes for guns: pistol ~8×4, smg ~12×5, ar ~16×5, shotgun ~16×5, sniper ~20×4, lmg ~18×7,
raygun ~14×8, thundergun ~20×8, deathmachine ~18×9. `grip` is the point that sits on the
torso hand anchor; `muzzle` is where flashes/tracers start.

### 3.5 `src/sprites/face.js` (Agent C, pure)

```js
export const FACE = {
  w: 24, h: 30,
  base: Sprite,                                     // head, neck, collar, skin, outline (tier 0 look)
  hair: { neat: Sprite, messy: Sprite },
  eyes: { center, left, right, closed, squint, pain },   // Sprites, transparent except eyes
  mouth: { neutral, frown, grit, grin, pain, slack },
  blood: [Sprite, Sprite, Sprite, Sprite, Sprite],  // overlays for tiers 0..4 (tier 0 = empty)
  dead: Sprite,                                     // full 24x30 face
};
export function healthTier(frac)                    // 0..4 per 1.2 thresholds
export function createFaceState(seed = 1)           // { tier, look, lookT, blinkT, blinkFor, winceT, grinT, breathe, dead, rng }
export function updateFaceState(fs, healthFrac, down, dt)   // deterministic timers via fs.rng (math.createRng)
export function faceEvent(fs, kind)                 // 'hurt' -> wince; 'grin' -> grin
export function faceFrameKey(fs)                    // e.g. "t2:left:grit:blink0"
export function composeFace(fs)                     // -> Sprite, memoized by faceFrameKey
```
Tier → default expression: 0 `neutral`, 1 `frown`, 2 `grit`, 3 `grit` + `squint`, 4 `pain` +
`squint` + `pale` tint; dead → `FACE.dead`. Wince overrides eyes `closed` + mouth `pain`; grin
overrides mouth `grin` (never while dead).

### 3.6 `src/sprites/animator.js` (Agent D, pure)

```js
export function createPlayerAnim()
// { walkDist, legFrame, legAngle, moving, recoil, recoilDir, reloadFrame, reloadT, pose, lastX, lastY, initialized }
export function updatePlayerAnim(anim, player, weaponDef, weapon, dt)
//  - distance travelled since last call advances walkDist; legFrame = floor(walkDist / (strideLength/8)) % 8
//  - sprinting multiplies cycle speed by SPRITES.sprintCycleMult; standing still snaps to frame 0 after 0.1 s
//  - legAngle = movement direction while moving, else player.angle
//  - recoil decays to 0 over SPRITES.recoilTime
//  - reloadFrame alternates 0/1 every SPRITES.reloadFrameTime while weapon.reloading
//  - pose = gunSpriteFor(weaponDef).pose
export function noteShot(anim, weaponDef)       // recoil = SPRITES.recoilPx * gun weight, recoilDir = current aim
export function resetPlayerAnim(anim)
```

### 3.7 Render (Agent E) — `src/render.js`

- Replace `drawPlayer` (currently `render.js:790`, circle + barrel) with the two-layer sprite
  draw. Order: shadow ellipse → legs (`legAngle`) → torso pose (aim angle, offset by recoil
  along −aim, +1 px forward when sprinting) → gun sprite composed at the hand anchor (rotates
  with the torso) → helmet highlight is part of the torso art. When `player.down`: draw
  `SOLDIER.down` unrotated plus a blood pool (reuse the big blood effect look).
- Keep one module-level `anim` (from `animator.js`), reset in `initRender`, subscribe to
  `weapon:fired` → `noteShot`, update it once per `render(state)` call with `state.dt`.
- **Muzzle snapping:** export `getMuzzleWorld(state)` (world x,y of the gun sprite's muzzle
  for the current pose/aim/recoil). When drawing `muzzle` effects and `tracer` effects whose
  start is within 40 px of the player, use the muzzle position instead of the effect's own
  origin. Purely visual; gameplay hitscan origin is unchanged.
- **Shockwave effect** `{ type: 'shockwave', x, y, angle, range, halfAngle, ttl, maxTtl }`:
  2–3 expanding translucent white/cyan arcs clipped to the cone plus a few dust specks; the
  cone reaches `range` at `ttl = 0`.
- **Stunned zombies** (`z.stun > 0`): draw flattened (scale y 0.6, rotated to knock direction)
  and with a small dust puff on the first frame.
- Wall-buy chalk silhouettes may reuse `GUN_SPRITES` (draw at scale 3, chalk-tinted via
  `tint`) so wall art matches held guns. Optional but recommended.

### 3.8 HUD (Agent F) — `src/hud.js`, `styles.css`

- Build a `.hud-status` bezel in the lower-left corner at 0.8 scale (per WORK_ORDER_3; it was
  originally bottom centre). The points block sits directly above it; the prompt and fire-sale
  banner stay at plain bottom-centre `bottom: 6cqh`.
  Contents: `.hud-status-health` ("HEALTH" label + `NN%`), `.hud-face` (`<canvas
  width=24 height=30>` with `image-rendering: pixelated`, displayed at `SPRITES.faceScale`
  equivalent in `cqh`), `.hud-status-kills` ("KILLS" + count). Bevelled steel look via CSS
  gradients and borders, dark inset window around the face.
- Own a `faceState` (from `face.js`), created in `initHud`, updated in `updateHud` with
  `player.health / player.maxHealth`, `player.down`, and `state.dt`. Redraw the face canvas
  only when `faceFrameKey` changes (put the composed sprite via `putImageData` on a 24×30
  backing canvas; CSS scales it). Health % text turns yellow below 65 % and red below 25 %.
- Subscribe: `player:damaged` → `faceEvent('hurt')`; `powerup:collected` and
  `weapon:equipped` (slot ≥ 0, not during the first second after `game:start`/`game:restart`)
  → `faceEvent('grin')`. Reset face state on `initHud`.
- Hide the bezel in `menu`; keep it on `gameover` showing the dead face.

### 3.9 Weapons and shop (Agent G) — `src/weapons.js`, `src/shop.js`

- Weapon def gains optional fields: `sprite` (gun sprite key) and `cone`:
  ```js
  raygun:     ... sprite: 'raygun'
  thundergun: def({ id: 'thundergun', name: 'Thundergun', cls: 'special', sprite: 'thundergun', cost: null,
                    damage: 0, rpm: 60, auto: false, mag: 4, reserve: 12, reloadTime: 3.0, spread: 0,
                    cone: { range: 480, killRange: 300, halfAngle: 0.52, knockback: 720, stun: 1.2 } })
  deathmachine: ... sprite: 'deathmachine'
  ```
- `tryFire` with `d.cone`: consume one round; for each non-dying zombie with distance ≤ `range`
  and `|angleDiff(aim, toZombie)| ≤ halfAngle` (both bands require `raycastWalls` line of
  sight to the zombie's near edge; walls and boarded windows block, lead decision after QA): if distance ≤ `killRange` →
  `damageZombie(state, z, Infinity, 'weapon', z.x, z.y)`; else `zombie.applyKnockback(state, z,
  dirX * knockback, dirY * knockback, stun)`. Push `shockwave` effect and a `shake` effect
  (`WEAPON_FX.thundergunShake`). Emit `weapon:fired` as usual. `stats.shotsHit++` if anything
  was affected.
- `WONDER_WEAPON_IDS = ['raygun', 'thundergun']` (export). `BOX_WEAPON_IDS` includes
  thundergun. Weights: wonder ids use `SHOP.boxWeights.wonder`; update `shop.js` `boxWeights`
  to match (rename `raygun` → `wonder`). Death Machine stays excluded from the box.
- Tests: cone kill/knockback geometry (inside/outside angle, inside/outside ranges), one round
  consumed, weights include thundergun at wonder weight, box can offer thundergun with a seeded
  rng, reload/refill behave for a 4/12 weapon.

### 3.10 Zombie (Agent H) — `src/zombie.js`

```js
export function applyKnockback(state, z, vx, vy, stunSeconds)  // sets z.kvx, z.kvy, z.stun = max(z.stun, stunSeconds), z.knockAngle
```
- In `updateZombies`: a zombie with `z.stun > 0` skips AI and attacking, moves by `(kvx, kvy)`
  with exponential friction `ZOMBIE.knockFriction`, is clamped by `map.resolveCircle`, and
  decrements `stun`. Below `ZOMBIE.stunMinSpeed` the velocity is zeroed. When stun ends it
  resumes its previous mode (`chasing` if it was attacking). Tearing zombies in pockets are
  not knocked (ignore knockback while `mode === 'tearing'`). Knocked zombies can still be shot
  and killed. Separation still applies after the knock move.
- Tests: knockback moves and decays, stun blocks attacks, stun expiry resumes chasing, wall
  stops the slide.

### 3.11 Audio (Agent I) — `src/audio.js`

- `weapon:fired` with `weaponId === 'thundergun'`: deep sub boom + air whoosh (noise sweep
  down) ~0.6 s, louder than any gun. `weaponId === 'raygun'` already has a zap; keep.
- New: listen to `zombie:hit`? No new event exists for knockback; instead audio listens to
  `weapon:fired` for thundergun and plays a delayed "bodies thud" 120 ms later.
- `player:damaged` already grunts; make it a short pained "ugh" that fits the wince.

### 3.12 Tests (Agent K)

- `tests/sprites.test.js`: for every grid-derived sprite in `soldier.js`, `guns.js`, `face.js`:
  correct declared size, parse without error (only palette chars), anchors/grip/muzzle inside
  bounds, no `x` placeholder pixels, legs has 8 frames, each face layer is 24×30, each gun's
  `muzzle.x > grip.x`. Also `quantizeAngle` and `compose` unit checks against `pixel.js`.
- `tests/contracts.test.js`: add `sprites/soldier.js`, `guns.js`, `face.js`, `animator.js` to
  the pure-module DOM scan (not `pixel.js`), assert the new exports in 3.4–3.6 and 3.9–3.10
  exist, and add `shockwave` handling expectations if the event/effect lists are checked.

### 3.13 Preview page `tools/sprite-preview.html` (Phase 0, frozen)

Standalone ES-module page served from the project root (`/tools/sprite-preview.html`) that:
- imports `soldier.js`, `guns.js`, `face.js`, `animator.js`, `pixel.js`;
- draws, at 6x with labels: all 8 leg frames; the 3 torso poses and their reload frames; each
  torso pose with each gun attached at the hand anchor (grid of pose × gun); each gun alone
  with grip and muzzle marked; the down sprite; all face tiers with every eye/mouth variant;
  the composed face for tiers 0–4 and dead;
- has a live strip at 1x and 3x: soldier walking in a circle with a selectable gun (dropdown),
  firing every 0.5 s (recoil) and reloading every 4 s; and a face that runs the real state
  machine with a health slider and "hurt" / "grin" buttons;
- shows a magenta warning banner listing any sprite that is still `PLACEHOLDER`.

---

## 4. Execution plan

### Phase 0 — Scaffold (1 agent)

1. `palette.js`, `pixel.js` exactly per 3.1–3.2, with `tests/pixel.test.js` (parse, ragged
   rows throw, unknown char throws, compose, flip, quantizeAngle).
2. Add the `SPRITES` block to `config.js` (targeted insert after `LOOP`).
3. Stubs: `soldier.js`, `guns.js`, `face.js`, `animator.js` exporting every name in 3.4–3.6
   with `PLACEHOLDER` sprites and no-op logic (so render/hud can wire before art lands).
4. `tools/sprite-preview.html` per 3.13 (works against the stubs, shows the placeholder banner).
5. `npm test` green, `node --check` on all touched files. Serve and screenshot the preview
   page once to prove it loads.

### Phase 1 — Parallel build (11 agents: A B C D E F G H I K, plus 0's follow-up if needed)

All at once. Art agents (A, B, C) iterate with the preview page. E and F wire against stubs and
switch to real art automatically when it lands (same import names). G and H are independent
gameplay work. Expected wall time: the slowest art agent (~30–40 min).

### Phase 2 — Integration (1 agent)

Read all WO2 notes. Update `main.js` debug hooks: `__game.debug.face('hurt'|'grin')`,
`__game.debug.setHealth(n)`, `__game.debug.giveWeapon('thundergun')` (already generic).
Serve, open `/?debug=1` and `/tools/sprite-preview.html`, screenshot, fix mismatches (anchor
offsets, rotation direction, muzzle snapping, face redraw cadence, bezel layout at 16:9 and at
narrow windows). Confirm `npm test` green. Write `docs/notes/integration-wo2.md`.

### Phase 3 — QA (3 agents, report only)

- **QA-1 Visual:** screenshots at game scale of the soldier standing/walking in 8 directions
  with each of the 9 gun sprites, reloading, downed; the face at each tier plus wince and
  grin; the bezel at 1280×720 and at a 900-px-wide window. Judge against Section 1: is it
  clearly a strong soldier, do arms/legs animate at arcade quality, can you tell guns apart,
  does the face read as Wolfenstein? Write `docs/qa/wo2-visual.md` with concrete fixes.
- **QA-2 Gameplay:** Thundergun from the box (weights, ammo, cone kills, knockback, stun,
  points), Ray Gun still works, no regressions in v1 checklist items 1–20, console clean,
  frame cost with 24 zombies still < 3 ms per frame including sprite drawing. Write
  `docs/qa/wo2-gameplay.md`.
- **QA-3 Code review:** render/hud performance (no per-frame canvas allocation, sprite cache
  hits, face redraw only on key change), animator determinism, zombie stun edge cases,
  listener leaks across restart for the new subscriptions. Write `docs/qa/wo2-review.md`.

### Phase 4 — Fix (N agents, one per file group), then a final visual + gameplay recheck.

---

## 5. Acceptance criteria (Definition of Done)

- [ ] Player is a clearly readable 8-bit top-down soldier: helmet, broad shoulders, two arms,
      boots; 1-px outline; palette-only colours; no placeholder magenta anywhere in the game.
- [ ] Legs animate through an 8-frame cycle tied to distance moved; no foot skating; sprint is
      visibly faster; standing still returns to neutral.
- [ ] Torso follows the mouse aim; legs follow movement direction; rotation is quantized and
      stays crisp (smoothing off).
- [ ] Each of the 9 gun sprite types is visibly different in the soldier's hands; switching
      weapons changes the gun immediately; wall guns, box guns, Death Machine and both wonder
      weapons all show the correct sprite.
- [ ] Recoil on every shot; reload animation for the reload duration; downed sprite on death.
- [ ] Muzzle flashes and tracers start at the gun's muzzle, not the body centre.
- [ ] Status bezel at bottom middle in Wolfenstein style with health % left, face centre,
      kills right; prompt sits above it; nothing overlaps the ammo or points readouts.
- [ ] Face shows 5 living tiers plus dead, with progressively more blood/bruising; glances and
      blinks at random; winces on damage; grins on power-up/new gun; recovers as health regens.
- [ ] Thundergun is in the box at wonder weight, 4/12 ammo, kills everything in the near cone,
      knocks back and stuns the far cone, big shake and shockwave, boom sound; kills pay 10.
- [ ] Ray Gun still obtainable from the box and unchanged in behaviour, now with its own sprite.
- [ ] `npm test` green (v1 tests + new sprite/animator/face/weapons/zombie tests); zero console
      errors from menu through round 3, a death and a restart.
- [ ] Frame cost with 24 zombies stays under 3 ms in the debug step measurement.

---

## 6. Decisions already made (do not re-litigate)

- Art is ASCII-grid pixel art, no image files, shared 24-colour palette.
- Two-layer soldier (legs follow movement, torso follows aim), 16×16 grids at 2x scale, 32
  rotation steps.
- Face is 24×30, layered composition, five living tiers by health fraction plus dead.
- Status bezel replaces the plain bottom-centre prompt position; prompt moves above it.
- Thundergun: 4/12, cone kill 300 px / knockback to 480 px, 30° half angle, box-only.
- Zombies stay as circles in this order (see Section 7).

---

## 7. Out of scope (stretch, not assigned)

Pixel-art zombies (walker/jogger/sprinter sprites with walk cycles), pixel muzzle flash and
blood sprites, pixel power-up icons, Pack-a-Punch camo, a wall-buy chalk sprite pass beyond the
optional reuse in 3.7, a "god mode" face, HUD ammo icon per weapon in the bezel.

---

## 8. Spawn prompts

### Phase 0 — Agent 0
```
You are Agent 0 (scaffold) for WORK_ORDER_2.md in the current directory. Read WORK_ORDER_2.md
fully (and skim WORK_ORDER.md Section 0 for the house rules). Execute Phase 0 exactly per
Section 4 and Sections 3.1, 3.2, 3.3 (SPRITES block only), 3.13: palette.js, pixel.js,
tests/pixel.test.js, the SPRITES block in src/config.js (targeted insert, do not rewrite the
file), stub soldier.js/guns.js/face.js/animator.js exporting every contract name with
PLACEHOLDER sprites and no-op logic, and tools/sprite-preview.html. Serve with `python -m
http.server 8090`, open /tools/sprite-preview.html with the Chrome tools, screenshot it to prove
it loads, then stop the server and close the tab. `npm test` (node --test "tests/*.test.js")
must be green and `node --check` clean. No game logic. No git. Report the file list.
```

### Phase 1 — Art agents A, B, C
```
You are Agent <A|B|C> for WORK_ORDER_2.md in the current directory. Read WORK_ORDER_2.md
Sections 0, 1, 3.1, 3.2 and your contract (<3.4 soldier | 3.4 guns | 3.5 face>). You may ONLY
create or edit the files listed for Agent <LETTER> in Section 2.1. Author every sprite as
ASCII grids using only PALETTE characters, parsed with pixel.parseGrid at module load, matching
the declared sizes and anchors exactly. Iterate visually: serve with `python -m http.server
<8091|8092|8093>`, open /tools/sprite-preview.html in a NEW tab with the Chrome tools, screenshot,
and refine until the art matches Section 1 at both 1x and 6x. Ship no placeholder pixels. Face
agent also implements the pure state machine in 3.5 with tests/face.test.js (deterministic via
math.createRng). Run `node --check` and `npm test`. Write docs/notes/<module>.md including an
ASCII copy of your key frames. Stop your server, close your tab, no git, do not ask questions.
```

### Phase 1 — Logic/integration agents D, E, F, G, H, I, K
```
You are Agent <LETTER> for WORK_ORDER_2.md in the current directory. Read WORK_ORDER_2.md
Sections 0 and 3 in full and your section (<3.6 animator | 3.7 render | 3.8 hud | 3.9 weapons+shop
| 3.10 zombie | 3.11 audio | 3.12 tests>), plus the relevant docs/notes/*.md from v1 for the
files you own. You may ONLY create or edit the files listed for Agent <LETTER> in Section 2.1;
config.js editors touch only their named block with targeted edits. Art modules may still be
placeholder stubs while you work: code against the contract names and anchors, and verify with
placeholders (magenta is fine for you). Keep every v1 contract signature unchanged. Run
`node --check` and `npm test` (node --test "tests/*.test.js"). Agents E and F verify in the
browser via `python -m http.server <8094|8095>` and /?debug=1 with __game.debug.step(). Append a
"WO2" section to your docs/notes file. Stop servers, close tabs, no git, do not ask questions.
```

### Phase 2 — Integrator
```
You are the Integrator for WORK_ORDER_2.md in the current directory. Read WORK_ORDER_2.md fully
and every WO2 section in docs/notes/. Do Phase 2 per Section 4: debug hooks in main.js, then
serve (python -m http.server 8096), open /?debug=1 and /tools/sprite-preview.html, screenshot,
and fix every anchor/rotation/muzzle/face/bezel mismatch in whichever file it lives without
changing contract signatures. Also confirm Thundergun end to end. Stop when Section 5 items
you can check in the browser pass and `npm test` is green. Write docs/notes/integration-wo2.md.
Stop the server, close tabs, no git.
```

### Phase 3 — QA-1 / QA-2 / QA-3
```
You are QA-<N> for WORK_ORDER_2.md in the current directory. Read Sections 1, 4 (Phase 3) and 5.
Perform ONLY the QA-<N> task. You may not edit src/ or tests/. Serve on port <8097|8098|8099>,
use the Chrome tools with a NEW tab, use __game.debug.step() if the tab does not animate, take
screenshots. Write docs/qa/wo2-<visual|gameplay|review>.md as a numbered list: severity, file
and function, repro, expected vs actual, the Section 1/3/5 clause violated, and a concrete fix.
Stop the server, close tabs, no git.
```

### Phase 4 — FIX-n
```
You are FIX-<N> for WORK_ORDER_2.md in the current directory. Read Sections 0 and 3, then fix
exactly these findings: <paste>. You may edit only: <files>. Keep contract signatures. Re-run
`npm test`, re-verify in the browser (own port), append a Resolution line under each finding
in the QA file. Stop servers, close tabs, no git.
```
