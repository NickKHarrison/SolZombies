# boss.js (WO5, Agent C)

Pure (no DOM) boss-fight state machine. Contract: WORK_ORDER_5.md 3.2. Siblings (`zombie`, `map`,
`player`, `powerups`, `waves`) are namespace imports, called lazily and guarded with `typeof`.

## State (`state.boss`, from `createBossState()`)
`{ phase: 'idle'|'active'|'defeated', bossId, name, hp, maxHp, summonTimer, minionsSpawned, startedAt, x, y }`
- `x`/`y` (extra): the last known boss position, used as the drop point for the Max Ammo.
- `hp` is mirrored from the boss zombie every `updateBoss`.

## API
- **`initBoss(state)`**
  - Drops the listeners from any previous call (re-init safe) and creates `state.boss` if it is missing.
    An existing boss state is kept, so re-initialising never clobbers a fight.
  - Listens to `zombie:killed`: if the dead zombie is the boss, it sets `hp = 0` and records the position.
  - Listens to `game:restart`: `state.boss = createBossState()`.
  - `round:start` needs nothing.
- **`updateBoss(state, dt)`**
  - **idle**: `startFight` runs when `map.megaDoor.open && !sealed` and the player (not down) is inside the
    arena. The arena check uses `map.inArena`; without it, the fallback is `map.arenaTiles`, with bounds
    checked.
  - **active**:
    - Mirrors hp and position.
    - The summon clock (`BOSS.summonEvery`) calls `spawnMinions(BOSS.minionsPerWave + state.level.index)`.
    - As soon as `bossZombie()` is null (the boss is dying or gone), it calls `finishFight`. The 2 s death
      animation plays at the same time; the stairs and banner do not wait for it.
  - **defeated**: nothing happens. `level.startLevel` (Agent G) resets `state.boss` for the next level.
- **`startFight(state)`**
  - Only runs from idle, and returns a bool.
  - Seals the mega door with `map.sealMegaDoor` (without it, the flags are set directly) and sets
    `rounds.suspended = true`.
  - Spawns the boss at `map.bossSpawn` with `kind: 'boss'`, taking its name and tint from
    `state.level.def.boss`.
  - Sets `phase`, `bossId`, `name`, `hp`, `maxHp`, `startedAt`, `summonTimer`.
  - Spawns the first minion wave.
  - Emits `boss:start { name, maxHp, level }`, where `level` is `state.level.index` (0 if there is no level).
  - Render does the start shake; boss.js pushes no effect of its own.
- **`spawnMinions(state, n)`**
  - Spawns `min(n, BOSS.maxMinions - live minions)` minions.
  - Each one goes on a random `map.arenaSpawns` tile, picked with `state.rng.pick`. Without arena spawns,
    `bossSpawn` or the player position is used.
  - Adds to `minionsSpawned` and returns the count.
- **`finishFight(state)`** runs only when the phase is `active`, and does the following:
  1. Sets `phase = 'defeated'`.
  2. Kills each live minion with cause **`'debug'`** (Phase 0 decision). player.js skips `'debug'`, so no
     points; powerups only drop on `'weapon'`, so no drops.
  3. Calls `map.unsealMegaDoor` and `map.openStairs`.
  4. Sets `rounds.suspended = false`.
  5. Calls `waves.endRoundNow(state)`. If it does not exist, the fallback sets `toSpawn = 0` and recounts
     `alive` as the live `'normal'` zombies.
  6. Calls `player.addPoints(BOSS.points - POINTS.perKill)` (190, doubled under Double Points) at the boss
     position.
  7. Calls `powerups.spawnPowerup(state, 'maxAmmo', x, y)`.
  8. Emits `boss:defeated { name, level }`.
- **`bossZombie(state)` / `bossHpFrac(state)`**: unchanged from the Phase 0 stub.

## Points
The total per boss is 200:
- 10 from the unchanged player.js `zombie:killed` handler. The boss's kill event carries the real cause.
- 190 from `finishFight`.

## Tests (`tests/boss.test.js`)
All tests use a fake 16x12 arena map with no mega door or stair tiles, so they work with or without the
real `map.js` WO5 functions. They cover:
- The fight trigger conditions and seal/suspend, plus the `boss:start` payload.
- Stat scaling with level difficulty, round and levelIndex minion count.
- The summon cadence and the `maxMinions` cap.
- `finishFight` effects: free minion kills, unseal, stairs, resume, exactly 200 points, a single Max Ammo
  at the boss position, running only once, and the 2 s corpse linger.
- Re-init safety and `game:restart`.
- The nuke rule: 10 %, boss not queued.

Headless check on the real level-1 map: 60 s of fight with a circling, invulnerable player. The results:
- 7 charges; the boss stayed in the arena.
- The minion cap held at 10, and no zombie position ever became NaN.
- Killing the boss opened the stairs and the mega door, paid 200, and put rounds into `break`.

## WO5 FIX-2 (balance, docs/qa/wo5-balance.md #6, #11, #13)
- **Mid-fight Max Ammo (#6).** `updateBoss` drops one Max Ammo at the boss position the first frame
  the live boss is below `BOSS.ammoDropAtFrac` (0.5) of max HP. Flag `state.boss.midDrop` (reset in
  `createBossState` and `startFight`). If the boss dies from above 50 % in one frame there is no mid
  drop; the guaranteed death drop still happens. So a normal fight yields two Max Ammo.
- **Full heal at fight start (#11).** `startFight` sets `player.health = player.maxHealth` (unless the
  player is downed) before the first wave and `boss:start`.
- **Summon size (#13).** New export `minionsPerWaveFor(state)` =
  `BOSS.minionsPerWave + min(levelIndex, BOSS.minionsLevelCap (2))`: 4 / 5 / 6 / 6 ... per wave.
- Boss HP, minion HP, Insta-Kill, hit cap and Thundergun rules live in `zombie.js` (see zombie.md).
- Headless check (QA-3 harness, 10 seeds, god mode, random drops off), L1 R10 boss 9,900 HP:
  KN-44 + Argus 45.7 s median (40-55), R12 52.9 s, R8 44.4 s, 0 runs dry; with Insta-Kill forced at
  start 17.4 s; Ray Gun + KN-44 34.4 s; Thundergun + KN-44 38.0 s. Mortal R10: 10/12 won.

## WO7 (Agent H): acid hazards
- **`updateHazards(state, dt)`** (INT: call it in the loop after `updateZombies`).
  - Creates `state.hazards` / `state.acidGlobs` if missing; `dt <= 0` is a no-op after the checks.
  - **Level change**: a module `WeakMap` remembers the `state.map` object seen last per state; a
    different map object clears hazards and globs (no `level.js` change needed).
    `game:restart` (listener in `initBoss`) clears them too. Export `clearHazards(state)` for INT.
  - **Globs** (`state.acidGlobs`, see below): `ttl -= dt`, move by `vx/vy * dt`; at `ttl <= 0` the
    glob becomes a pool at exactly `(tx, ty)`.
  - **Pools** (`state.hazards`, contract shape `{ id, kind: 'acid', x, y, r, ttl, maxTtl, dps }`):
    the player takes `dps * dt` via `player.damagePlayer` while its centre is within `r`.
    Overlapping pools do not stack (highest dps applies). Skipped while `player.down`,
    `downT > 0`, `invulnT > 0` or `invulnerable`. Pools never hurt zombies. Pruned at `ttl <= 0`.
- **Deviation: globs are NOT in `state.bullets`.** `weapons.updateBullets` treats every bullet as
  a ray-gun projectile (raycasts zombies/walls and calls `detonate`), so an acid glob there would
  explode on the first zombie and never land. Globs live in **`state.acidGlobs`**:
  `{ id, kind: 'acid', x, y, sx, sy, tx, ty, vx, vy, ttl, maxTtl, r, poolTtl, dps }`.
  Render (Agent C): draw from `state.acidGlobs`; `sx, sy` = launch point, `tx, ty` = landing point,
  progress `1 - ttl / maxTtl`; the arc height is purely visual.
- `damagePlayer` is called every frame while inside a pool, so `player:damaged` fires per frame;
  audio/HUD should throttle hurt feedback (or treat amounts < 1 as a tick).
- Constants: all from `BOSS.acid`; fallbacks (6 / 0.5 / 3 / 0.44 / 0.8 / 50 / 5 / 25) only if the
  config block is missing.

## WO9 (Agent E): frost / tide bosses
- No boss.js code change was needed: `startFight` spawns the boss through `zombie.spawnZombie`, which
  reads `state.level.def.boss.ability` (`'frost'` THE WENDIGO, `'tide'` THE DROWNED KING) and builds
  `z.frost` / `z.tide`. The abilities live in zombie.js (see zombie.md WO9) because they drive the boss
  zombie's per-frame AI like charge and acid; they create no hazards, so `updateHazards` is unchanged.
- Render (F) reads `bossZombie(state).frost` `{ phase, t, angle }` (cone: `BOSS.frost.range`,
  `halfAngle`; breath lasts `zombie.FROST_BREATH`) and `.tide` `{ phase, t, radius, x, y }` (draw the
  ring at `x, y`, the wave centre, not the moving boss). Audio (H) hooks `boss:frost` / `boss:tide`
  (emitted at telegraph start).
- Tests (`tests/boss.test.js`): `startFight` on frost / tide levels spawns the right ability; a 20 s
  fight per ability uses it >= 2 times, never charges, and the knocked player stays finite and off the
  wall ring.
