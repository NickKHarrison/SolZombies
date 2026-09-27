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
| Wall gun owned, reserve full | `ammo` | `<Name> ammo full`, with `blocked: true` (upgraded: `<Upgraded name> ammo full`) |
| Wall gun owned and upgraded | `ammo` | `Press F to buy upgraded ammo [cost]` |
| Wall gun inside the Pack-a-Punch | `wallbuy` | `<Name> is in the Pack-a-Punch`, `blocked: true`, `reason: 'inPap'` |
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

## WO7 (Agent G): perks

- Prompt (`buildPrompt` kind `perk` -> `perkPrompt(state, machine)`):
  `{ kind: 'perk', weaponId: null, perkId, machineId, cost, canAfford, blocked, text }`.
  Texts: `Press F for Juggernog [250]`; blocked `Quick Revive sold out` (checked first),
  `Already have <name>`, `Perk limit reached` (`perks.length >= PERKS.maxPerks`).
  `perkBlockReason(player, machine)` returns `'soldout' | 'owned' | 'limit' | 'unknown' | null`.
- `buyPerk(state, machine) -> bool`: refused (false, no charge, no event) when blocked, during a
  level transition, or while `player.down` / `player.downT > 0`. Unaffordable ->
  `purchase:denied { kind: 'perk', cost, have }`. Otherwise `spendPoints`, then
  `player.addPerk(state, perkId)` (namespace read; a list-only fallback is used if player.js has
  no `addPerk`); if addPerk returns false the points are refunded silently. On success:
  `purchase:made { kind: 'perk', id: perkId, cost }` then `perk:bought { perkId, cost }`.
  `stats.perksBought` is counted by `addPerk`, not here.
- Quick Revive: buyable while not held and `player.reviveUses < maxUses` (and under the perk
  cap, which addPerk enforces). A successful purchase increments `player.reviveUses`.
- Sold out: `syncPerkMachines(state)` sets `soldOut` on every `revive` machine of `state.map`
  from `reviveUses >= maxUses` (all other machines false) and bumps `map.version` only when a
  flag changes. Called after a revive purchase and at the top of every `updateShop`, so the
  machines of a newly loaded level pick up the sold-out state on the first frame.
- `updateShop` also hides the prompt while `player.downT > 0` (Quick Revive pause).
- Helpers exported for tests/HUD: `perkDef`, `reviveSoldOut`, `perkBlockReason`, `perkPrompt`,
  `syncPerkMachines`. Constants that could move to config: none (all read from `PERKS`).

## WO7 FIX-3

- **L2:** `updateShop` calls `syncPerkMachines(state)` before the transition early-return. A sold-out Quick Revive on a level loaded mid-fade is dark from the first frame.
- **Balance #6:** Quick Revive now has an escalating price, `PERKS.list.revive.costs: [50, 150, 300]`, chosen by purchase number (`player.reviveUses`, clamped to the last entry).
  - New export `perkCost(player, perkId)`: it uses `costs` when present, else `def.cost`, and returns `null` for an unknown perk.
  - `perkPrompt` text and cost, `buyPerk` charge, `purchase:made`, `perk:bought` and `purchase:denied` all use it.
  - `syncPerkMachines` also sets `machine.price` to the next price and bumps `map.version` when it changes.
  - **Open item for render:** the machine plate still paints `def.cost`. It should use `m.price` when that is finite.


## WO8 (Agent B): Pack-a-Punch state machine

State: `state.shop.pap = { state: 'idle'|'working'|'ready', timer, weapon, slot, baseId }`
(`initShop` resets it to idle, so new game / restart empties the machine; `level.js` (INT) owns the
descent hand-back). Config read through the namespace with defaults (`PAP.cost` 500,
`ammoCost` 450, `workSeconds` 3). weapons' WO8 exports are read through `weaponsMod` and guarded
(`canUpgrade`, `upgradeWeapon`, `isUpgraded`, `upgradedName` all have local fallbacks).

- `papBlockReason(state)` -> `'busy'` (not idle) | `'powerup'` (tempWeapon in hand, or
  `canUpgrade` says so, e.g. Death Machine / no UPGRADES entry) | `'upgraded'` | `'none'` (active
  slot empty) | `null`.
- `papPrompt(state)` (also via `buildPrompt` for hit kind `'pap'`):
  - idle: `{ kind: 'pap', weaponId, cost, canAfford, blocked, reason?, text }`, text
    `Press F to Pack-a-Punch KN-44 [500]`, or blocked `<name> is already upgraded`,
    `Cannot upgrade a power-up weapon`, `No weapon to upgrade`.
  - working: kind `'pap'`, blocked, reason `'busy'`, `Machine busy`.
  - ready: `{ kind: 'papTake', weaponId, cost: 0, canAfford: true, blocked: false,
    text: 'Press F to take <upgraded name>' }`.
- `startPap(state)`: refused (false, no charge, no event) when blocked, during a transition or while
  down. Cannot afford -> `purchase:denied { kind: 'pap', id, cost, have }`. Otherwise spends, cancels
  the gun's reload, empties its slot, `working` with `timer = workSeconds`, switches the player to
  the next filled slot (`weapon:equipped`); with none left the player holds nothing
  (`player.getActiveWeapon` -> null, `updatePlayer` returns before firing: no player.js change
  needed, covered by a test). Emits `pap:start { weaponId, slot }` then
  `purchase:made { kind: 'pap', id, cost }`.
- `updatePap(state, dt)`: counts `timer` down while working; at <= 0 calls
  `weapons.upgradeWeapon(w)` and goes `ready`. `ready` never times out. main.js should call it
  every playing frame after `updateShop`.
- `takePap(state)`: ready only, not while down / transition. Slot (`papReturnSlot`, exported):
  original slot if it still exists and is empty; a slot holding the same id (bought again
  meanwhile) is replaced so no duplicate exists; else first empty slot; else the active slot
  (replacing that gun; also covers a lost Mule Kick slot). The gun becomes active
  (`weapon:equipped` unless a tempWeapon is in hand), `stats.papCount++`, machine idle,
  `pap:done { weaponId }`. Upgrades defensively if it was somehow not upgraded yet.
- `updateShop`: F at a `'pap'` hit -> `takePap` when ready, `startPap` when idle, nothing while
  working.
- Wall ammo: `ammoPrice(w)` (exported) = `ammoCost(id, isUpgraded(w))`, so an upgraded held gun's
  prompt is `Press F to buy ammo [450]` and `buyAmmo` charges 450.
- Box: the roll excludes the gun inside the machine as well as the held ones.
- Tests (`tests/shop.test.js`, "WO8 ..."): full flow + events, empty-hands (no fire), slot rules
  (refilled slot, all full, duplicate, Mule Kick slot lost), blocked cases (Death Machine, none,
  cannot afford, down, transition), box exclusion, updateShop routing + 450 ammo.

## WO8 Phase 4a (fixer)
- Mega door: the prompt and `buyMegaDoor` use the door's own `megaDoor.cost` (set per level by
  `level.startLevel`: 250 / 500 / 750 / 1000 / ...), falling back to `DOORS.megaCost`.
- Upgraded wall ammo now costs `weapons.ammoCost(id, true)` = `min(450, round(3.75 x base))`
  (KN-44 281, Peacekeeper 450); the prompt shows it. Tests updated / added.

## WO8 FIX-A (QA review L1 / L3, playtest #3)
- L1: a gun inside the Pack-a-Punch (working or ready) counts as owned at its wall. The prompt is
  blocked ("<Name> is in the Pack-a-Punch", `reason: 'inPap'`) and `buyWallWeapon` refuses with
  no charge and no event. Once taken, the wall sells (upgraded) ammo as usual.
- L3 / playtest #3: for an upgraded gun the ammo prompts read "Press F to buy upgraded ammo [281]"
  and "<Upgraded name> ammo full" (`owned.def.name`). The touch label follows (main.js strips
  "Press F to").
