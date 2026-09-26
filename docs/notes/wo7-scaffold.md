# WO7 Phase 0 scaffold (Agent 0)

Test status after Phase 0: `npm test` 415 tests, 414 pass; the only failure is `WO7 new exports`
(expected until Phase 1 lands). It lists what is still missing: zombie art (placeholder check),
`player.perkMods/addPerk/removeAllPerks/hasPerk`, `weapons.meleeAttack`, `WEAPONS.hg40/m8a7/
peacekeeper` (tier 3), `map.TILE_PERK` (= 10), `shop.buyPerk`, `boss.updateHazards`,
`hud.setScores/setGameOverSummary`. `weapons.ammoCost` already exists (F extends it for tier 3).

## What was added
- `src/config.js` (targeted inserts): `SPRITES.zombieStride: 36`, `SPRITES.bossStride: 90`;
  `BOSS.acid` (3.1 verbatim); `PERKS`, `MELEE`, `SCORES` appended at the end of the file.
- `src/state.js`: `stats` gains `timeSurvived 0, levelReached 1, bossesKilled 0,
  powerupsCollected 0, doorsOpened 0, meleeKills 0, perksBought 0, bestWeaponId null`;
  `hazards: []`. Nothing increments them yet (INT does it in `main.js`, except
  `perksBought`, which `player.addPerk` increments per 3.3).
- `src/sprites/zombie.js` (stub): `ZOMBIE_SPRITES` in the exact 3.3 shape with
  `placeholderSprite` checkers (sizes 16/12/40, frame counts 6/4/4, anchors) and a real
  `zombieSpriteFor(z)`.
- `src/scores.js` (stub, working): `loadScores`, `saveScores`, `recordRun`, `topScores`,
  `clearScores`, `formatTime`, plus helpers `createMemoryStorage`, `defaultStorage`,
  `compareEntries`.
- `src/levels/level3.js`: `LEVEL3` = verbatim copy of level 2's `ascii` + `wallbuys`, with
  id `lab`, name `LABORATORY`, lab theme, boss THE SUBJECT (`ability: 'acid'`), difficulty
  `{2.0, 1.2, 1.5, 5}`. Registered: `LEVELS = [LEVEL1, LEVEL2, LEVEL3]`.
- `level1.js` / `level2.js`: `boss.ability: 'charge'` added (one-token edits).
- `tests/contracts.test.js`: 8 new canonical events (3.2); purity checks for
  `sprites/zombie`, `scores`, `levels/level3`; new tests `WO7 3.1 config`, `WO7 state.js`,
  import/export tests for the 3 new modules, `WO7 sprites/zombie.js: ZOMBIE_SPRITES shape`,
  `WO7 level defs`, and `WO7 new exports` (every import guarded, so it fails with a list rather
  than throwing).
- `tests/level.test.js`: the `levelDifficulty` tests hard-coded level 2 as the last authored
  level (1.5 / 1.25 / 1.1 / 3 and the "L3 1.8 / L4 2.16" balance rows). Rewritten minimally to
  use `LEVELS[N - 1].difficulty` and `N = LEVELS.length`; the speed-cap assertion past the last
  level is now `<= max(speedMultCap, lastLevel.speedMult)`, because level 3's own speed 1.2 is
  above the 1.15 cap and `level.js` already keeps `max(last.speedMult, ...)`. Authored levels
  are asserted to equal their `def.difficulty`.
- `tests/levels.test.js` (Agent I's file; minimal): registry test now expects 3 levels
  (`levelByIndex(-1) === LEVEL3`, wraps at 3) and imports `LEVEL3`. The existing
  `for (const def of LEVELS)` WO4/WO5 layout suites now also run on `lab` (passes: it is the
  level-2 layout).

## Clarifications for Phase 1 (binding)

1. **Zombie sprite shape (A, C).** Keep keys, sizes, frame counts and anchors exactly as the
   stub. `zombieSpriteFor(z)` maps `z.kind` (`'normal' | 'minion' | 'boss'`, default normal) and
   `z.tier` (`'walk' | 'jog' | 'sprint'`, zombie.js names) to `walker | jogger | sprinter`.
   Returned object: `{ body, legs: { frames, anchor }, corpse, anchor }`; render reads
   `ZOMBIE_SPRITES.normal.tearing / damaged` and `boss.charge / tintColor` directly. The stub
   sprites have `placeholder: true`; `WO7 new exports` checks `normal.body.walker.placeholder`
   to know A has landed. Render must not break on placeholders (preview/early testing).
2. **Strides.** `SPRITES.zombieStride` = world px per full normal/minion leg cycle,
   `bossStride` = per full boss stomp cycle. Phase from distance moved, as for the soldier.
3. **scores.js (J).** Contract is 3.3: `recordRun(stats, extra = {}, storage)` returns
   `{ rank, entry, isBestRound, isBestPoints }`; the stub also returns
   `best: { round, points }` (1.4 wording) — keep it, HUD may use either. `rank` is 1-based or
   `null` when the run did not make the top `SCORES.max`. `isBestRound`/`isBestPoints` are
   strict (> every previous entry; true on an empty table). Entry fields come from
   `state.stats` (`roundReached, pointsEarned, kills, levelReached, bossesKilled,
   timeSurvived -> timeSec (floored), bestWeaponId -> weapon`) and `extra` overrides any field
   (INT passes `{ perks: player.perks.slice() }`). `defaultStorage` resolves lazily on first
   use: `globalThis.localStorage` if a probe write works, else a module-level in-memory store,
   so importing never touches storage and nothing ever throws. Tests should pass
   `createMemoryStorage()` explicitly. Note: in Node the default storage is the shared
   in-memory fallback — do not rely on it being empty across tests.
4. **Level 3 (I).** `level3.js` is a placeholder copy of level 2; replace `ascii`/`wallbuys`
   with the lab layout and keep id/name/boss/difficulty/theme keys (colours may be refined; keep
   `torch: false`, `flicker: true`, `floor !== floorAlt`). Level 3 currently sells level-2 guns;
   tier-3 ids (`hg40`, `m8a7`, `peacekeeper`) arrive from F. `levels.test.js` registry test
   already expects 3 levels.
5. **boss.ability (H, C).** `levelDef.boss.ability` is `'charge'` on levels 1-2 and `'acid'`
   on level 3; treat missing/unknown as `'charge'`. Loop variants (`level.js` `levelDefFor`)
   spread `base.boss`, so `ability` survives into "THE SUBJECT II".
6. **Flicker across loops (C / INT).** `level.js` `loopTheme()` builds a fresh theme object and
   does NOT copy `flicker`, so LABORATORY II (index 5) would lose the flicker. level.js has no
   WO7 owner: INT may add `flicker: !!b.flicker` to `loopTheme` if wanted. Render should read
   `theme.flicker` truthily.
7. **Hazards (H, C, INT).** `state.hazards` is created empty by `createEmptyState`. H should
   also clear it when a level starts or the boss fight ends if pools must not survive level
   swaps (`level.js startLevel` does not clear it; INT may add `state.hazards = []` there, or
   H clears in `updateHazards` when `state.transition` swaps). Pool shape per 3.3
   `{ id, kind: 'acid', x, y, r, ttl, maxTtl, dps }`; acid glob projectiles live in
   `state.bullets` with `kind: 'acid'`.
8. **Stats.** `levelReached` starts at 1 (1-based, human level number); INT sets it to
   `state.level.index + 1` on `level:start`. `timeSurvived` = `state.time` in seconds.
9. **Events.** Only names in `CANONICAL_EVENTS` may be emitted (contract test scans `src/`,
   `src/sprites/`, `src/levels/`). `purchase:made`/`purchase:denied` with `kind: 'perk'` need
   no table change.
10. **Behaviour change from Phase 0.** Only one: descending from level 2 now leads to
    `LABORATORY` (level-2 layout with the lab theme; its boss still charges until H lands the
    acid AI), and the first loop starts at level 4 (BUNKER II) instead of level 3. Loop
    difficulty now compounds from level 3's `{2.0, 1.2, 1.5, 5}`.
