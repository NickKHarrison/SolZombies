# WORK ORDER 8 — Pack-a-Punch and a late-game economy pass

Current state: WO7 complete (511 tests green, live on GitHub Pages). Problem this order solves:
once doors, perks and a good gun are bought, points pile up with nothing to spend them on, and a
favourite gun becomes useless a level later. **Pack-a-Punch** gives points a late-game sink and
keeps guns alive; the **economy pass** measures real earnings per level and tunes the sinks.

**Phase 0: 1 scaffold agent. Phase 1: 7 parallel agents (A–G). Phase 2: integrator. Phase 3: 2
QA agents. Phase 4: fixes + final verification.** House rules from WO1–WO7 apply: one file one
owner, targeted edits on shared files, siblings imported as namespaces and guarded, pure modules
never touch the DOM, `state.rng` only, palette-only art, `npm test` =
`node --test "tests/*.test.js"`, `node --check`, browser checks on your own port with `?debug=1`
(`&touch=1` for touch) via `__game.debug.step(dt, dt, overrides)`, stop servers, close tabs,
**no git**, no questions, append a "WO8" section to your `docs/notes/<module>.md`.

---

## 1. Design

### 1.1 The machine

- One **Pack-a-Punch machine** per level, ASCII letter `A` (uppercase; free in the legend), tile
  code `TILE_PAP = 11`, blocks movers and rays like a perk machine. Placed in the **deepest
  normal zone** (behind door `H`, the zone that also holds the mega door), not inside the arena
  and ≥ 2 tiles from it, ≥ 6 tiles from any wall buy or perk machine.
- Price `PAP.cost = 500` (BO3 5000 ÷ 10). Prompt at the machine with a gun that can be upgraded:
  `"Press F to Pack-a-Punch KN-44 [500]"`. Blocked prompts: `"KN-44 is already upgraded"`,
  `"Cannot upgrade a power-up weapon"` (Death Machine), `"Machine busy"` while another gun is
  inside. Buying while a gun is inside is refused.
- **Flow** (state machine in `state.shop.pap`): `idle` → player pays, the active weapon is
  removed from its slot and shown sliding into the machine → `working` for `PAP.workSeconds`
  (3 s; sparks, jingle) → `ready`: the upgraded gun sits on the tray; prompt `"Press F to take
  Nightingale"`; it stays until taken (no timeout). Taking it puts the upgraded gun back into the
  **same slot** it came from (if that slot was filled meanwhile, the first empty slot; if none,
  it replaces the active gun). Leaving the level or dying while a gun is inside loses nothing:
  `level.startLevel` returns a `working`/`ready` gun to the player's slot **upgraded**; on
  restart everything resets.
- Emits `pap:start { weaponId, slot }` and `pap:done { weaponId }` (when taken);
  `purchase:made { kind: 'pap', id: weaponId, cost }` / `purchase:denied { kind: 'pap', ... }`.

### 1.2 Upgraded weapons

- An upgraded weapon keeps its `id` (so wall-buy "already owned", box exclusion, stats and
  favourite weapon keep working) and gets `w.upgraded = true` and `w.def = UPGRADES[id]`, a
  frozen derived def: `name` = the Pack-a-Punch name, `damage × PAP.damageMult (2)`, `mag ×
  PAP.magMult (1.5, rounded)`, `reserve × PAP.reserveMult (1.5, rounded)`, `spread × 0.8`,
  `penetration + 1` (max 4), `rpm` unchanged, `upgraded: true`, `baseId: id`. Projectile /
  cone weapons: Ray Gun splash damage and radius × 1.5, Thundergun `killRange × 1.25` and
  `range × 1.15`, knockback × 1.2. Filling the new larger mag/reserve happens on upgrade
  (mag and reserve set to the new maxima).
- **Ammo**: wall ammo for an upgraded gun costs `PAP.ammoCost = 450` (BO3 4500 ÷ 10) at its
  own wall buy; Max Ammo refills as normal. A gun that has no wall buy on the current level
  keeps relying on Max Ammo (as today).
- Double Tap, Speed Cola and the boss per-hit cap apply as for any gun. The boss per-hit cap
  (3 %) makes upgrades a smaller boost against bosses, which is intended.
- **Names** (decided here so every agent uses the same table; three are BO3 originals, the rest
  are in the BO3 style):

| id | upgraded name | id | upgraded name |
|----|---------------|----|---------------|
| mr6 | Nightingale | rk5 | Dominion |
| lcar9 | Gravedigger | sheiva | Fallen Comrade |
| krm262 | Krumhaar | kuda | Scorpion Sting |
| vmp | Hydra | vesper | Ultraviolet |
| pharo | Sekhmet's Ire | bootlegger | Moonshiner |
| kn44 | Warden's Wrath | hvk30 | Comet |
| icr1 | Infinity Reaper | argus | Exodus |
| locus | Cauterizer | drakon | Firestorm |
| haymaker12 | Mainsail | dingo | Kraken |
| brm | Barrage | manowar | Dreadnought |
| xr2 | Nebula | weevil | Wyrm |
| marshal16 | Judge & Jury | gorgon | Medusa's Gaze |
| dredge48 | Overflow | hg40 | Venom Drum |
| m8a7 | Pulsar | peacekeeper | Peacemaker |
| raygun | Porter's X2 Ray Gun | thundergun | Zeus Cannon |

- **Look**: the held gun sprite is recoloured with a purple-and-gold camo (render applies a
  deterministic per-pixel palette shift via `pixel.tint`: metals → violet, wood/tan → gold,
  keep outlines), plus a faint purple glow; the HUD shows the upgraded name in gold with a `★`.
- **Stats**: `stats.papCount` (upgrades bought this run) shown in the game-over summary
  ("Upgrades: 2") and stored on the score entry as `pap`.

### 1.3 Economy pass (measurement first, then tuning)

Agent G measures, with the headless bot harnesses on the real modules and **no debug points**,
per level 1–4: points earned per round, spent on doors/perks/guns/ammo, and the surplus at the
mega door; boss kill count and time; how many rounds a "frugal competent" player needs to afford
PaP once and twice. Deliverable: `docs/qa/wo8-economy.md` with tables and numbered tuning
recommendations (exact old → new values), covering at least: `PAP.cost` and `PAP.ammoCost`;
whether late rounds overpay (round-clear bonus? per-kill scaling?) or underpay on level 3–4 with
tier-3 ammo; Quick Revive steps; whether the mystery box price should scale with level. The
integrator applies the recommendations the lead accepts (see Phase 4).

---

## 2. Ownership

| Agent | Owns |
|-------|------|
| 0 | `src/config.js` (`PAP` block), `src/state.js` (`shop.pap`, `stats.papCount`), `tests/contracts.test.js` (events `pap:start`, `pap:done`; `WO8 new exports` test), `docs/notes/wo8-scaffold.md` |
| A | `src/weapons.js`, `tests/weapons.test.js`, `docs/notes/weapons.md` — `UPGRADES`, `upgradeWeapon`, `isUpgraded`, `upgradedName`, `ammoCost` for upgraded guns, projectile/cone scaling |
| B | `src/map.js`, `src/shop.js`, `tests/map.test.js`, `tests/shop.test.js`, `docs/notes/map.md`, `docs/notes/shop.md` — `TILE_PAP`, `map.pap`, `nearestInteractable` kind `pap`, the PaP state machine, prompts, `startPap` / `takePap` |
| C | `src/levels/level1.js`, `level2.js`, `level3.js`, `tests/levels.test.js`, `docs/notes/levels.md` — place `A` on all three levels; validity tests |
| D | `src/render.js`, `docs/notes/render.md` — machine art + gun in/out animation + sparks, upgraded camo tint on the held sprite, glow, collect sparkle |
| E | `src/hud.js`, `styles.css`, `docs/notes/hud.md` — gold ★ names in the weapon readout (all slots), "Upgrades" row in the game-over summary, `pap:done` banner with the new name |
| F | `src/audio.js`, `docs/notes/audio.md` — insert clank, working hum + an original 8-note jingle, eject + sparkle; `purchase:made` kind `pap` plays no cash tick |
| G | `docs/qa/wo8-economy.md` only (no `src`/`tests` edits) |
| INT | `src/main.js` (stats, debug hooks `pap()`, `papTake()`), `src/level.js` (return a gun inside the machine on descent), `src/scores.js` (entry `pap` field), `README.md`, any file for integration fixes, `docs/notes/integration-wo8.md` |
| QA | `docs/qa/wo8-*.md` only |

---

## 3. Contracts

```js
// config.js (Phase 0)
export const PAP = { letter: 'A', cost: 500, ammoCost: 450, workSeconds: 3, damageMult: 2, magMult: 1.5, reserveMult: 1.5,
  spreadMult: 0.8, penetrationBonus: 1, maxPenetration: 4, projectileMult: 1.5, coneKillMult: 1.25, coneRangeMult: 1.15, knockMult: 1.2 };
// state.js: shop.pap = { state: 'idle' | 'working' | 'ready', timer: 0, weapon: null /* the weapon object inside */, slot: -1, baseId: null }
//           stats.papCount = 0

// weapons.js (A)
export const UPGRADES            // { [id]: frozen upgraded def } built from WEAPONS + the name table (deathmachine excluded)
export function upgradeWeapon(w) -> w     // mutates: w.def = UPGRADES[w.id], w.upgraded = true, mag/reserve = new maxima, reloading cancelled
export function isUpgraded(w) -> bool
export function upgradedName(id) -> string
export function canUpgrade(w) -> { ok: bool, reason?: 'upgraded' | 'powerup' | 'unknown' }
// ammoCost(id, upgraded = false): upgraded -> PAP.ammoCost (only if the base gun has a wall cost). Shop passes isUpgraded(w).
// Hitscan/projectile/cone code reads everything from w.def, so upgraded stats apply automatically; verify Thundergun/Ray Gun fields are read from def.

// map.js (B)
export const TILE_PAP = 11;  // 'A' -> map.pap = { tx, ty, x, y, w, h, cx, cy } | null; blocks movers + rays; nearestInteractable adds { kind: 'pap', ref: map.pap }
// shop.js (B)
export function startPap(state) -> bool   // pays, removes the active weapon into state.shop.pap, emits pap:start + purchase:made kind 'pap'
export function takePap(state) -> bool    // ready -> gives the upgraded weapon back per 1.1, emits pap:done, stats.papCount++, resets to idle
export function updatePap(state, dt)      // working timer -> ready (calls weapons.upgradeWeapon when entering ready)
// prompts: kind 'pap' with text per 1.1, blocked + reason; kind 'papTake' when ready ("Press F to take <name>")
// Existing wall-buy ammo prompt: if the held gun is upgraded use ammoCost(id, true) and text "Press F to buy ammo [450]".

// render.js (D): machine from map.pap (dark cabinet, purple/gold glow, tray, "PACK-A-PUNCH" plate + cost); while working draw the gun
//   sprite sliding in then sparks; while ready draw the upgraded (tinted) gun on the tray; held upgraded guns use the camo tint
//   (tint cache keyed by sprite + 'pap'); pap:done -> sparkle burst effect. Static layer cache key must include pap state.
// hud.js (E): weapon names via weapons.isUpgraded(w) -> gold + '★'; game over "Upgrades" row from summary.papCount; banner "<UPGRADED NAME>" on pap:done.
// audio.js (F): pap:start -> clank + hum; jingle during working (own bus, quiet); pap:done -> eject + sparkle.
// levels (C): 'A' per level; tests: exactly one A per level, in the zone behind H, not in/near the arena (>= 2 tiles), >= 6 from wall buys/perks, reachable with all doors open.
// main.js (INT): shop.updatePap in the frame after updateShop; pap:done -> nothing extra (shop counts papCount); scores entry gets pap: stats.papCount; debug hooks.
// level.js (INT): startLevel: if shop.pap.weapon exists, upgrade it (if not yet) and return it to the player (slot rules in 1.1), reset shop.pap.
```

## 4. Phases

- **Phase 0 (1 agent):** config `PAP`, state fields, contracts events + `WO8 new exports`, notes.
- **Phase 1 (7 agents A–G in parallel).** G is research-only and can finish early.
- **Phase 2 (Integrator):** wire `updatePap`, level-swap safety, scores field, README, debug
  hooks; full browser run: upgrade a wall gun, buy 450 ammo, upgrade the Ray Gun and the
  Thundergun, die with a gun inside the machine, descend with a gun inside, restart; touch too.
- **Phase 3 (QA ×2):** playtest (machine readability, animation, camo tint legibility on every
  gun, HUD names, mobile) and code review (slot edge cases: Mule Kick loss while a gun is
  inside, Death Machine active when paying, box offering a gun you hold upgraded, sold weapon
  replacement while upgraded, stats/scores, listener leaks).
- **Phase 4:** fixes by file group, **apply accepted economy recommendations** from
  `docs/qa/wo8-economy.md` (lead decides which; default: accept price changes that keep the
  frugal player able to afford one upgrade by the level's boss and two by the next level),
  final verification with screenshots `docs/screenshots/wo8-*.png`.

## 5. Acceptance

- [ ] One Pack-a-Punch machine per level in the deepest zone; clear label; 500 points.
- [ ] Paying removes the gun, 3 s of animation + jingle, then the upgraded gun waits on the tray
      until taken; taken gun returns to the same slot with the new name, ×2 damage, bigger mag
      and reserve, camo look, gold ★ in the HUD; wall ammo for it costs 450.
- [ ] Ray Gun and Thundergun upgrades (Porter's X2 Ray Gun, Zeus Cannon) apply their scaling.
- [ ] Blocked cases work: already upgraded, Death Machine, machine busy, cannot afford.
- [ ] Dying or descending with a gun inside never loses it; restart resets the machine.
- [ ] Game over shows "Upgrades: N"; scores store it.
- [ ] Economy report delivered and accepted changes applied; a frugal competent player can afford
      one upgrade by each level's boss.
- [ ] `npm test` green; zero console errors through a run to level 4 with two upgrades; frame
      cost unchanged; works on touch.

## 6. Spawn prompts

**Phase 0**
```
You are Agent 0 (scaffold) for WORK_ORDER_8.md in the current directory. Read it fully. Add the
PAP block to src/config.js (targeted insert), shop.pap and stats.papCount to src/state.js, the
pap:start / pap:done events and a 'WO8 new exports' test (guarded, expected to fail until Phase 1)
to tests/contracts.test.js. No behaviour change. npm test green except the new-exports test;
node --check. Write docs/notes/wo8-scaffold.md. No git, no questions.
```
**Phase 1 (A–G)**
```
You are Agent <LETTER> for WORK_ORDER_8.md in the current directory. Read Sections 0-3 in full and
your row in Section 2. Implement everything assigned to you; edit ONLY your files. Siblings are
being written concurrently: import as namespaces, call lazily, guard missing exports, never edit
them. Keep every existing export signature. Ship tests for logic modules; npm test (node --test
"tests/*.test.js") green for your files; node --check. Verify art/DOM work in the browser on port
<8251 + letter index> (?debug=1, &touch=1 for touch) with screenshots. Append a "WO8" section to
your notes. Stop servers, close tabs, no git, no questions.
```
**Phases 2–4:** as in WO7 with the Section 5 list, ports 8261–8269.
