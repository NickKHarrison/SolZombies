# WO8 QA-1: Playtest (Pack-a-Punch)

## Run setup
- **Server:** `python -m http.server 8272`.
- **Desktop:** Chrome at `/?debug=1` with a 1920×902 viewport and a 1280×720 canvas.
- **Touch:** `/?debug=1&touch=1` with `#stage` forced inline to 844×390 (a landscape phone). The mobile zoom was 1.96.
- **Driver:** `__game.debug.step(dt, dt, overrides)` with `interact`, `fire`/`firePressed`, `mouseX/Y` and `debugKey`. The debug flow-field overlay was turned off for the screenshots. I used a small in-page aim-and-fire bot.
- **Code state:** after Phase 4a (economy #1, #2 and #5, the tray-plate clearance, the favourite ★ name, and the greyed touch prompt).

## What was played
1. **Level 1.**
   - I bought doors D, E, F, G and H through the real interact path (75/100/100/125/150). Then I walked into the vault behind H.
   - The machine is visible as soon as you step through H.
   - I bought the KN-44 at its wall (150).
   - At the machine the prompt read "Press F to Pack-a-Punch KN-44 [500]". I paid 500.
   - Events: `pap:start {kn44, slot 1}`, then `purchase:made {pap, 500}`. The prompt changed to "Machine busy".
   - After 3 s the machine was ready ("Press F to take Warden's Wrath"). I took the gun and it went back to slot 1.
   - Stats after the upgrade: dmg 140, 45/360, pen 2.
2. **Rounds.**
   - Round 9, a 20 s aim-and-fire bot run with the same seed, map and position:
     - base KN-44: 4 kills;
     - Warden's Wrath: 10 kills.
   - The upgrade is clearly felt.
3. **Boss.**
   - Setup: L1 THE WARDEN (9,900 HP) with Warden's Wrath and Fallen Comrade, a static aim bot and god mode on.
   - The kill took about 15 s. That is in line with the Phase 4a median TTK of 19 s for a moving player.
   - No errors.
4. **Upgraded ammo.**
   - The KN-44 wall with Warden's Wrath read "Press F to buy ammo [281]".
   - It charged 281 and refilled the gun to 45/360.
5. **Ray Gun and Thundergun through the machine.**
   - Ray Gun: "Pack-a-Punch Ray Gun [500]", then "take Porter's X2 Ray Gun". Damage 2000, 30/240. A live shot's splash ring is clearly bigger.
   - Thundergun: "take Zeus Cannon", 6/18. One blast killed 8 zombies placed out to about 330 px.
6. **Blocked cases** (all verified with no charge):
   - "… is already upgraded";
   - "Cannot upgrade a power-up weapon" while the Death Machine was held;
   - "Machine busy";
   - can't afford (120 points): `purchase:denied {pap, mr6, 500, have 120}` and the machine stayed idle.
7. **Descending with a gun inside.**
   - L-CAR 9 was `working` when I called `descend()`.
   - On CATACOMBS it was back in slot 1 as Gravedigger and active. The machine was idle and papCount went up by 1.
8. **Level 2 machine** (CATACOMBS): checked, with the mega door plate at **500**.
9. **Level 3 machine** (LABORATORY): I upgraded a Peacekeeper to Peacemaker (45/405) through the machine. The mega door plate reads **750**.
10. **Death and restart.**
    - I died on L3 with an HG 40 `working` in the machine.
    - Game over showed "Upgrades 5" and "Favourite weapon ★ Warden's Wrath". The top-runs entry stored `pap: 5`.
    - Restart gave BUNKER, an idle machine, papCount 0 and `[MR6, –]`.
11. **Touch (844×390).**
    - A real tap on ACTION ("Pack-a-Punch KN-44 [500]") bought the upgrade.
    - The button then read "Machine busy", greyed (`blocked`).
    - At ready it read "Take Warden's Wrath"; a tap took the gun.
    - Then "Warden's Wrath is already upgraded" showed greyed.
    - With 100 points the button was red-tinted (`cant-afford`).
    - Near the mega door before all doors were open: "MEGA DOOR — open all doors first", greyed.
12. **Camo survey.**
    - I held every one of the 30 guns base and upgraded, facing right, and cropped the live canvas at game scale.
    - Contact sheet: `wo8-qa-camo-sheet-a.png` and `wo8-qa-camo-sheet-b.png` (3× nearest-neighbour).

**Console errors: none.** An `error`/`unhandledrejection`/`console.error` hook ran on both pages (desktop and touch) and caught nothing. `read_console_messages` (onlyErrors) was also empty.

Harness note:
- With `setTimeScale(0)`, `step()` does not advance either, because `tick()` scales dt. I froze the frame only after stepping, and only for screenshots.
- While driven by `step` overrides, the held-gun sprite follows the real mouse, not the override `mouseX/Y`, even though shots go where the override says. This is a harness artifact and not reported.

## Overall verdict
- **Easy to find, and it reads as Pack-a-Punch.** The machine is the only purple-and-gold cabinet with a lightning glyph, a glow and two "PACK-A-PUNCH 500" plates. On L1 it is on screen the moment you step through door H.
- **Upgrade flow.** The slide-in, the 3 s of sparks, the camo gun bobbing on the tray and the sparkle burst on take together feel good.
- **Camo.** It is legible and looks good on every rifle, SMG, shotgun, LMG, sniper and wonder weapon. The gold stock/drum accents on the KN-44, HVK-30, ICR-1, Sheiva and 48 Dredge are a highlight.
- **HUD.** The ★ gold names are clean on desktop.
- **Prompts.** They are clear on both schemes. The greyed blocked button reads correctly on touch.
- **No blocker and no major issue.** The findings below are minor or cosmetic polish.

## Findings

1. **MINOR: The PaP machine and Mule Kick use the exact same purple, and they sit on the same screen on L1 and L2.**
   - **File/function:** `src/config.js` `PERKS.list.mule.color = '#b44dff'`, and `src/render.js` `PAP_PURPLE = '#b44dff'` (`paintPapMachine`, `drawPap`).
   - **Repro:** On L1, step through door H. Mule Kick (a magenta-purple cabinet with a glow) is about 6 tiles south-east of the PaP. On L2 both are in the sanctum view (`wo8-qa-l2-machine-mega500.png`; Mule Kick is off-frame bottom-left in the full screenshot). On L3 both appear together too.
   - **Expected:** Pack-a-Punch has a colour identity of its own, so a new player does not walk to the wrong purple box.
   - **Actual:** Both use the same hue and a similar glow. The plates tell them apart, but at a glance they read as "two purple machines".
   - **Fix:** Keep the PaP purple and shift Mule Kick towards magenta/pink (e.g. `#e04cc8`), or make the PaP body darker violet with a stronger gold frame. A palette-only change.
   - **Resolution (FIX-A):** fixed. `PERKS.list.mule.color` is now `#ff4fd8` (magenta/pink); the PaP keeps `#b44dff`. The perk cabinet and HUD bottle read the config colour.

2. **MINOR: With three guns on touch, the third holstered name is hidden completely once names are upgraded.**
   - **File/function:** `styles.css` `#hud.mobile .hud-weapon-secondary` (the WO7 FIX-2 single line, `nowrap` plus `text-overflow: ellipsis`) together with `hud.js` upgraded names.
   - **Repro:** `&touch=1` at 844×390. Get Mule Kick and hold Porter's X2 Ray Gun, Judge & Jury and Sekhmet's Ire, all upgraded.
   - **Actual:** The line reads "★ JUDGE & JURY ·…". The third gun is not visible at all (`wo8-qa-touch-hud-three-upgraded.png`). With base names ("SHEIVA · KN-44") it fit.
   - **Expected:** Both holstered guns are identifiable.
   - **Fix:** Pick one:
     - allow two lines for the secondary list on mobile (it is already hidden while reloading);
     - drop the "★ " prefix in the compact list and colour-code gold only;
     - shorten each name to its first word (for example "★ JUDGE · ★ SEKHMET'S").
   - **Resolution (FIX-B):** fixed. With two holstered guns the mobile line (`.multi`) shows short names, gold for upgraded and no star: "WARDEN · GRAVEDIGGER", "JUDGE · SEKHMET". It uses a 9 px font and may reach 3.5cqh left of the readout, which is still right of the right stick's base and below KNIFE. Each name also shrinks and ellipsises on its own, so the longest pair still shows the start of both. At 844×390 all three test pairs fit untruncated. With one holstered gun, and on desktop, the full names are unchanged.

3. **MINOR: The wall-buy "ammo full" prompt uses the base name for an upgraded gun, and the ammo prompt never says the price is for upgraded ammo.**
   - **File/function:** `src/shop.js` `buildPrompt` (wallbuy branch, around line 147): `` `${weaponName(id)} ammo full` `` and `` `Press F to buy ammo [${cost}]` ``.
   - **Repro:**
     1. Hold Warden's Wrath, stand at the KN-44 wall and buy ammo (281). The prompt changes to "KN-44 ammo full".
     2. Before buying, it reads "Press F to buy ammo [281]". A player who paid 150 for the gun sees ammo cost jump from 75 (shown as the gun price on the chalk plate) to 281 with no explanation.
   - **Expected:** "Warden's Wrath ammo full" and "Press F to buy upgraded ammo [281]", as in BO3's "Upgraded Ammo".
   - **Fix:** Use `owned.def.name` in the full text, and add "upgraded " to the buy text when `isUpgraded(owned)`. Mirror this in the touch label.
   - **Resolution (FIX-A):** fixed. "<Upgraded name> ammo full" and "Press F to buy upgraded ammo [281]" (touch: "Buy upgraded ammo [281]").

4. **MINOR (UX): Getting the gun back on descent is silent.**
   - **File/function:** `src/level.js` `returnPapWeapon` (no `pap:done`, by design), and `hud.js`.
   - **Repro:** Put the L-CAR 9 in the machine, then `descend()`. On CATACOMBS the player is holding Gravedigger with no banner, sparkle or toast. It only emits `weapon:equipped`.
   - **Expected:** A short cue so the player knows the machine gave the gun back (and upgraded it). Otherwise a player who descended thinking "I lost my 500" may not notice.
   - **Fix:** Emit a distinct event, e.g. `pap:returned { weaponId }`, or reuse the existing `pap:done` HUD banner path without the render sparkle and audio, so `hud.js` shows "GRAVEDIGGER RETURNED".
   - **Resolution (FIX-A):** fixed without a new event. `level.startLevel` pushes a gold floating text "<UPGRADED NAME> RETURNED" (for example "GRAVEDIGGER RETURNED") just above the player after the hand-back. Test in `tests/level.test.js`.

5. **COSMETIC: The side plate at the use tile is covered by the player while they use the machine.**
   - **File/function:** `src/render.js` `paintPapMachine` (plates on every floor side). Phase 4a's `PAP_TRAY_LABEL_CLEAR` only moves the tray-side plate, further onto the use tile.
   - **Repro:**
     - L1: stand west of the machine, the natural approach from door H. The west "PACK-A-PUNCH 500" plate sits exactly on the player sprite ("PACK-A-P▒NCH / 5▒0").
     - L2: the pushed-out north plate sits on the player standing north.
     - L3: the same on the west side.
     - Screenshots: `wo8-qa-l1-machine-ready.png`, `wo8-qa-l2-machine-mega500.png`, `wo8-qa-l3-machine-ready.png`.
   - **Expected:** Plates that do not sit under the player's feet on the tile where you interact.
   - **Actual:** Harmless, because the HUD prompt says the same thing, but it looks cluttered. Two plates per machine is also redundant.
   - **Fix:** Draw a single plate on the non-front side, or above the cabinet. Alternatively, offset side plates to the tile corner, as the perk plates do. Same art, fewer overlaps.
   - **Resolution (FIX-B):** fixed. There is now one plate per machine. `papPlatePlacement` scores every side, plus the same side one tile further out, by the floor the plate covers: use tiles ×100, diagonal tiles ×10, other floor ×1. It picks a wall side: L1 east, L2 west, L3 east. No plate touches a use tile or the tray.

6. **COSMETIC: The "working" phase is subtle at game scale.**
   - **File/function:** `src/render.js` `drawPapSparks` and `drawPap`.
   - **Repro:** L1 at desktop scale during the 3 s `working` phase (`wo8-qa-l1-machine-working.png`). A few thin white/violet sparks sit on the top edge of a one-tile cabinet. The slide-in (0.6 s) and the take sparkle (`wo8-qa-touch-take-blocked.png`) are the satisfying parts. The middle 2.4 s mostly look idle apart from a slightly brighter glow.
   - **Expected:** A clearly "busy" machine (BO3 shakes and flashes).
   - **Fix:** Add a 1–2 px horizontal shake of the cabinet sprite, or a pulsing glow radius, while `working`. A brief gold flash at the working→ready switch would help too.
   - **Resolution (FIX-B):** fixed. After the slide, the cabinet is re-blitted from the static layer with a 1–2 px jitter at about 30 Hz (off under prefers-reduced-motion). A bigger purple halo breathes, and the slot pulses purple↔gold at 3 Hz. There are 20 thicker, longer sparks plus a 6-star burst from the slot every 0.5 s, and a 0.35 s gold flash at working→ready.

7. **COSMETIC: The pistol camo is dark and low-contrast at game scale.**
   - **File/function:** `src/render.js` `papSprite` (PAP_VIOLET ramp; the darkest steps `[36,12,60]` and `[68,22,114]` are close to the outline black).
   - **Repro:** Look at the MR6★, RK5★ and L-CAR 9★ on the contact sheet (`wo8-qa-camo-sheet-a.png`, row 2, first three cells). The small pistol sprites turn mostly deep violet. The gold flecks fall on only 0–1 pixels, and on dark floors the gun silhouette nearly disappears. Rifles and bigger guns look great.
   - **Fix:** For sprites narrower than about 14 px, clamp the camo ramp index to at least 2. Alternatively, always put one gold pixel on the slide or grip.
   - **Resolution (FIX-B):** fixed. Sprites narrower than 14 px (the pistol art used by MR6, RK5 and L-CAR 9, and the default art) get a light violet base (ramp steps 2–4 only) with every third 2-px diagonal stripe gold. They read clearly on the tray and in hand.

8. **POLISH (optional): The wonder-weapon effects are not upgraded visually.**
   - **File/function:** `src/render.js`, projectile and thunder-cone drawing.
   - **Repro:** Porter's X2 fires the same green bolt and green splash as the base Ray Gun (`wo8-qa-porters-x2-splash.png`). Zeus Cannon uses the same grey/blue cone (`wo8-qa-zeus-cannon-blast.png`). Scaling works: the splash ring is visibly bigger, and one blast killed 8.
   - **Expected (BO3 flavour):** Porter's X2 fires red bolts, and the Zeus Cannon blast has a golden or violet tint.
   - **Fix:** Tint the projectile and cone by `w.upgraded` (palette-only).
   - **Resolution (FIX-B):** fixed. Porter's X2 bolts (`isUpgraded(b)` on the bullet's def), the splash and the muzzle flash are red-pink. The Zeus Cannon shockwave arcs, fill and dust are gold-white. Explosion and shockwave effects carry no weapon, so each is latched as upgraded on its first draw when its radius or range matches `weapons.UPGRADES[id]` (checked with `isUpgraded`) and not the base def. Base guns stay green and cyan (verified).

Pre-existing and out of WO8 scope, noted for the record:
- World plates such as "MULE KICK 400", "ARGUS 150" and "STAMIN-UP" can sit under the HUD weapon readout, the touch KNIFE/RELOAD buttons and the KILLS label when the camera is clamped at a map edge.
- The blocked mega-door prompt doesn't include the price, but both plates show it (250/500/750).

## Section 5 acceptance (playtest view)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | One PaP machine per level in the deepest zone; clear label; 500 points | **PASS** | L1 (51,32), L2 (38,31), L3 (56,11), each behind door H near the mega door. "PACK-A-PUNCH 500" plates. Findings 1 and 5 are cosmetic. |
| 2 | Paying removes the gun, 3 s animation + jingle, gun waits on the tray; returns to the same slot with the new name, ×2 damage, bigger mag/reserve, camo, gold ★; wall ammo for it at the upgraded price | **PASS** | KN-44 slot 1 → Warden's Wrath slot 1, 70→140, 30/240→45/360. Camo and glow in hand. Upgraded ammo is 281 after Phase 4a (economy #5; 450 is the cap). The jingle was checked by event only; I did not listen to it. Finding 6 (subtle working phase). |
| 3 | Ray Gun / Thundergun upgrades apply their scaling | **PASS** | Porter's X2: 2000 damage, 30/240, larger splash ring. Zeus Cannon: 6/18, one blast killed 8 out to about 330 px. |
| 4 | Blocked cases: already upgraded, Death Machine, busy, cannot afford | **PASS** | All refused with no charge. `purchase:denied` on a broke player. Touch shows greyed (blocked) or red-tinted (can't afford). |
| 5 | Dying or descending with a gun inside never loses it; restart resets | **PASS** | Descend: Gravedigger returned and active. Restart: idle machine, papCount 0. Finding 4 (silent return). |
| 6 | Game over "Upgrades: N"; scores store it | **PASS** | "Upgrades 5", `pap: 5` in top runs, favourite "★ Warden's Wrath". |
| 7 | Economy applied; frugal player affords one upgrade by each boss | **n/a (QA-1)** | The mega door prices 250/500/750 are visible and clear on the plates. Boss TTK with the upgraded gun was about 15 s (static bot), which fits Phase 4a. Affordability is covered by `wo8-economy.md` and QA-2. |
| 8 | Zero console errors; works on touch | **PASS** | No errors on desktop or touch. The touch buy/take/blocked flow works with real taps. Finding 2 (third holstered name hidden). |

## Screenshots (`docs/screenshots/`)
- `wo8-qa-l1-machine-working.png`: the L1 machine during `working` (sparks), with Mule Kick in the same frame.
- `wo8-qa-l1-machine-ready.png`: the Warden's Wrath camo on the tray. The west plate sits under the player.
- `wo8-qa-camo-sheet-a.png` and `wo8-qa-camo-sheet-b.png`: all 30 guns, base (top row) against upgraded (row below), cropped from the live canvas at game scale ×3.
- `wo8-qa-hud-three-stars-desktop.png`: desktop HUD with three ★ gold names (Porter's X2 Ray Gun, Judge & Jury, Sekhmet's Ire).
- `wo8-qa-porters-x2-splash.png`: the Porter's X2 splash.
- `wo8-qa-zeus-cannon-blast.png`: the Zeus Cannon blast killing 8.
- `wo8-qa-l2-machine-mega500.png`: the L2 machine and the mega door plates at 500.
- `wo8-qa-l3-machine-ready.png`: the L3 machine with Peacemaker on the tray.
- `wo8-qa-touch-machine-busy.png`: touch, the greyed "Machine busy" button and the KN-44 sliding in.
- `wo8-qa-touch-take-blocked.png`: touch, the take sparkle, the camo gun at mobile zoom, the greyed "already upgraded" button and the two-line gold name.
- `wo8-qa-touch-hud-three-upgraded.png`: touch, the third holstered name hidden (finding 2).
- `wo8-qa-touch-cant-afford.png`: touch, the red-tinted can't-afford PaP button.
