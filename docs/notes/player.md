# player.js notes (Agent B)

## What was built
`src/player.js` implements every export in WORK_ORDER 3.6 for the player:
- `createPlayer(x, y)`: entity shape from 3.5 (`weapons` sized by `PLAYER.weaponSlots`).
- `initPlayer(state)`: `zombie:killed` -> `stats.kills++` and `addPoints(perKill, x, y)` (skipped for
  cause `'debug'`); `zombie:hit` -> `addPoints(perHit)` only if `POINTS.perHit` is nonzero;
  `round:start` -> `player.boardsThisRound = 0`. Keeps its own unsubscribers and drops them on
  re-init, so calling `initPlayer` twice never double-awards points (even without `events.clearAll()`).
- `updatePlayer(state, input, aim, dt)`: order is regen tick -> aim angle -> movement (normalized, sprint
  mult, `map.resolveCircle`) -> swap -> `weapons.updateWeapon` on the active weapon -> reload (`R`) ->
  fire -> `w.triggerHeld = !!input.fire`. Does nothing while `down`.
- `damagePlayer`, `addPoints` (double points through `powerups.isActive`), `spendPoints`,
  `getActiveWeapon`, `giveWeapon`, `hasWeapon`, `equipTemporary`, `clearTemporary`.
- `tests/player.test.js`: 18 tests (regen timing, damage/down, spendPoints refusal, movement/sprint,
  giveWeapon slot logic, temp weapon, listeners, double points, kill points, swap, fire/auto-reload).
  Tests needing powerups/weapons are skip-guarded on stubs; they currently run and pass against the
  real modules.

## Assumptions / decisions
- Sprint requires moving and holding sprint, and is cancelled while `input.fire` is held.
- Fire direction is the player's `angle` (atan2 to aim); if aim equals the player position the last
  angle is kept. Origin is pushed `radius + 4` along it.
- Auto-reload: if `tryFire` returns false with an empty mag, reserve > 0 and not reloading, player calls
  `startReload` (weapons.js also does this; it is idempotent).
- Manual reload (`R`) is ignored while a temporary weapon (death machine) is held.
- Only the active weapon is ticked with `updateWeapon`; swapping, `giveWeapon` into an empty slot and
  `equipTemporary` cancel the previous weapon's reload (`reloading=false, reloadT=0`).
- Swap: `input.slot` (1/2) selects that slot if it holds a weapon; otherwise `input.swap` cycles to the
  next non-empty slot. Both are blocked while `tempWeapon` is set. `slot` absent/0 is ignored.
- Regen: `regenTimer` counts down to 0 first; healing starts on the following frames (leftover dt of
  the frame the timer expires is not applied).
- `damagePlayer` ignores non-positive amounts, a downed player, and `invulnerable` (debug god mode).
- `player:down` payload: `round` = `state.rounds.round` (fallback `stats.roundReached`), `kills` =
  `stats.kills`, `points` = current `player.points` (not lifetime `stats.pointsEarned`).
- Debug kills (`cause: 'debug'`) award no points and do not increment `stats.kills`.
- `addPoints` rounds the award, returns the awarded delta, and only includes `x,y` in the payload
  when both are provided. `spendPoints` emits `points:changed` with a negative delta (no x,y) so the
  HUD updates; spending 0 returns true without emitting.
- If `state.map` is null, movement skips collision (used by tests).

## Contract deviations / extensions (non-breaking)
- `weapon:equipped` is also emitted on swap and on `clearTemporary` (with the restored slot), and
  on `equipTemporary` with `slot: -1` to mean "temporary slot".
- `giveWeapon(state, weaponId)` also accepts an already-built Weapon object instead of an id; it
  returns the equipped Weapon.
- `addPoints` returns the awarded amount (contract lists no return value).

## Constants to move to config (TODO(integrator))
- `MUZZLE_OFFSET = 4` -> `PLAYER.muzzleOffset`.

## WO3
- `PLAYER.regenPerSec` 60 -> 1 (`regenDelay` unchanged at 4.0). `tickRegen` is unchanged: it adds
  `regenPerSec * dt` each frame (fractional, clamped to maxHealth). The frame on which
  `regenTimer` reaches 0 does not heal; healing starts the frame after.
- `tests/player.test.js`:
  - The existing "regen ... up to max" test previously used a fixed 10 s heal loop. It now
    derives the loop length from `maxHealth / regenPerSec`.
  - Three WO3 tests were added:
    - +10 HP in 10 s after the delay;
    - 60 s from 50 HP reaches ~110, not 150, and sub-1-HP frames accumulate;
    - damage mid-regen resets the full 4 s delay.
- No other test hardcoded the old 60 (`contracts.test.js` only type-checks `regenPerSec`).
- Balance consequence: see `docs/qa/balance.md` "WO3 regen".

## WO7 (Agent E) — perks, Quick Revive, knife
- New player fields (`createPlayer`): `perks: []`, `reviveUses: 0`, `invulnT: 0`, `downT: 0`,
  `meleeCd: 0`, `meleeT: 0`.
- New exports: `hasPerk(player, id)`; `perkMods(player)` -> `{ reloadMult, rpmMult,
  bulletDamageMult, speedMult, sprintMult, weaponSlots, maxHealth }` (neutral values with no
  perks / null player; read by weapons.js); `addPerk(state, id) -> bool`;
  `removeAllPerks(state, reason = 'debug')`.
- `addPerk` refuses unknown ids, duplicates and a full bar (`PERKS.maxPerks`). It then syncs
  `maxHealth` and the weapon-slot count to `perkMods` (Juggernog -> 250 and heals to full; Mule
  Kick -> `weapons.length` 3 with a `null` third slot, which `giveWeapon` fills first) and does
  `stats.perksBought++`. It does NOT touch `reviveUses` or check the 3-use limit: `shop.buyPerk`
  owns both (increment + sold-out). Debug `givePerk` via `addPerk` therefore bypasses the limit.
- `removeAllPerks` clears `perks` and emits `perk:lost { perkId, reason }` once per perk in
  purchase order (no-op when there are none). When Mule Kick is lost, the third weapon is dropped
  (`weapons.length` back to 2). If slot 3 was active, its reload is cancelled, `activeSlot = 0`,
  and `weapon:equipped { slot: 0 }` fires (suppressed while a temporary weapon is held).
  `maxHealth` goes back to `PLAYER.maxHealth` and `health` is clamped to it.
- Quick Revive: `damagePlayer` that takes health to 0 while holding `revive` sets
  `downT = downSeconds` (1.5), keeps `down = false` (it is not game over) and emits
  `player:downed { reviveIn }`. `player:down` is not emitted. While `downT > 0`, `updatePlayer`
  only counts it down: no regen, movement, aim, swap, knife or fire, and the active weapon's
  `triggerHeld` is set to false. `damagePlayer` ignores all damage. When `downT` reaches 0, the
  player revives: `removeAllPerks(state, 'revive')` (this includes revive itself), then
  `health = maxHealth` (150), `regenTimer = 0`, `invulnT = invulnSeconds` (2), and
  `player:revived { health }` is emitted. `reviveUses` is unchanged. Without the perk, 0 HP is the
  old game over (`down = true`, `player:down`).
- `invulnT` counts down at the top of `updatePlayer`, and `damagePlayer` ignores damage while it
  is > 0. zombie.js/boss.js (H) read `downT` / `invulnT` to stop attacking.
- Stamin-Up: move speed = `PLAYER.speed * speedMult * (sprinting ? PLAYER.sprintMult * sprintMult : 1)`.
- Swapping: slot selection already worked for any length, so digit 3 (`input.slot === 3`, from K)
  selects slot index 2 when it exists, and Q/wheel cycles through 3 slots with Mule Kick.
- Knife: `meleeCd` and `meleeT` count down by dt in `updatePlayer`. On `input.melee`, the player
  calls `weapons.meleeAttack(state, player)` (namespace import, guarded with `typeof`) after
  aim/move and before swap/fire. weapons.js enforces the cooldown and cancels any reload.
  Decision: firing is blocked while `meleeT > 0` (the swing animation).
- Knife kill bonus (the decision): the base `POINTS.perKill` still comes from the existing
  `zombie:killed` listener, whatever the cause. A new `melee:hit` listener in `initPlayer` pays
  `MELEE.bonusPoints` (x2 under Double Points, through `addPoints`) and does
  `stats.meleeKills++` when `killed` is true. The points popup uses the payload's `x,y` if
  present, otherwise the player position. INT must NOT also increment `meleeKills` in main.js,
  and weapons.js must not pay the bonus itself.
- Persistence: `level.startLevel` reuses `state.player` (it only moves or heals it), so perks,
  the third slot and `reviveUses` carry across descents. A restart runs `main.buildState` ->
  `createPlayer`, so everything resets.
- Tests: 14 new WO7 tests in `tests/player.test.js` (fields, perkMods, cap/unique/perksBought,
  Juggernog gain+loss, Mule Kick slot/cycling/digit 3, Mule Kick loss with active slot 2, perk:lost
  order, no-revive game over, the full revive flow including damage immunity while down, perk
  stripping, invulnerability expiry and game over after, Stamin-Up speeds, knife timers, no fire
  mid-swing, knife kill bonus). The `meleeAttack` call test is skip-guarded until F exports it.
