# WO8 Phase 2 integration (Pack-a-Punch)

`npm test`: **543/543** (538 + 5 new). `node --check` is clean on every `src/`, `src/levels/` and `tests/`
file. Agent G's economy report (`docs/qa/wo8-economy.md`) is **not** applied; that happens in Phase 4.

## Changes
- **`src/main.js`**
  - `shop.updatePap(s, dt)` runs every playing frame, right after `updateShop` (called through the
    guarded `call`).
  - The game-over summary gets `papCount` explicitly, in both the ranked and the unranked branch.
  - `scores.recordRun` gets `{ perks, pap: stats.papCount }`.
  - New debug hooks:
    - `pap()`: the machine summary (`state`, `timer`, `slot`, `baseId`, `weaponId`, `name`,
      `upgraded`, `papCount`, `machine` rect).
    - `papStart()` / `papTake()`: the real `shop.startPap` / `takePap`, so price, blocked cases and
      events all apply. There is no distance check.
    - `upgrade()`: `weapons.upgradeWeapon` on the active gun. It is free, emits no event and is not
      counted.
- **`src/level.js`**
  - `startLevel` calls `returnPapWeapon(state)` after resetting the box.
  - A `working` or `ready` gun is upgraded if it is not already, then goes back through
    `shop.papReturnSlot(player, pap.slot, id)` (with a local fallback) and becomes active, emitting
    `weapon:equipped`.
  - It is counted in `stats.papCount` because it was paid for but never taken; `takePap` counts only
    on take, so nothing is counted twice.
  - `shop.pap` is always reset to the idle shape.
  - There is **no `pap:done`**: render and audio would play the tray sparkle and eject sound at the
    new level's machine.
  - Restart still resets through `initShop` and `createEmptyState`.
  - Imports `weapons` and `shop` as namespaces. The shop↔level import cycle is lazy and safe.
- **`src/scores.js`**: the entry has `pap: count(o.pap)`. `recordRun` maps `stats.papCount`, and
  `extra` can override it. Old records have no `pap` field and load as 0, and garbage values
  normalize to 0.
- **Tests**
  - `tests/scores.test.js`: the expected key lists now include `pap`, plus a new WO8 test for
    storing the field and loading old records.
  - `tests/level.test.js`: 4 new WO8 tests:
    - a working gun goes back to its empty slot, upgraded and counted once, with no `pap:done`;
    - a ready gun goes to the active slot when all slots are full;
    - a gun whose id was bought again meanwhile replaces that copy, so there is no duplicate;
    - an idle machine changes nothing.
- **`README.md`**: a Pack-a-Punch section (where, price, flow, stats, 450 ammo, name examples,
  Porter's X2 / Zeus Cannon, blocked cases, descent and restart) and the debug hooks.

## Browser run (port 8261, `?debug=1`, then `&touch=1`)

| # | Check | Result |
|---|-------|--------|
| 1 | L1: doors D, E, F, G and H bought through the real interact path (75/100/100/125/150), vault reached | PASS |
| 2 | KN-44 bought at its wall (150). At the machine the prompt reads "Press F to Pack-a-Punch KN-44 [500]" | PASS |
| 3 | Interact: 500 paid, slot 1 emptied, switched to MR6. Events are `weapon:equipped`, `pap:start {kn44, slot 1}`, then `purchase:made {pap, 500}`. Prompt reads "Machine busy" | PASS |
| 4 | After 3 s the machine is `ready` and the prompt reads "Press F to take Warden's Wrath". Take: slot 1, `pap:done`, papCount 1, machine idle | PASS |
| 5 | Warden's Wrath stats: damage 70→140, mag 30→45 (full), reserve 240→360 (full), spread 0.04→0.032, pen 1→2, rpm 700 unchanged | PASS |
| 6 | HUD shows "★ Warden's Wrath" in gold (rgb 255,201,60, class `upgraded`); the `pap:done` banner was queued ("WARDEN'S WRATH") | PASS |
| 7 | Camo gun on the tray, camo and glow in hand, sparkle burst on take | PASS (screenshots) |
| 8 | KN-44 wall with the upgraded gun: "Press F to buy ammo [450]", 450 charged, refilled to 45/360 | PASS |
| 9 | Ray Gun: Porter's X2 Ray Gun, damage 1000→2000, splash 300→450, radius 90→135, mag 20→30, reserve 160→240 | PASS |
| 10 | Thundergun: Zeus Cannon, killRange 300→375, range 480→552, knockback 720→864, mag 4→6, reserve 12→18. Live test: a 150-HP zombie at 340 px is killed; one at 420 px survives | PASS |
| 11 | Blocked: an upgraded gun gets "… is already upgraded" (no charge). A held Death Machine gets "Cannot upgrade a power-up weapon" (no charge). Busy gets "Machine busy" (no charge, `papStart` returns false). Broke (100 pts) gets `purchase:denied {pap, lcar9, 500, have 100}` and the machine stays idle | PASS |
| 12 | Descend with L-CAR 9 `working`: on CATACOMBS it is back in slot 0 as Gravedigger (36/324), active, `weapon:equipped` only, machine idle, papCount 4→5 | PASS |
| 13 | Die on L2 with a Gorgon `ready` in the machine: game over shows "Upgrades 5" and the top-runs entry stores `pap: 5`. Restart: machine idle, papCount 0, BUNKER, weapons `[mr6, null]` | PASS |
| 14 | After the restart a weapon kill pays 10 | PASS |
| 15 | Touch (`&touch=1`): the ACTION button reads "Pack-a-Punch KN-44 [500]", a tap buys, then it reads "Take Warden's Wrath" and a tap takes. The HUD name wraps to 2 lines in gold | PASS |
| 16 | Frame cost with boss + 10 minions + 24 zombies in view, an upgraded gun held and the machine working/ready: `step(1/60)` avg 0.53 ms, median 0.40, p95 0.60 | PASS (< 3 ms) |
| 17 | Zero console errors (error hook plus the console reader, desktop and touch) | PASS |
| 18 | `npm test` 543/543, `node --check` clean | PASS |

On row 16, one or two 23–50 ms outliers appear per ~2 s. They happen in `render()` alone even
with no state change, and they are identical with the machine idle and a base gun held. This is a
browser canvas flush or GC, not WO8.

## Observations for Phase 3 QA (not fixed; the files belong to others)
- On L1 the machine faces N and W, so it has two "PACK-A-PUNCH 500" plates. The north plate sits
  just above the tray and partly overlaps the camo gun in the `ready` state
  (`wo8-machine-ready.png`).
- The game over "Favourite weapon" shows the base name (e.g. "Thundergun") even when the gun was
  upgraded. Kills are tallied by id, which is intended, but QA may prefer the upgraded name.
- The touch ACTION button also shows blocked PaP prompts ("Warden's Wrath is already upgraded").
  This matches the existing behaviour for other blocked prompts.
- A gun left in the machine at death is not counted in "Upgrades" because it was never taken.
  That is consistent, since restart discards it.

## Screenshots (`docs/screenshots/`)
- `wo8-machine-idle.png`: L2 sanctum machine idle, with both upgraded guns in the HUD in gold.
- `wo8-machine-working.png`: the KN-44 sliding into the slot.
- `wo8-machine-ready.png`: the Warden's Wrath camo on the tray.
- `wo8-upgraded-kn44-hud.png`: camo gun in hand, "★ WARDEN'S WRATH" in the HUD, the
  "already upgraded" prompt and the sparkle.
- `wo8-zeus-cannon-in-hand.png`: the Zeus Cannon camo and glow.
- `wo8-gameover-upgrades.png`: the game over summary with "Upgrades 5".
- `wo8-touch-take-sparkle.png`: touch scheme, take sparkle, 2-line gold name.

## Phase 4a (fixer): economy recommendations and integration notes

`npm test`: **547/547** (543 + 4 new top-level tests; 3 existing WO8 tests updated for the new
values). `node --check` is clean on every `src/` and `tests/` file.

| # | Item | Change |
|---|------|--------|
| Economy #1 | Mega door price per level | `DOORS.megaCostPerLevel: 250` (config); `level.megaDoorCost(i)` = `megaCost + megaCostPerLevel * i` (250 / 500 / 750 / 1000 / 1250 ..., loop levels continue); `startLevel` stamps `map.megaDoor.cost`. `shop.js` prompt and `buyMegaDoor` read the door's own cost (fallback `DOORS.megaCost`); the render plate already read `md.cost`. `DOORS.megaCost` stays 250 (contract). |
| Economy #2 | Upgraded guns vs the boss | `BOSS.papDamageMult: 1.25`. `weapons.js` `papBossFactor(def, mult)`: hitscan boss damage = base damage x min(dtap, `BOSS.dtapDamageMult`) x 1.25 (KN-44★ 87.5 vs 140 on zombies / minions). Ray Gun★: direct hit and splash on the boss are base x 1.25 (1250 / 375, not 2000 / 450), still under the 3 % cap. Thundergun★ keeps `thunderNearFrac` (fraction of max HP, unchanged); only its bigger kill band applies. |
| Economy #5 | Upgraded ammo price | `PAP.ammoCostMult: 3.75`; `ammoCost(id, true)` = `min(PAP.ammoCost, round(3.75 x base))`: KN-44 / Man-O-War 281, Sheiva 94, Peacekeeper 450. The shop prompt shows the returned price. Contract test's PAP block updated with `ammoCostMult`. |
| Note a | L1 north plate over the tray gun | `render.js` `paintPapMachine`: the plate on the machine's front (tray) side is pushed out by `PAP_TRAY_LABEL_CLEAR` (12 px); other sides unchanged. |
| Note b | Favourite weapon name | `main.js` also tallies kills made while the active gun `isUpgraded`, per id (knife moves undo it too). At game over `weaponName` = "★ " + `weapons.upgradedName(id)` if the favourite id scored any upgraded kill; else undefined, so `hud.js` shows the base name. `stats.bestWeaponId` and the stored score entry keep the plain id. |
| Note c | Touch ACTION on blocked prompts | Chose **greyed and inert** (not hidden, so the player still reads why): `touch.setTouchPrompt(text, { blocked, cantAfford })` (second argument optional; old one-arg calls still work). Blocked (already upgraded, Machine busy, mega door before all doors, ammo full, perk blocked) -> `.blocked` grey style, a tap sets no `interact` edge and `interactHeld` stays false. Unaffordable -> `.cant-afford` (red-tinted, like the desktop prompt's grey) but still tappable, so the purchase:denied feedback plays. Styles in `styles.css`. |
| Economy #7 | `debug.addPoints` skips `pointsEarned` | Left as is; documented in the README Debug section. |

README: mega door price per level, PaP boss multiplier, scaled PaP ammo, favourite ★ name, touch
blocked prompt, `addPoints` note.

### Boss TTK with the live code (`qa3/wo8live/boss8.mjs`, real `upgradeWeapon`, DT + SC, god, 12 seeds)

| Fight | TTK median (range) |
|---|---|
| L1 R11 KN-44 + Sheiva (no PaP) | 25.6 s (20–31) |
| L1 R11 KN-44★ + Sheiva | 19.1 s (13–22) |
| L2 R14 Man-O-War★ + KN-44★ | 17.0 s (14–22) |
| L3 R17 Peacekeeper★ + Man-O-War★ | 14.8 s (11–20) |

These match Agent G's ×1.25 predictions exactly (19.1 / 17.0 / 14.8 s).

### Browser check (port 8271, `?debug=1`, then `&touch=1`)

| Check | Result |
|---|---|
| Mega door prompt / plate: BUNKER 250, CATACOMBS 500, LABORATORY 750, BUNKER II 1000; buying on L2 charges 500 | PASS |
| L1 boss, one KN-44 shot: base 70, Warden's Wrath 87.5 | PASS |
| Upgraded ammo at the wall: Warden's Wrath "Press F to buy ammo [281]" (charged 281), Peacemaker 450, Fallen Comrade 94 | PASS |
| L1 machine `ready`: the camo gun on the tray is fully clear of the north plate (`docs/screenshots/wo8-4a-tray-gun-clear.png`) | PASS |
| Game over after kills with Warden's Wrath: "Favourite weapon ★ Warden's Wrath"; after MR6 kills: "MR6" | PASS |
| Touch: "Warden's Wrath is already upgraded" shows greyed (`tbtn-action blocked`), a tap gives no interact / held; with MR6 held the normal "Pack-a-Punch MR6 [500]" button is live and a tap sets interact (`docs/screenshots/wo8-4a-touch-blocked-prompt.jpg`) | PASS |
| Console errors | none |

## Final verification (Phase 4)

`npm test`: **552/552**. Browser on port 8291: a new tab at `?debug=1`, then `?debug=1&touch=1` with `#stage`
forced to 844x390. Everything goes through `__game.debug.step(dt, dt, overrides)` with `interact` / `fire` /
`firePressed` / `aimVector` overrides. The player is placed on the nearest reachable floor tile (BFS over
walkable tiles, so closed doors block the path), then uses the real interact path.
- Points came from `addPoints`, so the "Points earned" figure is low.
- Perks came from `givePerk`, so "Perks used" reads None.
- On touch, doors were opened free.

No regressions were found and no source file changed.

| # | Check | Result |
|---|-------|--------|
| 1 | L1 doors D/E/F/G/H bought via interact (75/100/100/125/150) | PASS |
| 2 | The KN-44 wall buy (150) gives the prompt "Press F to Pack-a-Punch KN-44 [500]". Interact pays 500, slot 1 empties and the player switches to MR6. Events: `pap:start {kn44, 1}`, then `purchase:made {pap, 500}` | PASS |
| 3 | Working animation: the cabinet shakes, with purple halo and sparks. The "Machine busy" prompt shows (`wo8-final-machine-working.png`) | PASS |
| 4 | Wall buy of the KN-44 while it is in the machine gives the prompt "KN-44 is in the Pack-a-Punch". No charge, no event | PASS |
| 5 | Ready: "Press F to take Warden's Wrath". Take puts it in slot 1 and emits `pap:done`; papCount is 1 | PASS |
| 6 | Warden's Wrath: damage 140, mag 45, reserve 360, spread 0.032, penetration 2, rpm 700. HUD shows "★ WARDEN'S WRATH" in gold, with the camo gun and glow in hand (`wo8-final-upgraded-hud.png`) | PASS |
| 7 | KN-44 wall with the upgraded gun: "Press F to buy upgraded ammo [281]". It charges 281 and refills to 45/360, then reads "Warden's Wrath ammo full" | PASS |
| 8 | Blocked cases, none charged: already upgraded ("Warden's Wrath is already upgraded"), Death Machine ("Cannot upgrade a power-up weapon"), busy ("Machine busy"), broke (`purchase:denied {pap, mr6, 500, have 100}`, machine stays idle) | PASS |
| 9 | Mega door plate/prompt: 250 on L1, 500 on L2 (a real buy charged 500), 750 on L3 | PASS |
| 10 | L1 boss, one Warden's Wrath shot: 87.5 (70 × 1.25) | PASS |
| 11 | Quick Revive + Mule Kick with MR6 (slot 0) in the machine and the Ray Gun (slot 2) active. After down and revive: perks cleared, Warden's Wrath (slot 1) active, `weapon:equipped` emitted. The player is not empty-handed | PASS |
| 12 | Porter's X2 Ray Gun: 2000 damage, splash 450 / r135, 30/240. The bolt, splash ring and fill are red-pink (`wo8-final-porters-x2.png`) | PASS |
| 13 | Zeus Cannon: killRange 375, range 552, knockback 864, 6/18. Gold shockwave. Live test: a 150-HP zombie at 340 px dies; one at 420 px survives | PASS |
| 14 | Descend with the Sheiva `working`: on CATACOMBS slot 0 holds Fallen Comrade (15/180), active, machine idle, papCount 4→5. Gold "FALLEN COMRADE RETURNED" text | PASS |
| 15 | L2 machine (38,31): doors via interact, then Gorgon → Medusa's Gaze. L3 machine: Kuda → Scorpion Sting | PASS |
| 16 | Game over on L3: "Upgrades 7", "Favourite weapon ★ Porter's X2 Ray Gun". Top-runs entry stores `pap: 7` (weapon id `raygun`) (`wo8-final-gameover.png`) | PASS |
| 17 | Restart: BUNKER, machine idle, weapon null, papCount 0, `[MR6, null]`, no perks, mega door 250. A weapon kill pays 10 | PASS |
| 18 | Touch: ACTION reads "Pack-a-Punch MR6 [500]" and a tap buys. It then reads "Machine busy" (`.blocked`), then "Take Nightingale", and a tap takes. Soldier is empty-handed while his only gun is inside (`wo8-final-mobile-take.png`) | PASS |
| 19 | Touch blocked prompt "Nightingale is already upgraded": greyed text and border, and a tap charges nothing and starts nothing | PASS |
| 20 | Touch with Mule Kick and three upgraded guns: the holstered line reads "WARDEN · SEKHMET" in gold on one line, readable, not truncated | PASS |
| 21 | The Mule Kick cabinet and HUD bottle are magenta (#ff4fd8), clearly distinct from the violet PaP machine | PASS |
| 22 | Frame cost on the L1 arena with boss + 10 minions + 24 zombies (35 alive), Warden's Wrath firing, machine working→ready. 300 `step(1/60)` calls (update + render): mean 0.91 ms, median 0.60, p95 1.50, one 22.9 ms max outlier (GC / automation host, as in Phase 2) | PASS (< 3 ms) |
| 23 | Console errors: error hook and console reader, desktop and touch | PASS (none) |
| 24 | `npm test` | PASS (552/552) |

The touch "Nightingale is already upgraded" pill can overlap a world plate (ICR-1) when the camera is clamped. This is cosmetic and pre-existing (the WO8 playtest already recorded plates under the HUD).

The one run crossed levels 1–3, not 4. Mega door 1000 on L4 was checked in Phase 4a.

Screenshots: `docs/screenshots/wo8-final-machine-working.png`, `wo8-final-upgraded-hud.png`,
`wo8-final-porters-x2.png`, `wo8-final-mobile-take.png`, `wo8-final-gameover.png`.
