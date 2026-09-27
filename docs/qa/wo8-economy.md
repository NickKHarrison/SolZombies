# QA-G (WO8): economy pass and Pack-a-Punch pricing

This is a Phase 1 research report (Agent G). Nothing under `src/` or `tests/` was changed.

**Scope:** WORK_ORDER_8.md 1.3, with 1.1–1.2 (Pack-a-Punch), on top of `docs/qa/wo7-balance.md`, `docs/qa/wo5-balance.md` and `docs/notes/integration-wo7.md`.

## Method

All harnesses are headless Node scripts in the session scratchpad `qa3/wo8/`, not in the repo. They extend the WO5/WO7 harnesses (`qa3/wo5`, `qa3/wo7`) and run `main.js`'s `update()` order at dt = 1/60 on the real modules. **No debug points were used anywhere**: every point came from kills, boards, power-ups, minions and the boss.

| File | What it does |
|---|---|
| `h8.mjs` | The WO7 harness, pointed at `src_snap/`: a copy of `src/` taken during Phase 1. At that time `render.js` was mid-edit and threw in `initRender` (`onPapDone` undefined), so render init and effects are guarded. Every economy value (`POINTS`, `PRICES`, `DOORS`, `PERKS`, `WEAPONS`, level defs) was identical to the live tree, and a check run gave byte-identical results on both. |
| `pap.mjs` | Analytic Pack-a-Punch per WO8 1.2: damage ×2, mag and reserve ×1.5 (rounded), spread ×0.8, penetration +1 (max 4), Ray Gun splash ×1.5, Thundergun killRange ×1.25 / range ×1.15 / knockback ×1.2. It swaps `w.def` and fills the mag and reserve. Upgraded wall ammo costs `PAP.ammoCost` (450), or `min(450, k × base)` with `PAP_AMMO_MULT=k`. It is the same model Agent A implemented in `weapons.js`. |
| `econ8.mjs` | **Frugal buy-order bot.** Intents run strictly in order and only ammo may jump the queue: cheap gun → Quick Revive → all doors → Juggernog → Double Tap II → better gun → Speed Cola → PaP → (PaP) → mega door. Guns, doors, perks and ammo go through the real `shop.*`. PaP is paid instantly once door H is open (the machine sits behind H). Emergency rule: if every carried gun is dry and none has a wall on this level, buy the cheapest reachable wall gun. |
| `fight8.mjs` | The WO7 arena bot (`fight7.mjs`), unchanged. |
| `chain.mjs` | **L1 → L4 chain through real boss kills.** Each level: `econ8` until the mega door is bought, then `fight8` fights that level's boss at that round with the carried guns, upgrades and perks. The next level starts at mega round + 1, with points = surplus + fight income and the same guns and perks. |
| `work8.mjs` | Round workload: god mode, all doors open, fixed guns (optionally upgraded) and perks, 2 rounds × 8 seeds. Ammo is refilled at 35 %, only if the gun's wall is on the level, and every refill is charged. |
| `boss8.mjs` | Boss time to kill (TTK) with and without PaP. The optional `bossPapMult` makes PaP multiply damage to the boss by k instead of ×2. |
| `tables8.mjs`, `summ.mjs` | Closed-form tables and chain summaries |

**Carried-over state between levels:**
- **Points:** the surplus at the mega door plus the fight income (200 for the boss + 10 per minion).
- **Guns, upgrades, perks, Quick Revive uses:** carried as they were.
- **Round:** the mega round + 1.
- **Ammo:** full on arrival. That is realistic, because `boss.finishFight` always drops a Max Ammo.

**Caveats:**
- The economy bot runs in god mode, as in WO5/WO7. A mortal open-map bot dies around R5.
- Income is not a matter of skill: every round pays exactly zombie count × 10, plus drops. So the **round numbers are robust**. Only spending, mostly ammo, depends on the player.
- This bot spends 3–5× less on ammo than the WO7 bot (250 on level 1 against 450–2,990), so it models a *frugal* player.
- Each chain cell is 12 seeds, reported as median (range).
- One pap2first seed stopped early with a harness hiccup and is excluded ("11/1").

## Summary

- **The 16,190–17,155 points in the WO7 screenshots came from `debug.addPoints`, not from play.**
  - `wo7-final-lab-level.png` shows 17,155 and `wo7-final-level4-tier3-wall.png` shows 16,190. The HUD kill counter reads 34 and 36 kills.
  - The same run's game-over summary (`wo7-final-gameover-desktop.png`) says **Points earned 1,065** for 36 kills and 3 bosses.
  - `main.js` `debug.addPoints` adds to `player.points` without touching `stats.pointsEarned`, which is why the summary ignores it.
  - Real play never holds more than about 300–900 points. The one exception is a bot stalling for rounds on L4 (below).
- **`PAP.cost` 500 is right. Keep it.** The frugal player affords:

  | When | Upgrade number | Round, median (range) | Success |
  |---|---|---|---|
  | L1, after all four perks | first | R11 (10–12) | 12/12 |
  | L1 | second | R12 (11–13) | 11/11 |
  | L2 | second (Man-O-War) | R14–15 | 12/12 |
  | L3 | third (Peacekeeper) | R17 | 12/12 |

  Every upgrade came before that level's boss.
  - PaP moves the L1 boss from R10 (9–11) to **R12 (11–13)**, the top of the WO5 R8–12 window.
  - At 600 the rounds stay about the same, apart from L3 → R18.
  - At 750 the L1 boss moves to R13, and two upgrades on L1 only arrive around R13–16. **The work-order criterion is already met at 500 with no other change.**
- **`PAP.ammoCost` 450 works as a sink. Keep it.**
  - The frugal player almost never buys it on L1–L2 (0–3 purchases across 12 runs). They use the bigger reserve and Max Ammo.
  - On L3–L4 a PaP'd Peacekeeper burns 0.9–1.9 refills per round: 394–844 points per round, which is 50–65 % of income.
  - Net income stays positive on every level: +186 on L1, +178 on L2, +381 on L3, +424 on L4.
  - Flat 450 is harsh on cheap guns. Per damage it costs 2× base for a KN-44 or Man-O-War, but 1.25× for a Peacekeeper. Recommendation 5 is an optional scaled price.
- **Late rounds do not overpay per round, and L3–L4 do not underpay.**

  | Level and round | Net per round (DT + SC, charged ammo) |
  |---|---|
  | L1 R10 | +240 |
  | L2 R14 | +414 |
  | L3 R17 | +530 |
  | L4 R22 | +670 |

  Rounds are capped by spawning, not DPS: 45–60 s with Double Tap + Speed Cola. **No round-clear bonus and no per-kill scaling are needed.**
- **What does overpay is the level price.** Every level costs a flat 550 in doors plus 250 for the mega door, while income per round rises 3.5× from L1 to L4.

  | Level | Rounds spent there (median), no PaP | With PaP |
  |---|---|---|
  | L2 | 4 | 3 |
  | L3 | 2 | 2 |
  | L4 | 1 | 1 |

  - With PaP, bosses come at R12, R15, R17 and R19, against the WO5 plan of R10, 14, 18 and 22.
  - **Recommendation 1 (mega door +250 per level)** gives 4 / 3 / 3 rounds (bosses R12 / R16 / R19 / R22). It keeps every PaP before its boss.
- **PaP halves every boss fight.** The 3 % per-hit cap never bites on an upgraded automatic: 140–370 per hit against caps of 297–791. The WO8 1.2 intent is therefore not met.

  | Boss fight (DT + SC) | Unupgraded | PaP ×2 (as specified) | PaP ×1.25 against the boss (rec. 2) |
  |---|---|---|---|
  | L1 | 25.6 s | 11.3 s | 19.1 s |
  | L2 | 22.5 s | 10.5 s | 17.0 s |
  | L3 | 20.2 s | 9.4 s | 14.8 s |
  | L4 | 22.9 s | 12.1 s | 18.4 s |

- **Quick Revive 50 / 150 / 300: keep it.**
  - Each rebuy costs 20–40 % of a round's income where it usually happens (L2–L4).
  - A revive also strips every perk: 750 or more to rebuy Juggernog, Double Tap and Speed Cola.
- **Mystery box 95: keep it flat and do not scale it by level.** The chance of a useful gun falls from 43 % on L1 to 12 % on L3–L4, so the effective price per useful gun already rises: 218 → 546 → 819. Scaling the price would stack a second penalty on a pool that is already diluted. An optional pool tweak is recommendation 4.

## 1. Where the WO7 17–19k points came from

| Source | Points shown | Kills | `stats.pointsEarned` |
|---|---|---|---|
| `wo7-final-lab-level.png` (L3, HUD) | 17,155 | 34 | — |
| `wo7-final-level4-tier3-wall.png` (L4, HUD) | 16,190 | 36 | — |
| `wo7-final-gameover-desktop.png` (same run) | — | 36 | **1,065** (3 bosses) |

36 kills pay at most 360, and three bosses pay 600, so 16k is impossible. The integration pass used `skipToRound(10)` and point hooks: the notes say *"summary said 4 rounds while HUD read 9 … debug skipToRound"*.

`src/main.js` line 412 `debug.addPoints(n)` does `p.points += n` and emits `points:changed`, but skips `stats.pointsEarned`. The real maximum balances, in 48 chain runs × 4 levels, were:

| Situation | Balance |
|---|---|
| Arriving on a level | 260–1,000 |
| Surplus at the mega door | 0–740 |
| Bot stuck buying ammo for 4–7 rounds on L4 (worst outliers) | 1,505–4,095 |

## 2. Income by level and round

Closed form (`tables8.mjs`). Points per kill are 10 on every level.

| Level | R5 | R10 | R12 | R14 | R16 | R18 | R20 | R22 |
|---|---|---|---|---|---|---|---|---|
| L1 BUNKER (×1.0 HP, ×1.0 count) | 240 | 290 | 340 | 390 | 450 | 520 | 590 | 670 |
| L2 CATACOMBS (1.5, 1.25) | 300 | 370 | 430 | 490 | 570 | 650 | 740 | 840 |
| L3 LABORATORY (2.0, 1.5) | 360 | 440 | 510 | 590 | 680 | 780 | 890 | 1,010 |
| L4 BUNKER II (2.4, 1.65) | 400 | 480 | 570 | 650 | 750 | 860 | 980 | 1,110 |

Points per 1,000 HP of round workload:

| Round | Points |
|---|---|
| L1 R5 | 18.2 |
| L1 R10 | 9.6 |
| L2 R14 | 4.4 |
| L3 R18 | 2.2 |
| L4 R22 | 1.3 |

That is 14× less pay per HP. Tier-2 and tier-3 guns, Double Tap and Pack-a-Punch make up for it, and the result is rounds limited by spawning (section 5).

**Measured per-round income** (chain medians, which include power-up and board income):
- L1: R5 240, R8 280, R10 290, R11 320, R12 340.
- L2: R13 470, R14 490, R15 530.
- L3: R16 680, R17 740, R18 780.
- L4: R18 860, R20 980, R22 1,110.

## 3. Chain L1 → L4, real boss kills (god mode, 12 seeds)

Frugal order on L1: Sheiva 50 → Quick Revive 50 → doors 550 → Juggernog 250 → Double Tap II 200 → KN-44 150 → Speed Cola 300 → [PaP 500] → mega 250.

On L2–L4: doors → the level's better gun → [PaP] → mega. The better guns are Man-O-War (L2) and Peacekeeper (L3, L4). The perk cap is already full.

### 3a. No Pack-a-Punch (baseline, current game)

| Level | Start round | Start points | Mega round | Rounds on level | Earned | Guns | Ammo | Doors + mega | Perks | Surplus at mega | Boss TTK | Fight income |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 1 | 0 | **10** (9–11) | 10 | 2,120 | 200 | 250 | 800 | 800 | 60 (10–235) | 25.7 s | 310 |
| L2 | 11 | 380 | **13** (13–19) | 4 | 1,330 | 375 | 189 | 800 | 0 | 384 (60–2,706) | 40.1 s | 400 |
| L3 | 14 | 784 | **16** (14–20) | 2 | 680 | 400 | 0 | 800 | 0 | 252 (9–1,966) | 20.1 s | 320 |
| L4 | 17 | 572 | **17** (15–23) | 1 | 440 | 0 | 0 | 800 | 0 | 212 (1–4,095) | 23.5 s | 320 |

On L2 the carried KN-44 and Sheiva have no wall. 11/12 runs had to make an emergency HVK-30 buy (125) when both ran dry: "guns 375".

### 3b. One PaP per level (policy `pap`)

| Level | Start round | Start points | PaP round | Mega round | Rounds on level | Earned | Guns | Ammo | PaP | Surplus at mega | Boss TTK |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 1 | 0 | **11** (10–12), KN-44 | **12** (11–13) | 12 | 2,620 | 200 | 250 | 500 | 90 (15–300) | 11.9 s |
| L2 | 13 | 340 | **14** (14–15), Man-O-War | **15** (14–16) | 3 | 1,390 | 250 | 75 | 500 | 165 (40–474) | 17.5 s |
| L3 | 16 | 480 | **17** (16–17), Peacekeeper | **17** (17–19) | 2 | 1,460 | 400 | 120 | 500 | 122 (0–740) | 9.0 s |
| L4 | 18 | 382 | — (both guns upgraded) | **19** (18–21) | 1 | 880 | 0 | 0 | 0 | 85 (0–605) | 11.6 s |

Bosses killed: 48/48. **One upgrade by each level's boss: 12/12 on L1, L2 and L3. Two by the L2 boss: 12/12.**

### 3c. Two PaPs on level 1 (policy `pap2first`)

| Level | PaP rounds | Mega round | Surplus at mega |
|---|---|---|---|
| L1 | KN-44 **R11** (10–13), Sheiva **R12** (11–13) | **13** (13–14) | 120 (95–315) |
| L2 | Man-O-War R16 (15–16) | 17 (16–18) | 250 |
| L3 | Peacekeeper R18 (17–20) | 19 (18–20) | 210 |
| L4 | — | 20 (19–22) | 95 |

Result: 11/11.

### 3d. Rounds to afford PaP (frugal player, all four perks first)

| Level | First PaP | Second PaP | Notes |
|---|---|---|---|
| L1 | R11 (10–12) | R12 (11–13) | Speed Cola (300) is bought at R8–9. Swapping Speed Cola and PaP gives PaP at about R10. |
| L2 | R14 (14–15), 1–2 rounds after arrival | — | The 250 Man-O-War comes first, as its ammo source |
| L3 | R17, 1 round after arrival | — | After the Peacekeeper (400) |
| L4 | nothing left to upgrade | — | From here only ammo (450) is a sink |

### 3e. Price sensitivity (policy `pap`, 12 seeds)

| `PAP.cost` | L1 PaP / mega | L2 PaP / mega | L3 PaP / mega | L4 mega | L1 two PaPs by |
|---|---|---|---|---|---|
| **500** | R11 / **R12** | R14 / R15 | R17 / R17 | R19 | R12 (mega R13) |
| 600 | R11 / R12 | R14 / R15 | R17 / R18 | R19 | — |
| 750 | R12 / **R13** | R16 / R17 | R19 / R19 | R21 | R13–16 (mega **R16**, 14–18) |

750 (BO3's 5,000 ÷ 10 × 1.5) pushes the L1 boss out of the R8–12 window and makes a second L1 upgrade a stretch. **500 is right. 600 is acceptable but gains nothing.**

## 4. Mega door price per level (recommendation 1), policy `pap`

| Level | Mega cost | PaP round | Mega round | Rounds on level | Ammo spent | Surplus at mega |
|---|---|---|---|---|---|---|
| L1 | 250 | R11 (10–12) | R12 (11–13) | 12 | 300 | 95 |
| L2 | **500** | R15 (14–15) | **R16** (15–17) | 4 | 150 | 190 |
| L3 | **750** | R18 (16–19) | **R19** (18–20) | 3 | 570 | 135 |
| L4 | **1,000** | — | **R22** (20–28) | 3 | 900 (2 PaP refills) | 380 |

With pap2first: L1 two PaPs by R11–13 (mega R13), L2 PaP R15 (mega R18), L3 PaP R20 (mega R21), L4 mega R22.

- **Bosses land at about R12 / 16 / 19 / 22.** That is the WO5 cadence of about 3–4 rounds per level: R10 / 14 / 18 / 22 plus the PaP round.
- Every upgrade is still bought before its boss.
- On L4 the extra 750 is paid mostly through PaP ammo (450 × about 2 per round), which is exactly the late sink WO8 wants.

## 5. Workload with upgraded guns and 450 ammo

God mode, Juggernog + Double Tap II + Speed Cola, 16 rounds per row. Refills are charged, and only happen where the gun has a wall on the level.

| Case | Seconds per round | Earned | Ammo per round | Refills per round | **Net per round** |
|---|---|---|---|---|---|
| L1 R10 KN-44 + Sheiva | 46 | 339 | 98 | 1.31 | **+240** |
| L1 R10 KN-44★ + Sheiva (450) | 42 | 326 | 141 | 0.31 | +186 |
| L1 R10 KN-44★, PaP ammo 3.75× base (281) | 42 | 326 | 88 | 0.31 | +238 |
| L1 R10 KN-44 + Sheiva, **no perks** | 77 | 333 | 159 | 2.13 | +174 |
| L1 R10 KN-44★ + Sheiva, **no perks** | 43 | 339 | 225 | 0.50 | +114 |
| L2 R14 Man-O-War + Sheiva | 51 | 554 | 141 | 1.88 | **+414** |
| L2 R14 Man-O-War★ + Sheiva (450) | 50 | 544 | 366 | 0.81 | +178 |
| L2 R14 Man-O-War★, PaP ammo 3.75× (281) | 50 | 544 | 228 | 0.81 | +315 |
| L2 R13 KN-44★ + Man-O-War | 51 | 501 | 38 | 0.50 | +463 |
| L2 R14 KN-44★ + Sheiva★ (no wall for either) | 63 | 529 | 0 | 0 | +529 (2 s dry per round) |
| L3 R17 Peacekeeper + Man-O-War | 62 | 808 | 278 | 2.31 | **+530** |
| L3 R17 Peacekeeper★ + Man-O-War (450) | 59 | 775 | 394 | 0.88 | +381 |
| L3 R17 KN-44★ + Man-O-War★ (L2 guns, no walls) | 109 | 832 | 234 (emergency buys) | — | +598 |
| L4 R22 Peacekeeper + Man-O-War | 133 | 1,308 | 638 | 5.31 | **+670** |
| L4 R22 Peacekeeper★ + Man-O-War★ (450) | 74 | 1,268 | 844 | 1.88 | +424 |
| L4 R20 Man-O-War★ + KN-44★ | 79 | 1,123 | 1,013 | 2.25 | +110 |

★ = Pack-a-Punched.

- **Rounds are capped by spawning, not DPS.** With Double Tap + Speed Cola a round lasts 45–60 s on L1–L3: 24 alive at once, and spawns at least 0.5 s apart. So PaP buys little time on L1–L3, but on L4 R22 it takes a round from 133 s to 74 s. It also buys safety and shorter boss fights.
- **PaP'd guns cost more points per round than base guns.** The 450 refill is a real sink, but net stays positive everywhere.
- **Points per 1,000 damage** (full load, 1 hit per shot):

  | Gun | Base | PaP at 450 | PaP / base |
  |---|---|---|---|
  | KN-44 | 3.97 | 7.94 | 2.00× |
  | Man-O-War | 2.38 | 4.75 | 2.00× |
  | Peacekeeper | 2.16 | 2.70 | 1.25× |
  | Sheiva | 2.14 | 12.8 | 6.0× |

  A price of 3.75 × the base wall ammo, capped at 450, gives every gun 1.25× its base cost per damage (recommendation 5).
- **Carried upgraded guns die one level later from ammo, not damage.** L2 has no wall for level-1 guns and L3 none for level-2 guns. A frugal player on L2 with KN-44★ + Sheiva gets through R13–14 on the ×1.5 reserve and Max Ammo, then has to buy a level gun (2/12 emergency buys in 3b). The WO8 rule "Max Ammo only" works, but PaP extends a favourite gun by about one level, not more (see open point in 7).

## 6. Bosses with PaP (DT + SC, median over 12 seeds; mortal rows 16 seeds)

Boss HP and 3 % cap: L1 R11 10,440 (cap 313); L2 R14 16,470 (494); L3 R17 21,960 (659); L4 R20 26,352 (791).

| Fight | Unupgraded | PaP ×2 (as specified) | PaP vs boss ×1.5 | **PaP vs boss ×1.25** |
|---|---|---|---|---|
| L1 R11 KN-44(★) + Sheiva | 25.6 s | **11.3 s** | 15.0 s | **19.1 s** |
| L2 R14 Man-O-War(★) + KN-44(★) | 22.5 s | **10.5 s** | 14.1 s | **17.0 s** |
| L3 R17 Peacekeeper(★) + Man-O-War(★) | 20.2 s | **9.4 s** | 11.6 s | **14.8 s** |
| L4 R20 Peacekeeper(★) + Man-O-War(★) | 22.9 s | **12.1 s** | 14.0 s | **18.4 s** |
| L1 R11 KN-44(★), no perks | 51.9 s | 19.3 s | — | 35.3 s |

- Survival is unchanged: all 16 mortal runs survived on L1 and L3, with or without PaP.
- Per-hit damage of upgraded guns against the boss: KN-44★ 140, Man-O-War★ 280, Gorgon★ 350, Peacekeeper★ 370, M8A7★ 280, HG 40★ 260.
- **The cap only bites on L1** (Gorgon★ and Peacekeeper★ from the box, Drakon★) and on Drakon★ everywhere. So "the per-hit cap makes upgrades a smaller boost against bosses" (WO8 1.2) is not true for automatics. The fight gets 2.1–2.3× shorter.

## 7. Quick Revive and mystery box

### Quick Revive

`PERKS.list.revive.costs` is [50, 150, 300].

| Purchase | Typical round (frugal player) | Round income there | Price as a share of a round |
|---|---|---|---|
| 1st: 50 | L1 R2 | 80 | 63 % (5 kills) |
| 2nd: 150 | after the first down, usually L2–L3 (R13–17) | 470–740 | 20–32 % |
| 3rd: 300 | L3–L4 (R17–22) | 740–1,110 | 27–41 % |

- Every revive also strips all perks: 750 or more to rebuy Juggernog, Double Tap and Speed Cola, plus the walks.
- **Keep 50 / 150 / 300.** The rising steps already follow the income curve, and they are a sizeable decision without being prohibitive. Scaling further (for example 50 / 250 / 500) is not needed, because the perk rebuy is the real cost.

### Mystery box

Pool weights: level-1 wall guns 3 each (56.5 %), box-only tier 1 8.7 %, level-2 wall guns 23.2 %, tier 3 8.7 %, wonder 2.9 %. Total weight is 69.

| Level | Useful roll (better than the level's best wall gun or a wonder weapon) | P(useful) | Price per useful gun at 95 | Round income | Spin as a share of a round |
|---|---|---|---|---|---|
| L1 | tier 2 + tier 3 + box-only LMGs/Locus + wonder | 43.5 % | 218 | 290 | 33 % |
| L2 | tier 3 + Gorgon/Drakon + wonder | 17.4 % | 546 | 490 | 19 % |
| L3–L4 | tier 3 + wonder | 11.6 % | **819** | 740–1,110 | 9–13 % |
| L3+ with tier-1 walls at weight 1 (rec. 4) | tier 3 + wonder | 18.6 % | 511 | — | — |

- **Do not scale the price by level.** The pool dilution already makes a useful pull 3.8× dearer on L3 than on L1, more than the 2.6–3.8× income growth.
- Raising the price would make the box a trap on L3+, and a boxed gun on L3+ usually has no wall ammo anyway.
- BO3 keeps 950 flat, too.

## 8. Recommendations

Numbered with exact old → new values and the files they touch. **None of them is needed to meet the WO8 acceptance line** ("a frugal competent player can afford one upgrade by each level's boss, and two by the next level"): the current values already meet it in 12/12 chains, as 3b–3d show. Recommendations 1 and 2 were measured and keep it true.

1. **[BAL, recommended] Mega door price rises by 250 per level: 250 / 500 / 750 / 1,000 / …**
   - **Config** (`src/config.js`, `DOORS`): `{ megaCost: 250 }` → `{ megaCost: 250, megaCostPerLevel: 250 }`. Keep `megaCost` 250, because `tests/contracts.test.js` line 506 pins it.
   - **Where the price is set:**
     - `src/level.js` `startLevel`: after loading the map, set `state.map.megaDoor.cost = DOORS.megaCost + (DOORS.megaCostPerLevel || 0) * idx`.
     - Or do the same in `src/map.js` line 244, if `loadMap` gets the level index.
   - **Where it is read:** `src/shop.js` line 185 (prompt) and line 384 (`buyMegaDoor`) should read `state.map.megaDoor.cost` (fallback `DOORS.megaCost`) instead of `DOORS.megaCost`. `src/render.js` line 1285 (mega door plate) should read `md.cost`.
   - **Tests:** the existing `tests/shop.test.js` fixtures build `megaDoor.cost = DOORS.megaCost` on level 0, so they stay green. Add one test for the L3 price of 750 (owner of `tests/shop.test.js` / `tests/level.test.js`).
   - **Why:** doors and the mega door cost a flat 800 on every level while income per round rises 3.5×, so L3 and L4 are cleared in 1–2 rounds (bosses R17, R19). With this change: 4 / 3 / 3 rounds, bosses R12 / R16 / R19 / R22 (the WO5 cadence), surplus at the mega door 95–380. PaP is still bought before every boss (R11 / R15 / R18), and two by the L2 boss in 12/12. On L4 the extra cost is paid largely through 450 PaP ammo, the intended sink.
   - **Resolution (Phase 4a):** applied. `DOORS.megaCostPerLevel: 250`, `level.megaDoorCost` / `startLevel` set `map.megaDoor.cost` (250 / 500 / 750 / 1000 / ...), `shop.js` prompt and `buyMegaDoor` read the door's cost; tests in `tests/level.test.js` and `tests/shop.test.js`.
2. **[BAL, recommended] PaP damage against the boss ×1.25 instead of ×2.**
   - **Config** (`src/config.js`): add `BOSS.papDamageMult: 1.25`.
   - **Code** (`src/weapons.js` `tryFire`): for the hitscan `bossDamage` argument use `d.damage * bossMult * (d.upgraded ? BOSS.papDamageMult / PAP.damageMult : 1)`. Guard both values with `Number.isFinite`, falling back to 1.
   - Ray Gun★ and Thundergun★ need no change: they are already bounded by the 3 % cap and the Thundergun boss fraction.
   - **Test:** `tests/weapons.test.js` (Agent A / INT): a hit from an upgraded KN-44 on a `kind: 'boss'` target deals 70 × 1.25 = 87.5, and 140 on a normal zombie.
   - **Why:** the 3 % cap never bites for upgraded automatics (140–370 against 297–791), so PaP cuts every boss fight 2.1–2.3×: 25.6 / 22.5 / 20.2 / 22.9 s → 11.3 / 10.5 / 9.4 / 12.1 s. That repeats the WO7 Double Tap problem (WO7 rec. 1). At ×1.25 it is 19.1 / 17.0 / 14.8 / 18.4 s, still a clear 20–27 % reward. Minions and normal zombies keep the full ×2.
   - **Economy impact:** none. Fight income was 240–320 in every variant.
   - **Resolution (Phase 4a):** applied as `BOSS.papDamageMult: 1.25`: boss damage = base x min(dtap, `dtapDamageMult`) x 1.25 per target; Ray Gun★ direct / splash on the boss are base x 1.25; Thundergun keeps its boss fraction. Live-code TTK 19.1 / 17.0 / 14.8 s (L1–L3), as predicted. Tests in `tests/weapons.test.js`.
3. **[info, no change] `PAP.cost` 500 and `PAP.ammoCost` 450 (`src/config.js`).**
   - **Cost:** 500 is affordable one round after the four-perk set on L1 (R11), and again on every later level before the mega door. 750 pushes the L1 boss to R13 and two L1 upgrades to R13–16.
   - **Ammo:** 450 is a working sink. A frugal player barely buys it on L1–L2; on L3–L4 an upgraded pair costs 394–844 per round, net still +381 to +424.
4. **[optional, design call] Box pool on level index ≥ 2: level-1 wall guns at weight 1 instead of 3.**
   - **Config** (`src/config.js`, `SHOP.boxWeights`): add `wallLate: 1` and `lateFromLevel: 2`.
   - **Code** (`src/shop.js`): `boxWeights()` and `spinBox()` / `tickBox()` use `wallLate` for `BOX_WALL_WEIGHT_IDS` when `state.level.index >= lateFromLevel`.
   - **Price:** keep `PRICES.mysteryBox` 95 flat (`src/config.js`).
   - **Why:** P(useful) on L3+ goes from 11.6 % to 18.6 % (819 → 511 per useful gun). Skip it if the box should stay a pure gamble.
5. **[optional] Scaled upgraded-ammo price: `min(PAP.ammoCost, round(PAP.ammoCostMult × base ammoCost))`.**
   - **Config** (`src/config.js`, `PAP`): add `ammoCostMult: 3.75`.
   - **Code** (`src/weapons.js` `ammoCost(id, upgraded)`). The prompt in `src/shop.js` shows the returned price. Tests go in `tests/weapons.test.js`.
   - **Prices:**

     | Gun | PaP ammo |
     |---|---|
     | KN-44 | 281 |
     | Man-O-War | 281 |
     | Gorgon | 338 |
     | HG 40 | 394 |
     | M8A7 | 424 |
     | Peacekeeper | 450 (unchanged) |
     | Sheiva | 94 |

   - **Why:** flat 450 costs 2–6× base per damage on cheap guns, but only 1.25× on tier 3. With the formula every gun pays 1.25× (L2 Man-O-War★ net per round +178 → +315; L3–L4 unchanged). Skip it to keep the BO3-flat 4,500 ÷ 10.
   - **Resolution (Phase 4a):** applied. `PAP.ammoCostMult: 3.75`, `ammoCost(id, true)` = `min(450, round(3.75 x base))` (KN-44 281, Peacekeeper 450); shop prompt shows it. Tests in `tests/weapons.test.js` / `tests/shop.test.js`.
6. **[info, no change] Quick Revive `costs: [50, 150, 300]`** (`src/config.js` `PERKS.list.revive`). The steps track income: 63 % of a round at R2, 20–41 % for the 2nd and 3rd on L2–L4. The perk strip (750+) is the real price.
7. **[info, no change] No round-clear bonus and no per-kill scaling** (`POINTS` in `src/config.js`). Net income per round rises every level (+240 / +414 / +530 / +670, charged ammo). L3–L4 do not underpay with tier-3 ammo (120) or upgraded ammo (450). Per-round income is not the problem; the flat level price is (recommendation 1).
   - **Resolution (Phase 4a):** no change.
8. **[info] `debug.addPoints` does not count in `stats.pointsEarned`** (`src/main.js` line 412). This is correct, and it explains the WO7 screenshots. Future screenshot passes should note the balance was debug-granted, so it is not mistaken for an economy bug.
   - **Resolution (Phase 4a):** left as is (debug only); documented in the README Debug section.

**Open point for the lead (no value change):** from L4 on, a player holding two upgraded guns and four perks has only PaP ammo (and the Quick Revive rebuy) left to spend on. Net income is about +420–670 per round at R20–22, so the surplus grows again from L5. Recommendation 1 absorbs about 250 per level. A later work order could add a BO3-style "repack" (re-PaP an upgraded gun for about 200 to refill it) as an endless sink. It would also fix the no-wall ammo gap for upgraded guns.

## Appendix: reproducing

In `qa3/wo8/`:

```
node tables8.mjs
node chain.mjs nopap 12 | pap 12 | pap2first 12
PAP_COST=600|750 node chain.mjs pap 12
MEGA_STEP=250 node chain.mjs pap 12
node summ.mjs chain_<policy><tag>.json
node work8.mjs <levelIdx> <round> <gun[*]> <gun2[*]> <perks> 8
PAP_AMMO_MULT=3.75 node work8.mjs ...
node boss8.mjs <levelIdx> <round> <g1[*],g2[*]> <perks|-> g|m 12 [bossPapMult]
```

Raw outputs: `o2_*.txt`, `chain_*.json`, `work_a.txt`, `work_b.txt`, `boss_a.txt`, `boss_b.txt`.
