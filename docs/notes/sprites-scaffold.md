# WO2 Phase 0: sprites scaffold (Agent 0)

## Files
- `src/sprites/palette.js`: `PALETTE` exactly per 3.1 (27 colours + `.` = 28 keys), frozen.
- `src/sprites/pixel.js`: 3.2 API. It is Node-safe and only `toCanvas`/`drawSprite` touch `document`/`OffscreenCanvas`, and only when they are called.
- `src/config.js`: `SPRITES` block appended after `LOOP` (targeted append, nothing else changed).
- `src/sprites/soldier.js`, `guns.js`, `face.js`, `animator.js`: STUBS that export every 3.4–3.6 name, with placeholder sprites.
- `tests/pixel.test.js`: 14 tests (parse, ragged/unknown throw, compose, flip, tint, spriteKey, quantizeAngle, placeholder, drawSprite call sequence with a fake ctx).
- `tools/sprite-preview.html`: 3.13 preview page.

## Contract clarifications (pixel.js, frozen)
- **Sprite fields:** `rows` is the source grid. `compose` builds composed rows when every layer has rows. `flipX`/`flipY` flip the rows. `tint` sets `rows = null`, because tinted colours no longer map to palette chars. Sprites may carry `placeholder: true`.
- **Extra export `placeholderSprite(w, h)`:** a frozen magenta/black 4-px checker flagged as placeholder. `PLACEHOLDER = placeholderSprite(16, 16)`.
- **`isPlaceholder(s)`:** true for `PLACEHOLDER`, anything flagged `placeholder`, and anything whose `rows` contain `'x'`. The flag propagates through `compose` (if any layer is a placeholder), `tint`, `flipX` and `flipY`.
- **`compose`:** uses src-over for partial alpha, skips alpha 0, clips to the first layer, and rounds `dx`/`dy`.
- **`spriteKey`:** content-based (`"WxH:<fnv1a36>"`) and memoized per object. Identical pixels share a key, so they share the canvas cache.
- **`quantizeAngle(a, n)`:** rounds to the nearest multiple of 2π/n without wrapping. When `n <= 0` or `n` is non-numeric, it returns `a` unchanged.
- **`toCanvas(s, scale)`:** integer scale only (rounded, min 1). It upscales nearest-neighbour in software, so the canvas is crisp without relying on the ctx. The cache is keyed `spriteKey@scale` and capped at 4096 entries, evicting FIFO.
- **`drawSprite`:**
  - The canvas is drawn at `ceil(scale)` into a `w*scale × h*scale` dest rect, so fractional scales work.
  - It runs `save` → smoothing off → `globalAlpha *= alpha` → `translate(x,y)` → `rotate(quantized)` (skipped when 0) → `drawImage(-ax*scale, -ay*scale)` → `restore`, with `restore` inside `finally`.
  - Anchors are in sprite-px corner coordinates, so the centre of a 16×16 is `(8, 8)`.

## Stub behaviour (owners replace freely, same export names)
- **guns.js:**
  - Placeholders at the 3.4 sizes, with `grip {1, floor(h/2)}` and `muzzle {w-1, floor(h/2)}`.
  - Poses: pistol and raygun `onehand`; smg, ar, shotgun and sniper `twohand`; lmg, thundergun and deathmachine `heavy` (weight 1.6); `default` is `twohand` 12×5.
  - **`gunSpriteFor` lookup order is `sprite` → `id` → `cls` → default.** Adding the `id` step means `raygun`/`deathmachine` resolve before Agent G adds `sprite` fields, and it is harmless afterwards. Agent B may keep or drop it.
- **soldier.js:** `PLACEHOLDER` everywhere, `down` is a 20×20 placeholder, and anchors are as in 3.4. Stub hands are onehand (13,10), twohand (13,8), heavy (11,10); Agent A sets the real values.
- **face.js:**
  - `healthTier` is real: ≥.85→0, ≥.65→1, ≥.45→2, ≥.25→3, else 4. Non-finite input → 4.
  - `dead = down || !(frac > 0)`.
  - Wince and grin timers use `SPRITES.face`. Glance, blink and breathe are not implemented in the stub.
  - `composeFace` returns a 24×30 placeholder.
- **animator.js:**
  - Minimal: walk phase from distance, pose via `gunSpriteFor`, linear recoil decay, reload frame toggle.
  - Adds an extra field `anim.aim` (the last `player.angle`).
  - `noteShot(anim, def, aimAngle?)` takes an optional third argument and otherwise uses `anim.aim`. **3.6 does not say where noteShot gets "current aim" from; Agent D should decide.**

## Preview page
- Serve the project root and open `/tools/sprite-preview.html`.
- **Robustness to half-done modules:**
  - Every module loads through an isolated dynamic `import()`. A syntax error in one module shows in a red banner, and the other sections still render.
  - Each section is wrapped in try/catch and shows errors inline.
  - The live loop reports each error once, inline, and keeps running.
  - The page never writes to the console.
- **What it shows:**
  - A magenta banner that counts and lists every placeholder sprite path, including `composeFace(tier)` outputs.
  - A static scale selector (default 6x).
  - Anchor, hand, grip and muzzle markers, with warnings for out-of-bounds points and for `muzzle.x <= grip.x`.
  - A pose × gun grid, where the green outline marks the gun's native pose.
  - Face tier × eye/mouth matrices, built by hand with `compose` (the tier-4 pale tint here is a preview-only approximation that maps skin `s` to `P`).
  - `composeFace` results for tiers 0–4 and dead.
  - Live soldier at 1x and 3x: walks a circle, aim rotates independently, gun dropdown, sprint/down/fire/reload toggles, muzzle flash dot at the muzzle.
  - Live face at 1x / 4x / 6x: health slider, down checkbox, hurt and grin buttons, state readout. It redraws via `putImageData` only when `faceFrameKey` changes.
- It does not cache-bust imports, because query strings would duplicate module instances. Hard-reload after edits.
- `window.__spritePreview` exposes `{ sim, face, loadErrors }` for automation.

## Verification
- `node --check` passes on every touched file and on the page's extracted module script.
- `npm test`: 177/177 pass.
- Served on port 8090 and opened in a new Chrome tab: 0 console messages, 0 inline errors, 9 sections, placeholder banner shows 55. Tab closed and server stopped.
