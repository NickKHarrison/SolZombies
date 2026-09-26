# Integration WO3 — Agent C verification

Date: 2026-09-26. Served with `python -m http.server 8112`, Chrome (new tab), `/?debug=1`.
Browser viewport 1920×902 (stage 1603×902, 16:9), plus a forced `#stage` of 960×540.
Driven with `__game.debug.step`, `setHealth(hp,false)`, `addPoints`, `damagePlayer`,
`spawnPowerup('fireSale')`, `teleport`, `skipToRound`, `restart`.

No code fixes were needed: Agent A changed `styles.css` and Agent B changed `src/config.js`, and I
changed no code files. `npm test` 263/263 green, and `node --check` passes on every `src/**/*.js`.

## Results

| # | Check (WO3 3.3) | Result | Evidence |
|---|-----------------|--------|----------|
| 1 | Bezel lower-left, ~20 % smaller | PASS | left 3.00cqh, bottom 3.00cqh; height 17.20 % of the canvas (92.9 px at 540p); face 76.8×96.0 px at 720p equivalent; bevel, rivets and recessed face look intact; the face animates (grin after a buy, dead face at game over) |
| 2 | Points directly above bezel, left-aligned; +N and spend flicks | PASS | same left edge as the bezel, gap 1.20cqh; `addPoints(10)` adds `.hud-flick.gain` "+10"; buying the Sheiva (50) adds `.hud-flick.spend` "-50" |
| 3 | Prompt and Fire Sale banner bottom-centre at 6cqh | PASS | prompt bottom = 6.0cqh from the canvas bottom, centred at 50 %; banner stacks above the prompt |
| 4 | No overlaps at 1280×720-class and at 960×540 | PASS | pairwise rectangle test over round, points, bezel, prompt, weapon and power-up chips found 0 overlaps. Round-counter bottom is about 43.5cqh from the canvas bottom and the points top about 28.6cqh. Weapon readout untouched |
| 5 | Bezel width constant at 100 % / 7 % / 0 % | PASS | 546.45 px at 100 %, at a low value (~7–8 %) and at 0 % (game over) |
| 6 | Menu hides bezel + points; game over shows dead face; pause shows it | PASS | menu: `.hud-status` is `display:none` and the points are not visible on screen. Game over: bezel shown with the dead face and 0 %, points `display:none`. Paused: bezel and points visible |
| 7 | Regen: 50 HP, 4 s → 50, +10 s → 60 (±1), ~0.67 %/s, damage resets delay | PASS | 3.9 s: 50; 4.0 s: 50; 14 s: 60 (HUD 34 % → 40 %); measured 0.667 %/s. After `damagePlayer(10)`: no gain for 3.75 s, then +1 HP/s |
| 8 | npm test green, node --check clean, zero console errors menu → round 2 → death → restart | PASS | 263/263. The only console exceptions came from a third-party Chrome extension (`chrome-extension://…/s2k-listener.js`); the game logged none. After restart, `addPoints(10)` gives exactly 10, so listeners are not duplicated |
| + | Wrapped Mystery Box FIRE SALE prompt | PASS (tight) | "Press F for Mystery Box [10] FIRE SALE" wraps to two lines inside the ~47cqh cap. At 1603×902 the prompt's left edge sits 15 px (1.7cqh) right of the bezel; at 960×540 the gap is 10 px (1.9cqh). The banner text at its 1.3 intro scale starts 9 px right of the bezel. No overlap, but the margin is small; if the cap ever grows past ~50cqh it will collide |

## Screenshots

- `docs/screenshots/wo3-default-1280x720.png`: default play, bezel lower-left, points above it
- `docs/screenshots/wo3-prompt-after-buy.png`: prompt at bottom-centre 6cqh, grin face after the buy
- `docs/screenshots/wo3-firesale-banner-wrapped-prompt.png`: FIRE SALE! banner above the wrapped box prompt
- `docs/screenshots/wo3-stage-960x540.png`: stage forced to 960×540
- `docs/screenshots/wo3-gameover.png`: dead-face bezel, points hidden
- `docs/screenshots/wo3-paused.png`: paused, bezel and points visible
- `docs/screenshots/wo3-menu.png`: menu, no bezel and no points

## Notes

- `__game.debug.setTimeScale(0)` also freezes `debug.step` (dt is multiplied by timeScale).
  Reset it with `setTimeScale(1)` before any timed check.
- The banner fades out on a 3 s CSS animation. For the screenshot I paused it with
  `el.getAnimations()[0].pause(); currentTime = 1200`.
