# WORK ORDER 9 — Three new levels (incl. a Kino der Toten homage) and a level-select menu

Current state: WO8 complete (552 tests green, live on GitHub Pages). This order adds **levels 4, 5
and 6** with layouts and looks that are vastly different from each other and from levels 1–3, and
a **level-select menu on Shift+M** that lists every level and teleports the player to it.

**Phase 0: 1 scaffold agent. Phase 1: 9 parallel agents (A–I). Phase 2: integrator. Phase 3: 3 QA
agents (one per new level, playtest + look). Phase 4: fixes + final verification.**

House rules from WO1–WO8 apply: one file one owner (Section 2), targeted edits on shared files,
siblings imported as namespaces and guarded, pure modules never touch the DOM, `state.rng` only,
palette-only art, `npm test` = `node --test "tests/*.test.js"`, `node --check`, browser checks on
your own port with `?debug=1` (`&touch=1` for touch) via `__game.debug.step(dt, dt, overrides)`,
stop servers, close tabs, **no git**, no questions, append a "WO9" section to your
`docs/notes/<module>.md`.

---

## 1. Design

### 1.1 Progression

Levels become `[BUNKER, CATACOMBS, LABORATORY, KINO, OUTPOST, TEMPLE]`. Descending from level 3
now leads to level 4; the endless loop starts after level 6 (loop 1 = BUNKER II, …). Every level
keeps the house rules: five doors `D–H` gating six zones with no door-less links between zones,
one wall buy in the start room, ≥ 8 tiles between wall buys, box behind ≥ 2 doors, 8 windows + 2
open spawns, the six perk machines (Q in the start zone, K deepest), one Pack-a-Punch `A` in the
deepest zone, arena behind the mega door `M` with `Z`, 4–6 `X`, stairs `T`, 60×40.

Difficulty must keep rising (level 3 is `{2.0, 1.2, 1.5, 5}`):

| Level | healthMult | speedMult | countMult | sprintShift |
|-------|-----------|-----------|-----------|-------------|
| 4 KINO | 2.4 | 1.22 | 1.6 | 7 |
| 5 OUTPOST | 2.9 | 1.24 | 1.7 | 9 |
| 6 TEMPLE | 3.5 | 1.26 | 1.8 | 11 |

Wall buys: levels 4–6 sell tier-3 guns (hg40, m8a7, peacekeeper) plus tier-2 (gorgon, drakon,
manowar, marshal16), with one cheaper gun in each start room. Mega door price continues the
per-level rule (1000 / 1250 / 1500).

### 1.2 Level 4 — KINO (homage to Kino der Toten)

Recreate the **feel and flow** of the Kino der Toten theatre map in our top-down grid; our
layout is original, rooms get generic names, and no map geometry, text or art is copied from the
game. Flow:

- **Lobby (start):** a grand entrance hall with a central ticket booth (decor block), two
  staircases shown as stepped floor, cheap wall gun, Quick Revive, 2 windows. Two doors out.
- **Foyer (door D):** the upper lobby ring above the entrance, with balcony railings (decor),
  a Double Tap machine, a wall gun.
- **Dressing rooms (door E):** a row of small dressing rooms with mirrors and costume racks off a
  narrow backstage corridor; Speed Cola; the mystery box's first location.
- **Alley (door F):** an outdoor strip behind the theatre, brick walls, trash bins, a fire escape;
  1 window + 1 open spawn; Stamin-Up.
- **Theatre (door G):** the big auditorium: long rows of seats (decor rows with aisles between
  them, zombies and the player move along the aisles), balcony boxes, and the **stage** at the
  far end with **Pack-a-Punch standing centre-stage**; Juggernog.
- **Projection room (door H, deepest):** a narrow room above the back of the auditorium with a
  film projector (decor) and Mule Kick; the mega door `M` leads from here to the arena.
- **Arena "Backstage vault":** a wide hall of stacked scenery flats and prop crates (2–4 pillar
  clusters); boss **THE PROJECTIONIST** (tint `#d9b25a`, ability `charge`).
- **Look (theme `KINO`):** deep red carpet with a gold diamond pattern for floor/floorAlt, dark
  wood-panelled walls with gold trim, red velvet curtain tiles along the stage edge, warm
  lamp-light glows (like torches, amber-white), a faint film-grain overlay (subtle, static
  noise, not flickering), seat rows drawn as dark red seat backs.

### 1.3 Level 5 — OUTPOST (arctic research outpost)

Vastly different from the corridors of 1–4: a **wide open snowfield** with scattered small
buildings and fences, where zones are separated by chain-link fences with gates (doors), frozen
lake holes and rock ridges. Most combat happens outdoors in the open.

- New tile **ice hole / chasm** `~` (see 3.2): blocks movement for everyone but not bullets or
  sight, so the open field has line-of-sight across impassable holes.
- Zones: Landing pad (start), Barracks huts, Radar array, Fuel depot, Greenhouse dome, Command
  bunker (deepest) → arena "Ice cavern".
- Boss **THE WENDIGO** (tint `#bfe8ff`, ability `frost`): every 6 s a 0.6 s telegraph, then a
  frost-breath cone (range 260, half-angle 0.5) that deals 30 damage and **slows the player to
  55 % speed for 2 s**; charge-free.
- **Look (theme `OUTPOST`):** white-blue snow floor with drift speckles, grey-blue rock ridges,
  wooden hut walls, orange hazard fences; a light **snowfall overlay** (drifting particles,
  screen space, respects reduced motion by thinning to static flakes); cold blue ambient tint.

### 1.4 Level 6 — TEMPLE (sunken jungle temple)

Vastly different again: a **symmetric ring-and-cross ruin** built around a central flooded
courtyard, with water channels (`~`, impassable, see-through) crossed by narrow stone bridges,
creating chokepoints and long sight-lines over water.

- Zones: Outer gate (start), East cloister, West cloister, Sunken courtyard (bridges over water),
  Idol hall, Inner sanctum (deepest) → arena "Flooded pit".
- Boss **THE DROWNED KING** (tint `#3fd6a8`, ability `tide`): every 7 s a 0.8 s telegraph (boss
  raises arms, water swirls), then an expanding ring wave from the boss (speed 320 px/s, radius
  up to 420, 40 damage + 120 px knockback on contact) that the player must outrun or put a
  pillar between (walls block the wave per ray check from the boss).
- **Look (theme `TEMPLE`):** mossy green-grey flagstone floor with cracks, carved sandstone walls
  with glyph bands, animated water tiles (slow ripple, deterministic from time), hanging vines as
  wall-edge decor, green-gold ambient tint, drifting spores (very subtle).

### 1.5 Level select (Shift+M)

- **Shift+M** toggles a full-screen level-select overlay; the game pauses while it is open
  (phase `levelselect`, restored on close). `Esc` or Shift+M again closes it. On touch, the pause
  screen gains a **LEVELS** button that opens the same overlay.
- The overlay lists every authored level as a card: number, name, a small **mini-map thumbnail**
  generated from the level's ASCII (walls, floor, doors, windows coloured by the level's theme),
  the boss name, and the difficulty row. The current level is highlighted. Keyboard: arrow keys /
  1–6 to select, Enter to teleport; mouse/touch: tap a card.
- **Teleport** = `level.startLevel(state, index)` (fresh level: doors closed, box idle, round
  counter kept, player keeps weapons/points/perks, arrival heal + break as for a descent), then
  close the overlay and resume. A short banner "TELEPORTED — L5 OUTPOST".
- **Practice flag:** once any teleport happens in a run, `state.stats.practice = true`; the
  game-over screen shows "PRACTICE RUN — NOT RANKED" and `scores.recordRun` is skipped. (This
  keeps the high-score table honest; the menu still works as a free level browser.)

---

## 2. Ownership (Phase 1 runs A–I at once)

| Agent | Owns |
|-------|------|
| 0 | `src/levels/level4.js`, `level5.js`, `level6.js` (stubs = copies of level 3 with the new id/name/theme/boss/difficulty), `src/levels/levels.js` (register all six), `tests/helpers/levelcheck.js` (the validity suite **extracted** from `tests/levels.test.js` into an importable module; `tests/levels.test.js` updated to import it), `src/config.js` (`LEVEL_SELECT` block, `BOSS.frost`, `BOSS.tide`, `DOORS` unchanged), `src/state.js` (`stats.practice`, `player.slowT` default via note), `tests/contracts.test.js` (new events, `WO9 new exports`), `docs/notes/wo9-scaffold.md` |
| A | `src/levels/level4.js`, `tests/level4.test.js`, `docs/notes/level4.md` — KINO layout + theme data |
| B | `src/levels/level5.js`, `tests/level5.test.js`, `docs/notes/level5.md` — OUTPOST layout + theme data |
| C | `src/levels/level6.js`, `tests/level6.test.js`, `docs/notes/level6.md` — TEMPLE layout + theme data |
| D | `src/map.js`, `tests/map.test.js`, `docs/notes/map.md` — `TILE_PIT` (`~`) |
| E | `src/boss.js`, `src/zombie.js`, `src/player.js`, `tests/boss.test.js`, `tests/zombie.test.js`, `tests/player.test.js`, `docs/notes/boss.md`, `zombie.md`, `player.md` — `frost` and `tide` abilities, player slow |
| F | `src/render.js`, `docs/notes/render.md` — KINO / OUTPOST / TEMPLE styles, pit/water/ice tiles, overlays, frost cone, tide ring, new boss looks via tint |
| G | `src/levelselect.js` (new, DOM, self-contained incl. its own injected `<style>`), `src/input.js`, `src/touch.js`, `docs/notes/levelselect.md`, `input.md`, `touch.md` — overlay, thumbnails, Shift+M, touch LEVELS button hook |
| H | `src/audio.js`, `docs/notes/audio.md` — per-level ambience (theatre organ drone + projector clatter, wind howl, dripping water + distant drums), frost breath, tide roar, teleport whoosh |
| I | `src/hud.js`, `styles.css`, `docs/notes/hud.md` — pause-screen LEVELS button (touch and desktop), "PRACTICE RUN — NOT RANKED" on game over, slow-status indicator (frost icon near HEALTH) |
| INT | `src/main.js`, `src/level.js`, `src/scores.js`, `README.md`, any file for integration fixes, `docs/notes/integration-wo9.md` |
| QA | `docs/qa/wo9-*.md` only |

A, B and C never touch `tests/levels.test.js`; they import `tests/helpers/levelcheck.js` (frozen
after Phase 0) and add level-specific assertions in their own test files.

---

## 3. Contracts

### 3.1 Config and state (Phase 0)

```js
export const LEVEL_SELECT = { key: 'KeyM', requireShift: true, thumbScale: 3, bannerSeconds: 2.5 };
// BOSS gains:
//   frost: { every: 6, telegraph: 0.6, range: 260, halfAngle: 0.5, damage: 30, slowMult: 0.55, slowSeconds: 2 }
//   tide:  { every: 7, telegraph: 0.8, speed: 320, maxRadius: 420, damage: 40, knockback: 120, band: 28 }
// state.js: stats.practice = false; player.slowT = 0 is added by player.createPlayer (Agent E).
```

### 3.2 Map (D)

```js
export const TILE_PIT = 12;   // '~' ice hole / water channel: blocks movers (player, zombies, pathfinding), does NOT block rays or line of sight
// isWalkable -> false for both movers; resolveCircle treats it as solid; raycastWalls passes through;
// pathfinding already treats unknown codes as blocked; arena/active-spawn BFS treat it as solid.
// Render draws pits per theme (F). Test with inline fixtures (a pit you can shoot across but not walk across).
```

### 3.3 Bosses and player (E)

```js
// levelDef.boss.ability: 'charge' | 'acid' | 'frost' | 'tide' (unknown -> 'charge')
// frost: z.frost = { timer, phase: 'idle'|'telegraph'|'breath', t, angle } ; breath lasts 0.35 s; player inside cone (edge distance, LOS)
//   -> player.damagePlayer(BOSS.frost.damage) + player.slowT = max(slowT, slowSeconds); emits boss:frost { x, y, angle } at telegraph start
// tide: z.tide = { timer, phase: 'idle'|'telegraph'|'wave', t, radius } ; wave radius grows at speed to maxRadius; the player is hit once
//   per wave when |dist - radius| < band and a ray from the boss to the player is not blocked by walls -> damage + knockback (resolveCircle);
//   emits boss:tide { x, y } at telegraph start
// player.js: player.slowT counts down; movement speed x BOSS.frost.slowMult while slowT > 0 (stacks multiplicatively with Stamin-Up)
// Downed/invulnerable rules as for other attacks. Tests for both abilities + slow.
```

### 3.4 Level select (G)

```js
// levelselect.js (DOM)
export function initLevelSelect(rootEl, opts)   // opts: { levels: LEVELS, onPick(index), onClose() } ; idempotent
export function openLevelSelect(state)          // builds/refreshes cards (current level highlighted), focuses
export function closeLevelSelect()
export function isLevelSelectOpen()
export function levelThumbnail(levelDef, scale) // -> HTMLCanvasElement (cached per level id); pure-ish, used by cards
// input.js: getInput().levelSelect edge on Shift+KeyM (never fires on plain M); while the overlay is open, gameplay input is ignored by main.
// touch.js: export function onLevelsButton(cb) — hud (I) renders the LEVELS button in the pause screen; touch forwards its tap.
// Events: levelselect:open {}, levelselect:close {}, level:teleport { from, to }
```

### 3.5 Integration (INT)

```js
// main.js: inp.levelSelect toggles phase 'levelselect' (from 'playing' or 'paused'; stores the previous phase), calls openLevelSelect / close;
//   onPick(i): level.teleportTo(state, i) -> close -> phase 'playing'; stats.practice = true; emit level:teleport; banner via hud queue.
// level.js: export function teleportTo(state, index) — startLevel with arrival relief; clears a gun in the Pack-a-Punch as on descent.
// scores: skip recordRun when stats.practice; game-over summary gets practice: true.
// Descending from level 6 -> loop 1 (level index 6 = BUNKER II) keeps working (LEVELS.length-driven).
```

---

## 4. Phases

- **Phase 0 (1 agent):** stubs, registry, extracted level checker, config, state, contracts.
  `npm test` green except `WO9 new exports`.
- **Phase 1 (9 agents A–I in parallel).** A, B and C design their maps against the extracted
  checker and iterate the look with F's renderer (F builds against the stub themes and each
  level's final theme object as it lands). Every map must be validated by `levelcheck.js` and look
  right in the browser at desktop and mobile zoom.
- **Phase 2 (Integrator):** wire level select, teleport, practice flag, loop after level 6,
  README; full browser run: Shift+M on desktop, LEVELS on touch, teleport to each level, play a
  round on each, reach each new boss (hooks allowed), descend 3→4→5→6→BUNKER II.
- **Phase 3 (QA ×3, one per new level):** playtest + art direction for that level (layout
  readability, chokepoints, flow, look, overlays, boss fairness), plus level-select checks.
- **Phase 4:** fixes by file group; final verification with screenshots
  `docs/screenshots/wo9-*.png` (each level's start room, signature area — Kino stage with
  Pack-a-Punch, Outpost snowfield, Temple bridges —, each boss, the level-select overlay on
  desktop and phone).

## 5. Acceptance

- [ ] Six levels in order; 4, 5 and 6 each pass the full validity suite and look unmistakably
      different from every other level.
- [ ] KINO reads as the theatre homage: lobby start, foyer, dressing rooms, alley, auditorium with
      seat rows and aisles, Pack-a-Punch centre-stage, projection room, red-and-gold look.
- [ ] OUTPOST plays in the open with see-through ice holes; snowfall overlay; THE WENDIGO's frost
      breath is telegraphed, damages and slows.
- [ ] TEMPLE's water channels and bridges create chokepoints; animated water; THE DROWNED KING's
      tide ring can be outrun or blocked by walls.
- [ ] Shift+M opens the level select with thumbnails for all six levels; teleport works on
      desktop and touch; the game pauses while open; a teleported run is marked practice and not
      ranked; plain M does nothing.
- [ ] Difficulty strictly increases 1→6→loop; descending from 6 leads to BUNKER II.
- [ ] `npm test` green; zero console errors through a run touching every level; frame cost
      < 3 ms with boss + 10 minions + 24 zombies on each new level.

## 6. Spawn prompts

**Phase 0**
```
You are Agent 0 (scaffold) for WORK_ORDER_9.md in the current directory. Read it fully. Do Phase 0
per Sections 2 and 3.1: stubs for src/levels/level4.js/level5.js/level6.js (copies of level 3's
layout with the new id, name, theme placeholder, boss {name, tint, ability}, difficulty from 1.1),
register all six in levels.js, extract the validity suite from tests/levels.test.js into
tests/helpers/levelcheck.js (exported functions; levels.test.js imports it and still passes for
all levels), config LEVEL_SELECT / BOSS.frost / BOSS.tide (targeted inserts), state.stats.practice,
contracts events levelselect:open/close, level:teleport, boss:frost, boss:tide and a guarded
'WO9 new exports' test. npm test green except the new-exports test; node --check. Write
docs/notes/wo9-scaffold.md. No git, no questions.
```
**Phase 1 (A–I)**
```
You are Agent <LETTER> for WORK_ORDER_9.md in the current directory. Read Sections 0-3 in full and
your row in Section 2. Implement everything assigned to you; edit ONLY your files. Siblings are
being written concurrently: import as namespaces, call lazily, guard missing exports, never edit
them. Keep every existing export signature. Level agents validate with tests/helpers/levelcheck.js
in their own test file and never edit tests/levels.test.js. Ship tests for logic modules; npm test
(node --test "tests/*.test.js") green for your files; node --check. Verify visual/DOM work in the
browser on port <8301 + letter index> (?debug=1, &touch=1) with screenshots. Append a "WO9"
section to your notes. Stop servers, close tabs, no git, no questions.
```
**Phases 2–4:** as in WO8 with the Section 5 list, ports 8321–8329.
