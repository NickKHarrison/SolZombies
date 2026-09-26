# WO5 QA-1 — Playtest

Run: `python -m http.server 8162`, a new Chrome tab at `/?debug=1`, driven with
`__game.debug.step(dt, dt, inputOverrides)`. A small in-page bot did the moving and firing: BFS
walking over `map.isWalkable`, and it aimed at the nearest zombie in line of sight. In the boss
fight it kited and sidestepped each charge.

What was played for real, with no shortcut:
- **Level 1:** rounds 1–4 with the MR6. Then all five doors bought by walking up and pressing F
  (E, G, H, D, F). The blocked mega door prompt was checked.
- **Level 1 guns:** ICR-1 bought off the wall, one Mystery Box roll (Pharo).
- **Level 1 boss:** mega door bought for 250. Walked into the arena and fought THE WARDEN with real
  fire. God mode was **off**, and the fight lasted about 30 s. Then walked to the stairs and pressed F.
- **Level 2:** played on from round 4. The bot died at round 5 (see finding 4).

Shortcuts taken:
- **Level 2 second pass:** `setLevel(1)`, `skipToRound(6)`, `addPoints` and god mode. After that, all
  doors and six new guns (Weevil, Marshal 16, Man-O-War, 48 Dredge, Gorgon, XR-2) were bought
  through the real interact path.
- **Level 2 boss:** mega door bought, then THE BONE PRIEST fought with real fire. God mode was off
  and there were no heals. The fight lasted 33.8 s. Then the stairs led to level 3.
- **Other checks:** frame cost, restart mid-fight, and death mid-fight.

Console errors: **none**. A `console.error`/`error`/`unhandledrejection` hook ran the whole session
and caught nothing. `read_console_messages` with onlyErrors found nothing either.

Harness note: the MCP tab reports `visibilityState = hidden`, so rAF and CSS animations only run
while a screenshot is being taken. Banner timing, meaning the 3 s CSS animation, cannot be judged
visually here. Banners were checked through the DOM: `.hud-banner.show` with the right text. The
layout was checked by pinning the animation at 1.2 s.

## Findings

1. **MAJOR — The guaranteed Max Ammo drop is invisible under the boss blood pool.**
   - **File/function:** `src/render.js` `render()`, draw order.
   - **Repro:** kill either boss and look at the boss's death spot. `state.powerups.items` holds
     `maxAmmo` at the corpse position.
   - **Expected:** the drop is visible and is what the player looks for after the kill (1.2 "the boss
     drops one guaranteed Max Ammo").
   - **Actual:** `drawPowerups` runs *before* `drawEffectsOfType('bossDeath')` and `'blood'`. The
     14 s opaque pool (`RENDER.bossPoolTtl`) covers the item for about half of its 30 s life.
     Confirmed on L1 and L2 by zooming the pool. Screenshots: `wo5-qa-stairs-open-maxammo-hidden.png`
     and `wo5-qa-l2-stairs-maxammo-hidden.png`.
   - **Clause:** 1.2 / Section 5 item 4.
   - **Fix:** move `drawPowerups(state, t, view)` below the two blood calls, just before
     `drawZombies`. The same fix also stops normal blood from hiding 2 % drops.
   - **Resolution (FIX-3):** `drawPowerups` moved below both blood passes (just before `drawZombies`); render's own boss pool removed (review I3). Verified: Max Ammo "MA" drawn on top of the boss pool after `killBoss`.

2. **MAJOR (balance/feel) — Several level-2 guns are not stronger than level-1 guns, and price does
   not track power.**
   - **File/function:** `src/config.js` `WEAPONS` entries for gorgon, drakon, marshal16 and
     haymaker12.
   - **Repro:** stand still, spawn one 975 HP zombie (L2 round 6) 140 px away and hold fire. Three
     trials per gun.
   - **Measured TTK:**

     | Gun | Level | Price | TTK |
     |---|---|---|---|
     | KN-44 | L1 | 150 | 1.13 s |
     | ICR-1 | L1 | 150 | 1.23 s |
     | XR-2 | L2 | 225 | 0.77 s |
     | Man-O-War | L2 | 250 | 0.95 s |
     | 48 Dredge | L2 | 275 | 0.95 s |
     | Weevil | L2 | 200 | 1.03 s |
     | Gorgon | L2 | 300 | 1.08 s |
     | Drakon | L2 | 300 | **1.35 s** |
     | Haymaker 12 | L2 | 250 | 1.2–1.8 s |
     | Marshal 16 | L2 | 225 | **2.2–2.8 s** |

   - **Expected:** "Level 2 walls sell new, stronger guns". The deepest zone (Sanctum: Gorgon and
     Drakon at 300) should hold the best guns.
   - **Actual:** the two most expensive guns are about equal to or worse than a 150-point L1 KN-44,
     and the cheapest new gun (XR-2 at 225) is the best. The Marshal 16 is worse than the ICR-1 at
     mid range. Penetration may help the Gorgon and Drakon against crowds, but single-target they
     feel like downgrades.
   - **Clause:** 1.3 "Weapons per level" / Section 5 item 6 "they feel stronger".
   - **Fix:**
     - Gorgon damage 130→170, or rpm 400→520 (about 1130–1470 DPS).
     - Drakon damage 220→340, keeping the penetration.
     - Marshal 16: tighten the spread, or raise pellet damage 70→90.
     - Or re-price so that the Sanctum guns are not the dearest. Hand this to balance QA.
   - **Resolution (FIX-4):** retuned all eight tier-2 guns in `src/weapons.js` (prices unchanged). Modelled L2 R8 (1275 HP) TTK vs KN-44 1.54 s: Weevil 1.20, XR-2 1.13, Marshal 16 0.40 (2 shots), Man-O-War 1.04, Haymaker 12 1.09, 48 Dredge 0.93, Gorgon 0.88, Drakon 0.90 (all <= 0.85x); Gorgon/Drakon best on mean L2 R6-12 TTK. Pinned by the "tier-2 TTK" tests in `tests/weapons.test.js`; table in `docs/notes/weapons.md`.

3. **MINOR — The round does not end at boss death while outside zombies still live.**
   - **File/function:** `src/waves.js` `endRoundNow` (called by `boss.finishFight`).
   - **Repro:** start the L1 fight with 3 round-4 zombies still outside, then kill the boss.
   - **Actual:** `rounds.phase` stays `active` and `toSpawn` is 0. The round only ends after those 3
     are hunted down. Meanwhile the 3 zombies stood stuck "chasing" in the vault for the whole fight.
   - **Expected:** 1.2 says "current round ends immediately and the normal break starts".
   - **Clause:** 1.2 / Section 5 item 4 "rounds resume with a break". It works as documented in the
     code comment, but it deviates from the spec.
   - **Fix:** either kill leftover round zombies without points in `finishFight`, or let
     `endRoundNow` call `endRound` whatever `alive` is (the survivors carry into the break). Or amend
     the spec. As a player it is harmless.

4. **MINOR (feel) — Arriving on level 2 mid-game is a sharp difficulty cliff.**
   - **File/function:** `src/levels/level2.js` `difficulty`, and `src/level.js` start-of-level
     handling.
   - **Repro:** descend at round 4, then play round 5 with a freshly bought Weevil.
   - **Actual:**
     - Round-5 zombies have 825 HP (was 550).
     - `sprintShift` 3 makes most of them joggers or sprinters at up to 235 px/s.
     - The stationary bot, which held its own on L1, died in 8.9 s.
     - The player lands in the Chapel with only the HVK-30 (125) on the wall. The first new gun is
       behind door D.
   - **Expected:** "zombies are visibly tougher and faster". That is met, but the jump lands
     together with a zero-door reset.
   - **Fix, one of:**
     - Soften the first L2 break: `rounds.firstRoundDelay` +5 s on descent.
     - Put a new gun in the Chapel: Weevil 200 instead of HVK-30 125.
     - Ramp `healthMult`: 1.25 for the first L2 round, then 1.5.

   - **Resolution (FIX-1):** on any descent (`startLevel` with index > 0) the player is healed to full and the first break is `LEVELS_CFG.arrivalBreak` (10 s) instead of `firstRoundDelay`. Boot/restart (index 0) unchanged. Browser: 40 -> 150 HP, break timer 10 s on arrival.

5. **MINOR — HUD widgets overlap world labels at the screen edges.**
   - **File/function:** `src/render.js` wall-buy and door labels vs `styles.css` HUD columns.
   - **Repro and actual:**
     - L2 Charnel Pit, player centred: the wall label "48 DREDGE 275" is drawn under the
       "L2 CATACOMBS" level label (`wo5-qa-l2-charnel-label-overlap.png`).
     - L3 start room: the "ARGUS 150" label sits under the weapon panel's "XR-2" line
       (`wo5-qa-l3-bunker-repeat.png`).
     - The face bezel covers the "HVK-30" label in the Sanctum (`wo5-qa-l2-sanctum-megadoor.png`).
   - **Expected:** HUD text stays readable.
   - **Clause:** WO5 3.6 level label (new widget).
   - **Fix:** give `.hud-level` a small dark backing plate like `.hud-prompt`
     (`background: rgba(0,0,0,.45)`), or fade world labels under the HUD columns.
   - **Resolution (FIX-3):** `.hud-level` now has a small dark plate (`rgba(0,0,0,.55)`) and `.hud-weapon` a faint backing (`rgba(0,0,0,.38)`); the face box is already opaque. Labels a player stands on are also re-drawn over him (#10).

6. **MINOR — The "MEGA DOOR OPENED" floating text lingers under the "SEALED" plate.**
   - **File/function:** `src/render.js`, the text effect spawned on the mega door purchase.
   - **Repro:** buy the mega door and walk straight into the arena within about 1 s.
   - **Actual:** faded "MEGA DOOR OPENED" text shows through behind the red "SEALED" label
     (`wo5-qa-arena-sealed.png`).
   - **Fix:** clear any `text` effect near `megaDoor.cx/cy` when `sealMegaDoor` runs, or cut the
     text TTL to 0.8 s.
   - **Resolution (FIX-3):** while the mega door is sealed, render expires any "MEGA DOOR OPENED" text within 90 px of it (`ttl = 0`). Verified in Chrome.

7. **MINOR (readability) — The charge telegraph is weak on the grey bunker floor, and there is no
   aim cue.**
   - **File/function:** `src/render.js`, the boss draw for `phase === 'telegraph'`.
   - **Actual:** a pale body flash plus a thin grey-white expanding ring
     (`wo5-qa-charge-telegraph.png`). It is readable once learned. The dash can be dodged: my
     sidestep bot dodged 7 of 8 charges at 200–256 px, and the one hit was when it was pinned on a
     pillar. But the ring nearly vanishes against the BUNKER floor, and nothing shows *where* the
     charge will go.
   - **Clause:** 1.2 "telegraph (boss stops, flashes, roar sting)". Met, but it could read better.
   - **Fix:**
     - Colour the ring `#ff4030` and make it 4 px wide.
     - Add a faint red wedge or line from the boss toward the player during the last 0.3 s of the
       telegraph, fixed at the lock-on direction.
   - **Resolution (FIX-3):** pulsing translucent red warning lane with chevrons from the boss toward the charge aim (charge.dx/dy, else the player), dash-reach long and cut at the first wall; 4 px red pulsing outline on the body; ring `#ff4030`, 4 px. Verified on the L1 grey floor.

8. **MINOR — Minions and level-2 normal zombies look alike.**
   - **File/function:** `src/render.js`, minion draw.
   - **Actual:** minions are small orange-brown discs with red eyes. On L2 many normal zombies use a
     tan/orange tint, so in a crowd (`wo5-qa-l3-boss-crowd.png`) the only cue is size.
   - **Fix:** a darker, near-black body (`#3a1a14`) or a thin red outline for minions.
   - **Resolution (FIX-3):** minions use a fixed near-black purple body for every theme/tier, a thin red outline and glowing red eyes. Verified on L2 among 24 tan/green zombies.

9. **MINOR (art/design) — Level 3 looks exactly like level 1.**
   - **File/function:** `src/level.js`, loop theme selection, and the `LEVELS` registry.
   - **Actual:** `LEVEL 3 — BUNKER` has the same theme, the same boss name (THE WARDEN) and the same
     guns. Only the numbers change, so progress does not feel visible.
   - **Clause:** 1 item 4 "next theme". Technically met, with only two themes.
   - **Fix:**
     - For loops, derive a tinted variant, e.g. BUNKER with a cold blue ambient
       `rgba(80,140,255,.06)` and a name like "BUNKER II".
     - Suffix the boss name (e.g. "THE WARDEN II").

   - **Resolution (FIX-1):** from loop 1 on, `level.js` derives a new def per (level, loop) (memoized; base defs untouched): name `BUNKER II` / `CATACOMBS II` / `BUNKER III` ..., boss `THE WARDEN II` ..., and a new theme object from `loopTheme(base.theme, loop)` cycling FLOODED (teal-grey) / BURNING (red-amber, torches) / BLIGHTED (green) / FROZEN (blue), darker each further cycle, with floorAlt != floor so the textured floor/brickwork is drawn. Browser: level 3 banner `LEVEL 3 — BUNKER II`, HUD `L3 BUNKER II`, teal floor + tint.

10. **COSMETIC — The player's body hides the label he stands on for wall buys and the mega door.**
    - **File/function:** `src/render.js`, label placement.
    - **Actual:** "MEGA DOOR" (L1, vault side) and "WEEVIL" are covered by the player sprite exactly
      when the prompt is active (`wo5-qa-megadoor-blocked.png`). The HUD prompt carries the info, so
      this is low impact.
    - **Fix:** draw labels after `drawPlayer`, or offset the lower label 6 px further from the wall.
    - **Resolution (FIX-3):** label plates are recorded while painting the static layer; a plate overlapping the player is re-blitted over him at 75 % alpha, so the text stays readable.

11. **COSMETIC / NOTE — The bone chamber and sanctum props read as plain brick pillars.**
    - **File/function:** `src/render.js`, static layer for CATACOMBS.
    - **Actual:** the "central bone pile", sarcophagi and altar are drawn as the same brick blocks as
      walls. The theme overall looks good (warm checker floor, bone flecks, torches, amber tint), but
      the set pieces carry no identity.
    - **Fix (optional):** bone-white fleck overlay (`theme.accent`) on 2×2 interior wall blocks in
      CATACOMBS.

Positive notes:
- **The mega door** reads well: iron with a skull, and it is clearly placed in the deepest zone on
  both levels.
- **The stairs** read well too: a padlocked grille before the kill, then a lit stair with a
  "DESCEND" plate. The boss is big and clearly different from zombies.
- **The boss bar** is centred and fits long names on one line.
- **The new gun sprites** are distinct in hand: Gorgon drum, Dredge box magazine, Drakon scope, XR-2
  purple accent (`wo5-qa-guns-in-hand.png`).
- **The catacomb theme** looks good.
- **Performance:** frame cost with boss + 10 minions + 24 zombies was 0.47 ms per step.

Balance observations for QA-3, not filed as bugs:
- **Boss TTK came in under the 45–75 s target:**
  - WARDEN: 5920 HP at round 4, with ICR-1 plus Pharo, about 30 s.
  - BONE PRIEST: 10 320 HP at round 6, Man-O-War only, 33.8 s.
  - **Resolution (FIX-2):** boss base 4000 -> 4500 (round factor capped at 12), minions 300 x healthMult, per-hit cap 3 %, Thundergun near 8 %, Insta-Kill x2, mid-fight Max Ammo, full heal at start. Measured L1 R10 KN-44 + Argus: 45.7 s median (40-55), R12 52.9 s. Early-round fights (R4-6) stay shorter by design (boss HP scales with round). See `docs/qa/wo5-balance.md` #3-#13.
- **Minion pressure was low.** At most 5 were alive at once, and they did 2 hits (50 dmg) in the
  whole L2 fight.
- **Loop scaling:** level 3 uses healthMult 1.4, which is lower than level 2's 1.5 (as the
  integrator already noted).

## Section 5 acceptance

| # | Item | Result | Notes |
|---|------|--------|-------|
| 1 | Mega door blocked until 5 doors open; 250; leads to arena | PASS | Played for real: blocked prompt at 3/5 doors, buyable after 5/5, 250 deducted |
| 2 | Entering arena seals, bar + banner, roar, boss + first wave; spawning stops; outside zombies stay | PASS | sealed, suspended, 1 boss + 4 minions (L2: 5), 3 outside zombies kept; banner verified in DOM (see harness note) |
| 3 | Melee, visible telegraph, wall stop, summons every 12 s ≤ 10, minions fast/small/10 pts, power-up rules | PASS (minor) | Charges all wall-stopped (`charge.wall`), dodgeable; cap 10 held under forced spawn; minion kill = 10. Telegraph readability: finding 7. Power-up rules not re-tested (integrator + QA-2) |
| 4 | Boss kill: death anim, +200, Max Ammo, minions die, unseal, stairs, banner, rounds resume w/ break | PARTIAL | +200 (10 then 190 after linger), unseal, stairs, banner OK. Max Ammo hidden (finding 1). Round does not break while outside zombies live (finding 3) |
| 5 | Stairs → fade → L2: look, torches, new layout, doors closed, box reset, kept stats, banner, round continues | PASS | Played via F on stairs; points/weapons/health kept, 5 doors closed, round 4 → break |
| 6 | L2 walls sell new guns 200–350, feel stronger; tougher/faster zombies; boss 2 named; L2 stairs → L3 | PARTIAL | Prices 200–300 OK (HVK-30 125 in start room is an L1 gun). Gorgon, Drakon, Marshal not stronger (finding 2). Zombies ×1.5 HP, faster; THE BONE PRIEST; L3 = BUNKER, loop 1 |
| 7 | Restart anywhere → L1 clean, no duplicate listeners | PASS | Restart from L3 mid-fight: L1, round 0, 0 pts, boss idle; one event per kill; death mid-fight → gameover |
| 8 | npm test / zero console errors / frame < 3 ms | PASS (errors, frame) | 0 console errors all session; 0.47 ms/step with boss + 10 minions + 24 zombies. npm test not run by QA-1 (integrator: 370/370) |

## Screenshots (`docs/screenshots/`)

- `wo5-qa-megadoor-blocked.png`: L1 vault, "MEGA DOOR — open all doors first", label under player.
- `wo5-qa-arena-sealed.png`: fight start, boss bar, SEALED plates, lingering "MEGA DOOR OPENED" text.
- `wo5-qa-charge-telegraph.png`: WARDEN mid-telegraph (flash + faint ring).
- `wo5-qa-stairs-open-maxammo-hidden.png`: open stairs with DESCEND plate; Max Ammo under the pool.
- `wo5-qa-l2-chapel.png`: L2 start (Chapel), catacomb theme and torches.
- `wo5-qa-l2-ossuary-weevil.png`: Ossuary, Weevil just bought.
- `wo5-qa-l2-bone-chamber.png`: Bone Chamber, Man-O-War / Haymaker walls.
- `wo5-qa-l2-crypts.png`: West Crypts, XR-2 wall.
- `wo5-qa-l2-charnel-label-overlap.png`: Charnel Pit, box, "48 DREDGE" label under the HUD level label.
- `wo5-qa-l2-sanctum-megadoor.png`: Sanctum, L2 mega door, Gorgon / Drakon.
- `wo5-qa-l2-stairs-maxammo-hidden.png`: L2 arena after the BONE PRIEST, Max Ammo hidden again.
- `wo5-qa-guns-in-hand.png`: 5× crops of the soldier holding ICR-1, KN-44 and the eight L2 guns.
- `wo5-qa-l3-bunker-repeat.png`: level 3 = BUNKER again; ARGUS label under the weapon panel.
- `wo5-qa-l3-boss-crowd.png`: L3 WARDEN + 10 minions + 24 zombies (perf / readability).
