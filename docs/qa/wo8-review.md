# WO8 QA-2 code review (Pack-a-Punch + Phase 4a economy)

Reviewer: QA-2 (code review). I read WORK_ORDER_8.md (Sections 0, 3 and 4), every WO8 notes section
and `docs/notes/integration-wo8.md`, including Phase 4a. `npm test` is green (547/547).

I checked each finding with Node probes that import the real `src/` modules, in the session
scratchpad (`wo8/p1.mjs` to `p5.mjs`). No `src/` or `tests/` file was edited.

**Summary:**

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 4 |

The machine's state machine, the descent hand-back, the boss math and the Phase 4a economy changes
are correct in every edge case I probed (see "Verified OK" at the end).

---

## MEDIUM

### M1. After a Quick Revive that removes Mule Kick, the player can end up holding nothing while a gun sits in slot 2

- **Where:** `src/player.js:105-120`, `removeAllPerks`: `p.activeSlot = 0` and `const w = p.weapons[0]`.
- **Why WO8 exposes it:** before WO8, slot 0 always held a gun (the start weapon is never removed).
  `shop.startPap` can now empty slot 0, while the player keeps using slot 2 or 3.
- **Repro** (verified in `p4.mjs` with the real modules):
  1. Hold MR6, Sheiva and KN-44 (Mule Kick and Quick Revive owned), with MR6 (slot 0) active.
  2. `startPap`: slot 0 empties and the player is switched to slot 1 (Sheiva).
  3. Press `3` to select KN-44 (slot 2).
  4. Take lethal damage, then let the Quick Revive pause run out.
  5. Result: `weapons = [null, 'sheiva']`, `activeSlot = 0`, `getActiveWeapon() = null`, and no
     `weapon:equipped` event is emitted. Firing does nothing and the HUD weapon readout is hidden.
  6. The PaP prompt reads "No weapon to upgrade" even though Sheiva is held.
  7. The player is revived (a few seconds of invulnerability) with empty hands until they press
     swap by hand.
- **Expected:** after the revive the player holds the first remaining gun, Sheiva (slot 1), and
  `weapon:equipped` fires.
- **Fix** (`player.js`, `removeAllPerks`): pick the first filled slot below `slots` instead of 0:

  ```js
  let k = 0; for (let i = 0; i < slots; i++) if (p.weapons[i]) { k = i; break; }
  p.activeSlot = k;
  ```

  Emit `weapon:equipped` for `p.weapons[k]` when it exists and no temp weapon is out. Add a test
  next to the WO8 Mule Kick tests in `tests/shop.test.js` (or in `tests/player.test.js`).
- **Resolution (FIX-A):** fixed. `removeAllPerks` switches to the first filled slot below the new slot count and emits `weapon:equipped` for it (empty hands at slot 0 when none is filled). Tests: `tests/player.test.js` and the real-module repro in `tests/shop.test.js`.

---

## LOW

### L1. Buying a gun at its wall while that gun is in the machine charges full price, and the copy is then silently destroyed

- **Where:**
  - `src/shop.js:139-154`: in `buildPrompt`, the `ownedWeapon` check ignores `shop.pap.weapon`.
  - `src/shop.js:235-250`: `buyWallWeapon`.
  - `src/shop.js:838-848`: `papReturnSlot` replaces the same-id copy.
- **Repro** (`p1.mjs` case 2):
  1. Hold `[mr6, kn44]` and put the KN-44 into the machine.
  2. At the KN-44 wall the prompt reads "Press F to buy KN-44 [150]". Buying it charges 150 and
     gives a base KN-44.
  3. `takePap` puts Warden's Wrath into that slot, and the bought copy disappears. Descending does
     the same.
- **Expected:** the gun in the machine counts as owned, as it already does for the mystery box
  (`heldIdsWithPap`). Refusing the purchase is better than a paid copy that vanishes.
- **Fix:** in `buildPrompt` and `buyWallWeapon`, when `papOf(state).weapon?.id === id`, return a
  blocked prompt (for example "KN-44 is in the Pack-a-Punch") and refuse with no charge. The
  touch ACTION button then greys out automatically.
- **Resolution (FIX-A):** fixed. The wall prompt is blocked ("KN-44 is in the Pack-a-Punch", `reason: 'inPap'`) and `buyWallWeapon` refuses with no charge and no event. Test in `tests/shop.test.js`.

### L2. With empty hands (the only gun is in the machine), the soldier is still drawn holding a gun

- **Where:** `src/render.js:3538-3543`, `resolveTorsoPose`. `activeWeapon(p)` is null, so
  `gunEntryFor(null)` → `guns.gunSpriteFor(null)` returns `GUN_SPRITES.default`.
- **Repro:**
  1. Start with only the MR6 and Pack-a-Punch it.
  2. For the 3 s of `working`, and until the gun is taken, the soldier shows the default gun art.
     The HUD correctly hides the weapon and firing does nothing.
- **Expected:** no gun in hand. Use the knife or free-hand torso, or skip the gun layer, when
  `activeWeapon(p)` is null.
- **Why it was missed:** the Phase 2 and 4a browser runs always had a second gun, so this state was
  never seen. It is cosmetic only.
- **Resolution (FIX-B):** fixed. `resolveTorsoPose` uses no gun layer and the free-hand `onehand`
  torso when `activeWeapon(p)` is null (the muzzle point falls back to the hand). Checked in the
  browser on L1 with only the MR6 in the machine: the soldier is empty-handed until the take.

### L3. The "ammo full" prompt shows the base name for an upgraded gun

- **Where:** `src/shop.js:147`, `` `${weaponName(id)} ammo full` ``.
- **Repro** (`p5.mjs`): holding a full Warden's Wrath at the KN-44 wall shows "KN-44 ammo full".
  The buy text ("Press F to buy ammo [281]") is correct.
- **Fix:** use `(owned.def && owned.def.name) || weaponName(id)`.
- **Resolution (FIX-A):** fixed. The full text uses `owned.def.name` ("Warden's Wrath ammo full"), and the buy text reads "Press F to buy upgraded ammo [281]". Test in `tests/shop.test.js`.

---

## INFO (design notes, no change required)

- **I1. The upgraded Ray Gun's self-splash also scales ×1.5.**
  - Where: `weapons.js:572-576`, `detonate` uses `pr.splashDamage * SELF_SPLASH_MULT`.
  - Self-damage goes from 30 to 45 HP (of 150) per self-hit, and the self-hit radius goes from
    90 to 135 px.
  - This follows literally from "splash × 1.5", but the lead may prefer the base splash for self
    damage: `WEAPONS[def.baseId].projectile.splashDamage`.
- **I2. The box refills an owned upgraded gun for free.**
  - Where: `shop.js:287-297`, `takeBoxWeapon` calls `refillAll(owned)`.
  - The box offer lasts 10 s. A player who buys the offered gun at a wall, upgrades it (3 s) and
    then takes the offer gets upgraded maxima for free, instead of paying 281-450.
  - This behaviour predates WO8, but it is worth more now. It is niche, because the machine is at
    least 6 tiles from any wall buy.
- **I3. The favourite weapon shows "★ <name>" if the favourite id made even one upgraded kill.**
  - Where: `main.js:166-173`, for example 300 base KN-44 kills plus 1 Warden's Wrath kill.
  - This is defensible (the gun became the upgraded one), and the stored id stays plain.
- **I4. Mule Kick lost while the slot-2 gun is inside the machine.**
  - With `[mr6, sheiva, <kn44 in machine>]`, the revive truncates to 2 slots. `takePap` then
    replaces the active gun (`p1.mjs` case 3: `['kn44*', 'sheiva']`).
  - This matches spec 1.1 ("if none, it replaces the active gun"), and the player still loses
    exactly one gun, as losing Mule Kick should cost.
  - When the gun came from slot 0 instead, slot 2 is dropped as usual and the upgraded gun
    returns to slot 0 (case 3b).

---

## Verified OK (probes with the real modules)

- **Slot rules:**
  - Paying with the third slot active switches to the next filled slot.
  - Holding nothing, then a wall buy or box take: the new gun lands in the first empty slot and the
    upgraded gun returns to the next empty slot (`['sheiva', 'kn44*']`).
  - Taking when all slots are full replaces the active gun.
  - A duplicate id is replaced, so no duplicate is ever held.
  - A Death Machine picked up while the machine works: `takePap` sets the slot without
    `weapon:equipped`, and `clearTemporary` equips the upgraded gun later.
  - While the player is down: `updatePap` keeps ticking, and taking is refused until the revive.
- **Descent:**
  - A `working` or `ready` gun comes back upgraded to its original slot and is active.
  - `papCount` goes 0 → 1 and stays at 1 over a second descent, so it is counted exactly once.
  - The machine resets to idle.
  - Restart builds a fresh state, so the machine and the count reset. Render `papAnim` clears on
    `game:restart`.
- **Box:** `tickBox` rolls with `heldIdsWithPap`, which excludes the gun in the machine and any held
  (upgraded) id.
- **Buying at a wall while the upgraded copy is held:** the buy goes to `buyAmmo` and charges
  `ammoCost(id, true)` (281 for the KN-44). `refillAll` fills to the upgraded maxima (45/360), and
  the def stays upgraded, so the gun is never downgraded.
- **`ammoCost(id, true)`:**
  - Guns without a wall price return `Infinity` (the probe's JSON output printed it as `null`):
    `mr6`, `locus`, `dingo`, `brm`, `raygun`, `thundergun`, `deathmachine`. The wall-buy prompt
    never reaches them.
  - The cap holds: `min(450, round(3.75 × base))`, for example Peacekeeper 450, Sheiva 94 and
    M8A7 424.
  - The strict `=== true` protects `ids.map(ammoCost)`.
- **`UPGRADES` immutability:**
  - `UPGRADES`, each def and the nested `projectile` / `cone` objects are frozen.
  - `WEAPONS` is untouched (KN-44 damage 70, Ray Gun splash 300 against 140 / 450 upgraded).
  - `upgradeWeapon` does not compound.
- **Damage per target** (stubbed `damageZombie`, one penetrating ray through minion, boss, minion
  and normal):

  | Gun | Minions and zombies | Boss |
  |---|---|---|
  | KN-44★ | 140 (280 with Double Tap) | 87.5 with or without Double Tap |
  | Peacekeeper★ | 370 / 740 | 231.25 |
  | Locus★ (pen 4) | 800 / 1600 | 500 |

  - **Ray Gun★:**
    - direct hit on the boss 1250, splash 375;
    - direct hit on a minion 2000, splash 450;
    - base gun 1000 / 300.
  - **Thundergun★:** the boss at 340 px takes `thunderNearFrac` (8 %) because of the larger 375 px
    kill band. The base gun only knocks it back.
  - The 3 % per-hit cap stays in `damageZombie`.
- **Ammo and reload:** Max Ammo (`refillReserve`) and Speed Cola (`reloadTime` 2.2 → 1.1) read the
  upgraded def.
- **Mega door cost:** `megaDoorCost` gives 250 / 500 / 750 / 1000 / 1250 ... and loop levels
  continue. `startLevel(0)` on restart stamps 250. The shop prompt, `buyMegaDoor` and the render
  plate all read `megaDoor.cost`.
- **Scores:** `normalizeEntry` gives `pap: count(o.pap)`, so old records load as 0.
  `recordRun(stats, { pap })` stores the field.
- **Favourite tally:** knife kills undo both the base and the upgraded tally. The stored entry keeps
  the plain id.
- **Render tint caches are bounded:**
  - `tintCache` is a WeakMap keyed by sprite, with at most 9 entries per sprite.
  - `papGunCache` is a WeakMap keyed by the base gun entry.
  - The torso+gun cache gets one extra entry per gun.
- **Listener leaks:** none from WO8. Render (`pap:done`), HUD (`pap:done`) and audio (`pap:*`)
  subscribe through their `unsubs` arrays, `restartGame` runs `events.clearAll()`, and descents
  never re-init.
- **Touch:** `setTouchPrompt(text, { blocked, cantAfford })`:
  - A blocked prompt suppresses both the `interact` edge and `interactHeld`.
  - A null or empty text clears both flags and hides and releases the button.
  - The main.js key includes the flags, so there is no per-frame DOM churn.
  - The barricade and PaP take prompts are never blocked.
