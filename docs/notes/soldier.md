# Soldier sprites (WO2, Agent A): `src/sprites/soldier.js`

## Contract (3.4), as shipped
- `SOLDIER.legs.frames`: 8 Sprites, each 16x16, with `anchor { x: 8, y: 8 }`. Frame 0 is the neutral stance.
- `SOLDIER.torso.idle.{onehand,twohand,heavy}`: 16x16 each. `SOLDIER.torso.reload.<pose>` is `[Sprite, Sprite]`.
- `SOLDIER.torso.anchor = { x: 8, y: 8 }`: the rotation centre, which is the body centre.
- `SOLDIER.torso.hand`: `onehand { x: 13, y: 9 }`, `twohand { x: 12, y: 8 }`, `heavy { x: 11, y: 10 }`.
  Each is the torso pixel that the gun's `grip` pixel lands on, in corner coordinates as in pixel.js.
  Reload frames use the same hand anchor as the idle pose, so the gun does not move during a reload.
- `SOLDIER.down = { sprite: 20x20, anchor: { x: 10, y: 10 } }`, drawn unrotated.
- `SOLDIER.shadow = { rx: 7, ry: 5 }`, in sprite px.
- All sprites face +x at angle 0. +y is the soldier's RIGHT side, because screen y points down.
- No placeholder pixels: no grid contains `'x'`, and `isPlaceholder()` is false for all 18 sprites.

## Design notes
- **Reading at 2x.**
  - The silhouette has broad shoulder lobes, 14 px across in y.
  - A round 8x8 helmet sits forward of centre, with a tan backpack on the back.
  - The arms run forward off the ends of the shoulders into skin forearms and hands.
  - A 1-px `k` outline runs around the whole silhouette.
- **Depth by value.**
  - The helmet is closest to the camera, so it is the brightest element: a `G` dome, an `L` highlight top-left, `g` shadow bottom-right, and an `o` chin-strap line on the front rim.
  - The shoulders are one step darker: `G` base, `L` only on the upper lobe and sleeve, `g` on the lower lobe.
  - Light comes from the top-left in every sprite.
- **Hands.**
  - twohand: the left hand sits on the handguard just above the gun, and the right fist sits just below it, so skin shows on both sides of any gun.
  - onehand: the left hand rests forward of the left shoulder.
  - heavy: the gun sits at the right hip, and the left arm reaches wide over the top of it.
- **Gun overlap.** Agent B's guns have the grip inset, so the stock extends back from the hand. On long guns the stock lies over the lower half of the helmet, like a cheek weld. This is intended.
- **Legs.**
  - Black boots (`K`, with an `m` toe highlight) and olive trousers join a hip block that the torso always hides.
  - The walk cycle moves the left boot by `d = 0, +3, +6, +3, +1, -3, -6, -3` px along +x and the right boot by `-d`.
  - Frames 2 and 6 are full stride. In those frames the whole legs layer sways 1 px sideways.
  - The lifted back boot shows a heel highlight instead of the toe highlight.
  - The torso covers most of the 16x16 disc, so the legs mostly peek out behind the backpack at full stride, and around the body when the move direction differs from the aim. Legs and torso are both 16x16 on the same anchor, so the legs cannot reach further out than this.
- **Reload.**
  - Frame 0: the left hand is pulled back to the chest, holding a fresh magazine (`m`/`K`).
  - Frame 1: the hand pushes the magazine into the gun.
  - For heavy, the left hand feeds an ammo belt (`oOo`) instead.
  - In both frames the right arm is pulled in by 1 px.
- **Down.**
  - The soldier lies face down and sprawled: legs splayed with boots showing, one arm flung up-right and one down-left, backpack up, helmet on the right.
  - It reads as the same soldier and stays readable over the renderer's blood pool.

## Authoring workflow
1. A scratch script drafted the grids as parts: body, backpack, arms per pose, helmet and legs.
2. It layered the parts and added the outline automatically.
3. It then wrote out the literal grids that are now in soldier.js.

soldier.js is the source of truth, so edit its grids directly. Every row must stay 16 characters (20 for `DOWN`) and use only PALETTE characters. Otherwise `parseGrid` throws at import.

## Key frames (ASCII)

Torso idle poses:
```
onehand            twohand            heavy           
.....kkkkk......   .....kkkkkk.....   .....kkkkkk.....
....kgLLLLkk....   ....kgGLLLLkk...   ....kgGLLLLkkk..
...kGLLLLLssk...   ...kGLLLLLLLLk..   ...kGLLLLLLLLLk.
...kLGGGGGSsk...   ...kLGGGGGGGGsk.   ...kLGGGGGGGGGsk
..kooGGkkkkGk...   ..kooGGkkkkGSssk   ..kooGGkkkkGGSsk
.ktOoGkGLLGk....   .ktOoGkGLLGksssk   .ktOoGkGLLGkkssk
.ktOokGLLLGGk...   .ktOokGLLLGGkkk.   .ktOokGLLLGGkssk
.kOOokGLLGGok...   .kOOokGLLGGok...   .kOOokGLLGGokkk.
.kOOokGGGGgok...   .kOOokGGGGgok...   .kOOokGGGGgok...
.kOookgGGggok...   .kOookgGGggok...   .kOookgGGggok...
..kooGkgggokkk..   ..kooGkgggokk...   ..kooGkgggok....
..kgGGGkkkkSssk.   ..kgGGGkkkkssk..   ..kgGGGkkkkGk...
...kgGGGGGGSsssk   ...kgGGGGGSssk..   ...kgGGGGGGGgk..
...kggggggggkkk.   ...kggggggggk...   ...kggggSssgk...
....kgggggkk....   ....kgggggkk....   ....kgggSssk....
.....kkkkk......   .....kkkkk......   .....kkkkkk.....
```

Reload frames (onehand, twohand, heavy):
```
onehandR0          onehandR1          twohandR0          twohandR1          heavyR0            heavyR1         
.....kkkkk......   .....kkkkk......   .....kkkkkk.....   .....kkkkkk.....   .....kkkkkk.....   .....kkkkkk.....
....kgLLLLk.....   ....kgLLLLkk....   ....kgGLLLLk....   ....kgGLLLLkk...   ....kgGLLLLkk...   ....kgGLLLLkkk..
...kGLLLLLLkk...   ...kGLLLLLLLk...   ...kGLLLLLLLk...   ...kGLLLLLLLLk..   ...kGLLLLLLLLk..   ...kGLLLLLLLLLk.
...kLGGGGGGssk..   ...kLGGGGGGGSk..   ...kLGGGGGGssk..   ...kLGGGGGGGssk.   ...kLGGGGGGGssk.   ...kLGGGGGGGGSk.
..kooGGkkkkssmk.   ..kooGGkkkkGSsk.   ..kooGGkkkkssmk.   ..kooGGkkkkSssKk   ..kooGGkkkkSssk.   ..kooGGkkkkGSssk
.ktOoGkGLLGksKk.   .ktOoGkGLLGksssk   .ktOoGkGLLGksKk.   .ktOoGkGLLGksmKk   .ktOoGkGLLGkOok.   .ktOoGkGLLGkoOok
.ktOokGLLLGGkk..   .ktOokGLLLGGksKk   .ktOokGLLLGGkk..   .ktOokGLLLGGkkk.   .ktOokGLLLGGkk..   .ktOokGLLLGGkok.
.kOOokGLLGGok...   .kOOokGLLGGokkk.   .kOOokGLLGGok...   .kOOokGLLGGok...   .kOOokGLLGGok...   .kOOokGLLGGokk..
.kOOokGGGGgok...   .kOOokGGGGgok...   .kOOokGGGGgok...   .kOOokGGGGgok...   .kOOokGGGGgok...   .kOOokGGGGgok...
.kOookgGGggok...   .kOookgGGggok...   .kOookgGGggok...   .kOookgGGggok...   .kOookgGGggok...   .kOookgGGggok...
..kooGkgggokk...   ..kooGkgggokk...   ..kooGkgggok....   ..kooGkgggok....   ..kooGkgggok....   ..kooGkgggok....
..kgGGGkkkkssk..   ..kgGGGkkkkssk..   ..kgGGGkkkksk...   ..kgGGGkkkksk...   ..kgGGGkkkkGk...   ..kgGGGkkkkGk...
...kgGGGGGSssk..   ...kgGGGGGSssk..   ...kgGGGGSssgk..   ...kgGGGGSssgk..   ...kgGGGGGGGgk..   ...kgGGGGGGGgk..
...kggggggggk...   ...kggggggggk...   ...kggggggggk...   ...kggggggggk...   ...kggggSssgk...   ...kggggSssgk...
....kgggggkk....   ....kgggggkk....   ....kgggggkk....   ....kgggggkk....   ....kgggSssk....   ....kgggSssk....
.....kkkkk......   .....kkkkk......   .....kkkkk......   .....kkkkk......   .....kkkkkk.....   .....kkkkkk.....
```

Legs 0 (stance), 2 (full stride), 4 (passing), 6 (full stride, other foot):
```
legs0              legs2              legs4              legs6           
................   ................   ................   ................
................   ................   ................   ................
................   ................   ................   kkkkkkkk........
.....kkkkk......   ................   .....kkkkkk.....   KKKKLLLLk.......
....kLKKKmk.....   .....kkkkkkkkkkk   ....kLLKKKmk....   mKKKGGGGk.......
....kGKKKKk.....   ....kLLLLLLLKKKm   ....kGGKKKKk....   kkkkkGGgk.......
....kGGgkk......   ....kGGGGGGGKKKK   ....kGGgkkk.....   ....kGGgk.......
....kGGgk.......   ....kGGgkkkkkkkk   ....kGGgk.......   ....kGGgk.......
....kGGgk.......   ....kGGgk.......   ....kGGgk.......   ....kGGgkkkkkkkk
....kGGgkk......   ....kGGgk.......   ....kGGgk.......   ....kGGGGGGGKKKK
....kGKKKKk.....   kkkkkGGgk.......   ....kKKKKk......   ....kgggggggKKKm
....kgKKKmk.....   mKKKGGGGk.......   ....kKKKmk......   .....kkkkkkkkkkk
.....kkkkk......   KKKKggggk.......   .....kkkk.......   ................
................   kkkkkkkk........   ................   ................
................   ................   ................   ................
................   ................   ................   ................
```

Down (20x20):
```
down                
...............kk...
..............kssk..
.............ksssk..
..........kkkGSsk...
........kkGLLGGk....
.kkk...kGLLLLGGk....
kKKKk.kGLLGGGGkkkk..
kKmmGkgGGooGGkGLLGk.
.kKGGGgGotOokGLLLGGk
..kkGGgGOtOokGLLGGgk
....kggGOOOokGGGGggk
....kggGOOOokgGGgggk
..kkGGgGoOOoGkgggok.
.kKgGGgGGooGGGkkkk..
kKmmGkkggGGGGggk....
kKKKk..kggggggk.....
.kkk...kSgggkk......
......ksSskk........
......kssk..........
.......kk...........
```

## Verification
- Viewed in `tools/sprite-preview.html`:
  - the static sections at 6x;
  - the live strip at 1x and 3x, while walking, firing, reloading and down.
- Viewed in a scratch overlay:
  - each pose with pistol, AR and LMG at 10x and 2x;
  - the legs rotated 0, 90, 180 and -45 degrees under the torso.
- `node --check src/sprites/soldier.js` passes.
- `npm test` passes, 250/250.

## FIX-1 (WO2 Phase 4): soldier redraw

Fixes QA findings #1, #3, #4, #5, #11 and #13 from `docs/qa/wo2-visual.md`. This section supersedes the design notes
above wherever they differ.

### Contract changes
- New `SOLDIER.torso.helmet = { sprite: 16x16, anchor: { x: 8, y: 8 } }`. The sprite is transparent except for the
  helmet, registered to the torso grid. `render.js` (FIX-2) draws it after the gun with the torso's transform, so
  long guns pass under the head. The idle, reload and walk torsos contain the same helmet pixels (a test checks this).
  No `helmetOffset` is needed.
- The hand anchors are lower and to the right of the centre line:
  - onehand is `{13,10}` (was `{13,9}`);
  - twohand is `{12,9}` (was `{12,8}`);
  - heavy is `{11,12}` (was `{11,10}`).

  With these, the rifle runs along the right cheek, the heavy gun sits at the right hip, and both hands stay visible.
  I chose y=9 over QA's suggested y=10 for twohand, because at y=10 the right forearm is only a 1-px row below the
  gun.
- `reloadGunOffset` is unchanged: `[{-3,1},{-1,0}]`.
- `SPRITES.strideLength` changed from 72 to 48, matching the ±6 boot swing (24 world px per half cycle).

### Art
- **Colour.**
  - The fatigues are dark olive `g`. `G` is used only for the lit top-left of each shoulder lobe, plus an `L` rim on
    the lit shoulder.
  - The helmet is the brightest element: an `L` dome, `G`/`g` shade and an `o` chin strap. The head therefore pops
    out of the shoulders, and the player no longer matches the `G`-coloured v1 zombies.
  - Other elements: a tan `O`/`t` backpack patch, `s`/`S` bare forearms and black boots.
- **Silhouette.**
  - The shoulders are squared and span the full 16 px.
  - The backpack is a compact 3×6 patch behind the helmet, and the helmet is an 8×8 dome on the anchor.
  - Each arm leaves its shoulder lobe as a short sleeve and continues as a 2-px skin forearm reaching the gun:
    - twohand: left hand above the handguard, right hand on the grip below the gun;
    - heavy: left arm wide over the top, right arm under the hip-held gun;
    - onehand: right arm extended to the pistol.
- **Reload.**
  - R0: the left hand is pulled back to the chest holding a fresh magazine (`m`/`K`, or an `o`/`O` belt for heavy),
    and the right arm is pulled in with the gun.
  - R1: the left hand is forward at the gun, seating the magazine.
- **Onehand swing.** The swung-back and swung-forward hands are now 2×2 `sS`, not a 1-px stick.
- **Legs.**
  - The boot lanes are ±7.5 px, just outside the shoulders. The outer boot row and its outline peek out beside the
    torso in every frame, including the stance.
  - The walk offsets are `0, +4, +6, +4, 0, -4, -6, -4`, with a ±1 sway at full stride.
  - Boots are 5×3: an `o` trouser tuck, `K` leather, and an `m`/`M`/`W` toe shine. A trailing boot shows an
    `M`/`W` heel shine instead.
  - A short olive trouser strip joins a boot to the hip only when it is out of stance. There is no hip bar outside
    the torso.
- **Authoring.** The grids were drafted in a scratch Python script with an auto-outline for the legs, rendered
  locally at 8× and at game scale with rotation, then written into soldier.js. soldier.js remains the source of
  truth.

### Key frames

Torso idle poses and the helmet overlay:
```
onehand           twohand           heavy             helmet          
..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ................
.kLLLLLLLkkkk...  .kLLLLLLLkkk....  .kLLLLLLLkkkk...  ................
.kGGGGGGgGLssk..  .kGGGGGGgGLLk...  .kGGGGGGgGLLLkk.  ................
.kGgggggggGSsk..  .kGgggggggGsskk.  .kGgggggggGGssk.  ................
.kggggkkkkkkkk..  .kggggkkkkkkSssk  .kggggkkkkkkkssk  ......kkkk......
kOtggkLLLGkk....  kOtggkLLLGkgkssk  kOtggkLLLGkgkssk  .....kLLLGk.....
kOtOkLLLLGgk....  kOtOkLLLLGgkkSSk  kOtOkLLLLGgkkSsk  ....kLLLLGgk....
kOOOkLLLGGgk....  kOOOkLLLGGgk.kk.  kOOOkLLLGGgk.kSk  ....kLLLGGgk....
kOOOkLGGGggk....  kOOOkLGGGggk....  kOOOkLGGGggk..k.  ....kLGGGggk....
kOOokGGGggok....  kOOokGGGggok....  kOOokGGGggok....  ....kGGGggok....
kooogkgggokgkk..  kooogkgggokgkkk.  kooogkgggokgk...  .....kgggok.....
.kggggkkkkgsSsk.  .kggggkkkkgkSssk  .kggggkkkkgGk...  ......kkkk......
.kGggggggGssSk..  .kGggggggGLssSSk  .kGgggggsSGLk...  ................
.kGGGGGGGskkk...  .kGGGGGGGgkkkkk.  .kGGGGGGsSGk....  ................
.kgggggggk......  .kgggggggk......  .kgggggggkk.....  ................
..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ................
```

Reload (twohand R0/R1, heavy R0/R1) and onehand walk swing (back/forward):
```
twohandR0         twohandR1         heavyR0           heavyR1           onehandBack       onehandFwd      
..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  kkkkkkkkk.......  ..kkkkkkk.......
.kLLLLLLLkk.....  .kLLLLLLLkkk....  .kLLLLLLLkk.....  .kLLLLLLLkkk....  ksSLLLLLLk......  .kLLLLLLLkkkkkk.
.kGGGGGGgGLk....  .kGGGGGGgGLLk...  .kGGGGGGgGLk....  .kGGGGGGgGLLk...  kSsGGGGGgk......  .kGGGGGGgGLLLssk
.kGgggggggGsk...  .kGgggggggGssk..  .kGgggggggGsk...  .kGgggggggGssk..  .kkgggggggk.....  .kGgggggggGGSssk
.kggggkkkkkSsk..  .kggggkkkkkkSsk.  .kggggkkkkkSsk..  .kggggkkkkkkSsk.  .kggggkkkkk.....  .kggggkkkkkkkkkk
kOtggkLLLGkgkmKk  kOtggkLLLGkgksSk  kOtggkLLLGkgkoOk  kOtggkLLLGkgkssk  kOtggkLLLGkk....  kOtggkLLLGkk....
kOtOkLLLLGgksSmk  kOtOkLLLLGgkkssk  kOtOkLLLLGgksSok  kOtOkLLLLGgkkSsk  kOtOkLLLLGgk....  kOtOkLLLLGgk....
kOOOkLLLGGgkgkkk  kOOOkLLLGGgkkmKk  kOOOkLLLGGgkgkk.  kOOOkLLLGGgkkoOk  kOOOkLLLGGgk....  kOOOkLLLGGgk....
kOOOkLGGGggk....  kOOOkLGGGggk.kk.  kOOOkLGGGggk....  kOOOkLGGGggk.kok  kOOOkLGGGggk....  kOOOkLGGGggk....
kOOokGGGggok....  kOOokGGGggok....  kOOokGGGggok....  kOOokGGGggok..k.  kOOokGGGggok....  kOOokGGGggok....
kooogkgggokgk...  kooogkgggokgkk..  kooogkgggokgk...  kooogkgggokgk...  kooogkgggokgkk..  kooogkgggokgkk..
.kggggkkkkgsSk..  .kggggkkkkgsSsk.  .kggggkkkkgGk...  .kggggkkkkgGk...  .kggggkkkkgsSsk.  .kggggkkkkgsSsk.
.kGggggggGLssk..  .kGggggggGLssSk.  .kGgggggsSGLk...  .kGgggggsSGLk...  .kGggggggGssSk..  .kGggggggGssSk..
.kGGGGGGGgkkk...  .kGGGGGGGgkkkk..  .kGGGGGGsSGk....  .kGGGGGGsSGk....  .kGGGGGGGskkk...  .kGGGGGGGskkk...
.kgggggggk......  .kgggggggk......  .kgggggggkk.....  .kgggggggkk.....  .kgggggggk......  .kgggggggk......
..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......  ..kkkkkkk.......
```

Legs 0 (stance), 2 (full stride), 6 (full stride, other foot):
```
legs0                       legs2                       legs6                     
..........................  ..........................  ..........................
..........................  ..........................  ..........................
..........................  ..........................  ....kkkkkkkkk.............
..........kkkkk...........  ..........................  ...koMKKmGGGGk............
.........koKKmmk..........  ............kkkkkkkkk.....  ...koWMKKmgggk............
.........koKKmMWk.........  ...........kGGGGoKKmmk....  ...koKKKKggggkk...........
.........koKKKKk..........  ..........kgggggoKKmMWk...  ....kkkkkkkggggk..........
..........kggggk..........  ..........kgggggoKKKKk....  ..........kggggk..........
..........kggggk..........  ..........kggggkkkkkk.....  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggk..........
..........kggggk..........  ..........kggggk..........  ..........kggggkkkkkk.....
..........kggggk..........  ..........kggggk..........  ..........kgggggoKKKKk....
.........koKKKKk..........  ....kkkkkkkggggk..........  ..........kgggggoKKmMWk...
.........koKKmMWk.........  ...koKKKKggggkk...........  ...........kGGGGoKKmmk....
.........koKKmmk..........  ...koWMKKmgggk............  ............kkkkkkkkk.....
..........kkkkk...........  ...koMKKmGGGGk............  ..........................
..........................  ....kkkkkkkkk.............  ..........................
..........................  ..........................  ..........................
..........................  ..........................  ..........................
```

### Verification
- **Local renders.** I viewed each pose with every gun at 8× and at game scale, in 8 directions and next to a
  zombie-coloured disc.
- **In the game** (`/?debug=1`, after FIX-2's render change):
  - I stood with kn44, locus, dingo and mr6 in 8 directions. The head is visible over every gun, and the rotation
    is crisp.
  - I walked east and south with the kn44 over 8 frames each. The boots step clearly in front of and behind the
    body.
  - I strafed (moving north while aiming east); the boots stayed visible.
  - I reloaded with the kn44, dingo and mr6.
- **Preview page.** It shows the helmet overlay in the torso section, the pose × gun grid and the live strip. It
  reports no placeholder sprites and no errors.
- **Checks.** `npm test` passes 260/260, and `node --check` is clean.
- **Not changed (outside my files).**
  - QA #5 suggested `SPRITES.reloadFrameTime` 0.15 → 0.25. It is still 0.15; I could change only `strideLength`.
  - The down sprite is unchanged.

## WO4 (2.5): feet tucked under the body, a run gait, no sliding

This supersedes the FIX-1 "Legs" notes. Export names and shapes are unchanged: `legs.frames` is still 8 frames of 26x26 with anchor (13,13). The helmet overlay, `torso.walk`, `hand` and `reloadGunOffset` are unchanged in shape.

### Lanes and torso
- The boots now sit in lanes 5.5 sprite px either side of the centre line, on rows 6-8 and 17-19. FIX-1 had them at 7.5 px.
- Every legs pixel, outline included, stays inside the torso's 16-px width, so nothing protrudes sideways.
- To keep the boots visible, the rear of both shoulder lobes is 2 px slimmer in every torso grid: rows 0-3 and 12-15 now start at col 3 (col 4 for the cap rows).
  - Rows 4 and 11 got a closing outline pixel at col 2.
  - The backpack is now the rearmost part of the torso, so a trailing boot shows behind the shoulders.
  - The arm-swing rows of `ONEHANDBACK` are untouched.
  - The helmet pixels are unchanged.
- Boot art: 6 long x 3 wide.
  - `K` leather, with a 1-px `o` trouser cuff on the hip side.
  - A `W`/`M` shine on the far end: a toe shine when the boot is ahead of the hip, a heel shine when it is behind.
  - 2-row `g` trouser strips join the boot to the hip.
  - Everything is auto-outlined in `k`.

### Gait
Frame 0 is the passing frame, which is also the idle stance, so `legFrame = 0` on idle still looks right. L is the left boot's offset; the right boot runs the same cycle shifted by 4 frames. P means planted.

| frame | name | L | R |
|---|---|---|---|
| 0 | passing | 0 P | +2 |
| 1 | push-off | -5 P | +4 |
| 2 | flight | -4 | +5 |
| 3 | contact | -2 | +5 P |
| 4 | passing | +2 | 0 P |
| 5 | push-off | +4 | -5 P |
| 6 | flight | +5 | -4 |
| 7 | contact | +5 P | -2 |

- A planted boot moves back exactly 5 sprite px per frame (+5, 0, -5).
- `SPRITES.strideLength` is now **80** (10 world px per frame at scale 2), so the planted boot stays still on the ground.
- At a walk speed of 220 the cycle takes 0.36 s. WO4 suggested about 100 world px, but with a ±5 stride only 80 makes the foot stationary. At 100 the planted boot would visibly skate by about 25 %.
- `sprintCycleMult` is now 1 (was 1.5), so the foot does not skid while sprinting either.
- `torso.walk.onehand` was remapped to the new phase: `[idle, FWD, FWD, FWD, idle, BACK, BACK, BACK]`. The free left arm swings opposite the left boot.

### Known limit
- In the two passing frames (0 and 4) both boots are close to the hip.
- When the legs and torso face the same way, the forward arms and gun hide most of the forward boot. Only 2-4 boot pixels show at 1x.
- Every other frame shows a clear toe ahead of the body or a heel behind it.

### Tests
The legs assertions in `tests/sprites.test.js` replace the two FIX-1 legs tests (full-stride reach of 10 px, and boots beside the torso). They check:
- lanes 4.5-6 px from the centre line, with no pixel outside the torso's 16-px width;
- per boot, exactly two backward moves per cycle, each equal to `strideLength / 8 / scale`, over a ±5 span, with the right boot equal to the left boot shifted by 4 frames;
- at least 6 boot pixels visible past the shoulders (twohand torso, arms excluded) in every frame, with boots showing both behind and ahead over the cycle.

## WO7 (T3): knife torso (Agent B)
- **Sprite:** `SOLDIER.torso.knife = [cocked, thrust]`. Both frames are 16x16, face +x and use `torso.anchor` (8,8). There is no hand anchor, because the gun is not drawn.
- **Frame 0 (cocked):**
  - The left arm is raised forward as a guard. Rows 0-4 are the `ONEHANDFWD` rows.
  - The right hand is pulled back onto the right shoulder lobe (rows 13-14, cols 7-9).
  - The knife points forward: a `K` grip and a `WWw` blade at cols 10-13 of row 13.
- **Frame 1 (thrust):**
  - The left arm swings back for balance. Rows 0-4 are the `ONEHANDBACK` rows.
  - The right forearm drives forward and in toward the aim line: the hand is at col 12, row 10, with a `K` grip and a `Ww` blade at cols 13-15.
  - Rows 5-8 are the onehand body.
- **Helmet:** the pixels in rows 4-11, cols 4-11 are identical to `HELMET`. Both the animator test and a node check found 0 mismatches, so the helmet overlay still registers.
- **Checks:** checked by eye at 12x with the legs and helmet overlay in the preview page, using an injected overlay because the preview page was not edited. Both frames read clearly.
- **Test note (integrator / Agent F):** `tests/sprites.test.js` has no `torso.knife` coverage. `allSprites()` enumerates only idle, reload and walk per pose, and the helmet-match test checks only `idle`. The knife frames are covered in `tests/animator.test.js`, which checks their size and the helmet match. Optionally, add `SOLDIER.torso.knife[i]` (16x16) to `allSprites()`.

## WO7 FIX-4 (QA #15): longer, brighter knife blade
- The QA report said the blade was 1-2 px and got lost under the slash arc.
- **Frame 0 (cocked):**
  - Row 13 has a `K` grip at col 10 and a 4-px `WWWW` blade at cols 11-14, closed by a `k` tip.
  - Row 12 has a `www` white edge highlight at cols 12-14.
  - Row 14 is the outline.
- **Frame 1 (thrust):**
  - The fist moves back to cols 10-11 (`sS` on row 11, `ss` on row 12).
  - Row 11 has a 4-px `WWWW` blade at cols 12-15.
  - Row 10 has a `wwww` white edge highlight at cols 12-15.
  - Rows 9 and 12 outline the blade.
- Only rows 12-14 (frame 0) and rows 10-12 (frame 1) changed, all outside the helmet area. The helmet pixels still match `HELMET`, and the animator test passes. No other soldier art changed.
- Checked at 12x in an injected preview overlay and in-game at `&touch=1` during a swing.
