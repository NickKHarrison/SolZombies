# WORK ORDER 4 — Natural feet, spread-out wall buys, buyable doors

Follow-up to WO3 (263 tests green). Three player-facing improvements:

1. **Feet.** The boots currently sit too far out to the sides and move oddly. They should tuck
   under the body, step naturally, and turn smoothly, so they add to the feel instead of
   distracting.
2. **Weapons spread out.** Too many wall buys are within reach at the start. The player should
   travel to find each gun. The start room gets one cheap gun; the rest are spread through the
   map, best guns farthest away.
3. **Buyable doors (BO3 style).** Some areas are sealed by doors the player opens with points.
   Closed doors block the player, zombies and bullets. Zombies only spawn in areas the player
   has opened.

**4 parallel agents in Phase 1, 1 integrator, then verification.** House rules from WO1–WO3 apply
(one file one owner, targeted edits on shared files, `npm test` = `node --test "tests/*.test.js"`,
`node --check`, browser check with the Chrome tools on your own port, stop server, close tab, no
git, no questions).

---

## 1. Ownership

| Agent | Owns                                                                                          |
|-------|-----------------------------------------------------------------------------------------------|
| A     | `src/sprites/soldier.js`, `src/sprites/animator.js`, `tests/animator.test.js`, `tests/sprites.test.js` (legs assertions only), `SPRITES` block of `src/config.js`, `docs/notes/soldier.md`, `docs/notes/animator.md` |
| B     | `src/map.js`, `tests/map.test.js`, `docs/notes/map.md`                                          |
| C     | `src/shop.js`, `src/waves.js`, `tests/shop.test.js`, `tests/waves.test.js`, `docs/notes/shop.md`, `docs/notes/waves.md` |
| D     | `src/render.js`, `src/audio.js`, `docs/notes/render.md`, `docs/notes/audio.md`                  |
| INT   | `src/main.js`, `tests/contracts.test.js`, any file for integration fixes, `docs/notes/integration-wo4.md`, `README.md`, `WORK_ORDER.md` §7/§9 door sentences |

`pathfinding.js`, `zombie.js`, `player.js`, `hud.js`, `weapons.js`, `powerups.js` need no change:
closed doors are a tile code that is simply not walkable, and the door prompt reuses the existing
prompt shape.

---

## 2. Contracts

### 2.1 Doors (map.js, Agent B)

- New tile code `export const TILE_DOOR = 7` (closed door). Blocks player, zombies and rays,
  exactly like a wall, for `isWalkable`, `resolveCircle`, `raycastWalls`. Not zombie-walkable for
  pathfinding either (pathfinding treats only codes 0, 2, 3, 6 as walkable, so nothing to do
  there). **Opening a door sets its tiles to `TILE_FLOOR` (0).**
- ASCII legend additions: uppercase `D E F G H` are door tiles. All tiles of one letter must form
  one 4-connected group = one door. Costs: `export const DOOR_MAP = { D: 75, E: 100, F: 100,
  G: 125, H: 150 }` (BO3 prices ÷ 10, same scale as wall buys).
- Map object additions:
  ```js
  doors: [{ id /* 1.. in legend order D,E,... */, letter, cost, open: false,
            tiles: [{ tx, ty }], x, y, w, h /* bounding box in world px */,
            cx, cy /* centre */, axis: 'h' | 'v' /* doorway runs along x or y */ }],
  version: 0,                 // increments on every door open (render static-layer cache key)
  activeSpawnIds: Set<number> // spawn points reachable from the player start right now
  ```
- `export function openDoor(map, doorId) -> boolean` — false if unknown/already open. Sets tiles
  to 0, `open = true`, `map.version++`, then `recomputeActiveSpawns(map)`. Emits nothing (shop
  emits `purchase:made`).
- `export function recomputeActiveSpawns(map)` — BFS from the player start tile over tiles
  walkable for zombies **with windows treated as passable regardless of boards** (so pockets of
  open zones are reached) and closed doors blocking. `activeSpawnIds` = ids of spawn points whose
  tile was reached. Called by `loadMap` and `openDoor`.
- `export function isSpawnActive(map, spawnPointId) -> boolean` — true when `map.activeSpawnIds`
  is missing (fake maps in tests) or contains the id.
- `nearestInteractable` gains `{ kind: 'door', ref: door, dist }` for **closed** doors, distance
  to the nearest edge of the door's bounding box, same range rules as wall buys.
- `map.walls` still holds only code-1 tiles; render draws door tiles itself.

### 2.2 New map layout (Agent B)

Redesign `MAP_ASCII` (still 60×40, same legend otherwise, same `WALLBUY_MAP`). Requirements:

- **Start room ("Hub")**: player start, **exactly one wall buy** (Sheiva `1`, on the far wall
  from the start so the player has to cross the room), 2 windows, **no box**. Two doors lead out:
  `D` (75) and `E` (100).
- **Zones behind doors**, roughly in the order a player will open them, each with **at most two
  wall buys, at least 8 tiles apart**, and 1–3 spawn points (windows or open spawns):
  - behind `D`: corridor zone — RK5 `2` or L-CAR 9 `a` (cheap), 2 windows or 1 window + 1 open spawn
  - behind `E`: courtyard zone — KRM-262 `3` and Kuda `4` far apart, 2 windows
  - behind `F` (100, from the corridor): bunker zone — VMP `5` / HVK-30 `8`, 2 windows
  - behind `G` (125, from the courtyard or bunker): power/armory zone — KN-44 `7`, Argus `9`,
    **the mystery box `B`**, 1 window + 1 open spawn
  - behind `H` (150, deepest): vault — ICR-1 `c` or Bootlegger `d`, 1 window
  - Use at most 10 wall buys total and all 8 windows + 2 open spawns (10 spawn points) so the
    existing tests' counts still hold (update counts in tests if you change them, and say so).
- Doorways are 2–3 tiles wide; every door group is one straight run of tiles.
- **Validity tests** (`tests/map.test.js`, replace the old "every spawn reaches start" tests):
  - parse OK, every `W` has exactly one adjacent `S`, no pocket reachable by the player;
  - with **all doors open**, every spawn point, wall buy, box and barricade is reachable from the
    start; with **all doors closed**, `activeSpawnIds` is non-empty and contains only hub spawns;
    opening doors in order D→E→F→G→H only ever grows the set and ends with all 10;
  - the hub contains exactly one wall buy; no two wall buys are closer than 8 tiles (Manhattan);
  - the box is not reachable until at least two doors are open;
  - `openDoor` sets tiles to floor, bumps `version`, returns false on a repeat;
  - `nearestInteractable` returns a closed door and stops returning it once open;
  - closed door blocks `raycastWalls` and `resolveCircle` for both movers; opened door does not.

### 2.3 Shop and waves (Agent C)

- `shop.js`: prompt for `hit.kind === 'door'`:
  `{ kind: 'door', doorId, text: "Press F to open door [75]", cost, canAfford, blocked: false }`.
  Interact → `buyDoor(state, door)` (new export): `spendPoints` then `map.openDoor`; emit
  `purchase:made { kind: 'door', id: doorId, cost }` or `purchase:denied { kind: 'door', cost, have }`.
  Also add a small floating text effect `{ type: 'text', text: 'DOOR OPENED', ... }` at the door
  centre via `state.effects` push (render already draws `text`).
- `waves.js`: `pickSpawnPoint` only considers spawn points where `map.isSpawnActive(state.map,
  sp.id)`; if that filters everything out (should not happen), fall back to all points. Import
  `isSpawnActive` from `./map.js` (pure module; fine in Node). Fake maps without
  `activeSpawnIds` keep working.
- Tests: door prompt text/canAfford, buyDoor deducts and opens (use the real `loadMap()`),
  denied when broke, waves picks only active spawns with a fake `activeSpawnIds`.

### 2.4 Render and audio (Agent D)

- Static layer cache key must include `map.version` so opened doors repaint. Draw closed door
  tiles in the static layer: heavy dark wooden planks with iron bands (or a steel shutter) across
  the doorway, oriented by `door.axis`, with a chalk-style label plate like the wall buys reading
  `OPEN DOOR` / `75` placed on **both** sides of the door (the player may approach from either
  side once loops open). Open doors draw as floor (nothing).
- Subscribe to `purchase:made` with `kind === 'door'`: push a short dust/debris burst effect at
  the door centre (`type: 'doorOpen'`, ttl 0.6, a dozen grey specks + a light flash) and a small
  shake (magnitude 3). Must be re-init safe like the other render listeners.
- `audio.js`: `purchase:made` kind `door` → heavy wooden creak (band-passed noise with a slow
  pitch fall) followed by a metallic clank ~0.35 s later. Keep it under the gun bus in loudness.
- Verify visually at `/?debug=1`: closed doors readable at game scale, label legible, opening
  repaints correctly (use `__game.debug.addPoints(1000)` then walk/teleport to a door and press
  F via a real key or `__game.debug.step` with an injected interact if available; otherwise call
  `window.__game.state` + `shop.buyDoor` through a debug hook the integrator will add — coordinate
  by simply calling `map.openDoor` from the console for the visual check).

### 2.5 Feet and gait (Agent A)

Goal: boots tucked under the body, natural stepping, smooth turning. Concretely:

- **Lanes**: boots ~4.5–5.5 sprite px either side of the centre line (shoulder half-width is 7),
  not 7.5. To keep them visible, slim the lower/rear rows of the torso silhouette (the region
  behind the shoulders) by 1–2 px per side and keep the boot art high-contrast (dark leather `K`
  with a light `W` toe/heel highlight and a 1-px `o` trouser cuff). Boots must still be visible
  in the live 1x game view in every frame while walking (front boot ahead of the body, rear boot
  behind), but should barely protrude sideways.
- **Cycle**: 8 frames as a proper gait: contact (front foot planted, rear foot lifted), down,
  passing (feet under body, slight body dip = sway 0), up, then mirrored. Stride ±5 px.
  `SPRITES.strideLength` retuned so the planted foot does not slide (measure: at walk speed 220
  world px/s the cycle should take ~0.45 s → strideLength ≈ 100 world px ≈ 50 sprite px per
  full cycle; pick the value that makes the planted boot stationary in the preview's live strip).
- **Turning** (animator.js): `legAngle` turns toward its target along the shortest arc at a
  capped rate (e.g. 900°/s) instead of snapping. **Backpedal/strafe rule**: when the movement
  direction is more than 100° away from the aim, legs face `movement + 180°` and the cycle runs
  **backwards** (so the soldier backpedals instead of moonwalking or flipping). Between 80° and
  100° use hysteresis so it does not flicker. Standing still: legs ease to the aim angle.
- Update `tests/animator.test.js` (turn rate, backpedal reversal, hysteresis) and the legs
  assertions in `tests/sprites.test.js` (lanes within ±6, boots visible front/back in every frame,
  8 frames, sizes). Keep all other tests untouched.
- Verify in `tools/sprite-preview.html` (live strip) **and** in game at `/?debug=1`: walk in 8
  directions, strafe while aiming, backpedal. Screenshot.

---

## 3. Integration and acceptance (Integrator, then verify)

- `main.js` debug hooks: `openDoor(id)`, `openAllDoors()`, `doors()` (list with open state).
- Update `tests/contracts.test.js` if it enumerates map exports or `purchase:made` kinds.
- Update `README.md` (doors, `F` opens doors), `WORK_ORDER.md` §7/§9 (doors are now in).
- Acceptance, checked in the browser:
  - [ ] At start only one wall buy is reachable; all other guns and the box are behind doors.
  - [ ] Round 1 zombies spawn only from hub spawn points; after opening D, corridor spawns join.
  - [ ] Closed doors block the player, zombies and bullets; a door costs its listed price; too few
        points → denied; opening repaints the map, plays the creak, shows dust and DOOR OPENED.
  - [ ] Every door can be opened and every wall buy/box reached with all doors open; no soft-lock
        (a round still ends with zombies in any opened zone).
  - [ ] Feet: boots tucked under the body, no sideways protrusion beyond ~1 px, natural gait,
        smooth turns, correct backpedal; planted foot does not slide at walk speed.
  - [ ] `npm test` green; zero console errors menu → open 2 doors → round 3 → death → restart;
        frame cost still < 3 ms with 24 zombies.
