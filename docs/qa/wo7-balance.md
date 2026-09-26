# QA-3 (WO7): balance for perks, the knife, level 3 and the loop

This is a Phase 3 report only. Nothing under `src/` or `tests/` was changed.

**Scope:** WORK_ORDER_7.md 1.2, 1.3, 1.5, 3.1 and 4 (Phase 3, balance), on top of `docs/notes/integration-wo7.md` and `docs/qa/wo5-balance.md`.

## Method

All harnesses are headless Node scripts in the session scratchpad `qa3/wo7/`, not in the repo. They import the real `src/` modules and run `main.js`'s `update()` order at dt = 1/60. `boss.updateHazards` now runs after `zombie.updateZombies`, as in the integrated `main.js`.

| File | What it does |
|---|---|
| `h.mjs` | The WO5 harness, plus `updateHazards` and the `melee` input |
| `econ7.mjs` | WO5 progression bot, plus perk buying through `shop.buyPerk` in a set order, and knife modes: knife-only for rounds ≤ N, and a finisher that knifes a zombie at ≤ 150 HP inside reach |
| `fight7.mjs` | WO5 arena bot, plus perks, acid avoidance (steers off pools and off the landing markers of globs older than 0.2 s, never toward the boss) and knife-the-boss mode |
| `work.mjs` | Round workload: god mode, all doors open, fixed gun and perks. Ammo is auto-refilled at 35 % and every refill is charged at `ammoCost` |
| `tables.mjs`, `ttkcheck.mjs` | Closed-form HP, income, DPS, TTK, boss-cap and ammo tables |
| `variant.mjs` | In-memory variants: `dtdmg=`, `bossNoDt` (Double Tap gives the boss no extra damage, only the extra fire rate), `acid=`, and per-gun def overrides |

**Result terms:**
- **"god"** means infinite HP, but hits are still counted.
- **"mortal"** means real HP and the real 1 HP/s regen.
- Each cell is 6–16 seeds.

**Bot caveat (as in WO5).** The arena bot is competent. The open-map bot is not: it spends a lot on ammo and dies around R5 when mortal. So open-map results come from god mode, and the bot's round numbers are a pessimistic bound for a human.

## Summary

- **Perk economy on level 1 is fine.** A competent, frugal player can afford Quick Revive, Juggernog, Double Tap and Speed Cola *and* doors (550) + mega door (250) by the end of **R10**. Without perks they get there at R8.
  - The bot takes **R11** with no perks, **R13** buying Double Tap first and **R16** buying Juggernog first (it saves for the perk before the next door).
  - **The 4-perk cap is reached before the boss** in 8–9 of 10 bot runs.
- **Double Tap II is by far the best value per point, and it trivialises bosses:**

  | Double Tap effect | Level 1 | Level 2 | Level 3 |
  |---|---|---|---|
  | Round time | −42 % | −42 % | −40 % |
  | Ammo spend | −47 % | −48 % | −32 % |
  | Boss TTK | 46 → 18 s | 45 → 15 s | 35 → 16 s |
  | Boss TTK with Speed Cola too | 12 s | 10 s | 10 s |

  Against the WO5 target of 40–50 s, the 3 % per-hit boss cap never applies to a Double-Tapped automatic: KN-44 140 < 297, Man-O-War 280 < 494, Peacekeeper 370 < 659. It only limits Drakon and Locus.
- **Speed Cola** is a solid +30 % sustained DPS (round −23 %, boss −26 %). **Stamin-Up** has no measurable combat effect: walk 235 against the zombie cap of 214. **Mule Kick** is utility.
- **Juggernog** turns 3 zombie hits into 5, and 2 boss hits into 4.
  - Level-3 boss survival goes from 56–81 % to 88–100 %; level 1 from 88 % to 100 %.
  - Regen stays at 1 HP/s, so one zombie hit still takes 54 s to heal. Juggernog is a buffer, not sustain.
- **Quick Revive (50)** is the cheapest survival in the game.
  - It is one extra life: level-3 boss survival 56 % → 100 % (4 revives in 16 fights), level 2 75 % → 88 %.
  - The penalty is real: losing every perk costs about 750 points, roughly one level-3 round of income.
  - The price is BO3-faithful (500 ÷ 10). An escalating price for the 2nd and 3rd use is optional.
- **The knife is a rounds 1–3 tool, and it cannot be abused for points.**

  | Bot result (mortal) | Knife-only | Gun |
  |---|---|---|
  | Points by end of R3 | 404 | 278 |
  | R1–3 time | 52 s | 61 s |
  | Damage taken | 67 | 21 |
  | Deaths | 1 of 12 | 0 of 12 |

  - Knife-only through R5 kills the bot in 10 of 12 runs.
  - `perHit` is 0, so the most the knife can add is +5 per kill. The finisher bot got 0.6 knife kills per 27 zombies.
  - Knifing the boss is slower (62 s against 46 s) and fatal (15 of 16 mortal runs died). There is no cheese.
- **Level 3 economy depends on the gun.**
  - Peacekeeper (+414 per round) and even the tier-2 Gorgon (+444) pay.
  - **HG 40 loses 382 points per round** (292 s rounds) and M8A7 barely breaks even (+26, 186 s). Both are worse than the 300-point Gorgon in a horde, because single-target TTK ignores penetration.
  - Fix: HG 40 penetration 2 and damage 130; M8A7 penetration 3 (recommendations 2–3).
- **THE SUBJECT is fair.**
  - Acid does 20–60 HP per fight (about 1 HP/s on average). The real threats are boss melee (75) and minions.
  - Survival is 56–81 % with 150 HP and 88–100 % with Juggernog: lower than level 2 (75 %) and level 1 (88 %), as it should be.
  - Raising acid to 40 dps changed nothing (14 of 16 with Juggernog). Keep 25.
- **The loop to levels 4–5 is strictly harder**: health 2.0 → 2.4 → 2.88, count 1.5 → 1.65 → 1.82, sprintShift 5 → 7 → 9, boss 21,960 → 26,352 HP. But it is a cliff:
  - Speed is frozen at 1.2, because `speedMultCap` 1.15 is below level 3's own 1.2.
  - BUNKER II walls sell only tier-1 guns, so tier-3 ammo cannot be bought on level 4.

    | Level 4, R21 | Round time | Net per round |
    |---|---|---|
    | Peacekeeper + Double Tap, no refills | 364 s | +124 |
    | Same, with refills | 145 s | +610 |
    | KN-44 + Double Tap | 703 s | −1,243 |
    | Peacekeeper, no Double Tap, no refills | 1,300 s | −4,166 |

## 1. Perk economy on level 1

### 1a. Where the machines are

Found by BFS from the start room through doors.

| Level | Quick Revive | Juggernog | Speed Cola | Double Tap II | Stamin-Up | Mule Kick |
|---|---|---|---|---|---|---|
| L1 BUNKER | start | D (75) | E (100) | D+F (175) | E+G (225) | E+G+H (375) |
| L2 CATACOMBS | start | E (100) | D (75) | D+F (175) | E+G (225) | E+G+H (375) |
| L3 LABORATORY | start | D+E (175) | D (75) | D+F (175) | D+F+G (300) | D+F+G+H (450) |

Doors are D 75, E 100, F 100, G 125 and H 150 (550 in total) on every level, plus the mega door at 250.

### 1b. Closed-form budget for a competent, frugal player

Cumulative kill income on level 1 is 60 / 140 / 270 / 450 / 690 / 960 / 1,240 / 1,520 / 1,810 / 2,100 at the end of R1–R10.

| Step | Buy | Cumulative spend | Affordable at |
|---|---|---|---|
| 1 | Sheiva 50 + Quick Revive 50 | 100 | R2 |
| 2 | Door D 75 + Juggernog 250 | 425 | R4–5 |
| 3 | Doors E + G 225 + KN-44 150 | 800 | R6 |
| 4 | Door F 100 + Double Tap 200 + ammo 75 | 1,175 | R7 |
| 5 | Speed Cola 300 + ammo 75 | 1,550 | end of R8 / R9 |
| 6 | Door H 150 + mega 250 + ammo 150 | 2,100 | **end of R10** |

Without perks the same path costs about 1,300 (mega door around R8–9). **Four perks move the boss about 2 rounds later for a good player.** That is still inside WO5's R8–12 window.

### 1c. Bot results (god mode, 10 seeds, stops at the mega door)

| Policy | Mega-door round (median, range) | Perks held at the mega door | Round each perk was bought (median) |
|---|---|---|---|
| No perks | 11 (9–17) | — | — |
| Double Tap first (Q, N, J, C) | 13 (11–15) | 4 in 8/10, 3 in 2/10 | Q 2, N 6, J 11, C 13 |
| Juggernog first (Q, J, N, C) | 16 (11–20) | 4 in 9/10 | Q 2, J 11, N 12, C 14 |

The bot spends 450–2,990 points on ammo before the mega door (a human spends far less). Double Tap first cuts ammo spend per round, so it reaches the boss 3 rounds sooner than Juggernog first.

### 1d. Value per point

| Perk | Cost | Measured effect | Per 100 points |
|---|---|---|---|
| Double Tap II | 200 | L1 R10 KN-44: round 81 → 47 s, ammo 188 → 100 per round. Boss 46 → 18 s | −21 % round time |
| Speed Cola | 300 | Round 81 → 62 s, ammo 188 → 163. Boss 46 → 34 s | −8 % round time |
| Juggernog | 250 | +100 HP. L3 boss survival 56–81 % → 88–100 % | +40 HP |
| Quick Revive | 50 | +1 life (3 purchases). L3 boss survival 56 % → 100 % | +2 lives |
| Stamin-Up | 200 | Walk 220 → 235, sprint 297 → 381. Arena survival unchanged (L1 15/16, L3 9/16) | ≈ 0 in combat |
| Mule Kick | 400 | Third gun (ammo depth, a wonder weapon kept as a spare) | utility |

Double Tap + Speed Cola multiply sustained DPS by 3.1 (KN-44 440 → 1,385; Peacekeeper 1,095 → 3,434).

## 2. Juggernog, regen and Quick Revive

### 2a. Hits to go down and regen

| Max HP | Zombie hits (50) | Boss hits (75) | Minion hits (25) | Seconds in acid (25 dps) | One zombie hit healed | Full heal from 1 HP |
|---|---|---|---|---|---|---|
| 150 (base) | 3 | 2 | 6 | 6 s | 54 s | 150 s |
| 250 (Juggernog) | 5 | 4 | 10 | 10 s | 54 s | 250 s |

- Regen barely matters in fights: 5–12 HP per boss fight. Every acid tick resets the 4 s delay.
- Health really comes back only four ways: arriving on a level, the start of a boss fight, buying Juggernog, and a Quick Revive.
- So Juggernog is pure buffer. That is BO3-faithful and fine, because a boss fight starts at full health.

### 2b. Boss fights, mortal (16 seeds each)

| Fight | No perks | Juggernog | Quick Revive | Juggernog + Double Tap + Speed Cola |
|---|---|---|---|---|
| L1 R10, KN-44 + Argus | 14/16 survive, 46 s | 16/16, 46 s | 16/16 (3 revives) | 16/16, 12 s |
| L2 R14, Man-O-War + KN-44 | 12/16, 46 s | 14/16, 43 s | 14/16 (7 revives) | 16/16, 10 s |
| L3 R18, Peacekeeper + Gorgon | 9–13/16, 35–38 s | 14–16/16, 35–42 s | 16/16 (4 revives) | 16/16, 11 s |

### 2c. Quick Revive at 50

- **It is strong:** a guaranteed extra life for 5 kills, and three of them per game.
- **It is not free:**
  - It holds one of the 4 perk slots while you have it.
  - A revive strips every perk. Rebuying Juggernog, Double Tap and Speed Cola is 750 points plus the walk to each machine, often mid-round.
  - After a revive you have 150 HP and no perks, which is why 2 of 16 level-2 runs still died.
- **Verdict:** keep the BO3 price for the first purchase. Recommendation 6 (optional) raises only the 2nd and 3rd purchases, so three lives are not the default for 150 points.

## 3. Double Tap II and Speed Cola

### 3a. Sustained DPS (burst), including reloads

| Gun | None | Speed Cola | Double Tap | Double Tap + Speed Cola |
|---|---|---|---|---|
| KN-44 | 440 (817) | 572 | 1,016 (2,172) | 1,385 |
| Man-O-War | 638 (1,213) | 836 | 1,468 (3,227) | 2,018 |
| Gorgon | 840 (1,400) | 1,050 | 1,974 (3,724) | 2,580 |
| HG 40 | 980 (1,600) | 1,215 | 2,310 (4,256) | 2,995 |
| M8A7 | 961 (1,820) | 1,258 | 2,212 (4,841) | 3,036 |
| Peacekeeper | 1,095 (2,004) | 1,416 | 2,533 (5,331) | 3,434 |

Double Tap multiplies sustained DPS by 2.3; Speed Cola by 1.25–1.36.

### 3b. Rounds, god mode (6 seeds × 2 rounds)

| Case | Seconds per round | Ammo per round | Net per round |
|---|---|---|---|
| L1 R10–11 KN-44, no perks | 81 | 188 | +119 |
| L1 KN-44 + Speed Cola | 62 | 163 | +151 |
| L1 KN-44 + Double Tap | 47 | 100 | +210 |
| L1 KN-44 + Double Tap + Speed Cola | 47 | 88 | +224 |
| L2 R13–14 Man-O-War, no perks | 97 | 194 | +303 |
| L2 Man-O-War + Double Tap | 56 | 100 | +380 |
| L2 KN-44, no perks | 195 | 513 | −13 |
| L2 KN-44 + Double Tap | 98 | 275 | +219 |

Double Tap does not remove the level ordering; with equal perks each level is still slower than the one before. But a Double-Tapped level-1 gun on level 2 (98 s) plays like a tier-2 gun (97 s), and level 2 with Double Tap (56 s) is faster than level 1 without perks (81 s). That is acceptable for a perk: rounds get faster, not trivial.

### 3c. Bosses (god mode, 12 seeds, median TTK)

| Fight | None | Speed Cola | Double Tap | Double Tap + Speed Cola | Double Tap, **boss excluded from ×2** (rec. 1) | Same + Speed Cola (rec. 1) | Double Tap damage ×1.5 everywhere |
|---|---|---|---|---|---|---|---|
| L1 R10 KN-44 + Argus | 46 s | 34 s | **18 s** | **12 s** | 33 s | 26 s | 22 s |
| L2 R14 Man-O-War + KN-44 | 45 s | — | **15 s** | 10 s* | 33 s | 22 s* | 23 s |
| L3 R18 Peacekeeper + Gorgon | 35 s | — | **16 s** | **10 s** | 29 s | 20 s | 17 s |

\* Mortal, with Juggernog.

- Boss cap at 3 %: L1 R10 297, L2 R14 494, L3 R18 659.
- Double-Tapped per-hit damage: KN-44 140, Man-O-War 280, Gorgon 350, Peacekeeper 370, HG 40 240, M8A7 280. All are under the cap on their own level.
- The cap bites only for Drakon (760), Locus (800), and a boxed Peacekeeper on level 1 (370 > 297).
- **Conclusion:** Double Tap halves every boss fight, and with Speed Cola a 45 s fight becomes 10–12 s.
  - Recommendation 1 keeps the ×1.33 fire rate on the boss but drops the ×2 damage there.
  - Minions and normal zombies still take ×2.
  - Result: boss fights about 27 % shorter with Double Tap (like Speed Cola) and about 45 % shorter with both.
  - A global ×1.5 would weaken the perk everywhere and still gives 17–23 s boss fights.

## 4. Knife

### 4a. Knife hits to kill (150 damage)

| Level | R1 | R2 | R3 | R4 | R5 | R6 | R8 | R10 |
|---|---|---|---|---|---|---|---|---|
| L1 | 1 | 2 | 3 | 3 | 4 | 5 | 6 | 7 |
| L2 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 11 |
| L3 | 2 | 4 | 5 | 6 | 8 | 9 | 12 | 14 |

Level 3 is never started before about R15, so only the level-1 row matters.

### 4b. Geometry

- **Reach:**
  - The knife reaches 44 px edge to edge, which is 72 px centre to centre.
  - A zombie hits at 34 + 14 = 48 px centre to centre, so the knife outranges it by 24 px.
  - Against the boss it is 92 px against the boss's 68.
- **Knockback:** each hit pushes 11.7 px and stuns for 0.25 s.
  - A walker (70 px/s) standing at knife range can never reach its own range between 0.5 s swings.
  - A jogger (130 px/s) can.
- **DPS:** 300 on one target (up to 3 targets), against the MR6's 143 sustained. The knife beats the starting pistol in R1–3, as in BO3.

### 4c. Bot results (level 1, 12 seeds)

| Mode | Rounds | Deaths | Points earned | Knife kills | Damage taken | Round time |
|---|---|---|---|---|---|---|
| MR6 only, mortal | R1–3 | 0 | 278 | 0 | 21 | 61 s |
| Knife only, mortal | R1–3 | 1 | **404 (+45 %)** | 27 | 67 | 52 s |
| Gun + knife finisher (≤ 150 HP in reach) | R1–3 | 0 | 281 | 0.6 | 4 | 62 s |
| Knife only, mortal | R1–5 | **10** | 681 | 43 | 183 | — |
| Knife on the boss (L1 R10), god | — | — | — | — | 456 | 62 s (gun: 46 s) |
| Knife on the boss, mortal | — | 15/16 | — | — | 206 | — |

- **Farming risk is bounded.** `POINTS.perHit` is 0, so there is no per-hit income. Each kill pays at most 15 (30 with Double Points), and board income is capped.
- The best case is knifing every kill in R1–3: about +135 points over 27 zombies, one early Quick Revive plus change.
- Past R3 knifing needs 3+ swings per zombie in crowds of joggers, and the bot dies.
- Knifing the boss (150 per hit, under the cap on every level) is slower than any gun and fatal against the charge and minions. The knife never runs dry in the sealed arena, which is a useful fallback, not an exploit.
- **No change recommended.**

## 5. Level 3

### 5a. Reaching and funding level 3

Level 3 arrives around R15–17 (level-1 boss R10–11, level-2 boss R14–15).

| Round | Income per round at L3 |
|---|---|
| R16 | 680 (68 kills) |
| R18 | 780 |
| R20 | 890 |

- Tier-3 guns cost 350–400 and their ammo 105–120, so every tier-3 gun is affordable within one round.
- Zombie HP on level 3 is 3,702 at R16, 4,480 at R18 and 5,420 at R20. That is 21–30 Peacekeeper shots, or 11–15 with Double Tap.

### 5b. Workload, L3 R17–18 (god mode, 6 seeds × 2 rounds, refills charged)

| Gun (price) | Perks | Seconds per round | Ammo per round | Net per round |
|---|---|---|---|---|
| ICR-1 (start, tier 1) | — | 551 | 1,569 | −755 |
| XR-2 (225, tier 2) | — | 495 | 1,213 | −441 |
| Man-O-War (250, tier 2) | — | 247 | 581 | +230 |
| Gorgon (300, tier 2) | — | 168 | 383 | +444 |
| **HG 40 (350)** | — | **292** | 1,164 | **−382** |
| **M8A7 (375)** | — | **186** | 763 | **+26** |
| Peacekeeper (400) | — | 129 | 410 | +414 |
| HG 40 | Double Tap | 132 | 578 | +205 |
| M8A7 | Double Tap | 88 | 358 | +461 |
| Peacekeeper | Double Tap | 77 | 280 | +563 |
| Peacekeeper | Double Tap + Speed Cola | 69 | 260 | +520 |
| Gorgon | Double Tap | 85 | 195 | +583 |
| Peacekeeper, R20–21 | — / Double Tap | 225 / 108 | 780 / 405 | +145 / +518 |

**Proposed variants** (same harness):

| Variant | Seconds per round | Net per round | Double Tap: seconds / net | Single-target L3 mean TTK (test metric) |
|---|---|---|---|---|
| HG 40 penetration 2 | 195 | −3 | — | 1.157 |
| **HG 40 penetration 2 + damage 130** | **183** | **+130** | 86 / +535 | 1.061 |
| HG 40 penetration 2 + damage 140 | 158 | +187 | 76 / +500 | 0.986 (breaks M8A7 < HG 40) |
| HG 40 damage 150 or 165, penetration 1 | 247 / 220 | −185 / −98 | — | — |
| **M8A7 penetration 3** | **157** | **+179** | 77 / +484 | 1.011 (unchanged) |
| M8A7 penetration 3 + damage 150 | 143 | +192 | 72 / +496 | 0.923 (ties Peacekeeper, breaks the test) |
| M8A7 damage 160 or 170 | 161 / 156 | +145 / +190 | — | — |

With recommendations 2–3 the horde order matches price: HG 40 (183 s) > M8A7 (157 s) > Peacekeeper (129 s). All three then beat the Gorgon (168 s) or are close to it. Single-target mean TTK keeps the tested order: Peacekeeper 0.923 < M8A7 1.011 < HG 40 1.061, and every tier-2 gun is ≥ 1.286.

### 5c. THE SUBJECT

Boss HP at R18 is 21,960, the cap is 659 and minions have 600 HP.

| Case | Survival | TTK | Damage per fight: boss / minion / acid | Acid spits |
|---|---|---|---|---|
| God, dodging acid | — | 35 s | 75 / 31 / 27 | 4.7 |
| God, ignoring acid | — | 36 s | 25 / 13 / 66 | 4.8 |
| Mortal 150 HP, dodge (reaction 0.2 / 0.4 s) | 9/16 – 13/16 | 35–38 s | 33–75 / 9–13 / 21–25 | 4–5 |
| Mortal 150 HP, ignoring acid | 10/16 | 35 s | 38 / 23 / 43 | 4.3 |
| Mortal, Juggernog, dodge | 14/16 | 42 s | 66 / 17 / 27 | 5.1 |
| Mortal, Juggernog, ignoring acid | 16/16 | 35 s | 28 / 11 / 62 | 4.8 |
| Mortal, Juggernog, **acid 40 dps** | 14/16 | 42 s | 66 / 17 / 43 | 5.1 |
| Mortal, Quick Revive | 16/16 (4 revives) | 35 s | 56 / 20 / 41 | 4.9 |
| Mortal, Juggernog + Double Tap + Speed Cola | 16/16 | 11 s | 23 / 0 / 5 | 1.2 |
| HG 40 + Man-O-War, god | — | 44 s | 244 / 48 / 52 | 6.3 |

**Fairness:**
- The telegraph (0.5 s) plus flight (0.8 s) with a drawn landing marker gives 1.3 s of warning. Clearing a 50 px pool takes under 0.3 s at 220 px/s.
- Three pools cover about 9 % of the arena for 5 of every 6.5 s.
- Even a player who ignores acid takes only 43–66 HP per fight, so it is area denial, not a DPS race.
- Juggernog's 250 HP means 10 s standing in a pool.
- Acid does stop regen (each tick resets the 4 s delay), but regen was only worth 5–12 HP per fight anyway.
- **Keep the acid values.**
- With the expected loadout, the level-3 boss dies faster than levels 1 and 2 (35 s against 45–46 s), but it is the deadliest fight (56–81 % survival). No change.

## 6. Loop to levels 4–5

| Level | healthMult | speedMult | countMult | sprintShift | Zombie HP R20 | Zombies R20 | Boss HP (R ≥ 12) | Minion HP |
|---|---|---|---|---|---|---|---|---|
| L3 LABORATORY | 2.0 | 1.2 | 1.5 | 5 | 5,420 | 89 | 21,960 | 600 |
| L4 BUNKER II | 2.4 | **1.2** | 1.65 | 7 | 6,504 | 98 | 26,352 | 720 |
| L5 CATACOMBS II | 2.88 | **1.2** | 1.815 | 9 | 7,805 | 108 | 31,622 | 864 |

- **Health, count, sprintShift, boss and minion HP all rise strictly. Speed does not:**
  - `levelDifficulty` computes `max(last 1.2, min(cap 1.15, 1.2 × 1.03^k))`, which is 1.2 forever.
  - The WO5 cap of 1.15 now sits below level 3's own base.
  - Sprinters are capped at `ZOMBIE.maxSpeed` 214 anyway, so raising the cap only speeds up walkers and joggers (recommendation 5).
- **Level-4 gun cliff.** Walls on BUNKER II sell only tier-1 guns, and `buyAmmo` only works from a wall selling that gun.

  | Case | Seconds per round | Net per round |
  |---|---|---|
  | L3 R20 Peacekeeper + Double Tap (refills) | 108 | +518 |
  | L4 R21 Peacekeeper + Double Tap, refills allowed (hypothetical) | 145 | +610 |
  | **L4 R21 Peacekeeper + Double Tap, no Peacekeeper refills (KN-44 backup refilled)** | **364** | **+124** |
  | L4 R21 Peacekeeper, no Double Tap, no refills | 1,300 | −4,166 |
  | L4 R21 KN-44 + Double Tap | 703 | −1,243 |
  | L5 R24 Peacekeeper + Double Tap (refills) | 282 | +358 |

  - Max Ammo is 0.375 % per kill, so about 0.4 per level-4 round.
  - The box gives a tier-3 gun on only about 9 % of spins (6/66 weight).
  - Without recommendation 4, level 4 is a wall rather than a step: 3.4× the round time even with Double Tap. With it, the steps are 108 → 145 → 282 s: harder every level, still playable.

## 7. Recommended changes

1. **[BAL, required] Double Tap does not double damage against the boss.**
   - **What:** `src/config.js` `BOSS`, add `dtapDamageMult: 1`. In `src/weapons.js`:
     - Give `hitscan(state, ox, oy, dx, dy, range, penetration, damage)` a 9th parameter `bossDamage = damage`, and pass `z.kind === 'boss' ? bossDamage : damage` to `deps.damageZombie`.
     - In `tryFire`, pass `d.damage * Math.min(mods.bulletDamageMult, Number.isFinite(BOSS.dtapDamageMult) ? BOSS.dtapDamageMult : Infinity)` as `bossDamage`.
     - The ×1.33 fire rate still applies to the boss, and minions still take ×2.
   - **Why:** boss TTK with Double Tap goes 18/15/16 s → 33/33/29 s. With Speed Cola too, 12/10/10 s → 26/22/20 s. The WO5 target is 40–50 s, and the 3 % cap never applies to Double-Tapped automatics.
   - **Test:** add a unit test (owner of `tests/weapons.test.js`).
   - **Resolution (FIX-5):** applied as specified (`BOSS.dtapDamageMult: 1`, `hitscan` 9th param `bossDamage`, per-target in `tryFire`); unit test added. Measured (f1.mjs, god, median): L1 R10 33 s, L2 R14 33 s, L3 R18 27 s (24 seeds; no-perk baseline 36 s); with Speed Cola L1 26 s, L3 20 s.
2. **[BAL, required] `src/weapons.js` `hg40`: `damage: 120 → 130`, `penetration: 1 (default) → 2`.**
   - **Why:** at L3 R17 it goes from 292 s / −382 per round to 183 s / +130. Today the 350-point tier-3 gun loses points and is beaten by the 250-point Man-O-War.
   - **Test:** `tests/weapons.test.js` line 725 pins `penetration: 1` for `hg40` and must become 2. The TTK test still passes: mean 1.061 > M8A7 1.011 > Peacekeeper 0.923.
   - **Resolution (FIX-5):** applied (`damage: 130`, `penetration: 2`); pins updated, tier-3 TTK ordering test green.
3. **[BAL, required] `src/weapons.js` `m8a7`: `penetration: 2 → 3`.**
   - **Why:** 186 s / +26 → 157 s / +179. It then beats the 300-point Gorgon (168 s) and sits between HG 40 and Peacekeeper. Single-target TTK is unchanged.
   - **Test:** `tests/weapons.test.js` line 726 pins `penetration: 2` and must become 3.
   - Do not also raise damage to 150: that ties Peacekeeper's mean TTK and breaks the "price tracks power" assert.
   - **Resolution (FIX-5):** applied (`penetration: 3`, damage kept 140); pins updated.
4. **[BAL, required] Loop levels sell top-tier wall guns.**
   - **Config:** in `src/config.js` `LEVELS_CFG`, add:
     ```js
     loopWallUpgrade: { rk5: 'hg40', lcar9: 'hg40', vmp: 'hg40', kuda: 'hg40', weevil: 'hg40',
       sheiva: 'm8a7', hvk30: 'm8a7', icr1: 'm8a7', xr2: 'm8a7', manowar: 'm8a7',
       kn44: 'peacekeeper', krm262: 'haymaker12', argus: 'haymaker12', marshal16: 'haymaker12',
       dredge48: 'gorgon' }
     ```
   - **Code:** in `src/level.js` `levelDefFor`, when `loop >= 1`, build the derived def with `wallbuys: Object.fromEntries(Object.entries(base.wallbuys || {}).map(([k, id]) => [k, (LEVELS_CFG.loopWallUpgrade || {})[id] || id]))`.
   - **Why:** L4 R21 with a Peacekeeper and Double Tap is 364 s per round without refills, against 145 s with them. Without Double Tap it is 1,300 s and −4,166 per round. Level 4 is otherwise a cliff because tier-3 ammo cannot be bought.
   - **Tests:** check that `tests/level.test.js` / `levels.test.js` do not pin loop wall buys. Also check that the map accepts the same gun on two walls (level 1 has several SMG walls).
   - **Resolution (FIX-3):** implemented with the WO order's mapping instead: level-1 layout `sheiva→m8a7, kn44→peacekeeper, kuda→hg40, lcar9→weevil, rk5→xr2, krm262→marshal16, argus→haymaker12, hvk30→manowar, icr1→gorgon, bootlegger→dredge48`; level-2 layout `weevil→hg40, xr2→m8a7, manowar→peacekeeper` (shotguns, LMGs and Drakon keep their gun). One step, not chained. `vmp`, `vesper` and `pharo` are unmapped. `level.loopWallbuys()` builds a new `wallbuys` object in the memoized loop def, keeping the letters. Level 4 sells M8A7, Peacekeeper and HG 40 walls, and their ammo at the tier-3 price. Duplicate guns on two walls load fine: the level-3 loop has two M8A7 walls. Tests in `tests/level.test.js`, including the real `map.loadMap`. No existing test pinned loop wall buys.
5. **[minor] `src/config.js` `LEVELS_CFG.loop.speedMultCap: 1.15 → 1.3`.**
   - **Why:** the cap sits below level 3's base of 1.2, so loop speed is frozen at 1.2. With 1.3 it goes L4 1.236, L5 1.273, L6+ 1.3, and sprinters stay capped at 214 by `ZOMBIE.maxSpeed`.
   - **Also:** update the comment ("speed ×1.03 up to speedMultCap"). `tests/level.test.js` line 83 already accepts it.
   - **Resolution (FIX-3):** applied (`speedMultCap: 1.3`, comment updated). The test pins 1.3 and speed rising at L4 and L5.
6. **[optional, design call] Escalating Quick Revive price.**
   - **Config:** `src/config.js` `PERKS.list.revive`, add `costSteps: [50, 150, 300]`.
   - **Code:** in `src/shop.js` `buyPerk` and `perkPrompt`, cost for `revive` = `costSteps[Math.min(player.reviveUses, costSteps.length - 1)]` (fallback `def.cost`).
   - **Why:** 50 points is one extra life (L3 boss survival 56 % → 100 %). The first purchase stays BO3-cheap; the 2nd and 3rd cost about 20–40 % of a mid-game round.
   - Skip this if strict BO3 prices matter more. The loss of every perk on revive already costs about 750.
   - **Resolution (FIX-3):** applied as `PERKS.list.revive.costs: [50, 150, 300]` (the WO order's name; `cost: 50` kept as the first price). New `shop.perkCost(player, perkId)` is indexed by `player.reviveUses` and clamped. `perkPrompt`, `buyPerk`, `purchase:made` / `perk:bought` / `purchase:denied` all use it. `syncPerkMachines` also sets `machine.price`, bumping `map.version` when it changes. Render's machine plate still reads `def.cost` (50): the render owner should switch it to `m.price`. Tests in `tests/shop.test.js`.
7. **[info, no change] Perk prices.** Keep the BO3 ÷ 10 prices. With recommendation 1, Double Tap is still the best value (−42 % round time for 200) without deleting boss fights. A competent player gets 4 perks plus the mega door by R10, and the bot reaches the cap before the boss in 8–9 of 10 runs.
8. **[info, no change] Knife.** `MELEE` as is. It rewards R1–3 (+45 % points, bounded at +5 per kill), is fatal past R3 and in the boss arena, and there is no per-hit farming.
9. **[info, no change] Juggernog and regen.** Juggernog is a pure buffer: 3 → 5 hits, 10 s in acid, L3 boss survival 56–81 % → 88–100 %. Regen at 1 HP/s is irrelevant in fights; the full heals on arrival and at boss start carry survivability.
10. **[info, no change] `BOSS.acid`.** Keep `dps: 25`, `every: 6`, `globs: 3`, `poolRadius: 50`, `poolSeconds: 5`. It adds 20–60 HP per fight, is easy to read, and 40 dps changed nothing measurable.
11. **[info] The level-1 mystery box can roll tier-3 guns** (about 9 % per spin, boxOnly weight 2). A boxed Peacekeeper on level 1 is very strong, but it cannot be refilled there. This is consistent with the WO5 tier-2 handling, so no change.
