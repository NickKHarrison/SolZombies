# WO9 QA: level 6 TEMPLE (playtest and art direction)

QA agent for level 6 TEMPLE (WO9 Phase 3). I read WO9 1.4, 1.5 and 5, `docs/notes/level6.md` and
`docs/notes/integration-wo9.md`. No files in `src/` or `tests/` were edited. I checked one proposed
fix on a copy of the repo in the scratchpad (see #1).

**Setup.** Server: `python -m http.server 8324`. I used a new Chrome tab at `/?debug=1` and
`/?debug=1&touch=1`, with `#stage` forced to 844x390. The tab reported `document.hidden = true`,
so frames were driven with `__game.debug.step(dt, dt, overrides)`, with a small in-page bot:
- a BFS walker;
- auto-aim with real semi-auto trigger edges;
- kiting;
- tide strategies `stand`, `open` (sprint away) and `pillar` (hide in the ray shadow).

**How I got to TEMPLE.** On desktop: a real Shift+M, then a real click on the L6 card. On touch: a
real tap on the pause button, then LEVELS, a scroll, and a tap on the TEMPLE card. The banner
"TELEPORTED — L6 TEMPLE" showed and the practice flag was set.

**Real interact path (god mode on only for this route walk, with 30k points banked).** Every
interactable in the table below was bought through `interact`, which is the same path as pressing F.
Every item was reachable. The prompts and prices were correct.

| Kind | Items bought | Cost |
|------|--------------|------|
| Perks | Q revive | 50 |
| | N Double Tap | 200 |
| | C Speed | 300 |
| | U Stamin-Up | 200 |
| | J Jugg and K Mule | "Perk limit reached" at 4 perks, as intended |
| Wall buys | KN-44 | 150 |
| | Peacekeeper | 400 |
| | Man-O-War | 250 |
| | HG 40 | 350 |
| | Haymaker | 250 |
| | M8A7 | 375 |
| | Marshal | 225 |
| | Gorgon | 300 |
| | Drakon | 300 |
| Doors | D | 75 |
| | E | 100 |
| | F | 100 |
| | G | 125 |
| | H | 150 |
| | Mega door | 1500 |
| Other | Box on the idol (spun, then took a weapon) | 95 |
| | Pack-a-Punch on the Drakon (PaP'd Drakon taken back as Firestorm) | 500 |
| | Stairs: "Press F to descend", descended to BUNKER II | — |

**Boss fight (god mode off).** THE DROWNED KING was fought through a real mega-door purchase and a
real arena entry, then killed with god mode off (a 445 s bot fight, 48 tide waves).

---

## Findings

### 1. MAJOR: THE DROWNED KING gets permanently wedged at the arena side inlets

- **Where:** `src/levels/level6.js`, ASCII rows 6 and 7 (the "side inlets" `~~` at cols 21-22 and
  37-38). The failure shows up in `src/zombie.js` `updateChasing` → `moveAndCollide` → `settle`
  (`map.resolveCircle`).
- **Cause:** at rows 6-7, column 36 (and column 23 on the west side) is a **1-tile (40 px)
  passage** between two things:
  - the pillar block at cols 34-35 (rows 4-5 and 8-9);
  - the inlet water at col 37 (col 22 on the west).

  The flow field is built per tile for radius-14 movers, so it routes the boss straight through
  that passage. The boss has radius 34 (68 px wide). It jams between the pillar corner and the water
  tile: the push-outs cancel, it keeps `vx = -113` and it moves 0 px. It never recovers, even after
  the player moves anywhere else in the arena.
- **Repro** (deterministic, god mode on so only the boss moves):

  ```js
  __game.debug.levelSelect(5); __game.debug.openMegaDoor(); __game.debug.startBoss();
  // hold the player at the NE corner (37,3) for 8 s, then at the SE corner (37,10) for 10 s
  ```

  The boss stops at (36.5, 5.5) and stays there. In each of the other three mirrored or reversed
  runs it also stuck, at the positions below. After each run I moved the player to the far side of
  the arena for 8-10 s, and the boss stayed stuck.

  | Player path | Boss stuck at |
  |-------------|---------------|
  | NW → SW | (23.5, 5.5) |
  | SE → NE | (36.5, 8.5) |
  | SW → NW | (23.5, 8.5) |

  It also happened by itself in a god-off bot fight, where the boss ended wedged at (23.5, 5.5).
  Screenshot: `wo9-qa-temple-07-boss-wedged-east-inlet.png`.
- **Expected vs actual:**
  - Expected: the boss chases the player around the pillars, and the fight stays a
    dodge-the-tide duel.
  - Actual: running along either side wall of the arena (a natural kiting line) parks the boss for
    good. After that, the only threat is the tide every 7 s, which you can dodge by stepping behind
    a pillar. The fight is trivial, and a stuck boss looks broken.
- **Fix (primary, level data):** narrow each inlet to 1 tile so the passage is 2 tiles (80 px)
  wide, like every other lane in the arena. In `src/levels/level6.js`:

  ```
  -    '#SW.....###.....#####~~..............~~#####.....###.....WS#', //  6
  -    '###.....###.....#####~~......Z.......~~#####.....###.....###', //  7
  +    '#SW.....###.....#####~................~#####.....###.....WS#', //  6
  +    '###.....###.....#####~.......Z........~#####.....###.....###', //  7
  ```

  **Verified.**
  - I applied this edit to a scratch copy of `src/` + `tests/` and ran `node --test "tests/*.test.js"`:
    **643/643 pass**. Symmetry is kept, water drops from 176 to 172 tiles (≥ 150), arena water from
    16 to 12 (≥ 8), and the arena grows from 148 to 152 tiles (130-220).
  - In the live page I patched the same four tiles to floor and re-ran all five wedge sequences,
    plus a four-corner tour: **0 stuck seconds**. The boss reached (37.3, 8.8), (22.7, 5.2) and so
    on.
  - Please also update the arena row text in `docs/notes/level6.md` ("central pool + 2 side
    inlets").
- **Fix (optional, belt and braces, `src/zombie.js`):** add a boss unstick. In `updateChasing`,
  for `z.kind === 'boss'`, track the distance moved over 0.75 s. If it is under 4 px while chasing
  and not in contact with the player, use `dir = norm(p.x - z.x, p.y - z.y)` (direct pursuit) for
  0.5 s. This protects every arena, including KINO and OUTPOST, from radius-34 corner snags.
- **Resolution (FIX-1):** rows 6 and 7 changed exactly as proposed (1-tile inlets, 2-tile lanes). Arena 152 tiles, water 172, arena water 12, symmetry kept. Pinned in tests/level6.test.js and in the level6.md arena row. The interact-reach check also moved Speed Cola / Stamin-Up (7,16)/(52,16) -> (2,28)/(57,28).
- **Resolution (WO9 FIX-3, optional unstick):** done in `src/zombie.js` as a clearance flow field for large zombies plus a stuck watchdog (steer -> seek fitting point -> nudge; see OUTPOST #1 for details). With the original inlets restored in memory, a sweep over all arena tiles reached every tile the boss can physically reach. The 5 unreached tiles sit in the west pocket behind the 1-tile passages. When the player moved on, the boss always recovered; it never stayed parked.

### 2. MINOR: tide telegraph reach circle under-reports the reach and is drawn through walls

- **Where:** `src/render.js` `drawTideFloor`, telegraph branch (the dashed circle at `maxR`).
- **Actual:**
  - The dashed "the wave stops here" circle is drawn at 420 px. `tideBandHits` hits the player
    centre up to `maxRadius + band = 448` px.
  - Measured: sprinting away from a boss at col 34 got **HIT at d = 446** (the ring was already at
    its 420 max), while standing clearly outside the drawn circle.
  - The circle is also stroked in full over walls, into the sanctum and corridors outside the
    arena. It is faint, but it suggests the wave goes through walls, which it does not.
- **Expected:** a player whose body is outside the dashed circle is never hit.
- **Fix (render only; the config is pinned by `tests/contracts.test.js`):** in `drawTideFloor`,
  change

  ```
  -    ctx.beginPath(); ctx.arc(z.x, z.y, maxR, 0, Math.PI * 2); ctx.stroke();
  +    ctx.beginPath(); ctx.arc(z.x, z.y, maxR + band * 0.6, 0, Math.PI * 2); ctx.stroke();
  ```

  At 437 px, a hit (centre ≤ 448) always means the 14 px body overlaps the line. Optional: stroke
  it per ray with the same `rayReach` / `tideReach` segments the wave already uses, so the preview
  is cut by pillars and walls too.
- **Resolution (FIX-2):** the telegraph reach circle is drawn at `maxRadius + band * 0.6` and cut per ray at walls and pillars like the wave ring.

### 3. MINOR (design): "outrun" only works when the boss is near the east or west end of the arena

- **Data:** the arena is 18x10 tiles (720x400 px) and the reach is 448 px.
  - **Boss at Z:** I tested the player on every one of the 148 arena floor tiles.
    - 103 tiles are hit.
    - 45 tiles are safe, and all 45 are pillar-shadow tiles.
    - No open tile is out of reach.
  - **Sprinting away along row 7 (walking gives the same result: both reach the west inlet wall at
    col 23.35):**
    - boss at col 36 or 35: the player escapes (d = 526 / 486 at the end);
    - boss at col ≤ 34: the player is always hit.
  - **Pillars always work:** with the `pillar` strategy, **0 hits in 102 tide waves** over 4 fights.
    With `stand` (kiting at about 260 px), 0 hits over 4 waves because the kiting ended up behind
    pillars.
- **Verdict:**
  - Section 5 says "can be outrun **or** blocked by walls". Blocking is reliable, readable and fun.
  - Outrunning is rare in this arena, and I think that is acceptable: the ring breaks visibly at
    each pillar (`wo9-qa-temple-06`), so hiding is clearly the answer.
  - No change is required. If outrunning should become a real option, it needs a config change
    (`maxRadius` about 340), which also means updating `tests/contracts.test.js` and WO9 1.4.
    Flagged for the lead only.

### 4. NOTE: tide knockback shorter near walls (the integrator's open point): works as intended

- **Where:** `src/zombie.js` `tideHit`: 6 sub-steps of 20 px, each resolved by
  `map.resolveCircle(map, x, y, 14)` (this also applies to pits, because `isWalkable` is false for
  `~`).
- **Measured:** 564 tide hits, with the boss at 7 positions and the player on every arena tile.

  | Knockback | Hits |
  |-----------|------|
  | Full, 100-120 px | 274 |
  | 60-99 px | 138 |
  | 20-59 px | 110 |
  | < 20 px | 41 |

  Every short knockback is a push into a wall, a pillar, the pool or an inlet. Examples:
  - (29,6): 6 px, pushed into the pool;
  - (30,11): 29 px, pushed into the south wall, then it slides east;
  - (21,4): 0 px, a corner.

  **No hit ever left the player inside a wall or water tile, or outside the arena.** One case went
  to 126 px (a 6 px resolve slide round the inlet corner), which is harmless.
- **Verdict:** the 35 px case is the `resolveCircle` clamp and is correct: the player is not
  squeezed through geometry and the damage (40) is unchanged. No fix. Optional polish: an extra
  `pushShake(state, 0.2, 5)` when fewer than 60 of the 120 px were applied, so the player feels
  the "wall slam".

### 5. MINOR: the arena-side "SEALED" plate sits on top of the player on arena entry

- **Where:** `src/render.js` `paintPlate` (the rect pushed to `labelRects` has no `buy` flag), then
  `drawLabelsOverPlayer` re-blits it over the player at 0.75 alpha.
- **Repro:** enter the arena (boss fight starts, mega door seals). The player stands on the first
  tile north of M, right under the inner "SEALED" plate. On the phone (zoom 1.96) the plate covers
  the soldier and the first minions: `wo9-qa-temple-11-mobile-boss-sealed-label-over-player.png`.
  This affects every level, but it is most visible in TEMPLE's small arena.
- **Fix:** in `paintPlate`

  ```
  -  if (labelRects) labelRects.push({ x: px, y: py, w: plateW, h: plateH });
  +  if (labelRects) labelRects.push({ x: px, y: py, w: plateW, h: plateH, buy: true });
  ```

  The plate is then re-blitted at `RENDER.buyPlateOverPlayerAlpha` (35 %) like the wall-buy
  plates.
- **Resolution (FIX-2):** applied (mega door plates are tagged buy -> 35 % over the player).

### 6. MINOR (art): the wall glyph band reads as Latin letters "O T N W"

- **Where:** `src/render.js` `paintTempleWalls`, the glyph `kind` switch.
- **Actual:** at both desktop and mobile zoom, the carved band reads like the text "NOTTONWT"
  (`wo9-qa-temple-09-mobile-gate-glyph-letters.png`). The shapes are:
  - kind 0: a circle, which reads as "O";
  - kind 1: a T bar;
  - kind 2: a zigzag, which reads as "N" or "W".
- **Fix:** swap kinds 1 and 2 for non-letter shapes (an eye and a stepped pyramid):

  ```
  -          else if (kind === 1) { c.moveTo(gx - 2.5, gy - 2.5); c.lineTo(gx + 2.5, gy - 2.5); c.moveTo(gx, gy - 2.5); c.lineTo(gx, gy + 2.5); }
  -          else if (kind === 2) { c.moveTo(gx - 3, gy + 2); c.lineTo(gx - 1, gy - 2); c.lineTo(gx + 1, gy + 2); c.lineTo(gx + 3, gy - 2); }
  +          else if (kind === 1) { c.moveTo(gx - 3, gy); c.quadraticCurveTo(gx, gy - 3, gx + 3, gy); c.quadraticCurveTo(gx, gy + 3, gx - 3, gy); c.moveTo(gx + 0.8, gy); c.arc(gx, gy, 0.8, 0, Math.PI * 2); }
  +          else if (kind === 2) { c.moveTo(gx - 3, gy + 2.5); c.lineTo(gx - 3, gy + 0.5); c.lineTo(gx - 1, gy + 0.5); c.lineTo(gx - 1, gy - 1.5); c.lineTo(gx + 1, gy - 1.5); c.lineTo(gx + 1, gy + 0.5); c.lineTo(gx + 3, gy + 0.5); c.lineTo(gx + 3, gy + 2.5); }
  ```
- **Resolution (FIX-2):** glyph kinds 1 / 2 replaced by an eye and a stepped pyramid.

### 7. MINOR (art): the level-select thumbnail draws TEMPLE's water navy instead of teal

- **Where:** `src/levelselect.js` `paletteFor`. TEMPLE's theme has `water: true` (a boolean) and
  no `pit`, so the thumbnail falls back to `#0e2c44`. The card shows blue canals, while the level
  has teal water (`waterDeep #123f3a`, `waterLight #3fd6a8`).
- **Fix:**

  ```
  -  const pit = parseHex(th.pit) ? th.pit : parseHex(th.water) ? th.water : '#0e2c44';
  +  const pit = parseHex(th.pit) ? th.pit : parseHex(th.water) ? th.water
  +    : parseHex(th.waterDeep) ? mixHex(th.waterDeep, parseHex(th.waterLight) ? th.waterLight : '#3fd6a8', 0.25) : '#0e2c44';
  ```

  OUTPOST is unchanged (it has no `waterDeep`).
- **Resolution (FIX-2):** applied in `levelselect.js` (`waterDeep` mixed with `waterLight`: teal channels).

### 8. NOTE (design): bridges and chokepoints are fun, not unfair; the south bridge is a pincer

I held a position for 60 s at round 8 (god mode on, counting zombies within 110 px on each side
of the player):

| Position | Frames with zombies on both sides | Frames with any zombie nearby |
|----------|-----------------------------------|-------------------------------|
| North bridge (29,17) | 10 / 3600 | 206 |
| South bridge (29,24, island side of G) | **2789 / 3600** | 2928 |

The south bridge is a real pincer: courtyard zombies come over G, and the island's two open spawns
O (24,19) and (35,19) sit about 5 tiles from the box.

With god mode off and a stationary bot:
- At round 8, damage per 40 s was 250 on the bridges, 100 on the courtyard terrace, 50 on the west
  canal bridge and 0 at the gate. No downs.
- At round 14, every spot, open or bridge, was lethal within 10-15 s.

So a bridge is not a death trap compared with open ground. You can always step back onto the
island (5 rows × 16 cols).

The canal bridges lead to dead-end upper terraces (N, E, F) that have no spawns inside, so zombies
only come from the south. That makes a clean one-lane firing line, which is the intended fun
choke. Zombies conga-line down the G bridge (`wo9-qa-temple-03-idol-bridge-conga.png`), which reads
very well.

No change needed.

### 9. NOTE: HUD overlaps world labels (applies to all levels)

- The status portrait (top left) hides the "PEACEKEEPER MK2" plate when the camera is at the
  courtyard (`wo9-qa-temple-01`).
- The points counter covers the south "MEGA DOOR 1500" plate when the camera is at the sanctum
  walk (`wo9-qa-temple-04`).
- The Double Tap plate shows under KILLS on the phone.

These are cosmetic and come from the camera position, not TEMPLE. The HUD prompt still shows the
right buy text. No TEMPLE fix needed. Also on `wo9-qa-temple-04`: the "PACK-A-PUNCH 500" plate at
(50,1) is clipped at the top edge because the camera is clamped to the map. It is still readable.

- **Resolution (WO9 FIX-4):** mitigated for all levels by the camera over-scroll (see KINO #4). Near a map edge, the camera can now move the edge content out from under the HUD corners. The PaP plate at the top edge is no longer clipped.

### 10. NOTE (balance and UX): a fresh-run teleport straight to L6 is brutal

At TEMPLE difficulty `{3.5, 1.26, 1.8, 11}`, on round 1:
- zombies have 525 HP;
- zombies hit for 50 (a 150-HP player dies in 3 hits);
- sprinters move at about 214 px/s against the player's 220.

A bot with the MR6, or with a bought KN-44 and no perks, went down in round 1-2 every time. With a
PaP'd gun and Jugg, rounds 1-4 at the gate were comfortable.

This only affects practice runs from the level select, which is fine and by design. Consider an
optional hint line on the card or overlay, for example "Tip: arriving without guns at L5-L6 is
very hard".

### 11. NOTE (art): boss colour

THE DROWNED KING reads as a grey brute with a teal face or chest plate. The `#3fd6a8` tint is
visible only on the markings (`wo9-qa-temple-07`). It matches the ring colour but not "drowned"
overall. Optional: tint the body darker teal. No acceptance impact.
- **Resolution (FIX-2):** THE DROWNED KING body is washed in its teal tint (mix 0.38).

---

## Look (art director, against WO9 1.4)

**Floor.** The mossy green-grey flagstones have cracks and moss blobs. This is unmistakably not
BUNKER, CATACOMBS, LAB, KINO or OUTPOST.

**Walls.** The carved sandstone ashlar with its glyph band reads well at both zooms (but see #6).
The vines hang from floor-facing edges and are nicely varied.

**Water.** The deep teal water has a stone lip, slow ripple strokes and occasional drip rings,
calm and deterministic (desktop `wo9-qa-temple-12`, phone `wo9-qa-temple-10`). The channels and the
pool frame the island strongly. This is the best-looking signature area of WO9.

**Spores.** They are subtle on desktop. On the phone at 1.96x they show as soft pale blobs, a bit
more visible but not distracting. OK.

**Ambient.** The green-gold tint is correct.

**Boss telegraph.** It is readable: a teal glow plus three tightening spiral arms, and the boss
stands still for 0.8 s (`wo9-qa-temple-05`). The ring's crest breaks at every pillar, and the
player sees the safe shadow (`wo9-qa-temple-06`). "Boss raises arms": the arms are spread in the
tide pose.

**Phone (844x390).** The visible world is about 653x367 px, so the whole arena height and most of
its width fit on screen. The boss stays on screen during the fight, and the touch sticks do not
hide anything critical.

## Frame cost and console

All numbers below are from a hidden tab, measured around `debug.step` (update + render + HUD).

**Boss + 10 minions + 24 zombies in the TEMPLE arena, 600 frames:**
- step: avg **0.80 ms**, p95 **0.90 ms**;
- render alone: avg 0.36 ms, p95 0.40 ms.

**Same load, player placed at each area:**

| Area | Step avg | Step p95 |
|------|----------|----------|
| Arena | 0.47 ms | 0.6 ms |
| Courtyard pool | 0.78 ms | 0.7 ms |
| North bridge | 0.71 ms | 1.0 ms |
| West cloister | 0.87 ms | 0.9 ms |
| Gate | 0.75 ms | 0.8 ms |

**Walking across the map with 35 zombies, 1898 frames:** avg 0.59 ms, p95 0.70 ms, p99 1.0 ms.
**All < 3 ms.**

**Spikes.** There are isolated spikes of 15-100 ms, about 1 per second. BUNKER shows the same thing
(3 spikes of 14-18 ms in 700 frames), so I put it down to the environment (hidden tab or GC), not
TEMPLE. Please re-check in a visible tab.

**Console.** 0 console errors or exceptions from the game across the desktop and touch runs (a full
TEMPLE route, boss fights, the descent, and the level select). `npm test`: **643 / 643 pass**.

## Section 5 (TEMPLE + loop descent)

| Item | Result |
|------|--------|
| TEMPLE passes the full validity suite; looks unmistakably different from every level | **PASS** (level6 tests green; see Look) |
| Water channels and bridges create chokepoints | **PASS** (4 two-wide bridges; G-bridge conga line; canal terraces as one-lane firing lines; #8) |
| Animated water | **PASS** (ripples and drip rings, deterministic from time) |
| THE DROWNED KING's tide ring can be outrun or blocked by walls | **PASS with caveats**: pillars block reliably (0 hits in 102 waves), outrunning only works near the arena ends (#3), reach circle under-reports by 28 px (#2). **The boss wedge (#1, MAJOR) should be fixed before sign-off.** |
| Boss fight winnable with god mode off | **PASS** (killed in 445 s; 300 damage taken; stairs opened) |
| Level select reaches TEMPLE: Shift+M + click on desktop; pause → LEVELS → tap on touch; practice run | **PASS** (banner "TELEPORTED — L6 TEMPLE"; `practice: true`; game over shows "PRACTICE RUN — NOT RANKED") |
| Difficulty rises L5 → L6 → loop | **PASS**: L6 `{3.5, 1.26, 1.8, 11}` → BUNKER II `{4.2, 1.2978, 1.98, 13}` |
| Descending from 6 leads to BUNKER II | **PASS** (real "Press F to descend" on T after the kill; level index 6 "BUNKER II", loop 1, HUD "L7 BUNKER II"; weapons, perks and round 6 kept; healed to full) |
| Zero console errors | **PASS** |
| Frame cost < 3 ms with boss + 10 minions + 24 zombies | **PASS** (avg 0.80, p95 0.90 ms) |
| `npm test` green | **PASS** (643/643) |

## Screenshots (`docs/screenshots/`)

- `wo9-qa-temple-01-arrival.png`: arrival at the Outer gate after the teleport (portrait over the
  Peacekeeper plate).
- `wo9-qa-temple-02-gate-round4.png`: round 4 at the gate.
- `wo9-qa-temple-03-idol-bridge-conga.png`: the idol (J + box) with zombies filing down the G
  bridge.
- `wo9-qa-temple-04-sanctum-pap-megadoor-label.png`: Pack-a-Punch in the sanctum; the MEGA DOOR
  plate under the points counter.
- `wo9-qa-temple-05-tide-telegraph.png`: tide telegraph (swirl and faint reach circle).
- `wo9-qa-temple-06-tide-ring-pillar-shadow.png`: the wave ring broken by the pillars, with the
  player in the shadow.
- `wo9-qa-temple-07-boss-wedged-east-inlet.png`: **#1**, the boss wedged between the pillar and the
  east inlet.
- `wo9-qa-temple-08-descent-bunker2.png`: arrival in BUNKER II after the descent.
- `wo9-qa-temple-09-mobile-gate-glyph-letters.png`: phone view of the gate (glyphs that read as
  letters, spores).
- `wo9-qa-temple-10-mobile-idol-bridge-water.png`: phone view of the idol, bridge and water.
- `wo9-qa-temple-11-mobile-boss-sealed-label-over-player.png`: **#5**, phone view of the boss wave
  with the SEALED plate over the player.
- `wo9-qa-temple-12-courtyard-bridges-desktop.png`: desktop view of the signature area (pool,
  island, bridges).
