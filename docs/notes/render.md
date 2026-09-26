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
