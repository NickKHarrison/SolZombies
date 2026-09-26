# level.js notes (Agent G, WO5 3.3)

Pure module (no DOM). Imports `levels/levels.js` statically; `map.js`, `boss.js`, `waves.js`
as namespaces, called lazily and guarded with `typeof`.

## Index convention
`state.level.index` is the absolute progression index (0, 1, 2, ...). `def = levelByIndex(index)`
(wraps), `loop = floor(index / LEVELS.length)`, `nextLevelIndex(state) = index + 1`. Difficulty
per WO5 1.3: base from `def.difficulty` if present, else the table in level.js (L1 `{1,1,1,0}`,
L2 `{1.5,1.1,1.25,3}`), times `LEVELS_CFG.loop` factors per loop (`sprintShift + 3n`).

## startLevel(state, index = 0)
- Sets `state.level = createLevelState(index)` first, then `state.map = map.loadMap(def)`.
- Clears `zombies`, `bullets`, `effects`, `flow` (null), `powerups.items`, `powerups.nuke`;
  `shop.box` back to idle, `shop.prompt = null`; `state.boss = boss.createBossState()` (null if
  boss.js lacks it).
- Rounds: same object mutated in place (created via `waves.createRoundState` if missing):
  round number kept, `phase 'break'`, `timer = ROUNDS.firstRoundDelay`, `toSpawn/alive/
  spawnTimer/pausedUntil/killedThisRound = 0`, `suspended = false`. Clearing the zombie array
  emits no `zombie:killed`, so `alive` is reset explicitly.
- Player moved to `map.playerStart` (velocity zeroed if present, `repairTimer = 0`).
  Points, weapons, ammo, health, active power-ups, `stats` and `state.time` are kept.
- Emits `level:start { index, name, loop }` (also for index 0 at boot). Returns `state.level`.
- `state.transition` is not touched (updateLevel owns it).

## beginDescent / updateLevel
- `beginDescent` returns false with no event if a transition is already running (re-entrancy).
  Otherwise sets `{ t: 0, dur: LEVELS_CFG.fadeSeconds, nextIndex, swapped: false }` and emits
  `level:descend { from, to }`.
- `updateLevel(state, dt)`: `t += dt`; once `t >= dur/2` and not yet swapped, `swapped = true`
  then `startLevel(nextIndex)`; when `t >= dur` the transition is cleared. One large step can do
  both. Main is expected to skip gameplay updates while `state.transition` is set.

## Test hook
`setLoadMapFunction(fn | null)` replaces `map.loadMap` inside `startLevel` (tests use fake maps
because map.js is rewritten concurrently). Main should never call it.

## For the integrator
- Boot with `level.startLevel(state, 0)` after the player exists (or create the player at
  `state.map.playerStart` afterwards); restart must go back through `startLevel(state, 0)`.
- `startLevel` relies on `map.loadMap(levelDef)` accepting a level def (Agent B, 3.1).

## WO5 FIX-1 (QA balance #1/#2, playtest #4/#9, review L2)
- **Difficulty** (`levelDifficulty(index, loop)`, signature kept, `loop` unused): authored levels
  return their own base. Index `i >= N` returns last-authored base x `LEVELS_CFG.loop^k`,
  `k = i - (N - 1)`; speed is `min(speedMultCap, ...)` but never below the last authored level's
  speed. L3 1.8 / 1.375 / 1.133 / 5, L4 2.16 / 1.5125 / 1.15 / 7, L5 2.59 / 1.66 / 1.15 / 9.
  Health, count and sprintShift strictly increase every descent; speed plateaus at 1.15.
- **Loop variants:** `createLevelState(index)` with `loop >= 1` returns a derived def
  `{ ...base, name: 'BUNKER II', theme: loopTheme(base.theme, loop), boss: { ...base.boss,
  name: 'THE WARDEN II' }, loop, baseDef: base }`, memoized per (registry position, loop) so each
  level has its own stable theme object (render caches per object) and base defs are never mutated.
  `def.id`/`ascii`/`wallbuys` are the base's. `state.level.def` is therefore NOT `LEVELS[k]` on
  loops; use `def.baseDef` for the registry entry.
- **`loopTheme(base, loop)`** (exported, pure, deterministic): cycles FLOODED (teal-grey) /
  BURNING (red-amber, torches on) / BLIGHTED (green) / FROZEN (blue) by `(loop-1) % 4`, brightness
  x(1 - 0.08 per further cycle, min 0.76). Colours are the base mixed toward the variant tint
  (floor 26 %, wall 16 %, edge 34 %, accent 30 %, doors 14-20 %); `floorAlt` is a slightly lighter
  floor, so render uses its textured look even on the flat BUNKER base; ambient is the variant's
  rgba tint (6-9 %). `theme.name` = "BUNKER — FLOODED"; level name = "BUNKER II". Also exported:
  `romanNumeral(n)`.
- **Arrival relief:** `startLevel(state, index > 0)` heals the player to `maxHealth` and sets the
  first break to `LEVELS_CFG.arrivalBreak` (10 s). Index 0 (boot/restart) keeps
  `ROUNDS.firstRoundDelay` and does not heal. Debug `setLevel(i > 0)` heals too.
- **Power-ups during the fade:** handled in `main.js` (not here): while `state.transition` is
  set, every numeric `state.powerups.active[type]` is pushed forward by `dt`.
