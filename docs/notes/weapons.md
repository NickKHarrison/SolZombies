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

## WO5 (Agent D, WORK_ORDER_5 3.4 / 1.2)

**New guns** (all `tier: 2`, `sprite` = id, also in the box). Stats per 3.4; unspecified spreads chosen
per class:

| id | name | cls | cost | dmg | rpm | auto | mag/res | reload | extra |
|----|------|-----|------|-----|-----|------|---------|--------|-------|
| manowar | Man-O-War | ar | 250 | 120 | 520 | yes | 25/200 | 2.6 | pen 2, spread 0.035 |
| xr2 | XR-2 | ar | 225 | 85 | 900 | yes | 30/270 | 2.1 | spread 0.02 |
| weevil | Weevil | smg | 200 | 60 | 950 | yes | 48/288 | 2.0 | spread 0.06 |
| marshal16 | Marshal 16 | shotgun | 225 | 70x8 | 110 | no | 2/40 | 1.6 | spread 0.16, range 650 |
| gorgon | Gorgon | lmg | 300 | 130 | 400 | yes | 48/240 | 4.0 | pen 3, spread 0.05 |
| dredge48 | 48 Dredge | lmg | 275 | 70 | 850 | yes | 48/288 | 3.6 | spread 0.07 |

`haymaker12` cost `null -> 250`, `drakon` cost `null -> 300` (also `tier: 2`). `WALL_WEAPON_IDS` is
still "every def with a numeric cost", so it grows 13 -> 21. Level 1's `wallbuys` (Agent A) keeps
only the WO4 guns, so level 1 is unchanged. `ammoCost` works for all of them (`round(cost * 0.5)`,
so Haymaker ammo 125, Drakon 150).

**Box weights (decision).** The level-2 guns keep weight **2** (`SHOP.boxWeights.boxOnly`), as 3.4 /
1.3 say ("box pool the same everywhere plus the new guns at box-only weight 2"), and Haymaker/Drakon
stay at their old box-only weight 2. This keeps the relative odds of every WO4 box gun unchanged.
Mechanism: `def()` gets a `tier` field (default 1). New export **`BOX_WALL_WEIGHT_IDS`** = wall ids
with `tier !== 2` (exactly the 13 WO4 wall guns); `BOX_WEIGHTS` gives weight 3 only to those.
**For shop.js (Agent G):** `boxWeights(boxIds, wallIds)` must default `wallIds` to
`weapons.BOX_WALL_WEIGHT_IDS` (not `WALL_WEAPON_IDS`), otherwise its defaults disagree with
`weapons.BOX_WEIGHTS` (shop.test "deepEqual weapons.BOX_WEIGHTS"). Checked at hand-off: shop.js
already does this (with a `WALL_WEAPON_IDS` fallback).

**Thundergun vs boss (1.2).** In `fireCone`, a zombie with `z.kind === 'boss'` goes through
`thunderBoss` instead of the kill/knock bands (same angle, range and wall LOS test first):
- near (d <= killRange): `damageZombie(state, z, maxHp * BOSS.thunderNearFrac, 'weapon', z.x, z.y)`
  (maxHp = `z.maxHp`, else `state.boss.maxHp`, else `z.hp`), then, if it is still alive,
  a knockback of `BOSS.thunderNearKnock` (60) px;
- far: knockback of `BOSS.thunderFarKnock` (40) px only, no damage.
- New export `bossKnock(px) -> { speed, stun }` converts a pixel distance into zombie.js's velocity
  knock model: `speed = px * ZOMBIE.knockFriction + ZOMBIE.stunMinSpeed` (slide = (v0 - vMin)/k
  exactly), `stun = ln(speed / vMin) / k` (~0.49 s for 60 px), i.e. the stun only lasts as long as
  the slide itself, so there is no thundergun stun. `applyKnockback` needs a positive stun, and per
  3.2 it ignores the stun for the boss anyway (displacement only), so this works with either
  zombie.js behaviour. Minions are `kind: 'minion'` and behave like normal zombies (die in
  killRange, 720 knock + 1.2 s stun beyond).

Tests (`tests/weapons.test.js`, "WO5" block): new defs/stats/sprites/ammo, Marshal pellets and semi,
Gorgon penetration, wall ids and box weights (level-1 wall ids unchanged at 3), `bossKnock`
replayed through the zombie.js slide integration, boss near/far cone with fakes, `state.boss.maxHp`
fallback, lethal chip skips knock, walls block the boss. WO4 table test updated to 21 wall ids.

## WO5 FIX-4 (QA playtest #2, balance #10 and #12): tier-2 retune

User requirement: level-2 guns must be "more powerful". Every tier-2 gun now kills a level-2
round-8 zombie (`healthForRound(8, {healthMult: 1.5})` = 1275 HP) in <= 0.85x the KN-44's time,
price tracks power, and each gun keeps its identity. The table above (WO5, Agent D) shows the
original 3.4 values; these supersede them:

| id | cost | dmg | rpm | reload | other |
|----|------|-----|-----|--------|-------|
| weevil | 200 | 60 -> 65 | 950 | 2.0 | |
| xr2 | 225 | 85 -> 80 | 900 -> 800 | 2.1 | was the best gun at 225; now mid-pack |
| marshal16 | 225 | 70 -> 100 (x8) | 110 -> 150 | 1.6 -> 1.5 | 2-shot kill at L2 R8 (80 % pellets) |
| manowar | 250 | 120 -> 140 | 520 | 2.6 | |
| haymaker12 | 250 | 25 -> 32 (x8) | 300 -> 330 | 3.0 | |
| dredge48 | 275 | 70 -> 85 | 850 -> 900 | 3.6 | balance #12 |
| gorgon | 300 | 130 -> 175 | 400 -> 480 | 4.0 | pen 3, best sustained DPS |
| drakon | 300 | 220 -> 380 | 200 | 2.5 | pen 3, 4-shot kill at L2 R8 |

**TTK model** (`ttkSeconds` in tests/weapons.test.js): sustained single-target fire from a full
mag, 60/rpm between shots, `max(interval, reloadTime)` after the shot that empties the mag, pellet
guns land 80 % of pellets, single-bullet guns hit every shot. "Mean" = average over L2 rounds 6-12
(975-1896 HP), which smooths shots-to-kill steps such as the Marshal's 2-shot cliff.

| gun | cost | R8 TTK before | R8 after | x KN-44 | mean L2 R6-12 before | after | x KN-44 |
|-----|------|------|------|------|------|------|------|
| KN-44 (L1) | 150 | 1.543 | 1.543 | 1.00 | 1.714 | 1.714 | 1.00 |
| Weevil | 200 | 1.326 | 1.200 | 0.78 | 1.471 | 1.353 | 0.79 |
| XR-2 | 225 | 0.933 | 1.125 | 0.73 | 1.086 | 1.296 | 0.76 |
| Marshal 16 | 225 | 2.145 | 0.400 | 0.26 | 2.686 | 1.257 | 0.73 |
| Man-O-War | 250 | 1.154 | 1.038 | 0.67 | 1.319 | 1.137 | 0.66 |
| Haymaker 12 | 250 | 1.400 | 1.091 | 0.71 | 1.657 | 1.169 | 0.68 |
| 48 Dredge | 275 | 1.271 | 0.933 | 0.60 | 1.412 | 1.086 | 0.63 |
| Gorgon | 300 | 1.350 | 0.875 | 0.57 | 1.564 | 0.946 | 0.55 |
| Drakon | 300 | 1.500 | 0.900 | 0.58 | 1.800 | 0.943 | 0.55 |

Tests pin: R8 and mean TTK <= 0.85x KN-44 for all eight; Gorgon and Drakon beat every other tier-2
gun on mean TTK; XR-2 is not the best; Weevil (cheapest) is the weakest; Dredge beats all 225-250
guns; a gun 50+ points dearer always has the lower mean TTK; identity checks (Marshal biggest pull
and 2-shot R8 kill, Drakon highest per-bullet damage + pen 3, Gorgon best sustained DPS + pen 3,
Dredge fastest LMG with a 48 mag, Weevil highest rpm, Man-O-War heavier/slower than XR-2, XR-2
tightest auto spread, Haymaker auto multi-pellet).

**Ammo (balance #10).** `ammoCost(id)` uses 0.3x the price for `tier === 2` guns
(`PRICES.wallAmmoMultTier2` if config defines it, else the local `TIER2_AMMO_MULT = 0.3`); tier 1
keeps `PRICES.wallAmmoMult` (0.5). New ammo: Weevil 60, XR-2 68, Marshal 16 68, Man-O-War 75,
Haymaker 12 75, 48 Dredge 83, Gorgon 90, Drakon 90. Level-1 prices unchanged.

Also updated the thundergun "lethal chip" test to derive the boss HP from `BOSS.thunderNearFrac`
(FIX-2 lowered it 0.15 -> 0.08, so the old 500 HP boss survived the 320 chip).

## WO7 (Agent F): perks, knife, tier-3 guns

**Perk multipliers (T2).** New extra export `weaponPerkMods(state, w) -> { reloadMult, rpmMult,
bulletDamageMult }` reads `player.perkMods(state.player)` through `import * as playerMod` (guarded:
missing export, no player, a throw or a non-positive value -> 1).
- Speed Cola: `startReload(w, state)` sets `reloadT = reloadTime x reloadMult`. `state` is a new
  **optional** second parameter; when omitted (player.js calls `startReload(w)`) the module uses the
  last state it saw (`tryFire`, `meleeAttack`, `updateBullets` — main.js calls the latter every
  frame, so the fallback is always current in-game). `resetWeaponDeps()` also clears that fallback.
  **For player.js (E):** passing `state` explicitly is preferred: `weapons.startReload(w, state)`.
- Double Tap II: fire interval = `60 / (rpm x rpmMult)` for every gun (Ray Gun and Thundergun
  included: BO3 Double Tap speeds every weapon), damage x `bulletDamageMult` for hitscan bullets only,
  shotgun pellets included. Ray Gun projectile / splash and the Thundergun cone are unchanged.
- **Death Machine decision:** exempt from all perk multipliers (rpm and damage). It is a timed
  power-up with fixed stats; 1200 rpm x 1.33 x 2 damage would be 3.2x its tuned DPS.

**Knife (T3).** `meleeAttack(state, player) -> hits`. Refused (returns 0, no event) while
`player.meleeCd > 0` or the player is down (`downT > 0` / `down`). Otherwise: `meleeCd =
MELEE.cooldown`, `meleeT = MELEE.swingTime`, cancels an active reload of the active weapon
(`player.getActiveWeapon`, guarded), pushes `{type:'slash', x, y, angle, ttl:0.18, maxTtl:0.18}`,
emits `melee:swing {x, y, angle}` (also on a whiff). Targets: live zombies with
`dist - z.radius - player.radius <= reach`, within `halfAngle` of `player.angle`, with wall LOS
(same `splashVisible` test as the ray gun splash / Thundergun: walls, windows, doors, perk machines
block); nearest first, max `maxTargets`. Damage `MELEE.damage` via `damageZombie(..., 'weapon', ...)`
(cause 'weapon' so knife kills pay `POINTS.perKill` and can drop power-ups; Insta-Kill lethality
and the boss 3 % cap live in damageZombie; Double Tap never applies). Survivors: knockback velocity
`MELEE.knockback` (90 px/s) away from the player with stun `ln(90/stunMinSpeed)/knockFriction`
(~0.25 s, the slide time, ~12 px); the boss is `pushZombie`d the same slide distance (no stun),
falling back to applyKnockback. Emits `melee:hit {zombieId, killed}` per target after the damage
(player.js pays `MELEE.bonusPoints` on `killed`). Accuracy stats are not touched by the knife.

**updateBullets** now leaves entries without a weapon projectile def (e.g. `kind: 'acid'`) untouched
instead of crashing on them (H keeps globs in `state.acidGlobs`, so this is only defensive).

**Tier-3 guns (T5).** `tier: 3`, `sprite: <id>`, box weight `boxOnly` (2) — `BOX_WALL_WEIGHT_IDS`
now keeps only tier-1 wall guns. `ammoCost` for tier 3 = `PERKS.ammoMultTier3` (0.3) x price:
HG 40 105, M8A7 113, Peacekeeper 120. **Deviation from the 1.5 table:** at the listed damage/rpm the
HG 40 (mean L3 R6-12 TTK 1.607 s) and M8A7 (1.231) / Peacekeeper (1.266) did not beat the Gorgon
(1.286) / Drakon (1.329), so damage (and HG 40 rpm) were raised; cost, class, mag, reserve,
reload, penetration and the M8A7 spread are as specified.

| id | cost | dmg (1.5 -> now) | rpm | mag | reload | pen | spread | R8 L3 TTK | mean L3 R6-12 |
|----|------|------|-----|-----|--------|-----|--------|------|------|
| hg40 | 350 | 95 -> 120 | 720 -> 800 | 40 | 1.9 | 1 | 0.05 | 1.050 | 1.157 |
| m8a7 | 375 | 115 -> 140 | 780 | 32 | 2.2 | 2 | 0.02 | 0.923 | 1.011 |
| peacekeeper | 400 | 135 -> 185 | 650 | 30 | 2.3 | 3 | 0.035 | 0.831 | 0.923 |
| (gorgon, best t2) | 300 | 175 | 480 | 48 | 4.0 | 3 | | 1.125 | 1.286 |

Tests (`tests/weapons.test.js` WO7 block): tier-3 defs/ammo/box weight, TTK (every tier-3 gun beats
every tier-2 gun on L3 mean and R8, price order, identities), penetration, perk mods (Speed Cola
explicit + fallback + auto-reload, Double Tap rpm/damage/pellets, Death Machine and Ray Gun
unchanged), acid passthrough, knife reach/arc/cap/order/events/slash/knockback, cooldown/down,
kill + reload cancel, wall LOS, boss push, real damageZombie (Insta-Kill, boss cap). Existing tests
updated: 24 wall ids, wall-id list + tier 3, "tier-1 keeps 0.5x" ammo loop.

Constants that could move to config: `SLASH_TTL` 0.18, `TIER3_AMMO_MULT` fallback.

## WO7 FIX-5 (docs/qa/wo7-balance.md #1, #2, #3)

- **Double Tap vs the boss (#1):** `hitscan(..., damage, bossDamage = damage)` takes a 9th
  parameter dealt instead to zombies of `kind === 'boss'`. `tryFire` passes
  `d.damage * min(mods.bulletDamageMult, BOSS.dtapDamageMult)` (config `BOSS.dtapDamageMult: 1`;
  a missing/non-finite value means no cap). The x1.33 rpm still applies to the boss; minions and
  normal zombies still take x2 (per target, so one penetrating ray can hit a zombie for x2 and the
  boss for x1). Ray Gun / Thundergun / Death Machine unchanged (they never had the x2).
- **Measured boss TTK with Double Tap** (balance harness `qa3/wo7/f1.mjs`, god mode, median, 12
  seeds unless noted): L1 R10 KN-44+Argus 33 s (none 46 s; +Speed Cola 26 s); L2 R14
  Man-O-War+KN-44 33 s; L3 R18 Peacekeeper+Gorgon 27 s over 24 seeds (none 36 s; +Speed Cola 20 s;
  mortal with Juggernog 27 s, 16/16 survived). L3 sits slightly under 30 s because its no-perk
  baseline is only 36 s and the kept x1.33 rpm alone takes ~25 % off.
- **HG 40 (#2):** damage 120 -> 130, penetration 1 -> 2. **M8A7 (#3):** penetration 2 -> 3.
  Tier-3 ordering unchanged (mean L3 TTK Peacekeeper < M8A7 < HG 40).
- Tests: tier-3 defs pin hg40 `damage: 130, penetration: 2`, m8a7 `penetration: 3`; the fire test
  expects pen 2/3/3; new "FIX-5 Double Tap vs boss" test (boss x1 between x2 zombies on one ray,
  rpm bonus kept, shotgun pellets, no-perk unchanged, hitscan default).
