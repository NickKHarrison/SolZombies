# WO5 Phase 0 scaffold (Agent 0)

Test status after Phase 0: `npm test` 300 tests, 299 pass; the only failure is `WO5 new exports`
(expected until Phase 1 lands map/waves/shop/weapons changes). No gameplay behaviour changed:
`main.js` does not import any of the new modules yet.

## What was added
- `src/config.js`: `DOORS`, `BOSS`, `LEVELS_CFG` appended at the end of the file (3.8 verbatim).
- `src/state.js`: `level: null`, `boss: null`, `transition: null`; `rounds.suspended` documented
  in a comment next to `rounds` (waves.js owns the field; absent/false = normal).
- `src/boss.js` (stub): all 3.2 exports. `createBossState`, `bossZombie`, `bossHpFrac` are real;
  `initBoss` only creates `state.boss` if null; the rest are no-ops.
- `src/level.js` (stub): all 3.3 exports. `createLevelState`, `levelDifficulty`, `nextLevelIndex`
  are real; `startLevel`, `beginDescent`, `updateLevel` are no-ops.
- `src/levels/levels.js` (`LEVELS`, `levelByIndex`), `src/levels/level1.js` (`LEVEL1`),
  `src/levels/level2.js` (`LEVEL2`, temporary copy of level 1's layout/wall buys, with the
  catacomb theme and boss).
- `tests/contracts.test.js`: 5 new canonical events; emit scan now also covers `src/levels/`;
  purity (no window/document/rAF/Math.random) checks for boss, level, levels/*; new tests
  `WO5 3.8 config`, `WO5 state.js`, per-module import/export tests for the new modules,
  `WO5 3.5 level defs: shape`, and `WO5 new exports` (expected to fail until Phase 1).

## Contract clarifications (binding for Phase 1)

1. **Import direction / no load-time cycles.** `levels/*.js` import nothing except each other
   (`levels.js` imports `level1.js`, `level2.js`). They must NOT import `map.js`. `map.js`
   (Agent B) may import `./levels/levels.js` (or `level1.js`) and should set
   `MAP_ASCII = LEVEL1.ascii` / `WALLBUY_MAP = LEVEL1.wallbuys` (legacy exports). Section 4 said
   the level1 stub "re-exports" map.js data; it instead holds its own verbatim copy (identical
   today, checked) to keep the dependency one-way. `level.js` imports `levels.js` statically
   and `map.js` etc. as namespaces.
2. **Boss points.** Total 200 = `POINTS.perKill` (10) paid by the unchanged player.js
   `zombie:killed` handler + `BOSS.points - POINTS.perKill` (190) awarded by
   `boss.finishFight` via `player.addPoints` (subject to Double Points like any addPoints). The
   boss's `zombie:killed` carries the real cause (`'weapon'`, `'explosion'`, `'nuke'` ...), NOT
   `'boss'`, so player.js pays normally. Leftover minions killed by `finishFight` must pay
   nothing (1.2 "no points"), but player.js pays perKill for every cause except `'debug'` and
   is not edited this order. **Decision: finishFight kills leftover minions with cause
   `'debug'`** (3.2 said `'boss'`; that would pay 10 each). powerups.js only drops on cause
   `'weapon'`, so these kills drop nothing either.
   Note for C/G: waves.js counts `rounds.alive` on every `zombie:spawned`/`zombie:killed`,
   including boss and minions. `endRoundNow` recounts live `kind === 'normal'` zombies, so
   that is fine, but waves.js should ignore non-normal kinds in its listeners (or recount).
3. **Level index convention.** `state.level.index` is the absolute progression index
   (0, 1, 2, ...). `def = levelByIndex(index)` (wraps), `loop = floor(index / LEVELS.length)`.
   `nextLevelIndex(state)` returns `index + 1`; the loop count follows automatically.
   `levelDifficulty(index, loop = floor(index / LEVELS.length))` uses the registry position
   `index % LEVELS.length` for the base values and multiplies per 1.3 / `LEVELS_CFG.loop`.
   Base values: `def.difficulty` if a level def has one (Agent A may add it:
   `{ healthMult, speedMult, countMult, sprintShift }`), else a table in level.js
   (L1 `{1,1,1,0}`, L2 `{1.5,1.1,1.25,3}`).
4. **Event payloads.** `boss:start {name, maxHp, level}` and `boss:defeated {name, level}`:
   `level` = `state.level.index` (absolute). `boss:charge {x, y}` is emitted by zombie.js at
   the start of the telegraph (boss position). `level:start {index, name, loop}` is emitted for
   every startLevel including index 0 (HUD suppresses the banner for index 0).
   `level:descend {from, to}` = absolute indices.
5. **Themes.** Level 1 theme = WO4 look: `floor '#2a2a2e'`, `floorAlt` = floor (WO4 floor is
   flat, so no visible checker on level 1), `wall '#0e0e10'`, `wallEdge '#3c3c44'`,
   `accent '#9aa0a8'`, `doorWood '#3e2412'`, `doorIron '#2b2d31'`, `ambient: null` (no tint),
   `torch: false`. Level 2: `ambient 'rgba(255,170,60,0.08)'`, `torch: true`. Render must
   treat `ambient` null/empty as "no tint".
6. **bossZombie / bossHpFrac** read zombie fields `id`, `hp`, `mode`, `_killed` (current
   zombie.js names; there is no `health`/`state` field).
7. **Stub behaviour for siblings.** Until Agent G lands, `level.startLevel` is a no-op, so
   nobody should rely on it in Phase 1 tests of other modules; build maps with `map.loadMap`
   directly.
