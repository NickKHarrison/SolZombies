# weapons.js notes (Agent C)

## What was built
`src/weapons.js` implements everything in WORK_ORDER 3.6 / 5.4: the `WEAPONS` table (21 weapons),
`WALL_WEAPON_IDS` (13 rows that have a numeric cost), `BOX_WEAPON_IDS` (every weapon except mr6 and
deathmachine), `createWeapon`, `updateWeapon`, `tryFire`, `startReload`, `refillReserve`,
`refillAll`, `createDeathMachine`, `updateBullets`, `ammoCost`.

Imports: `map.raycastWalls`, `zombie.damageZombie`, `player.damagePlayer` (the ray gun hurts the
player with its own splash). They are only called inside functions, so the import cycles are fine.

## Extra exports (not in the contract)
- `BOX_WEIGHTS`: `{ [id]: weight }` for the mystery box: 3 for wall guns, 2 for box-only guns,
  1 for wonder weapons (ray gun, thundergun). Not the same thing as `shop.BOX_WEIGHTS`, which is the
  per-class `{ wall, boxOnly, wonder }` map (also exported as `shop.BOX_CLASS_WEIGHTS`). **shop.js should use `state.rng.weighted(BOX_WEIGHTS)`** (re-roll if the player
  already holds it).
- `hitscan(state, ox, oy, dx, dy, range, penetration, damage)` -> `{ hits, endX, endY }`: a single
  ray. It damages zombies and pushes one tracer.
- `setWeaponDeps({ raycastWalls?, damageZombie?, damagePlayer? })` / `resetWeaponDeps()`: dependency
  injection so tests can run without the other modules. By default these call the real imports.

## Behavior decisions
- **Trigger / semi-auto:** `tryFire` records `wasHeld = w.triggerHeld` and then sets
  `w.triggerHeld = true`. A semi-auto weapon fires only when `wasHeld` is false. **player.js has to
  set `w.triggerHeld = false` on any frame where `input.fire` is false.** Setting
  `triggerHeld = input.fire` works only if it happens *after* the `tryFire` call. If it is set to
  true *before* `tryFire`, semi-auto weapons will never fire.
- **Cooldown:** firing sets `cooldown = 60/rpm`. `updateWeapon` decrements it and lets it go as low
  as `-FIXED_DT_CAP`. While the trigger stays held, that leftover time is carried into the next
  shot, so the real fire rate matches rpm at any frame rate (for example, the Vesper at 60 fps).
- **One round per shot**, whatever the pellet count. Each pellet is jittered by
  `rng.range(-spread, spread)` radians, and single-pellet guns get the same jitter.
- **Empty magazine:** `tryFire` returns false. If `reserve > 0` it starts a reload. If reserve is also 0 it
  emits `weapon:empty`, once per trigger pull, not every frame. It also starts a reload right after
  the last round is fired. `startReload` is idempotent, so player.js can call it too.
- **No firing while reloading** (reload is not cancelled by firing). Swapping cancels a reload, and that
  is player.js's job: set `w.reloading = false; w.reloadT = 0`.
- `weapon:reload` is emitted when a reload **starts**.
- **Hitscan:** `raycastWalls` is called only when `state.map` is non-null. The ray length is
  `min(wallDist, def.range)`. It skips zombies with `mode === 'dying'` or `hp <= 0`, sorts the rest by
  `rayCircle` t, and hits the first `penetration` of them at the entry point. The tracer ends at the
  last zombie hit when penetration is used up, and at the wall or the range limit otherwise.
- `stats.shotsFired++` once per trigger shot. `stats.shotsHit++` once per shot if any pellet hit
  (ray gun: once per detonation that damaged any zombie).
- **Ray gun:** each shot pushes one bullet `{ id, x, y, vx, vy, ttl, def }` with `ttl = range/speed`.
  `updateBullets` sweeps each bullet's movement for the frame against walls and zombies
  (zombie radius + 4), so it cannot pass through a zombie between frames. On contact it detonates:
  the zombie it touched takes `def.damage` (1000), every other live zombie within
  `splashRadius + z.radius` takes `splashDamage` (300), and the player takes `splashDamage*0.1` (30)
  if within `splashRadius + player.radius` and not down. When a bullet reaches max range it fizzles
  without exploding.
- **Death machine:** `mag`/`reserve` are `Infinity`, `noReload: true`, so `startReload` always
  returns false. HUD should show `∞`.
- `ammoCost(id)` = `round(cost * 0.5)`. Weapons with no wall cost (box guns, mr6, deathmachine)
  return `Infinity`, so `spendPoints` refuses them. Note that `krm262` gives 38 (75*0.5 = 37.5, which rounds up).
- Non-table stats I chose: `spread` per class (pistol 0.03, smg 0.06, ar 0.02–0.04,
  lmg 0.06–0.07, sniper 0.004–0.008, Haymaker 0.2, death machine 0.08). `range` is 700 for
  KRM/Haymaker, 900 for Argus, 2400 for snipers, and 1400 for everything else.
- Def objects are frozen. `def` has extra fields: `noReload` (bool) and `cost: null` for anything
  not sold on a wall.

## Effects emitted (pushed directly to `state.effects`, render draws them)
| type | fields | ttl |
|------|--------|-----|
| `tracer` | `x0, y0, x1, y1, color` (COLORS.tracer) | 0.06 |
| `muzzle` | `x, y, angle` (radians), `size` (9, or 14 for shotguns), `color` (tracer yellow, ray gun green `#6cf542`) | 0.05 |
| `explosion` | `x, y, radius` (splash radius, 90), `color` `#6cf542` | 0.35 |

Every effect has `ttl` and `maxTtl`. Bullets in `state.bullets` should be drawn by render as a
green orb with a trail, using `vx, vy` for the trail direction.

## Constants to move to config (TODO(integrator))
`DEFAULT_RANGE 1400, TRACER_TTL 0.06, MUZZLE_TTL 0.05, EXPLOSION_TTL 0.35, BULLET_RADIUS 4,
SELF_SPLASH_MULT 0.1, RAYGUN_COLOR '#6cf542'` (all at the top of weapons.js).

## Testing
`tests/weapons.test.js` (11 tests) injects fake `raycastWalls/damageZombie/damagePlayer` through
`setWeaponDeps`. It covers the tables and prices, rpm cooldown math, sustained fire rate, semi vs auto,
reload counts, empty or auto reload, refills, the death machine, nearest-first hitscan and
penetration, wall blocking, dying zombies being ignored, shotgun pellets using one round, and ray gun
splash, self-damage, travel, wall hits and expiry. All 11 pass when run against stubbed map, zombie
and player modules. In the shared tree they currently fail **at import time** only because the
in-progress `src/zombie.js` imports `barricadeOpen` from `src/map.js`, which that file does not
export yet (Agent H's work in progress). This is not a weapons issue. It should clear once map.js is finished.

## Phase 4 fixes (FIX-4)
- **review.md #4a, ray-gun splash through walls:** `detonate` now requires line of sight for splash.
  The LOS origin is the impact point backed off 1 px against the bolt's direction (so a hit on a
  wall/window face does not self-block). A target (zombie, or the player for self-splash) is hit
  only if `raycastWalls` toward it reaches the point of its circle nearest the blast (tolerance
  0.5 px). Zombies in a spawn pocket behind a window, and anything behind a wall, no longer take
  splash. The direct-hit zombie still takes full damage. Constants `SPLASH_LOS_BACKOFF = 1`,
  `SPLASH_LOS_TOL = 0.5` are local to weapons.js. With no `state.map` the check is skipped.
- **Balance (balance.md 4.1-4.4, lead approved):** MR6 damage 40->50, reserve 64->80; RK5
  damage 35->50; Sheiva damage 110->90; HVK-30 damage 65->58; ICR-1 damage 60->66 (price 150).
- Tests: `weapons.test.js:44` now expects reserve 80; added a balance-values test and a real-map
  (`map.raycastWalls`) regression test for splash LOS (window, wall, clear LOS, self-splash).
  Contract signatures unchanged.

## WO2 (Agent G, WORK_ORDER_2 3.9)

- `def()` gains optional `sprite` (gun sprite key: raygun, thundergun, deathmachine; other guns
  omit it and fall back to `cls`) and `cone` (default `null`).
- **Thundergun** added exactly per 3.9 (special, box-only, 4/12, 3.0 s reload, 60 rpm semi,
  `cone: { range 480, killRange 300, halfAngle 0.52, knockback 720, stun 1.2 }`).
- `tryFire` with `d.cone` -> internal `fireCone`: one round consumed; for a snapshot of live
  zombies within `range` and `|angleDiff| <= halfAngle` (wrap-safe to [-PI, PI]):
  every candidate first needs `raycastWalls` LOS to the zombie's near edge (`splashVisible`, same
  tolerance as ray gun splash; walls and window tiles block, so pocket zombies behind boards are safe).
  Inside `killRange` -> `damageZombie(state, z, Infinity, 'weapon', z.x, z.y)`; beyond ->
  `applyKnockback(state, z, ux*knockback, uy*knockback, stun)`. Pushes
  `{ type:'shockwave', x, y, angle, range, halfAngle, ttl, maxTtl }` (`WEAPON_FX.shockwaveTtl`)
  and a `shake` effect (`WEAPON_FX.thundergunShake`), plus a cyan muzzle flash; emits
  `weapon:fired`; `stats.shotsHit++` if anything was killed or knocked (a knock counts unless
  `applyKnockback` returns `false`).
- Infinity damage: `zombie.damageZombie` converts non-finite damage to the zombie's remaining hp, so
  `hp` ends at exactly 0, `zombie:hit.amount` is finite and `killZombie` fires once. Safe.
- `applyKnockback` is a new injectable dep (`setWeaponDeps({ applyKnockback })`); the default
  calls `zombie.applyKnockback` lazily via a namespace import and is a no-op if it is missing.
- New export `WONDER_WEAPON_IDS = ['raygun', 'thundergun']`; `BOX_WEAPON_IDS` now includes the
  thundergun (death machine and mr6 still excluded); `BOX_WEIGHTS` uses
  `SHOP.boxWeights.wonder` for wonder ids (config key renamed `raygun` -> `wonder`).
- Tests (weapons.test.js, "WO2" block): def/sprite/weights, cone geometry (in/out of angle, kill
  vs knock band, beyond range, dying ignored, one round, effects, event, stats), angle wrap at
  +/-PI, a wall blocking both kills and knockback, a real-map test (zombie behind a wall and a
  tearing pocket zombie behind a boarded window survive inside `killRange`; the one in clear LOS
  dies), miss stats, 4/12 reload/refill.
