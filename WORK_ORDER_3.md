# WORK ORDER 3 — Status bezel to the lower-left, slower health regen

Follow-up to `WORK_ORDER_2.md` (complete: 260 tests green). Two refinements:

1. **The status bezel (health % / face / kills) blocks gameplay at the bottom middle.** Move it to
   the **lower-left corner** and make it **about 20 % smaller**. The points readout that lives in
   the lower-left today moves to sit directly above the bezel. The buy prompt and Fire Sale
   banner return to the plain bottom-centre position they had before the bezel existed.
2. **Health regenerates far too fast** (currently 60 HP per second once the 4 s delay passes,
   so a full heal takes 2.5 s). Change it to **1 HP per second**. The 4 s delay before regen
   starts is unchanged.

Small order: **3 parallel agents in Phase 1, then 1 verification agent.** Same rules as before.

---

## 0. Rules (unchanged)

- One file, one owner (Section 2). Edit only your files. Targeted edits on shared files.
- Frozen: everything not listed in Section 2.
- `npm test` is `node --test "tests/*.test.js"` (never `node --test tests/`). Keep it green.
  `node --check` on every JS file you touch.
- Verify in the browser with the Chrome tools (serve with `python -m http.server <port>`, open a
  NEW tab, use `window.__game.debug.step(1/60)` when the tab does not animate, screenshot).
  Stop your server and close your tab when done.
- No git, no deletes outside your files, no network, no questions: decide and document.

---

## 1. Target

### 1.1 Layout (1280×720 reference, all sizes in `cqh` so they scale with the canvas)

```
┌──────────────────────────────────────────────────────────────────┐
│                        [power-up chips]                          │
│                                                                  │
│  ROUND                                                           │
│  (left-centre, unchanged)                                        │
│                                                                  │
│                                                                  │
│                        Press F to buy Sheiva [50]   ← bottom-centre, 6cqh up (v1 position)
│  1250  ← points, above bezel                              MR6    │
│  ┌────────┬──────┬───────┐                              KN-44    │
│  │ HEALTH │ face │ KILLS │  ← bezel, lower-left, 0.8×    30/236  │
│  └────────┴──────┴───────┘                                        │
└──────────────────────────────────────────────────────────────────┘
```

- Bezel anchored `left: 3cqh; bottom: 3cqh`, no centring transform. Every bezel dimension is
  multiplied by a new CSS variable `--status-scale: 0.8` (height 21.5cqh → 17.2cqh, cell width
  26cqh → 20.8cqh, face 13.33×16.67cqh → 10.67×13.33cqh, fonts, padding, border, gap, rivets).
  The face canvas stays 24×30 backing pixels with `image-rendering: pixelated`.
- Points block: same left edge as the bezel, `bottom = 3cqh + bezel height + 1.2cqh`. Same font
  size as today. The `+N` flick animation and the spend flick keep working.
- Prompt and Fire Sale banner: `.hud-bottom-center` goes back to `bottom: 6cqh`, centred.
- Nothing overlaps: round counter (left-centre, bottom edge ≈ 42cqh from the bottom) vs points
  top (≈ 26cqh from the bottom); bezel right edge (≈ 3 + 62·0.8 ≈ 53cqh ≈ 34 % of width) vs the
  prompt's left edge at any reasonable prompt length; weapon readout (bottom-right) untouched.
- Menu: bezel and points hidden (as today). Game over: bezel visible with the dead face, points
  hidden (as today). Paused: visible.

### 1.2 Regen

- `PLAYER.regenPerSec: 60 → 1`. `PLAYER.regenDelay` stays 4.0. Regen is continuous (fractional
  HP accumulates each frame), so the HUD percentage ticks down/up smoothly by whole percent.
- Consequence to record, not to "fix": a full heal from 1 HP takes ~150 s, which makes rounds
  5+ noticeably harder than before (v1 balance was tuned against the fast regen). Note it in
  `docs/qa/balance.md` as a follow-up; do not retune anything else in this order.

---

## 2. Files and ownership

| Agent | Owns (create/edit)                                                                  |
|-------|-------------------------------------------------------------------------------------|
| A     | `styles.css`, `src/hud.js` (only if a DOM change is truly needed; CSS should suffice), `docs/notes/hud.md` (append "WO3") |
| B     | `src/config.js` (`PLAYER` block only, targeted edit), `tests/player.test.js`, `docs/notes/player.md` (append "WO3"), `docs/qa/balance.md` (append a "WO3 regen" note) |
| C     | `WORK_ORDER.md` Section 6 checklist line about regen, `WORK_ORDER_2.md` 1.2/3.8 sentences that say "bottom middle", `README.md` (add one line: status panel lower-left), `docs/notes/integration-wo3.md` (create; C is also the Phase 2 verifier) |

Phase 1: A and B in parallel (C may also start its doc edits immediately; they touch no code).
Phase 2: C verifies the whole thing in the browser after A and B report done.

---

## 3. Contracts and acceptance

### 3.1 CSS (Agent A)

- Add `--status-scale: 0.8` to `:root`. Express every bezel size as `calc(<old> * var(--status-scale))`
  or precomputed equivalents; keep `--status-h` as the *scaled* height so anything that reads
  it (points block) stays correct. Remove `left: 50%` / `translateX(-50%)` from `.hud-status`.
- `.hud-points { left: 3cqh; bottom: calc(var(--status-bottom) + var(--status-h) + 1.2cqh); }`
  (or equivalent). Points must remain visible over the map (keep text shadow).
- `.hud-bottom-center { bottom: 6cqh; }` (drop the bezel-relative calc).
- Health/kills cells keep a fixed width so the bezel never changes width with the number.
- No JS change should be needed. If one is (e.g. an element order tweak), keep `initHud` /
  `updateHud` behaviour identical and re-init safe.

### 3.2 Regen (Agent B)

- `regenPerSec: 1`. Update `tests/player.test.js` regen test to assert with the config value
  (it already reads `PLAYER.regenPerSec`; add an explicit assertion that after the delay plus
  10 s the player has gained ≈10 HP, and that a 60 s heal from 50 HP reaches 110 not 150).
- Append to `docs/qa/balance.md`: measured effect on the headless bot (optional, if quick:
  run the existing scratch harness from v1 QA-3 if still present; otherwise just the reasoning).

### 3.3 Acceptance (Agent C verifies in the browser, `?debug=1`)

- [ ] Bezel sits in the lower-left, visibly ~20 % smaller (measure: height ≈ 17.2 % of canvas
      height, e.g. ≈ 124 px at 720p; face ≈ 77×96 px), Wolfenstein look intact, face animates.
- [ ] Points readout sits directly above the bezel, left-aligned, `+10` flick works, spend flick
      works.
- [ ] Prompt and Fire Sale banner are bottom-centre, above nothing, at 6cqh.
- [ ] No overlaps: round counter, points, bezel, prompt, weapon readout, power-up chips, at
      1280×720 and at a forced 960×540 stage.
- [ ] Bezel width does not change between `100%` and `7%`.
- [ ] Menu hides bezel + points; game over shows the dead-face bezel; pause shows it.
- [ ] Regen: set health to 50 via `__game.debug.setHealth(50, false)`, step 4 s → still 50;
      step 10 more s → 60 (±1); the HUD percentage moves ~0.67 %/s; taking damage resets the
      4 s delay.
- [ ] `npm test` green, `node --check` clean, zero console errors menu → round 2 → death →
      restart.

---

## 4. Spawn prompts

### Agent A
```
You are Agent A for WORK_ORDER_3.md in the current directory. Read it fully (Sections 1.1, 2,
3.1). You may edit ONLY styles.css (and src/hud.js only if a DOM change is unavoidable) plus
docs/notes/hud.md (append "WO3"). Move the status bezel to the lower-left at 0.8 scale via a
--status-scale variable, move the points block directly above it, return the prompt/banner to
bottom-centre 6cqh, keep fixed cell widths. Verify in the browser (python -m http.server 8111,
Chrome tools, NEW tab, /?debug=1, __game.debug.step(1/60), __game.debug.setHealth(hp,false),
__game.debug.addPoints(10)); screenshot at default and with the stage forced to 960x540 via
inline style; confirm no overlaps. npm test (node --test "tests/*.test.js") stays green. Stop
server, close tab, no git, no questions.
```

### Agent B
```
You are Agent B for WORK_ORDER_3.md in the current directory. Read it fully (Sections 1.2, 2,
3.2). You may edit ONLY the PLAYER block of src/config.js (targeted edit), tests/player.test.js,
docs/notes/player.md (append "WO3") and docs/qa/balance.md (append "WO3 regen"). Set
regenPerSec to 1, extend the regen tests as specified, run npm test (node --test
"tests/*.test.js") and node --check. Record the balance consequence. No git, no questions.
```

### Agent C
```
You are Agent C (docs + verifier) for WORK_ORDER_3.md in the current directory. Read it fully.
Phase 1 now: update the sentences listed for you in Section 2 (WORK_ORDER.md Section 6 regen
line, WORK_ORDER_2.md "bottom middle" wording in 1.2 and 3.8, README.md one line). Then wait
until Agents A and B have finished (the lead will tell you), and run every Section 3.3 check in
the browser (python -m http.server 8112, Chrome tools, NEW tab, /?debug=1, debug hooks). If
something fails, fix it minimally in the responsible file (styles.css / src/hud.js / config.js)
and re-run the check. Write docs/notes/integration-wo3.md with a pass/fail table and
screenshots saved to docs/screenshots/wo3-*.png. npm test must be green. Stop server, close
tab, no git, no questions.
```
