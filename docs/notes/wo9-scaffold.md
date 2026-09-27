# WO9 Phase 0 scaffold (Agent 0)

Test status after Phase 0: `npm test` 576 tests, 575 pass; the only failure is `WO9 new exports`
(expected until Phase 1/2 land). It lists: `src/levelselect.js` (missing) with
`initLevelSelect/openLevelSelect/closeLevelSelect/isLevelSelectOpen/levelThumbnail`,
`map.TILE_PIT` (number, must be 12), `touch.onLevelsButton`, `input.getInput().levelSelect`
(boolean), `level.teleportTo` (INT). `node --check` clean on every edited file.

## What was added / changed
- `src/levels/level4.js` (`LEVEL4`, id `kino`, name `KINO`), `level5.js` (`LEVEL5`, `outpost`,
  `OUTPOST`), `level6.js` (`LEVEL6`, `temple`, `TEMPLE`): **stubs**, `ascii` + `wallbuys` are a
  verbatim copy of level 3 (LABORATORY). Each has a placeholder theme per 1.2-1.4 (hex colours,
  `ambient` rgba, `torch`/`flicker` booleans, plus a `style: 'kino' | 'outpost' | 'temple'` hint),
  the boss `{ name, tint, ability }` per 1.2-1.4 and the 1.1 difficulty. No imports.
- `src/levels/levels.js`: `LEVELS = [LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5, LEVEL6]`.
- `src/config.js` (targeted inserts): `BOSS.frost`, `BOSS.tide` (inside `BOSS`, after `acid`) and
  `LEVEL_SELECT` appended at the end, all verbatim from 3.1. `DOORS` unchanged (the per-level rule
  already yields 1000 / 1250 / 1500 for index 3 / 4 / 5).
- `src/state.js`: `stats.practice = false`. `player.slowT` is NOT in state.js: Agent E adds
  `slowT: 0` in `player.createPlayer` (3.1).
- `tests/helpers/levelcheck.js` (new, **frozen from now on**): the validity suite extracted from
  `tests/levels.test.js` (API below).
- `tests/levels.test.js`: imports the suite from the helper (all existing tests unchanged in
  behaviour); registry test is now six levels; WO9 difficulty rows + strict 1->6 rise; WO9 boss
  test; `PAP_PLAN` / `PERK_PLAN` stay here for levels 1-3 only (the PaP position assert is skipped
  for ids without a plan); new tests: `validateLevel` self-test, pit-tile handling, levels 4-6
  full suite + `checkWO9Guns`, and "layouts differ >25 % from every other level" which **skips
  levels still identical to level 3** (stubs) and becomes active as each map lands.
- `tests/contracts.test.js`: canonical events `levelselect:open`, `levelselect:close`,
  `level:teleport`, `boss:frost`, `boss:tide`; `levels/level4-6` added to the pure-file scan;
  tests `WO9 config`, `WO9 state.js`, `WO9 level defs`, and the guarded `WO9 new exports`.
- `tests/level.test.js`: needed no change (already `LEVELS.length`-driven since WO7).

## levelcheck.js API (for A / B / C)

```js
import { assertValidLevel, validateLevel, checkWO9Guns, tileDiff, freeStandingBlocks,
  parseLevel, playerBfs, openingStep, touches, PIT } from './helpers/levelcheck.js';
```

- `validateLevel(def, opts?) -> string[]` runs every group: `meta`, `theme`, `layout (WO4)`,
  `arena (WO5)`, `perks (WO7)`, `pack-a-punch (WO8)`, and `guns (WO9)` when `opts.wo9Guns`.
  Returns `[]` when valid, else one `"<group>: <first violation>"` string per failing group (each
  group stops at its first violation — fix and re-run). Never throws.
- `assertValidLevel(def, opts?)` throws one `Error` listing all violations; returns `parseLevel(def)`
  when valid. Recommended one-liner in `tests/levelN.test.js`:
  `assertValidLevel(LEVEL4, { wo9Guns: true, perkPlan: {...}, papPos: [x, y] })`.
- `opts`: `perkPlan` = `{ revive: 0, speed: 1, ... mule: 5 }` (step = door count in D..H order
  that first exposes the machine; 0 start zone, 5 behind H); `papPos` = `[x, y]` of `A`;
  `wo9Guns` = true for levels 4-6.
- Individual groups (throw `AssertionError` on the first violation, same messages as before):
  `validateWO4(def)` (returns `{ L, Z, edges, startZone, arenaZone }`), `validateArena(def)`,
  `validatePerks(def, perkPlan?)`, `validatePap(def)` (returns the `A` tile), `checkMeta(def)`,
  `checkTheme(def)`, `checkWO9Guns(def)`.
- `checkWO9Guns`: `hg40`, `m8a7`, `peacekeeper` all on walls, each behind >= 1 door; exactly one
  start-room gun and it is not tier 3 / gorgon / drakon. Tier-2 guns (gorgon, drakon, manowar,
  marshal16) are allowed, not required — assert your own mix in your test file.
- Helpers: `parseLevel(def)` (`{ at, find, start, boxes, windows, pockets, opens, buys, doors,
  mega, stairs, boss, minions, perks, paps, buyKeys }`), `bfs`, `walkFn`, `playerBfs(L, openLetters)`,
  `zombieWalk`, `activeSpawns`, `zones(L)`, `neighbourZones`, `openingStep(L, tile)`, `touches`,
  `reached`, `key`, `checkRun`, `tileDiff(a, b)` (differing tiles), `freeStandingBlocks(def)`
  (interior `#` blobs not joined to the border rock: seat rows, huts, pillars, ...).
- Constants: `COLS 60`, `ROWS 40`, `DOOR_LETTERS`, `PERK_LETTERS`, `PAP_LETTER`, `PIT ('~')`,
  `LEGEND`, `FLOORISH`, `N4`, `KNOWN_WEAPONS`, `TIER3_GUNS`, `NEW_GUNS`, `BOSS_ABILITIES`,
  `THEME_HEX_KEYS`, `WO4_ASCII`, `WO4_WALLBUYS`.

### Pit tile `~` in the checker (binding for B, C, D)
- `~` is in the legend. It is **not** walkable for the player or zombies (not `FLOORISH`), so it
  splits zones exactly like a wall for every reachability / zone / spawn rule. Pits separating
  zones without a door therefore create extra zones (the 6 zones + arena count still applies):
  every link between zones must still be a door `D-H`.
- Door / mega / stairs runs may be capped by `#` **or** `~` (a gate between two ice holes).
  Doors must still have floor on both sides of each tile.
- Arena floor may border `~` (water inside the flooded pit). Pillars are counted from `#` blobs
  only, so the arena still needs 2-4 wall pillar clusters; the arena must remain ONE walkable
  component (a pit ring that cuts it changes the zone count and fails).
- Pockets `S` must still be enclosed by `#`/`W` only; perk machines and `A` must not be
  4-adjacent to `~` (their neighbours must be floor or wall); wall buys / box only need to face floor.
- Until D lands `TILE_PIT`, `map.js charToCode` throws on `~`: levels with pits will not load in
  the browser before D's map.js change (tests via levelcheck work regardless).

## Clarifications for Phase 1

1. **Level agents (A/B/C)** replace `ascii` + `wallbuys` and refine `theme`; keep `id`, `name`,
   `boss` and `difficulty` exactly (contracts + levels.test.js pin them). Keep the file
   import-free and pure (no `Math.random`, `window`, `document`). `levels.test.js` already runs
   `validateLevel` + `checkWO9Guns` on your level and, once your ascii differs from level 3,
   the >25 % difference check against every other authored level; put PaP position / perk plan /
   layout-specific assertions in your own `tests/levelN.test.js`.
2. **Theme keys.** Render (F) requires the 7 hex keys + `ambient` + `torch` (+ optional
   `flicker`); extra keys are free-form. Stubs carry `style: 'kino'|'outpost'|'temple'` as the
   dispatch hint for F. Note `level.loopTheme()` builds a fresh object with only the standard keys
   (it drops `style`, `wallStyle` and any WO9 overlay keys) but keeps the name (`KINO — FLOODED`):
   F should dispatch on `raw.style` OR a name regex (as the existing LABORATORY `wallStyle`
   fallback does), or INT copies `style` into `loopTheme`.
3. **Boss abilities (E).** `frost` / `tide` config under `BOSS.frost` / `BOSS.tide`; THE
   PROJECTIONIST uses `charge`. zombie.js currently dispatches `acid` else charge, so levels 5-6
   bosses charge until E lands. Emit `boss:frost { x, y, angle }` / `boss:tide { x, y }` at
   telegraph start (both are canonical now).
4. **Events (G / INT).** `levelselect:open {}`, `levelselect:close {}`, `level:teleport { from, to }`
   are canonical; any `src/` file may emit them (contract scan only checks names). Suggested: main
   (INT) emits all three so levelselect.js stays a pure view.
5. **Practice flag (INT / I).** `state.stats.practice` starts `false` per state; INT sets it true on
   teleport and skips `scores.recordRun` when true.
6. **Progression.** Six levels: descending from level 3 leads to KINO; the loop starts at index 6
   (BUNKER II). `level.js` is fully `LEVELS.length`-driven: loop difficulty compounds from TEMPLE
   `{3.5, 1.26, 1.8, 11}` (index 6 = `{4.2, 1.2978, 1.98, 13}`, speed cap 1.3); mega door price
   = 250 + 250 x index. `loopWallUpgrade` still maps tier-1/2 ids; tier-3 guns are unchanged in
   loops. Pre-existing (not WO9): in loop variants of the level-3 layout (`LABORATORY II`, and
   the stubs' `KINO II` etc.) `xr2 -> m8a7` and `icr1 -> gorgon` duplicate guns already on the
   wall. A/B/C: if you sell `manowar` / `xr2` / `weevil` / `icr1` etc. alongside their upgrade
   target, the loop version shows that gun twice (harmless, but INT may want to dedupe).
7. **Audio (H).** `audio.js isLabLevel` matches `/LABORATORY/` by name (index 2 fallback only when
   no name) — still correct with six levels; use the same name-based detection for KINO /
   OUTPOST / TEMPLE so loop names (`KINO II`) keep their ambience.
