# audio.js notes (Agent L)

## What was built
- `src/audio.js`: all sounds are synthesized with WebAudio (oscillators, one shared 1 s white-noise
  buffer, biquad filters, attack/decay gain envelopes). No audio files.
- API per WORK_ORDER 3.6: `initAudio()`, `playSfx(name, payload?)`, `setMuted(bool)`.
- Graph: sources -> per-sound envelope -> category bus (`guns`, `zombies`, `player`, `ui`, `world`)
  -> master gain (0.5) -> destination. `setMuted` ramps the master to 0 (or back to 0.5). The mute
  flag is remembered even if called before the context exists.
- Every event in the 5.12 list is subscribed: weapon:fired (per class), weapon:reload,
  weapon:empty, zombie:hit, zombie:killed, player:damaged, player:down, round:start, round:end,
  powerup:spawned, powerup:collected (chord + per-type motif), powerup:expired, purchase:made,
  purchase:denied, box:opened, barricade:board (zombie tear is lower/duller than a player repair).

## Lifecycle / safety
- The `AudioContext` is created lazily on `game:start` only (inside main's user gesture). A later
  `game:start` just resumes the existing context if suspended; a second context is never created.
- `initAudio()` can be called any number of times: it first calls its own previous unsubscribe
  functions, then re-subscribes. This works both after `events.clearAll()` (main's restart path) and
  if called twice without clearing (no duplicate listeners).
- Before a context exists (or in Node, with no `window`), every call returns silently. Sound
  builders are wrapped in try/catch so audio can never throw into the game loop.

## Weapon classes
- `weapon:fired` looks up `WEAPONS[weaponId].cls` lazily at event time (weapons.js may be a stub at
  import). `raygun` and `deathmachine` are matched by id (both are cls `special`). Unknown id or
  missing def -> generic gunshot (the pistol pop).
- Max 8 concurrent gunshot voices; the oldest is faded out over 10 ms and stopped when a 9th starts.

## Rate limits (my choice)
- `weapon:empty` dry click: at most once per 0.18 s (spec says rate-limited).
- `zombie:hit`: 30 ms (shotgun pellets would otherwise stack 8 thuds).
- `zombie:killed` groan: 50 ms (nuke stagger is 80 ms so each nuke death still groans).
- `purchase:denied` buzz: 0.25 s.

## Assumptions / deviations
- `playSfx` takes an optional second `payload` argument (contract lists only `name`); callers that
  pass only a name still work. Valid names: `gunshot, reload, empty, zombieHit, zombieKilled,
  playerDamaged, playerDown, roundStart, roundEnd, powerupSpawned, powerupCollected,
  powerupExpired, purchase, denied, boxOpened, board`. Unknown names are ignored.
- Randomness (pitch jitter) uses a small module-local PRNG, not `Math.random()` (rule 6) and not
  `state.rng` (audio has no state access, and consuming it would change gameplay determinism).
- `game:restart` just clears the gun-voice list and resumes the context.

## Constants to move to config (optional)
`MASTER_GAIN`, `CATEGORY_GAIN`, `MAX_GUN_VOICES`, and the rate-limit intervals at the top of
`audio.js` are marked `// TODO(integrator): move to config.js`.

## Verification
- `node --check src/audio.js` passes.
- Smoke-tested in Node against a copy with a fake AudioContext: no-op without `window`, exactly one
  context across start/clearAll/initAudio/start, 20 rapid shots plus every event fired without errors.
- Observed during testing (not my file): importing the real `src/weapons.js` currently fails
  because `zombie.js` imports `barricadeOpen` from `map.js`, which does not export it yet (likely
  in-progress Phase 1 work; integrator should confirm).

## WO2 (Agent I)
- **Thundergun** (`weapon:fired` with `weaponId === 'thundergun'`, matched by id before any
  `WEAPONS` lookup, so it works even before Agent G's def lands). Layers: sine sub boom 72->26 Hz
  over 0.6 s, triangle 140->45 Hz for small speakers, short bright air punch, and a 0.6 s
  downward whoosh (noise through a lowpass sweeping 6 kHz -> 180 Hz). At +120 ms a "bodies thud":
  3 soft, slightly staggered low thumps (sine ~85-110 Hz -> 40 Hz plus dull noise).
- **Own bus, bypasses the gun limiter.** Graph: sources -> `thunderBus` (gain 1.0, vs guns 0.55)
  -> DynamicsCompressor (threshold -14 dB, ratio 8, attack 3 ms, release 250 ms) -> master.
  Falls back to a plain gain if `createDynamicsCompressor` is missing. Thundergun never enters
  `gunVoices`, so it cannot steal a gun voice and cannot be stolen mid-boom. It has its own cap of
  2 concurrent booms; extra shots while 2 are ringing are skipped (never cut). `game:restart`
  clears that list too.
- Local tunables at the top of `audio.js` (`THUNDER_BUS_GAIN`, `MAX_THUNDER_VOICES`,
  `THUNDER_THUD_DELAY`), not in `config.js` AUDIO because config.js is not mine this order.
  Integrator may move them.
- **player:damaged** is now a short pained "ugh" (~0.25 s): a low impact thump, then a new
  `voice()` primitive (sawtooth gliding down ~190 -> ~118 Hz through parallel bandpass formants at
  650/1150/2500 Hz, an "uh" vowel) plus a brief breathy noise onset. Replaces the old heartbeat.
- Unchanged: all other sounds, lazy AudioContext on `game:start`, re-init safety, silent no-op
  without a context/`window`.
- Verification: `node --check src/audio.js` ok; importing in Node without `window` and calling
  `initAudio/playSfx('gunshot',{weaponId:'thundergun'})/setMuted` is a silent no-op; fake-context
  smoke test showed one context across start/restart/re-init, the thundergun cap holding at 2 voices
  under 4 rapid shots, and the new builders running without throwing. `npm test`: 175/177 pass; the
  2 failures (`weapon tables`, `boxWeights`) are in weapons/shop tests, which Agent G is changing
  right now. They are not caused by audio.

## WO4 (Agent D, 2.4): door open
- `purchase:made` with `kind === 'door'` plays the new `door` SFX instead of the purchase chime
  (other kinds unchanged). Still one subscription in `initAudio`, so re-init safe; silent without
  a context, like every other sound.
- `door` (world bus, peaks <= 0.22 vs gun layers ~0.3-0.5 on a louder bus): a ~0.4 s heavy wooden
  creak (two band-passed noise layers, Q 7/9, sweeping 520->260 Hz and 1150->640 Hz, plus a quiet
  low sawtooth rasp 92->58 Hz), then at +0.35 s a metallic clank (inharmonic square/triangle/sine
  partials at ~1.48/2.21/3.39 kHz with fast decay, a low 140->70 Hz thud and a short high-passed
  noise tick). +-6 % random pitch per open from the audio-local PRNG.
- `playSfx('door')` is also a valid name now. Checked in Chrome: plays with no console errors.

## WO5 (Agent E, 3.6): boss, levels, mega door
- New SFX. All subscriptions live in `initAudio`, so a re-init is safe, and every sound is a silent
  no-op without a context. Boss sounds use the compressed Thundergun bus (`bossBus()`, with the
  world bus as the fallback).
  - `bossRoar` (`boss:start`): two formant voices, 92→58 Hz and 61→41 Hz, 1.35 s, plus a noise
    growl, a 48 Hz sub and two war-drum hits (0 s and 0.42 s).
  - `bossCharge` (`boss:charge`, rate limited to 0.3 s): a dissonant rising saw stab (220/233 Hz →
    330/349 Hz) plus a snort voice and a hiss.
  - `bossHit` (`zombie:hit` where `payload.zombie.kind === 'boss'`): a low 90→38 Hz thud plus dull
    noise, rate limited by `AUDIO.bossHitMinInterval ?? 0.12`. Other kinds still play `zombieHit`.
  - `bossDefeated` (`boss:defeated`): a drum hit, a C-major arpeggio and a held chord with a bell.
  - `levelDescend` (`level:descend`): 6 stone footsteps whose pitch drops, plus a low drone (41 Hz
    sine with a 55 Hz saw).
  - `levelStart` (`level:start`): an ominous minor swell with a bell. It is skipped for `index 0`, so
    a new game only plays the round-start sting.
  - `megaDoor` (`purchase:made` kind `megadoor`): a 1.3 s iron grind (detuned low saw/square plus
    two resonant noise bands), then a deep clang.
- Verified with a fake AudioContext in Node: each event builds its nodes (29/15/5/25/34/12/19). In
  Node without `window` the calls are silent. In Chrome, emitting all 7 events gave no console
  errors.

### WO5 FIX-3 (review I2)
- `zombie:killed` goes through `onZombieKilledSfx`: kills with `cause === 'debug'` (the leftover
  minions `finishFight` clears) play nothing, and at most one death groan plays per 12 ms (one
  per frame), so a nuke or a mass kill no longer stacks 10+ groans.
