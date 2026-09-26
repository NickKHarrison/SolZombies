# WO2 QA-3: Code review (correctness and performance)

Scope: WORK_ORDER_2.md 3.4-3.11 changes in `src/sprites/*.js`, `src/render.js`, `src/hud.js`, `src/zombie.js`,
`src/weapons.js`, `src/shop.js`, `src/audio.js` and `src/main.js`. This is a report only; no src/tests edits were made.
`npm test` was 252/252 green at the time of review.

Verification scripts are in the QA-3 scratchpad (`qa3/*.mjs`). They import the real modules under Node 24, with a
minimal fake DOM or canvas where needed.

Severity scale: **High** (broken gameplay or crash), **Medium** (visible wrong behaviour or a spec deviation),
**Low** (minor visual or edge-case issue), **Info** (performance note or doc issue, no action strictly needed).
No High findings.

## Findings

1. **Medium: the face grins on every weapon swap and when the Death Machine expires.** Confidence: verified.
   - **Where:** `src/hud.js:229` `onWeaponEquipped`, via `onGrinPowerup` at `:225`.
   - **Cause:** `player.js` emits `weapon:equipped` with `slot >= 0` in three places:
     - `giveWeapon` (a new gun), which is the only case that should grin;
     - `selectSlot`, `player.js:63-69`, a plain swap with 1/2/Q/wheel;
     - `clearTemporary`, `player.js:204-209`, when the Death Machine expires.

     The HUD cannot tell these apart.
   - **Repro** (`qa3/hud_grin.mjs`, fake DOM): after the 1 s block, a swap input through `updatePlayer` gives the
     face key `t0:closed:grin:...`. `equipTemporary` then `clearTemporary` gives `t0:left:grin:...`.
   - **Expected** (WO2 1.2 / 3.8): a grin on a power-up or on *getting a new gun*.
   - **Actual:** it also grins on every swap and on Death Machine expiry.
   - **Fix (one of):**
     - HUD only: keep a `WeakSet` of weapon objects already seen, and mark `player.weapons[*]` in `updateHud`. In
       `onWeaponEquipped`, grin only if the weapon now in `p.slot` is not in the set. Keep a reference to the last
       player for this.
     - `player.js` owner: add `isNew: true` to the `giveWeapon` payload and have the HUD grin only on that. This is
       an additive payload field, so the frozen event name is unchanged.
   - **Resolution (FIX-4):** fixed HUD-side only. `hud.js` keeps a `WeakSet` of weapon objects already seen in `player.weapons`, marked after every `updateHud` and reset on `initHud`. A new player object is marked silently. `weapon:equipped` (slot >= 0) grins only when the weapon now in that slot has not been seen. Browser checks: a new gun grins and replacing a gun grins. A swap, Death Machine expiry, restart and the starting loadout do not grin. A power-up grins through `powerup:collected`. No new events, and `player.js` is untouched.

2. **Medium (spec decision): Thundergun near-cone kills ignore walls, including zombies tearing in spawn pockets
   behind boarded windows.** Confidence: verified.
   - **Where:** `src/weapons.js:228` `fireCone`.
   - **Cause:** the `d <= killRange` branch has no line-of-sight test. WO2 3.9 literally says "no wall check needed
     inside killRange".
   - **Repro** (`qa3/cone_walls.mjs`, real map): a zombie tearing at the pocket of barricade 1 (620,60), with its
     window boarded. The shooter is on floor at (380,140), 253 px away, and `raycastWalls` hits a wall after 63 px.
     One Thundergun shot turns the zombie to `dying`.
   - **Expected:** walls and boarded windows protect zombies, as they already do for the knock band and for
     Ray Gun splash.
   - **Actual:** anything within 300 px in the cone dies, through any number of walls. Pocket zombies can be
     farmed from inside the building.
   - **Fix:** apply the same `raycastWalls` LOS test (`reach = d - z.radius`, `SPLASH_LOS_TOL`) to the kill band.
     At minimum, skip `z.mode === 'tearing'` or `!z.inside`. Needs a lead decision because it contradicts the
     spec text; update WO2 3.9 if accepted.
   - **Resolution (FIX-5):** lead decided LOS is required in both bands. `fireCone` now runs `splashVisible` (real `raycastWalls` to the near edge, `SPLASH_LOS_TOL`) before the kill/knock split, so walls and boarded windows protect zombies, including tearing pocket zombies. WO2 3.9 updated; `tests/weapons.test.js` covers wall-blocked kills and a real-map wall / boarded-window / clear-LOS case.

3. **Low: recoil is mostly spent before the first frame it is drawn, and at 30 fps it shows for only one frame.**
   Confidence: verified.
   - **Where:** `src/render.js:171` `onWeaponFired` → `noteShot`, then `render.js:945` `updateAnim` →
     `animator.js:96`.
   - **Cause:** `noteShot` runs during `update()`. The same frame's `render()` then calls `updatePlayerAnim` with
     `state.dt`, which decays recoil by `dt / recoilTime` before anything is drawn.
   - **Repro** (`qa3/recoil.mjs`, fake canvas, KN-44 peak kick 6.0 px):

     | Frame rate | First drawn kick | Following frames |
     |---|---|---|
     | 144 fps | 5.3 px | 4.6 px, 3.9 px, … |
     | 60 fps | 4.3 px | 2.7 px, 1.0 px, then 0 |
     | 30 fps | 2.7 px | 0 |

   - **Expected:** the full kick on the first frame after a shot, visible at any frame rate.
   - **Fix (`animator.js`):** `noteShot` sets `anim.recoilFresh = true`. The next `updatePlayerAnim` clears the flag
     and skips decay for that call. Optionally, enforce a minimum visible time of 2 frames.
   - **Resolution (FIX-2):** `noteShot` sets `anim.recoilFresh`, and the next `updatePlayerAnim` skips decay and clears it. The first drawn frame after a shot shows the full kick at any fps: measured 6.00 px for the KN-44 in the browser. There is a new test in `tests/animator.test.js`, and the decay test was updated.

4. **Low: point-blank tracers are drawn backwards from the snapped muzzle.** Confidence: strongly reasoned, not
   run in a browser.
   - **Where:** `src/render.js:1243` `drawTracer`.
   - **Cause:** hitscan starts at `radius + muzzleOffset` = 18 px in front of the body, but the drawn muzzle is
     24-42 px forward (`qa3/muzzle.mjs`: pistol 24, AR 32, sniper 42, thundergun 38). Against a zombie in contact
     or attack range (centre at 28-48 px), the hit point `x1` often lies behind the muzzle. The tracer is then drawn
     from the muzzle back toward the body.
   - **Fix:** when snapping, if `(x1 - muzzle) · aimDir <= 0`, skip the tracer, or draw it from `x1` only. The
     muzzle flash already covers the visual.
   - **Resolution (FIX-2):** when a tracer is snapped to the muzzle and the hit point is less than 3 px ahead of the muzzle along the shot, the tracer is skipped and the muzzle flash stays at the muzzle. Verified with a synthetic hit 7 px ahead of the hitscan origin (not drawn) and a far hit (drawn from the muzzle).

5. **Low: the shockwave cone is not snapped to the muzzle.** Confidence: verified by reading; the offsets come from
   `qa3/muzzle.mjs`.
   - **Where:** `src/render.js:1304` `drawShockwave`.
   - **Cause:** the cone apex is at the fire origin, 18 px forward. The Thundergun muzzle is 38 px forward and 4 px
     to the side, and the shockwave draws after the player. So the cone fill and first arcs sit over the soldier's
     gun and arms.
   - **Fix:** use `nearPlayer(e.x, e.y) ? frameMuzzle : e` for the apex, the same as `drawMuzzle`.
   - **Resolution (FIX-2):** when the blast starts within 40 px of the player, the apex is latched on its first drawn frame at the at-rest muzzle (the recoil kick is removed) and stored on the effect as `apexX`/`apexY`, so it stays put if the player moves. The cone length is reduced by the muzzle's lead, so the front still ends at the gameplay `range`.

6. **Low: the stun dust puff is missed on a re-stun.** Confidence: strongly reasoned.
   - **Where:** `src/render.js:838-845` `drawStunnedZombie` and `:787`.
   - **Cause:** `stunSeen` is cleared only when the zombie is drawn in view and not stunned. Two cases get no puff:
     - a second Thundergun shot within 1.2 s, which re-knocks a zombie that is still stunned;
     - a stun that ends and restarts while the zombie is off-screen.
   - **Fix:** store `{ start, lastStun }` in the WeakMap and restart the puff when `z.stun > lastStun + 1e-6`
     (the stun was extended or renewed).
   - **Resolution (FIX-2):** `stunSeen` now stores `{ start, last }`, and the puff restarts whenever `z.stun` exceeds the last drawn value. That covers a re-knock while stunned and a new stun that began off-screen. When a stun ends, `last` resets to 0. Verified: a re-knock at stun 0.68 replayed the 5-puff burst.

7. **Low: `applyKnockback` with a stun of 0 or NaN leaves a stale velocity and still returns true.** Confidence:
   verified.
   - **Where:** `src/zombie.js:259` `applyKnockback`.
   - **Repro** (`qa3/knock.mjs`): `applyKnockback(s, z, 500, 0, 0)` leaves `z.kvx = 500`, `stun = 0`, and the call
     returns `true`. `updateStunned` never runs, so `kvx` stays 500 indefinitely. `fireCone` also counts the zombie
     as affected.
   - **Impact:** harmless with the current Thundergun (stun 1.2). A future caller or a config change to `stun: 0`
     would leave inconsistent state, and render's `atan2(kvy, kvx)` fallback would read it.
   - **Fix:** after computing `z.stun`, if `!(z.stun > 0)`, zero `kvx`/`kvy` and return `false`.
   - **Resolution (FIX-5):** `applyKnockback` now rejects a stun that is not a positive finite number before touching the zombie (returns `false`, no `kvx`/`kvy`/`stun` set). `fireCone` only counts a knock as a hit when `applyKnockback` does not return `false`. Test added in `tests/zombie.test.js`.

8. **Low (performance): `tickBox` rebuilds the box weights every frame.** Confidence: verified by reading.
   - **Where:** `src/shop.js:89` `tickBox(state, dt, weights = boxWeights())`, called every frame from
     `updateShop` (`:246`).
   - **Cause:** each call allocates two `Set`s and a roughly 20-key object, even when the box is idle.
   - **Fix:** compute the result once at module load (`const DEFAULT_WEIGHTS = boxWeights()`) or use the frozen
     `weapons.BOX_WEIGHTS`. Do the same for `pickBoxWeapon` and the `:225` spin.
   - **Resolution (FIX-5):** `shop.js` computes a frozen `DEFAULT_BOX_WEIGHTS` and its id list once at module load; `tickBox`, `pickBoxWeapon` defaults and the `spinBox` start pick use them. Signatures unchanged; tests pass.

9. **Info (performance): small per-frame allocations in render and HUD.** All are measured as negligible.
   - **The main requirement holds:** there is no per-frame canvas allocation. `qa3/recoil.mjs` counted 0
     `createElement('canvas')` calls over 2000 frames of walking, turning, firing and reloading after warm-up. The
     warm-up created 5 canvases, one per new sprite frame.
   - **The torso+gun cache is far below its cap:** at most 34 entries (`qa3/count.mjs`) against the 256 FIFO cap,
     so it never evicts.
   - **Remaining per-frame garbage:**
     - `staticKey`/`gunArtKey` (`render.js:342`): `Object.keys(WEAPONS)` plus a placeholder scan of 10 gun sprites,
       0.87 µs per frame. It could be memoized once it returns `gunart`, since art never changes at runtime.
     - `getTorsoGun` builds a ~60-char key string, twice per frame when `getMuzzleWorld` is also called. A
       `WeakMap` keyed by the torso object, then a small Map by gun and hand offset, would avoid it.
     - `drawSprite` option literals.
     - The `arcs` array literal in `drawShockwave`.
     - The `faceFrameKey` string and `resolve()` object every HUD frame, at 0.11 µs per update plus key.
     - `hud.js:318` `drawFace` allocates a `Uint8ClampedArray` and an `ImageData` per redraw (about 2 per second).
       It could cache the `ImageData` per sprite in a `WeakMap`.
    - **Resolution (FIX-2, render items):** `staticKey` is memoized per map once real gun art and weapons are loaded. The torso+gun cache is identity-keyed, with no per-frame key string. `drawCrisp` takes positional arguments with no option literal. `SHOCK_ARCS` is hoisted. The view and shake objects are module scratch objects. The zombie-eye `[-1, 1]` array and the tracer `.every` array are gone. Measured in the browser with 24 zombies: 0.53 ms per `step(1/60)` and 0.28 ms per `render()`. The HUD items belong to hud.js and are not changed here.

10. **Info: at debug time scales above 1, the animator runs slow and the legs freeze.** Confidence: strongly
    reasoned.
    - **Where:** `src/render.js:945` `updateAnim`.
    - **Cause:** it uses `state.dt`, which is only the last sub-step's dt. With `setTimeScale(x > 1)`, recoil,
      reload frames and the idle snap advance by 1/steps of real sim time. Player movement per render can exceed
      the animator's 100 px teleport guard, so the legs freeze.
    - **Impact:** debug only; gameplay at timeScale 1 is unaffected.
    - **Fix (optional):** have `main.js` store the frame's total sim dt, e.g. `state.frameDt`, for render.

11. **Info (audio): the Thundergun's "bodies thud" plays on every shot, even when nothing was hit.**
    - **Where:** `src/audio.js:258-278` `thundergun()`.
    - **Notes:**
      - WO2 3.11 asks for this unconditionally, so it is not a bug. A future `hit` count on `weapon:fired` could
        gate it.
      - The `MAX_THUNDER_VOICES = 2` cap (0.7 s voices) can never trigger at 60 rpm. That is fine.
      - Clearing `thunderVoices` on `game:restart` is harmless.

12. **Info (docs):** `docs/notes/weapons.md` (WO2 section) says Infinity damage leaves `hp = -Infinity` and
    `zombie:hit.amount = Infinity`. That is stale: `zombie.damageZombie` now converts non-finite damage to the
    remaining hp, and `hp` ends at exactly 0.
    - **Resolution (FIX-5):** `docs/notes/weapons.md` corrected.

13. **Info (naming):** `shop.BOX_WEIGHTS` is the per-class weights (`{ wall, boxOnly, wonder }`), while
    `weapons.BOX_WEIGHTS` is the per-weapon-id map. Two exports share a name but have different shapes, which
    invites misuse.
    - **Resolution (FIX-5):** kept both names (tests and integration notes import them) and documented the difference in `shop.js`, `docs/notes/shop.md` and `docs/notes/weapons.md`. Added the unambiguous alias `shop.BOX_CLASS_WEIGHTS` for the per-class map.

## Checked and OK

- **Listener re-init:**
  - `initRender`, `initHud` and `initAudio` unsubscribe their previous handlers before subscribing again.
  - `main.restartGame` calls `clearAll`, then `initAll`, then `game:restart`, then `game:start`. Each new WO2
    subscription is registered exactly once per init:
    - render: `weapon:fired`, `game:restart`;
    - hud: `player:damaged`, `powerup:collected` (for the grin), `weapon:equipped`, `game:start`/`game:restart`;
    - audio: the thundergun path inside `weapon:fired`.
  - The WeakMap/Map caches are bounded: `stunSeen` is a WeakMap; `chalkCache`, `blankCache` and `composeCache` are
    bounded by the art; `torsoGunCache` is capped at 256.
- **HUD face:**
  - It redraws only when `faceFrameKey` changes.
  - `dt` is 0 unless `lastPhase === 'playing'`, so paused and game-over states freeze the face and the grin block.
  - The initial loadout's `weapon:equipped` is emitted before `initHud` subscribes, both at boot and on restart.
  - The bezel is hidden in the menu by CSS.
- **Animator:** pure and deterministic, with no RNG. The first call, teleport, down, `dt <= 0` and non-finite
  position cases behave as documented.
- **Face state machine:** deterministic through `fs.rng`. Large `dt` values are handled by loops with guards.
  `composeCache` is bounded (≤ 721 keys).
- **Muzzle math** (`qa3/muzzle.mjs`):
  - The forward offset is constant across aim angles (24, 32, 42, 34 and 38 px for pistol, AR, sniper, LMG and
    thundergun).
  - The side offset varies by up to about 3.5 px, only because of the 32-direction quantization, and it matches the
    drawn, quantized sprite.
  - `getMuzzleWorld` returns null when the player is down.
- **Zombie knockback:**
  - NaN and Infinity inputs are sanitised, and `stun = NaN` is ignored by `stun > 0`.
  - An attacking zombie that is knocked resumes `chasing` after exactly 1.2 s, having slid 116.7 px (≈ v0/k = 120).
  - No tunnelling: 34 one-tile barriers (walls, windows, wall-buys, box) were tested at dt 1/60 and 1/30 with a
    720 px/s knock. Zero crossings; the maximum step at the 1/30 dt cap is 21.8 px, and walls are 40 px thick.
  - Tearing zombies ignore knockback, and the pocket rules resume after the stun.
- **Infinity damage:** `hp` ends at 0, `zombie:killed` fires once, and insta-kill is handled.
- **Cone math:**
  - `angleDiff` is wrap-safe across ±π.
  - The kill-band snapshot tolerates list mutation.
  - The knock-band LOS uses the zombie's near edge.
  - One round is consumed, and `shotsHit` is incremented once per shot.
- **Box:** raygun and thundergun get `wonder = 1`. The Death Machine and the MR6 are excluded. Held weapons are
  filtered out before the weighted pick.
- **`main.js` debug hooks:**
  - `face` validates its kind.
  - `setHealth` clamps its value. `regenTimer = 1e9` holds regen, because regen counts down in `player.js:146`.
  - `setHealth(0)` only acts while playing.
