# Integration notes -- WORK_ORDER_4 (feet, spread wall buys, buyable doors)

Integrator, Section 3. Phase 1 arrived green (286/286); still 286/286 after integration
(`npm test`), `node --check src/main.js` OK.

## Changes made
- `src/main.js` debug hooks (`?debug=1`): `openDoor(id)` (free, bypasses the shop, clears
  `state.flow` so the flow field rebuilds next frame), `openAllDoors()` (returns how many opened),
  `doors()` -> `[{ id, letter, cost, open }]`. Existing hooks unchanged. `debug.step(seconds,
  frameDt, inp)` already merged `inp` over the live input on every frame, so
  `step(1/60, 1/60, { interact: true })` next to a door buys it through the real
  `shop.updateShop -> buyDoor` path (verified below). No change needed there.
- `tests/contracts.test.js`: map exports `TILE_DOOR` (number), `DOOR_MAP`, `openDoor`,
  `recomputeActiveSpawns`, `isSpawnActive`; `shop.buyDoor`; `waves.spawnPointActive`. The event-name
  check stays green (`purchase:made` with `kind: 'door'` is not a new event).
- `README.md`: doors paragraph (F opens a door for points, zones unlock progressively, box two
  doors deep), controls row, new debug hooks. `WORK_ORDER.md` §7 and §9: one-line note that WO4
  added buyable doors.
- No integration fixes were needed in any Phase 1 file.

## Browser verification (http://localhost:8140/?debug=1, Chrome, 1280x720 canvas)

| # | Acceptance item | Result | Evidence |
|---|-----------------|--------|----------|
| 1 | At start only one wall buy reachable; other guns + box behind doors | PASS | Player-walkable BFS from start: wall buys reachable = `[sheiva]`, box unreachable, adjacent closed doors = D, E. `wo4-hub-start.png` |
| 2 | Round 1 spawns only from hub spawns | PASS | 40 s of round 1 (god mode): every zombie's `spawnPointId` in {3, 5}; `activeSpawnIds` = {3, 5} |
| 3 | After opening D, corridor spawns join | PASS | D bought via real shop path -> `activeSpawnIds` {2, 3, 5, 9}; after E {2,3,4,5,7,9}; F adds 1; G adds 8, 10. Rounds 1-3 with D+E open used only {2,3,5,7,9} |
| 4 | Closed door blocks player | PASS | Walking north into D from the hub: player stops at y = 614 (door edge 600 + radius 14) |
| 5 | Closed door blocks zombies | PASS | Zombie spawned in the armory (spawn 10) chasing the player through closed G: min x = 814 (door edge 800 + radius), never crossed in 4 s |
| 6 | Closed door blocks bullets | PASS | 13 MR6 shots at that zombie through closed G: 0 hits, hp 150/150. Control after opening G: 2 hits, hp 150 -> 50 |
| 7 | Door costs its listed price | PASS | Prompt `Press F to open door [75]` / `[100]`; 80 -> 5 points after D, 125 -> 25 after E, 125 -> 25 after F |
| 8 | Too few points -> denied | PASS | 0 points + interact at D: `purchase:denied {kind:'door', cost:75, have:0}`, door stays closed, no charge |
| 9 | Opening repaints, creak, dust, DOOR OPENED | PASS | `map.version` 0 -> 1, door tiles drawn as floor next frame; effects `text:DOOR OPENED`, `doorOpen` (ttl 0.6), `shake`; audio node spy during a purchase: 5 oscillators + 3 filtered noise sources (exactly the `door` SFX recipe). `wo4-door-open-dust.png` |
| 10 | Every door openable, every wall buy + box reachable with all open | PASS | `openAllDoors()` = 5; BFS reaches all 10 wall buys and the box; `activeSpawnIds` has all 10 |
| 11 | No soft-lock: rounds still end | PASS | All doors open, 2 zombies at each of the 10 spawns all reached the player (max 31.7 s, from the vault). Rounds 1-3 with all doors open ended normally (zombies killed on contact), no zombie left stuck |
| 12 | Labels (wall-buy chalk plates, door plates) don't overlap each other or windows | PASS | Screenshotted hub, corridor north + east hall, bunker, courtyard, armory, vault: no overlaps. Door plates sit on both sides of each door. Note: plates of wall buys in closed zones are visible through the dark void (e.g. KRM-262 from the hub), same as before WO4; at some camera positions the bottom-left HUD covers a plate (camera-dependent, not a layout overlap) |
| 13 | Feet: tucked under body, natural gait, smooth turns, correct backpedal | PASS (with notes) | `wo4-feet-sheet.png` (8 directions, strafe both ways, backpedal, idle; 5 phases each, 1.5x of game pixels), `wo4-feet-turns.png` (per-frame E->N, E->W, N->backpedal S). See judgement below |
| 14 | Planted foot does not slide | PASS (by construction) | `SPRITES.strideLength` = 80: 10 world px per frame = one 5-px boot step at scale 2 (soldier.md WO4). Not measured pixel-by-pixel in game |
| 15 | `npm test` green | PASS | 286/286 |
| 16 | Zero console errors: menu -> open 2 doors -> round 3 -> death -> restart | PASS | Fresh load, Enter to start, D and E bought via interact, rounds to 3, `setHealth(0)` -> `gameover`, Enter -> `playing`, round 0 again with all doors closed (repainted closed, version 0). Console: no messages at all |
| 17 | Frame cost < 3 ms with 24 zombies | PASS | 28 live chasing zombies, D+E open, 3 x 300 steps (update + render): 0.22-0.25 ms per step |

### Feet judgement (honest)
- At game scale (1x) the boots are small dark nubs just ahead of and behind the torso; they
  barely leave the silhouette sideways (at most ~1 sprite px at the lane edge when walking N/S
  and E/W). Straight-line walking reads as alternating front/back steps with passing frames where
  the boots are hidden under the body. Good.
- Turning: legs rotate over ~4-6 frames (90 deg) / ~8-10 frames (180 deg) while the aim snaps; during
  those frames the trailing boot sticks out to the side by 2-3 px, which is expected with a capped
  turn rate and reads as a pivot, not a glitch.
- Backpedal (move S, aim N): legs keep facing N and the cycle runs backwards, no flip or
  moonwalk. Strafe (90 deg off aim) keeps legs within the hysteresis band without flicker in the
  sampled frames.
- Weak point: the boots are low-contrast against the dark floor; the light `W` toe/heel highlight
  is only visible in some frames. Acceptable, but the first thing to tune if players still say
  "I can't see the feet".

## Minor observations (not fixed; outside Section 3 scope)
- The start menu's controls list still says "F / E: Buy / Interact (hold to rebuild)"; doors are
  covered by the in-game prompt `Press F to open door [75]` and by README.
- Door stickers of closed zones and wall-buy plates are drawn across the void, so a player can
  see (not reach) guns in unopened zones. This is a teaser rather than a bug.

## Screenshots
- `docs/screenshots/wo4-hub-start.png` -- hub at start: single Sheiva wall buy, closed doors D (75) and E (100) with plates on both sides
- `docs/screenshots/wo4-door-label.png` -- close-up of door F planks with `OPEN DOOR / 100` plates on both sides
- `docs/screenshots/wo4-door-open-dust.png` -- D and E just opened: dust specks, flash, DOOR OPENED text, repainted floor
- `docs/screenshots/wo4-feet-sheet.png` -- feet sheet: 8 directions, strafe, backpedal, idle
- `docs/screenshots/wo4-feet-turns.png` -- per-frame turn strips (E->N, E->W, N->backpedal)
- `docs/screenshots/wo4-armory-box.png` -- armory: KN-44, Argus, mystery box, closed door H
