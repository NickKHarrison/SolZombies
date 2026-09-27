# render.js — Agent K notes

## What was built
`src/render.js` implements the 3.6 API: `initRender(canvas)`, `updateEffects(state, dt)`,
`render(state)`, `addEffect(state, effect)`.

- **Menu / no map** (`phase === 'menu'` or `state.map == null`): animated dark background
  (scrolling faint grid, drifting red fog, shambling silhouettes, vignette). Driven by
  `performance.now()`, so it animates while `state.time` is frozen.
- **World pass** (camera translate plus shake offset), in this order: cached static layer (floor,
  grid, spawn pockets, open-spawn marks, window frames, walls with 1px edge, chalk wall buys
  showing the weapon name and price), barricade planks (live, one per board, missing boards
  not drawn), mystery box (crate with glowing `?`; the name cycles while `spinning` and turns
  gold while `offering`), power-ups (bobbing rounded square, initials of `POWERUP_LABEL`,
  green `shadowBlur` glow, blinks under `POWERUPS.blinkAt` and faster under 3s), blood effects,
  zombies (corpses first; tier color, darker outline, arms, eyes, `hitFlash` whitening; dying
  zombies fade and shrink by `dyingT / ZOMBIE.deathLinger`), ray gun bullets (green orb with a
  trail), player (shadow, barrel toward `angle`, dimmed when `down`), tracers, muzzle flashes,
  and floating text.
- **Screen pass**: Zombie Blood tint (`rgba(255,90,30,0.25)` plus an orange vignette) while
  `state.powerups.active.zombieBlood > state.time`, a red damage vignette with alpha
  `1 - health/maxHealth`, the full-screen white `flash`, and a debug panel.
- **Debug** (`state.debug`): flow-field arrows per visible tile via `pathfinding.getFlowDir`
  (wrapped in try/catch), zombie `mode` and hp above each zombie, and FPS, zombie and effect
  counts in the top right.

## Effects contract (render owns the semantics)
| type | fields | drawing |
|------|--------|---------|
| tracer | x0,y0,x1,y1 | thin `COLORS.tracer` line, alpha = ttl/maxTtl |
| muzzle | x,y,angle (or dirX,dirY) | small cone + glow |
| blood | x,y (optional seed) | splatter that spreads and fades (deterministic droplets from position) |
| flash | — | full-screen white, alpha = ttl/maxTtl |
| shake | magnitude (default 8) | camera offset; the strongest active shake wins, decaying with ttl |
| text | x,y,text,color | rises 30px over its life, fades; default color `COLORS.hudPoints` |

- A missing `maxTtl` is filled from `ttl` the first time the effect is seen. A missing `ttl`
  gets a per-type default.
- `updateEffects` decrements `ttl`, prunes at `ttl <= 0`, and caps the list at 400 (oldest dropped).
- Unknown effect types are ticked and pruned but not drawn.

## Event subscriptions (in initRender)
- `points:changed` with `delta > 0` and finite x,y pushes a `text` "+N" effect (0.8s).
- `player:damaged` pushes `shake` magnitude 4, ttl 0.3.
- `powerup:collected` with `type === 'nuke'` pushes `shake` magnitude 8, ttl 0.5. The spec
  asks for a shake on nuke, and powerups.js only pushes the flash.
- Handlers have no state reference, so they queue effects in a module-level list. The queue is
  flushed into `state.effects` at the next `updateEffects` or `render` call, and cleared on
  `game:restart`.
- `initRender` is idempotent: it drops its old subscriptions and subscribes again.
  **Integrator: if `events.clearAll()` runs on restart, call `initRender(canvas)` again
  afterwards**, or the floating text and shakes stop.

## Assumptions / decisions
- Map rects (`walls`, `barricades`, `wallBuys`, `box`) are top-left x,y plus w,h in world px.
  Zombies, player, power-up items and bullets use center coordinates.
- Wall-buy text and barricade planks pick their orientation from the neighboring tiles
  (solid on the left and right = horizontal wall).
- Wall-buy price is read from `WEAPONS[id].cost`. Names fall back to the id.
  `POWERUP_LABEL` falls back to the camel-case type upper-cased.
- Other modules are imported as namespaces (`import * as ...`), so missing exports during
  parallel development cannot break module linking.
- Static layer: an offscreen canvas the size of the map (2400x1600), rebuilt when the map
  object or the number of WEAPONS entries changes (so names appear once weapons.js loads).
  Each frame only the visible region is blitted.
- Render never uses `state.rng` or `Math.random()`. Shake and splatter use a sin-hash of
  time/position, so gameplay RNG stays deterministic regardless of frame rate.
- Negative `points:changed` deltas (spending) show no floating text.

## Constants to consider moving to config.js
`EFFECT_CAP = 400`, `TEXT_TTL = 0.8`, `TEXT_RISE = 30`, `DAMAGE_SHAKE {ttl 0.3, mag 4}`,
`NUKE_SHAKE {ttl 0.5, mag 8}`, `ZOMBIE_BLOOD_TINT`.

## Verification
- `node --check src/render.js` passes.
- Smoke-tested in an isolated scratch copy with a mock 2D context: menu and in-game render,
  every effect type, both event handlers, the 400 cap, and pruning.

## Observed elsewhere (not mine to fix)
- At time of writing, `src/zombie.js` imports `barricadeOpen` from `./map.js`, which did not yet
  export it. Importing weapons.js (which imports zombie.js) failed to link. This is probably
  just an in-progress parallel module, but the Integrator should check it.

## Phase 4 fixes (FIX-3: playtest findings #3, #4, #5)
- **#3 Wall buys**: the wall tile now shows only a chalk panel (dashed border) and a filled chalk
  gun silhouette chosen by weapon class (`pistol`, `smg`, `shotgun`, otherwise rifle), always drawn
  upright. The name and price are on a separate label: bold 12px monospace, off-white name and
  yellow price on a dark rounded plate with a chalk border. The label sits on the floor side of
  the wall. Every cardinal neighbor of the wall-buy tile that is `T_FLOOR` or `T_OPEN` gets a
  label, so a wall buy between two rooms (Argus) shows one on each side. Text is always
  horizontal. All of this is still painted once into the cached static layer. A player standing
  flush against the wall can cover the label, and the HUD prompt shows the name and price then.
- **#4 Box label**: `drawBoxLabel` runs after `drawPlayer`, so the player cannot cover it. It is
  bold 17px uppercase on a dark plate with an accent border (cyan while spinning, gold while
  offering). It floats 44px above the box, and flips to 36px below the box when the player is above
  it within 70px horizontally. While offering, a countdown bar under the name shows
  `box.timer / MYSTERY_BOX.offerSeconds`, turning red under 30%. The light beam stays in `drawBox`.
- **#5 Overlays**: both overlays are now elliptical edge vignettes, drawn in a unit space scaled
  to the canvas, so the centre stays clear at any aspect ratio.
  - Damage: the global alpha is `(1 - hp/max) * 0.7`, times 0.6 while Zombie Blood is active.
  - Zombie Blood: a flat `rgba(255,120,40,0.06)` tint plus an orange edge vignette (edge alpha
    0.36).
  - `RENDER.zombieBloodTint` (0.25 in config.js) is no longer used on screen. This is a
    deliberate deviation from 5.10's "25% alpha" for readability.
  - Integrator: `render.js` defines `ZB_FLAT_TINT`, `DAMAGE_VIGNETTE_MAX` and
    `DAMAGE_WITH_ZB_MULT`. Move them into `config.js RENDER` or drop `zombieBloodTint` there.
- Verified in Chrome on port 8083 with `?debug=1`:
  - Wall-buy labels are readable at normal zoom.
  - The box label is visible while spinning and while offering, with the player above the box and
    beside it.
  - At 50/150 hp with Zombie Blood active, the centre is untinted, zombies at the edge are visible,
    and a mid-edge pixel went from floor `50,50,54` to `92,52,43`.
  - `node --check` passes, and `npm test` passes 156/156.

## WO2 (Agent E, 3.7): sprite soldier, muzzle snapping, shockwave, stunned zombies
- **Player** (`drawPlayer`): the circle-and-barrel player is replaced. Draw order:
  1. Shadow ellipse (`SOLDIER.shadow` × scale).
  2. Legs frame `anim.legFrame`, rotated to `anim.legAngle`.
  3. One composed torso+gun sprite, rotated to `player.angle`.

  Every rotation goes through `pixel.drawSprite`, so it is quantized to `SPRITES.directions` with smoothing off.
  - **Composition:** the gun's `grip` sits on `SOLDIER.torso.hand[pose]`. Torso and gun are composed onto a transparent canvas big enough for both (`pixel.compose`), and the rotation anchor is shifted to match. The result is cached in a Map keyed by torso/gun `spriteKey` plus hand, grip, muzzle and anchor (cap 256, FIFO). That gives one entry per pose/gun/reloadFrame. No canvases are allocated per frame; `pixel.toCanvas` caches the scaled canvas.
  - **Reload** uses `SOLDIER.torso.reload[pose][anim.reloadFrame]` while `weapon.reloading`.
  - **Recoil** offsets the torso+gun by `anim.recoil × scale` along `-anim.recoilDir`. Heavy guns (`weight > 1`) add a deterministic sideways jitter of ±35 % of the recoil.
  - **Sprint** moves the torso +1 sprite px forward while sprinting and moving.
  - **Down:** a blood pool (the big-decal look) and `SOLDIER.down` unrotated. If the sprite modules are missing or throw, a v1-style circle fallback is drawn.
- **Anim:** there is one module-level `anim`. It is reset in `initRender`, on `game:restart`, and when `state.player` becomes a new object. It is updated once per `render(state)` with `state.dt`, which is 0 unless `phase === 'playing'`. The `weapon:fired` handler calls `noteShot(anim, def, atan2(dirY, dirX))`: the payload direction is the aim at fire time, falling back to `player.angle`.
- **`getMuzzleWorld(state)`** (new export) returns the world `{x, y}` of the gun muzzle for the current pose, quantized aim, recoil and lean, or `null` when down or unavailable. Grip, muzzle, hand and anchors are treated as sprite-px corner coordinates, as `guns.js` documents. During drawing, `muzzle` effects and tracer starts within 40 px of the player are drawn from that frame's muzzle. This is visual only.
- **`shockwave` effect:**
  - Default ttl is `WEAPON_FX.shockwaveTtl`.
  - The front radius is `range × (1 − (1 − p)²)` with `p = 1 − ttl/maxTtl`, so it reaches `range` at ttl 0.
  - It draws a faint cone fill, 3 arcs (white, cyan `#3ec9ff`, pale), and 14 dust specks, all clipped to the cone.
  - It is drawn after muzzle flashes.
- **Stunned zombies** (`z.stun > 0`, not dying) are drawn flattened: `scale(1, 0.6)` after rotating to `z.knockAngle`, falling back to `atan2(kvy, kvx)`. Their arms are flung back, and `hitFlash` still shows. A dust puff plays for 0.35 s from the first frame a stun is seen, tracked in a `WeakMap` and cleared when the stun ends.
- **Wall buys** draw the `GUN_SPRITES` art chalk-tinted (`pixel.tint`: dark outline pixels become bright chalk, fills stay faint) at up to 3×.
  - The art may spill onto neighbouring wall tiles along a horizontal wall run. Otherwise it must fit the tile.
  - While any gun sprite is still a placeholder, the vector silhouette is used instead.
  - `staticKey` includes `gunph` or `gunart`, so the static layer repaints when real art lands.
- Imports added: `* as CFG` (config), `* as pixel`, `* as soldierMod`, `* as gunsMod`, `* as animMod`. All v1 export signatures are unchanged.
- **Verified:**
  - `node --check` passes, and `npm test` passes 241/241.
  - Checked in Chrome at `localhost:8094/?debug=1`. The soldier was still a placeholder, while guns and animator were real. I checked:
    - the thundergun composed at the hand and rotating with the torso;
    - the shockwave cone at half life;
    - two stunned (flattened) zombies next to a normal one;
    - the down sprite on its blood pool;
    - chalk sprite wall buys.
  - Recoil moves the muzzle back about 4 px on an MR6 shot.
  - Cost with 27 zombies: about 0.12 ms per `render()` (300 calls) and about 0.29 ms per `step(1/60)` frame. No console errors.
- **For the integrator:** `animator.js` `noteShot` is called with a third `aimAngle` argument (the stub and the current version accept it). Recoil may decay during `render` calls made with a stale `state.dt` only while playing, which is intended.

## FIX-2 (render): QA visual #1, #2, #12 and review #3–#6 plus #9 Info
- **Crisp rotation (visual #2).**
  - `drawCrisp(sprite, gx, gy, ox, oy, angle, ax, ay, scale, dirs)` replaces `pixel.drawSprite` for the player layers (legs, torso+gun+helmet, down sprite).
  - Per quantized direction, the 1x sprite is rotated about its anchor by nearest-neighbour inverse mapping into a pixel buffer: `sx = ax + c*vx + s*vy`, `sy = ay - s*vx + c*vy`, sampled at pixel centres. The buffer is trimmed to its opaque box, put on a canvas, and drawn at integer scale with smoothing off.
  - The cache is a `WeakMap` of sprite → anchor variants → `Array(dirs)`. It is filled lazily and dropped whenever the total reaches 4096 canvases.
  - The player origin is rounded to whole world px, and each layer offset (recoil, lean) to whole sprite px. Every player layer is therefore on one 2-px grid, and `getMuzzleWorld` uses the same snapped position.
  - `pixel.drawSprite` is still used as the fallback when `dirs <= 0`, the scale is not an integer, or there is no DOM (it is frozen).
  - A 1-px band stays 8-connected under this sampling, so the outline has no gaps at any of the 32 angles.
- **Helmet overlay (visual #1, the contract with FIX-1).**
  - If `SOLDIER.torso.helmet` exists (`{ sprite, anchor }`, or a bare Sprite), it is composed as the **last** layer of the torso+gun sprite. It therefore gets the same rotation, recoil and sprint-lean transform, and the gun passes under the head.
  - `anchor` is the point in the helmet sprite that sits on `SOLDIER.torso.anchor`, plus the optional `SOLDIER.torso.helmetOffset[pose]` `{x, y}` in sprite px (facing +x).
  - A missing anchor defaults to the torso anchor when the helmet has the torso's size, and to the helmet's centre otherwise.
  - The helmet does not follow `reloadGunOffset`.
- **Torso+gun cache.** It is keyed by sprite identity, not a string: a `WeakMap` from torso → a `Map` from gun sprite (or `NO_GUN`) → a list of variants. The variants are matched on hand, grip, muzzle, anchor, helmet sprite and helmet offset. There are at most 256 entries; after that the WeakMap is dropped. Changed sprites mean new objects, so there are no stale entries.
- **Downed blood pool (visual #12).** The pool is a 30×26 `r`/`R` pixel blob with a lobed, ragged edge, a wet `R` highlight and satellite drops. It is built through `pixel.parseGrid` in 10 growth stages and drawn via `pixel.toCanvas` at 2x on the player grid.
  - It grows from 30 % to full size over 1 s, eased out. The clock is wall time (`performance.now()`), because a down is an immediate game over and `state.time` stops.
  - `downSince` is reset on revive and on `resetAnim`.
- **Tracers (review #4).** A snapped tracer is skipped when its hit point lies less than `TRACER_MIN_AHEAD` (3 px) ahead of the drawn muzzle along the shot. The muzzle flash still shows at the muzzle.
- **Shockwave (review #5).** For a blast within 40 px of the player, the apex is latched on the first drawn frame into `e.apexX`/`e.apexY`.
  - The apex is the muzzle *without* the recoil kick (`frameMuzzleRest`), because the blast is first drawn on the peak-recoil frame.
  - The cone length is reduced by the muzzle's lead along the aim, so the front still ends at the gameplay `range`.
- **Stun puff (review #6).** `stunSeen` holds `{ start, last }`. The puff restarts whenever `z.stun > last + 1e-6`, which covers a re-knock and a new stun that began off-screen. `last` resets to 0 when the zombie is drawn unstunned.
- **Recoil (review #3).** See `docs/notes/animator.md` FIX-2: the first update after `noteShot` holds the peak.
- **Per-frame allocations (review #9, render part).** These are removed:
  - the `staticKey` rebuild (memoized per map once weapons and gun art are loaded);
  - the torso+gun key strings;
  - the `drawSprite` option literals on the player path;
  - the shockwave `arcs` literal (now `SHOCK_ARCS`);
  - the `view` and shake objects (now module scratch objects);
  - the zombie-eye `[-1, 1]` array;
  - the tracer `.every` array.
- **Verified** in Chrome at `localhost:8102/?debug=1`:
  - KN-44 at 8 aim angles and walking along 4 diagonals, zoomed 3x: uniform 2x2 pixels and continuous outlines.
  - A stand-in helmet over the KN-44, Dingo and MR6 at 3 angles: the head is drawn over the gun and rotates with the torso.
  - The pool growing over 1.2 s under the down sprite.
  - KN-44 kick of 6.00 px on the first frame (4.00 on the next).
  - A backward tracer skipped and a forward tracer drawn from the muzzle.
  - The shockwave apex within 1 px of the rest muzzle.
  - A re-stun puff replay.
  - Cost: 0.53 ms per `step(1/60)` and 0.28 ms per `render()` with 24 zombies. After warm-up, new canvases appear only for unseen (frame, direction) combos, which is bounded.
  - No console errors.
  - `npm test` 258/258, and `node --check` passes.
- **Not done here:** the helmet art (FIX-1, soldier.js) and the HUD allocations (hud.js).

## WO4 (Agent D, 2.4): buyable doors
- **Static-layer key** now ends in `:v<map.version>` (missing version = 0). The memo stores
  `{ map, version, key }` and is only reused when both the map object and the version match, so
  `openDoor` (tiles -> 0, `version++`) repaints the cached layer on the next frame. The memo still
  only latches once weapons and real gun art are loaded, as before.
- **Closed doors** (`paintDoors`, last step of `paintStatic`): for every `map.doors` entry with
  `!open` (missing `map.doors` = `[]`), `paintDoorPanel` draws heavy dark wood planks running along
  the doorway (per-plank shade, grain line, top highlight, bottom shadow) on a near-black recess,
  crossed by two riveted iron bands per tile, all in a local frame rotated 90 deg for `axis: 'v'`.
  The bounding box comes from `door.x/y/w/h`, falling back to the tile list; the axis falls back
  to the box's long side. Labels reuse `paintWallBuyLabel` with name `OPEN DOOR` and the cost, on
  both sides (above/below for `h`, left/right for `v`), painted after all panels. Any stray
  code-7 tile not covered by a door object gets an unlabelled one-tile panel (defensive).
  Open doors are simply floor (their tiles are 0).
- **`doorOpen` effect** (ttl 0.6): soft radial light glow stretched along the doorway (fades in the
  first third of the life) plus 12 deterministic grey specks thrown to both sides of the doorway
  with ease-out. Drawn after `explosion`, before `text`. Default ttl added to `defaultTtl`.
- **`purchase:made` kind `door`** (re-init safe via `unsubs`): queues
  `{ type: 'doorOpen', doorId }` and a shake `{ magnitude 3, ttl 0.35 }`. The door is looked up in
  `state.map.doors` by id when the queue is flushed (`placeDoorEffect`), filling x/y (door
  `cx/cy`), axis and length; an unknown id drops the dust (the shake still plays).
- New local constants: `T_DOOR = 7`, `DOOR_FX_TTL`, `DOOR_SHAKE`.
- **Verified** in Chrome at `localhost:8134/?debug=1` with B's real doors: D (h, 75) and E (v, 100)
  readable at game scale with a label on each side; `map.openDoor` + emitting `purchase:made`
  repainted the doorway to floor on the next frame, and the dust and glow showed at the centre.
  No console errors. `node --check` passes. `npm test`: 267/272; the 5 failures are all in
  `tests/map.test.js` (Agent B mid-rewrite), none in render/audio.

## WO5 (Agent E, 3.6): themes, torches, mega door, stairs, arena, boss/minions, transition
- **Theme** = `map.theme`, else `state.level.def.theme`, else the WO4 look (`COLORS` + WO4 door
  colours). Resolved once per theme object (WeakMap); mutating a theme in place is not seen, so assign
  a new object. A theme whose `floorAlt` differs from `floor` gets a floorAlt checker, accent
  (bone-white) flecks and wall brickwork. Level 1 has `floorAlt === floor`, so it keeps the flat
  WO4 look. Walls and edges use `wall`/`wallEdge`; door planks are tinted from `doorWood` (the WO4
  formula is kept when `doorWood` is the WO4 value); door bands use `doorIron` and rivets use `accent`.
- **Static-layer key** adds `levelId`, a theme signature and an int of mega-door/stairs flags
  (present/open/sealed). The memo check compares map, version, theme object and flags, with no
  per-frame allocation. A level swap, a theme change or a seal/open therefore repaints, even without
  a `version` bump (checked in the browser: switching the theme back to null repainted the walls to
  `#0e0e10`).
- **Ambient**: `theme.ambient` is a flat full-screen fill, drawn first in the screen pass. Null or
  empty means no tint.
- **Torches** (`theme.torch`): picked when the static layer is built. The rule is plain `T_WALL`
  tiles with `(tx + 5*ty) % 6 === 0` that touch floor (floor, open spawn or arena spawn), so there is
  one about every 6 tiles along horizontal and vertical runs. Positions are deterministic from the
  tile index. They are drawn every frame after the static blit (they are not in the layer): an
  additive pre-rendered amber glow sprite plus a flame and core. The flicker is a sum of sines per
  torch, seeded from the tile index, on wall-clock time.
- **Arena**: tiles in `map.arenaTiles` are darkened with `rgba(0,0,0,0.3)`. `X` tiles (code 8) get
  a faint red scratched ring. Code 8 counts as floor for labels and torches.
- **Mega door** (`map.megaDoor`, drawn while `!open`):
  - A tall iron door: frame posts stick out 7 px past both ends and 4 px past the wall faces, with
    riveted plates per tile, rust streaks, cross braces and an upright skull plate.
  - While buyable, it has "MEGA DOOR" / cost labels on both sides. The cost is `md.cost`, falling
    back to `DOORS.megaCost`.
  - While sealed, it shows a glowing red locking bar, red skull eyes and red "SEALED" plates on
    both sides.
  - Its tiles are excluded from the WO4 stray-door-tile panels.
- **Stairs** (`map.stairs`):
  - The front is whichever long side has more arena tiles (else floor).
  - Closed: a barred iron gate in a stone frame, with an upright padlock.
  - Open: 5 steps getting darker and narrower away from the arena, with a "DESCEND" plate (amber on
    dark) on the arena side.
  - Stray code-9 tiles get a one-tile gate.
- **Boss** (`z.kind === 'boss'`, radius `BOSS.radius` 34 ≈ 2.4× a zombie):
  - Body: a dark body with thick clawed arms, pauldrons and a spiked rusted crown/helmet in
    `state.level.def.boss.tint` (default `#7a1f1f`), plus red glowing eyes.
  - `charge.phase === 'telegraph'`: a pulsing white flash and an expanding white ring.
  - `'dash'`: ghost trail and speed lines along `charge.dx/dy`.
  - `'recover'`: circling stars.
  - Dying uses `BOSS.deathLinger` to darken, slump and fade. Stun visuals are skipped for the boss.
- **Minions** (`kind 'minion'`, radius 10 ≈ 0.7×): the tier colour at 58 % brightness, 3 px arms and
  red eyes.
- **Events**:
  - `boss:start` → shake 10 (0.9 s).
  - `zombie:killed` with `zombie.kind === 'boss'` → a `bossDeath` effect (14 s lobed pool of radius
    about 2.1× the boss radius that spreads over 1.2 s, plus a shock ring), a flash starting at about
    60 % white and shake 12.
  - `purchase:made` kind `megadoor` → shake 5.
- **Transition**: a black overlay whose alpha ramps from 0 to 1 at `t = dur/2`, then back from 1 to 0
  at `t = dur`. `dur` falls back to `LEVELS_CFG.fadeSeconds`. It is drawn over everything except the
  debug panel. Pixel check: 0.5, 1 and 0.17 at t = 0.3, 0.6 and 1.1.
- Render-local tunables: `BOSS_START_SHAKE`, `BOSS_DEATH_SHAKE`, `BOSS_DEATH_FLASH`, `MEGA_SHAKE`,
  `BOSS_POOL_TTL`, `BOSS_SCALE`, `MINION_SCALE`. The integrator may move them to `RENDER`.
- **Verified** on `localhost:8155/?debug=1` with B's real level-1 map, where the mega door is at
  (2120,1120) along h and the stairs are at (1600,840) along v:
  - The catacomb theme, set via `map.theme`/`state.level`, shows torches.
  - Mega door buyable/sealed, stairs closed/open.
  - Boss in telegraph and in dash, and minions.
  - Boss death pool.
  - Cost with boss + 10 minions + 24 zombies on the torch theme: `render()` 0.32 ms per call and
    `step(1/60)` 0.49 ms per frame. No console errors. `npm test` 359/359.

### WO5 FIX-3 (QA follow-up)
- **Draw order (playtest #1):** `drawPowerups` now runs after every `blood` decal and before the
  zombies, so the boss's guaranteed Max Ammo (and normal drops) sit on top of pools.
- **One boss pool (review I3):** zombie.js's boss `blood` effect (`boss: true`, radius 44) is the
  only pool; `drawBlood` draws it as the big lobed pool (`drawBossPool`, R = radius × 1.6). Render's
  `bossDeath` effect is now only the 0.6 s shock ring (`RENDER.bossRingTtl`, replaces
  `bossPoolTtl`), drawn above the player. Flash and shake unchanged.
- **Sealed mega door text (playtest #6):** while `map.megaDoor.sealed`, any "MEGA DOOR OPENED" text
  effect within 90 px of the door is expired (`ttl = 0`) instead of drawn.
- **Charge telegraph (playtest #7):** `drawChargeLane` draws a pulsing translucent red lane
  (boss-wide, red edges, chevrons sweeping outward) toward `charge.dx/dy` or else the player (the
  aim zombie.js locks at the end of the telegraph). Length = speed × chargeSpeedMult ×
  chargeMaxTime, cut at the first solid tile (16 px samples). The body flash gains a 4 px
  red/pink pulsing outline; the expanding ring is now `#ff4030`, 4 px.
- **Minions (playtest #8):** fixed near-black purple bodies (`MINION_BODY` per tier) for every
  theme, a thin 1.5 px red outline and glowing red eyes (6 px halo + bright core).
- **Labels over the player (playtest #10):** plate rects from `paintPlate`/`paintWallBuyLabel` are
  recorded into `staticLayer.labels`; a plate overlapping the player is re-blitted from the static
  layer over the player at 75 % alpha (only overlapping plates, a few drawImage calls at most).
- Verified on port 8173: L1 telegraph lane stops at the pillar; Max Ammo "MA" visible over the
  pool after `killBoss` (1 boss blood effect, ring gone after 0.6 s); injected "MEGA DOOR OPENED"
  text expired on seal; L2 boss + 10 minions + 24 zombies: minions clearly distinct from the
  tan/green zombies, render 0.32 ms/frame (telegraph active), step 0.77 ms. No console errors.

## WO7 (Agent C): zombie sprites, perk machines, knife, acid, lab flicker
- **Zombies (T1).** `drawZombies` draws `ZOMBIE_SPRITES` via `zombieSpriteFor(z)` (namespace
  import `zombieArt`, guarded). A kind whose art is still the Phase 0 placeholder (the explicit
  `sprite.placeholder === true` flag only; `pixel.isPlaceholder` is not used because it flags
  any 'x' pixel) or a sprite draw that throws falls back to the pre-WO7 vector art
  (`drawZombieLegacy`, vector boss inside `drawBoss`). `globalThis.__zombieSpritesForce = true`
  draws placeholders anyway (art debugging).
  - Layers: shadow ellipse, legs frame rotated to the **tracked movement heading**, body rotated
    to the player while `chasing`/`attacking`, else to the movement heading. Damaged overlay
    (`normal.damaged`, same transform as the body) below 50 % HP. Tearing uses Agent A's
    per-tier `spr.tearing` (extra field), else `normal.tearing`. Hit flash = cached white
    silhouette of the body drawn over it at `0.85 * min(1, hitFlash/0.08)`.
  - Tracker: module `Map` keyed by `z.id` (object fallback) -> `{x, y, mx, my, legA, bodyA,
    dist, still, seen}`. The heading is a low-passed delta (`m = 0.7 m + d`) so path jitter does
    not flip the legs. Moves > 60 px in one frame (teleports) are not walked. Walk frame =
    `floor(dist / stride * n) % n` with `SPRITES.zombieStride` (boss: `bossStride`); after 8 still
    frames the legs show frame 0. Pruned every 64 frames (entries unseen for 120 frames), cleared
    on `game:restart`. Only zombies in view are tracked.
  - Dying: corpse sprite (per-tier `corpseVariants` via `zombieSpriteFor`) at the last body
    angle, alpha = `dyingT / deathLinger` (no shrink any more). Stunned (Thundergun): corpse
    sprite rotated to `knockAngle` + the WO2 dust puff (replaces the `scale(1, 0.6)` circle, which
    could not be drawn crisp).
  - Boss: legs + body (or `boss.charge` during `telegraph`/`dash`) recoloured with `pixel.tint`:
    pixels whose RGB equals `boss.tintColor` (Agent A: `PALETTE.p` `#b44dff`, used only for the
    crown) become `levelDef.boss.tint`. If a future marker is magenta, darker `r === b, g === 0`
    shades are scaled too. Cached per sprite x tint. Charge lane, dash streak, expanding ring,
    recover stars unchanged; the telegraph flash is now a white silhouette + red ring.
    Acid bosses (`z.acid.phase === 'telegraph'`): additive green glow, pulsing ring that speeds
    up with `acid.t / BOSS.acid.telegraph`, and a glob swelling at the mouth.
  - Every layer goes through `drawCrisp` (32 directions, 1x rotation cache). Cost measured on
    L3 with 24 zombies + boss + 10 minions: `render()` 0.30 ms/call, `step(1/60)` 0.66 ms.
- **Perk machines (T2).** `paintPerkMachines` (static layer, after wall buys): recess, cabinet in
  `PERKS.list[perkId].color` with roof, side trims, glowing panel (shadowBlur), bottle glyph,
  upright perk letter on the roof, dispenser slot, soft glow onto the floor in front. The front
  faces the first open floor side; a `paintWallBuyLabel` plate (name / price) goes on every
  open floor side, painted after all cabinets. Sold out: cabinet at 28 % brightness, dark
  panel, no glow, price line `SOLD OUT` in red (`paintWallBuyLabel` gained an optional
  `soldOut` arg). `featureFlags` includes the machine count and a sold-out bitmask, so a sell-out
  repaints the layer. `T_PERK = 10` counts as solid (`isSolidCode`). Missing `map.perkMachines`
  = nothing drawn. Note: shop.js appears to re-derive `soldOut` from `player.reviveUses` each
  frame, so tests must set `reviveUses` rather than `soldOut`.
- **Knife (T3).** `resolveTorsoPose`: when `anim.pose === 'knife'` (Agent B) — or, without the
  animator, `player.meleeT > 0` — the torso is `SOLDIER.torso.knife[anim.meleeFrame]` (fallback
  frame from `meleeT`: cocked for the first 40 %), composed with the helmet but **no gun** and no
  reload offset. Gun pose lookups use `anim.gunPose` so `torso.idle['knife']` is never indexed.
  `slash` effect `{x, y, angle, ttl, maxTtl}` (default ttl `MELEE.swingTime`): white crescent at
  `14 + 0.75 * MELEE.reach` that sweeps across `angle ± MELEE.halfAngle` in the first 55 % of
  its life, then fades; tip glint. Drawn right after the player.
- **Acid (T5).** Pools (`state.hazards` kind `acid`): drawn after blood decals, lobed dark rim +
  green body + glossy core, spread-in over 0.3 s, fade over the last 1 s, 6 bubble slots that
  grow and pop (deterministic from time + id), faint fumes. Globs: per Agent H they live in
  **`state.acidGlobs`** (not `state.bullets`): ground position = lerp(`sx,sy` -> `tx,ty`) by
  `1 - ttl/maxTtl`, a visual parabola (peak 70 px), a ground shadow, a 4-dot trail and a
  dashed landing ring that tightens as it falls. `state.bullets` entries with `kind === 'acid'`
  (the 3.3 wording) are drawn as green blobs with a velocity trail instead of ray-gun orbs.
- **Flicker (T5).** `theme.flicker` (resolved into the theme, not part of the static key):
  after the ambient tint, a near-black screen fill in bursts. Game time is cut into 0.9 s
  windows; ~1 in 5 windows gets a 0.1-0.35 s burst of 2-4 dark strobes (alpha 0.25-0.55).
  Deterministic from `state.time` (freezes when paused). Measured ~1.3 % of frames darkened.
  INT: `level.js loopTheme()` does not copy `flicker` (scaffold note 6).
- **Quick Revive down** (`player.downT > 0`, `player.down` false): lying sprite on a small pool
  plus a cyan (`PERKS.list.revive.color`) ring filling over `downSeconds`; torso/muzzle are
  suppressed (`getMuzzleWorld` returns null).
- Render-local tunables (could move to `RENDER`): `Z_TRACK_JUMP 60`, `Z_STILL_FRAMES 8`,
  `GLOB_ARC 70`, `FLICKER_WINDOW 0.9`, slash radius factor 0.75.
- **Verified** on `localhost:8204/?debug=1` with Agent A's real art, B's knife torso/animator,
  G's machines and H's acid boss: all three tiers walking, damaged overlay, hit flash, stunned
  corpse, fading corpse, minions, L3 boss with green crown + acid telegraph, L1 boss charge lane
  + white telegraph flash, fake acid pool and glob, slash arc with knife torso, Quick Revive
  machine normal and SOLD OUT, Stamin-Up machine facing down, revive-down ring, flicker by pixel
  sampling. No console errors. `npm test` 496/496, `node --check` clean.

## WO7 FIX-1: lab flicker, perk machines, lab walls, plates, popups, player ring, acid rings
Tunables are in `RENDER` in `src/config.js`: `flicker`, `buyPlateOverPlayerAlpha`, `playerRing`, `textMergeTime`, `textMergeDist` and `labTankMaxTiles`. They replace the render-local `FLICKER_WINDOW`.

- **Flicker (playtest #1).**
  - Game time is cut into `flicker.period` windows of 14 s. Each window has one burst, starting at a hashed offset in `[0, period - minGap]`, so bursts start 8-20 s apart.
  - A burst is 1..`maxDips` (2) smooth sin² dips of `dipTime` (0.24 s), with starts `dipGap` (0.42 s) apart. That is at most 2 flashes in any second, which meets WCAG 2.3.1.
  - Peak alpha is `alphaMin`..`alphaMax` (0.08-0.18).
  - The effect is still a full-screen `#02040a` fill after the ambient tint. It is deterministic from `state.time`.
  - It is skipped when `matchMedia('(prefers-reduced-motion: reduce)')` matches. The media query object is looked up once, and `.matches` is read live.
  - Simulated over 10 min: max alpha 0.177, darkened 2.0 % of the time, minimum dip spacing 0.41 s, burst gaps 8.9-17.8 s.
- **Plates over the player (#3).**
  - `labelKind` is set to `'buy'` while `paintWallBuy` and `paintPerkMachines` run, so their `labelRects` entries carry `buy: true`.
  - `drawLabelsOverPlayer` re-blits buy plates at 0.35 and door, mega door and stairs plates at 0.75.
- **Perk machines (#10).**
  - Local frame: the front faces +y. When the tile behind the machine is `T_WALL`, the cabinet extends 8 px into it.
  - Layers, back to front:
    - A drop shadow.
    - A dark frame and a perk-colour body with side trims.
    - A lit marquee: `shadeHex(color, 1.6)`, glow, a white top line and a bulb row.
    - A logo panel with a bold 15 px letter.
    - A dispenser alcove holding a 5×10 bottle glyph.
    - A steel coin-slot plate with a red LED.
  - The letter and the bottle are drawn through `upright()`, which counter-rotates them so they are always screen-upright.
  - Sold out: the same shapes, darkened, with no glow.
  - The plate price is `m.price` when it is finite (FIX-3: `shop.syncPerkMachines` sets it for the escalating Quick Revive, 50/150/300, and bumps `map.version`, which is in the static key). Otherwise it is `def.cost`.
- **LABORATORY walls (#5).**
  - `buildTheme` resolves `wallStyle`. An explicit `raw.wallStyle` wins. Otherwise a name matching `/LABORATORY/i` gives `'panel'` and anything else `'brick'`. `wallStyle` is part of `sig`.
  - `'panel'` runs `paintLabWalls` instead of `paintBrickwork`, which draws:
    - Steel plates at `shadeHex(wall, 1.22)`, with a lit top edge, a dark bottom edge, a random half seam, four rivets and dark tile seams.
    - `findDecorBlocks`: 4-connected components over every non-floor code except the box. A component that does not touch the map border and has ≤ `labTankMaxTiles` `T_WALL` tiles is decor. Its wall tiles are painted by `paintGlassTank`: a steel base with rivets, a glass circle, a liquid gradient below a hashed level line, a specimen silhouette, bubbles, a highlight streak and a rim.
    - `paintHazardStripes`: for every door and the mega door, a 12 px band on each plain wall tile at either end of the doorway gets black with yellow 45° stripes 5 px wide. On L3 this covers the decon blocks, the corridor tanks, the cryo pods and the arena pillars. The lab benches (11 tiles) and the reactor core stay steel.
- **Player ring (#9).** `drawPlayerRing` draws an ellipse of radius `radius + 3` under the legs, before the shadow: a dark 3 px stroke, then a 1.5 px `playerRing.color` stroke, at `playerRing.alpha` (0.4).
- **Points popups (#12).**
  - `onPointsChanged` tags text effects with `pts`.
  - In `flushPending`, `mergePointsPopup` folds a new popup into an existing `pts` popup of the same colour that is younger than 0.3 s and within 44 px. The merged popup becomes one "+N".
  - The old popup's `y` is shifted by its current rise, so restarting its life does not move it on screen.
- **Acid landing rings (#14).** A 4 px `rgba(8,20,4,0.85)` outline, then a 2 px `#c8ff3a` dash (6/4), at alpha 0.55-0.95.
- **Verified** on `localhost:8231/?debug=1` and `&touch=1`, L3:
  - Quick Revive (facing east) and Double Tap (facing down) machines, with the player standing on the plate. The player is visible.
  - Price plate 50 → 150 after `reviveUses = 1`.
  - Tanks, panels and stripes at the doors.
  - THE SUBJECT telegraph with the new rings.
  - The player ring in a boss and minion crowd.
  - Popup merge: +10/+5/+10/+5 shows as "+30".
  - `render()` took 0.23 ms per call with the boss, minions and 41 zombies (22 in view).
  - No console errors. `npm test` 511/511. `node --check` is clean.

## WO8 (Agent D): Pack-a-Punch machine, camo on upgraded guns, sparkle
- **Machine** (`paintPapMachine`, static layer, after the perk machines; guarded on `map.pap`, so a
  map without one draws nothing). `T_PAP = 11` counts as solid (`isSolidCode`). The geometry is in
  `papGeom(map)`, memoized per map, `map.pap` object and `map.version`. The front faces the first
  open floor side (the same rule as perk machines), and the local frame has the front at +y.
  - Layers: a purple wash plus a gold core on the floor in front, a drop shadow, a dark violet
    cabinet with side panels, purple neon trim (shadowBlur), a gold marquee strip with bulbs, gold
    corner caps, and an upright emblem (purple disc, gold rim, gold lightning bolt).
  - Also: the feed slot (dark, with a purple inner line that is brighter while working, and gold
    rollers), a status lamp (dim gold idle, lilac working, bright gold ready), and the steel tray
    with a gold front edge.
  - Plates: `paintWallBuyLabel` "PACK-A-PUNCH" / cost on every open floor side. The cost is
    `map.pap.cost` if finite, else `PAP.cost`, else 500. They are painted with
    `labelKind = 'buy'`, so the over-player re-blit uses the 35 % buy alpha.
  - **Static key:** `papStateCode` (0 none, 1 idle, 2 working, 3 ready) comes from
    `state.shop.pap.state` in `render()`. It is in the memo check and in the key (`:papN`), so
    each state change repaints the layer once.
- **Dynamic** (`drawPap`, after `drawBox`, only when the machine is within 110 px of the view):
  - Additive glow sprites (pre-rendered 64 px radial canvases in purple and gold). Idle is a slow
    breathing glow. Working is a strong 9 Hz pulse on the cabinet and slot. Ready adds a gold glow
    on the tray.
  - **Working:** the gun inside (`shop.pap.weapon`, base art) slides muzzle-first from the tray
    into the slot over `PAP_SLIDE_TIME` 0.6 s (ease-in). It is clipped at the slot line so it
    vanishes into the cabinet, and the slot flares gold as it goes in. After that, 12
    deterministic gold, white and lilac sparks spray from the slot (additive, from time).
  - Slide timing is tracked by render (`papAnim`: the weapon object plus `state.time` at the first
    working frame), so it does not depend on the direction of `pap.timer`. It resets on
    `game:restart`.
  - **Ready:** the camo gun lies on the tray. It is horizontal for machines facing up or down and
    points up for machines facing sideways, so it is never upside down. It bobs by ±1 sprite px,
    with 3 twinkle stars. All drawing goes through `drawCrisp`, at the player's scale.
- **`pap:done`** → a `papSparkle` effect (subscribed in `initRender`, so re-init is safe). It is
  queued and placed at the tray point on flush (`placePapEffect`), and dropped when there is no
  `map.pap`. It lasts 0.9 s: purple and gold glows, an expanding purple ring and 18 purple/gold
  4-point stars flying out with ease-out and twinkle. It is drawn after `doorOpen`.
- **Upgraded held gun.** `isUpgradedWeapon(w)` uses `weapons.isUpgraded` (guarded), else the
  `w.upgraded` or `w.def.upgraded` flag.
  - `resolveTorsoPose` looks the gun art up from the **base** def (`def.baseId` or `w.id`), then
    swaps in `papGunEntry(gun)`: the same grip, muzzle and pose with the camo sprite. That goes into
    the normal torso+gun composition cache, which is keyed by sprite identity.
  - Wall-buy chalk art and the box are untouched.
  - The knife torso has no gun, so no glow.
  - **Camo** (`papSprite`, `pixel.tint`, cached in `tintCache` per sprite under key `'pap'`):
    - Near-black `k` outlines are kept.
    - Greys, steel and olive become a 5-step violet ramp by luminance, with 2-px diagonal stripes
      (+1 / 0 / −1 tone) and sparse gold flecks (`(5x+3y) % 13 == 0`).
    - Brown, tan and wood become a 4-step gold ramp, with a +1 stripe.
    - Saturated energy colours stay (ray gun green, thundergun cyan, red, eye blue). The purple
      accent `p` becomes gold.
  - **Glow:** `drawPapGunGlow` draws one additive purple glow blit (radius ≈ 0.85 × hand-to-muzzle
    distance, alpha 0.3 ± 0.08) centred 60 % of the way to the muzzle, before the torso sprite.
- Render-local tunables: `PAP_SLIDE_TIME`, `PAP_SPARKLE_TTL`, and the `PAP_VIOLET` / `PAP_GOLDS`
  ramps.
- **Verified** on `localhost:8255/?debug=1`, L1 (machine at 51,32, facing up) with B's real
  shop/map and A's real weapons. `updatePap` is not wired in main.js yet (INT), so I drove it by
  hand with `modules.shop.startPap/updatePap/takePap`.
  - Idle cabinet with plates. Working: the KN-44 half-way into the slot (clipped), then sparks.
    Ready: "Warden's Wrath" camo on the tray.
  - Take: the sparkle burst at (2060, 1285), and the held gun with camo and glow.
  - Side-by-side base vs upgraded for MR6 (Nightingale), KN-44, KRM-262, Ray Gun (Porter's X2) and
    Thundergun (Zeus Cannon). The outlines stay intact and the energy parts stay green and cyan.
  - Cost with the boss + minions + 27 zombies crowded in view, the machine working and an upgraded
    gun held: `render()` 0.25-0.9 ms per call (noisy while RAF runs), and `step(1/60)` 1.1 ms. No
    console errors.
  - `npm test` 538/538, and `node --check` is clean.

### WO8 FIX-B (review L2, playtest #5-#8)
- **Empty hands (L2).** `resolveTorsoPose` has no gun layer and uses pose `onehand` when
  `activeWeapon(p)` is null. Before, `gunSpriteFor(null)` gave the default gun art. `getTorsoGun`
  already handled a null gun, and the muzzle point falls back to the hand.
- **One PaP plate (#5).** `paintPapMachine` draws one "PACK-A-PUNCH / cost" plate.
  `papPlatePlacement` scores the 4 sides at 0 and +1 tile offset by what the plate rect covers,
  sampled every 4 px:
  - use tile (walkable 4-neighbour) or the cabinet ×100;
  - diagonal walkable tile ×10;
  - other walkable floor ×1;
  - +200 for the far offset, +0.5 for a non-back side.

  Result: L1 east, L2 west, L3 east, all on walls. `papPlateRect` mirrors `paintWallBuyLabel`'s layout.
- **Working phase (#6).**
  - `drawPapShake`: after the slide, the cabinet rect (plus the back extension) is re-blitted from
    the static layer with a 1-2 px jitter from `hash(floor(t*30))`, drawn before the glows. It is
    skipped under prefers-reduced-motion.
  - Glows: a bigger breathing purple halo (48-62 px), and the slot alternates purple and gold at 3 Hz.
  - Sparks: 20 thicker, longer sparks (lineWidth 2.5, 8 px), plus a 6-star burst every 0.5 s.
  - A gold flash (`PAP_READY_FLASH` 0.35 s) marks the working->ready switch (`papAnim.readyAt`).
- **Small-gun camo (#7).** `papSprite` treats sprites narrower than `PAP_SMALL_W` (14) as small:
  the pistol art (8x6) and the default art (13x5). Band 0 of the 2-px diagonal stripes becomes gold
  (`PAP_GOLDS[3]`, or `[2]` on dark pixels), and the other bands use violet ramp steps 2-4 only.
- **Upgraded wonder-weapon FX (#8)** use the `PAP_FX` palette:
  - Bullets: `isUpgradedWeapon(b)` (the bolt's def) selects the red-pink trail, glow and core.
  - Explosion and shockwave effects carry no weapon, so `latchPapFx` sets `e.pap` on the first
    draw. It is true when `e.radius` (or `e.range`) matches `weapons.UPGRADES.raygun.projectile.splashRadius`
    (or `UPGRADES.thundergun.cone.range`), checked with `isUpgraded`, and not the base def's value.
  - The explosion check applies only to ray-gun-coloured explosions.
  - Porter's X2: splash `#ff4d88`. Zeus Cannon: gold-white arcs, fill and dust.
  - The muzzle flash at the player takes the held gun's state: pink for Porter's, gold for Zeus.
    `fxState` is set in `drawEffectsOfType`.
- **Verified** in Chrome on port 8281:
  - L1/L2/L3 plates are clear of the use tiles.
  - L1 with only the MR6 in the machine: the soldier is empty-handed.
  - The working machine visibly jitters and sparks.
  - The MR6/RK5 camo is bright on the tray and in hand.
  - A pink bolt and splash, and a gold cone. A base Ray Gun splash latches `pap: false`.
  - `render()` with the machine working and 25 zombies: median 0.1 ms, max 0.9 ms. No console errors.
  - `npm test` 552/552; `node --check` is clean.
