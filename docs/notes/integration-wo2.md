# WO2 Phase 2 — Integration (Integrator)

Final state: `npm test` 252/252 green, `node --check` clean on every `src/**/*.js`. The preview page and the
game (`/?debug=1`) load with zero console errors or warnings.

## Fixes and changes

### 1. main.js debug hooks
- `__game.debug.face('hurt' | 'grin')` calls the new `hud.debugFaceEvent(kind)`, which returns the resulting
  `faceFrameKey`. This path bypasses the HUD's 1 s post-start grin block. Any other kind throws.
- `__game.debug.setHealth(n, holdRegen = true)`:
  - `n` is in **health points**, not percent. `maxHealth` is 150, so `setHealth(75)` shows 50 %.
  - By default it pauses regen, by setting `regenTimer` to 1e9 until the next hit, so a face tier can be inspected.
    Pass `false` to use the normal `regenDelay`.
  - `setHealth(0)` goes through `player.damagePlayer`, giving down and then game over. It only does this while the
    phase is `playing`. Before this guard, calling it in the menu jumped straight to game over.
- `giveWeapon('thundergun')`, `'raygun'` and `'deathmachine'` work as before and needed no change.
- The wall-gun ids are the real ones (`kn44`, `krm262`, `locus`, `dingo`, …), not class names.

### 2. Priority visual fix: legs visibly stride, and the free arm swings
The problem: the 16×16 legs sat entirely under the 16×16 torso, so boots only peeked out at full stride.
- **Legs grid is now 26×26, anchor (13, 13)** (`soldier.js`, generated from parameters and outlined with a 1-px
  `k` ring).
  - The boot lanes are ±5 px from the centre line, a wide, strong stance.
  - Boot offsets per frame are `0, +6, +9, +6, 0, -6, -9, -6` along +x, with the right boot mirrored. There is a
    ±1 px sway at full stride.
  - Boots are palette-only: `K` fill, an `m` upper edge, a `W`/`M` toe shine and an `o` ankle band. A trailing
    boot shows an `M` heel highlight.
- **`SPRITES.strideLength` changed from 44 to 72.** One half cycle swings a boot 18 sprite px, which is 36 world px,
  so the planted foot does not skate.
- **Torso rear is slimmer by 1 px.** The backpack is flatter, applied to all 9 torso sprites, so the rear boot
  clears the body sooner. The broad shoulders are unchanged.
- **Arm swing:** new `SOLDIER.torso.walk.onehand[8]`, indexed by leg frame.
  - The free left arm swings back while the left boot is forward (frames 1–3) and forward while it is back (5–7).
    Frames 0 and 4 are the idle pose.
  - `render.js` uses it only while `anim.moving`, not reloading and not recoiling.
  - The twohand and heavy poses keep both hands on the gun, so they do not swing.
- **Reload reads now.** New `SOLDIER.torso.reloadGunOffset = [{x:-3,y:1},{x:-1,y:0}]`.
  - `render.js` `getTorsoGun(torso, gun, pose, handOff)` offsets the gun grip from `hand[pose]` per reload frame,
    so the gun visibly pulls in and pushes back. Before this, the gun covered the reload arm changes and the
    two frames looked identical at 2×.
  - `getMuzzleWorld` follows the offset automatically, because it uses the same cache entry.
- **Contract, tests and docs updated:**
  - `WORK_ORDER_2.md` §1.1 (scale note), §3.3 (`strideLength`) and §3.4 (legs 26×26 with anchor 13,13; optional
    `torso.walk`, `torso.reloadGunOffset`).
  - `tests/sprites.test.js`:
    - legs are 26×26 with a centred anchor;
    - a new test that full-stride boots reach at least 3 px beyond the torso footprint, front and back;
    - a new test that the `torso.walk` frames are 8 per pose, 16×16, with frame 0 equal to idle;
    - walk frames are included in the palette and placeholder sweeps.
  - `tests/animator.test.js`: the sprint test used a fixed 10 px distance, which only worked with the old stride.
    It now uses `STEP*1.5`, which is valid for any stride.
  - `tools/sprite-preview.html`: shows `walk.<pose>[2]` and `[6]` in the torso section. The live strip uses the
    walk frames and the reload gun offset.
  - The soldier.js header comment was rewritten for the new legs. The design notes in `docs/notes/soldier.md` still
    describe the old 16×16 legs, and this file supersedes them.

### 3. Integration checks (no code change needed unless noted)
- **Gun grip on the hand anchor, for every pose × gun:** checked in the preview's pose × gun grid and in-game with
  every class of gun plus all 3 specials. The grip sits in the hand and the stock lies over the shoulder or helmet
  as designed. OK.
- **Rotation direction:** tested aim 0 / 90 / 180 / −90 / −45 / 135°. The sprite points at the cursor in each case
  (screen y down, clockwise-positive). OK.
- **Muzzle snapping:** `getMuzzleWorld` was measured per gun, as forward and side world-px offsets from the body:

  | Gun | Forward | Side |
  |---|---|---|
  | pistol | 24 | 2 |
  | smg | 26 | 0 |
  | ar | 32 | 0 |
  | shotgun | 32 | 0 |
  | sniper | 42 | 0 |
  | lmg | 34 | 4 |
  | raygun | 34 | 2 |
  | thundergun | 38 | 4 |
  | deathmachine | 34 | 4 |

  The values are constant across all tested angles, and a magenta marker drawn at the value sits exactly on the
  barrel tip. The muzzle flash appears at the tip when firing. OK.
- **Recoil:** the KN-44 muzzle moves back about 4.3 px, then recovers over about 60 ms. The Dingo (heavy) moves back
  about 6.9 px with sideways jitter. OK.
- **Sprint:** the legs stride and the torso shifts forward 1 px. OK.
- **Downed:** the down sprite is unrotated on a blood pool, shown under the game-over overlay. OK.
- **Face:**
  - The tiers progress with more blood at each step.
  - Health text is white, turns yellow below 65 % and red below 25 %.
  - Wince shows closed eyes and the pain mouth. Grin shows the grin mouth.
  - The dead face shows at 0 %.
  - Redraw cadence is 2 `putImageData` calls per second at idle, which are the breathe and glance/blink key changes.
    There is no per-frame redraw. OK.
- **Bezel at 1280×720:** the stage was forced to 1280×720 CSS size.
  - The face canvas is exactly 96×120 (4×).
  - Nothing overlaps: points right edge 453 < bezel 723–1197 < weapon 1450.
  - The prompt's bottom edge (668) is above the bezel's top edge (677).
  - At 900×506 it also has no overlaps.
  - The bezel is hidden in the menu and stays up on game over.
- **Thundergun end to end:**
  - A seeded box roll (seed 43) offered the thundergun, and `takeBoxWeapon` gave it; it became the active slot.
  - Box weights are wonder = 1 for raygun and thundergun, and the Death Machine is not in the box.
  - A shot consumed 1 round (4 → 3) with 12 in reserve.
  - Zombies at 120, 200 and 250 px in the cone died, for +30 points (10 each).
  - One zombie behind the aim was untouched.
  - Zombies at 360 and 420 px with line of sight were knocked back: kv about 650 after one frame, stun 1.2 s, a
    slide of about 76 px at 0.15 s that matches the `v0/friction` integral, then chasing resumed.
  - A zombie beyond a wall was correctly not knocked.
  - The `shockwave` (range 480) and `shake` (magnitude 10) effects were pushed. The shockwave cone and flattened
    stunned zombies are visible in the screenshot.
- **Ray Gun:** it fires a projectile from the muzzle (30 px ahead), its splash killed a zombie, and it has its own
  green sprite. OK.
- **Console:** error/warn hooks and `window.onerror` stayed empty through menu → start → rounds 1–3 (cycling
  kn44 / thundergun / raygun / dingo / deathmachine / krm262 / locus while firing, reloading, sprinting and
  triggering face events) → death → game over → Enter restart → playing.
- **Frame cost:** with 24 zombies, 0.43 ms per `step(1/60)` including render, and 0.38 ms per `render()`. That is
  well under 3 ms.

### 4. Audio constants moved to config
`config.js AUDIO` now has `thunderBusGain: 1.0, maxThunderVoices: 2, thunderThudDelay: 0.12`. `audio.js` reads them,
with the old values as `??` fallbacks. The behaviour is unchanged.

## Verified visually vs not
- **Visually (screenshots at game scale 2× plus 3× zoom crops):**
  - walk cycles in 4 cardinal and 2 diagonal directions (pistol, AR, thundergun);
  - strafing, with legs up and aim right;
  - onehand arm swing;
  - the pose × gun grid;
  - rotation at 5 angles for all 9 gun types;
  - muzzle markers, recoil frames, reload pull-in (pistol, AR, LMG) and sprint;
  - the down sprite under game over;
  - face tiers 1–4 plus wince, grin and dead in the bezel;
  - the bezel at 1280×720;
  - the Thundergun shockwave cone with stunned zombies;
  - the preview page (all sections, no errors, green "no placeholder" banner).
- **Numerically only:** the bezel at a 900-px stage (DOM rects only, no screenshot); Thundergun ammo, points and
  knockback; Ray Gun kill; box roll; face redraw count; frame cost.
- **Not verified:**
  - Audio, whether the thundergun boom and thud are audible. The tab has no audible check, and only the code path
    ran without errors.
  - A physical Enter key on the menu: synthetic key presses from the automation were not delivered, although
    Enter on game over did restart once. The start path was verified via canvas click and `debug.start()`, and
    restart via a dispatched `keydown` Enter.
  - Death Machine picked up from a power-up. It was only given via `giveWeapon`.

## Notes for QA
- The legs change is the largest art change. Judge the stride at 2× in play; the lanes and amplitude are parameters
  in the generator logic, documented in the soldier.js header.
- Tier 0 at 100 % shows the clean face. `setHealth` takes health points, so use `setHealth(150)` for 100 %.
