# shop.js notes (Agent I)

## What was built

`src/shop.js` implements WORK_ORDER 5.9 against the 3.6 contract:

- `initShop(state)`: resets `state.shop.prompt` and `state.shop.box`. It subscribes to no events.
- `updateShop(state, input, dt)`: ticks the box state machine every frame, even when the player
  is away from the box. Then it calls `map.nearestInteractable(map, x, y, PLAYER.interactRange)`,
  builds `state.shop.prompt`, handles held repair (`input.interactHeld`) and edge interact
  (`input.interact`). The prompt is rebuilt after an action so the HUD sees the new state in the
  same frame. When the player is down (or there is no map or player) the prompt is `null`.
- `buyWallWeapon(state, wallBuy)`: if the player already owns the gun, it hands off to
  `buyAmmo`. Otherwise it checks points, calls `spendPoints` then `giveWeapon`, and emits
  `purchase:made {kind:'weapon', id, cost}`. When the player cannot pay it emits
  `purchase:denied {kind:'weapon', cost, have}`. Returns a bool.
- `buyAmmo(state, weaponId)`: the cost is `weapons.ammoCost(id)`. It refuses **silently** (no
  charge, no event, returns false) when `reserve >= def.reserve`. Otherwise it spends the points,
  calls `weapons.refillAll(w)` and emits `purchase:made {kind:'ammo'}`. When the player cannot
  pay it emits `purchase:denied {kind:'ammo'}`.
- `spinBox(state)`: works only when the box is `idle`. It charges `boxPrice(state)`, emits
  `purchase:made {kind:'box', id:'box', cost}` and enters `spinning`. When the player cannot pay
  it emits `purchase:denied {kind:'box'}`.
- `takeBoxWeapon(state)`: works only when the box is `offering`. It calls `giveWeapon` and sets
  the box back to `idle`.
- `boxPrice(state)`: returns `PRICES.fireSaleBox` while
  `state.powerups.active.fireSale > state.time`, otherwise `PRICES.mysteryBox`.

### Box state machine (`state.shop.box`)

`{ state: 'idle'|'spinning'|'offering', timer, weaponId, cycleT }`. The `cycleT` field is an
addition to the state.js shape. It is the cosmetic cycle accumulator.

- **idle → spinning**: happens in `spinBox`. `timer = MYSTERY_BOX.spinSeconds`. While spinning,
  `weaponId` changes to a random box gun every 0.1 s (`state.rng.pick`) so render can show the
  flourish.
- **spinning → offering**: the final `weaponId` is drawn by weight from `BOX_WEAPON_IDS`, with
  every gun the player currently holds removed first. That is the same as re-rolling until the
  gun is not held, and it never loops. Then `timer = offerSeconds` and **`box:opened
  {weaponId}` is emitted at this moment** (when the offer is revealed, not when the player pays).
- **offering → idle**: happens when the player takes the gun, or when the timer runs out. An
  expired offer is lost, with no refund.

The weights are 3 for wall guns (ids in `WALL_WEAPON_IDS`), 2 for box-only guns and 1 for
`raygun`. They are computed in shop.js from the weapons.js lists (`boxWeights()`).

### Barricade repair

This runs while `input.interactHeld` is set and the nearest interactable is a barricade with
`boards < maxBoards`:

1. `player.repairTimer += dt`.
2. Every `REPAIR_INTERVAL` (0.8 s), `map.repairBoard(map, id)` is called.
3. If `boardsThisRound < POINTS.barricadeBoardsPerRoundCap`, the player gets
   `addPoints(POINTS.barricadeBoard)` at the barricade center. The cap check happens before the
   counter is incremented.
4. `player.boardsThisRound++` happens on every board, even past the cap.

The timer resets to 0 when the player lets go of F, walks away or finishes the barricade.
Zombies tearing the same barricade are **not** checked. Tearing and repairing race each other,
as in BO3.

## Prompt shape (`state.shop.prompt`), for hud.js

`null`, or:

```js
{
  kind: 'wallbuy' | 'ammo' | 'box' | 'boxOffer' | 'barricade',
  text: string,          // ready to display
  cost: number | null,   // 0 for boxOffer/barricade; null only if a weapon def is missing
  canAfford: boolean,    // player.points >= cost (always true for boxOffer/barricade)
  blocked: boolean,      // true only for 'ammo' when reserve is already full (the action does nothing)
  weaponId: string|null, // wallbuy/ammo/boxOffer
  barricadeId?: number,  // barricade only
}
```

HUD suggestion: grey the prompt out when `!canAfford || blocked`.

The text for each case:

| Case | `kind` | `text` |
|------|--------|--------|
| Wall gun not owned | `wallbuy` | `Press F to buy <Name> [cost]` |
| Wall gun owned | `ammo` | `Press F to buy ammo [ammoCost]` |
| Wall gun owned, reserve full | `ammo` | `<Name> ammo full`, with `blocked: true` |
| Box idle | `box` | `Press F for Mystery Box [95]`, or `[10] FIRE SALE` |
| Box offering | `boxOffer` | `Press F to take <Name>` |
| Box spinning | none | the prompt is `null` |
| Damaged barricade | `barricade` | `Hold F to rebuild barricade` |

## Assumptions and decisions

- "Owned" and "held" are read directly from `player.weapons[*].id`. The `tempWeapon` (Death
  Machine) is ignored, so buying while the Death Machine is up still works.
  `player.giveWeapon` decides which slot gets the gun.
- Fire Sale is read from `state.powerups.active.fireSale` rather than from
  `powerups.isActive`. The semantics are the same, and it keeps `boxPrice` pure and testable
  without powerups.js.
- If the player buys the offered gun off a wall during the offer, `takeBoxWeapon` refills that
  gun (`refillAll`) instead of giving a duplicate.
- Points are checked (`player.points < cost`) before `spendPoints`, so `purchase:denied` carries
  an accurate `have`.
- The box accepts a new spin as soon as it is idle again. There is no cooldown and no teddy
  bear (both out of scope).
- Extra exports beyond the contract (used by the tests): `boxWeights`, `pickBoxWeapon`,
  `tickBox`, `buildPrompt`, `heldWeaponIds`, `fireSaleActive`, `REPAIR_INTERVAL`,
  `BOX_CYCLE_INTERVAL` and `BOX_WEIGHTS`.

## Constants to move to config.js (TODO(integrator))

- `REPAIR_INTERVAL = 0.8`
- `BOX_CYCLE_INTERVAL = 0.1`
- `BOX_WEIGHTS = { wall: 3, boxOnly: 2, raygun: 1 }`

## Tests

`tests/shop.test.js`. The pure tests always run:

- Fire Sale price, including an expired Fire Sale that has not been pruned yet
- Box weights, and the weighted distribution
- The box never offers a held gun (200 seeds)
- The spin cycles, reveals the offer and emits `box:opened`
- An offer expires and is lost
- All prompt variants for the box and the barricade
- `spinBox` refuses while the box is busy

These tests use `{ skip }` while the other modules are stubs: wall purchase deducts and equips,
denied when broke, ammo refused at full reserve, fire-sale spin charges 10 and the gun can be
taken, and the barricade hold repairs and pays. The skip is based on
`String(fn).includes('not implemented')`.

## WO2 (Agent G, WORK_ORDER_2 3.9)

- `SHOP.boxWeights` is now `{ wall: 3, boxOnly: 2, wonder: 1 }`. `boxWeights()` gives
  `BOX_WEIGHTS.wonder` to every id in `weapons.WONDER_WEAPON_IDS` (ray gun, thundergun), so the
  thundergun enters the box automatically via `BOX_WEAPON_IDS`. Death Machine stays out.
- Tests: default `boxWeights()` matches `weapons.BOX_WEIGHTS`, thundergun/raygun at weight 1,
  and a seeded rng can roll the thundergun (and never while it is held).
- Naming: `shop.BOX_WEIGHTS` (and the clearer alias `shop.BOX_CLASS_WEIGHTS`) is the per-class
  `{ wall, boxOnly, wonder }` config map; `weapons.BOX_WEIGHTS` and `boxWeights()` are the per-id map.
  The old name is kept so existing importers and tests do not break.
- Performance (review #8): the default per-id weights and id list are computed once at module load
  (`DEFAULT_BOX_WEIGHTS`, frozen) and used as the default for `tickBox` and `pickBoxWeapon` and for
  the `spinBox` start pick, so the per-frame `tickBox` no longer allocates. Signatures unchanged.

## WO4 (Agent C, WORK_ORDER_4 2.3): buyable doors

- New prompt case: `hit.kind === 'door'` (closed door from `map.nearestInteractable`) gives
  `{ kind: 'door', doorId, weaponId: null, text: 'Press F to open door [75]', cost: door.cost,
  canAfford, blocked: false }`. An already-open door ref returns `null`.
- New export `buyDoor(state, door)`: returns false for a missing/open door. It checks points
  first, then `spendPoints`, then `openDoor(state.map, door.id)`, then emits
  `purchase:made { kind: 'door', id: door.id, cost }` and pushes
  `{ type: 'text', x: door.cx, y: door.cy, text: 'DOOR OPENED', color: '#ffd36b', ttl: 1.2, maxTtl: 1.2 }`
  to `state.effects` (render's `drawText` reads x, y, text, color, ttl/maxTtl). The centre falls
  back to the bbox centre when `cx/cy` are missing. When the player is broke it emits
  `purchase:denied { kind: 'door', cost, have }` with no charge. If `openDoor` returns `false`
  (unknown id), the points are refunded directly and no event fires.
- `updateShop`: interact on a door hit calls `buyDoor`, then rebuilds the prompt (so it is null
  once the door is open).
- map.js is imported as a namespace (`import * as mapMod`) so shop.js still links while
  `openDoor` is being added. **Test injection:** if `state.map.openDoor` is a function, it is
  called as `state.map.openDoor(state.map, id)` in place of `map.js`'s `openDoor`. Real maps do not carry this
  property, so production always uses the module function.
- Exports added: `buyDoor`, `DOOR_TEXT`.
- Tests (layout-independent, fake door + fake map with an `openDoor` spy): prompt text,
  canAfford and doorId; buy deducts/opens/emits/pushes the text effect; a repeat does nothing;
  denied when broke; refund on an unknown id. One real-map `updateShop` test skips itself until
  `map.loadMap().doors` exists, and returns early if another interactable is nearer than the door.

## WO5 (Agent G, WORK_ORDER_5 3.3): mega door and stairs

- Prompt `kind: 'megadoor'` (hit from `map.nearestInteractable`, ref `map.megaDoor`): `null` when
  the mega door is open or sealed. `blocked = !allDoorsOpen(map)`; blocked text
  `'MEGA DOOR — open all doors first'` (`MEGA_BLOCKED_TEXT`), otherwise
  `'Press F to open MEGA DOOR [250]'`. `cost = DOORS.megaCost`, `canAfford`, `doorId` (`'mega'`
  if the ref has no id). `allDoorsOpen` is `map.allDoorsOpen` when map.js exports it, else
  every `map.doors[]` entry is open.
- Prompt `kind: 'stairs'` (ref `map.stairs`, only when `open`): `'Press F to descend'`
  (`STAIRS_TEXT`), cost 0, never blocked.
- `buyMegaDoor(state)`: false (no charge, no event) when there is no mega door, it is open or
  sealed, a transition is running, or a normal door is still closed (blocked). Broke:
  `purchase:denied { kind: 'megadoor', cost, have }`. Otherwise `spendPoints(DOORS.megaCost)`,
  `map.openMegaDoor(state.map)` (test injection: `state.map.openMegaDoor` wins, like
  `openDoor`), refund with no event if it returns `false`, then
  `purchase:made { kind: 'megadoor', id: 'mega', cost }` and a `'MEGA DOOR OPENED'` text effect
  at the door centre (same style as `DOOR OPENED`).
- `useStairs(state)`: needs `map.stairs.open` and no running transition, then
  `level.beginDescent(state)` (namespace import, guarded). Returns a bool.
- `updateShop`: while `state.transition` is set the prompt is `null`, `repairTimer` is reset and
  nothing else runs (the box timer does not tick either). Interact dispatches `megadoor` ->
  `buyMegaDoor`, `stairs` -> `useStairs` (prompt cleared once the descent starts).
- Box weights: `boxWeights()` now defaults its wall list to `weapons.BOX_WALL_WEIGHT_IDS`
  (level-1 wall guns) when weapons.js exports it, so the level-2 wall guns keep the boxOnly
  weight 2 as Agent D's `weapons.BOX_WEIGHTS` expects (the existing parity test was failing).
- New exports: `buyMegaDoor`, `useStairs`, `MEGA_BLOCKED_TEXT`, `MEGA_TEXT`, `STAIRS_TEXT`.
- Tests (fake maps only): blocked/unblocked prompt text and cost, open/sealed -> null, purchase
  spends/opens/emits/pushes text, repeat refused, broke -> denied, blocked -> no charge and no
  `openMegaDoor` call, stairs prompt only when open, `useStairs` starts one descent, and no
  prompt / no purchase during a transition.
