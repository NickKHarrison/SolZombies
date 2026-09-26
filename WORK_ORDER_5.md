# WORK ORDER 5 — Mega door, boss arena, staircase, multi-level dungeon

Follow-up to WO4 (286 tests green, live on GitHub Pages). This order adds progression:

1. **Mega door.** Once every normal door on a level is open, a sealed **mega door** becomes
   purchasable. It leads into a **boss arena**.
2. **Boss fight.** Entering the arena seals the mega door behind the player and starts a boss
   fight: one large, tough boss with special attacks plus waves of fast **minions**. Normal round
   spawning is suspended during the fight.
3. **Staircase.** Defeating the boss opens a **staircase door** in the arena. Descending loads the
   **next dungeon level**: same 60×40 size, a different look (theme), harder zombies, and more
   powerful new weapons on its walls. Points, weapons and the round counter carry over. Doors,
   barricades and the mystery box reset for the new level.
4. **Endless.** After the last authored level the staircase loops back to level 1's layout with the
   next theme and a compounding difficulty multiplier.

**Phase 0: 1 scaffold agent. Phase 1: 7 parallel agents. Phase 2: integrator. Phase 3: 3 QA
agents. Phase 4: fix agents.** House rules from WO1–WO4 apply (Section 0 below).

---

## 0. Rules (unchanged, read once)

- One file, one owner (Section 2.1). Shared files get targeted edits to the named block only.
- Code against the contracts in Section 3, not against other agents' files. Import sibling
  modules as namespaces (`import * as boss from './boss.js'`) and call inside functions so a
  half-written sibling never breaks your import. Guard `typeof fn === 'function'` where a
  sibling export may not exist yet.
- Pure modules never touch the DOM (`boss.js`, `level.js`, `levels/*.js` are pure).
- All randomness via `state.rng`. No new npm deps. Palette-only pixel art, no image files.
- `npm test` is `node --test "tests/*.test.js"`. Keep it green for your files; `node --check`
  every JS file you touch. Logic modules ship tests.
- Browser checks: `python -m http.server <your port>` from the project dir in the background,
  Chrome tools in a NEW tab, `?debug=1`, `__game.debug.step(1/60)` when the tab does not animate
  (the step accepts input overrides as a third argument: `{moveX, moveY, mouseX, mouseY,
  interact, fire}`), screenshots. Stop your server, close your tab.
- No git, no deleting others' files, no network fetches, no questions: decide and document in
  `docs/notes/<module>.md` (append a "WO5" section).

---

## 1. Design

### 1.1 Mega door and arena (per level)

- ASCII legend additions (Section 3.1): `M` mega door tiles (one connected run), `Z` boss spawn
  tile (arena floor), `X` minion spawn tiles (arena floor, 4–6 of them around the arena edge),
  `T` staircase tiles (one connected run, in the arena's far wall).
- The **arena** is the set of tiles reachable from `Z` without crossing the mega door or the
  staircase, computed once at load. It should be a large open room (about 14×12 tiles) with 2–4
  pillars for cover, no windows, no wall buys, no box.
- Mega door price: `DOORS.megaCost` (250). Prompt while any normal door is closed:
  `"MEGA DOOR — open all doors first"` (blocked, greyed). When all normal doors are open:
  `"Press F to open MEGA DOOR [250]"`.
- **Sealing.** When the player's centre enters an arena tile with the boss not yet started, the
  fight starts: the mega door tiles revert to closed (`sealed: true`, no prompt, cannot be
  re-bought), the HUD shows the boss banner and health bar, the boss roars, the screen shakes.
- **Unsealing.** When the boss dies, the mega door reopens (so the player can return to the
  level, e.g. to buy ammo), the staircase opens, and normal rounds resume.

### 1.2 Boss and minions

- **Boss** (`kind: 'boss'`): radius 34 (2.4× a zombie), speed 90 (walker), melee damage 75 with a
  0.5 s wind-up and 1.4 s cooldown. Health
  `BOSS.baseHealth (4000) × levelHealthMult × (1 + BOSS.roundScale (0.12) × currentRound)`.
  Worth `BOSS.points` (200) on death. Named per level (`levelDef.boss.name`, e.g. "THE WARDEN",
  "THE BONE PRIEST").
- **Charge attack** every `BOSS.chargeEvery` (7 s): 0.6 s telegraph (boss stops, flashes, roar
  sting), then dashes at 3.5× speed in a straight line toward the player's position at the end
  of the telegraph for up to 1.1 s or until it hits a wall (stops, brief 0.4 s stun) or the
  player (damage 75 + knock the player back 40 px along the dash). Shake on impact.
- **Summon** every `BOSS.summonEvery` (12 s) and once at fight start: `BOSS.minionsPerWave +
  levelIndex` minions (4 base) from random `X` tiles, up to `BOSS.maxMinions` (10) alive.
- **Minion** (`kind: 'minion'`): radius 10, speed = sprint speed × 1.1, health 45 % of the current
  round health, damage 25, cooldown 0.8 s. Worth 10 points. Drawn smaller, darker, with red eyes.
  Minions never tear boards (they spawn inside the arena).
- **Power-up rules for the boss:** Insta-Kill hits deal 5 % of boss max HP (not a kill). Nuke
  kills minions but deals only 10 % to the boss (boss is not queued). Thundergun near-cone deals
  15 % to the boss and knocks it back 60 px; far cone knocks it back 40 px, no stun. Zombie
  Blood: the boss keeps hunting; minions wander. Death Machine / Ray Gun: normal damage.
  Minions drop power-ups at the normal 2 % chance; the boss drops one guaranteed Max Ammo.
- **Boss death:** 2 s dying animation (bigger blood pool, flash), `boss:defeated`, all minions die
  (no points), mega door unsealed, stairs opened, `rounds.suspended = false`, current round
  ends immediately and the normal break starts. Banner "STAIRS OPENED".
- **Player death during the fight:** normal game over.

### 1.3 Levels and difficulty

- `LEVELS` registry (Section 3.5): level 1 = the existing layout (**edited** to add the arena
  in the vault's far side or a new room; keep the WO4 door/zone rules), level 2 = a new
  60×40 layout, different structure, catacomb theme, its own five doors, arena and stairs.
- **Theme** (per level): `{ name, floor, floorAlt, wall, wallEdge, accent, doorWood, doorIron,
  ambient /* rgba screen tint */, torch: bool }`. Level 1 "BUNKER": current greys. Level 2
  "CATACOMBS": brown-black stone floor with bone-white flecks, dark red-brown walls, amber
  ambient tint 8 %, wall torches (animated glow dots) at some wall tiles.
- **Difficulty** per level: `{ healthMult, speedMult, countMult, sprintShift }`:
  level 1 `{1, 1, 1, 0}`, level 2 `{1.5, 1.1, 1.25, 3}`. On loop `n` (after the last level)
  multiply health by `1.4^n`, count by `1.15^n`, speed by `1.05^n`, sprintShift `+3n`.
  `sprintShift` is added to the round when picking the walker/jogger/sprinter mix.
- **Weapons per level:** `levelDef.wallbuys` maps the ASCII letters to weapon ids. Level 2 walls
  sell **new, stronger guns** (Section 3.4): Man-O-War, XR-2, Weevil, Marshal 16, Gorgon,
  48 Dredge, plus Haymaker 12 and Drakon moved from box-only to walls. Level 2 prices 200–350.
  The box pool is the same everywhere (plus the new guns at box-only weight 2).
- **Transition** on descending: 1.2 s fade to black, swap level at the midpoint, fade back in
  with a banner "LEVEL 2 — CATACOMBS". Player keeps weapons, ammo, points, health, active
  power-ups; zombies, bullets, power-up items, box state, doors, barricades and boss reset.
  Round counter continues; `rounds` gets a fresh break (`firstRoundDelay`).

---

## 2. Files and ownership

### 2.1 Table

| Agent | Owns (create/edit)                                                                                  |
|-------|-----------------------------------------------------------------------------------------------------|
| 0     | `src/config.js` (add `BOSS`, `DOORS`, `LEVELS_CFG` blocks), `src/state.js` (add `level`, `boss`, `transition`, `rounds.suspended` note), stubs `src/boss.js`, `src/level.js`, `src/levels/levels.js`, `src/levels/level1.js`, `src/levels/level2.js`, `tests/contracts.test.js` event table + new exports, `docs/notes/wo5-scaffold.md` |
| A     | `src/levels/level1.js`, `src/levels/level2.js`, `src/levels/levels.js`, `tests/levels.test.js`, `docs/notes/levels.md` |
| B     | `src/map.js`, `tests/map.test.js`, `docs/notes/map.md`                                                |
| C     | `src/boss.js`, `src/zombie.js`, `src/powerups.js`, `tests/boss.test.js`, `tests/zombie.test.js`, `tests/powerups.test.js`, `docs/notes/boss.md`, `docs/notes/zombie.md`, `docs/notes/powerups.md` |
| D     | `src/weapons.js`, `src/sprites/guns.js`, `tests/weapons.test.js`, `tests/sprites.test.js` (gun assertions), `docs/notes/weapons.md`, `docs/notes/guns.md` |
| E     | `src/render.js`, `src/audio.js`, `docs/notes/render.md`, `docs/notes/audio.md`                         |
| F     | `src/hud.js`, `styles.css`, `docs/notes/hud.md`                                                        |
| G     | `src/level.js`, `src/waves.js`, `src/shop.js`, `tests/level.test.js`, `tests/waves.test.js`, `tests/shop.test.js`, `docs/notes/level.md`, `docs/notes/waves.md`, `docs/notes/shop.md` |
| INT   | `src/main.js`, `README.md`, any file for integration fixes, `docs/notes/integration-wo5.md`            |
| QA    | `docs/qa/wo5-*.md` only                                                                                |

`map.js` (B) reads level data through `levels.js` (A): `loadMap(levelDef)` where `levelDef`
comes from the registry. `MAP_ASCII` stays exported for old tests (= level 1 ascii).

---

## 3. Contracts

### 3.1 Map legend and Map object (Agent B, data by Agent A)

New tile codes: `TILE_ARENA_SPAWN = 8` (`X`, walkable floor), `TILE_STAIRS = 9` (`T`, blocks like
a wall until opened; then walkable and interactable), `Z` is floor (code 0) but recorded.
`M` tiles are `TILE_DOOR` (7) belonging to the mega door.

```js
export function loadMap(levelOrAscii = LEVELS[0], opts = {})
// Accepts a level def ({ ascii, wallbuys, theme, id, name, boss }) or a raw ascii array
// (legacy: uses WALLBUY_MAP and the level-1 theme). Returns the WO4 Map plus:
map.levelId, map.name, map.theme, map.wallbuyMap,
map.megaDoor        // { id, cost: DOORS.megaCost, open, sealed: false, tiles, x, y, w, h, cx, cy, axis } — NOT in map.doors
map.bossSpawn       // { x, y }
map.arenaSpawns     // [{ id, x, y }]
map.arenaTiles      // Set<number tileIndex> reachable from Z with mega door and stairs closed
map.stairs          // { tiles, x, y, w, h, cx, cy, open: false }
export function allDoorsOpen(map)                 // every map.doors[] open
export function megaDoorUnlockable(map)           // allDoorsOpen && !megaDoor.open && !megaDoor.sealed
export function openMegaDoor(map) -> bool         // requires unlockable; tiles -> 0, version++
export function sealMegaDoor(map)                 // tiles -> 7, open=false, sealed=true, version++
export function unsealMegaDoor(map)               // tiles -> 0, open=true, sealed=false, version++
export function openStairs(map)                   // tiles -> 0 (walkable), stairs.open=true, version++
export function inArena(map, x, y) -> bool
export function isBossActiveBlocking(map)         // sealed mega door: spawns outside arena are irrelevant; see waves
// nearestInteractable adds: { kind: 'megadoor', ref: map.megaDoor } (when !open && !sealed) and
// { kind: 'stairs', ref: map.stairs } (when stairs.open).
```
Minion spawn tiles are **not** in `map.spawnPoints` and never count as active spawns. Arena
tiles must not contain `W`, `S`, `O`, `B` or wall-buy letters (test it).

### 3.2 Zombie kinds and boss (Agent C)

```js
// zombie.js
// spawnZombie(state, spawnPoint, opts = {})   opts.kind: 'normal' (default) | 'minion' | 'boss'
//   z.kind set on every zombie; minion/boss use BOSS.* stats and levelDifficulty from state.level
//   boss extra fields: z.name, z.charge = { timer, phase: 'idle'|'telegraph'|'dash'|'recover', dx, dy, t }, z.summonTimer
// healthForRound(round, difficulty = state.level?.difficulty)  // multiply by healthMult
// tierForRound(round + sprintShift, rng)
// damageZombie: boss immune to insta-kill lethal (5% max HP instead); minions/boss never enter 'tearing'
// killZombie: boss -> dyingT = BOSS.deathLinger (2.0), emits zombie:killed {kind:'boss'} (points via player as usual, POINTS.perKill replaced by BOSS.points for kind 'boss'; player.js listens to zombie:killed — since player.js is not edited this order, zombie.js emits an extra points:changed? NO: instead boss.js awards BOSS.points via player.addPoints on boss:defeated, and zombie:killed for the boss carries cause 'boss' which player.js ignores? player.js pays perKill for any cause except 'debug'. Accept: boss pays perKill (10) via the normal path PLUS BOSS.points − 10 from boss.js. Document it.)
// updateZombies: boss AI (hunt, melee, charge state machine, wall stop), minion AI = chasing with no tearing and no pocket logic
export function applyKnockback  // unchanged; boss ignores stun (only displacement)

// boss.js (pure)
export function createBossState()  // { phase: 'idle'|'active'|'defeated', bossId, name, hp, maxHp, summonTimer, minionsSpawned, startedAt }
export function initBoss(state)    // subscribe zombie:killed (boss/minion bookkeeping), round:start (nothing), game:restart (reset) — re-init safe
export function updateBoss(state, dt)
//   idle: if state.map.megaDoor.open && !sealed && inArena(map, player) -> startFight(state)
//   active: summon timer -> spawnMinions; watch boss zombie; if boss dead -> finishFight
export function startFight(state)  // sealMegaDoor, rounds.suspended = true, spawn boss at bossSpawn (kind 'boss'), first minion wave, emit boss:start {name, maxHp}
export function spawnMinions(state, n)
export function finishFight(state) // kill remaining minions (cause 'boss'), unsealMegaDoor, openStairs, rounds.suspended=false, rounds end-of-round trigger (toSpawn=0, alive recount), addPoints(BOSS.points - POINTS.perKill), guaranteed maxAmmo drop at boss position, emit boss:defeated {name}
export function bossZombie(state)  // the live boss zombie or null
export function bossHpFrac(state)  // 0..1 for the HUD
```
Power-ups (Agent C, `powerups.js`): nuke queue excludes `kind === 'boss'` and applies 10 % damage
to it; `zombieBlood` unchanged (zombie.js decides per kind); guaranteed drop helper
`spawnPowerup(state, 'maxAmmo', x, y)` already exists.

### 3.3 Waves, shop, level transition (Agent G)

```js
// waves.js
// rounds.suspended (bool, default false): while true updateRounds does no spawning and no round-end check; timers freeze.
// zombiesForRound(round, difficulty) -> ceil(base * countMult)
// spawnZombie is only called with kind 'normal' here.
export function endRoundNow(state)   // toSpawn = 0; alive = count of live kind 'normal' zombies; if 0 -> emit round:end and start the break

// shop.js
// prompts: kind 'megadoor' ("MEGA DOOR — open all doors first" blocked when !allDoorsOpen; "Press F to open MEGA DOOR [250]" otherwise)
//          kind 'stairs'   ("Press F to descend")
export function buyMegaDoor(state)   // spend DOORS.megaCost, map.openMegaDoor, purchase:made {kind:'megadoor', id:'mega', cost}
export function useStairs(state)     // level.beginDescent(state)

// level.js (pure)
export function createLevelState(index = 0)  // { index, loop, def, difficulty, name }
export function levelDifficulty(index, loop) // per 1.3
export function startLevel(state, index)     // loads map via map.loadMap(levelDef), resets per-level state (zombies, bullets, powerups.items, powerups.nuke, shop.box, boss state, rounds: fresh break with round number kept, flow=null), moves player to map.playerStart, sets state.level, emits level:start {index, name, loop}
export function beginDescent(state)          // state.transition = { t: 0, dur: LEVELS_CFG.fadeSeconds, nextIndex, swapped: false }; emits level:descend
export function updateLevel(state, dt)       // advances transition; at t >= dur/2 (once) calls startLevel(nextIndex); at t >= dur clears transition. While transition is set, main skips gameplay updates (player, zombies, waves, shop) but still renders.
export function nextLevelIndex(state)        // (index + 1); loop increments when wrapping past LEVELS.length
```

### 3.4 New weapons (Agent D)

Add to `WEAPONS` (`cost` = level-2 wall price; all also in the box at weight 2 except where noted):

| id | name | cls | cost | dmg | rpm | auto | mag/reserve | reload | notes |
|----|------|-----|------|-----|-----|------|-------------|--------|-------|
| manowar | Man-O-War | ar | 250 | 120 | 520 | yes | 25/200 | 2.6 | penetration 2 |
| xr2 | XR-2 | ar | 225 | 85 | 900 | yes | 30/270 | 2.1 | 3-round burst feel: spread 0.02 |
| weevil | Weevil | smg | 200 | 60 | 950 | yes | 48/288 | 2.0 | |
| marshal16 | Marshal 16 | shotgun | 225 | 70×8 | 110 | no | 2/40 | 1.6 | double barrel, spread 0.16, range 650 |
| gorgon | Gorgon | lmg | 300 | 130 | 400 | yes | 48/240 | 4.0 | penetration 3 |
| dredge48 | 48 Dredge | lmg | 275 | 70 | 850 | yes | 48/288 | 3.6 | |
| haymaker12 | (existing) | | 250 | | | | | | now also a wall buy on level 2 |
| drakon | (existing) | | 300 | | | | | | now also a wall buy on level 2 |

`WALL_WEAPON_IDS` is computed from `cost !== null` as today (these ids gain a cost). Level 1's
`wallbuys` map (Agent A) must keep exactly the WO4 guns so level 1 is unchanged. Gun sprites:
add `GUN_SPRITES` entries for the six new ids (distinct silhouettes: Man-O-War chunky AR with
drum, XR-2 slim futuristic AR, Weevil boxy SMG, Marshal 16 short double barrel, Gorgon long LMG
with side box, 48 Dredge fat LMG with drum) and set `sprite` on each def. Boss-tier damage
should make level 2 zombies (1.5× health) die in roughly the same shots as level 1 zombies did
with level 1 guns.

### 3.5 Levels (Agent A)

```js
// levels/levels.js
export const LEVELS = [LEVEL1, LEVEL2];
export function levelByIndex(i) // LEVELS[i % LEVELS.length]
// levels/level1.js / level2.js
export const LEVEL1 = {
  id: 'bunker', name: 'BUNKER', ascii: [...60x40...],
  wallbuys: { '1': 'sheiva', '2': 'rk5', ... }   // level 1 = WO4 WALLBUY_MAP exactly
  theme: { name, floor, floorAlt, wall, wallEdge, accent, doorWood, doorIron, ambient, torch },
  boss: { name: 'THE WARDEN', tint: '#7a1f1f' },
};
```
Level 1 edits: add the arena (`M` run in a wall of the deepest zone, `Z`, 4–6 `X`, `T` run on the
arena's far wall). Level 2: new layout, same size, same legend, five doors `D E F G H` gating
six zones with the WO4 rules (one wall buy in the start room, ≥ 8 tiles between wall buys, box
behind ≥ 2 doors, 8 windows + 2 open spawns, no door-less links between zones), plus the arena.
`tests/levels.test.js`: run the WO4 validity suite against **both** levels (factor the checks
into a helper inside the test file), plus arena rules: arena reachable only through `M`, contains
`Z`, 4–6 `X`, `T` on its boundary, no windows/buys/box inside, stairs unreachable until opened.

### 3.6 Render, audio (Agent E), HUD (Agent F)

Render: static layer uses `map.theme` colours (floor/floorAlt checker, wall, wallEdge, door
wood/iron); `theme.ambient` screen tint; `theme.torch` draws flickering amber dots on wall
tiles adjacent to floor every ~6 tiles (deterministic from tile index); mega door: taller iron
door with rivets and a skull plate, label "MEGA DOOR" / cost, red "SEALED" plate while sealed;
stairs: dark descending steps drawn when open, "DESCEND" plate; arena floor slightly darker;
boss: big zombie sprite scaled 2.4× with a rusted crown/helmet and `boss.tint`, telegraph flash
white, dash motion streak, red eyes; minions: 0.7× scale, darker, red eyes; boss death: large
blood pool + flash; transition: full-screen black overlay alpha from `state.transition`
(0→1→0), level banner is HUD's job; `boss:start` shake 10. Audio: `boss:start` roar + drum
hit, charge telegraph sting (listen to a `boss:charge` event), boss hit thud, `boss:defeated`
victory sting, `level:descend` stairs footsteps + low drone, `level:start` sting,
`purchase:made kind megadoor` heavy iron grind.

HUD: boss bar top-centre below the power-up chips: name, red bar with white damage-lag bar,
hidden unless `state.boss.phase === 'active'`; banners (reuse the fire-sale banner style):
"BOSS: THE WARDEN" on `boss:start`, "STAIRS OPENED" on `boss:defeated`, "LEVEL 2 — CATACOMBS"
on `level:start` (not on the first level of a new game), plus a small persistent level name
under the round counter ("L2 CATACOMBS"). Prompts for megadoor/stairs use the existing prompt
element (grey when blocked).

### 3.7 Events (Phase 0 adds to the canonical table in `tests/contracts.test.js`)

| Event            | Payload                          | Emitted by |
|------------------|----------------------------------|------------|
| `boss:start`     | `{ name, maxHp, level }`         | boss |
| `boss:charge`    | `{ x, y }`                       | zombie (telegraph start) |
| `boss:defeated`  | `{ name, level }`                | boss |
| `level:start`    | `{ index, name, loop }`          | level |
| `level:descend`  | `{ from, to }`                   | level |
`purchase:made` gains kinds `megadoor` (no new event).

### 3.8 Config (Phase 0)

```js
export const DOORS = { megaCost: 250 };
export const BOSS = {
  radius: 34, speed: 90, damage: 75, attackWindup: 0.5, attackCooldown: 1.4,
  baseHealth: 4000, roundScale: 0.12, points: 200, deathLinger: 2.0,
  chargeEvery: 7, chargeTelegraph: 0.6, chargeSpeedMult: 3.5, chargeMaxTime: 1.1, chargeRecover: 0.4,
  chargeKnockback: 40, summonEvery: 12, minionsPerWave: 4, maxMinions: 10,
  instaKillFrac: 0.05, nukeFrac: 0.10, thunderNearFrac: 0.15, thunderNearKnock: 60, thunderFarKnock: 40,
  minion: { radius: 10, speedMult: 1.1, healthFrac: 0.45, damage: 25, attackCooldown: 0.8 },
};
export const LEVELS_CFG = { fadeSeconds: 1.2, loop: { healthMult: 1.4, countMult: 1.15, speedMult: 1.05, sprintShift: 3 } };
```
State additions: `level: null`, `boss: null`, `transition: null`; `rounds.suspended` documented.

---

## 4. Execution plan

- **Phase 0 (1 agent):** config blocks, state fields, event table + export lists in
  `tests/contracts.test.js` (new exports from 3.1–3.5; they will fail until agents land — group
  them in a test named `WO5 new exports`), stubs for `boss.js`, `level.js`, `levels/*.js`
  (level1 stub re-exports the current `MAP_ASCII` and `WALLBUY_MAP` from map.js as `LEVEL1`
  so nothing changes yet; level2 stub = copy of level 1 with `id: 'catacombs'`), notes file.
- **Phase 1 (7 agents: A–G in parallel).** Expected slowest: A (two full maps) and C (boss AI).
- **Phase 2 (Integrator):** `main.js`: boot via `level.startLevel(state, 0)` instead of
  `map.loadMap()`; call `boss.initBoss`, `level.updateLevel` (before player update; skip gameplay
  updates during a transition), `boss.updateBoss` after zombies; restart resets level index to 0;
  debug hooks `openMegaDoor()`, `startBoss()`, `killBoss()`, `descend()`, `setLevel(i)`,
  `setDifficulty(...)`. Consolidate `TODO(integrator)` constants. Full browser run-through: open
  all doors → mega door → fight (charge, summons, power-up rules) → stairs → level 2 look, new
  guns on walls, harder zombies → level 2 boss → level 3 (loop). README update.
- **Phase 3 (QA ×3):** playtest (the run-through above with screenshots per stage), code review
  (boss state machine edge cases: player dies mid-fight, restart mid-fight, nuke/insta/thunder on
  boss, minions vs pockets, transition re-entrancy, listener leaks across level swaps and
  restarts), balance (boss TTK with level-1 best guns ≈ 45–75 s at round 8–12; minion pressure;
  level 2 economy with 200–350 prices; loop scaling to level 4).
- **Phase 4:** fix agents by file group; final verification with screenshots to
  `docs/screenshots/wo5-*.png`.

## 5. Acceptance

- [ ] Mega door prompt is blocked until all five doors are open; costs 250; leads to the arena.
- [ ] Entering the arena seals the door, shows the boss bar + banner, roars, spawns the boss and
      a first minion wave; normal spawning stops; existing outside zombies stay.
- [ ] Boss melees, charges with a visible telegraph, stops at walls, summons minions every 12 s
      up to 10 alive; minions are fast, small, 10 points; boss power-up rules hold.
- [ ] Killing the boss: death animation, +200 total, Max Ammo drop, minions die, door unseals,
      stairs open, "STAIRS OPENED", rounds resume with a break.
- [ ] Stairs prompt → fade → level 2: catacomb look, torches, new layout, all doors closed, box
      reset, weapons/points/health kept, "LEVEL 2 — CATACOMBS", round counter continues.
- [ ] Level 2 walls sell the new guns at 200–350; they feel stronger; zombies are visibly tougher
      and faster; boss 2 has its own name; stairs from level 2 lead to level 3 (level 1 layout,
      next theme, harder).
- [ ] Restart from any point returns to level 1 with everything reset; no duplicated listeners.
- [ ] `npm test` green (both levels pass the validity suite); zero console errors through the
      whole run; frame cost < 3 ms with boss + 10 minions + 24 zombies.

## 6. Spawn prompts

**Phase 0**
```
You are Agent 0 (scaffold) for WORK_ORDER_5.md in the current directory. Read it fully. Do
Phase 0 exactly per Section 4 and 3.7/3.8: config blocks BOSS/DOORS/LEVELS_CFG (targeted insert),
state.js fields, tests/contracts.test.js event table + a 'WO5 new exports' test, stubs for
src/boss.js, src/level.js, src/levels/levels.js, level1.js (LEVEL1 built from the current
map.js MAP_ASCII + WALLBUY_MAP + a level-1 theme), level2.js (temporary copy). Nothing may change
behaviour yet. npm test (node --test "tests/*.test.js") must be green except the 'WO5 new
exports' test; node --check clean. Write docs/notes/wo5-scaffold.md. No git, no questions.
```
**Phase 1 (A–G)**
```
You are Agent <LETTER> for WORK_ORDER_5.md in the current directory. Read Sections 0, 1, 3 in
full and your ownership row in 2.1. Implement your part of Section 3 completely; edit ONLY your
files. Siblings are being written concurrently: import them as namespaces, call lazily, guard
missing exports, and never edit them. Keep every existing export signature. Ship tests for logic
modules, keep npm test (node --test "tests/*.test.js") green for your files, node --check, and
verify visual/DOM work in the browser on port <8151+letter index> with ?debug=1. Append a "WO5"
section to your notes file(s) with decisions, deviations and constants to move to config. Stop
servers, close tabs, no git, no questions.
```
**Phase 2 / 3 / 4:** as in WO2 Section 8, with the acceptance list from Section 5 and ports
8161–8169.
