# WORK ORDER — "Sol Zombies" (working title)

Browser top-down round-based zombie survival shooter in the style of Call of Duty: Black Ops 3 Zombies.
Plain JavaScript, HTML5 Canvas, no build step, no dependencies.

This document is the single source of truth for a fleet of parallel Opus coding agents. It is
written so that **up to 13 agents can code simultaneously without ever touching the same file**.
Read Section 0 (rules) and Section 3 (contracts) before writing any code, then your own module
section.

---

## 0. Rules for every agent (read first)

1. **One file, one owner.** You may only create or edit the files listed under your agent ID in
   Section 2. Never edit another agent's file, even to fix a bug. If you find a bug elsewhere,
   write it in your notes file (`docs/notes/<your-module>.md`).
2. **Shared files are frozen after Phase 0**: `src/config.js`, `src/events.js`, `src/math.js`,
   `src/state.js`, `index.html`. If you need a new constant, define it at the top of your own
   file with a comment `// TODO(integrator): move to config.js` and list it in your notes file.
3. **Code against the contracts in Section 3, not against other agents' code.** Other modules
   may not exist yet when you start. Import them by the exact names in Section 3.
4. **Pure logic modules must not touch the DOM.** `player, weapons, zombie, pathfinding, waves,
   powerups, map, shop` must not reference `window`, `document`, `canvas`, or `requestAnimationFrame`.
   This is what lets them run under `node --test`. Only `input, render, hud, audio, main` may
   touch the DOM.
5. **ES modules only.** `export function ...` / `import { ... } from './x.js'`. Always include
   the `.js` extension in import paths. No CommonJS, no bundler, no TypeScript, no npm packages.
6. **All randomness goes through `state.rng`** (see `math.js`), never `Math.random()`. This keeps
   tests deterministic.
7. **Verify before you finish.** Run `node --check src/<yourfile>.js` on every file you wrote.
   Logic-module owners must also write `tests/<module>.test.js` using Node's built-in `node:test`
   and make it pass with `node --test tests/`.
8. **Write a notes file** at `docs/notes/<module>.md` when done: what you built, anything you
   assumed, any contract deviations, any constants you want moved to config.
9. **Safety:** no git commands, no deleting or renaming files you do not own, no global installs,
   no downloading assets from the internet, no commands outside the project directory. Never run
   `rm -rf`, `git reset`, or `git clean`.
10. **Do not "improve" the scope.** Build what your section says. Put ideas in your notes file.
11. **Do not ask the user questions.** Make a reasonable choice, state it in your notes, move on.

---

## 1. Game summary and design pillars

- **Genre:** Top-down (bird's-eye) twin-stick style shooter. Mouse aims, WASD moves. Single player.
- **Loop:** Survive rounds of zombies. Each round spawns more, tougher, faster zombies from
  spawn points around the map (barricaded windows and open corridors). When every zombie of a
  round is dead, a short break plays and the next round begins. There is no win condition; the
  score is the round reached.
- **Points:** Every zombie kill awards **10 points** (`POINTS.perKill`). Points buy weapons off
  the wall, ammo, and mystery-box spins. Double Points doubles every award.
- **Power-ups:** Zombies have a **low chance (2%)** to drop a glowing power-up on death, max 4
  per round. The full Black Ops 3 set is implemented: Insta-Kill, Double Points, Max Ammo, Nuke,
  Carpenter, Fire Sale, Death Machine, Zombie Blood.
- **Wall buys:** Chalk outlines on walls sell fixed BO3 weapons (Sheiva, KRM-262, VMP, Kuda,
  Vesper, KN-44, etc.). Buying a gun you already hold refills its ammo at half price.
- **Mystery Box:** One box on the map gives a random weapon from a larger pool. Required so that
  Fire Sale has meaning.
- **Barricades:** Windows have 6 boards. Zombies tear them down one at a time to get in. The
  player can rebuild boards for small points. Required so that Carpenter has meaning.
- **Feel:** Fast, readable, arcade. Simple geometric art (circles, rects, glow) is fine and
  expected. No sprite assets. Sound is synthesized with WebAudio.

### 1.1 Economy assumption (important)

Real BO3 awards 50–130 points per kill plus 10 per bullet hit, with wall guns costing 500–1500.
This order mandates **10 points per kill and 0 per hit**, so every BO3 price in this document is
**scaled to one tenth** (Sheiva 50, VMP 125, KN-44 150, box 95, nuke bonus 40, carpenter bonus 20).
All numbers live in `src/config.js` and `src/weapons.js` so the integrator can retune in one place.

---

## 2. Repository layout and file ownership

```
Sol Game/
├─ index.html                  Phase 0 (Agent 0)      canvas + hud root + module script tag
├─ package.json                Phase 0 (Agent 0)      scripts: start, test
├─ README.md                   Phase 0 (Agent 0)      how to run
├─ WORK_ORDER.md               (this file, read-only)
├─ styles.css                  Agent J (hud)
├─ src/
│  ├─ config.js                Phase 0 — FROZEN       all tunables
│  ├─ events.js                Phase 0 — FROZEN       event bus
│  ├─ math.js                  Phase 0 — FROZEN       vectors, collision, seeded rng, ids
│  ├─ state.js                 Phase 0 — FROZEN       canonical state shape + createEmptyState
│  ├─ input.js                 Agent A
│  ├─ player.js                Agent B
│  ├─ weapons.js               Agent C
│  ├─ zombie.js                Agent D
│  ├─ pathfinding.js           Agent E
│  ├─ waves.js                 Agent F
│  ├─ powerups.js              Agent G
│  ├─ map.js                   Agent H
│  ├─ shop.js                  Agent I
│  ├─ render.js                Agent K
│  ├─ hud.js                   Agent J
│  ├─ audio.js                 Agent L
│  └─ main.js                  Phase 2 (Integrator)   game loop + wiring + debug hooks
├─ tests/
│  ├─ <module>.test.js         owned by that module's agent
│  └─ contracts.test.js        Agent M (contract tests, Phase 1)
└─ docs/
   └─ notes/<module>.md        owned by that module's agent
```

### 2.1 Ownership table

| Agent | Owns (create/edit)                                          | Phase |
|-------|-------------------------------------------------------------|-------|
| 0     | index.html, package.json, README.md, src/config.js, src/events.js, src/math.js, src/state.js, stub files for every src module, docs/notes/.gitkeep | 0 |
| A     | src/input.js, docs/notes/input.md                           | 1 |
| B     | src/player.js, tests/player.test.js, docs/notes/player.md   | 1 |
| C     | src/weapons.js, tests/weapons.test.js, docs/notes/weapons.md| 1 |
| D     | src/zombie.js, tests/zombie.test.js, docs/notes/zombie.md   | 1 |
| E     | src/pathfinding.js, tests/pathfinding.test.js, docs/notes/pathfinding.md | 1 |
| F     | src/waves.js, tests/waves.test.js, docs/notes/waves.md      | 1 |
| G     | src/powerups.js, tests/powerups.test.js, docs/notes/powerups.md | 1 |
| H     | src/map.js, tests/map.test.js, docs/notes/map.md            | 1 |
| I     | src/shop.js, tests/shop.test.js, docs/notes/shop.md         | 1 |
| J     | src/hud.js, styles.css, docs/notes/hud.md                   | 1 |
| K     | src/render.js, docs/notes/render.md                         | 1 |
| L     | src/audio.js, docs/notes/audio.md                           | 1 |
| M     | tests/contracts.test.js, docs/notes/contracts.md            | 1 |
| INT   | src/main.js, plus **any** file, to fix integration mismatches | 2 |
| QA-1..3 | docs/qa/*.md only (report, do not fix)                    | 3 |
| FIX-n | files named in the QA finding assigned to them              | 4 |

---

## 3. Shared contracts

Everything below is normative. Function names, argument orders and return shapes must match
exactly. Phase 0 writes these files; Phase 1 agents import from them.

### 3.1 `src/config.js` (Phase 0 writes exactly this, Phase 1 reads only)

```js
export const CANVAS = { width: 1280, height: 720 };
export const TILE = 40;                       // world units (px) per map tile
export const FIXED_DT_CAP = 1 / 30;           // clamp big frame gaps

export const POINTS = {
  perKill: 10,          // mandated by the order
  perHit: 0,
  nukeBonus: 40,
  carpenterBonus: 20,
  barricadeBoard: 1,
  barricadeBoardsPerRoundCap: 10,
};

export const PLAYER = {
  radius: 14, speed: 220, sprintMult: 1.35,
  maxHealth: 150, regenDelay: 4.0, regenPerSec: 60,
  interactRange: 64, weaponSlots: 2,
  startWeapon: 'mr6',
};

export const ZOMBIE = {
  radius: 14,
  speeds: { walk: 70, jog: 130, sprint: 210 },
  damage: 50, attackRange: 34, attackWindup: 0.35, attackCooldown: 1.0,
  baseHealth: 150, healthPerRound: 100, roundsLinear: 9, healthMultAfter: 1.1,
  boardTearTime: 1.0,
  maxAlive: 24,
  separationRadius: 26, separationForce: 120,
  deathLinger: 0.6,      // seconds a corpse fades
};

export const ROUNDS = {
  earlyCounts: [6, 8, 13, 18, 24, 27, 28, 28, 29],   // rounds 1..9 (BO3 solo)
  breakSeconds: 8,
  firstRoundDelay: 3,
  spawnIntervalStart: 2.0, spawnIntervalMin: 0.5, spawnIntervalDecayPerRound: 0.93,
  nearSpawnRadius: 900,  // prefer spawn points within this distance of the player
  nearSpawnWeight: 4,    // how much more likely a near spawn point is
};

export const POWERUPS = {
  dropChance: 0.02, maxPerRound: 4, lifetime: 30, blinkAt: 10, pickupRadius: 28,
  duration: { instaKill: 30, doublePoints: 30, fireSale: 30, deathMachine: 30, zombieBlood: 30 },
  weights: { instaKill: 3, doublePoints: 3, maxAmmo: 3, nuke: 2, carpenter: 2, fireSale: 1, deathMachine: 1, zombieBlood: 1 },
  nukeSpawnPause: 3,
  nukeStagger: 0.08,     // seconds between successive zombie deaths during a nuke
};

export const PRICES = { mysteryBox: 95, fireSaleBox: 10, wallAmmoMult: 0.5 };
export const MYSTERY_BOX = { spinSeconds: 3, offerSeconds: 10 };

export const COLORS = {
  floor: '#2a2a2e', wall: '#0e0e10', wallEdge: '#3c3c44',
  player: '#e8e8f0', zombieWalk: '#5f7a3a', zombieJog: '#7a8a2f', zombieSprint: '#9a6a2a',
  blood: '#7a1010', powerupGlow: '#6cf542', tracer: '#ffd27a',
  hudText: '#f2f2f2', hudPoints: '#ffd54a', hudRound: '#d21f1f',
};
```

### 3.2 `src/events.js`

```js
export function on(name, fn)      // returns an unsubscribe function
export function off(name, fn)
export function emit(name, payload)
export function clearAll()        // used on restart and in tests
```

Canonical event names and payloads (emit exactly these):

| Event                | Payload                                                  | Emitted by |
|----------------------|----------------------------------------------------------|------------|
| `round:start`        | `{ round }`                                              | waves |
| `round:end`          | `{ round }`                                              | waves |
| `zombie:spawned`     | `{ zombie }`                                             | zombie |
| `zombie:hit`         | `{ zombie, amount, x, y }`                               | zombie |
| `zombie:killed`      | `{ zombie, cause, x, y }` cause: `'weapon'\|'nuke'\|'debug'` | zombie |
| `player:damaged`     | `{ amount, health }`                                     | player |
| `player:down`        | `{ round, kills, points }`                               | player |
| `points:changed`     | `{ delta, total, x, y }` (x,y optional, for floating text) | player |
| `weapon:fired`       | `{ weaponId, x, y, dirX, dirY }`                         | weapons |
| `weapon:reload`      | `{ weaponId }`                                           | weapons |
| `weapon:empty`       | `{ weaponId }`                                           | weapons |
| `weapon:equipped`    | `{ weaponId, slot }`                                     | player |
| `powerup:spawned`    | `{ item }`                                               | powerups |
| `powerup:collected`  | `{ type }`                                               | powerups |
| `powerup:expired`    | `{ type }`                                               | powerups |
| `purchase:made`      | `{ kind: 'weapon'\|'ammo'\|'box', id, cost }`            | shop |
| `purchase:denied`    | `{ kind, cost, have }`                                   | shop |
| `box:opened`         | `{ weaponId }`                                           | shop |
| `barricade:board`    | `{ barricadeId, boards, by: 'zombie'\|'player'\|'carpenter' }` | map |
| `game:start`         | `{}`                                                     | main |
| `game:over`          | `{ round, kills, points }`                               | main |
| `game:restart`       | `{}`                                                     | main |

### 3.3 `src/math.js`

```js
export function len(x, y)
export function norm(x, y)                        // -> {x, y} unit vector or {0,0}
export function dist(ax, ay, bx, by)
export function clamp(v, lo, hi)
export function lerp(a, b, t)
export function angleTo(ax, ay, bx, by)
export function circleHitsCircle(ax, ay, ar, bx, by, br)
export function circleHitsRect(cx, cy, r, rx, ry, rw, rh)
export function rayCircle(ox, oy, dx, dy, cx, cy, r)  // dx,dy unit; -> t (distance) or Infinity
export function rayRect(ox, oy, dx, dy, rx, ry, rw, rh) // -> t or Infinity
export function createRng(seed)                   // -> { next(): [0,1), range(lo,hi), int(lo,hi) inclusive, pick(arr), chance(p), weighted(objOfWeights) }
export function nextId()                          // monotonically increasing integer
```

### 3.4 `src/state.js`

```js
export function createEmptyState(seed = Date.now())
```

Returns the canonical state object. Every module reads and writes only its own slice.

```js
{
  phase: 'menu',            // 'menu' | 'playing' | 'gameover'
  time: 0, dt: 0,           // seconds since game start, last frame delta
  rng: createRng(seed),
  seed,
  camera: { x: 0, y: 0 },   // top-left of viewport in world units (main computes)
  map: null,                // map.loadMap()
  player: null,             // player.createPlayer()
  zombies: [],              // zombie objects
  bullets: [],              // projectiles (ray gun only; hitscan does not use this)
  effects: [],              // transient visuals: { type, ttl, maxTtl, ...fields } (render owns semantics)
  flow: null,               // pathfinding flow field, rebuilt every 0.2s by main
  rounds: null,             // waves.createRoundState()
  powerups: { items: [], active: {}, dropsThisRound: 0, nuke: null },
  shop: { prompt: null, box: { state: 'idle', timer: 0, weaponId: null } },
  stats: { kills: 0, shotsFired: 0, shotsHit: 0, pointsEarned: 0, roundReached: 0 },
  debug: false,
}
```

### 3.5 Entity shapes

**Player** (created by `player.createPlayer`)
```js
{ id, x, y, radius, angle, health, maxHealth, regenTimer, points, weapons: [Weapon|null, Weapon|null],
  activeSlot: 0, tempWeapon: null /* death machine */, down: false, moving: false, sprinting: false,
  invulnerable: false /* debug */, repairTimer: 0, boardsThisRound: 0 }
```

**Weapon** (created by `weapons.createWeapon`)
```js
{ id, def, mag, reserve, reloading: false, reloadT: 0, cooldown: 0, triggerHeld: false }
```

**Zombie**
```js
{ id, x, y, radius, hp, maxHp, tier: 'walk'|'jog'|'sprint', speed, mode: 'tearing'|'chasing'|'attacking'|'wandering'|'dying',
  spawnPointId, barricadeId: number|null, tearTimer, attackTimer, attackCd, dyingT, vx, vy, hitFlash: 0 }
```

**Power-up item**
```js
{ id, type, x, y, ttl, bob: 0 }
```
`state.powerups.active[type] = expiresAtTime` (absolute `state.time`), absent when inactive.

### 3.6 Module APIs (Phase 1 agents implement exactly these signatures)

```js
// input.js (Agent A)                     DOM
export function initInput(canvas)
export function getInput()  // -> { moveX, moveY, mouseX, mouseY, fire, firePressed, reload, interact, interactHeld, swap, sprint, restart, start, pause, debugKey }
export function endFrame()  // clear edge-triggered flags (…Pressed, interact, swap, reload, restart, start, pause)

// player.js (Agent B)                    pure
export function createPlayer(x, y)
export function initPlayer(state)                    // subscribe: zombie:killed -> addPoints(perKill), round:start -> boardsThisRound=0
export function updatePlayer(state, input, aim, dt)  // aim = {x,y} world coords
export function damagePlayer(state, amount)
export function addPoints(state, amount, x, y)       // applies doublePoints; emits points:changed
export function spendPoints(state, amount) // -> bool
export function getActiveWeapon(player)   // tempWeapon || weapons[activeSlot]
export function giveWeapon(state, weaponId)          // fills empty slot else replaces active; emits weapon:equipped
export function hasWeapon(player, weaponId) // -> bool
export function equipTemporary(state, weapon) / export function clearTemporary(state)

// weapons.js (Agent C)                   pure
export const WEAPONS            // { [id]: WeaponDef } see 5.4
export const WALL_WEAPON_IDS, BOX_WEAPON_IDS
export function createWeapon(id)
export function updateWeapon(w, dt)
export function tryFire(state, w, ox, oy, dx, dy)     // -> bool fired; performs hitscan/projectile, applies damage
export function startReload(w) // -> bool
export function refillReserve(w) / export function refillAll(w)
export function createDeathMachine()
export function updateBullets(state, dt)              // ray gun projectiles in state.bullets
export function ammoCost(id) // -> wall ammo price

// zombie.js (Agent D)                    pure
export function spawnZombie(state, spawnPoint)         // uses state.rounds.round for stats; pushes to state.zombies; emits zombie:spawned
export function updateZombies(state, dt)
export function damageZombie(state, z, amount, cause = 'weapon', x, y)
export function killZombie(state, z, cause = 'weapon')
export function healthForRound(round) / export function tierForRound(round, rng)

// pathfinding.js (Agent E)               pure
export function buildFlowField(map, targetX, targetY)  // -> FlowField
export function getFlowDir(flow, x, y)                 // -> {x, y} unit vector or {0,0}
export function distanceAt(flow, x, y)                 // -> tiles to target or Infinity

// waves.js (Agent F)                     pure
export function createRoundState()
export function initRounds(state)      // subscribe zombie:killed, zombie:spawned
export function updateRounds(state, dt)
export function zombiesForRound(round) // -> int
export function pauseSpawning(state, seconds)
export function skipToRound(state, round)  // debug

// powerups.js (Agent G)                  pure
export const POWERUP_TYPES
export const POWERUP_LABEL   // { instaKill: 'INSTA-KILL', ... } for HUD/render
export function initPowerups(state)    // subscribe zombie:killed -> roll drop; round:start -> dropsThisRound=0
export function updatePowerups(state, dt)
export function spawnPowerup(state, type, x, y)
export function applyPowerup(state, type)
export function isActive(state, type)  // -> bool
export function timeLeft(state, type)  // -> seconds (0 if inactive)

// map.js (Agent H)                       pure
export const MAP_ASCII
export function loadMap()               // -> Map (see 5.1)
export function worldToTile(x, y) / export function tileToWorld(tx, ty)  // center of tile
export function isWalkable(map, tx, ty, forZombie = false)
export function resolveCircle(map, x, y, r, forZombie = false)   // -> {x, y} pushed out of walls, slides
export function raycastWalls(map, ox, oy, dx, dy, maxDist)          // -> t or Infinity
export function tearBoard(map, barricadeId)      // -> bool (a board was removed); emits barricade:board
export function repairBoard(map, barricadeId)    // -> bool; emits barricade:board
export function repairAll(map)                   // emits per barricade
export function barricadeOpen(map, barricadeId)  // boards === 0
export function nearestInteractable(map, x, y, range)  // -> { kind: 'wallbuy'|'box'|'barricade', ref, dist } | null

// shop.js (Agent I)                      pure
export function initShop(state)
export function updateShop(state, input, dt)   // builds state.shop.prompt, handles interact, box state machine
export function buyWallWeapon(state, wallBuy) / export function buyAmmo(state, weaponId)
export function spinBox(state) / export function takeBoxWeapon(state)
export function boxPrice(state)

// render.js (Agent K)                    DOM
export function initRender(canvas)
export function updateEffects(state, dt)   // tick ttl, prune
export function render(state)
export function addEffect(state, effect)   // helper other modules may call: pushes to state.effects

// hud.js (Agent J)                       DOM
export function initHud(rootEl)
export function updateHud(state)

// audio.js (Agent L)                     DOM
export function initAudio()      // subscribes to events; lazily creates AudioContext on game:start
export function playSfx(name)
export function setMuted(bool)

// main.js (Integrator)                   DOM
// boots everything, owns the loop, exposes window.__game when ?debug=1
```

### 3.7 Update order (main.js, one frame)

```
input.getInput()
camera = follow player, clamp to map
aim = mouse + camera
player.updatePlayer(state, input, aim, dt)         // movement, fire, reload, swap
waves.updateRounds(state, dt)                       // spawning + round transitions
if (time since flow rebuild > 0.2s) state.flow = pathfinding.buildFlowField(map, player.x, player.y)
zombie.updateZombies(state, dt)
weapons.updateBullets(state, dt)
powerups.updatePowerups(state, dt)
shop.updateShop(state, input, dt)
render.updateEffects(state, dt)
render.render(state)
hud.updateHud(state)
input.endFrame()
```

---

## 4. Execution plan

### Phase 0 — Scaffold (1 agent, ~10 min, must finish before Phase 1 starts)

Agent 0 creates the skeleton so that every Phase 1 agent finds import targets and a runnable page:

1. `index.html`: `<canvas id="game" width="1280" height="720">`, `<div id="hud"></div>`, `<link rel="stylesheet" href="styles.css">`, `<script type="module" src="src/main.js">`.
2. `src/config.js`, `src/events.js`, `src/math.js`, `src/state.js` exactly per Section 3.
3. **Stub every Phase 1 module** with all exported names from 3.6, each throwing
   `new Error('not implemented: <name>')`, so imports resolve and the contract test can list them.
4. `src/main.js` minimal: import everything, draw "Scaffold OK" on the canvas. (Integrator rewrites it.)
5. `package.json`: `{ "name": "sol-zombies", "private": true, "type": "module", "scripts": { "start": "npx --yes serve -l 8080 .", "test": "node --test tests/" } }`.
6. `README.md`: how to run (`npm start` or `python -m http.server 8080`, then open `http://localhost:8080`; ES modules do not work from `file://`), controls, debug URL.
7. `tests/smoke.test.js`: imports config/events/math/state and asserts `createRng(1).next()` is deterministic.
8. Empty `docs/notes/` and `docs/qa/` dirs (with `.gitkeep`).
9. Run `node --test tests/` and `node --check` on every file. Report done.

### Phase 1 — Parallel build (13 agents at once: A through M)

Spawn all 13 simultaneously. Each gets the spawn prompt from Section 8 with its letter. They
touch disjoint files, so no coordination is needed. Each ends by running its tests and writing its
notes file. Expected wall time: the slowest single module (~20–30 min).

### Phase 2 — Integration (1 agent)

The Integrator writes `src/main.js` (loop, wiring, menu/gameover flow, debug hooks), then serves
the page, opens it, and fixes every mismatch between modules until the game runs two full rounds
without console errors. The Integrator may edit any file but must keep contract signatures. It
reads all `docs/notes/*.md` first and consolidates `TODO(integrator)` constants into config.js.

### Phase 3 — QA (3 agents in parallel, report only)

- **QA-1 Playtest (browser):** serve, open `http://localhost:8080/?debug=1`, use the Chrome tools
  and `window.__game` hooks to drive the game: reach round 5, trigger every power-up via
  `__game.debug.spawnPowerup(type)`, buy every wall gun, spin the box, break and repair a barricade,
  die, restart. Record every console error/warning and every behavior that contradicts Section 5.
  Write `docs/qa/playtest.md`.
- **QA-2 Code review:** run `/code-review high` style review over `src/` for correctness bugs
  (NaN propagation, timers not using dt, listeners leaking across restart, off-by-one in rounds,
  division by zero in `norm`, event names misspelled). Write `docs/qa/review.md`.
- **QA-3 Balance & perf:** Run to round 15 using `__game.debug.skipToRound(15)`; profile frame
  time with 24 zombies; verify the flow field rebuild is under 2 ms; verify economy (a competent
  player should afford a first wall gun by end of round 2 and the box by round 4). Write
  `docs/qa/balance.md` with concrete config changes.

### Phase 4 — Fix (N agents in parallel, one per non-overlapping finding group)

Group QA findings by file. One FIX agent per file group so no two agents share a file. Each
re-runs tests and re-checks its finding in the browser. Then a final Integrator pass reruns the
Phase 3 playtest script.

---

## 5. Feature specifications

### 5.1 Map (Agent H — `map.js`)

- World is a tile grid parsed from `MAP_ASCII`, an array of equal-length strings. **60 columns ×
  40 rows**, `TILE = 40` → world 2400 × 1600 px. Camera scrolls.
- Legend:
  - `#` wall (blocks everyone, blocks rays)
  - `.` floor
  - `W` barricaded window (blocks player always; blocks zombies until boards = 0; blocks rays; the
    outside neighbor tile of the `W` is a spawn pocket)
  - `S` outside spawn pocket floor (walkable by zombies only; unreachable by player)
  - `O` open spawn (a floor tile where zombies appear without a window; used for 2 corridor spawns)
  - `B` mystery box tile (blocks movement, interactable)
  - `P` player start
  - `1`–`9`, `a`–`f` wall-buy tiles (behave as walls, interactable). Mapping in `WALLBUY_MAP`:
    `1: sheiva, 2: rk5, 3: krm262, 4: kuda, 5: vmp, 6: vesper, 7: kn44, 8: hvk30, 9: argus, a: lcar9, b: pharo, c: icr1, d: bootlegger`.
- Design the map like a BO3 starting area plus 3 side rooms connected by open doorways (no
  buyable doors in v1): a central hub, a long corridor, a courtyard, and a bunker. Place **8
  windows** distributed around the perimeter and **2 open spawns** (`O`) at corridor dead-ends.
  Place **8–10 wall buys** spread so cheap guns are near start and expensive ones are far. Box in
  the room farthest from start.
- Build a `Map` object:
  ```js
  { cols, rows, width, height, tiles: Uint8Array /* 0 floor,1 wall,2 window,3 spawnpocket,4 box,5 wallbuy,6 openspawn */,
    walls: [{x,y,w,h}] /* merged rects for rendering */,
    barricades: [{ id, tx, ty, x, y, w, h, boards: 6, maxBoards: 6, spawnPointId }],
    spawnPoints: [{ id, x, y, barricadeId: number|null, kind: 'window'|'open' }],
    wallBuys: [{ id, weaponId, tx, ty, x, y, w, h }],
    box: { x, y, w, h, tx, ty },
    playerStart: { x, y } }
  ```
- `resolveCircle` pushes a circle out of blocking tiles (check the 3×3 neighborhood) and lets it
  slide. Player is blocked by wall, window, box, wallbuy, spawnpocket. Zombie is blocked by wall,
  box, wallbuy, and by window only while `boards > 0`.
- `raycastWalls` uses a DDA grid march; walls, windows (regardless of boards), box and wallbuy
  tiles stop rays. Return distance `t` or `Infinity`.
- `nearestInteractable` checks wall buys, box, and barricades with `boards < maxBoards`, by
  distance from the player to the tile's nearest edge.
- Board events: `tearBoard` decrements and emits `barricade:board {by:'zombie'}`; `repairBoard`
  emits `{by:'player'}`; `repairAll` emits `{by:'carpenter'}` once per barricade that changed.
- Tests: map parses, all `W` have exactly one adjacent `S`, player start is reachable from every
  spawn point via zombie-walkable tiles (BFS), no `S` reachable by player-walkable BFS from start.

### 5.2 Input (Agent A — `input.js`)

- Keyboard: `W A S D` / arrows move; `Shift` sprint; `R` reload; `F` or `E` interact (edge +
  held); `1`/`2` select slot, `Q` or mouse wheel swap; `Enter`/`Space` start/restart; `Esc`/`P`
  pause; backquote toggles debug overlay.
- Mouse: `mousemove` gives canvas-space coordinates (scale by `canvas.width / rect.width` so CSS
  scaling works); left button held = `fire`, first frame = `firePressed`. Prevent context menu.
- `moveX/moveY` normalized to unit length on diagonals.
- Blur → release all keys. Prevent default on Space/arrows so the page never scrolls.

### 5.3 Player (Agent B — `player.js`)

- Movement: `speed * (sprinting ? sprintMult : 1)`, then `map.resolveCircle`. Sprinting while
  firing is not allowed (firing cancels sprint). `angle` faces the aim point.
- Fire: if `input.fire` → `weapons.tryFire(state, w, x, y, dx, dy)` with origin pushed
  `radius + 4` along the aim direction. Reload with `R` or automatically when firing on an empty
  mag with reserve > 0 (emit `weapon:empty` if reserve is also 0 — weapons does this).
- Swap: `1`, `2`, `Q`, wheel. Swapping cancels a reload. Cannot swap while `tempWeapon` is set.
- Health: `damagePlayer` reduces health, sets `regenTimer = regenDelay`, emits `player:damaged`.
  When `health <= 0` → `down = true`, emit `player:down` with stats. Regen: after
  `regenDelay` with no damage, `+regenPerSec * dt` to max.
- Points: `addPoints` multiplies by 2 while `powerups.isActive(state,'doublePoints')`, updates
  `stats.pointsEarned`, emits `points:changed` (x,y = the kill location when given, for
  floating text). `spendPoints` returns false and does nothing if insufficient.
- `initPlayer` subscribes to `zombie:killed` → `addPoints(state, POINTS.perKill, x, y)` and
  `stats.kills++`, plus `POINTS.perHit` on `zombie:hit` if nonzero. Also `round:start` →
  `boardsThisRound = 0`.
- `giveWeapon`: if a slot is null fill it and make it active; else replace the active slot. Emits
  `weapon:equipped`. `equipTemporary` stores a death machine in `tempWeapon`; `clearTemporary`
  removes it. `getActiveWeapon` prefers `tempWeapon`.
- Tests: regen timing, double points multiplier, spendPoints refusal, giveWeapon slot logic.

### 5.4 Weapons and wall buys (Agent C — `weapons.js`)

Weapon definition shape:
```js
{ id, name, cls: 'pistol'|'smg'|'ar'|'shotgun'|'sniper'|'lmg'|'special', cost, damage, rpm, auto: bool,
  mag, reserve, reloadTime, spread /* radians */, pellets: 1, range: 1400, penetration: 1 /* zombies a shot passes through */,
  projectile: null | { speed, splashRadius, splashDamage } }
```
Table (prices already scaled per 1.1; tune freely in this file):

| id | name | cls | cost | dmg | rpm | auto | mag/reserve | reload | notes |
|----|------|-----|------|-----|-----|------|-------------|--------|-------|
| mr6 | MR6 | pistol | — | 40 | 320 | no | 8/64 | 1.3 | starting weapon |
| rk5 | RK5 | pistol | 50 | 35 | 500 | no | 15/135 | 1.5 | |
| lcar9 | L-CAR 9 | pistol | 75 | 30 | 900 | yes | 24/216 | 1.6 | |
| sheiva | Sheiva | ar | 50 | 110 | 260 | no | 10/120 | 2.0 | penetration 2 |
| krm262 | KRM-262 | shotgun | 75 | 30×8 | 65 | no | 6/42 | 2.6 | spread 0.22 |
| kuda | Kuda | smg | 125 | 45 | 750 | yes | 30/240 | 1.9 | |
| vmp | VMP | smg | 125 | 40 | 900 | yes | 40/240 | 2.1 | |
| vesper | Vesper | smg | 125 | 38 | 1100 | yes | 25/250 | 1.8 | |
| pharo | Pharo | smg | 100 | 42 | 800 | yes | 24/216 | 1.9 | |
| bootlegger | Bootlegger | smg | 100 | 44 | 780 | yes | 30/240 | 1.9 | |
| kn44 | KN-44 | ar | 150 | 70 | 700 | yes | 30/240 | 2.2 | |
| hvk30 | HVK-30 | ar | 125 | 65 | 750 | yes | 32/256 | 2.2 | |
| icr1 | ICR-1 | ar | 150 | 60 | 700 | yes | 30/240 | 2.1 | |
| argus | Argus | shotgun | 150 | 45×6 | 90 | no | 6/36 | 2.8 | spread 0.12 |
| locus | Locus | sniper | box | 400 | 50 | no | 6/48 | 2.8 | penetration 4 |
| drakon | Drakon | sniper | box | 220 | 200 | no | 10/60 | 2.5 | penetration 3 |
| haymaker12 | Haymaker 12 | shotgun | box | 25×8 | 300 | yes | 16/64 | 3.0 | |
| dingo | Dingo | lmg | box | 60 | 800 | yes | 100/300 | 4.5 | |
| brm | BRM | lmg | box | 75 | 650 | yes | 75/300 | 4.2 | |
| raygun | Ray Gun | special | box (weight 1) | 1000 | 180 | no | 20/160 | 3.0 | projectile speed 900, splash 90px / 300 dmg; self-splash 30 dmg |
| deathmachine | Death Machine | special | powerup | 60 | 1200 | yes | ∞ | — | no reload |

- `WALL_WEAPON_IDS` = every row with a numeric cost. `BOX_WEAPON_IDS` = all except mr6 and
  deathmachine. Box weights: 3 for wall guns, 2 for box-only, 1 for raygun.
- `tryFire`: enforce `cooldown = 60 / rpm`; semi-auto fires only when `triggerHeld` was false
  last frame (player sets `w.triggerHeld` from `input.fire`). Deduct one mag round per shot (not
  per pellet). For each pellet, jitter direction by `rng.range(-spread, spread)`, march a hitscan:
  compute `map.raycastWalls` distance, gather every zombie with `rayCircle < wallDist` sorted by t,
  hit the first `penetration` zombies with `damage` via `zombie.damageZombie(state, z, dmg,
  'weapon', hx, hy)`, push a tracer effect `{type:'tracer', x0,y0,x1,y1, ttl:0.06}` and a muzzle
  flash. `stats.shotsFired++`, `shotsHit++` when any zombie was hit. Emit `weapon:fired`.
- Ray gun uses `state.bullets` `{x,y,vx,vy,ttl,def}`; `updateBullets` moves them, detonates on
  wall or zombie contact, applies splash to all zombies in radius and `splashDamage*0.1` to the
  player if inside.
- Reload: `startReload` sets `reloading` if `reserve > 0` and `mag < def.mag`; `updateWeapon`
  counts down `reloadT` then moves rounds from reserve to mag. Emit `weapon:reload`.
- `refillReserve` sets reserve to `def.reserve` (Max Ammo behavior; the magazine is not filled,
  matching BO3). `refillAll` fills both (used by debug and wall ammo purchase).
- `ammoCost(id) = round(cost * PRICES.wallAmmoMult)`.
- Tests: rpm cooldown math, semi vs auto, reload moves correct counts, hitscan hits nearest first
  and respects penetration, pellets consume one round.

### 5.5 Zombies and pathfinding (Agents D and E)

**Stats per round** (`zombie.js`):
- `healthForRound(r)`: `r <= 9 → 150 + 100*(r-1)`; else `950 * 1.1^(r-9)`, rounded.
- `tierForRound(r, rng)`: rounds 1–2: 100% walk; 3–4: 70/30 walk/jog; 5–7: 30/50/20; 8–11:
  10/40/50; 12+: 0/25/75 walk/jog/sprint. Speed = `ZOMBIE.speeds[tier]` ± 10% jitter.
- Insta-Kill: `damageZombie` kills outright when `powerups.isActive(state,'instaKill')`.

**Behavior state machine** (`updateZombies`):
1. `tearing`: zombie stands in the spawn pocket adjacent to its barricade; every `boardTearTime`
   seconds call `map.tearBoard`. When `map.barricadeOpen` → `chasing`. Open-spawn zombies start
   in `chasing`.
2. `chasing`: move along `pathfinding.getFlowDir(state.flow, x, y)` at `speed`. If within
   `attackRange + player.radius` of the player → `attacking`. Add separation steering from other
   zombies within `separationRadius`. Then `map.resolveCircle(map, x, y, r, true)`.
3. `attacking`: wind-up `attackWindup`, then if still in range call `player.damagePlayer(state,
   ZOMBIE.damage)`, then `attackCd`; leave to `chasing` when out of range.
4. `wandering` (Zombie Blood active): pick a random direction every 1–2 s, ignore the player, do
   not attack. Return to `chasing` when the power-up expires.
5. `dying`: `dyingT` counts down `deathLinger`, then splice from `state.zombies`. Corpses do not
   collide.
- `damageZombie` sets `hitFlash = 0.08`, pushes a blood effect, emits `zombie:hit`; at `hp <= 0`
  → `killZombie`. `killZombie` sets `mode='dying'`, emits `zombie:killed {zombie, cause, x, y}`
  exactly once per zombie (guard double kills), and does **not** award points itself (player.js
  listens).
- Zombies never enter `attacking` on a downed player.

**Flow field** (`pathfinding.js`):
- `buildFlowField(map, tx, ty)`: BFS from the player's tile over zombie-walkable tiles
  (`map.isWalkable(map, tx, ty, true)`, windows count as walkable regardless of boards so
  zombies outside can path in). Store `Int32Array dist` (tiles) and precompute for each tile the
  unit vector toward the neighbor with the lowest dist (8-neighbor, disallow diagonal corner
  cutting through walls). Must run in < 2 ms for 60×40.
- `getFlowDir` blends the vectors of the 4 tiles around the query point (bilinear) so zombies do
  not snap at tile boundaries. Return `{0,0}` on unreachable tiles.
- Tests: straight corridor yields direct vectors, obstacle routes around, unreachable returns
  Infinity, no diagonal corner cutting.

### 5.6 Rounds and waves (Agent F — `waves.js`)

- `zombiesForRound(r)`: `r <= 9 → ROUNDS.earlyCounts[r-1]`; else
  `round(0.000058*r^3 + 0.074032*r^2 + 0.718119*r + 14.738699)` (BO3 solo formula).
- Round state: `{ round, phase: 'break'|'active', timer, toSpawn, alive, spawnTimer, spawnInterval, pausedUntil, killedThisRound }`.
- Start: `phase='break'`, `timer = firstRoundDelay`, `round = 0`. When break ends: `round++`,
  `toSpawn = zombiesForRound(round)`, `spawnInterval = max(spawnIntervalMin,
  spawnIntervalStart * spawnIntervalDecayPerRound^(round-1))`, emit `round:start`, `stats.roundReached = round`.
- Spawning: while `toSpawn > 0 && alive < ZOMBIE.maxAlive && time >= pausedUntil`, every
  `spawnInterval` pick a spawn point: weight `nearSpawnWeight` if within `nearSpawnRadius` of
  the player else 1; call `zombie.spawnZombie(state, sp)`; `toSpawn--`.
- `zombie:spawned` → `alive++`; `zombie:killed` → `alive--`, `killedThisRound++`.
- When `toSpawn === 0 && alive === 0` → emit `round:end`, `phase='break'`, `timer = breakSeconds`.
- `pauseSpawning(state, s)` sets `pausedUntil = max(pausedUntil, time + s)`.
- `skipToRound(state, r)`: kill nothing, just set `round = r-1`, `toSpawn = 0`, `alive = 0`,
  `phase='break'`, `timer=0.5` (debug only).
- Tests: count formula matches table for 1–9 and 29 for round 10, round advances only when
  both counters are 0, pause defers spawning, near-spawn weighting picks nearby points more often
  with a seeded rng.

### 5.7 Points (spread across modules, spec here for clarity)

| Source | Amount | Notes |
|--------|--------|-------|
| Zombie kill (any cause except `'debug'`) | `POINTS.perKill` = 10 | Nuke kills count too |
| Nuke pickup | `POINTS.nukeBonus` = 40 | in addition to per-kill |
| Carpenter pickup | `POINTS.carpenterBonus` = 20 | |
| Barricade board repaired | `POINTS.barricadeBoard` = 1 | capped at `barricadeBoardsPerRoundCap` boards/round |
| Any of the above during Double Points | ×2 | applied inside `player.addPoints` |

Every award emits `points:changed`; render draws floating `+N` text at `(x,y)` when provided.

### 5.8 Power-ups (Agent G — `powerups.js`)

- `POWERUP_TYPES = ['instaKill','doublePoints','maxAmmo','nuke','carpenter','fireSale','deathMachine','zombieBlood']`.
- `POWERUP_LABEL`: `INSTA-KILL, DOUBLE POINTS, MAX AMMO, NUKE, CARPENTER, FIRE SALE, DEATH MACHINE, ZOMBIE BLOOD`.
- **Drop roll** on `zombie:killed` with `cause === 'weapon'`: if `dropsThisRound <
  maxPerRound && rng.chance(dropChance)` → `spawnPowerup(state, rng.weighted(weights), x, y)`.
  Never drop the same type twice in a row (re-roll once). Nuke kills never roll drops.
- **Item lifecycle**: `ttl = lifetime`; bobbing `bob += dt`. Render blinks it when `ttl <
  blinkAt`. Removed when `ttl <= 0`. Picked up when `dist(player, item) < pickupRadius +
  player.radius` → `applyPowerup`, emit `powerup:collected`, remove item.
- **Timed power-ups** (`instaKill, doublePoints, fireSale, deathMachine, zombieBlood`):
  `active[type] = state.time + duration[type]`. Picking one up while active **resets** the timer
  to full. `updatePowerups` deletes expired entries and emits `powerup:expired`; expiry of
  `deathMachine` calls `player.clearTemporary`; expiry of `zombieBlood` is handled by zombie.js
  polling `isActive`.
- **Instant effects**:
  - `maxAmmo`: `weapons.refillReserve(w)` for every non-null weapon in `player.weapons`.
  - `nuke`: `state.powerups.nuke = { queue: [...alive zombie ids], timer: 0 }`; `updatePowerups`
    kills one queued zombie every `nukeStagger` seconds via `zombie.killZombie(state, z, 'nuke')`
    (skip already dead). Immediately `player.addPoints(state, POINTS.nukeBonus)` and
    `waves.pauseSpawning(state, POWERUPS.nukeSpawnPause)`. Push a `{type:'flash', ttl:0.5}`
    effect so render can white-out the screen.
  - `carpenter`: `map.repairAll(state.map)`, `player.addPoints(state, POINTS.carpenterBonus)`.
  - `deathMachine`: `player.equipTemporary(state, weapons.createDeathMachine())`.
- Tests (seeded rng): drop chance ≈ 2% over 10 000 kills, cap of 4 per round, timer reset on
  re-pickup, expiry emits event, nuke queue kills all alive over time, maxAmmo fills reserve only.

### 5.9 Shop: wall buys, ammo, mystery box, barricade repair (Agent I — `shop.js`)

- Each frame: `map.nearestInteractable(map, player.x, player.y, PLAYER.interactRange)` →
  build `state.shop.prompt`:
  - wallbuy, not owned: `{ text: "Press F to buy KN-44 [150]", cost: 150, canAfford }`
  - wallbuy, owned: `{ text: "Press F to buy ammo [75]", ... }`
  - box idle: `{ text: "Press F for Mystery Box [95]" }` (or `[10]` during Fire Sale, with
    " FIRE SALE" suffix)
  - box offering: `{ text: "Press F to take <Name>" }`
  - barricade with missing boards: `{ text: "Hold F to rebuild barricade" }`
  - otherwise `null`.
- On `input.interact` (edge): perform the action. Insufficient points → emit `purchase:denied`.
- `buyWallWeapon`: `spendPoints(cost)` then `player.giveWeapon(state, weaponId)`; emit
  `purchase:made`. `buyAmmo`: cost `weapons.ammoCost(id)`; refuses when reserve is already full;
  `weapons.refillAll` on that weapon.
- Box state machine in `state.shop.box`: `idle → spinning (spinSeconds, weaponId cycles every
  0.1s for the render flourish) → offering (offerSeconds, final weaponId chosen by weight) → idle`.
  `takeBoxWeapon` gives it to the player. If the offer expires it is lost. Price =
  `PRICES.fireSaleBox` while `powerups.isActive(state,'fireSale')` else `PRICES.mysteryBox`.
  Do not offer a weapon the player already holds (re-roll).
- Barricade repair: while `input.interactHeld` near a damaged barricade, `player.repairTimer +=
  dt`; every 0.8 s `map.repairBoard`, `player.boardsThisRound++`, and award
  `POINTS.barricadeBoard` while under the per-round cap. Cannot repair while a zombie is tearing
  that barricade (boards only go down while a zombie is on it? No: allow repair, zombie tearing
  and player repairing race, matching BO3).
- Tests: purchase deducts and equips, denied when broke, ammo purchase refused at full reserve,
  fire sale price, box never offers held weapon, offer expires.

### 5.10 Render (Agent K — `render.js`)

- Canvas 2D. `ctx.save(); ctx.translate(-camera.x, -camera.y)` for world space, then screen space
  overlays.
- Draw order: floor (dark, subtle 40px grid), spawn pockets (near-black), walls (filled rects with
  1px lighter edge), wall buys (chalk-white weapon outline text rotated onto the wall with the
  name and price), box (wooden box with glowing `?`, spinning weapon name while `spinning`),
  barricades (up to 6 brown planks across the window, missing ones absent), power-ups (bobbing
  rounded square with `POWERUP_LABEL` initials, green glow via `shadowBlur`, blink when `ttl <
  blinkAt`), zombies (circle in tier color, darker outline, `hitFlash` whitens, dying ones fade
  and scale down), corpses/blood decals from effects, bullets (ray gun green orb with trail),
  player (light circle with a gun barrel rectangle toward `angle`), tracers (thin yellow lines
  fading), muzzle flashes, floating `+N` point text (yellow, rises 30px over 0.8s), nuke flash
  (full-screen white fading over 0.5s), Zombie Blood tint (screen-space red-orange overlay at 25%
  alpha with vignette), Insta-Kill skull glyph pulse near HUD is HUD's job, not render's.
- Damage vignette: red radial edge whose alpha = `1 - health/maxHealth`.
- Screen shake: `addEffect(state, {type:'shake', ttl:0.3, magnitude:8})` supported; applied as a
  random camera offset while active. Trigger on nuke and on player damage (magnitude 4).
- Effects contract: every effect has `ttl`; `updateEffects` decrements and prunes. Cap
  `state.effects` at 400 entries (drop oldest).
- Debug overlay when `state.debug`: draw flow field arrows, zombie modes as text, FPS.
- Performance target: 60 fps with 24 zombies and 200 effects on an integrated GPU.

### 5.11 HUD (Agent J — `hud.js`, `styles.css`)

DOM overlay inside `#hud`, `pointer-events: none`, positioned over the canvas. `styles.css` also
lays out the page: black background, canvas centered, scaled to fit the window while keeping
16:9, `image-rendering: auto`, cursor is a crosshair over the canvas.

- **Bottom-left:** points, large yellow number. A short "+10" flick animation when
  `points:changed` fires (CSS class toggle).
- **Bottom-right:** active weapon name, `mag / reserve` (reserve turns red when 0, whole block
  pulses red while reloading shows "RELOADING"), second slot name small above it. Death Machine
  shows `∞`.
- **Left-center:** round number, blood-red serif digits (font: Georgia/serif italic), in BO3 style
  as tally strokes for rounds 1–5 and a numeral from round 6. Round transitions: fade to
  brighter red and back over the break.
- **Top-center:** row of active power-up chips: label + remaining seconds (whole), chips flash in
  the last 5 seconds.
- **Bottom-center:** interaction prompt from `state.shop.prompt` (grey when `canAfford` is
  false). Also a "Fire Sale!" banner when it starts.
- **Center screens:**
  - `menu`: title, "Click / press Enter to start", controls list.
  - `gameover`: "YOU SURVIVED N ROUNDS", kills, points earned, accuracy, "Press Enter to
    restart".
  - `paused`: "PAUSED".
- Keep DOM writes cheap: only update textContent when the value changed.

### 5.12 Audio (Agent L — `audio.js`)

All sounds synthesized with WebAudio (oscillators + noise buffers + envelopes). No files.
- `initAudio()` subscribes to events. Create the `AudioContext` lazily on `game:start` (must be
  inside a user gesture; main emits `game:start` from the click/Enter handler).
- Sounds: `weapon:fired` per class (pistol pop, smg snap, ar crack, shotgun boom, sniper thump,
  lmg thud, raygun zap, deathmachine whir), `weapon:reload` click, `weapon:empty` dry click
  (rate-limited), `zombie:hit` wet thud, `zombie:killed` groan (random pitch), `player:damaged`
  heartbeat thump + grunt, `player:down` low drone, `round:start` rising 3-note sting,
  `round:end` descending sting, `powerup:spawned` shimmer, `powerup:collected` deep announcer-ish
  chord + short per-type motif, `powerup:expired` fade note, `purchase:made` cash tick,
  `purchase:denied` buzz, `box:opened` jingle, `barricade:board` wood knock.
- Master gain 0.5, per-category gains, `setMuted`. Never more than 8 concurrent gunshot voices
  (steal oldest). Never throw if the context is not ready: queue nothing, just return.

### 5.13 Main loop, menu, game over, debug (Integrator — `main.js`)

- Boot: `createEmptyState()`, `state.map = loadMap()`, `state.player = createPlayer(start)`,
  `state.rounds = createRoundState()`, `state.debug = location.search.includes('debug=1')`,
  `giveWeapon(state, PLAYER.startWeapon)`, then `initInput, initRender, initHud, initAudio,
  initPlayer, initRounds, initPowerups, initShop`. Order matters: DOM inits first, listeners
  after.
- `requestAnimationFrame` loop; `dt = min(FIXED_DT_CAP, (now - last)/1000)`; skip updates when
  `phase !== 'playing'` but still render and update HUD.
- `menu → playing` on `input.start` or canvas click: emit `game:start`.
- `player:down` → `phase = 'gameover'`, emit `game:over`. `input.restart` → `events.clearAll()`,
  rebuild state from scratch (new seed), re-run inits, emit `game:restart`, `phase = 'playing'`.
- `?debug=1` exposes `window.__game = { state, debug: { spawnPowerup(type), skipToRound(n),
  giveWeapon(id), addPoints(n), killAll(), god(bool), spawnZombie(n), setTimeScale(x) } }`.
- Pause with Esc/P toggles `phase` between `playing` and `paused` (HUD shows PAUSED).

---

## 6. Definition of Done (whole project)

- `npm test` passes, `node --check` passes on every `src/*.js`.
- Served page loads with zero console errors from menu through round 3 and a restart.
- Every row in this checklist is verified in the browser by QA-1:
  - [ ] Zombies spawn at multiple different windows and both open spawns across a round
  - [ ] Zombies tear boards one at a time and enter when boards hit 0
  - [ ] Round counter advances only after the last zombie dies, after an 8 s break
  - [ ] Round 10 spawns 29 zombies (per the 5.6 formula), health and speed visibly scale
  - [ ] Each kill adds exactly 10 points (20 during Double Points) with a floating +10
  - [ ] Power-ups drop rarely, blink before vanishing, and every one of the 8 types works per 5.8
  - [ ] Nuke kills all zombies with a stagger, white flash, +40, and a 3 s spawn pause
  - [ ] Carpenter restores every board and pays +20
  - [ ] Fire Sale drops box price to 10 for 30 s
  - [ ] Death Machine replaces the gun for 30 s with infinite ammo, then returns the gun
  - [ ] Zombie Blood makes zombies wander and ignore the player for 30 s
  - [ ] Max Ammo fills reserves of both guns but not the current magazine
  - [ ] Every wall buy sells its gun at the listed price, then ammo at half price
  - [ ] Two-slot inventory: third purchase replaces the active gun; swap works
  - [ ] Mystery box spins 3 s, offers 10 s, charges correctly, never offers a held gun
  - [ ] Barricade rebuild pays 1 per board up to 10 per round
  - [ ] Player takes 50 per hit, regenerates at 1 HP/s after a 4 s delay (WO3), goes down at 0, game-over screen shows
        round/kills/points, Enter restarts cleanly (no duplicated listeners: points do not double
        after restart)
  - [ ] Pause works
  - [ ] Sound plays for shots, kills, power-ups, round changes; no autoplay errors in console
  - [ ] 60 fps at round 15 with 24 zombies on screen

---

## 7. Out of scope for v1 (stretch, do not build unless assigned)

Perks (Juggernog, Speed Cola, Double Tap, Quick Revive, etc.), Pack-a-Punch, buyable doors,
hellhound/boss rounds, teddy bear box move, Gobblegums, multiplayer, sprite art, saving high
scores, gamepad support, mobile controls, minimap.

> Note: buyable doors were added later by WORK_ORDER_4.md (doors D-H, 75-150 points).

---

## 8. Spawn prompts (copy-paste per agent)

### Phase 0 — Agent 0
```
You are Agent 0 (scaffold) for the project in the current directory. Read WORK_ORDER.md fully.
Execute Phase 0 exactly as written in Section 4 and Section 3: create index.html, package.json,
README.md, src/config.js, src/events.js, src/math.js, src/state.js, a minimal src/main.js, stub
files for every module in Section 3.6 (each export throws 'not implemented'), tests/smoke.test.js,
and the docs/notes and docs/qa directories. Run `node --test tests/` and `node --check` on every
src file. Do not implement any game logic. Do not run git commands. Report the file list when done.
```

### Phase 1 — Agents A through M (send 13 of these at once, changing only the letter)
```
You are Agent <LETTER> on the project in the current directory. Read WORK_ORDER.md: Section 0
(rules), Section 3 (contracts) in full, Section 2.1 to learn the exact files you own, and your
feature section in Section 5. Implement your module completely against the contracts. You may
ONLY create or edit the files listed for Agent <LETTER> in Section 2.1. Other modules may be
unimplemented stubs; import them by contract name and do not modify them. Pure-logic modules must
not touch the DOM and must ship tests/<module>.test.js passing under `node --test tests/`. Run
`node --check` on your file(s). Finish by writing docs/notes/<module>.md (what you built,
assumptions, contract deviations, constants to move to config). No git commands. Do not ask
questions; decide and document.
```

Letter → module: A input, B player, C weapons, D zombie, E pathfinding, F waves, G powerups,
H map, I shop, J hud+styles, K render, L audio, M contract tests.

Agent M's task: `tests/contracts.test.js` imports every module in Section 3.6 and asserts every
listed export exists and is a function (or object for the constants), so a missing/misnamed
export fails CI-style before integration. It also asserts pure modules do not reference
`window`/`document` by reading their source text.

### Phase 2 — Integrator
```
You are the Integrator for the project in the current directory. Read WORK_ORDER.md fully, then
every file in docs/notes/. Write src/main.js per Section 5.13 and Section 3.7. Move every
TODO(integrator) constant into src/config.js. Serve the project (npm start or python -m
http.server 8080), open http://localhost:8080/?debug=1 in the browser tools, and fix every
runtime error or contract mismatch you find, in whichever file it lives, without changing
contract signatures. Stop when the game runs from menu through round 3 and a restart with zero
console errors and `npm test` passes. Write docs/notes/integration.md listing every cross-module
fix you made. No git commands.
```

### Phase 3 — QA-1 / QA-2 / QA-3
```
You are QA-<N> for the project in the current directory. Read WORK_ORDER.md Sections 4 (Phase 3),
5 and 6. Perform ONLY the QA-<N> task described in Phase 3. You may not edit any file under src/.
Write your findings to docs/qa/<playtest|review|balance>.md as a numbered list: each finding has
severity (blocker/major/minor), the file and function, repro steps, expected vs actual, and the
Section 5 clause it violates. No git commands.
```

### Phase 4 — FIX agents
```
You are FIX-<N> for the project in the current directory. Read WORK_ORDER.md Sections 0 and 3,
then fix exactly these findings: <paste findings>. You may edit only these files: <list>. Keep
contract signatures unchanged. Re-run `npm test` and re-verify each finding in the browser at
http://localhost:8080/?debug=1. Append a "Resolution" line under each finding in the QA file.
No git commands.
```

---

## 9. Decisions already made (do not re-litigate)

- Vanilla JS + Canvas 2D, ES modules, no bundler, no framework, no npm deps. Served over HTTP.
- Hitscan for all guns except the Ray Gun. No headshots (top-down).
- Single map, 60×40 tiles, camera follows player. No buyable doors in v1. (WO4 note: buyable doors were added by WORK_ORDER_4.md.)
- 10 points per kill, 0 per hit, all prices scaled to 1/10 of BO3 (Section 1.1).
- Max Ammo refills reserves only (BO3 behavior). Timed power-ups reset to full on re-pickup.
- Two weapon slots. Death Machine is a temporary third "slot" that overrides both.
- Solo only; going down is game over (no Quick Revive).
- Geometry art only, synthesized audio only.
