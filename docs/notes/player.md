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
