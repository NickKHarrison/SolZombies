# Sol Zombies

Top-down round-based zombie survival shooter in the style of Black Ops 3 Zombies. Plain JavaScript and HTML5 Canvas, no build step.

## Run

ES modules do not load from `file://`, so serve the folder over HTTP:

```
npm start
# or
python -m http.server 8080
```

Then open http://localhost:8080

HUD: the Wolfenstein-style face sits in a small steel box in the top-left corner; HEALTH and KILLS sit in the bottom-left in the same style as the ammo readout, with points above them. Health regenerates at 1 HP/s after 4 s without damage.

Map: you start in the hub with one wall gun (Sheiva). The rest of the map is sealed by buyable
doors (BO3 style): stand next to a door and press F to open it for points (75-150). Each door
unlocks a new zone with its own wall guns and zombie spawns; zombies only spawn in zones you have
opened, and the mystery box is two doors deep.

Mega door and boss: once all five doors on a level are open, the iron **mega door** in the deepest
zone can be bought (before that its prompt reads "MEGA DOOR — open all doors first").
Its price rises by 250 per level: **250** on
level 1, **500** on level 2, **750** on level 3, **1000** on level 4, and so on for later loops.
It leads into the boss arena. Stepping inside seals the door behind you and starts the boss fight:
normal rounds pause, a boss bar appears, and the boss (THE WARDEN on level 1, THE BONE PRIEST on
level 2) hunts you, telegraphs a charge (it flashes white, then dashes; it is stunned if it hits a
wall) and summons fast, small minions every 12 s (up to 10 alive). Power-ups are weaker against
the boss: Insta-Kill hits deal 5 % of its health, a Nuke 10 %, and the Thundergun 15 % up close
plus a knockback. The boss is worth 200 points and always drops a Max Ammo. Its death unseals the
mega door, ends the round and opens the **staircase** ("STAIRS OPENED").

Levels: press F on the open stairs to descend. The screen fades and the next level loads: level 2
is the **Catacombs**, a new layout with torch-lit bone-and-stone walls, tougher zombies (1.5x
health, faster, more of them, more sprinters) and new, stronger guns on the walls (Weevil, XR-2,
Man-O-War, Marshal 16, 48 Dredge, Gorgon, plus Haymaker 12 and Drakon; 200-350 points). The new
guns are also in the mystery box. You keep your points, weapons, ammo, health, active power-ups
and round number; doors, barricades, the box and the boss reset.

Level 3 is the **Laboratory**: a clinical lab of pale green-grey tiles, steel-blue walls, glass
tanks and flickering fluorescent lights, with tougher zombies again (2x health, 1.2x speed, 1.5x
count). Its walls sell the three tier-3 guns (HG 40 350, M8A7 375, Peacekeeper MK2 400; also in
the box) plus the Gorgon and Drakon. Its boss, **THE SUBJECT**, does not charge: every 6 s it
stops, gurgles and lobs three acid globs at you; each leaves a green pool for 5 s that burns 25
HP/s while you stand in it. After the last level the stairs loop back to level 1's layout with a
compounding difficulty multiplier (level 4 = BUNKER II, and so on). Restarting always returns to
level 1.

Perks: every level has six perk machines in its walls (Quick Revive in the start room, Mule Kick
in the deepest zone). Stand next to one and press F to buy; you can hold at most **four** perks
and they carry over when you descend.

| Perk | Cost | Effect |
|------|------|--------|
| Juggernog | 250 | Max health 150 -> 250 (heals to full) |
| Quick Revive | 50 | When you go down you get back up after 1.5 s at full health with 2 s of invulnerability, but lose **all** your perks. Three purchases per game, then the machine is SOLD OUT |
| Speed Cola | 300 | Reloads twice as fast |
| Double Tap II | 200 | Fire rate x1.33 and bullet damage x2 (hitscan guns only for the damage; the Death Machine is unaffected) |
| Stamin-Up | 200 | Move speed x1.07, sprint x1.2 |
| Mule Kick | 400 | Third weapon slot (key 3); losing the perk drops the third gun |

Pack-a-Punch: every level has one **Pack-a-Punch** machine (purple cabinet with a gold marquee)
in the deepest zone, behind the last door (H), near the mega door: the vault on level 1, the
sanctum on level 2, the reactor room on level 3. Hold the gun you want upgraded and press F
("Press F to Pack-a-Punch KN-44 [500]"): you pay **500**, the gun slides into the machine, it
works for 3 s (sparks and a jingle), then the upgraded gun waits on the tray until you take it
(F again, "Press F to take Warden's Wrath"). It returns to the slot it came from and is made
active. An upgraded gun keeps its identity but gets a new name (shown in gold with a ★ in the HUD)
and a purple-and-gold camo: **x2 damage**, **x1.5 magazine and reserve** (filled on upgrade),
tighter spread and +1 penetration. Against the boss an upgraded gun deals only **x1.25** its base
damage (not x2; minions and normal zombies take the full x2), and the Ray Gun / Thundergun boss
rules are unchanged. Its wall ammo at its own wall buy costs 3.75 x the normal ammo price, capped
at **450** (KN-44 281, Man-O-War 281, Peacekeeper 450); Max Ammo refills it as usual. Examples: MR6 -> Nightingale, KN-44 -> Warden's Wrath, Sheiva -> Fallen
Comrade, ICR-1 -> Infinity Reaper, Peacekeeper MK2 -> Peacemaker. The wonder weapons become the
**Porter's X2 Ray Gun** (x2 direct hit, splash damage and radius x1.5) and the **Zeus Cannon**
(Thundergun: kill range x1.25, range x1.15, knockback x1.2, bigger mag and reserve). You cannot
upgrade a gun twice, the Death Machine ("Cannot upgrade a power-up weapon"), or while another gun
is inside ("Machine busy"). Descending with a gun inside returns it to you upgraded on the next
level; a restart empties the machine. The game over summary shows "Upgrades: N", and a favourite
weapon that scored kills while upgraded is shown by its upgraded name with a ★. On touch, a blocked
prompt ("already upgraded", "Machine busy", mega door before all doors, ammo full, ...) greys the
ACTION button and a tap does nothing; an unaffordable one is greyed but still tappable.

Knife: press **V** (or the KNIFE touch button) for a quick melee swing: 150 damage to up to three
zombies in a short arc in front of you, a small knockback, and a knife kill pays 15 (10 + 5 bonus).
It has a 0.5 s cooldown and cancels a reload.

High scores: the game over screen shows a run summary (rounds, kills, points, accuracy, time,
level, bosses, perks, favourite weapon), your rank ("#3 ALL TIME", "NEW BEST ROUND!") and the top 5.
The menu shows your best run and the top 5. The top 10 are saved in the browser's localStorage
(`solzombies.scores.v1`); in private mode the table lasts only for the session.

## Controls

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Fire |
| Shift | Sprint |
| R | Reload |
| F or E | Buy / open doors / interact (hold to rebuild barricades) |
| V | Knife |
| 1 / 2 / 3, Q, mouse wheel | Swap weapon (3 = Mule Kick slot) |
| Enter / Space | Start / restart |
| Esc / P | Pause |
| Backquote | Toggle debug overlay |

## Mobile (touch)

Phones and tablets are detected automatically (coarse pointer, or a touch screen whose shorter
side is under 900 css px) and switch to a twin-stick touch scheme. Desktop is unchanged.

- Play in **landscape**. In portrait a "Rotate your phone" overlay is shown and the game pauses;
  it resumes when you turn the phone back. The first tap requests fullscreen and a landscape
  lock (best effort, depending on the browser).
- **Tap anywhere** to start, and to restart after game over.
- **Left half:** touch anywhere to spawn a move stick; drag to move, push to the edge to sprint.
- **Right half:** aim stick. Drag to aim; drag past about a third of the way to auto-fire.
  Releasing keeps the last facing.
- **Buttons:** RELOAD, KNIFE and SWAP (bottom right), pause (top right), and an ACTION button
  (bottom centre) that appears next to a wall buy, perk machine, door, box or barricade. Tap it to buy or open;
  hold it to rebuild a barricade.
- **Override:** add `?touch=1` to force the touch scheme (e.g. to try it in desktop Chrome; the
  mouse drives the sticks) or `?touch=0` to force desktop controls on a touch device.
  With `?debug=1`, `__game.debug.mobile()` returns the detection result.

## Debug

Open http://localhost:8080/?debug=1 to expose `window.__game` with helpers such as
`__game.debug.spawnPowerup('nuke')`, `skipToRound(10)`, `addPoints(1000)`, `god(true)`,
`doors()`, `openDoor(id)`, `openAllDoors()`, `step(seconds, frameDt, inputOverrides)`.
Note: `addPoints(n)` adds to the balance only; it is not counted in the run's "Points earned"
(`stats.pointsEarned`), so screenshots taken after `addPoints` show balances real play never
reaches.

Boss and levels: `openMegaDoor()` (opens every door, then the mega door, for free),
`startBoss()` (teleports into the arena and starts the fight), `killBoss()` (kills the boss
like a weapon kill: 200 points, stairs open), `boss()` (fight state), `descend()` (opens the
stairs if needed and starts the fade to the next level), `setLevel(i)` (loads level index `i`
at once; 0 = bunker, 1 = catacombs, 2 = laboratory, 3 = bunker II, ...), and
`setDifficulty({ healthMult, speedMult, countMult, sprintShift })` (edits the current level's
difficulty).

Perks, knife and scores: `givePerk(id)` (free, through the normal cap/uniqueness rules; ids
`jugg`, `revive`, `speed`, `dtap`, `stamin`, `mule`), `perks()`, `removePerks()`, `knife()` (one
swing, respects the cooldown), `scores()` (best + top 5), `clearScores()` (wipes the saved
table).

Pack-a-Punch: `pap()` (machine summary: state, timer, gun inside, upgrade count, machine
position), `papStart()` / `papTake()` (the real shop paths with price, blocked cases and events,
but no distance check), `upgrade()` (upgrades the active gun for free, not counted). To use the
machine for real, stand next to it and call `step(dt, dt, { interact: true })`.

## Tests

```
npm test
```
