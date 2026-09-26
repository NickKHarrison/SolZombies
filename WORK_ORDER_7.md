# WORK ORDER 7 — Zombie sprites, perks, knife, high scores, third level

Five player-facing features delivered as one order so that file ownership stays conflict-free
while **13 agents build in parallel**. Current state: WO6 complete, 402 tests green, live on
GitHub Pages, git repo on `main` (agents never run git).

| Track | Feature | Summary |
|-------|---------|---------|
| T1 | **Pixel-art zombies** | Walker / jogger / sprinter, minion and boss sprites with walk cycles, replacing the circles. |
| T2 | **Perks** | Six BO3 perk machines placed on every level: Juggernog, Quick Revive, Speed Cola, Double Tap II, Stamin-Up, Mule Kick. Four-perk cap. |
| T3 | **Knife** | A melee swing on `V` / a KNIFE touch button, with a small point bonus. |
| T4 | **High scores** | Local top-10 table and a run summary on the game-over screen; best run on the menu. |
| T5 | **Third level: LABORATORY** | New 60×40 layout, clinical theme with flickering lights, a boss with an acid-spit ability, three tier-3 guns. |

House rules from WO1–WO6 apply: one file one owner (Section 2), targeted edits on shared
files, import siblings as namespaces and guard missing exports, pure modules never touch the
DOM, all randomness via `state.rng`, palette-only art, `npm test` =
`node --test "tests/*.test.js"`, `node --check` on every file you touch, browser checks on your
own port with `?debug=1` (and `&touch=1` for touch UI) using `__game.debug.step(dt, dt,
inputOverrides)`, stop servers, close tabs, no git, no questions, append a "WO7" section to your
`docs/notes/<module>.md`.

---

## 1. Feature design

### 1.1 T1 — Pixel-art zombies

- New pure art module `src/sprites/zombie.js` (same grid/palette approach as `soldier.js`):
  - `ZOMBIE_SPRITES.normal`: 16×16 grids at 2× scale (matches radius 14). **Body layer** facing
    +x: hunched torso, ragged clothes, two arms stretched forward, head with a pale face and
    dark eye sockets; 1-px `k` outline. **Legs layer**: 6-frame shamble cycle (shorter, draggier
    than the soldier). Three tints via a `variant` palette swap so tiers read at a glance:
    walker (grey-green, torn shirt), jogger (olive-brown, bloodier), sprinter (dark, lean,
    red-tinged eyes). Provide `damaged` overlay (blood splatter) shown below 50 % HP.
  - `ZOMBIE_SPRITES.minion`: 12×12, near-black purple, red eyes, spindly (the FIX-3 look).
  - `ZOMBIE_SPRITES.boss`: 40×40 body + 40×40 legs (4-frame stomp), crown/helmet region uses a
    `tint` marker colour that render recolours per level (`levelDef.boss.tint`), clawed arms;
    `charge` overlay frame (arms forward, head down).
  - Death: `ZOMBIE_SPRITES.corpse` per kind (lying sprite) drawn for `deathLinger` then fades.
- Render (`render.js`): replace `drawZombies` / `drawBoss` circle art with the sprites. Legs
  rotate to the zombie's movement direction (from per-zombie position deltas tracked in a
  render-side `Map` keyed by id, like the stun-puff tracking), body rotates to face the player
  (chasing/attacking) or movement direction (wandering/tearing). Walk phase from distance moved
  (`SPRITES.zombieStride`). Hit flash tints white; stunned zombies use the flattened draw with
  the corpse sprite; tearing zombies show the arms-forward frame. Keep 32-direction crisp
  rotation and the sprite caches; frame budget unchanged (< 3 ms with 24 zombies + boss + 10
  minions). Preview page gets a zombie sheet section (Agent A edits `tools/sprite-preview.html`
  **only** to add that section).

### 1.2 T2 — Perks

Prices are BO3 ÷ 10 like everything else. Cap `PERKS.maxPerks = 4`. Perks persist across
levels; all perks are lost on a Quick Revive self-revive (BO3 solo rule).

| id | Machine letter | Name | Cost | Effect |
|----|----------------|------|------|--------|
| jugg | `J` | Juggernog | 250 | `maxHealth` 150 → 250, heal to full on purchase |
| revive | `Q` | Quick Revive | 50 | On going down: 1.5 s "down" pause (zombies stop attacking), then revive at full health with 2 s invulnerability; consumes the perk and removes all other perks. Max 3 purchases per game; machine shows "SOLD OUT" after |
| speed | `C` | Speed Cola | 300 | Reload time × 0.5 |
| dtap | `N` | Double Tap II | 200 | Rate of fire × 1.33 and hitscan bullet damage × 2 (projectiles and cone weapons unchanged) |
| stamin | `U` | Stamin-Up | 200 | Move speed × 1.07, sprint multiplier × 1.2 |
| mule | `K` | Mule Kick | 400 | Third weapon slot (`weaponSlots` 3); losing the perk drops the third gun |

- Machines are wall tiles (`TILE_PERK = 10`, blocking, block rays), interactable within the
  usual range: prompt `"Press F for Juggernog [250]"`; blocked prompts: `"Already have
  Juggernog"`, `"Perk limit reached"`, `"Quick Revive sold out"`. Purchase emits
  `perk:bought { perkId, cost }` and a jingle. Each level places 5–6 machines across zones
  (Quick Revive in the start room, Juggernog behind ≥ 1 door, Mule Kick deepest).
- HUD: a row of perk icons above HEALTH (bottom-left), CSS-drawn bottle shapes in the perk's
  colour with its initial; Quick Revive shows remaining uses. Game-over summary lists perks held.
- Render: machine = tall vending box in the perk colour with a glowing front panel, a bottle
  glyph and a label plate (name / price) on the floor side, dark when sold out.
- Player fields: `player.perks: string[]`, `player.reviveUses: 0`, `player.invulnT: 0`,
  `player.downT: 0`. Effects applied by pure helpers in `player.js` and read by `weapons.js`
  (`perkMods(player) -> { reloadMult, rpmMult, bulletDamageMult, speedMult, sprintMult }`).

### 1.3 T3 — Knife

- Key `V` (desktop) and a `KNIFE` touch button (bottom-right cluster, left of RELOAD). Swing:
  `MELEE = { damage: 150, cooldown: 0.5, reach: 44, halfAngle: 0.7, maxTargets: 3, knockback: 90,
  swingTime: 0.25, bonusPoints: 5 }`. Hits every live zombie whose edge is within `reach` of the
  player's edge and within `halfAngle` of the aim. Insta-Kill makes it lethal; Double Tap does not
  affect it; boss takes the normal per-hit cap. Knife kills pay `POINTS.perKill + MELEE.bonusPoints`.
- Animation: soldier torso `knife` pose (2 frames: arm cocked, arm thrust with a small blade)
  drawn for `swingTime` regardless of gun; a white arc slash effect `{type:'slash', x, y, angle}`;
  audio swipe, and a wet hit on contact. Emits `melee:swing { x, y, angle }` and
  `melee:hit { zombieId }`.
- Cannot swing while reloading? **Yes it can** (BO3 lets you), but it cancels the reload.

### 1.4 T4 — High scores and run stats

- `src/scores.js` (pure logic + guarded `localStorage` access under key
  `solzombies.scores.v1`): `loadScores()`, `saveScores()`, `recordRun(stats) -> { rank | null,
  entry, best: { round, points } }`, `topScores(n = 10)`, `clearScores()`. Ranking: round desc,
  then points desc, then time desc. Entry: `{ round, points, kills, level, bosses, timeSec,
  perks, weapon, date }`. Storage failures (private mode) are caught: the game never throws.
- `state.stats` gains `timeSurvived, levelReached, bossesKilled, powerupsCollected, doorsOpened,
  meleeKills, perksBought, bestWeaponId` (Phase 0 adds the fields; owners increment: boss.js,
  shop.js, player.js, powerups.js already emit events → `main.js` increments from events to avoid
  touching more files).
- Game-over screen: run summary (rounds, kills, points earned, accuracy, time, level, bosses,
  perks, favourite weapon), rank line ("#3 ALL TIME" or "NEW BEST ROUND!" banner via the banner
  queue), then the top-5 table. Menu: "BEST: ROUND 12 · 3,450 PTS" under the title and a top-5
  table. Debug hook `clearScores()`.

### 1.5 T5 — Third level: LABORATORY

- `src/levels/level3.js`: id `lab`, name `LABORATORY`, new 60×40 layout following the WO4/WO5
  zone rules (one wall buy in the start room, five doors, box behind ≥ 2 doors, 8 windows + 2
  open spawns, arena + `M` + `Z` + 4–6 `X` + `T`, perk machines per 1.2). Look: clean pale
  green-grey tiles with white grout (`floor`/`floorAlt`), steel-blue walls with hazard stripes
  beside doors, glass tanks as decor blocks. Theme adds `flicker: true`: render dims the ambient
  tint briefly at random (deterministic from time) like failing fluorescent tubes.
- Difficulty `{ healthMult: 2.0, speedMult: 1.2, countMult: 1.5, sprintShift: 5 }` (must exceed
  level 2). Loop scaling continues from level 3 (already generic in `level.js` via `LEVELS.length`).
- Boss **THE SUBJECT** (`boss.ability: 'acid'`, tint `#7fe040`): no charge; every
  `BOSS.acid.every` (6 s) a 0.5 s telegraph then 3 acid globs lobbed toward the player's position
  (spread ±25°), 0.8 s flight, each leaving a pool (`state.hazards[]`, radius 50, 5 s) that deals
  `BOSS.acid.dps` (25) to the player while inside (not to zombies). Existing bosses keep
  `ability: 'charge'`. Emits `boss:spit { x, y }` at telegraph start.
- Three tier-3 guns on level 3 walls (also box weight 2), `tier: 3`, ammo × 0.3:

| id | name | cls | cost | dmg | rpm | auto | mag/reserve | reload | notes |
|----|------|-----|------|-----|-----|------|-------------|--------|-------|
| hg40 | HG 40 | smg | 350 | 95 | 720 | yes | 40/280 | 1.9 | |
| m8a7 | M8A7 | ar | 375 | 115 | 780 | yes | 32/256 | 2.2 | penetration 2, spread 0.02 |
| peacekeeper | Peacekeeper MK2 | ar | 400 | 135 | 650 | yes | 30/270 | 2.3 | penetration 3 |

Level 3 walls also sell Gorgon and Drakon (tier 2) in its deep zones. Level 4 = BUNKER II etc.

---

## 2. Ownership (Phase 1 runs all 13 at once)

| Agent | Track(s) | Owns |
|-------|----------|------|
| 0 (Phase 0) | all | `src/config.js` (add `PERKS`, `MELEE`, `SCORES`, `BOSS.acid`, `SPRITES.zombieStride`), `src/state.js` (stats fields, `hazards: []`), `tests/contracts.test.js` (events + `WO7 new exports` test), stubs: `src/sprites/zombie.js`, `src/scores.js`, `src/levels/level3.js` (temporary copy of level 2 with id `lab`), `docs/notes/wo7-scaffold.md` |
| A | T1 | `src/sprites/zombie.js`, `tools/sprite-preview.html` (zombie section only), `docs/notes/zombie-sprites.md` |
| B | T3 | `src/sprites/soldier.js` (knife pose frames only), `src/sprites/animator.js` (melee pose timing), `tests/animator.test.js`, `docs/notes/soldier.md`, `docs/notes/animator.md` |
| C | T1 T2 T3 T5 | `src/render.js`, `docs/notes/render.md` — zombie/boss/minion/corpse sprites, perk machines, slash effect, knife pose, acid globs + pools, lab flicker |
| D | T2 T3 T4 | `src/hud.js`, `styles.css`, `docs/notes/hud.md` — perk icon row, KNIFE button style, game-over summary + top-5, menu best line, "down"/revive overlay, controls text |
| E | T2 T3 | `src/player.js`, `tests/player.test.js`, `docs/notes/player.md` — perks state + `perkMods`, Juggernog/Stamin-Up/Mule Kick effects, Quick Revive down/revive flow, `invulnT`, knife trigger (`meleeAttack` call), melee kill bonus |
| F | T2 T3 T5 | `src/weapons.js`, `src/sprites/guns.js`, `tests/weapons.test.js`, `tests/sprites.test.js` (gun rows), `docs/notes/weapons.md`, `docs/notes/guns.md` — perk multipliers, `meleeAttack`, tier-3 guns + art |
| G | T2 | `src/map.js`, `src/shop.js`, `tests/map.test.js`, `tests/shop.test.js`, `docs/notes/map.md`, `docs/notes/shop.md` — `TILE_PERK`, machine parsing, `nearestInteractable` kind `perk`, `buyPerk` + prompts, sold-out |
| H | T5 | `src/boss.js`, `src/zombie.js`, `tests/boss.test.js`, `tests/zombie.test.js`, `docs/notes/boss.md`, `docs/notes/zombie.md` — per-level `ability`, acid spit + `state.hazards`, downed-player rule (zombies do not attack while `player.downT > 0` or `invulnT > 0`), `POINTS.perKill` untouched |
| I | T2 T5 | `src/levels/level1.js`, `level2.js`, `level3.js`, `levels.js`, `tests/levels.test.js`, `docs/notes/levels.md` — perk machines on all levels, the LABORATORY layout, registry `[L1, L2, L3]` |
| J | T4 | `src/scores.js`, `tests/scores.test.js`, `docs/notes/scores.md` |
| K | T3 | `src/input.js`, `src/touch.js`, `docs/notes/input.md`, `docs/notes/touch.md` — `melee` edge on `V`, KNIFE touch button |
| L | T2 T3 T5 | `src/audio.js`, `docs/notes/audio.md` — perk jingles, revive sting, knife swipe/hit, acid spit + sizzle, lab ambience |
| INT | all | `src/main.js` (stats from events, scores record on game over, hazards update call, debug hooks `givePerk(id)`, `knife()`, `clearScores()`, `setLevel(2)`), `README.md`, any file for integration fixes, `docs/notes/integration-wo7.md` |
| QA-1/2/3 | all | `docs/qa/wo7-*.md` only |

---

## 3. Contracts

### 3.1 Config (Phase 0)

```js
export const PERKS = {
  maxPerks: 4,
  list: {
    jugg:   { name: 'Juggernog',     letter: 'J', cost: 250, color: '#d62828', maxHealth: 250 },
    revive: { name: 'Quick Revive',  letter: 'Q', cost: 50,  color: '#3ec9ff', maxUses: 3, downSeconds: 1.5, invulnSeconds: 2 },
    speed:  { name: 'Speed Cola',    letter: 'C', cost: 300, color: '#6cf542', reloadMult: 0.5 },
    dtap:   { name: 'Double Tap II', letter: 'N', cost: 200, color: '#ff9f1c', rpmMult: 1.33, bulletDamageMult: 2 },
    stamin: { name: 'Stamin-Up',     letter: 'U', cost: 200, color: '#ffd54a', speedMult: 1.07, sprintMult: 1.2 },
    mule:   { name: 'Mule Kick',     letter: 'K', cost: 400, color: '#b44dff', weaponSlots: 3 },
  },
  ammoMultTier3: 0.3,
};
export const MELEE = { damage: 150, cooldown: 0.5, reach: 44, halfAngle: 0.7, maxTargets: 3, knockback: 90, swingTime: 0.25, bonusPoints: 5 };
export const SCORES = { key: 'solzombies.scores.v1', max: 10 };
// BOSS gains: acid: { every: 6, telegraph: 0.5, globs: 3, spread: 0.44, flight: 0.8, poolRadius: 50, poolSeconds: 5, dps: 25 }
// SPRITES gains: zombieStride: 36, bossStride: 90
// state.js: stats += { timeSurvived: 0, levelReached: 1, bossesKilled: 0, powerupsCollected: 0, doorsOpened: 0, meleeKills: 0, perksBought: 0, bestWeaponId: null }; hazards: []
```

### 3.2 Events (Phase 0 adds to the canonical table)

| Event | Payload | Emitter |
|-------|---------|---------|
| `perk:bought` | `{ perkId, cost }` | shop |
| `perk:lost` | `{ perkId, reason: 'revive' \| 'debug' }` | player |
| `player:downed` | `{ reviveIn }` | player (Quick Revive path only) |
| `player:revived` | `{ health }` | player |
| `melee:swing` | `{ x, y, angle }` | weapons |
| `melee:hit` | `{ zombieId, killed }` | weapons |
| `boss:spit` | `{ x, y }` | zombie (telegraph start) |
| `score:recorded` | `{ rank, entry, isBestRound, isBestPoints }` | main |

`purchase:made` / `purchase:denied` gain kind `perk`.

### 3.3 Module APIs

```js
// sprites/zombie.js (A) — pure
export const ZOMBIE_SPRITES = {
  normal: { body: { walker, jogger, sprinter }, legs: { frames: Sprite[6], anchor }, tearing: Sprite, damaged: Sprite /* overlay */, corpse: Sprite, anchor: {x:8,y:8} },
  minion: { body: Sprite, legs: { frames: Sprite[4], anchor }, corpse: Sprite, anchor: {x:6,y:6} },
  boss:   { body: Sprite, charge: Sprite, legs: { frames: Sprite[4], anchor }, corpse: Sprite, anchor: {x:20,y:20}, tintColor: '#ff00ff' /* marker recoloured by render via pixel.tint */ },
};
export function zombieSpriteFor(z) // -> { body, legs, corpse, anchor } for z.kind / z.tier

// player.js (E)
export function perkMods(player)             // { reloadMult, rpmMult, bulletDamageMult, speedMult, sprintMult, weaponSlots, maxHealth }
export function addPerk(state, perkId) -> bool   // enforces cap/uniqueness, applies immediate effects (jugg heal, mule slot), stats.perksBought++
export function removeAllPerks(state, reason)    // emits perk:lost per perk, drops slot 3 weapon, clamps health to new max
export function hasPerk(player, perkId)
// damagePlayer: if health hits 0 and hasPerk revive -> downT = downSeconds, emit player:downed; updatePlayer counts downT down then revives:
//   health = maxHealth (after removeAllPerks, so 150), invulnT = invulnSeconds, reviveUses unchanged (uses are counted at purchase), emit player:revived
// while downT > 0: no movement/fire; while invulnT > 0: damagePlayer ignored.
// updatePlayer: on input.melee -> weapons.meleeAttack(state, player) (respects cooldown inside weapons)

// weapons.js (F)
export function meleeAttack(state, player) -> number  // hits; sets player.meleeCd, player.meleeT = MELEE.swingTime; cancels reload; emits melee:swing / melee:hit; pushes slash effect
// tryFire/startReload/updateWeapon read player.js perkMods via a lazily-imported helper (namespace import): rpm, reloadTime, hitscan damage
export function ammoCost(id) // tier 3 uses PERKS.ammoMultTier3

// map.js (G)
export const TILE_PERK = 10;  // letters J Q C N U K -> machines: map.perkMachines = [{ id, perkId, tx, ty, x, y, w, h, soldOut: false }]
// nearestInteractable adds { kind: 'perk', ref: machine }; blocks movers and rays like a wall buy
// shop.js (G)
export function buyPerk(state, machine) -> bool  // prompts per 1.2; uses player.addPerk; revive: increments player.reviveUses, machine.soldOut when reviveUses >= maxUses; emits purchase:made {kind:'perk', id, cost} / purchase:denied; perk:bought

// boss.js / zombie.js (H)
// levelDef.boss.ability: 'charge' (default) | 'acid'. zombie.js boss AI switches on it. Acid: state.hazards.push({ id, kind: 'acid', x, y, r, ttl, maxTtl, dps })
export function updateHazards(state, dt)   // in boss.js: ttl countdown, player damage when inside (respects invulnT / downT), prune
// zombies never attack a player with downT > 0 or invulnT > 0 (they still chase)

// scores.js (J) — pure except guarded localStorage
export function loadScores(storage = defaultStorage) -> Entry[]
export function recordRun(stats, extra = {}, storage) -> { rank, entry, isBestRound, isBestPoints }
export function topScores(n = 10, storage) -> Entry[]
export function clearScores(storage)
export function formatTime(sec) -> 'm:ss'

// input.js / touch.js (K)
// getInput() gains melee (edge). touch.js adds .tbtn.tbtn-knife "KNIFE" (button name 'knife', edge into getTouchState().melee)

// hud.js (D)
export function setScores(summary)   // { best: {round, points}|null, top: Entry[] } for the menu
export function setGameOverSummary(summary)  // { stats..., rank, top: Entry[] } for the game-over screen
// perk icons read player.perks; down overlay when player.downT > 0 ("REVIVING…" with a bar)

// render.js (C) effects it must draw: 'slash' {x,y,angle,ttl}, hazards kind 'acid' (bubbling green pools, fading), acid glob projectiles from state.bullets with def.kind === 'acid' (H pushes them with {x,y,vx,vy,ttl,kind:'acid'}), perk machines from map.perkMachines, zombie sprites per 1.1
```

### 3.4 Levels (I)

Perk machines per level (letters in walls, adjacent to walkable floor, ≥ 6 tiles from any wall
buy so labels do not collide): L1 — Q hub, J corridor, C courtyard, N bunker, U armory, K vault.
L2 — Q chapel, C ossuary, J west crypts, N bone chamber, U charnel pit, K sanctum. L3 — designed
fresh, same rule set. `tests/levels.test.js` gains: each level has exactly 6 machines, one per
perk, Q in the start zone, K in the deepest zone, all reachable with all doors open, none inside
the arena or within 2 tiles of it.

---

## 4. Phases

- **Phase 0 (1 agent):** config, state, events/contract tests, stubs, notes. Tests green except
  `WO7 new exports`.
- **Phase 1 (13 agents A–L in parallel).** Art agents (A, B) iterate in the preview page.
  Everyone else builds against stubs and verifies what they can.
- **Phase 2 (Integrator):** `main.js` wiring: stats from events (`purchase:made` kind door →
  doorsOpened, `powerup:collected` → powerupsCollected, `boss:defeated` → bossesKilled,
  `melee:hit` killed → meleeKills, `level:start` → levelReached, `zombie:killed` weaponId
  tally → bestWeaponId, `timeSurvived = state.time`), `boss.updateHazards` in the loop after
  zombies, `scores.recordRun` on `player:down` → `hud.setGameOverSummary`, `hud.setScores` at
  boot/menu, debug hooks, README. Full browser run: perks (all six, cap, revive flow), knife on
  desktop and touch, zombie sprites in all tiers + boss + minions, level 3 look and boss acid,
  scores persist across reload, restart clean.
- **Phase 3 (QA ×3):** playtest with screenshots per feature; code review (revive edge cases:
  down during boss fight / transition / restart, Mule Kick loss with the third gun active, perk
  mods with Death Machine, knife vs sealed doors and windows, hazards across level swaps,
  localStorage disabled); balance (perk prices vs economy, Double Tap TTK, knife rounds 1–3,
  level 3 economy and boss TTK, loop from level 4).
- **Phase 4:** fix agents by file group; final verification with screenshots
  `docs/screenshots/wo7-*.png`.

## 5. Acceptance

- [ ] Zombies are readable pixel sprites in three tiers with shamble cycles; minions and bosses
      have their own sprites; corpses linger; no frame-cost regression.
- [ ] Six perk machines per level; buying applies effects immediately; cap of four; Quick Revive
      revives once per purchase, three purchases max, and strips other perks; perks survive
      descents; icons show in the HUD.
- [ ] `V` / KNIFE swings with animation, arc, sound; kills pay 15; cancels reload; works on touch.
- [ ] Game over shows the run summary, rank and top-5; menu shows the best run; scores survive a
      reload and a cleared-storage/private-mode session does not break the game.
- [ ] Level 3 LABORATORY reachable from level 2's stairs with its own look, flicker, tier-3 guns,
      perk machines and THE SUBJECT spitting acid pools that hurt the player; level 4 is BUNKER II
      with difficulty above level 3.
- [ ] `npm test` green, zero console errors through a full run to level 4, restart clean.

## 6. Spawn prompts

**Phase 0**
```
You are Agent 0 (scaffold) for WORK_ORDER_7.md in the current directory. Read it fully. Do Phase 0
per Sections 3.1, 3.2 and 2: config blocks (targeted inserts), state.js fields, contracts test
events + a 'WO7 new exports' test listing the exports in 3.3, stubs for src/sprites/zombie.js
(PLACEHOLDER sprites in the declared shape), src/scores.js (in-memory fallback storage), and
src/levels/level3.js (temporary copy of level 2 with id 'lab', name 'LABORATORY', a lab theme,
boss {name:'THE SUBJECT', tint:'#7fe040', ability:'acid'}); register it in levels.js. No behaviour
change otherwise; npm test green except the new-exports test; node --check clean. Write
docs/notes/wo7-scaffold.md with clarifications. No git, no questions.
```
**Phase 1 (A–L)**
```
You are Agent <LETTER> for WORK_ORDER_7.md in the current directory. Read Sections 0-3 in full and
your row in Section 2. Implement everything assigned to you across your tracks; edit ONLY your
files. Siblings are being written concurrently: import as namespaces, call lazily, guard missing
exports, never edit them. Keep every existing export signature. Ship tests for logic modules and
keep npm test (node --test "tests/*.test.js") green for your files; node --check. Art and DOM work
is verified in the browser on port <8201 + letter index> (?debug=1, plus &touch=1 for touch UI) with
screenshots. Append a "WO7" section to your notes file(s): decisions, deviations, constants to
move to config. Stop servers, close tabs, no git, no questions.
```
**Phases 2–4:** as in WO5 Section 6 with the acceptance list above and ports 8221–8229.
