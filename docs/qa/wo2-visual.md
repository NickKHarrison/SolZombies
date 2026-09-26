# WO2 QA-1: Visual review

Reviewer: QA-1 (Visual). Report only: no changes were made to `src/`, `tests/` or `tools/`.

## Method

- Served on port 8097 and used a new Chrome tab at `/tools/sprite-preview.html` and `/?debug=1`.
- The tab did not animate while it was in the background, so the game was driven with `__game.debug.step()` and input overrides (`moveX`, `moveY`, `mouseX`, `mouseY`, `fire`, `reload`, `sprint`).
- A page-side helper copied 64×64 world-px crops around the player out of the game canvas. They were viewed at 1× (game scale) and at 3× CSS (zoomed).
- Face frames were copied straight from the HUD face canvas.
- Captured:
  - 9 gun sprite types × 8 aim directions, standing (mr6, kuda, kn44, krm262, locus, dingo, raygun, thundergun, deathmachine).
  - Walking in 8 directions (kn44 and mr6), a full 8-frame kn44 walk facing east, and a strafe (mr6 moving north, aiming east).
  - Reload frames (mr6, kn44, dingo), recoil (kn44, dingo, deathmachine) and sprint (6 frames).
  - The downed sprite.
  - Face at 100 / 80 / 60 / 40 / 13 %, wince at tiers 0 and 3, grin at tiers 0, 3 and 4, and dead.
  - The bezel with the stage forced to 1280×720 and 900×506.
- `resize_window` had no effect because the Chrome window reported itself minimised, so the stage size was forced through CSS, the same way the integrator did it.
- There were no console errors.

## Overall verdict

- **Face and bezel: pass.** They read as Wolfenstein. BJ is recognisable, the bezel is good, and the tiers progress.
- **Soldier: does not yet pass the Section 1.1 / 5 bar "clearly a strong soldier".**
  - At game scale it reads as a green ring (or "C") with a gun through the middle.
  - Seven of the nine gun types paint over the helmet, so the soldier looks headless.
  - Diagonal rotations look ragged, with mixed pixel sizes.
  - The boots show only as dark blocks flicking out behind the body.
- **Guns:** the ray gun, thundergun, death machine, sniper and shotgun are clearly distinct. The pistol, SMG, AR and LMG differ mostly in length.

---

## Findings

### 1. [major] Guns are drawn over the helmet, so the soldier looks headless with 7 of 9 guns

- **Where:** `src/render.js` `getTorsoGun()` (lines ~995–1006: `layers = [blank, torso, gun]`) together with `src/sprites/soldier.js` `SOLDIER.torso.hand` (line 487).
- **Repro:** `/?debug=1`, then `giveWeapon('kn44')` (or `'dingo'` or `'deathmachine'`), stand, aim east, and zoom on the player.
- **Expected:** a readable helmet (dark green dome, light highlight, chin strap) with the gun held forward of it or beside the cheek.
- **Actual:** the gun layer is composed on top of the torso, and the hand anchors sit on the body centre line (twohand y=8, heavy y=10, where the torso centre is y=8).
  - I measured how much of the helmet box (torso cols 5–11 × rows 4–10, 49 px) the gun covers:

    | Gun | Helmet px covered (of 49) |
    |---|---|
    | sniper | 30 |
    | ar | 26 |
    | shotgun | 26 |
    | deathmachine | 26 |
    | thundergun | 20 |
    | lmg | 19 |
    | smg | 18 |
    | raygun | 15 |
    | pistol | 4 |

  - With the KN-44, the helmet is replaced by the AR's black stock (rows 3–5 `kKKkkm…`). Only a light-green crescent of the helmet survives above it.
  - In the heavy pose, the Death Machine's black block covers the lower half of the helmet.
- **Clause:** §1.1 "we see the top of a helmet… dark green helmet with a lighter highlight and a chin-strap line"; §5 "clearly readable… helmet, broad shoulders, two arms".
- **Fix (either option, A preferred):**
  - **(A) Helmet overlay.**
    - Add an optional `SOLDIER.torso.helmet` sprite (16×16, transparent except the helmet). It is the current helmet pixels from `ONEHAND` rows 4–10, cols 5–11:

      ```
      row4  '...koGGkkkkGk...'  -> keep only cols 5..11
      row5  '..ktOokGLLGk....'
      …
      ```

      Re-author it as a 7×7 dome: `k` ring, `g` shadow on the rear-left, `G` body, `LL` 2-px highlight at the front-top, and a 1-px `o` chin-strap line on the front edge (col 11, rows 6–8).
    - In `getTorsoGun`, push it as a 4th layer after the gun: `layers.push({ sprite: T.helmet, dx: -minX, dy: -minY })`.
    - The gun then passes *under* the head, the way a rifle stock sits at the cheek.
  - **(B) Move the gun off the centre line.**
    - `hand.twohand` becomes `{x:12, y:10}` and `hand.heavy` becomes `{x:11, y:12}`, so the rifle runs along the right cheek and the heavy gun sits at the right hip as §1.1 says ("gun held at the hip, arms wide").
    - Then move the right-hand skin pixels in `TWOHAND`, `HEAVY` and their reload frames (rows 11–13, cols 11–14) down 1–2 rows to meet the new grip.
    - Re-verify `getMuzzleWorld` side offsets.
- **Resolution (FIX-2, render side):** option A is wired in `render.js` `getTorsoGun`. When `SOLDIER.torso.helmet` (`{ sprite, anchor }`, optional `SOLDIER.torso.helmetOffset[pose]`) exists, it is composed as the top layer after torso and gun, so it shares the torso transform (rotation, recoil, sprint lean) and the gun passes under the head. The anchor defaults to the torso anchor. With no helmet the output is unchanged. The cache is keyed by sprite identity, including the helmet sprite. Verified in Chrome with a stand-in helmet; the art itself is FIX-1's.
- **Resolution (FIX-1, art side):** `SOLDIER.torso.helmet = { sprite: 16x16, anchor: {8,8} }` now exists. It holds the helmet pixels alone on the torso grid, drawn after the gun. The hand anchors moved down and right: onehand is {13,10}, twohand {12,9} and heavy {11,12}, so rifles sit along the right cheek and heavy guns at the right hip. Checked in `/?debug=1`: the head is visible over kn44, locus, dingo and mr6 in 8 directions, and over all 10 guns in the preview pose×gun grid.

### 2. [major] Diagonal rotations are ragged: mixed-size pixels and a broken outline

- **Where:** `src/render.js` `drawPlayer()` calls `pixel.drawSprite(..., {scale: 2, angle})`. `drawSprite` (`pixel.js:280–288`, frozen) rotates the **2×-upscaled** canvas.
- **Repro:** any gun, aim at 45° / 135° / 225° / 315°, and zoom 3×.
- **Expected:** a chunky, arcade-crisp sprite at every one of the 32 directions.
- **Actual:**
  - Rotating a 2× canvas produces "mixels": interior pixels are 2×2 while the edges step in single world pixels.
  - The 1-px `k` outline breaks into dotted gaps, and helmet and shoulder pixels double up. The torso looks frayed at 45°, as if it were fur.
  - It is visible at 1× and obvious at 3×.
- **Clause:** §1.1 rotation rule "…so the sprite stays chunky and arcade-like"; §5 "rotation is quantized and stays crisp".
- **Fix (render.js only, because pixel.js is frozen):**
  - Add a per-sprite, per-direction rotation cache in `render.js`.
    - For each quantized angle, rotate the **1× sprite** with nearest-neighbour sampling into an offscreen canvas (size `ceil(w·√2)`).
    - Source pixel for each destination pixel: `sx = cos·dx + sin·dy + ax`, `sy = -sin·dx + cos·dy + ay`, rounded.
    - Then draw that canvas at `scale 2` with `angle 0`.
  - All pixels then stay on the 2-px grid and the outline stays continuous.
  - Optional polish: RotSprite (Scale2x ×3, rotate, downsample) for cleaner diagonals.
  - It is 32 directions × about 40 torso+gun combos, cached lazily, so the cost is trivial.
- **Resolution (FIX-2):** `render.js` now rotates every rotated sprite at 1x source resolution with nearest-neighbour inverse mapping, once per quantized direction. That covers the legs, the torso+gun(+helmet), and the down sprite for grid alignment. Each result is cached as a trimmed canvas (WeakMap per sprite, capped at 4096 canvases) and drawn at 2x integer scale with smoothing off. The player origin snaps to whole world px and the recoil/lean offset to whole sprite px, so all layers share one 2-px grid. Checked at 8 aim angles and while walking diagonally: square 2x2 pixels and a continuous 1-px outline. Wall-buy chalk guns are never rotated and already draw at an integer scale.

### 3. [major] Torso silhouette reads as a green ring or "C", not as a strong soldier with arms

- **Where:** `src/sprites/soldier.js` grids `ONEHAND`, `TWOHAND`, `HEAVY` (+ R0/R1, lines 255–442).
- **Repro:** stand still with any gun and view at 1×.
- **Expected:** a broad shoulder bar clearly wider than the helmet, two thick arms reaching forward, and tan/skin forearms (§1.1).
- **Actual:**
  - The helmet is ringed by a full `k` outline (rows 4–10: `koGGkkkkG`, `kGLLGk`, …). It floats inside the shoulder mass like a hole in a donut.
  - The arms are just the olive top rows 1–3 and bottom rows 11–13, continuous with the shoulders, and the only arm-coloured pixels are 2–3 px skin hands.
  - The tan backpack is a thin crescent (cols 2–4) along the whole rear, so the silhouette is a "C".
  - At game scale, the player is the same olive hue as the v1 zombie discs (see finding 11), which makes it worse.
- **Clause:** §1.1 "shoulders clearly wider than the helmet, thick arms, olive fatigues, tan/skin forearms… small tan backpack/webbing patch between the shoulders".
- **Fix (pixel-level, for all 9 torso grids):**
  - **Helmet:** remove the `k` ring on the helmet's rear half so it merges into the shoulders as a dome. Keep `k` only on the front arc (rows 4 and 10, and col 11). Use `g` for the rear shadow instead of `k`.
  - **Forearms:** make them 2 px thick and `S`/`s` (tan skin) for the last 3–4 px before the hand, so they read as arms.
    - Twohand top arm: row 2 `…LLLLLLLk..`, then row 3 `…GGGSssk`, becoming rows 2–3 cols 9–13 = `SsssK` / `SsssK`.
    - Bottom arm: rows 11–12 cols 9–13 likewise.
  - **Sleeve cuff:** separate the sleeve from the shoulder with a 1-px `g` crease at col 8 on rows 1–3 and 11–13.
  - **Backpack:** shrink it to a compact 3×5 `O/t` patch at cols 2–4, rows 5–10 only. Rows 1–4 and 11–14 on the back edge become `g` fatigue, so the back reads "shoulders, then pack", not a crescent.
- **Resolution (FIX-1):** all torso grids are redrawn. The shoulders are squared and dark `g` with `G`/`L` highlights, under a bright `L` helmet dome with an `o` strap. The backpack is a compact 3×6 tan patch. Each arm is a short sleeve then a 2-px `s`/`S` forearm reaching the gun, with hands visible on both sides of it. At game scale it reads as helmet, shoulders, arms, pack and gun. ASCII is in `docs/notes/soldier.md` under "FIX-1".

### 4. [major] Boots only read as dark blocks that flick out behind the body; the leg stride looks like a plank

- **Where:** `src/sprites/soldier.js` `LEGS0`–`LEGS7` (lines 23–250).
- **Repro:** walk east with the kn44 (8 frames) and sprint east. View at 1× and at 3×.
- **Expected:** "boots stepping below the shoulders". Two boots visibly alternate at both front and back.
- **Actual:**
  - The legs are a Z-shaped single olive shape (a hip bar running the full width of cols 10–15, plus two horizontal leg bars).
  - The forward boot is almost always hidden under the torso and gun (the torso extends to x=15 and the gun beyond), so you only see the *trailing* boot. It pops out at alternate corners behind the backpack.
  - At full stride (`LEGS2`/`LEGS6`) the trailing leg is a 10-px-long olive bar ending in a `K` block. In sprint it looks like a rifle or plank sticking out of the back.
  - When standing (`LEGS0`) no boot is visible at all.
- **Clause:** §1.1 "boots stepping below the shoulders… 8-frame walk cycle: boots alternate forward/back"; §5 "Legs animate… arcade quality".
- **Fix:**
  - (a) Widen the boot lanes from ±5 to ±6 so the boots stick out *sideways* past the shoulders (the torso is 16 wide, so lanes at rows 6–7 and 18–19 of the 26 grid). They are then visible in every frame, including frame 0.
  - (b) Cut the full-stride offset from ±9 to ±6 and keep ±4 for frames 1/3/5/7. The back leg then stays a boot rather than a plank, and `strideLength` goes 72 → 48 to keep the no-skate ratio (4 × 6 px × 2 world px).
  - (c) Make boots 4 long × 3 wide, with a `m` top-edge highlight on the toe (col +3) and an `o` lace row, so they read as boots rather than black squares.
  - (d) Delete the olive hip bar outside the torso footprint (cols 10–15 rows 10–16 of `LEGS1`–`LEGS7`) so only the thighs connect.
- **Resolution (FIX-1):** the boot lanes are ±7.5, just outside the shoulders, so the boots peek out beside the body in every frame, including the stance (tested). The stride is `0,±4,±6` and `SPRITES.strideLength` went from 72 to 48. Boots are 5×3 with an `o` tuck, `K` leather and a toe or heel shine. There is no hip bar outside the torso; a short trouser strip shows only when a leg is out of stance. Checked walking east and south and strafing in-game.

### 5. [minor] Reload reads as a 2-px gun vibration, not "arms pulled in"

- **Where:** `soldier.js` `torso.reloadGunOffset` `[{-3,1},{-1,0}]` and `ONEHANDR*/TWOHANDR*/HEAVYR*`; `animator.js` `reloadFrameTime 0.15`.
- **Repro:** `giveWeapon('kn44')`, fire a few rounds, reload, and step through at 0.15 s.
- **Expected:** a readable reload (two alternating arms-in frames).
- **Actual:**
  - The gun slides 2 px back and forth at about 6.7 Hz.
  - The arm changes (the hand pixels at rows 3–5 and 11–12) are mostly hidden under the gun and helmet (see finding 1).
  - It reads as jitter rather than a magazine swap.
- **Clause:** §1.1 "reload (two alternating 'arms pulled in' frames for the whole reload time)"; §5 "reload animation".
- **Fix:**
  - Make the reload offset bigger and add rotation. Frame 0 = `{x:-4, y:2}` with the gun tilted muzzle-down: author a `reloadTilt` flag, or simply use a separate 1-px-lower `gun` row by adding `dy +1` on the muzzle half in render.
  - Draw an `m`/`K` 2×3 magazine block in the left hand at torso (9..10, 3..5) in `*R0` frames, so the "fetch the magazine" beat is visible.
  - Slow `reloadFrameTime` to 0.25 s so it reads as a motion, not a vibration.
- **Resolution (FIX-1, partial):** the arm changes are now visible, because the helmet overlay and lower hand anchors keep them off the gun. R0 pulls the left hand back to the chest holding a fresh `m`/`K` magazine (a belt for heavy), with the right arm pulled in by `reloadGunOffset` {-3,1}. R1 puts the hand forward at the gun. `reloadFrameTime` is still 0.15: that is not in FIX-1's file set.

### 6. [minor] Pistol vs SMG vs AR vs LMG are distinguished mainly by length at game scale

- **Where:** `src/sprites/guns.js` `pistol`, `smg`, `ar`, `lmg`.
- **Repro:** stand-aim grid of mr6 / kuda / kn44 / dingo at 1×.
- **Expected:** "tell a shotgun from an SMG from an LMG at a glance".
- **Actual:**
  - The shotgun (tan wood), sniper (blue scope, long), ray gun, thundergun and death machine are all distinct.
  - The SMG (13×6) reads as a slightly longer pistol, and the AR vs LMG difference is a 3-px olive box.
  - All four are the same grey on black.
- **Clause:** §1.1 "each is a distinct top-down silhouette"; §5 "Each of the 9 gun sprite types is visibly different".
- **Fix:**
  - **SMG:** add a 2-px-wide perpendicular magazine sticking out 3 px on the *left* side (rows 0 to -2 at cols 6–7: `kmk` / `kMk` / `kkk`). Top-down, a side-mag SMG is iconic.
  - **LMG:** make the ammo box 5×4 `G/L` with a `y` brass belt pixel line (cols 7–11 rows 4–7), and give the barrel a 1-px `W` bipod stub pair at the muzzle end (rows 0 and 6 at col 16).
  - **AR:** add a 1-px `o` sling or tan furniture on the stock (cols 1–4 row 2 → `ktOO`) so it separates from the black LMG.
  - **Pistol:** keep it short, but make the slide `W` and the frame `K` so it reads as a handgun.
- **Resolution (FIX-3):** fixed in `src/sprites/guns.js`. Pistol 8×6 has a dark `K` frame and a `W` slide. SMG 14×9 is a boxy "T" with a long straight 4-px `m/M` stick mag and a folded stub stock. AR 22×9 has a full stock, a carry-handle arch, and a curved brown `o` banana mag. LMG 24×10 has a vented heat shroud, a big tan `O/t` box mag, a `y/o` brass belt and splayed `W` bipod legs. Checked in the sprite preview at 1x/3x/6x. Grips, muzzles, poses and weights keep their semantics, and the tests pass. ASCII is in `docs/notes/guns.md` under "FIX-3".

### 7. [minor] Bezel width changes with the health text ("100%" vs "67%"), so the whole bezel shifts

- **Where:** `styles.css` `.hud-status-cell` (`min-width: 21cqh`, line ~450); `hud.js` `updateHud` (line 302).
- **Repro:** 1280×720 stage, `setHealth(150)`, then `setHealth(100)`.
- **Expected:** a fixed Wolfenstein bezel.
- **Actual:** the `.hud-status` width goes from 490 to 473 px and its left edge moves from 395 to 403. Every time health regenerates across 100 % (or kills reach 10 or 100), the bezel and face jump sideways by 8 px.
- **Clause:** §1.2 bezel layout, §5 "Status bezel at bottom middle".
- **Fix:** give `.hud-status-cell` `min-width: 26cqh` (it fits "100%" at 8cqh with tabular numbers), or `width: 26cqh`, and keep `justify-content: center`.
- **Resolution (FIX-4):** `.hud-status-cell` is now `flex: none; box-sizing: border-box; width: 26cqh` (nowrap, tabular numerals already on the value). In the browser at a 1568-px stage, the bezel stays 726.2 px wide at the same left edge for 100 %, 67 %, 45 %, 14 %, 4 % and 0 % (game over).

### 8. [minor] Face: the bruise is grey (reads as a metal plate), and the tier-2 cut is a red "+" cross

- **Where:** `src/sprites/face.js` `B2` (rows 7–16), `B3`, `B4`.
- **Repro:** face at 60 % and 40 %, zoomed.
- **Expected:** a "bruised cheek" and "a cut on the forehead with a blood streak" (§1.2).
- **Actual:**
  - The bruise uses `m`/`S`: `m` is gun-metal grey, so the cheek looks like it has a steel patch.
  - The cut `.r. / rRr / .R.` at rows 7–9, cols 14–16 is a symmetrical plus sign, which reads as a Red Cross icon.
  - At tier 3, the two brow wounds at rows 7–10 (cols 6–9 and 14–16) are mirror images, so the blood reads like red eye-shadow or goggles.
- **Fix:**
  - **Bruise:** replace `m` with `r` at low density and add `S` round it. `B2` rows 14–16 become `'......rS'`, `'.....SrrS'`, `'......S'` (dark-red/brown on skin shadow). Optionally use `p` for 1 px in the centre at tier 3+.
  - **Cut:** make it a diagonal gash. Row 7 col 16 `R`, row 8 cols 15–16 `rR`, row 9 col 14 `R`, then the streak continues down cols 15/16 as now.
  - **Tier 3:** break the symmetry. Keep the left-brow cut 3×3, but move the right one up to rows 5–6 (into the hairline) and make it 2×2.
- **Resolution (FIX-4):** the bruise is a dithered `o`/`C` (brown/dark-blue) core in an `S` halo; it grows at tier 3, and tier 4 adds 1 px of `p`. No `m` in any blood layer (tested). The tier-2 cut is a diagonal gash (rows 7–9, cols 13–17) that drips down col 18 beside the right eye. Tier 3 is asymmetric: a small nick through the left brow, the right-side streak running on down to the jaw, and a nosebleed from the left nostril over the lip.

### 9. [minor] Face tier 1: the forehead sweat bead reads as a pimple, and the tier 3/4 squint hides one eye under blood

- **Where:** `face.js` `B1` row 9 col 12 (`w`); `G_EYES.squint` + `B3` row 12 col 16.
- **Repro:** face at 80 % and at 40 %.
- **Actual:**
  - The single white dot in the centre of the forehead looks like a blemish.
  - At tiers 3–4, the right eye is covered by `B2`/`B3` blood at (16,12), so only one eye is visible. §1.2 asks for "both eyes half shut" at tier 4.
- **Fix:**
  - Move the bead to col 8 (temple side) and make it `w` above `W`, the same as the side beads.
  - Move the `B2` streak pixel at row 12 col 16 to col 18, outside the eye (cols 14–17), so the squinting eye stays visible.
- **Resolution (FIX-4):** the tier-1 sweat is `w`-over-`c` droplets at both temples plus one on the right jaw; there is no centre bead. The squint keeps both eyes visible and half shut: the left eye shows `weew` and the right eye shows `SeeS` under heavy lids. All blood layers are masked to skin pixels, so no outline is overwritten, and they keep off the eye boxes. A test checks that both eyes stay visible at tiers 0–4 and that blood stays off the eyes and outline.

### 10. [minor] Dead face: the "tilt" is a shear that breaks the outline

- **Where:** `face.js` `TILT` / `shiftHead` for `G_DEAD` (line ~315).
- **Actual:** rows 0–5 shift 2 px and rows 6–14 shift 1 px, so the hair and forehead slide sideways over the static jaw. The right-side `k` outline has visible steps at rows 6 and 15, and it reads as a glitch rather than a tilted head.
- **Clause:** §1.2 "head tilted".
- **Fix:** draw a hand-authored tilted dead grid (the head rotated about 10° as a whole, with the jaw and chin moved 1 px the opposite way), or apply the shift as a 1-px diagonal to the whole head, rows 0–23 together, and redraw the outline.
- **Resolution (FIX-4):** the per-row shear is gone. The dead head (rows 0–23) is moved as one rigid piece, 1 px down and 1 px to the side, slumped onto the collar, so the outline stays closed. It now has rolled-back eyes (whites under heavy lids), a slack jaw, heavy blood (no sweat) and pale skin. A test checks that every head row has a `k` outline on both edges with no jumps.

### 11. [minor] Player and v1 zombies share the olive-green hue at game scale

- **Where:** `soldier.js` (the `G`/`L` fatigues) versus `render.js` zombie discs (zombie sprites are out of scope, §7).
- **Repro:** round 1 with 6 zombies at 1×.
- **Actual:** the soldier is a 26-px green ring and the zombies are 26-px green discs, so the player gets lost in a crowd.
- **Fix (in scope):**
  - Give the player a light rim: 1-px `L` on the outer shoulder row just inside the `k` outline.
  - Make the helmet `g` with `L` highlight and the chin strap `o`.
  - The tan backpack patch then carries identity.
  - Alternatively, zombies could be tinted greyer when their sprites land (WO3).
- **Resolution (FIX-1):** `G` is no longer used for any large area. The fatigues are dark `g` with an `L` rim on the lit shoulder, the helmet is bright `L`, and the tan backpack and skin forearms add warm accents. Side by side with a `#5f7a3a` disc at game scale, the player is clearly different.

### 12. [minor] The downed blood pool is anti-aliased vector circles, off the pixel grid

- **Where:** `render.js` `drawBloodPool()` (line ~1150).
- **Actual:** a smooth ellipse plus arcs drawn at 1-px resolution under a 2-px-grid sprite. It looks like a vector decal, not 8-bit art.
- **Fix:** draw the pool as a pre-made pixel sprite, a 24×20 grid of `r`/`R` with ragged edges at `scale 2`. Or snap it by drawing into a 1/2-resolution offscreen canvas with smoothing off and upscaling it ×2.
- **Resolution (FIX-2):** the pool is now a 30x26 pixel sprite with a ragged, lobed edge in `r` plus a few `R` highlights, and satellite drops once it is large. It is drawn at 2x on the player's pixel grid and grows from 30 % to full size over 1 s, using wall-clock time because a down freezes `state.time` at game over. The 10 growth stages are built lazily and cached.

### 13. [minor] The onehand arm swing ("back" frame) is a 1-px-tall skin stick

- **Where:** `soldier.js` `ONEHANDBACK` rows 1–3 (`'.kkkkgLLLLk.....'`, `'kSsLGLLLLLLk....'`, `'kkkkLGGGGGGGk...'`).
- **Actual:** the swung-back hand is a single row of `Ss` at cols 1–2 with `k` above and below. At 1× it reads as a thin detached line behind the backpack.
- **Fix:** make the swung arm 2 rows thick. Row 1 becomes `'.kkkgLLLLLk.....'`, row 2 `'kSsGLLLLLLLk....'` and row 3 `'kSsGGGGGGGGGk...'`, so the hand is 2×2 `Ss`/`Ss`. Mirror this for `ONEHANDFWD` rows 1–2 (cols 12–14).
- **Resolution (FIX-1):** in the onehand swing frames, both the back and the forward hand are now 2×2 `sS`/`Ss` blocks with a 2-row sleeve.

---

## Checked and OK

- **Bezel at 1280×720 and 900×506:**
  - Steel plate, bevel, rivets and a recessed face window: very Wolfenstein.
  - HEALTH on the left, the face in the centre, KILLS on the right.
  - The prompt sits above the bezel.
  - No overlap with the points (left) or weapon (right) readouts at either size.
  - Health text turns yellow at 40 % and red at 14 %.
  - The face canvas is pixelated and correctly scaled.
- **Face:** BJ-like blond hair, blue eyes, square jaw and green collar. The tiers get progressively bloodier, the hair is messy from tier 3, the pale tint shows at tier 4, and the dead face has crossed eyes and a slack mouth. Wince (closed eyes + pain mouth) and grin both read at a glance.
- **Wonder weapons:** the ray gun (bulbous, green rings), thundergun (long barrel, blue coils, bell muzzle) and death machine (fat 3-barrel) are distinct and on-model.
- **Other checks:**
  - Recoil kick and the muzzle flash at the barrel tip are fine; heavy guns kick harder.
  - Strafing (legs north, torso east) reads.
  - The walk frame cadence has no skating.
  - The sprint forward shift works (though 1 px is barely perceptible).
  - The downed sprite is readable: face-down soldier, backpack up, helmet, splayed arms and boots.
- **Not checked:** a real OS window resize (the window was minimised, so the size was forced through CSS), and audio.

---

## Final verification (Integrator, after Phase 4 fixes)

- **Setup:**
  - Served on port 8105. Used a new Chrome tab at `/?debug=1` and `/tools/sprite-preview.html`.
  - The tab was hidden, so the game was driven with `__game.debug.step(1/60, 1/60, inp)` plus hooks.
  - Crops of the game canvas around the player were taken after an explicit `render(state)`.
  - Rounds 1–3 were played by an auto-aim loop that aimed and fired at the nearest zombie. Zombies were not debug-killed.
- **Changes:** none. No regressions or defects needed fixing. `npm test`: 260/260.
- **Screenshots** (the PNGs come straight from the canvas unless noted):
  - `docs/screenshots/wo2-soldier-guns.png`: 9 gun types at 9 aim angles, including diagonals.
  - `docs/screenshots/wo2-bezel-hurt-face.png`: the full stage at 40 % health while wincing, with the wall-buy prompt above the bezel. This one was converted from a browser screenshot.
  - `docs/screenshots/wo2-face-tiers.png`: tiers 100/80/60/40/15 %, wince, grin and dead.
  - `docs/screenshots/wo2-thundergun-shockwave.png`: the cone before the shot and at +5, +12 and +24 frames, with near kills (+10) and knocked-back, stunned far zombies.

| # | Section 5 item | Evidence | Result |
|---|---|---|---|
| 1 | Readable 8-bit soldier, 1-px outline, palette only, no magenta | Helmet dome, square shoulders, two skin forearms, tan pack and boots beside the body read at 1x and 3x. The head is visible over all 9 guns in all 8 directions. There were 0 magenta pixels in a full game frame. The preview reports "No placeholder sprites. All modules loaded." | PASS |
| 2 | 8-frame legs tied to distance, no skating, sprint faster, neutral at rest | Walking in 8 directions shows the boots alternating front and back beside the body. Sprint covered 327 px/s against 220 px/s walking (1.49x). Standing returns to the neutral stance, and a strafe (legs north, torso east) reads. | PASS |
| 3 | Torso follows aim, legs follow movement, quantized crisp rotation | At 45°, 135°, -45° and -135°, pixels stay square 2x2 with a continuous `k` outline, and there are no mixels. | PASS |
| 4 | 9 gun sprites distinct, switch immediate, wall/box/DM/wonder correct | The pistol (short, `W` slide), SMG (T and stick mag), AR (banana mag), shotgun (wood), sniper (scope), LMG (box mag and bipod), Ray Gun, Thundergun and Death Machine can be told apart at a glance. The sprite changes on the first frame after `giveWeapon`. A box pull gave the Thundergun sprite. The Death Machine power-up shows the 3-barrel sprite. | PASS |
| 5 | Recoil every shot, reload anim for its duration, downed sprite | The torso kicks back on the first frame after the shot, and heavy guns shake. Reload alternates the magazine-in-hand and hand-at-gun frames every 0.25 s for the whole 2.x s. The downed sprite lies face down on a ragged pixel blood pool. | PASS |
| 6 | Muzzle flash and tracer at the muzzle | Flashes sit at the barrel tip for mr6, kn44, dingo, krm262 and the Death Machine. The Ray Gun bolt leaves from the muzzle. | PASS |
| 7 | Bezel bottom middle, HEALTH/face/KILLS, prompt above, no overlap | The bezel stays 726.2 px wide at 100/80/60/40/15 %. The prompt bottom is at 731 px and the bezel top at 742 px. There is no overlap with the points (bottom left) or ammo (bottom right) readouts. | PASS |
| 8 | 5 tiers + dead, blinks/glances, wince, grin, regen recovery | The tiers get progressively bloodier, and the dead face is slumped and bloody with a slack jaw. Over 8 s there were 6 distinct idle frames. Wince lasts about 0.4–0.5 s. Grin shows on `face('grin')` and on the Death Machine pickup. Regen after 4 s went 23 → 82 → 142 → 150 and the tiers recovered. | PASS |
| 9 | Thundergun: box at wonder weight, 4/12, near kills, far knock+stun, shake/shockwave, kills pay 10, LOS | Weight 1 is the lowest, shared with the Ray Gun. A real box pull on the 16th spin charged 95 and gave 4/12. In an open cone: both zombies at 148 and 245 px died for +20. The zombies at 408 and 460 px were knocked back and stunned 1.18 s. A zombie 90° off the aim, 159 px away, was untouched. The shockwave cone expands and fades. A zombie 240 px away behind a 2-tile wall survived unstunned for +0. A control zombie at 240 px with clear LOS died for +10. | PASS |
| 10 | Ray Gun in box, unchanged, own sprite | It is in `BOX_WEAPON_IDS` at weight 1, 20/160. The projectile flies from the muzzle and a direct hit kills for +10. It has the bulbous green-ring sprite. | PASS |
| 11 | `npm test` green; console clean menu → round 3 → death → restart | 260/260. The page error/warn hooks recorded 0 entries from menu → rounds 1–3 (27 kills) → death → game over → Enter restart → rounds 1–3 again (27 kills and 270 points, so no duplicate listeners) → round-15 load test. The only console exception came from a Chrome extension (`s2k-listener.js`) on the synthetic Enter key, not from the game. | PASS |
| 12 | 24 zombies < 3 ms per step | Each run was 600 steps with 24 alive while moving and firing. Dingo: mean 0.49 ms, p50 0.4, p95 0.9. Thundergun: mean 0.53 ms, p95 0.9. `render()` alone: mean 0.47 ms. There were single 20–28 ms maxima; these are the hidden-tab canvas flush artifact noted in wo2-gameplay #2. | PASS |

**Info (not defects, no change made):**
- The Thundergun's visual shockwave keeps expanding a little past the gameplay `range` while it fades. The gameplay cut-off is correct.
- The sprite-preview "Live" soldier still uses `pixel.drawSprite`'s rotation, not the crisp render.js cache. It is a tool only, and in-game rotation is crisp.
- The sprite-preview page timed out on one CDP screenshot, which is an environment issue. Its status line and console were clean.
