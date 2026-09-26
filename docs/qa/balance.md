# QA-3: Balance and performance

QA-3 (Phase 3). This is a report only. No file under `src/` or `tests/` was changed.
Scope: WORK_ORDER.md 1.1, Phase 3 (QA-3), 5 and 6 ("60 fps at round 15 with 24 zombies on screen").

## Summary

- **Performance: passes with a large margin.**
  - Flow-field rebuild: **0.053 ms** on average (target < 2 ms).
  - Full logic update at round 15 with 24 alive: **0.02 ms** in Node and about **0.35–0.6 ms** in Chrome.
  - A full frame in Chrome (update + render + HUD) costs **about 0.6 ms of main-thread time**. Including GPU work, **about 1.5–2.4 ms** per frame, even with 200 effects.
  - All of these are far below the 16.7 ms frame budget.
- **Economy: the targets are met, with margin.**
  - First wall gun: bought in round 1 in 100% of bot runs, 21–38 s into the game (50 points = 5 kills).
  - Mystery box: 95 points on top of that first gun were available by round 3 in 19 of 20 runs, and by round 2 in the other one.
  - `POINTS.perKill` stays at 10. No price changes are needed.
- **Main balance problem: the starting MR6 cannot finish round 2.**
  - It has 72 rounds in total (8 in the magazine + 64 reserve). Rounds 1 and 2 need 80 hits even at 100% accuracy.
  - There is no melee attack. A player who has not bought a gun runs dry after 4–6 kills into round 2 (19 of 20 bot runs).
- **Secondary issues:**
  - Several guns make other guns pointless: the Sheiva (50) beats every SMG costing 100–125, the HVK-30 (125) beats the KN-44 (150), and the RK5 (50) is a trap next to the Sheiva.
  - With the ±10% speed variation, sprinters can outrun a player who is walking and firing (`sprint` 210 × 1.1 = 231 > 220).
  - The power-up drop rate (2%) is on the stingy side early: 58% of games see no drop by the end of round 3. It is mandated and pinned by a test, so it stays at 2% (see 5 below).

## 1. Performance

Environment: Node v24.18.0. Chrome on Windows 11 (32 logical cores, `devicePixelRatio` 2, canvas backing store 1280×720).

### 1a. `pathfinding.buildFlowField` on the real map (`loadMap()`, 60×40, 1215 floor tiles)

| Measurement | Result |
|---|---|
| Mean per build, 20 batches × 1000 builds, target cycled over every floor tile | min **0.052 ms**, median **0.053 ms**, max 0.056 ms |
| Single timed calls (200 samples) | p50 0.049 ms, p99 0.091 ms, max 0.20 ms |
| `getFlowDir` (bilinear query) | 0.07 µs per call |
| Target | < 2 ms. **Passes with about 38× headroom** |

The flow field is rebuilt every 0.2 s, which averages about 0.004 ms per frame.

### 1b. Full logic update in Node (3.7 order, no render)

Harness (scratch, not in the repo):
- It runs the exact 3.7 sequence: `updatePlayer, updateRounds, flow rebuild every 0.2 s, updateZombies, updateBullets, updatePowerups, updateShop, updateEffects`. `render`, `hud` and `input` are left out.
- Setup: `skipToRound(15)`, then 24 zombies kept alive at all times (`toSpawn` set huge, so waves refills them). God mode, dt = 1/60.
- Timing: 600 warm-up frames, then 3600 timed frames.

| Scenario (round 15, 24 alive) | avg ms | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| Player kiting, not firing | 0.021 | 0.016 | 0.061 | 0.082 | 0.28 |
| KN-44, continuous fire | 0.022 | 0.017 | 0.064 | 0.091 | 0.21 |
| Haymaker 12 (8 pellets), continuous fire | 0.022 | 0.016 | 0.061 | 0.088 | 0.32 |

Breakdown for the KN-44 run (avg ms per frame):

| Part | avg ms |
|---|---|
| player + fire | 0.001 |
| waves + flow | 0.004 |
| zombies (separation is O(n²) over 24) | 0.015 |
| bullets + powerups + shop + effects | 0.002 |

The logic update is negligible.

### 1c. Browser (http://localhost:8082/?debug=1, fresh tab, `__game.debug.step(1/60)`)

The automation tab reports `visibilityState: hidden`, so rAF does not tick. Every frame was therefore driven through `debug.step`, which runs one full `tick()`: update + `render.render` + `hud.updateHud`.

Setup:
- `start()`, `god(true)`, `giveWeapon('kn44')`, `skipToRound(15)`, then stepped until the round was active.
- `toSpawn` was set to 100000, and `spawnZombie` topped the count back up to 24 alive before every frame. The measured average was 24.0 alive, mostly attacking or chasing on screen around the player.

Main-thread time per `step(1/60)` (update + render + HUD), 300 frames each:

| Scenario (R15, 24 alive) | avg ms | p50 | p95 | p99 |
|---|---|---|---|---|
| Idle (not firing) | 0.40 | 0.30 | 0.70 | 1.6 |
| KN-44 firing at nearest zombie | 0.55 | 0.30 | 0.90 | 3.2 |
| KN-44 firing + 200 effects kept alive (blood decals, +10 text, tracers) | 1.68 | 0.80 | 1.80 | 47.7* |
| Same as firing, 1200 frames | 0.59 | 0.30 | 0.90 | 2.5 |
| `render.render` + `hud.updateHud` only (24 zombies) | 0.43 | – | 0.40 | – |

Including GPU work: I ran 5 batches of 60 frames (firing + 200 effects), each batch closed by one `getImageData(0,0,1,1)` to force the GPU to finish. Result per frame: **2.42, 1.90, 1.57, 1.84, 1.48 ms**.

**Verdict: 60 fps (16.7 ms) is comfortably met.** The worst realistic case costs about 2 ms of a 16.7 ms frame.

Caveats:
- \* **Occasional spikes.** Once every ~250–330 frames there is a single 20–60 ms spike. It happened even with render+HUD only, and it did not correlate with the effect count.
  - Most likely cause: hidden-tab Chrome flushing canvas work in bulk, because stepped frames never present, or GC.
  - Real rAF play in a visible tab was not measured, because the automation tab is hidden. Recommend QA-1 or the final integrator pass look at the Performance panel in a visible tab. I raise no finding.
- **Measurement artifact, not a bug.** Calling `getImageData` on *every* frame made `render` appear to cost about 9 ms.
  - After repeated readbacks, Chrome moves the canvas to CPU. Drawing the GPU-backed 2400×1600 static layer (`drawImage`, 9-argument form) then needs a readback each frame. Removing only that `drawImage` dropped the time to 0.5 ms.
  - The game never reads the canvas back, so this does not happen in play. It is a reason never to add `getImageData` or `willReadFrequently` to the main canvas later.
- Draw calls per frame at R15 with 24 zombies: about 99 `fillRect`, 27 `arc`/`fill`, 26 `stroke`, 30 `save`/`restore`, 1 `drawImage`, and at most 1 `shadowBlur` use. Nothing expensive.

## 2. Balance: method

- **Bot harness** (scratch): the same 3.7 update loop at dt = 1/60, with a bot that:
  - aims at the nearest zombie in line of sight, with ±0.035 rad aim error;
  - fires, holding the trigger on automatic guns and clicking at 7 per second on semi-automatic guns;
  - reloads when no zombie is visible and nothing is within 250 px, and swaps when dry;
  - kites in the hub (away from nearby zombies, with a strafe that flips every 2–4 s, pulled toward the hub centre);
  - picks up power-ups when safe.
- **Buying:** when nothing is within 260 px, the bot walks to a wall buy and presses interact through the real `shop.updateShop`. Its rules:
  - first purchase: the **cheapest affordable wall gun** (Sheiva or RK5, 50, whichever is nearer);
  - then it replaces the MR6 with the most expensive affordable gun costing at least 125;
  - it buys ammo when a gun's total ammo is below 30%;
  - one variant also spins the box.
- **Runs:** 20–30 seeds per configuration with power-up drops on. Mortal runs end at game over; god-mode runs stop after round 16.
- **Analysis:** closed-form shots-to-kill, TTK, sustained DPS and ammo sufficiency from `weapons.js` and `zombie.healthForRound`.
- **Bot limits:**
  - Its kiting is naive. Every death was the bot getting pinned against a wall or corner by 2–4 joggers, usually while reloading.
  - So its death round (mean 5.9) is a **lower bound** for a competent human, not a difficulty verdict.
  - Economy and TTK numbers do not depend on this.

## 3. Balance: measurements

### 3.1 Economy (10 points per kill, 0 per hit)

| Round | Zombies | Points this round | Cumulative | Bot: cumulative earned at round end (mean of 20) |
|---|---|---|---|---|
| 1 | 6 | 60 | 60 | 61 |
| 2 | 8 | 80 | 140 | 143 |
| 3 | 13 | 130 | 270 | 273 |
| 4 | 18 | 180 | 450 | 470 |
| 5 | 24 | 240 | 690 | 712 |
| 6 | 27 | 270 | 960 | 1040 |
| 10 | 29 | 290 | 2100 | 2195 (god) |
| 15 | 42 | 420 | 3940 | 4130 (god) |

Small extras come from barricade repairs (the bot did none), Nuke (+40) and Carpenter (+20).

| Economy check (spec 4/Phase 3) | Result |
|---|---|
| First wall gun (50) by end of round 2 | **Met with margin.** Bought in round 1 in 20/20 runs, at 21–38 s (after the 5th kill) |
| Box (95) by round 4 | **Met.** After paying 50 for the first gun, 95 more points were available in round 3 in 19/20 runs (round 2 in 1/20) |
| Typical loadout by round 4 (bot) | Sheiva or RK5 plus HVK-30 or KN-44, first ammo buy in round 4–5 |
| Ammo affordability at round 15 (HVK-30 or KN-44) | About 3.8 full loads per round at 100% accuracy, which costs 3 refills × 63–75 = 190–225 of the 420 points earned. Tight but sustainable |

### 3.2 Time-to-kill (shots to kill / seconds of pure fire; shotguns assume all pellets hit)

Zombie HP: R1 150, R2 250, R3 350, R4 450, R5 550, R7 750, R9 950, R10 1045, R12 1264, R15 1683, R20 2710.

Sustained DPS includes reloads. Total ammo is magazine + reserve.

| Weapon | Cost | Dmg/shot | RPM | Sustained DPS | Total ammo | R1 | R2 | R3 | R5 | R9 | R10 | R15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MR6 (start) | – | 40 | 320 | 114 | 72 | 4 / 0.56 s | 7 / 1.13 | 9 / 1.50 | 14 / 2.44 | 24 / 4.31 | 27 / 4.88 | 43 / 7.88 |
| RK5 | 50 | 35 | 500 | 159 | 150 | 5 / 0.48 | 8 / 0.84 | 10 / 1.08 | 16 / 1.80 | 28 / 3.24 | 30 / 3.48 | 49 / 5.76 |
| Sheiva | 50 | 110 (penetrates 2) | 260 | **255** | 130 | 2 / 0.23 | 3 / 0.46 | 4 / 0.69 | 5 / 0.92 | 9 / 1.85 | 10 / 2.08 | 16 / 3.46 |
| L-CAR 9 | 75 | 30 | 900 | 225 | 240 | 5 / 0.27 | 9 / 0.53 | 12 / 0.73 | 19 / 1.20 | 32 / 2.07 | 35 / 2.27 | 57 / 3.73 |
| KRM-262 | 75 | 30×8 | 65 | 177 | 48 | 1 / 0 | 2 / 0.92 | 2 / 0.92 | 3 / 1.85 | 4 / 2.77 | 5 / 3.69 | 8 / 6.46 |
| Pharo | 100 | 42 | 800 | 272 | 240 | 4 / 0.22 | 6 / 0.38 | 9 / 0.60 | 14 / 0.97 | 23 / 1.65 | 25 / 1.80 | 41 / 3.00 |
| Bootlegger | 100 | 44 | 780 | 314 | 270 | 4 / 0.23 | 6 / 0.38 | 8 / 0.54 | 13 / 0.92 | 22 / 1.62 | 24 / 1.77 | 39 / 2.92 |
| Kuda | 125 | 45 | 750 | 314 | 270 | 4 / 0.24 | 6 / 0.40 | 8 / 0.56 | 13 / 0.96 | 22 / 1.68 | 24 / 1.84 | 38 / 2.96 |
| HVK-30 | 125 | 65 | 750 | **437** | 288 | 3 / 0.16 | 4 / 0.24 | 6 / 0.40 | 9 / 0.64 | 15 / 1.12 | 17 / 1.28 | 26 / 2.00 |
| KN-44 | 150 | 70 | 700 | 440 | 270 | 3 / 0.17 | 4 / 0.26 | 5 / 0.34 | 8 / 0.60 | 14 / 1.11 | 15 / 1.20 | 25 / 2.06 |
| ICR-1 | 150 | 60 | 700 | 385 | 270 | 3 / 0.17 | 5 / 0.34 | 6 / 0.43 | 10 / 0.77 | 16 / 1.29 | 18 / 1.46 | 29 / 2.40 |
| Argus | 150 | 45×6 | 90 | 238 | 42 | 1 / 0 | 1 / 0 | 2 / 0.67 | 3 / 1.33 | 4 / 2.00 | 4 / 2.00 | 7 / 4.00 |
| Ray Gun (box) | – | 1000 + splash | 180 | 2069 | 180 | 1 | 1 | 1 | 1 | 1 | 2 / 0.33 | 2 / 0.33 |

How far one full load lasts, starting from round 1:

| Weapon | Rounds cleared at 100% accuracy | Rounds cleared at 80% accuracy | Full loads needed per round (R5 / R10 / R15) |
|---|---|---|---|
| MR6 | **1**, plus 86% of R2 | **1**, plus 60% of R2 | 4.7 / 10.9 / 25 |
| RK5 | 2 | 2 | 2.6 / 5.8 / 13.7 |
| Sheiva | 3 | 3 | 0.9 / 2.2 / 5.2 |
| HVK-30 | 4 | 3 | 0.75 / 1.7 / 3.8 |
| KN-44 | 4 | 3 | 0.71 / 1.6 / 3.9 |

Bot round-clear times (mean wall time from `round:start` to `round:end`):

| Round | Mortal bot, n = 20 (weapon at round start) | Deaths in this round | Avg damage taken | God bot, n = 6 |
|---|---|---|---|---|
| 1 | 35.6 s (MR6) | 0 | 0 | 34.5 s |
| 2 | 32.6 s (Sheiva / RK5) | 0 | 0 | 34.6 s |
| 3 | 39.6 s | 1 | 10 | 37.8 s |
| 4 | 45.5 s (HVK-30 / KN-44) | 1 | 11 | 44.9 s |
| 5 | 61.0 s | 4 | 56 | 64.4 s |
| 6 | 54.5 s | 10 | 175 | 57.3 s |
| 7 | 60.8 s | 2 | 150 | 70.6 s |
| 10 | – | – | – | 82.5 s |
| 12 | – | – | – | 111 s |
| 15 | – | – | – | 161 s (HVK-30 / KN-44, no Pack-a-Punch) |

Bot accuracy was 0.75–0.98. Mortal death rounds over 30 seeds: mean 5.9, range 3–8.

Pistol only (bot never buys), 20 seeds:
- The MR6 was empty in round 2 in 19/20 runs, after 4–6 of round 2's 8 kills.
- The bot then died in round 2, because there is no melee and no MR6 ammo for sale.

### 3.3 Difficulty and zombie speed, rounds 1–5

| Round | Tier mix (walk / jog / sprint) | HP | Hits to down the player (150 HP, 50 per hit) | Bot damage taken per round |
|---|---|---|---|---|
| 1–2 | 100 / 0 / 0 | 150–250 | 3 | 0 |
| 3–4 | 70 / 30 / 0 | 350–450 | 3 | 0–13 |
| 5 | 30 / 50 / 20 | 550 | 3 | 56 (first deaths) |

Speeds are walk 70, jog 130 and sprint 210 px/s, each ±10%. The player walks at 220 and sprints at 297, but firing cancels sprint.

- **Rounds 1–4 are easy, as they should be.** The bot took almost no damage. Rounds 1–2 run about 35 s each, mostly spent waiting for walkers to tear 6 boards (1 s each) and walk in.
- **Round 5 is where pressure starts.** 50% joggers, 20% sprinters and up to 24 alive.
- **Sprinters can outrun the player.** With the ±10% variation, a sprinter's speed is uniform in 189–231, so about 26% of sprinters are faster than a walking player. Since firing cancels sprint, a player shooting while backing off is caught by those.
  - From round 12 on, 75% of spawns are sprinters.
  - The bot's survival did not measurably change with sprint = 195 (mean death round 6.00 vs 5.93 over 30 seeds), because its deaths come from being cornered. So this is a feel and fairness issue rather than a proven difficulty wall.
- **Three hits in about 0.2 s.** When 2–3 zombies reach the player together, the 3 hits land within ~0.2 s, and there is no Quick Revive or Juggernog in v1. This matches BO3 no-perk lethality and I do not propose a change. It is the main reason mistakes are fatal from round 5.

### 3.4 Power-up drops (2% per weapon kill, cap 4 per round)

| Round | Kills | Expected drops this round | P(no drop yet by end of round) |
|---|---|---|---|
| 1 | 6 | 0.12 | 89% |
| 2 | 8 | 0.16 | 75% |
| 3 | 13 | 0.26 | **58%** |
| 4 | 18 | 0.36 | 40% |
| 5 | 24 | 0.48 | 25% |
| 10 | 29 | 0.58 | 1% |
| 15 | 42 | 0.84 | ≈0% |

- Bot runs matched this: 0.0–0.08 drops per run in rounds 1–2, 0.2–0.5 in rounds 3–7, and 0.5–1.3 in rounds 10–15.
- **The cap of 4 per round almost never matters:**

| Round | Zombies | P(cap of 4 reached in the round) |
|---|---|---|
| 10 | 29 | 0.25% |
| 20 | 59 | 3% |
| 30 | 104 | 16% |

- For comparison, BO3's points-threshold system usually gives the first drop in rounds 1–3 and about one drop per round early on.
- 2% is mandated (Section 1 and 5.8, "low chance (2%)"), and `tests/powerups.test.js:40` asserts 150–250 drops per 10 000 kills. So I keep it (see recommendation 5).

## 4. Recommended changes

Severity is blocker / major / minor. `POINTS.perKill` is untouched in every recommendation.

1. **[major] `src/weapons.js`, `WEAPONS.mr6`: `damage: 40 -> 50`, `reserve: 64 -> 80`.**
   - **Why:** today the starting pistol holds 72 rounds but rounds 1–2 need 24 + 56 = 80 hits even at 100% accuracy, and there is no melee. A player who does not buy runs dry after 4–6 kills in round 2 (19/20 bot runs) and can only die. That contradicts "first wall gun *by end of round 2*", which implies the pistol should carry the player through round 2.
   - **After the change:** rounds 1–2 need 18 + 40 = 58 hits out of 88 rounds, which is enough at about 66% accuracy.
     - Simulated with the patched values: the pistol-only bot cleared round 2 in **20/20** runs (was 1/20) and ran dry early in round 3, after 0–4 kills (8 in one run).
     - So buying a gun is still forced by round 3, and the economy target is unaffected.
   - **Test impact:** `tests/weapons.test.js:44` hardcodes `reserve: 64` for `createWeapon('mr6')`. It must become `80` in the same fix.
   - **Resolution (FIX-4, Phase 4):** applied (`damage: 50`, `reserve: 80`); `tests/weapons.test.js:44` updated to 80.

2. **[minor] `src/weapons.js`, `WEAPONS.rk5`: `damage: 35 -> 50`.**
   - **Why:** the RK5 costs the same as the Sheiva (50) but has 159 vs 255 sustained DPS and needs 16 vs 5 shots at round 5. It is a trap for new players, and an automatic "cheapest gun" buyer picks it 20–25% of the time because it is near the start.
   - **After the change:** 3 / 5 / 11 shots at R1 / R2 / R5 and about 227 sustained DPS. It becomes the high-ammo (150) alternative to the Sheiva instead of a strict downgrade, and stays below the SMGs (272–314).
   - **Resolution (FIX-4, Phase 4):** applied (`damage: 50`).

3. **[minor] `src/weapons.js`, `WEAPONS.sheiva`: `damage: 110 -> 90`.**
   - **Why:** at 50 points the Sheiva (255 sustained DPS, penetrates 2, 5 shots at R5) matches or beats every SMG costing 100–125 (Pharo 272, Kuda / Bootlegger 314, but 13–14 shots at R5 and no penetration). That leaves no reason to buy an SMG.
   - **After the change:** 2 / 3 / 4 / 7 shots at R1 / R2 / R3 / R5 and 209 sustained DPS. Still the best first buy, and the SMGs become the next step.
   - The price stays at the spec's 50.
   - **Resolution (FIX-4, Phase 4):** applied (`damage: 90`, price 50).

4. **[minor] `src/weapons.js`, `WEAPONS.hvk30`: `damage: 65 -> 58`.**
   - **Why:** at 125 the HVK-30 has the same DPS as the KN-44 at 150 (437 vs 440) with more ammo (288 vs 270) and a cheaper refill (63 vs 75). The bot's "best affordable ≥ 125" rule ended up on the HVK in most runs, and the 150-point KN-44 is pointless.
   - **After the change:** about 390 sustained DPS, which slots the HVK between the SMGs and the KN-44.
   - Optional companion: the ICR-1 (150, 385 DPS) is also dominated by the KN-44 at the same price. Either `icr1.cost: 150 -> 125` or `icr1.damage: 60 -> 66`.
   - **Resolution (FIX-4, Phase 4):** applied `hvk30.damage: 58` and the companion `icr1.damage: 66` (price kept at 150).

5. **[minor, no change proposed] `src/config.js`, `POWERUPS.dropChance` stays `0.02`, `maxPerRound` stays `4`.**
   - **The concern:** 58% of games see no power-up by the end of round 3 and 40% by the end of round 4, and the cap of 4 never matters before about round 20.
   - **Why no change:** 2% is a stated design pillar, and `tests/powerups.test.js:40` asserts 150–250 drops per 10 000 kills.
   - **If the design owner wants a livelier early game:** `dropChance: 0.02 -> 0.03` gives 44% with no drop by the end of round 3 and 0.87 drops per round at round 10. That needs sign-off plus a test range update to about 250–350.

6. **[minor] `src/config.js`, `ZOMBIE.speeds.sprint: 210 -> 195`.**
   - **Why:** with `speedJitter` 0.10, sprinters range 189–231 and about 26% of them are faster than a walking player (220). Firing cancels sprint, so a player who is shooting while backing away cannot out-walk them. From round 12 on, 75% of spawns are sprinters.
   - **After the change:** the maximum is 214.5, so the player can always slowly open distance while shooting, and sprinters still close in fast.
   - Bot survival is statistically unchanged (it dies to cornering), so this is a feel and fairness change. If the designer wants sprinters to catch careless players, keep 210 and lower `speedJitter` to 0.04 instead (max 218).
   - **Resolution (FIX-1):** applied. `ZOMBIE.speeds.sprint` is now 195.

7. **[info, no change] Economy and prices (`PRICES`, wall costs).**
   - The first gun is affordable after the 5th kill (round 1), a mid gun (125–150) during round 3–4, and the box in round 3. Ammo is sustainable through round 15 (190–225 of 420 points per round).
   - Both Phase 3 targets are met without touching prices or `POINTS.perKill`.

8. **[info, no change] Performance.** No config change is needed.
   - `LOOP.flowRebuildInterval` 0.2 s could safely drop to 0.1 s (for more responsive chasing) at a cost of about 0.0005 ms per frame. Optional.

## 5. Artifacts

These are scratch files, not in the repo. The harness files are in the session scratchpad `qa3/`:

| File | Purpose |
|---|---|
| `perf_flow.mjs` | Flow-field benchmark (1a) |
| `perf_logic.mjs` | Logic-update benchmark (1b) |
| `sim.mjs` | 3.7-order harness and bot |
| `batch.mjs`, `variant.mjs` | Multi-seed balance runs and proposed-value checks |
| `ttk.mjs` | Analytic tables |

The browser measurements were run with inline `javascript_tool` snippets on http://localhost:8082/?debug=1. That server has been stopped.

## WO3 regen

**Change (WORK_ORDER_3 §1.2):** `PLAYER.regenPerSec: 60 -> 1`. `regenDelay` stays 4.0 s. Nothing else was retuned.

**What it means in play:**
- The old rate healed 150 HP in 2.5 s once the delay passed, so any break of about 6.5 s without being hit restored full health.
- The new rate needs about 150 s to heal from 1 HP. Healing 50 HP (one zombie hit, `ZOMBIE.damage` 50) takes 4 s + 50 s = 54 s.
- Regen is continuous: fractional HP accumulates every frame, so the HUD percentage moves smoothly at about 0.67 %/s.
- The between-round break is short, so it no longer resets health. Damage taken now carries over from round to round.

**Expected consequence (follow-up, not fixed here):**
- Rounds 5+ get noticeably harder. The v1 balance (sprint speed, zombie damage, round health curve) was tuned against near-instant regen.
- A player at 100 HP after one hit is at 2-hit death for most of the next minute, where before it was about 6.5 s.
- Candidates for a later order, not applied: a middle-ground rate (for example 5 to 10 HP/s), a full heal at round start, or a Jugger-style max-health perk.

**Headless bot check (scratch harness `qa3/sim.mjs`, new wrapper `qa3/regen_cmp.mjs`, default preset, 40 seeds, same seeds for both rates):**

| regenPerSec | mean death round | median | avg survival |
|---|---|---|---|
| 60 | 5.95 | 6 | 293 s |
| 1 | 5.90 | 6 | 282 s |

- **Why the bot shows almost no effect:** it dies to cornering, meaning several hits landing inside one regen delay. Regen speed barely matters for that.
- **So this check is a lower bound on the impact.** It says nothing about a human kiting and taking hits spread out over time, which is exactly the case the slow regen punishes.
- **Follow-up:** re-measure with a human playtest before retuning anything.
