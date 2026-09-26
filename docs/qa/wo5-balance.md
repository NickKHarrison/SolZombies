# QA-3 (WO5): balance for the boss fight, level 2 and loop scaling

This is a Phase 3 report only. Nothing under `src/` or `tests/` was changed.

**Scope:** WORK_ORDER_5.md 1.2, 1.3, 3.4, 3.8 and 4 (Phase 3, balance). It also answers Finding 1 of `docs/notes/integration-wo5.md`: level 3 is currently easier than level 2.

**Method.** All harnesses are headless Node scripts in the session scratchpad `qa3/wo5/`, not in the repo. They import the real `src/` modules and run `main.js`'s `update()` order at dt = 1/60:

```
level.updateLevel -> player -> rounds -> flow -> zombies -> boss.updateBoss -> bullets -> powerups -> shop -> effects
```

| File | What it does |
|---|---|
| `h.mjs` | The harness (`makeGame` goes through `level.startLevel`, and every `init*` includes `boss.initBoss`) |
| `fight.mjs` | Arena bot: circle-strafes at 200–280 px from the boss, dodges the charge sideways after a set reaction time, shoots minions within 320 px first and the boss otherwise, avoids walls, picks up power-ups. ±0.035 rad aim error |
| `econ.mjs` | Progression bot: kites in the start room, buys reachable wall guns and ammo, buys doors in cost order through `shop.buyDoor`, then `shop.buyMegaDoor` |
| `exp.mjs`, `b*.mjs`, `q*.mjs` | Batches and variants. Proposed values were emulated in memory by patching config objects, adding `zombie:spawned` listeners and wrapping `weapons.setWeaponDeps` |
| `ttk.mjs`, `tables.mjs` | Closed-form TTK, economy and scaling tables |

**Result terms:**
- **"god"** means the player had 10⁷ HP, so hits were still counted as damage taken.
- **"mortal"** means 150 HP with the real regen.
- Unless stated otherwise, each cell is 8–16 seeds.

**Bot caveat (same as `docs/qa/balance.md`).** The arena bot is competent: charge hit rate 7–25 %, and it survives 80–95 % of level-1 fights. The open-map bot is not:
- It dies within about 20 s at round 8+ because it gets cornered.
- So level-2 survivability comes from god-mode workload (round duration, kill rate), a closed-form economy model and arena fights, not from open-map death rounds.
- Mortal results are a **lower bound** for a human.

## Summary

- **Level 1: the mega door opens around round 9–11.** Doors (550) + mega door (250) + guns + ammo come to about 1,150–1,600 points. The bot got there in round 9–11 (median 10). A frugal player, who buys only Sheiva then KN-44, gets there in about round 8–9. That lands the boss inside the spec's round 8–12 window. The player enters with **0–190 points** to spare.
- **Boss with the KN-44 hits the target at R8–R10 (40–50 s) but breaks at R12+.** There the KN-44 **runs dry in 10 of 10 runs** without drops, because minions (45 % of round HP) eat the ammo and the sealed arena has no ammo source.
- **Three things kill the boss far too fast:**

  | Cause | Boss TTK |
  |---|---|
  | Ray Gun | 7–11 s |
  | Thundergun | 20–23 s |
  | Insta-Kill (5 % per *hit*, 11.7 hits/s with the KN-44) | 5 s |

- **Charges are dodgeable.** The bot is hit by 7–18 % of charges on level 1 and 22–29 % on level 2.
- **Minion pressure is 10–35 HP per 10 s.** A player entering at half health survives only 50 % of level-1 fights (full health: 94 %).
- **Level 2: the new guns more than restore the level-1 feel**, per shot and per second. God-mode round time is 90 s with XR-2 + Man-O-War vs 96 s on level 1 with the KN-44, and 169 s on level 2 with level-1 guns.
- **But the level-2 economy loses points.** At 80 % accuracy, ammo refills at 0.5 × cost (100–150) cost more than the round pays: net **−36 to −340 points per round** with the new guns, vs **+116 to +154** on level 1.
- **Level 2 sprinters outrun a firing player.** Sprint 195 × 1.1 × (1 ± 0.1) gives 193–236 px/s against a player walking at 220 px/s.
- **Loop scaling is not monotonic today.** Health goes 1 → 1.5 → **1.4** → 2.1 → **1.96**, and count and speed dip the same way on every odd level. On top of that, boss HP double-compounds (level multiplier × `1 + 0.12·round`) and minion HP triple-compounds (round, level, and 4 + index per wave). By level 4 the arena cannot be beaten.
- **Proposed formula (recommendations 1–2):** from level 3 on, multiply the **previous level's** difficulty by a per-descent factor: health ×1.2, count ×1.1, speed ×1.03 (capped at 1.15), sprintShift +2. Every factor then strictly increases every descent.
- **With the full package (recommendations 1–10), simulated boss TTK rises every level:** 46 → 54 → 73 → 92–116 s for L1 R10 → L2 R14 → L3 R18 → L4 R22. Mortal bot survival falls 80 % → 70 % → 0–40 % → 0 %.
- **Regen at 1 HP/s heals only 10–25 HP per fight.** A full heal at `boss:start` (recommendation 11) is worth far more than any regen rate.

## 1. Level 1: round and points when the mega door is bought

### Closed-form budget

Kills pay 10 points.

| Item | Points |
|---|---|
| Doors D + E + F + G + H | 75 + 100 + 100 + 125 + 150 = 550 |
| Mega door | 250 |
| Guns, frugal (Sheiva 50, then KN-44 150) | 200 |
| Guns, full (+ Argus 150, + an SMG 125) | 475–600 |
| Ammo (KN-44 refill 75, about 1 per round from R6) | 150–400 |
| **Total** | **about 1,150 (frugal) to 1,600** |

Cumulative kill income:

| End of round | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|
| Points earned | 960 | 1,240 | 1,520 | 1,810 | 2,100 | 2,420 |

So a frugal, accurate player can buy the mega door **at the end of R7 or during R8**. A typical player gets there in **R9–R10**.

### Bot results

`q1.mjs`: god mode, 10 seeds, the bot buys doors as soon as it owns a wall gun.

| Seed | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Mega door bought in round | 11 | 9 | 9 | 9 | 10 | 11 | 10 | 11 | 9 | 13 |
| Points earned by then | 2,440 | 1,870 | 1,970 | 1,870 | 2,290 | 2,340 | 2,200 | 2,420 | 1,910 | 3,260 |
| Ammo spent | 926 | 439 | 451 | 401 | 703 | 940 | 688 | 994 | 413 | 1,705 |
| Points left after the mega door | 114 | 31 | 119 | 69 | 187 | 0 | 112 | 26 | 97 | 155 |

- Door rounds were typically D in R2, E in R3, F in R4–6, G in R6–8 and H in R8–13.
- Guns spent: 600 (Sheiva, Kuda, VMP, Argus, KN-44). A frugal buyer saves about 400, which is 1–1.5 rounds.
- **Verdict:** the boss is reached in about **R8–R11**, which matches the round 8–12 design window.
  - The player arrives with a KN-44 + Argus-class loadout and **0–190 points**.
  - The arena has no buys, so the ammo carried in is all there is (see 2).

## 2. Boss fight on level 1 (current values)

**Setup:**
- Boss HP is `4000 × (1 + 0.12·R)`: 7,840 / 8,800 / 9,760 / 10,720 at R8 / 10 / 12 / 14.
- Minion HP is 45 % of the round's zombie HP: 383 / 470 / 569 / 689.
- The player enters with full ammo.

### 2a. Time to kill, god mode, drops off (10 seeds)

| Primary (backup) | R8 | R10 | R12 | R14 |
|---|---|---|---|---|
| KN-44 (Argus) | **40 s** (30–47) | **50 s** (46–56) | **0/10 killed: both guns dry** | 0/10, dry |
| KN-44 alone | 42 s | 44 s, **4/10 dry** | 0/10, dry | 0/10, dry |
| Argus (KN-44) | 73 s | 83 s | 0/10, dry | 0/10, dry |
| Ray Gun (KN-44) | **7 s** | **8.5 s** | **10 s** | **11 s** |
| Thundergun + KN-44 | **21 s** | **20 s** | **23 s** | **22 s** |

- With drops on (12 seeds), the KN-44 killed the boss in 12/12 runs at R10 (53 s), 5/12 at R12 (7 dry) and 1/12 at R14 (11 dry).
- **Ammo arithmetic at R12:**
  - The boss needs 9,760 / 70 = 140 KN-44 hits.
  - About 20 minions over the fight need 9 hits each, about 180 hits.
  - With misses, that is more than the 270 rounds the gun holds, and more than the 312 KN-44 + Argus hits combined.
- **Insta-Kill** (forced at fight start, R10): KN-44 **5.1 s**, Argus 10.3 s. The 5 % floor applies per pellet and per bullet, so 11.7 KN-44 hits per second remove 58 % of the boss per second.

### 2b. Minion pressure and charge dodging (KN-44, R10, god mode, 12 seeds)

| Dodge behaviour | Damage per 10 s | From melee / charge / minions (per fight) | Charges that hit |
|---|---|---|---|
| No dodge logic (circle-strafe only) | 17.6 | 19 / 31 / 35 | 8 % |
| Dodge sideways, 0.15 s after the telegraph starts | 30.0 | 44 / 69 / 25 | 17 % |
| Dodge sideways, 0.4 s after | 20.0 | 25 / 69 / 17 | 15 % |
| Dodge sideways at the lock (0.6 s) | 25.3 | 25 / 75 / 17 | 18 % |

Across all level-1 runs, damage taken was **10–35 HP per 10 s**, and minions dealt 25–100 HP per fight. The charge is the largest single source.

**Charge geometry:**

| Quantity | Level 1 | Level 2 |
|---|---|---|
| Dash speed (90 × 3.5, × speedMult) | 315 px/s | 346 px/s |
| Dash reach (× 1.1 s) | 346 px | 381 px |

- To get clear, the player must move 34 + 14 + 2 = 50 px sideways. At a walk (220 px/s) that takes 0.227 s.
- **Already moving sideways when the aim locks at 0.6 s:** the charge misses if the boss is more than **121 px** away (level 1) or **129 px** (level 2).
- **Standing still and reacting 0.25 s after the dash starts:** it misses beyond **about 200 px**.
- The 0.6 s telegraph is fair. Only point-blank charges (< 120 px) are unavoidable, and at that range the melee (75) is the threat anyway. **No change needed.**
- On level 2 the hit rate rises to 22–29 %. The arena is smaller (14×12 with 3 pillars) and the boss is faster. That is acceptable as "harder".

### 2c. Mortal (150 HP, regen 1 HP/s after 4 s)

| | R8 | R10 | R12 |
|---|---|---|---|
| KN-44 (Argus): fights won | 10/12 | 9/12 | **4/12** |
| Argus (KN-44): fights won | 4/12 | 1/12 | 0/12 |
| Thundergun + KN-44: fights won | 12/12 | 12/12 | 12/12 (22 s) |

## 3. Level 2

### 3a. TTK: shots to kill and burst seconds

Level-2 zombies have 1.5× health.

| Gun (wall cost) | Per shot | Sustained DPS | R10 L1 | R10 L2 | R12 L1 | R12 L2 | Zombies per full load, L2 R12 |
|---|---|---|---|---|---|---|---|
| KN-44 (L1, 150) | 70 | 440 | **15 / 1.20 s** | 23 / 1.89 s | 19 / 1.54 s | 28 / 2.31 s | 9.6 |
| Argus (L1, 150) | 270 | 238 | 4 / 2.00 s | 6 / 3.33 s | 5 | 8 / 4.67 s | 5.3 |
| Man-O-War (250) | 120 | 547 | 9 | **14 / 1.50 s** | 11 | 16 / 1.73 s | 14.1 |
| XR-2 (225) | 85 | **622** | 13 | **19 / 1.20 s** | 15 | 23 / 1.47 s | 13.0 |
| Weevil (200) | 60 | 572 | 18 | 27 / 1.64 s | 22 | 32 / 1.96 s | 10.5 |
| Marshal 16 (225) | 560 | 416 | 2 | 3 / 1.09 s | 3 | 4 / 1.64 s | 10.5 |
| Gorgon (300) | 130 | 557 | 9 | **13 / 1.80 s** | 10 | 15 / 2.10 s | 19.2 |
| 48 Dredge (275) | 70 | 481 | 15 | 23 / 1.55 s | 19 | 28 / 1.91 s | 12.0 |
| Haymaker 12 (250) | 200 | 516 | 6 | 8 / 1.40 s | 7 | 10 / 1.80 s | 8.0 |
| Drakon (300) | 220 | 400 | 5 | 8 / 2.10 s | 6 | 9 / 2.40 s | 7.8 |

- **Level-1 guns on level 2 lose about 35 %.** The KN-44 goes from 15 to 23 shots at R10.
- **The new guns restore level-1 shot counts:**
  - Man-O-War 14 and Gorgon 13, against the KN-44's 15 on level 1.
  - XR-2 matches the KN-44's burst time (1.20 s).
  - Penetration (Man-O-War 2, Gorgon 3) adds more on zombie trains.
- **The 48 Dredge is the outlier.** It has the KN-44's per-shot damage at 275 points, and only +9 % sustained DPS (recommendation 12).

### 3b. Workload (god mode, all doors open, ammo auto-refilled, R11–12, 6 seeds × 2 rounds)

| Scenario | Round duration | Kills per second | Contact damage per minute* |
|---|---|---|---|
| L1, KN-44 + Argus | 96 s | 0.34 | 3,671 |
| L2, KN-44 + Argus | **169 s** | 0.24 | 4,789 |
| L2, XR-2 + Man-O-War | **90 s** | 0.46 | 2,366 |
| L2, Gorgon + XR-2 | 74 s | 0.56 | 2,320 |
| L2, XR-2 + Man-O-War, sprinters capped at 214 | 95 s | 0.44 | 2,676 |

\* Contact damage in god mode means how swarmed the bot is. Compare rows only relative to each other.

**Verdict:**
- With level-1 guns, level 2 is a wall: rounds take 1.75× longer.
- With one or two level-2 guns it plays like late level 1: the zombies are tougher and faster, and the guns more than compensate.
- **Level 2 is survivable in TTK terms.** The blockers are the economy (3c) and sprinter speed (below).
- **Ammo for level-1 guns:** on level 2 the only level-1 wall gun is the HVK-30 in the start room. KN-44, Argus and ICR-1 ammo is unavailable except from Max Ammo drops.
  - This pushes the player to buy new guns quickly, which is fine. The player arrives with about 400–550 points (0–190 left over + 150–200 from minions + 200 boss), enough for door D (75) plus a Weevil or Marshal 16 in round 1 of level 2.

**Sprinter speed on level 2:**
- Sprinters move at 195 × 1.1 × U(0.9, 1.1) = **193–236 px/s**, so **37 % of sprinters are faster than a player walking and firing** (220 px/s).
- With sprintShift 3, 75 % of spawns are sprinters from R9 on.
- WO4 balance #6 lowered sprint speed to 195 precisely so the player could always open distance while shooting. `speedMult` undoes that on every level after the first.

### 3c. Economy at 80 % accuracy

Model: income is count × 10. Ammo spend is (count × shots to kill / 0.8) ÷ (mag + reserve) × ammo price.

| Level, round, gun | Count | Income | Ammo price now (0.5 × cost) | **Net now** | Ammo price proposed (0.3 × cost) | **Net proposed** |
|---|---|---|---|---|---|---|
| L1 R8, KN-44 | 28 | 280 | 75 | **+154** | – | – |
| L1 R10, KN-44 | 29 | 290 | 75 | **+139** | – | – |
| L1 R12, KN-44 | 34 | 340 | 75 | **+116** | – | – |
| L2 R12, XR-2 | 43 | 430 | 113 | **−36** | 68 | +150 |
| L2 R12, Man-O-War | 43 | 430 | 125 | −48 | 75 | +143 |
| L2 R12, Gorgon | 43 | 430 | 150 | +10 | 90 | +178 |
| L2 R12, Weevil | 43 | 430 | 100 | −82 | 60 | +123 |
| L2 R14, XR-2 | 49 | 490 | 113 | **−133** | 68 | +115 |
| L2 R14, Gorgon | 49 | 490 | 150 | −84 | 90 | +145 |
| L2 R14, 48 Dredge | 49 | 490 | 138 | −340 | 83 | −9 |
| L2 R14, Haymaker 12 | 49 | 490 | 125 | −658 | 75 | −199 |

- On level 2 every refill costs about 1.5× level 1's, while each kill still pays 10 points against 1.5× the health. So even at 100 % accuracy the XR-2 roughly breaks even at R14.
- A level-2 player then needs 550 (doors) + 250 (mega door) + 200–300 (guns). They cannot bank that while paying for ammo, so they stall on level 2 unless Max Ammo drops.
  - The drop rate is 2 % per kill with Max Ammo weight 3/16, which is about 0.17 per round.
  - The bot showed this directly: it spent 1,469 points on ammo in 4 level-2 rounds and never reached the mega door.
- With tier-2 ammo at 0.3 × cost (recommendation 10), the net per round returns to level 1's +115 to +178.
- The Haymaker 12 stays negative; it is a high-burst, ammo-hungry gun by design.

## 4. Loop scaling to levels 4–5

### 4a. Current code vs proposed formula

Assumes about 4 rounds per level, so the boss is reached at R10, 14, 18, 22 and 26.

| Level (boss round) | Current: health / count / speed / shift | Proposed: health / count / speed / shift |
|---|---|---|
| L1 (R10) | 1.00 / 1.00 / 1.00 / 0 | 1.00 / 1.00 / 1.00 / 0 |
| L2 (R14) | 1.50 / 1.25 / 1.10 / 3 | 1.50 / 1.25 / 1.10 / 3 |
| L3 (R18) | **1.40** ↓ / **1.15** ↓ / **1.05** ↓ / 3 = | 1.80 / 1.375 / 1.133 / 5 |
| L4 (R22) | 2.10 / 1.44 / 1.155 / 6 | 2.16 / 1.51 / 1.15 (cap) / 7 |
| L5 (R26) | **1.96** ↓ / **1.32** ↓ / **1.10** ↓ / 6 = | 2.59 / 1.66 / 1.15 / 9 |
| L6 (R30) | 2.94 / 1.65 / 1.21 / 9 | 3.11 / 1.83 / 1.15 / 11 |

Resulting stats at each level's boss round:

| Level (boss round) | Zombie HP, current / proposed | Zombies per round, current / proposed | Fastest sprinter (px/s), current / proposed | Boss HP, current / proposed | Minion HP, current / proposed |
|---|---|---|---|---|---|
| L1 (R10) | 1,045 / 1,045 | 29 / 29 | 215 / 214 | 8,800 / 9,900 | 470 / 300 |
| L2 (R14) | 2,295 / 2,295 | 49 / 49 | **236** / 214 | 16,080 / 16,470 | **1,033** / 450 |
| L3 (R18) | 3,136 / 4,032 | 60 / 72 | 225 / 214 | 17,696 / 19,764 | 1,411 / 540 |
| L4 (R22) | 6,888 / 7,085 | 97 / 102 | **248** / 214 | 30,576 / 23,717 | 3,100 / 648 |
| L5 (R26) | 9,412 / 12,447 | 112 / 140 | 236 / 214 | 32,301 / 28,460 | 4,235 / 778 |

(↓ = lower than the level before; = means no increase.)

- The proposed boss HP is `4500 × healthMult × (1 + 0.12 × min(R, 12))` (recommendation 4).
- The proposed minion HP is `300 × healthMult` (recommendation 5).
- The proposed sprinter maximum assumes the 214 px/s clamp (recommendation 3).
- Minions per wave are 4 + level index in both versions: 4, 5, 6, 7, 8 for L1–L5, still capped at 10 alive.

**Notes:**
- **sprintShift stops mattering once round + shift ≥ 12.** The tier table tops out at 0 % walkers / 25 % joggers / 75 % sprinters. So from level 2 onward it is inert, and the per-level increase has to come from health, count and speed.
- **Zombie HP rises about 1.46× per level from rounds alone** (×1.1 per round after R9, about 4 rounds per level). That is why the per-descent health factor is 1.2 and not 1.4.
  - With 1.4 compounding on level 2, level 3 would already be at the current level 4 (2.1).
  - The endless run hits a wall around levels 4–5 either way, because there is no Pack-a-Punch.
- **Boss and minion HP currently compound on round and level, and grow with minion count.**
  - Current values, simulated (XR-2 + Man-O-War, god mode):

    | Level (round) | Bosses killed | Runs where the guns ran dry |
    |---|---|---|
    | L2 (R14) | 8/8, TTK 87 s; **mortal 0/8** | – |
    | L3 (R18) | 3/8 | 5 |
    | L4 (R22) | 1/8 | 7 |
    | L5 (R26) | 0/8 | 8 |

  - Current level-3 minions have 1,411 HP (17 XR-2 hits each), and 6 arrive per wave.

### 4b. Proposed package, simulated

The package is recommendations 1–10: the monotonic formula, boss base 4,500 with the round factor capped at 12, minions at 300 × healthMult, a Max Ammo drop at 50 % boss HP, and a hit cap for guns.

| Level, round, loadout | Boss HP | God mode: killed, TTK | Mortal: fights won | Damage per 10 s | Charge hit rate |
|---|---|---|---|---|---|
| L1 R10, KN-44 + Argus | 9,900 | 10/10, **46 s** | 8/10 (15/16 in the regen run) | 17–22 | 7–15 % |
| L1 R12, KN-44 + Argus | 10,980 | 10/10, **44 s** | 8/10 | 17–19 | 6–11 % |
| L2 R14, XR-2 + Man-O-War | 16,470 | 10/10, **54 s** | 7/10 | 18–35 | 24–25 % |
| L3 R18, XR-2 + Man-O-War | 19,764 | 10/10, **73 s** | 4/10 | 13–44 | 13–22 % |
| L4 R22, XR-2 + Man-O-War | 23,717 | 10/10, **116 s** (92 s with minions capped at +2 per wave) | 0/10 | 44–61 | 22 % |
| L5 R26, XR-2 + Man-O-War | 28,460 | 3/10 (7 dry); 7/10 (3 dry) with the minion cap | 0–2/10 | 49–80 | 26–54 % |

- Difficulty now **strictly increases every descent**. Health, count and speed multipliers all rise, while round health and count keep rising too.
- Boss TTK increases every level, and the naive bot's survival falls every level.
- Levels 4–5 are the endless endgame. Capping minions per wave at `minionsPerWave + min(levelIndex, 2)` softens the minion ammo sink there (optional, recommendation 13).

**Wonder weapons and power-ups under the package** (L1 R10, 9,900 HP boss, 8 seeds, god mode unless noted):

| Change | Before | After |
|---|---|---|
| Ray Gun, hit cap 3 % of max HP | 7–11 s | **29 s** (the 2 % cap gives 44 s) |
| Thundergun near cone, 15 % → 8 % | 20 s | **37 s**, mortal 8/8 (5 % gives 58 s) |
| Insta-Kill as ×2 damage instead of a 5 % floor per hit (KN-44) | 5 s | **22 s** (tested with boss base 5,000, 11,000 HP) |

## 5. Regen during the boss fight (mortal, drops off, package values, 16 seeds)

| Regen | Starting HP | L1 R10: fights won | L1 R10: HP regenerated per fight | L2 R14: fights won | L2 R14: HP regenerated per fight |
|---|---|---|---|---|---|
| 1 HP/s (current) | 150 | **15/16** | 10 | 9/16 | 16 |
| 1 HP/s (current) | 75 | **8/16** | 39 | 6/16 | 33 |
| 3 HP/s | 150 | 14/16 | 26 | 12/16 | 44 |
| 3 HP/s | 75 | 14/16 | 93 | 10/16 | 88 |
| 5 HP/s | 150 | 15/16 | 44 | 13/16 | 60 |
| 5 HP/s | 75 | 14/16 | 112 | 11/16 | 114 |

- **1 HP/s barely matters inside the arena.** Hits land every 6–10 s, and the 4 s delay resets on each one, so regen adds only 10–40 HP per fight.
- **Entry health decides the fight.** At 1 HP/s, entering at half health halves the win rate on level 1.
- Health carries over from the rounds before the fight, where WO3's 1 HP/s leaves it, and the break is only 8 s.
- **Recommendation 11:** heal to full when the fight starts. It keeps WO3's global regen and makes the boss a fresh, fair test.
  - The alternative, a boss-only regen of 3 HP/s, was about as good in the simulation: 14/16 level-1 fights won from 75 HP.

## 6. Recommended changes

**[MONO]** = needed for "difficulty increases every level".
**[BAL]** = balance fix.
**(test)** = lists the existing tests that must be updated in the same fix.

1. **[MONO, required] `src/level.js` `levelDifficulty(index, loop)`: past the last authored level, compound on the previous level instead of on the looped level's base.**
   - **Why:** today level 3 = level 1 base × 1.4 = 1.4, which is below level 2's 1.5. Count and speed dip the same way on every odd level, and sprintShift stays flat on L3 and L5. The new formula makes every factor strictly increase every descent (speed until its cap). The layout and theme still cycle through `levelByIndex`, and `loop` stays as it is for the HUD and events.
   - **Code:**
     ```js
     export function levelDifficulty(index, loop = loopOf(index)) {   // `loop` kept for signature compatibility
       const n = LEVELS.length;
       const baseOf = (pos) => (LEVELS[pos] && LEVELS[pos].difficulty) || BASE_DIFFICULTY[pos] || BASE_DIFFICULTY[0];
       const i = Math.max(0, Math.floor(Number(index) || 0));
       if (i < n) { const b = baseOf(i); return { healthMult: b.healthMult, speedMult: b.speedMult, countMult: b.countMult, sprintShift: b.sprintShift }; }
       const last = baseOf(n - 1), L = LEVELS_CFG.loop, k = i - (n - 1);    // descents past the last authored level (L3 -> 1)
       return {
         healthMult: last.healthMult * L.healthMult ** k,
         countMult: last.countMult * L.countMult ** k,
         speedMult: Math.min(L.speedMultCap ?? Infinity, last.speedMult * L.speedMult ** k),
         sprintShift: last.sprintShift + L.sprintShift * k,
       };
     }
     ```
   - **(test)** `tests/level.test.js:54-60`: `levelDifficulty(N).healthMult` becomes `1.5 × L.healthMult`, and `levelDifficulty(2N+1)` becomes `1.5 × L.healthMult ** 4`. Add a test asserting that every factor is non-decreasing and health and count strictly increase for index 0..8.

   - **Resolution (FIX-1):** done. `levelDifficulty` compounds on the previous level past the last authored level (speed capped, never below the last authored value); `tests/level.test.js` updated (L3/L4 table values, `2N+1` = `1.5 x 1.2^4`) plus a monotonic test over indices 0..12.

2. **[MONO, required] `src/config.js` `LEVELS_CFG.loop`: `{ healthMult: 1.4, countMult: 1.15, speedMult: 1.05, sprintShift: 3 }` → `{ healthMult: 1.2, countMult: 1.1, speedMult: 1.03, sprintShift: 2, speedMultCap: 1.15 }`.** Update the comment above it to "per descent past the last authored level, compounding on the previous level".
   - **Why:** the factors now compound on 1.5 and not on 1.0, and round health already grows about 1.46× per level. The old values would put level 3 at 2.1, today's level 4.
   - The speed cap stops walkers and joggers from converging on sprint speed.
   - Resulting health, count, speed and shift: L3 1.8 / 1.375 / 1.133 / 5, L4 2.16 / 1.51 / 1.15 / 7, L5 2.59 / 1.66 / 1.15 / 9.

   - **Resolution (FIX-1):** done. `LEVELS_CFG.loop = { healthMult: 1.2, countMult: 1.1, speedMult: 1.03, sprintShift: 2, speedMultCap: 1.15 }`, comment updated. Browser: level 3 = 1.8 / 1.375 / 1.133 / 5.

3. **[MONO-support, BAL] `src/zombie.js` `spawnZombie`, normal branch: clamp speed after jitter, `speed = Math.min(speed, ZOMBIE.maxSpeed)`, with new `ZOMBIE.maxSpeed: 214` in `src/config.js`.** Minions and the boss are not clamped.
   - **Why:** `speedMult` 1.1 puts level-2 sprinters at 193–236 px/s, so 37 % of them outrun a player walking and firing (220). That undoes WO4 balance #6.
   - With the clamp, "faster every level" shows up as more jog and walk speed plus more health and count, and the core rule "the player can always back-pedal while shooting" holds.
   - Measured cost: level-2 god-mode round 95 s vs 90 s. It is a fairness fix, not an easing.
   - **Resolution (FIX-2):** `ZOMBIE.maxSpeed: 214` applied in `spawnZombie` after tier × speedMult × jitter for normal zombies. Lead decision: minions are clamped too, at `ZOMBIE.maxSpeed × BOSS.minion.maxSpeedMult` (1.1 → 235.4 px/s); the boss is not clamped. Tested in `tests/zombie.test.js` ("FIX-2 speed cap").

4. **[BAL] Boss HP.**
   - `src/config.js` `BOSS.baseHealth: 4000 → 4500`, and add `BOSS.roundScaleCap: 12`.
   - `src/zombie.js` `bossHealthFor`: `(1 + BOSS.roundScale * r)` → `(1 + BOSS.roundScale * Math.min(r, BOSS.roundScaleCap ?? Infinity))`.
   - **Why:** with recommendations 5–6 the fight is no longer ammo-starved. KN-44 TTK becomes 46 s at R10 and 44 s at R12, the centre of 45–75 s. It was 40 / 50 s / dry.
   - Past R12, boss HP grows through the level's `healthMult`, which is strictly increasing, instead of double-compounding. That gives TTK 46 → 54 → 73 → 92–116 s for L1 → L4.
   - **(test)** `tests/zombie.test.js:692` uses the formula with round 5, so it stays valid if it reads `BOSS.baseHealth`.
   - **Resolution (FIX-2):** `BOSS.baseHealth: 4500`, `BOSS.roundScaleCap: 12`, applied in `zombie.bossHealthFor`. `:692` reads `BOSS.baseHealth` and stays valid; `tests/boss.test.js` scale test now reads `BOSS.baseHealth`; new cap test. Measured (fix2.mjs, 10 seeds, drops off, god mode, KN-44 + Argus): R8 44.4 s, **R10 45.7 s** (40–55), R12 52.9 s (42–56), 0 dry; KN-44 alone R10 43.0 s; mortal R10 10/12 won.

5. **[BAL] Minion HP: `src/config.js` add `BOSS.minion.baseHealth: 300` (keep `healthFrac` for the contract test). In `src/zombie.js` `spawnZombie`, minion branch: `hp = M.baseHealth != null ? Math.round(M.baseHealth * diff.healthMult) : Math.round(healthForRound(round, diff) * M.healthFrac)`.**
   - **Why:** at 45 % of round HP, minions are the ammo sink that empties the KN-44 at R12+ (10/10 runs). They also triple-compound: 1,033 HP on L2 R14 and 3,100 on L4.
   - At 300 × healthMult, minions cost 300 / 450 / 540 / 648 HP on L1–L4. That is still strictly increasing and still takes 4–5 KN-44 hits on level 1.
   - **(test)** `tests/zombie.test.js:682` expects `healthForRound(5) × healthFrac`.
   - **Resolution (FIX-2):** key named `BOSS.minion.health: 300` (lead decision; `healthFrac` kept for the contract test, unused). `zombie.minionHealthFor` = `300 × healthMult`. `:682` updated; new test for round independence and healthMult.

6. **[BAL] `src/boss.js` `updateBoss`: while active, drop one Max Ammo the first time the boss is at or below `BOSS.ammoDropAtFrac` (new, 0.5) of max HP.**
   - Code: `spawnPowerup(state, 'maxAmmo', b.x, b.y)` behind a `b.midDrop` flag, reset in `createBossState`.
   - **Why:** the sealed arena has no ammo source, and the player arrives having just spent every point on doors.
   - The package simulation had 0 dry runs on L1–L4, against 10/10 dry at R12 today.
   - **Resolution (FIX-2):** done as written (`BOSS.ammoDropAtFrac: 0.5`, `b.midDrop`, drop at the boss position the first frame `hp < 0.5 × maxHp`; no mid drop if the boss dies from above 50 % in one frame, the death drop covers it). New test in `tests/boss.test.js`.

7. **[BAL] Insta-Kill vs the boss.**
   - `src/zombie.js` `damageZombie`, boss branch: `if (powerupActive(state, 'instaKill')) dmg = Math.max(dmg, BOSS.instaKillFrac * maxHp)` → `dmg *= BOSS.instaKillMult`.
   - Add `BOSS.instaKillMult: 2` in `src/config.js`. Keep `instaKillFrac` only if the contract test needs the key.
   - **Why:** "5 % per hit" applies per bullet and per pellet. KN-44 kills the boss in **5.1 s** and Argus in 10 s under Insta-Kill. Double damage gives about 22 s: still a big swing, not a delete.
   - This deviates from spec 1.2, so the design owner should sign off.
   - **(test)** `tests/zombie.test.js:708` asserts `hp = maxHp × (1 − instaKillFrac)`.
   - **Resolution (FIX-2):** `BOSS.instaKillMult: 2` via `zombie.bossHitDamage`; the ×2 hit is then subject to the #8 cap. `instaKillFrac` kept (contract test), unused. Deviation from spec 1.2 documented in `docs/notes/zombie.md`. `:708` rewritten (×2, cap, 20 Death-Machine hits no longer kill). Measured: KN-44 + Argus R10 with Insta-Kill forced at fight start **17.4 s** (14–24) vs 45.7 s without; was 5.1 s.

8. **[BAL] Ray Gun vs the boss.**
   - Add `BOSS.maxHitFrac: 0.03` in `src/config.js`.
   - `src/weapons.js`: in `detonate()` (the direct hit) and `hitscan()`, when the target is the boss, pass `Math.min(damage, BOSS.maxHitFrac * z.maxHp)`.
   - The Thundergun (`thunderBoss`), Nuke and Insta-Kill paths are not capped.
   - **Why:** 1,000 per Ray Gun hit kills the boss in 7–11 s at any round. Capped, the Ray Gun takes 29 s, still the fastest option. No wall gun is affected: the largest per-shot hit, the Drakon's 220, is below 3 % of any boss from R6 on (4,500 × 1.72 × 0.03 = 232).
   - **Resolution (FIX-2):** implemented centrally in `zombie.damageZombie` (not in `weapons.js`, which FIX-2 does not own): every hit on the boss is capped at `BOSS.maxHitFrac × maxHp` (0.03), after the Insta-Kill ×2. Exempt fractional effects: cause `'nuke'` and the Thundergun near share (amount exactly `thunderNearFrac × maxHp`, or Infinity). Ray Gun splash is also capped per hit. Measured: Ray Gun + KN-44 R10 **34.4 s** (23–36).

9. **[BAL] `src/config.js` `BOSS.thunderNearFrac: 0.15 → 0.08`.**
   - **Why:** 7 near-cone blasts (one full magazine plus 3) kill the boss in about 20 s. At 8 % it takes about 37 s, and the Thundergun stays the best crowd-control option against minions.
   - **(test)** `tests/weapons.test.js:601` assumes `4000 × frac ≥ 500` kills. At 0.08 that is 320: raise the test boss to `maxHp 8000` or lower its hp to 300. `:566-568` read the constant and stay valid.
   - **Resolution (FIX-2):** `BOSS.thunderNearFrac: 0.08`. `tests/weapons.test.js` was already adjusted (fallback test derives the lethal hp from the constant). Measured: Thundergun + KN-44 R10 **38.0 s** (35–52).

10. **[BAL, level 2] `src/weapons.js` `ammoCost(id)`: tier-2 guns (`def.tier === 2`) use `PRICES.wallAmmoMultTier2` (new, `0.3`) instead of `wallAmmoMult` 0.5.**
    - New ammo prices: XR-2 68, Weevil 60, Marshal 16 68, Man-O-War 75, 48 Dredge 83, Gorgon 90, Haymaker 12 75, Drakon 90.
    - **Why:** level-2 health is 1.5× but a kill still pays 10, so at 0.5 × cost every level-2 gun loses 36–340 points per round at 80 % accuracy. At 0.3 the net is +115 to +178 per round, the same as level 1's +116 to +154, and doors plus the mega door become affordable in about 3–4 level-2 rounds.
    - **(test)** `tests/weapons.test.js:490` (`ammoCost(id) === round(cost × 0.5)` for the new guns).
    - **Resolution (FIX-4):** done in `ammoCost` (`tier === 2` -> `PRICES.wallAmmoMultTier2` if defined, else 0.3; tier 1 keeps 0.5). Ammo prices as listed above; test updated and a new test pins them.

11. **[BAL] Full heal at fight start: `src/boss.js` `startFight`, set `state.player.health = state.player.maxHealth` before `boss:start`.**
    - **Why:** regen at 1 HP/s (WO3) adds only 10–40 HP per fight, and entry health halves the level-1 win rate (15/16 → 8/16 from 75 HP). Health carries over from the rounds.
    - Alternative: boss-only regen of 3 HP/s while `state.boss.phase === 'active'` (14/16).
    - **Resolution (FIX-2):** `boss.startFight` sets `player.health = player.maxHealth` (unless downed) before the first wave and `boss:start`. Test added. Mortal bot entering at 60 HP: 10/12 won at R10 (same as full).

12. **[minor] `src/weapons.js` `dredge48.damage: 70 → 85`.**
    - **Why:** at 275 points it matches the 150-point KN-44's per-shot damage and adds only 9 % sustained DPS (481). At 85 it gets 583 DPS and 19 shots at L2 R10, level with the XR-2 but with a 48-round magazine.
    - **Resolution (FIX-4):** damage 70 -> 85 and rpm 850 -> 900 as part of the full tier-2 retune (playtest #2); XR-2 toned down (85/900 -> 80/800) so the Dredge now out-kills it. See `docs/notes/weapons.md` WO5 FIX-4.

13. **[optional] `src/boss.js` summon count: `BOSS.minionsPerWave + levelIndex(state)` → `BOSS.minionsPerWave + Math.min(levelIndex(state), BOSS.minionsLevelCap ?? Infinity)`, with `minionsLevelCap: 2`.**
    - **Why:** from level 4, 7–8 minions per wave make the fight mostly minion clearing (69 minions per L4 fight). Health and count still rise every level through recommendations 1–2.
    - **Resolution (FIX-2):** `BOSS.minionsLevelCap: 2`, `boss.minionsPerWaveFor(state)` used at fight start and on each summon. Test: level index 0..6 → 4, 5, 6, 6, 6.

14. **[info, no change]**
    - **Charge:** the 0.6 s telegraph and 3.5× dash are fairly dodgeable.
    - **Mega door price** 250 and door costs 550 are fine on level 1: the boss lands at R8–11. With recommendation 10 they are fine on level 2 too.
    - **sprintShift** is inert past R12, where the tier table maxes out. Keep it for the level-2 early rounds.
    - **Minions** at 195 × 1.1 × (1 ± 0.1) = 193–236 px/s already outrun a walking player on level 1. That is the spec's intent ("fast"), and their health is the counterweight. Recommendation 3 deliberately does not clamp them.

**Minimum set for "difficulty increases every level": 1 and 2 (3 recommended alongside).** Recommendations 4–6 and 10 keep each harder level beatable: without them the level-2 economy loses points and deep-level bosses cannot be killed for lack of ammo.
