# WO8 Phase 0 scaffold (Agent 0)

Test status after Phase 0: `npm test` 514 tests, 513 pass; the only failure is `WO8 new exports`
(expected until Phase 1 lands). It lists: `weapons.UPGRADES` (object),
`weapons.upgradeWeapon/isUpgraded/upgradedName/canUpgrade`, `map.TILE_PAP` (number, must be 11),
`shop.startPap/takePap/updatePap`. `node --check` clean on all edited files. No behaviour change
(nothing reads the new config/state yet).

## What was added
- `src/config.js`: `PAP` appended at the end of the file, verbatim from Section 3.
- `src/state.js`: `shop.pap = { state: 'idle', timer: 0, weapon: null, slot: -1, baseId: null }`
  (next to `shop.box`, fresh object per `createEmptyState`); `stats.papCount = 0`.
- `tests/contracts.test.js`: `pap:start` (`{ weaponId, slot }`) and `pap:done` (`{ weaponId }`)
  in `CANONICAL_EVENTS`; new tests `WO8 config: PAP block`, `WO8 state.js: shop.pap and
  stats.papCount`, and `WO8 new exports` (every import guarded, fails with a list, never throws).
  `purchase:made` / `purchase:denied` with `kind: 'pap'` need no table change.

## Letter 'A' check
`A` is free everywhere: not in `map.js` `CHAR_CODE` (`# . P W S O B M Z X T`), not a perk letter
(`J Q C N U K`), not a door letter (`D E F G H`, mega `M`), and not a wall-buy key on any level
(bunker `1-9 a-d`, catacombs `1-9`, lab `1-8`). No level ascii contains `A` yet. Note for B/C:
until B adds `'A'` to `map.js`, placing `A` in a level makes `charToCode` throw
`unknown tile char 'A'`; B should map it before (or independently of) the perk/wall-buy checks.

## Notes for Phase 1
- Only B's `shop.js` should emit `pap:start` / `pap:done` (contract scan of `src/`).
- `stats.papCount` is incremented by `shop.takePap` (Section 3), not by main.js.
- `level.startLevel` (INT) must reset `shop.pap` to the idle shape above after returning a gun;
  restart gets it for free from `createEmptyState`.
