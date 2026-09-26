# QA-2 Gameplay report (WO2 Phase 3)

## Setup

- **Build:** the working tree at `D:\GitHub\Sol Game`.
  - Served with `python -m http.server 8098`.
  - Opened in a new Chrome tab at `http://localhost:8098/?debug=1`.
- **The tab reports `visibilityState === 'hidden'`,** so rAF never ticks.
  - All play was advanced with `__game.debug.step(seconds, 1/60, inputOverrides)`, which runs the same `tick()` as rAF.
  - A small in-page bot aims at the nearest visible zombie and fires. It uses the Thundergun every few seconds.
- **Real input:**
  - A canvas click started the first game.
  - Real `Enter`/`Esc` presses from the automation were not delivered, the same limitation the integrator hit.
  - Pause, resume and restart were verified with `KeyboardEvent`s dispatched on `window`. These go through the real `input.js` and `main.js` handlers.
- **Console:**
  - `console.error`/`console.warn` were wrapped, and `error`/`unhandledrejection` hooks were installed right after load.
  - `read_console_messages` was also read at the end.
- **Headless harness:** scratch only, not in the repo, in the session scratchpad `qa2/`.
  - `sim.mjs` runs the 3.7 update order at dt = 1/60 with a bot that swaps to the Thundergun every 6–14 s when a zombie is within 420 px.
  - `stun.mjs` covers targeted knockback edge cases.
  - `spawns.mjs` checks the spawn-point distribution.
- `npm test`: 252/252 pass.

## Findings

1. **Minor (design question for the lead): Thundergun near-cone kills go through solid walls and boarded windows.**
   - **Where:** `src/weapons.js` `fireCone`. The `d <= cone.killRange` branch kills before any `raycastWalls` check.
   - **Repro 1 (solid wall):**
     1. Run `debug.teleport(1500, 780)` (hub, east edge, row 19).
     2. Spawn a zombie at (1702, 780). That is in the east room, behind the 4-tile solid wall (cols 38–41).
     3. Aim +x with the Thundergun and fire.
     - Result: the zombie dies at 184 px through 160 px of wall, and the player gets +10.
   - **Repro 2 (boarded window):**
     1. Stand at (840, 200) in the top corridor.
     2. Run `repairAll`, so window 1 has 6 boards.
     3. Run `debug.spawnZombie(2, 1)`. Both zombies are tearing in the pocket behind the boards.
     4. Aim at the window and fire.
     - Result: both pocket zombies die at about 243 px.
   - **Expected (player-facing):** a blast of air stops at walls, and boards protect zombies outside. Knockback already requires line of sight.
   - **Actual:** anything within 300 px and 30° dies, including zombies in other rooms and outside boarded windows. The player can farm pocket zombies through the boards.
   - **Clause:** §1.3 says "every zombie inside `killRange` and within `halfAngle` of the aim dies". §3.9 says "no wall check needed inside `killRange`". So the code follows the letter of the spec. This is filed so the lead can decide, not as a contract violation.
   - **Fix:** reuse the knock branch's LOS test for the kill branch too. That is `raycastWalls(map, ox, oy, ux, uy, d - r)` with `SPLASH_LOS_TOL`, skipped when `d - r <= SPLASH_LOS_TOL`. Windows count as blockers in `raycastWalls`. If pocket kills through an *open* window should still count, allow the ray to pass window tiles whose barricade has `boards === 0`.
   - After the fix, update `tests/weapons.test.js`: a zombie behind a wall inside `killRange` survives.
   - **Resolution (FIX-5):** lead decided LOS is required for kills too. `fireCone` now applies the same near-edge `raycastWalls` LOS test (`splashVisible`) to both bands; window tiles block regardless of board count. Tests: zombie behind a wall inside `killRange` survives, tearing pocket zombie behind a boarded window survives, clear-LOS zombie dies. WO2 3.9 updated.

2. **Info (environment, not a game bug): periodic 50–75 ms frame spikes in the hidden automation tab.**
   - **Where:** Chrome's canvas flush in a hidden tab that never presents a frame.
   - **Repro:** time 1200 `render.render(state)` calls with 24 zombies.
     - Mean 0.40 ms. About 3 calls in 1200 take 51–62 ms.
   - **Control:** a plain loop of `fillRect` and `drawImage` on the same canvas, with no game code, shows the same 55–76 ms spikes every ~150 calls.
     - A pure-JS busy loop shows none.
     - `hud.updateHud` mean is 0.001 ms with no spikes.
   - **Expected vs actual:** the per-step mean is well under 3 ms (see the table). The spikes come from the environment.
   - **Clause:** §5 frame cost. It passes on the mean, p50 and p95.
   - **Fix:** none needed. If QA-3 wants proof, re-measure in a visible tab with the Performance panel.

3. **Info (v1 behaviour, not WO2): a zombie centre was seen on a boarded window tile for 1 frame in 900 s × 6 runs.**
   - **Where:** `zombie.js`/`powerups.js` Carpenter interaction.
   - **Repro:** harness seed 5 at t = 282 s. A chasing zombie was on tile (57,16) (window 4) with stun 0. It was resolved on the next frame.
   - **Cause:** almost certainly Carpenter or a repair restoring boards while a zombie stands in the window. It is not knockback, because the zombie was not stunned.
   - **Clause:** none violated. The zombie is not stuck and the round is not blocked.
   - **Fix:** none required.

No Blocker or Major issues were found. The Thundergun, stun and knockback, and the whole v1 checklist behave as specified.

## Thundergun, stun and Ray Gun checks

| # | Check | Evidence | Result |
|---|---|---|---|
| T1 | Box weights include wonder | `shop.boxWeights()`: raygun 1, thundergun 1 (the minimum), wall guns 3, box-only 2, total 51. No `deathmachine` or `mr6`. `WONDER_WEAPON_IDS = ['raygun','thundergun']`. 200 000 `pickBoxWeapon` rolls with the live rng: thundergun 2.04 %, raygun 1.95 % (expected 1.96 %). | PASS |
| T2 | Thundergun from the real box flow | Stood at the box and pressed `interact`. Each spin charged 95 and spun for 3.02 s. The 17th spin offered the Thundergun (a Ray Gun was offered once before that). `interact` again gave slots `[mr6, thundergun]`, with the Thundergun active at 4/12. The box returned to idle. The integrator's seeded roll (seed 43) is also on record. | PASS |
| T3 | 4/12 ammo, single shot, reload | Holding the trigger for 2.2 s fires only once. Shots went 4→3→2→1→0, and auto-reload started. After 3.0 s the gun was at 4/8. Manual R from 3/8 took 3.00 s and gave 4/7. After the gun was drained to 0/0, R does nothing. Max Ammo sets reserve 12 and leaves the magazine at 0. There is no wall ammo (`ammoCost` = ∞). The 1 s rpm cooldown is enforced. | PASS |
| T4 | Cone geometry | Aimed west from (1220,780). Zombies at 120/200 (+0.3 rad)/250 (−0.45)/298 (+0.5) px died. A zombie at 200 px and 0.6 rad was untouched, and so was one behind the player. Zombies at 360, 420 and 470 px in the cone were knocked (kv about 650 after one frame, stun 1.18). A zombie at 500 px was not knocked. One round was used, `shotsHit` went up by 1, and one `shockwave` (range 480) plus a `shake` (magnitude 10) were pushed per shot, 6 of 6 times. | PASS |
| T5 | Kills pay 10 each (20 with Double Points) | 4 kills gave +40. With Double Points active, 5 kills gave five `points:changed` deltas of 20 (+100). Headless: 181 Thundergun kills gave 2000 points, and the extra is exactly the Double Points windows. | PASS |
| T6 | Power-ups can drop from Thundergun kills | Forcing `rng.chance` for one shot spawned 2 drops (instaKill, doublePoints) from 2 cone kills. Natural rate over 480 cone kills: 13 drops (2.7 %, spec 2 %, within noise). Headless runs: 21 of 43 drops came from Thundergun kills. | PASS |
| T7 | Knockback slide and stop | Slide was 66–71 px at 0.15 s and 103–117 px at 1 s. That matches `v0/k` = 720/6 = 120 px. The shot zombie was not stunned. Knocked zombies resumed `chasing` after 1.2 s and reached the player. | PASS |
| T8 | Stunned zombies do not attack | 70 frames stunned while touching the player: 0 wind-up frames (headless). 900 s × 6 harness runs: 0 stunned wind-ups. | PASS |
| T9 | Stunned zombies can be shot and killed | A zombie knocked at 360 px was hit by an MR6 while stunned (650 → 600 hp). It was then killed with Insta-Kill while still stunned, for +10. | PASS |
| T10 | No stuck-in-wall, no tunnelling | 9 736 knocks (every floor tile × 8 directions at 720 px/s, dt = 1/30): 0 ended in another region or in a wall. Harness: 0 NaN positions, velocities or stun values. The only non-walkable centre was the 1 frame in finding 3, which was not a stunned zombie. | PASS |
| T11 | Windows and pockets | For all 8 windows, open and boarded, a 5-zombie crowd was fired on toward the window. Boarded windows stop the slide. With an open window, knocked zombies enter the pocket, resume chasing, come back in and reach the player within 20 s. Knocked into a pocket, then `repairAll`: the zombie switches to `tearing`, tears all 6 boards and comes back (no soft-lock). Tearing zombies ignore knockback. In-browser, a 10-zombie crowd by window 1: 3 killed, 7 knocked, all chasing again after 1.3 s and at the player after 9 s. | PASS |
| T12 | No round soft-locks in long runs | 6 god-mode runs × 900 s (rounds 1→15 and 8→19): 0 "no progress in 240 s" events and 0 alive-count mismatches. All "zombie still for 25 s" reports were crowds pinned around the bot, none of them knocked. 4 mortal runs died in rounds 4–7 with no anomalies. | PASS |
| T13 | Ray Gun unchanged | It is a box weapon at weight 1 and was offered in the box run. Stats are unchanged from v1 5.4: 1000 dmg, 180 rpm, 20/160, a projectile at 900 px/s starting 33 px ahead, and a 90 px / 300 dmg splash. A direct hit plus splash killed 1 zombie and splashed 2 others (−300 each). One zombie at 130 px was untouched. Self-splash against a wall did 30. It uses `sprite: 'raygun'`. | PASS |

## v1 checklist regression (WORK_ORDER.md §6)

| # | Item | Evidence | Result |
|---|---|---|---|
| 1 | Spawns at multiple windows and both open spawns | 131 picks over rounds 1–5: every id 1–10 was used. In-browser round 10: windows 1, 3, 4, 5, 6 and 8 plus open spawn 10. | PASS |
| 2 | Boards torn one at a time, entry at 0 | 6 barricades in round 10: 6 tears each, minimum gap 1.00 s (one tearer per window). | PASS |
| 3 | Round advances only after the last kill, after 8 s | Round 10 ended 0.017 s after the last kill and round 11 started 8.02 s later. It did not advance while 1 zombie was alive. | PASS |
| 4 | Round 10 = 29 zombies, scaling | 29 spawned. Health 150 (r1) → 550 (r5) → 1045 (r10). Round 10 tiers: 1 walk, 11 jog, 12 sprint. Speeds 68–199. | PASS |
| 5 | +10 per kill (20 with DP), floating +10 | Confirmed, including the floating `text '+10'` effect. | PASS |
| 6 | Drops rare, blink, all 8 types work | Drop rate about 2 % (T6). Lifetime 30 s: blinking below 10 s (render `blinkAt`), gone at 30 s. Every type is covered in rows 7–12 plus Insta-Kill (1150 hp zombie killed by one MR6 shot, 30 s timer) and Double Points. | PASS |
| 7 | Nuke | 8 kills with a 0.083 s stagger. The bonus is +40 (+120 total including 8 × 10 kills). Spawns paused 3.0 s. A `flash` effect is pushed. | PASS |
| 8 | Carpenter | All 8 barricades went 0 → 6, +20. | PASS |
| 9 | Fire Sale | Box price 95 → 10, and back to 95 after 30 s. | PASS |
| 10 | Death Machine | KN-44 → `deathmachine` with mag ∞ after 2 s of firing → KN-44 at 30 s. | PASS |
| 11 | Zombie Blood | The zombies switched to `wandering` and did no damage (player not in god mode) for 30 s, then went back to `chasing`. | PASS |
| 12 | Max Ammo fills reserves, not the magazine | KN-44 5/10 → 5/240. Thundergun 1/2 → 1/12. | PASS |
| 13 | Wall buys at list price, ammo at half | All 10 wall guns charge the listed price and ammo at `round(cost / 2)`. A refill with a full reserve is refused with no charge. | PASS |
| 14 | Two slots, third purchase replaces the active gun, swap | Each purchase replaced the active slot 1. Swap and slot key work (mr6 ↔ icr1). | PASS |
| 15 | Box 3 s spin, 10 s offer, charge, never a held gun | 25 spins: every one charged 95, spun 3.02 s and offered for 10.0 s. It never offered a held gun. | PASS |
| 16 | Rebuild pays 1 per board up to 10 per round | 12 boards rebuilt for +10 (6 + 4). | PASS |
| 17 | 50 per hit, regen after 4 s, down, game over, restart without duplicate listeners | Hit 150 → 100, still 100 at 3.9 s, regen from 4 s, 150 by 7 s. `setHealth(0)` → down → game over showing round 4 / 27 kills / 270 points / accuracy. Enter → new state, playing. A kill after restart gave exactly +10 and 1 kill. One shockwave per shot after restart. | PASS (Enter dispatched; see setup) |
| 18 | Pause | Esc → `paused`, HUD shows PAUSED, time frozen for 1 s of steps. P → playing. | PASS (keys dispatched) |
| 19 | Sound, no autoplay errors | The audio code path ran for every event with zero console errors or warnings. Loudness was not judged: the tab has no audio check. | PASS (code path only) |
| 20 | 60 fps at round 15 with 24 zombies | 3 × 600 steps with 24 alive, firing and moving: step mean 0.42–0.60 ms, p50 0.3, p95 0.8. With the Thundergun firing and knocking: mean 0.52, p95 0.9. Render alone: mean 0.40 ms. | PASS |

## Console and frame cost

| Check | Result |
|---|---|
| Console from menu → rounds 1–3 → death → game over → restart → rounds 1–3 → round 15 load test | The in-page error/warn hooks recorded 0 entries apart from the QA probe. `read_console_messages` showed only 3 `TypeError`s from a Chrome extension (`chrome-extension://…/s2k-listener.js`) at the moment of the synthetic key presses. None came from the game. **PASS** |
| Frame cost with 24 zombies, including sprite drawing | `step(1/60)` mean 0.42–0.60 ms, p95 ≤ 0.9 ms, which is under 3 ms. Rare 50–75 ms spikes are an environment artifact (finding 2). **PASS** |
| Headless 900 s runs (6 god-mode + 4 mortal) using the Thundergun periodically | 0 NaN, 0 soft-locks, 0 stunned attacks, 0 tunnelling. About 400 kills per run, of which about 200 were Thundergun kills. **PASS** |
| `npm test` | 252/252. **PASS** |

## Summary by severity

- **Blocker:** none.
- **Major:** none.
- **Minor:** 1. Thundergun kill range ignores walls and boards (#1). This follows §3.9 literally, so it needs a lead decision.
- **Info:** 2. Hidden-tab canvas flush spikes (#2), and a 1-frame zombie centre on a window tile from Carpenter (#3).
