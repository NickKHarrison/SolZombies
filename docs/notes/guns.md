# guns.js — gun sprites (WO2, Agent B)

All guns face **+x** (right) at angle 0 and are side-profile silhouettes (the classic top-down shooter
convention), drawn over the torso with `grip` placed on `SOLDIER.torso.hand[pose]`.
Coordinates are sprite-px **corner** coordinates (pixel (c, r) spans c..c+1, r..r+1).

- `grip`: sits on the torso hand anchor. It is placed on the barrel axis at the rear of the receiver (the
  trigger-hand position), so the barrel line runs through the hand anchor.
- `muzzle`: the front tip, on the barrel axis at the right edge (`muzzle.x === sprite.w`), where flashes and tracers start.
- 1-px `k` outline (8-neighbour) around every silhouette. No `x` pixels. Only PALETTE chars.
- `gunSpriteFor(def)`: lookup order `def.sprite` -> `def.id` -> `def.cls` -> `default` (kept from Phase 0;
  `'default'` as a key is skipped so it only resolves through the fallback). Never returns undefined.

## Table

| key | size | grip | muzzle | pose | weight |
|---|---|---|---|---|---|
| pistol | 9x5 | (2, 2) | (9, 2) | onehand | 1 |
| smg | 13x6 | (4, 2) | (13, 2) | twohand | 1 |
| ar | 18x7 | (6, 2) | (18, 2) | twohand | 1 |
| shotgun | 18x5 | (6, 2) | (18, 2) | twohand | 1 |
| sniper | 24x6 | (7, 3) | (24, 3) | twohand | 1 |
| lmg | 19x8 | (5, 3) | (19, 3) | heavy | 1.6 |
| raygun | 16x9 | (4, 4) | (16, 4) | onehand | 1 |
| thundergun | 21x8 | (5, 4) | (21, 4) | heavy | 1.6 |
| deathmachine | 19x9 | (5, 4) | (19, 4) | heavy | 1.6 |
| default | 13x5 | (4, 2) | (13, 2) | twohand | 1 |

Sizes run a little larger than the ~3.4 nominals because of the outline (all within the tests/sprites.test.js tolerances).

## Grids

### pistol

Short slide (W/M), dark grip. Smallest silhouette.

```
kkkkkkkkk
kWWWWWWWk
kmMMMMMMk
kmKkkkkkk
kkkk.....
```

### smg

Compact receiver, folded dark stub stock, short stubby mag.

```
..kkkkkkkk...
kkkWWWWWWkkkk
kKKMMMMMMmMMk
kKkmKmmmkkkkk
kkkkkkmmk....
.....kkkk....
```

### ar

Long: dark stock, receiver, dark handguard, thin barrel with front sight, forward-raked mag.

```
....kkkkkkkkk..kkk
kkkkkWWWWWWWkkkkMk
kKKKKMMMMMMMKKKMMk
kKKkkmKmmmmmKKKkkk
kKkkkkkkmmkkkkkk..
kkk....kkmmk......
........kkkk......
```

### shotgun

Thick 2-row barrel full length, tan/brown wood stock and wood pump under the barrel.

```
....kkkkkkkkkkkkkk
kkkkkWWWWWWWWWWWWk
ktOOOMMMMMMMMMMMMk
kOOokmmkktOOOOkkkk
kkkkkkkkkkkkkkk...
```

### sniper

Longest: thin barrel, olive stock, dark scope with blue lens glints on top.

```
.....kkkkkkkkk..........
.....keWWWWWek..........
kkkkkkKKKKKKKkkkkkkkkkkk
kLGGGGGMMMMMMMMMMMMMMMMk
kggkkkkmKkkkkkkkkkkkkkkk
kkkk..kkkk..............
```

### lmg

Bulky: carry handle, heavy shroud, olive box mag, bipod leg under the barrel.

```
.....kkkkkk........
kkkkkkKKKKkkkkkkk..
kKKkkWWWWWWWmmmmkkk
kKKKKMMMMMMMMMMMMMk
kKKkkmmKGGGmmmmmkkk
kkkkkkkGLGGkkkkmk..
......kGGGGk.kmkk..
......kkkkkk.kkk...
```

### raygun

Bulbous grey dome body, green n/N ring fins, white emitter tip, dark grip.

```
..kkkkkk........
.kkWWWWkkkkkk...
kkWMMMMMnNnNkkkk
kWMMMMMMnNnNmnwk
kmMMMMMMnNnNmnwk
kkmmmmKmnNnNkkkk
.kkkkKKkkkkkk...
....kKKk........
....kkkk........
```

### thundergun

Long thick barrel, cyan/blue c/C coil bands with coil tips above/below, flared bell muzzle, tan stock.

```
.................kkkk
....kkkkkkkkkkk.kkWWk
kkkkkKKKKckckckkkMMWk
kOoMMMMMMcCcCcCMMMmKk
kOoMMMMMMcCcCcCMMmmKk
kkkkkmmkkCkCkCkkkmmmk
....kkkkkkkkkkk.kkmmk
.................kkkk
```

### deathmachine

Fat rotary: motor housing, 5 alternating barrels (W/m), clamp ring near the tip, top handle.

```
....kkkkkk.........
kkkkkKKKKkkkkkkkkkk
kKKKKmmmmWWWWWmWWWk
kKmmmMMMMmmmmmMmmmk
kKmmmMMMMWWWWWmWWWk
kKmmmMMMMmmmmmMmmmk
kKKKKmmmmWWWWWmWWWk
kkkkkKKkkkkkkkkkkkk
....kkkk...........
```

### default

Generic rifle (fallback for unknown classes, e.g. cls "special" without its own sprite).

```
..kkkkkkkkk..
kkkWWWWWWWkkk
kKKMMMMMMMMMk
kKkkmKkkkkkkk
kkkkkkk......
```

## Authoring notes
- Grids were authored as fill-only shapes and outlined with a small script (8-neighbour `k` ring, +1 px padding);
  the outlined grids are what is committed in guns.js. Edit the grids directly; keep the outline closed.
- Verified in tools/sprite-preview.html (gun sheet, pose x gun grid, live strip at 1x/3x).
- Colour use: shotgun is the only brown-wood gun; sniper stock is olive; LMG box mag is olive; ray gun green
  (n/N) and thundergun cyan/blue (c/C) are unique to the wonder weapons.

## WO2 notes for other agents
- Guns are drawn over the torso, so the hands at the grip point are partly covered by the gun; soldier.js hands
  read best if the hand pixel sits just behind/under the grip.
- Heavy guns (lmg, thundergun, deathmachine) have grip.y at the barrel axis, 3-4 px below the sprite top; with
  hand.heavy near the hip the barrel line stays close to the torso's right side.

## FIX-3 (WO2 Phase 4, visual finding #6)

Pistol, SMG, AR and LMG now differ by silhouette and colour, not just length. Other guns unchanged.
Grips stay on the barrel line at the back of the receiver; `muzzle.x === sprite.w`; poses, weights and lookup unchanged.
All sizes inside the tests/sprites.test.js tolerances (AR height 9 is the max allowed; SMG 9 also the max).
Authored as fill-only grids and outlined with the same 8-neighbour `k` ring script. Checked in tools/sprite-preview.html
(gun sheet, pose x gun grid, live strip 1x/3x).

| key | size | grip | muzzle | pose | weight |
|---|---|---|---|---|---|
| pistol | 8x6 | (2, 2) | (8, 2) | onehand | 1 |
| smg | 14x9 | (4, 2) | (14, 2) | twohand | 1 |
| ar | 22x9 | (6, 3) | (22, 3) | twohand | 1 |
| lmg | 24x10 | (5, 3) | (24, 3) | heavy | 1.6 |

The Table and Grids sections above describe the pre-FIX-3 pistol/smg/ar/lmg; these grids supersede them.

### pistol (FIX-3)

Tiny and dark: light `W` slide over a `K` frame, `K/m` grip hanging down. Smallest gun, the only one that is mostly black with a white top.

```
kkkkkkkk
kWWWWWWk
kKKKKKmk
kKmkkkkk
kKmk....
kkkk....
```

### smg (FIX-3)

Compact box receiver with a light top, folded `K` stub stock (gap to the receiver), short barrel, and a long straight `m/M` stick mag hanging 4 px from the middle: a "T" silhouette.

```
...kkkkkkkk...
kkkkWWWWWWkkkk
kKKkMMMMMMMMMk
kKKKmmmmmmKkkk
kkkkkkmMkkkk..
.....kmMk.....
.....kmMk.....
.....kmMk.....
.....kkkk.....
```

### ar (FIX-3)

Long: full `K` stock, carry handle (`W` bar on two posts, the hole reads as an arch), grey receiver, `K` handguard, thin barrel, and a forward-curving brown (`o`) banana mag. Only gun with a brown curved mag.

```
......kkkkkkk.........
kkkkkkkWWWWWk.........
kKKKKkkMkkkMkkkkkkkkkk
kKKKKKMMMMMMMKKKKMMMMk
kKKKkkmmmmmmmKKKKkkkkk
kkkkkkkkkkookkkkkk....
.........kkookk.......
..........kkook.......
...........kkkk.......
```

### lmg (FIX-3)

Bulkiest: `K` feed cover, heat shroud with `K` vent holes above and below the barrel, big tan (`O/t`) box mag with an olive base hanging under the receiver, `y/o` brass belt links down its left edge, splayed `W` bipod legs under the barrel front. Tan box contrasts with the olive fatigues.

```
....kkkkkkk.............
kkkkkKKKKKkkkkkkkkk.....
kKKKKMMMMMMmKmKmKmkkkkkk
kKKKKMMMMMMMMMMMMMMMMMMk
kKKkkmmmmmmmKmKmKmkkkkkk
kkkkkyGGGGGkkkkkkWWWkk..
....koOtttOk...kWkkkWk..
....kyOOOOOk...kkk.kkk..
....koGGGGGk............
....kkkkkkkk............
```

## WO5 (Agent D, WORK_ORDER_5 3.4): level-2 guns

Six new keys, named after the weapon ids (each def sets `sprite: <id>`). Same conventions: fill-only
grids outlined with the 8-neighbour `k` ring script, `grip` on the barrel axis at the rear of the
receiver, `muzzle.x === sprite.w` on the same row, palette only. Nominals added to
`tests/sprites.test.js` `GUN_NOMINAL` (existing guns' tolerances untouched) plus a WO5 test
(distinct grids, muzzle on the right edge, grip on the barrel line, pose by class, Gorgon longer
than the LMG, Marshal shorter than the shotgun). Checked in tools/sprite-preview.html (gun sheet).

| key | size | grip | muzzle | pose | weight | silhouette |
|---|---|---|---|---|---|---|
| manowar | 23x11 | (6, 3) | (23, 3) | twohand | 1 | chunky AR: 3-row receiver, vented handguard, grey round drum with white ring under the receiver |
| xr2 | 26x7 | (7, 2) | (26, 2) | twohand | 1 | slim futuristic AR: white `W` shell, purple `p` accent strip, long thin barrel, small grip/mag |
| weevil | 17x9 | (4, 2) | (17, 2) | twohand | 1 | boxy SMG: tall square receiver, stubby barrel, straight stick mag + short grip |
| marshal16 | 17x7 | (6, 3) | (17, 3) | twohand | 1 | short double barrel: tan wood stock, two stacked barrels with a dark seam, wood forend |
| gorgon | 28x10 | (5, 3) | (28, 3) | heavy | 1.6 | long LMG: vented shroud, muzzle brake, olive side ammo box with brass links, bipod |
| dredge48 | 27x13 | (5, 3) | (27, 3) | heavy | 1.6 | fat LMG: 4-row body, big tan/brown concentric drum under the receiver |

First pass of the 48 Dredge drum had two light
spots that read as a face; replaced with concentric rings and a dark hub.

## WO7 (Agent F, WORK_ORDER_7 1.5): level-3 guns

Three keys named after the weapon ids, same conventions as WO5 (`k` outline, grip on the barrel
axis, `muzzle.x === sprite.w`, palette only). Nominals added to `GUN_NOMINAL` in
`tests/sprites.test.js` (hg40 16x8, m8a7 25x7, peacekeeper 23x9) plus a "guns WO7" test
(distinct grids, muzzle/grip rules, twohand pose, HG 40 < Peacekeeper < M8A7 in length,
Peacekeeper taller than M8A7). Checked in tools/sprite-preview.html (pose x gun sheet).

| key | size | grip | muzzle | pose | silhouette |
|---|---|---|---|---|---|
| hg40 | 17x10 | (5, 5) | (17, 5) | twohand | compact SMG: tall stick mag sticking UP out of the receiver (light top), skeletal `W` wire butt, short barrel with a front-sight post, small grip |
| m8a7 | 26x9 | (7, 4) | (26, 4) | twohand | sleek long AR: integrated low scope housing with two cyan `c` lenses, long `W` highlight barrel line, thin stock, short straight mag |
| peacekeeper | 24x10 | (6, 3) | (24, 3) | twohand | chunky AR: 3-row receiver, top rail, heavy stock, square grip/mag block and an underbarrel tube with a `y` tip |
