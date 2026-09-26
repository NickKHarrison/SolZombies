# Zombie sprites (WO7 T1, Agent A): `src/sprites/zombie.js`

## WO7

### Contract (3.3), as shipped
- `ZOMBIE_SPRITES.normal`: `body.{walker,jogger,sprinter}`, `legs.frames` (6), `tearing`, `damaged`,
  `corpse` are 16x16. `anchor` and `legs.anchor` are both `{8,8}`.
- `ZOMBIE_SPRITES.minion`: `body`, `legs.frames` (4) and `corpse` are 12x12, with anchor `{6,6}`.
- `ZOMBIE_SPRITES.boss`: `body`, `charge`, `legs.frames` (4) and `corpse` are 40x40, with anchor `{20,20}`.
- There are 31 sprites in all. No sprite contains `'x'`, a magenta pixel or the `placeholder` flag, so `WO7 new
  exports` no longer lists zombie art.
- Everything faces +x at angle 0, and +y is the zombie's right side, the same as the soldier.
- **Extras, not in 3.3:**
  - `normal.tearingVariants` and `normal.corpseVariants` (`{walker, jogger, sprinter}`) keep each tier's colours.
    `normal.tearing` and `normal.corpse` are the walker versions.
  - `zombieSpriteFor(z)` returns the tier's own `corpse` and also a `tearing` field. `tearing` is `null` for
    minion and boss.
  - `boss.tintChar = 'p'`.

### Boss tint marker (important for render)
- `'x'` (magenta, `#ff00ff`) is reserved for placeholders, and the tests flag it: `isPlaceholder`, the "rows
  contain 'x'" check and the magenta-pixel check. The crown/helmet is therefore painted with **`'p'` (`#b44dff`)**.
- `boss.tintColor === PALETTE.p === '#b44dff'`, not `'#ff00ff'`.
- `'p'` appears **only** in the helmet dome and its five crown spikes, in `body`, `charge` and the helmet that has
  rolled off in `corpse`. It never appears in the boss legs. Pixel counts: body 72, charge 103, corpse 35.
- To recolour, replace every pixel whose RGB equals `tintColor`. `render.js` (C) already reads `B.tintColor` and
  matches the RGB exactly, so it works unchanged. Its comments still mention `'x'`/`#ff00ff` as the default.
- The minion also uses `'p'`, as its purple rim. Only apply the tint to boss sprites.
- The helmet also carries a `K` crest line and two `W` rivets. These are not recoloured and give the flat tint
  some detail.

### Art
- **Normal body.**
  - Hunched back: a shaded ellipse lit from the top-left, with a ragged rear edge and torn holes that show skin.
  - Two arms stretch forward. The left arm is 1 px longer, and each has a torn sleeve and a hooked finger.
  - The head is pushed forward of the shoulders and separated from them by a `k` ring. The front half is a pale
    face with two eye sockets and a dark-red open mouth.
  - Everything has a 1-px `k` outline.
- **Tier palettes.** Each tier has its own literal grids; there is no runtime swap.
  - walker: grey torn shirt `W/M/m`, green skin `G/g` with an `L/G` scalp, pale face `P/t`, black sockets.
  - jogger: olive-brown shirt `O/o/K`, blood `R/r` baked into the shirt, and a bright `R` mouth.
  - sprinter: a leaner silhouette (narrower shoulders and head), near-black `m/K/k` clothes, grey skin, a
    `W/M` face and **red** `R` eyes.
- **Pale faces.** The pale front half of the head is what keeps zombies apart from the soldier's olive helmet at
  game scale. It was checked in-game (`?debug=1`, round 12, mixed tiers around the player).
- **Legs, 6-frame shamble.**
  - Shoes are `o` with bare `S` toes. Trousers are `m/K`. The lanes are rows 4-5 and 10-11.
  - The left foot steps with offsets `4, 1, -2, -4, -1, 2`. While planted it moves back 3 px per frame:
    `zombieStride` 36 / 6 frames / scale 2.
  - The right foot is dragged, with offsets `-4, -2, 0, 2, 3, 0`. While it slides forward it is drawn 1 px
    shorter, with a `K` scuff behind it.
- **Tearing.**
  - The arms are raised wide, reach further forward and hook inward like claws.
  - The head is pushed 0.6 px further forward.
- **Damaged overlay.**
  - 13 `R`/`r` splatter pixels. Each one sits inside both the normal and the lean silhouette, and none sits on the
    outline, so the overlay never spills off any tier.
  - Everything else is transparent.
- **Normal corpse.**
  - The body lies face down with the head turned. The legs are splayed back with the shoes showing.
  - One arm is flung up and forward, the other down and back.
- **Minion.**
  - Near-black `K` with a sparse `p` rim and dither on the lit side.
  - Spindly 1-px arms with `W` bone claws.
  - A small head behind its own `k` ring, with two red `R` eyes on the front.
  - The 4-frame legs are thin sticks of ±3 px.
  - The corpse is sprawled.
- **Boss.**
  - A dark grey-flesh hulk (`M/m/K`) with shoulder lumps, a spine of `W` knuckles, one torn `o/O` harness strap
    and wounds.
  - The tapered arms have biceps and an elbow crease, and end in big hands with three `w/W` claws.
  - The head is a tinted helmet with crown spikes, a pale face, red eyes and teeth.
  - **Charge:** the arms are thrust straight forward and parallel, and the head is lowered. The helmet covers
    most of the head and only the red eyes show.
  - **Legs:** 4-frame stomp with ±8 px feet, `K/m` feet with `w` toenails and `O/o` trousers.
  - **Corpse:** the boss lies on its back with the helmet rolled off to the lower right.

### Authoring
- A scratch Node generator built the grids from shapes: ellipses, lines, role chars per tier and an automatic 4-neighbour
  outline. It then emitted the literal grids. `zombie.js` is the source of truth; edit its grids directly.
- Every row must stay 16, 12 or 40 characters and use only PALETTE chars, or `parseGrid` throws at import.

### Preview
- `tools/sprite-preview.html` has a new self-contained "Zombies (WO7)" section with its own module script, own
  canvases and own requestAnimationFrame loop. It shows:
  - static sheets at the page scale;
  - bodies with the damaged overlay;
  - legs composed under the body;
  - the boss tinted with each level's tint, or shown raw with the marker;
  - a live scene at game scale and at 2x zoom. The legs follow the movement, the body faces the soldier dot,
    and there are damaged, tearing and charge toggles.
- `window.__zombieSheet.step(dt)` advances the scene and redraws it while paused, for hidden tabs and
  screenshots.

### Verification
- `node --check` passes on `src/sprites/zombie.js`.
- `npm test`: 496/496 pass, including `WO7 new exports` and the 3.3 shape test.
- Checked visually in the preview, and in-game on port 8202 with Agent C's render already drawing the sprites.

## WO7 FIX-4 (QA #9): tier silhouettes and a non-olive palette
- **Why:** QA found that walker and jogger differed only by shirt colour, that the zombie green matched the soldier's olive, and that sprinters were low-contrast on the dark BUNKER floor.
- **Palette rule:** normal zombies (bodies, tearing frames, corpses) no longer use `G`/`g`/`L`. Olive belongs to the player only. PALETTE is frozen, so every change uses existing chars.
- **Walker:** slumped.
  - A wide hunched back (outline at col 0), with the head drooped lower (rows 6-11) and less far forward (front at col 12).
  - Only the left arm reaches forward (rows 1-4). The right arm dangles back along the side (rows 12-14).
  - Faded blue shirt `C`/`K`, bluish-grey skin `M`/`m`, grey face `W`/`M` with black sockets and an `r` mouth.
- **Jogger:** upright.
  - A compact torso, with both arms straight forward (rows 2-3 and 12-13) as brown `o`/`O` jacket sleeves ending in `H`/`h` hands.
  - The jacket tails flap out behind: a ragged back edge at col 0 on alternate rows.
  - Sickly yellow-ochre face `h` shaded `H`, a `t` highlight, and blood `R` on the jacket and cheek.
- **Sprinter:** lean and forward-leaning.
  - A narrow torso (cols 3-8), with the head pushed far forward (cols 9-15).
  - Both arms are swept back like running, with the hands at col 1.
  - Near-black `K`/`m` clothes, a white `w` face shaded `W`, and red `R` eyes and mouth.
  - A light `W` rim runs inside the top and back outline, so the sprite reads on the dark floors.
- **Tearing frames:** each tier keeps its palette and head, with both arms raised wide and hooked (walker and sprinter claws, jogger sleeves).
- **Corpses:** palette remaps of the old grids. Walker: `C` shirt, `M`/`m` skin, `W` face. Jogger: `h`/`H` skin. Sprinter: `w`/`W` face.
- **Damaged overlay:** redrawn as 12 `R`/`r` pixels. Each one sits inside (never on the outline of) all 3 bodies and all 3 tearing frames. This was checked with a scratch script that intersects the non-`k`, non-`.` pixels.
- **Unchanged:** sizes, anchors, frame counts, legs, minion, boss, the `'p'` tint marker, and `zombieSpriteFor`.
- **Verification:**
  - `node --check` passes, and `npm test` passes 511/511.
  - Checked in `tools/sprite-preview.html` and in-game with `?debug=1`, using a 3x3 mixed-tier crowd (bottom row below 50 % HP) around the player on BUNKER and CATACOMBS, at 1x and with `&touch=1`.
  - The player is now the only olive sprite, and the three tiers separate at a glance.
- **Caveat:** the jogger's parallel arms and square yellow face read a little "boxy" at 1x. It is clearly distinct, but a later art pass could soften it.
