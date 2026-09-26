# WO2 Agent C: status face (`src/sprites/face.js`)

This replaces the Phase 0 stub. Export names and shapes follow contract 3.5.

## Art
- Wolfenstein 3D / BJ-style front face, 24x30, authored as ASCII grids with palette chars only. There are no `x` pixels.
- **Features:** square jaw, short blond hair (`h`/`H`), blue eyes (`e`), a thick shadowed neck, and a dark green collar (`g`/`G`/`L`).
- **Shading:** 1-px `k` outline, light from the viewer's left, with skin shadow `S` on the right cheek, ear, nose and jaw.
- **Layers:** every layer is a full 24x30 sprite, transparent where unused. They are authored as sparse row blocks (`block(y0, rows)`).
  - `base`: skull, ears, nose, jaw, neck, collar. It has no eyes, brows or mouth.
  - `hair.neat` and `hair.messy`. Messy has spikes and loose fringe strands and is used for tier 3 and above.
  - `eyes.*`: rows 10-12 (brows plus eyes). `left`/`center`/`right` move the 2x2 iris. `closed` is a lid line. `squint` has heavy lids, and the viewer's-right eye is nearly shut. `pain` is screwed shut with pinched brows.
  - `mouth.*`: rows 18-22. `neutral` is a line; `frown` has corners down; `grit` shows clenched teeth; `grin` is a wide toothy Doom grin; `pain` is an open grimace; `slack` is a dropped jaw.
  - `blood[t]`: cumulative overlays by tier.
    - 0: empty.
    - 1: sweat beads.
    - 2: forehead cut with a blood streak, and a bruised left cheek (`m`).
    - 3: a second brow cut, more bruising, and a nosebleed running over the lip.
    - 4: heavy streaking down the cheek and chin, and drips on the collar.
  - `dead`: built from the layers above so it always matches them. It combines messy hair, extra blood, X eyes drawn over the blood, and the slack mouth, all pale. The head is slumped 1 px and tilted (a per-row shear of +2/+1/0 px) over the fixed collar.
- **Tier 4 pale:** a char-level variant on the composed grid (`s -> P`, `S -> t`). The result is still palette art with `rows`, so the placeholder and palette checks keep working.

## Logic
- `healthTier`: 0 at 85 % or more, 1 at 65 % or more, 2 at 45 % or more, 3 at 25 % or more, else 4. Non-finite input gives 4.
- `dead` is `down` or `!(frac > 0)`.
- `createFaceState(seed)` uses `math.createRng`. The first glance and blink times are drawn from the `SPRITES.face` windows. It adds one extra field, `breathT`.
- `updateFaceState` is deterministic: all randomness comes from `fs.rng`, and loops handle large `dt`.
  - **Glance:** when `lookT` runs out, the eyes move to one of the two *other* directions, then `lookT` is set to a new value in `glanceMin..glanceMax`.
  - **Blink:** when `blinkT` runs out, `blinkFor = blinkTime` (minus any overshoot), and `blinkT` is set to a new value in `blinkMin..blinkMax`.
  - **Wince and grin:** their timers count down.
  - **Breathing:** `fs.breathe` is 0 or 1, as a square wave. The period gets shorter as the tier worsens: 3.2, 2.8, 2.4, 2.0 and 1.6 s.
  - **While dead:** there is no grin, blink or breathing.
- **Expression:**
  - **Mouth:** `pain` while wincing, else `grin` while grinning, else the tier default. Tier defaults are neutral, frown, grit, grit and pain.
  - **Eyes:** `closed` while wincing or blinking, else `squint` at tier 3 and above, else the current look. Tiers 3-4 therefore do not glance.
- `faceFrameKey`: `"t2:left:grit:blink0:b1"` (tier : resolved eyes : resolved mouth : blink : breathe), or `"dead"`. **The breathe bit is in the key**, so HUD code that redraws only on key change still animates the bob.
- `composeFace`: memoized per key in a Map. The number of combinations is small: at most 5 tiers × 6 eyes × 6 mouths × 2 × 2.
  - It layers base, hair, eyes, mouth and blood[tier], then applies the pale variant for tier 4.
  - When `breathe` is 1, it shifts the head rows (y < 24) down 1 px over the fixed neck and collar.

## Tests
`tests/face.test.js` has 9 tests:
- tiers and the dead flag;
- the same seed gives the same key sequence;
- the first glance and first blink fall inside their windows, with blink length close to `blinkTime`;
- wince overrides and expires;
- grin overrides and expires, and never shows while dead;
- the default expression for each tier;
- the breathing bob moves only the head;
- sizes, memoization, no placeholder or `x`, tier 4 is pale, and all 6 pictures are distinct.

## ASCII (base, then composed tier 0 / 2 / 4 / dead; look centre, breathe 0)
```
base                      tier 0                    tier 2                    tier 4 (pale)             dead                    
........................  ........................  ........................  .....k..kk..k..kk.......  ........................
........................  .......kkkkkkkkkk.......  .......kkkkkkkkkk.......  ....khk.khkkhkkhhk.k....  .......k..kk..k..kk.....
........................  .....kkhhhhhhhhhhkk.....  .....kkhhhhhhhhhhkk.....  ...khhhkhhhhhhhhhhkhk...  ......khk.khkkhkkhhk.k..
......kkkkkkkkkkkk......  ....khhhhhhhhhhhhhHk....  ....khhhhhhhhhhhhhHk....  ..khhHhhhhhhHhhhhhHHk...  .....khhhkhhhhhhhhhhkhk.
.....ksssssssssssSk.....  ...khhhHhhhhhhHhhhHHk...  ...khhhHhhhhhhHhhhHHk...  ...khhhHhhHhhhhHhhHHHk..  ....khhHhhhhhhHhhhhhHHk.
....ksssssssssssssSk....  ...khhHhhhHhhHhhHhHHk...  ...khhHhhhHhhHhhHhHHk...  ..khHhHhhrhHhhHHhHhHHk..  .....khhhHhhHhhhhHhhHHHk
....ksssssssssssssSk....  ...kHhHHhHHhHHhHHhHHk...  ...kHhHHhHHhHHhHHhHHk...  ...kHhHHrRHHPHHhHHrHHk..  ....khHhHhhrhHhhHHhHhHHk
....ksssssssssssssSk....  ...kHHssssssssssssHHk...  ...kHHsssssssssrssHHk...  ...kHHPrRrPPHPPrPrRHHk..  ....kHhHHrRHHPHHrrHrHHk.
....ksssssssssssssSk....  ...kHsssssssssssssSHk...  ...kHwssssssssrRrsSwk...  ...kHwrRRrPPPPrrrRtwk...  ....kHrPrRrPPHPrRRrRHHk.
....ksssssssssssssSk....  ...kHsssssssssssssSHk...  ...kHWsssssswssRssSWk...  ...kHWPRrPPPwPrrRPtWk...  ....kHRrRRrPPPPrrrRtwk..
...kksssssssssssssSkk...  ...kkHHHHHssssHHHHHkk...  ...kkHHHHHssssHrHHwkk...  ...kkPkrHHkPPkHrRkwkk...  ....kHrPRrPPPwPrrRPtWk..
..kSSssssssssssssSSSSk..  ..kSSsweewssssweewSSSk..  ..kSSsweewssssweewSSSk..  ..kttPkkkkPPPPkkkktttk..  ....kkHHHHHPPPPHHHHHkk..
..kSSssssssSSsssSSSSSk..  ..kSSsSeeSsSSsSeeSSSSk..  ..kSSsSeeSsSSsSeRSSSSk..  ..kttRweewPttPtkRRtttk..  ...kttPkttkPPPPkttktttk.
..kSSssssssSSssssSSSSk..  ..kSSssssssSSssssSSSSk..  ..kSSwsssssSSsssrSSSSk..  ..kttrPPPPPttPPPRrtttk..  ...kttRtkktPttPtkkttttk.
..kSSsssssssSssssSSSSk..  ..kSSsssssssSssssSSSSk..  ..kSSWmSssssSssssSSSSk..  ..kttRmtPPPPtPPPPRtttk..  ...ktrrkttkPttPkttktttk.
...kSssssssssSsssSSSk...  ...kSssssssssSsssSSSk...  ...kSmmSsssssSsssSSSk...  ...kmmmttPPPPtPPPrttk...  ...ktRRmtPPPPtPPPPrtttk.
....ksssssSSSSSssSSk....  ....ksssssSSSSSssSSk....  ....ksmsssSSSSSssSSk....  ....kmmtPPtttttPPRtk....  ...krmmttPrPPtPPPRttk...
....ksssssskSkSsssSk....  ....ksssssskSkSsssSk....  ....ksssssskSkSsssSk....  ....kPPPPPRRtktPPrtk....  ....kmmtPrRrtttPPrtk....
....kssssssssssssSSk....  ....kssssssssssssSSk....  ....kssskkkkkkkksSSk....  ....kPPPPkRRrkkPPRtk....  ....kPPPPrRRtktPPRtk....
....kSssssssssssssSk....  ....kSsskkkkkkkkssSk....  ....kSsskwwwwwwkssSk....  ....ktPPkwRrwwwkPrtk....  ....kPPPPPRRrPPPPRtk....
....kSsssssssssssSSk....  ....kSsssSSSSSSssSSk....  ....kSsskkkkkkkksSSk....  ....ktPPkKKrKKKkPttk....  ....ktPPPkkkkkkPPrtk....
....kSSssssssssssSSk....  ....kSSssssssssssSSk....  ....kSSssssssssssSSk....  ....kttPPkkRkkkPPttk....  ....ktPPPkKKKKkPPttk....
.....kSSsssssssSSSk.....  .....kSSsssssssSSSk.....  .....kSSsssssssSSSk.....  .....kttPPPrPPPtttk.....  ....kttPPkKrRKkPPtrk....
......kkSSSSSSSSkk......  ......kkSSSSSSSSkk......  ......kkSSSSSSSSkk......  ......kkttttttttkk......  .....kttPRkkkkPtttk.....
.......kSSSSSSSSk.......  .......kSSSSSSSSk.......  .......kSSSSSSSSk.......  .......kttttttttk.......  ......kkttrtttttkk......
.....kkkSssssssSkkk.....  .....kkkSssssssSkkk.....  .....kkkSssssssSkkk.....  .....kkktPPPPPPtkkk.....  .....kkktPPPPPPtkkk.....
...kkgGGkSssssSSkGGgkk..  ...kkgGGkSssssSSkGGgkk..  ...kkgGGkSssssSSkGGgkk..  ...kkgGGktPPPPttkGGgkk..  ...kkgGGktPPPPttkGGgkk..
..kgGLGGgkSsssSkgGGGGgk.  ..kgGLGGgkSsssSkgGGGGgk.  ..kgGLGGgkSsssSkgGGGGgk.  ..kgGLGGgkrPRPtkgGGGGgk.  ..kgGLGGgrRrRPtkgGGGGgk.
.kgGLGGGGgkSSSkgGGGGGggk  .kgGLGGGGgkSSSkgGGGGGggk  .kgGLGGGGgkSSSkgGGGGGggk  .kgGLGGGGgktttkgGGGGGggk  .kgGLGGGGgrtttkgGGGGGggk
kgGGGgGGGGgkkkgGGGGgGGgk  kgGGGgGGGGgkkkgGGGGgGGgk  kgGGGgGGGGgkkkgGGGGgGGgk  kgGGGgGGGGgkkkgGGGGgGGgk  kgGGGgGGGGgkkkgGGGGgGGgk
```

## FIX-4 (QA visual #8, #9, #10)
- **Blood masking:** blood layers are masked with `onSkin()`, so they only paint over base skin pixels. They never touch the `k` outline or anything outside the head. Eye boxes (rows 11-12, cols 6-9 and 14-17) are kept clear by the authoring and checked by a test.
- **Tier 1:** sweat droplets, each `w` over `c`, at both temples and one on the right jaw. The centre "pimple" is removed.
- **Tier 2:** a short diagonal gash on the right forehead (rows 7-9, cols 13-17) that drips down col 18 beside the right eye. The left-cheek bruise has a dithered `o`/`C` core in an `S` halo. There is no grey `m` anywhere.
- **Tier 3:** asymmetric. It adds a nick through the left brow, runs the right streak on down to the jaw, adds a nosebleed from the left nostril over the lip, and makes the bruise bigger.
- **Tier 4:** adds a run from the hairline down the left temple beside the eye, a right cheek-edge streak, both nostrils bleeding over the chin, collar drips, and 1 px `p` in the bruise.
- **`squint` (tiers 3-4):** both eyes are half shut under heavy lids. The left eye is `weew` and the right is `SeeS` (the harder squint). Both stay visible.
- **Dead:** the per-row shear `TILT` is removed. The head (rows 0-23) shifts as one rigid piece, +1 px x and +1 px y, slumped onto the collar, so the outline stays clean. The eyes are rolled back (whites under heavy lids), with a slack jaw, B4 blood plus extra (sweat stripped) and pale skin.
- **Tests:** 2 added.
  - Both eyes are visible at tiers 0-4. Blood stays off the eyes and the outline. Tier 1 contains `c`. No `m` appears in the blood.
  - The dead head rows have a `k` outline on both edges, with no outline jumps of more than 2 px.
- **Verification:** checked in the sprite preview (8x/4x/1x strip) and in game via `/?debug=1` at 75/56/35/12 % and game over. `npm test` is 258/258.
