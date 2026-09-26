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
zone can be bought for 250 (before that its prompt reads "MEGA DOOR — open all doors first").
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
and round number; doors, barricades, the box and the boss reset. After the last level the stairs
loop back to level 1's layout with a compounding difficulty multiplier (level 3 = loop 1, and so
on). Restarting always returns to level 1.

## Controls

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Fire |
| Shift | Sprint |
| R | Reload |
| F or E | Buy / open doors / interact (hold to rebuild barricades) |
| 1 / 2, Q, mouse wheel | Swap weapon |
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
- **Buttons:** RELOAD and SWAP (bottom right), pause (top right), and an ACTION button
  (bottom centre) that appears next to a wall buy, door, box or barricade. Tap it to buy or open;
  hold it to rebuild a barricade.
- **Override:** add `?touch=1` to force the touch scheme (e.g. to try it in desktop Chrome; the
  mouse drives the sticks) or `?touch=0` to force desktop controls on a touch device.
  With `?debug=1`, `__game.debug.mobile()` returns the detection result.

## Debug

Open http://localhost:8080/?debug=1 to expose `window.__game` with helpers such as
`__game.debug.spawnPowerup('nuke')`, `skipToRound(10)`, `addPoints(1000)`, `god(true)`,
`doors()`, `openDoor(id)`, `openAllDoors()`, `step(seconds, frameDt, inputOverrides)`.

Boss and levels: `openMegaDoor()` (opens every door, then the mega door, for free),
`startBoss()` (teleports into the arena and starts the fight), `killBoss()` (kills the boss
like a weapon kill: 200 points, stairs open), `boss()` (fight state), `descend()` (opens the
stairs if needed and starts the fade to the next level), `setLevel(i)` (loads level index `i`
at once; 0 = bunker, 1 = catacombs, 2 = bunker loop 1, ...), and
`setDifficulty({ healthMult, speedMult, countMult, sprintShift })` (edits the current level's
difficulty).

## Tests

```
npm test
```
