# Integration notes (Phase 2, Integrator)

## main.js (new, per 5.13 / 3.7)
- Boot: `createEmptyState` -> `loadMap` -> `createPlayer(playerStart)` -> `createRoundState` ->
  `state.debug = ?debug=1` -> `giveWeapon(startWeapon)`, then `initAll`: `initInput, initRender,
  initHud, initAudio` (DOM first) then `initPlayer, initRounds, initPowerups, initShop`, plus main's own
  `player:down` listener.
- Loop: rAF, `dt = min(FIXED_DT_CAP, frame gap)`. The exact 3.7 order runs only while `phase === 'playing'`.
  Render and HUD run every frame. `render.updateEffects` sits inside the gameplay update, so effects freeze while paused.
  The camera is centred on the player and clamped to the map (centred if the map is smaller than the view). Aim = mouse + camera.
  The flow field is rebuilt every `LOOP.flowRebuildInterval` (0.2 s) and immediately on start.
- Start and restart are handled in main's own DOM handlers (window `keydown` Enter/Space/NumpadEnter,
  canvas `click`), so `game:start` is emitted inside the user gesture and audio can create its context.
  Main therefore ignores `input.start`/`input.restart`. Those are still set by input.js (Enter/Space set both), and
  main picks by phase: menu -> start, gameover -> restart, playing/paused -> nothing. Start also calls
  `input.resetInput()` so the starting click does not fire a shot.
- Restart: `events.clearAll()` -> fresh state (new seed) -> `initAll` again (every module's init is
  idempotent; `initInput` removes its old DOM listeners first) -> `phase='playing'` -> emit `game:restart`
  and `game:start` (the latter lets audio create its context if it never started).
- `player:down` -> `phase='gameover'`, emit `game:over {round, kills, points}` (points = `player.points`, as in the player payload).
- Pause: `input.pause` (Esc/P) toggles playing <-> paused. Backquote (`input.debugKey`) toggles `state.debug`.
- Debug (`?debug=1`): `window.__game = { state (getter, survives restart), debug, modules }`.
  `debug`: `spawnPowerup(type, x?, y?)` (defaults to the player's position, so it is collected on the next frame),
  `skipToRound(n)` (kills live zombies with cause 'debug' first), `giveWeapon(id)`, `addPoints(n)`
  (raw; not doubled, not counted in stats), `killAll(cause='debug')` (debug kills award no points),
  `god(bool)`, `spawnZombie(n, spawnPointId?)`, `setTimeScale(x)` (0..20; the frame is split into
  sub-steps no longer than FIXED_DT_CAP). Extras: `damagePlayer(n)`, `teleport(x,y)`, `start()`, `restart()`, and
  `step(seconds, frameDt=1/60, inputOverrides?)`, which runs whole frames synchronously. `step` is needed because
  the automation browser tab reports `visibilityState: hidden`, so Chrome never fires rAF there. QA should use it too.
- Frame errors are caught and logged with `console.error('[main] frame error', ...)`, so one bad frame cannot kill the loop.

## Constants moved to config.js (all TODO(integrator) markers removed)
| Module | New config location | Notes |
|---|---|---|
| player `MUZZLE_OFFSET` | `PLAYER.muzzleOffset` | |
| zombie `HIT_FLASH, SPEED_JITTER, WANDER_*, BLOOD_*_TTL` | `ZOMBIE.hitFlash, speedJitter, wanderMin/Max, wanderSpeedMult, bloodHitTtl, bloodDeathTtl` | `HIT_FLASH` export kept |
| map `MAX_BOARDS` | `MAP.maxBoards` | |
| shop `REPAIR_INTERVAL, BOX_CYCLE_INTERVAL, BOX_WEIGHTS` | `SHOP.*` | shop still re-exports the names (tests use them) |
| weapons `DEFAULT_RANGE ... RAYGUN_COLOR` | `WEAPON_FX.*` | `weapons.BOX_WEIGHTS` now also derives from `SHOP.boxWeights` (one source of truth) |
| render `EFFECT_CAP ... ZOMBIE_BLOOD_TINT` | `RENDER.*` | |
| audio gains / voice cap / rate limits | `AUDIO.*` | |
| input `WHEEL_THRESHOLD` | `INPUT.wheelThreshold` | |
| (new) flow rebuild period | `LOOP.flowRebuildInterval` | |
No values changed, so no tests needed updating. Only new keys and exports were added; contract keys are untouched.

## Cross-module fixes
1. **render.js did not draw `explosion` effects** (weapons.js pushes them for ray-gun splash). Added
   `drawExplosion` (expanding translucent disc plus a ring in `e.color`, radius `e.radius`) and a default ttl.
2. **render.js ignored `radius`/`big` on blood effects** (zombie.js pushes them). Hit splats now scale with
   `radius`, and death decals (`big`) draw as a larger 9-droplet pool that stays visible for its 6 s ttl.
3. **render.js muzzle flash ignored `color`/`size`** from weapons.js. The ray gun flash is now green and shotgun flashes are bigger.
4. **hud.js prompt was not greyed for `blocked`** (shop's "ammo full" prompt). It now greys when `canAfford === false || blocked`.
5. **powerups.initPowerups was not idempotent** (every other init was). It now drops its previous subscription.
   main always calls `clearAll()` first anyway; this is defensive.

## Cross-module points checked (no change needed)
- Semi-auto trigger: player.js sets `w.triggerHeld = !!input.fire` *after* `tryFire`. Verified in the harness:
  holding fire with the MR6 for 60 frames fires once, and release plus re-press fires again. Auto guns fire continuously.
- input `slot` is 1-based; player uses `slot - 1`. Checked in the browser (slot 1 -> activeSlot 0).
- Effects: render draws tracer, muzzle, blood, text, flash, shake, and now explosion. `text` (+N) comes from `points:changed` with x,y.
- Map ids are 1-based: spawn points 1-8 are windows (id == barricade id) and 9-10 are open spawns. In the browser, zombies spawned from
  7 different points in rounds 3-5 (ids 1, 3-6, 8-10), both open spawns included.
- HUD game-over shows `stats.pointsEarned` as "Points earned". `game:over.points` is the current `player.points`.
- `zombiesForRound(10) === 29` (the formula; waves test asserts 29). Checked in the browser: skipToRound(10) gives toSpawn+alive = 29.

## Verification
- `npm test`: 147/147. `node --check` passes on every `src/*.js`.
- Headless harness (scratch, not in repo). It runs the exact 3.7 order with an auto-aim bot:
  600 s sim, god mode, drops off: rounds 1-7 contiguous, 105 kills, points = 1050 = 10/kill exactly, no NaN.
  900 s mortal run with drops on and a KN-44: reached round 6, died, no exceptions. Every power-up applied mid-round and
  expired after 30 s; the death machine was cleared. Shop buy/ammo/box. Restart (clearAll + re-init) and a double re-init
  without clearAll both give 10 per kill.
- **Browser (Chrome, http://localhost:8080/?debug=1), verified:**
  - Page loads with zero console errors or warnings across the whole session. Console capture was confirmed working with a probe message.
  - Menu renders. A real canvas click starts the game without firing a stray shot (mag 8, shotsFired 0). A real Enter key also starts it.
  - Game driven through round 5 by a bot via `debug.step`: 51 kills = 510 points, `killPts == 10*kills`, and rounds 1..5 in order.
  - All 8 power-ups triggered with `spawnPowerup`:
    - Insta-Kill: 1 damage kills a 550 hp zombie.
    - Double Points: a kill pays +20.
    - Max Ammo: reserve refilled to 64, the magazine stays at 3.
    - Nuke: killed 25/25 with a stagger, white flash present, +40 bonus (+80 under Double Points), spawning paused 3 s.
    - Carpenter: every barricade back to 6 boards, +20 (+40 under Double Points).
    - Fire Sale: box price 10.
    - Death Machine: HUD shows ∞; after 30 s it is cleared and the MR6 returns.
    - Zombie Blood: zombies switch to wandering and the orange tint shows.
    - HUD chips count down.
  - Wall buy via a real `updateShop` interact:
    - Sheiva with 20 points: denied (`purchase:denied`) and the prompt is greyed.
    - With 120 points: bought for 50.
    - Ammo prompt shows "[25]" and the ammo buy costs 25.
    - A full-reserve prompt shows "ammo full", blocked and greyed.
  - Box: 95 points, spins about 3 s, offers a weapon the player doesn't hold, and taking it replaces the active slot (third gun). The ray-gun explosion renders.
  - Barricade: a zombie tore 6 -> 4. Holding F rebuilt 4 -> 6 for +2 points.
  - Real Esc pauses (PAUSED screen, time frozen). Real P resumes. The real backquote key toggles the debug overlay.
  - Death: god off, zombies killed the player in about 13 s. The game-over screen shows the round, kills 3, points earned 30 and accuracy.
    `game:over` was emitted.
  - Real Enter restarts: fresh state (round 0, full hp), the first kill gives exactly one +10, and rounds resume.
- **Not verified or caveats:**
  - Real-time rAF play and FPS: the automation tab is `hidden`, so rAF does not run. All gameplay in the browser went
    through `debug.step`, which calls the same `tick()` the rAF loop uses. Performance at round 15 with 24 zombies was
    not measured (QA-3).
  - Audio was not heard. AudioContext creation happens on `game:start` inside a gesture, and no autoplay warnings appeared.
  - Mouse aiming or firing with the physical mouse during play, sprinting feel, and wheel swap were not exercised with real devices.
    They were driven through input objects.
  - The automation extension sometimes drops the first click after a reload (no DOM events reached the page).
    This is a tooling artifact, not a game bug.
