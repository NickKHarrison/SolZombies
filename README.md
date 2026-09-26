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

## Debug

Open http://localhost:8080/?debug=1 to expose `window.__game` with helpers such as
`__game.debug.spawnPowerup('nuke')`, `skipToRound(10)`, `addPoints(1000)`, `god(true)`,
`doors()`, `openDoor(id)`, `openAllDoors()`.

## Tests

```
npm test
```
