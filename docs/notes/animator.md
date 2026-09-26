# WO2 3.6: `src/sprites/animator.js` (Agent D)

This module is pure: no DOM, no `Math.random`, and it is deterministic. It imports `SPRITES` from `config.js` and `gunSpriteFor` from `guns.js`. `gunSpriteFor` is only called inside functions and is wrapped in try/catch. A missing or odd entry falls back to pose `'twohand'` and weight `1`.

## API (the 3.6 names are unchanged)
- `createPlayerAnim()` returns every 3.6 field. It also adds three extras that consumers should treat as read-only:
  - `aim`: the last `player.angle` seen.
  - `stillT`: seconds since movement was last seen.
  - `recoilPeak`: the recoil value at the last shot.
- `updatePlayerAnim(anim, player, weaponDef, weapon, dt)` returns `anim`.
- `noteShot(anim, weaponDef, aimAngle?)` returns `anim`. This settles scaffold note 8:
  - `recoil = SPRITES.recoilPx * weight`.
  - `recoilDir` is `aimAngle` when it is a finite number. Otherwise it is `anim.aim`, which `updatePlayerAnim` refreshes from `player.angle` on every call. So `noteShot(anim, def)` from the `weapon:fired` subscriber works without the third argument.
- `resetPlayerAnim(anim)` resets the object in place and returns it. Passing a null `anim` returns a fresh one.

## Behaviour
- **Walk cycle:**
  - Each update adds the distance moved to `walkDist`, multiplied by `sprintCycleMult` when `player.sprinting`.
  - `legFrame = floor(walkDist / (strideLength/8)) % 8`.
  - `walkDist` is kept modulo `strideLength`. The frame is the same and precision does not drift.
- **Idle:**
  - When the player has not moved, `stillT` accumulates. The current frame and `moving = true` are held until `stillT >= 0.1 s`. This prevents flicker when render runs more often than the sim moves the player.
  - After that, `legFrame = 0`, `walkDist = 0`, `moving = false` and `legAngle = player.angle`. The legs then follow the aim every frame while idle.
- **Moving:** `legAngle = atan2(dy, dx)`.
- **Edge cases:**
  - **First call:** sets `lastX`/`lastY` from the player, which counts as no movement. It sets `legAngle` to the aim and starts idle.
  - **Teleport:** a move of more than 100 px in one update does not advance the cycle and does not turn the legs. The new position is still stored.
  - **`player.down`:** the legs freeze (frame, angle and `walkDist` are kept) and `moving` is false. `lastX`/`lastY` keep tracking, so a revive does not jump. Recoil, reload and pose still update.
  - **`dt <= 0` or non-finite:** treated as 0. There is no recoil decay, no reload advance and no idle time. Movement distance still counts, and `legAngle` follows the aim if the player is already idle.
  - **Non-finite `player.x`/`player.y`:** the leg section is skipped.
- **Recoil:** decays linearly from `recoilPeak` to 0 over `SPRITES.recoilTime`, then clamps at 0.
- **Reload:**
  - While `weapon.reloading`, `reloadT += dt` and `reloadFrame = floor(reloadT / reloadFrameTime) % 2`.
  - Otherwise both are 0.
- **Pose:** `pose = gunSpriteFor(weaponDef).pose`, with the fallback described above.

## Tests
`tests/animator.test.js` has 16 tests:
- contract fields
- first call
- frame advance and wrap
- sprint multiplier
- idle hold, then snap at 0.1 s
- `legAngle` for movement vs aim
- teleport
- down freeze
- `dt = 0`
- `noteShot` weight (LMG heavier than pistol)
- `recoilDir` source
- linear recoil decay
- reload toggle
- pose from gun and default
- reset
- determinism

The pose and weight tests rely on the 3.4 contract that pistol is `onehand` and LMG is `heavy` with weight greater than 1. `npm test` passes 193/193.

## FIX-2 (review #3): hold the recoil peak for one update
- `noteShot` now also sets `anim.recoilFresh = true` (a new field in `createPlayerAnim`, default `false`).
- On the next `updatePlayerAnim` call, recoil decay is skipped and the flag is cleared, whatever `dt` is. Decay resumes on the call after that.
- Why: `noteShot` runs inside the sim update, and the same frame's `render()` then updates the animator with that frame's `dt`. Before this change, part of the peak had already decayed by the first drawn frame, and at 30 fps all of it had.
- A new shot mid-decay arms the hold again.
- Tests:
  - New: "first update after noteShot keeps the full peak at any dt" (144, 60 and 30 fps).
  - The linear-decay test now does one holding update before it measures.
  - `npm test` 258/258.

## WO4 (2.5): smooth leg turning, backpedal
- **New config** in the `SPRITES` block:
  - `legTurnRate` 900 (deg/s);
  - `backpedalEnter` 100 (deg);
  - `backpedalExit` 80 (deg);
  - `strideLength` 80, `sprintCycleMult` 1 (see soldier.md WO4).
- **New anim fields:** `legTarget` and `backpedal`. The new export `wrapAngle(a)` returns an angle in (-PI, PI].
- **Turning:**
  - `legAngle` turns toward `legTarget` along the shortest arc by at most `legTurnRate * dt` per update. With `dt = 0` it does not turn.
  - A turn of 170° or more (the backpedal flip) swings through the side the aim is on. The hips turn under the torso instead of spinning round the back.
- **Target:**
  - While moving, the target is the movement direction.
  - When the movement is more than `backpedalEnter` from the aim, `backpedal = true`. It stays on until the movement is less than `backpedalExit` from the aim (hysteresis, so no flicker around 90°).
  - While backpedalling, the target is movement + 180° and the walk cycle runs backwards: `walkDist` decreases, kept in [0, stride). The planted boot therefore still moves back under the body at ground speed.
  - When idle (after the 0.1 s hold), the target is the aim, the legs ease to it, and `backpedal` resets.
- **Unchanged:** the first call snaps `legAngle` to the aim. A teleport neither turns the legs nor advances the cycle. `player.down` freezes the legs.
- **Tests (`tests/animator.test.js`, 22):**
  - The old "legAngle follows movement / aim" test was replaced by six WO4 tests:
    - capped turn rate, then settle;
    - shortest arc across ±PI;
    - idle eases (no snap) and `dt = 0` does not turn;
    - backpedal reverses the cycle (7, 6, 5 ...) with the legs facing the aim, and walking forward again runs it forwards;
    - hysteresis at 99/101/90/81/79/95°, and no toggles under jitter around 90°;
    - the flip passes through the aim side.
  - The sprint test tolerates `sprintCycleMult = 1`.
- `npm test`: 286/286.

## WO7 (T3): knife swing pose (Agent B)
- **Input:** `player.meleeT` is the number of seconds left in the swing. `weapons.meleeAttack` sets it to `MELEE.swingTime` (0.25). The animator only reads it and never decrements it. The sim owner (player.js or weapons.js) must count it down to 0 each update.
- **New export:** `meleePose(player)` returns `{ active, melee, meleeFrame }` and is pure.
  - `melee = clamp(1 - meleeT / MELEE.swingTime, 0, 1)`.
  - `meleeFrame = melee < 0.4 ? 0 : 1`. `MELEE_THRUST_AT = 0.4` is a module constant and could move to `MELEE.thrustAt` in config.
  - A missing, NaN or <= 0 `meleeT`, or a null player, gives `{ false, 0, 0 }`.
  - A missing or invalid `swingTime` falls back to 0.25. `MELEE` is read through `import * as CONFIG` and guarded.
- **New anim fields (read-only for render, Agent C):**
  - `anim.pose`: `'knife'` while `meleeT > 0`, otherwise the gun pose as before (`onehand` | `twohand` | `heavy`).
  - `anim.melee`: swing progress from 0 to 1, or 0 at rest.
  - `anim.meleeFrame`: index into `SOLDIER.torso.knife`. 0 means cocked and 1 means thrust.
  - `anim.gunPose`: the held gun's pose, always set, including while `pose === 'knife'`.
- **For render (C):**
  - When `anim.pose === 'knife'`, draw `SOLDIER.torso.knife[anim.meleeFrame]` in place of the idle, walk or reload torso.
  - Use the same `torso.anchor` (8,8) and transform, which rotate to the aim.
  - Do not draw the gun and ignore `reloadGunOffset`.
  - Still draw `torso.helmet` afterwards. It matches, because the knife frames contain the same helmet pixels.
  - Legs are unaffected.
  - Any code that indexes `torso.idle[anim.pose]` must switch to `gunPose`, or it will get `undefined` during a swing.
- **Precedence:** the knife pose wins over reload. The swing cancels the reload in weapons, and `reloadFrame` still follows `weapon.reloading`. It also shows with `dt = 0` and while `player.down`.
- **Tests:** 7 new tests in `tests/animator.test.js`, for a total of 29, all passing:
  - the fields at rest;
  - the knife pose and `gunPose`;
  - the 40 % boundary table;
  - a full 60 fps swing, which gives 6 cocked updates and then 9 thrust updates;
  - odd `meleeT` values;
  - `dt = 0`, down and reload;
  - the knife frames match the helmet.
