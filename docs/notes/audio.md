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

## WO7 (Agent L, T2/T3/T5): perks, Quick Revive, knife, acid boss, lab ambience
- New SFX (all subscribed in `initAudio`, so re-init safe; silent no-op without a context; each
  builder runs inside `playSfx`'s try/catch). New `playSfx` names: `perkJingle, playerDowned,
  playerRevived, perkLost, meleeSwing, meleeHit, bossSpit, acidSizzle`.
  - `perk:bought` -> `perkJingle` (ui bus): a per-perk 4-6 note chiptune motif (`PERK_MOTIFS`,
    keyed by `perkId`; jugg low marching square, revive bright triangle bells, speed fast square
    run, dtap repeated-note start, stamin bouncy triangle, mule quirky 6-note; unknown id -> a
    default arpeggio) with a quiet octave-down triangle shadow and a sparkle, then a "drink" gulp
    (two rising low sine glugs + dull noise, a soft exhale). ~1.1-1.3 s total.
  - `purchase:made` with `kind === 'perk'` now plays nothing (the jingle replaces the cash tick).
  - `player:downed` -> falling saw/sine (180->45 Hz, 90->32 Hz) over `reviveIn` (clamped 0.6-3 s,
    default 1.5) with a lub-dub heartbeat every 0.55 s (player bus).
  - `player:revived` -> rising sting: saw sweep 110->440 Hz, G-major square arpeggio, held
    triangle + shimmer, a rising air noise.
  - `perk:lost` -> short descending square/triangle blip, rate limited 0.09 s (removeAllPerks
    emits one per perk, so a 4-perk loss is one blip rather than a pile).
  - `melee:swing` -> whoosh: band-passed noise sweeping 500->3200 Hz plus a thin high sweep
    (player bus), rate limited 0.08 s.
  - `melee:hit` -> wet thud (sine drop + lowpassed noise + a resonant bandpass squelch sweeping
    down); `killed: true` is lower, longer and louder with an extra triangle body. Zombies bus,
    rate limited 30 ms (maxTargets 3 hits in one swing -> one thud).
  - `boss:spit` -> gurgle (looped noise through a Q 12 bandpass at 420 Hz whose centre an LFO
    wobbles +-260 Hz at 9->16 Hz) plus a rising throat voice, on the compressed boss bus; rate
    limited 0.3 s. **No hazard-spawn event exists**, so the acid sizzle (fading high-passed hiss +
    crackle pops, world bus) is scheduled on the audio clock `ACID_SIZZLE_DELAY` = 0.8 s after the
    spit (per the task brief; note BOSS.acid telegraph + flight is 1.3 s, so if an integrator adds a
    `hazard:spawned`-style event, subscribe `acidSizzle` to it and drop the delayed call).
  - `level:start` for the LABORATORY (payload `name` matches /LABORATORY/i; if no name, `index === 2`)
    starts a looping electrical hum: 60 Hz saw + 120/180/240 Hz harmonics through a 700 Hz lowpass,
    a 0.23 Hz level flutter and a faint 4.2 kHz crackle bed, on its own gain (0.035, 1.5 s fade-in)
    into the world bus -- well under every other sound. At most one instance. It stops (0.3 s fade)
    on any other `level:start`, `level:descend`, `game:over`, `game:restart`, and on every
    `initAudio()` re-init. The existing `levelStart` swell still plays for index > 0.
- Verification: `node --check src/audio.js` ok; Node import without `window` + `initAudio/playSfx/
  setMuted` is silent. Fake-AudioContext smoke test: perk-kind purchase builds 0 nodes; every new
  event builds nodes without throwing; lab hum starts once and is stopped by game over, descend,
  level change, re-init and restart; one context across restarts. Chrome (`?debug=1`, port 8213):
  emitted every new event plus lab start/change/restart via `__game.modules.events`, no console
  errors. `npm test`: 438/441; the 3 failures (WO7 exports for zombie sprites / meleeAttack / hud,
  weapon tables, WO5 wall prices) belong to agents still working on those files, not audio.

## WO8 (Agent F): Pack-a-Punch
- New SFX. They are subscribed in `initAudio`, so a re-init is safe, and without a context they
  play nothing. New `playSfx` names: `papStart`, `papDone`. `PAP` is imported from config.js;
  `PAP.workSeconds` falls back to 3 s if it is missing or invalid.
  - `pap:start` -> `papStart`: a heavy mechanical clank as the gun goes in (world bus). It is a short
    band-passed slide rattle, then at +0.18 s a low sine/triangle slam (120->42 Hz), inharmonic
    square metal partials (~0.64/1.23/1.87/2.74 kHz), a noise hit and a high latch tick. It uses
    +-4 % random pitch from the audio-local PRNG.
    Then, from +0.35 s, the **working voice** plays for `PAP.workSeconds`:
    - Hum (world bus, 0.05): two detuned 55 Hz saws, a 110 Hz sine and a quiet 165 Hz triangle
      through a 480 Hz lowpass, a 7 Hz tremolo and a looped noise "servo whirr" band sweeping
      700->1400 Hz. It fades in over 0.2 s and out over the last 0.3 s.
    - Jingle on its own quiet sub-bus `papBus` (gain 0.35 -> ui bus). It is an ORIGINAL 8-note
      motif in D harmonic minor with a lilting waltz feel:
      A4 C#5 D5 F5 E5 Bb4 C#5 D5, beats 1/.5/.5/1.5/.5/1/1/2 at 0.3 s per beat (~2.4 s).
      The lead is a calliope-ish triangle plus a quiet square an octave up, over an oom-pah bass
      (D2 root on notes 1-4, A2 on 5-8, a fifth "pah" in the longer notes). Notes that would run
      past `workSeconds` are cut or skipped.
  - `pap:done` -> `papDone`: stops any working voice (0.08 s fade). It plays an eject thunk
    (sine 150->55 Hz, dull noise, a small click) and a bright sparkle shimmer: a rising 6-note
    sine/triangle bell run from E6 to A7 with slight detune, plus a high-passed noise shimmer
    (ui bus).
  - `purchase:made` with `kind === 'pap'` plays nothing, because the clank replaces the cash tick.
- The working voice (hum + jingle) stops early with a short fade on `game:restart`, `game:over`,
  `level:descend`, `pap:done`, every `initAudio()` re-init and any new `pap:start`. Only one can
  run at a time.
- Verification:
  - `node --check src/audio.js` passes.
  - In Node without `window`, importing the module and calling
    `initAudio/playSfx('papStart'|'papDone')/setMuted` does nothing and does not throw.
  - Fake-AudioContext smoke test: a PaP purchase builds 0 nodes, `pap:start` builds 96 and
    `pap:done` builds 34. The working voice is stopped by game over, descend, restart and re-init;
    a second game over stops nothing.
  - Chrome (port 8257, `?debug=1`): emitting `purchase:made` kind pap, `pap:start`, `pap:done`,
    game over, descend and restart through `__game.modules.events` gave no console errors.
  - `npm test`: 513/518 pass. The 5 failures are in WO8 new exports, the three levels' PaP
    placement tests and the WO7 tier-3 weapon defs. Those files belong to agents still working
    (weapons/map/shop/levels), not audio.

## WO9 (Agent H): level ambiences, frost/tide, teleport, level-select blips
- **Ambience manager** (replaces the WO7 `labHum` code; the lab hum is now one of its entries).
  `startAmbience(id)` / `stopAmbience(fade)` keep at most one looping ambience. Each ambience gets
  its own gain into the world bus. Levels: lab 0.035, kino 0.04, outpost 0.045, temple 0.05, so
  all sit well under the other buses. It fades in over 1.5 s and out over 0.3 s. `level:start`
  stops the current ambience and then starts the new level's one. The level is picked by name
  (`/LABORATORY|KINO|OUTPOST|TEMPLE/i`), so loop names like "KINO — FLOODED" get their base
  ambience. With no name, the index is used (`index % 6` -> lab/kino/outpost/temple for 2..5).
  BUNKER and CATACOMBS have no ambience. The ambience is stopped on `level:descend`, `game:over`,
  `game:restart` and every `initAudio()` re-init. Teleports reach it through `level:start`, which
  `startLevel` emits.
- Occasional one-shots come from a `setInterval` ticker (250 ms, 0.6 s look-ahead) that schedules
  onto the ambience's own gain, so stopping the ambience cuts them too. The ticker is cleared on
  stop. A slot that has fallen more than 1 s behind (a throttled background tab) is re-seeded
  instead of firing in a burst. Long noise loops use a lazily built 3 s noise buffer, so they do
  not repeat audibly every second.
  - **KINO**: a theatre-organ chord (per note: a sine, an octave triangle and a quiet 3rd
    harmonic) through a 1.1 kHz lowpass with a 5.6 Hz tremulant. It glides through
    Dm -> Bb -> Gm -> A every 11-15 s. Every 14-28 s a film-projector clatter plays: 1.5-3 s of
    20-24 Hz sprocket clicks (high-passed plus band-passed ticks, with a fade at each end) over a
    46 Hz motor whir and a band-passed whirr.
  - **OUTPOST**: wind with two parts. A broad band-passed noise body (420 Hz, slow 0.061 Hz level
    LFO) and a resonant Q 9 "howl" band near 780 Hz, drifted by two LFOs at 0.09 and 0.037 Hz.
    Every 4-9 s a gust raises the level to 1.5-2.1x and lifts the howl to 950-1250 Hz, then
    settles back.
  - **TEMPLE**: a low-passed lapping water bed (360 Hz) under drips every 0.5-2.6 s. Each drip is
    a rising sine plink at 0.9-1.7 kHz plus a fainter echo 0.16-0.24 s later. Every 9-16 s,
    3-4 distant slow drums (sine 76->42 Hz plus a low noise skin, through a 420 Hz lowpass) play,
    with the last hit accented.
- New `playSfx` names and events:
  - `frostBreath` (`boss:frost`, boss bus, rate limit 0.3 s): an icy inhale that swells over
    `BOSS.frost.telegraph` (band-passed air rising 700->2600 Hz, a high air band, a glassy
    1.8->3.4 kHz sine and a faint throat voice). Then a breath hiss (high-passed noise plus a mid
    band) with 7 crystalline tinkles.
  - `tideRoar` (`boss:tide`, boss bus, rate limit 0.3 s): low-passed noise opening 220->1400 Hz
    over `BOSS.tide.telegraph`, with a 38->62 Hz sub swell and a gurgle. Then a broad crashing
    wash (a lowpass sweeping 2.6 kHz->300 Hz over 1.4 s, a hiss, a rolling mid band).
  - `teleport` (`level:teleport`, world bus plus a ui shimmer): a noise whoosh sweeping up
    300->4200 Hz, then back down, a rising 180->1500 Hz sine, a landing thump and a 4-note sine
    sparkle.
  - `uiOpen` / `uiClose` (`levelselect:open` / `levelselect:close`, ui bus, a shared 50 ms rate
    limit): quiet rising 660->990 Hz and falling 990->620 Hz sine blip pairs.
- `config.js` `BOSS` is now imported. Its telegraph times are clamped to 0.2-1.5 s, with defaults
  of 0.6 and 0.8 s.
- Verification:
  - `node --check src/audio.js` passes.
  - Importing in Node without `window`, then calling `initAudio` x2, the new `playSfx` names and
    `setMuted`, is silent and does not throw.
  - Fake-AudioContext smoke test: BUNKER builds 0 ambience nodes. LABORATORY, KINO, OUTPOST,
    TEMPLE and the loop names "KINO — FLOODED" / "TEMPLE — ASHEN" each build their ambience, and
    starting one stops the previous one. Game over, restart, re-init and descend each stop it; a
    second game over stops nothing. The five new events build 34/19/18/4/4 nodes.
  - Chrome (port 8308, `?debug=1`): through `__game.modules.events`, emitted `game:start`, then
    `level:start` with all 6 names plus two loop names and a nameless index. Then emitted
    `boss:frost`, `boss:tide`, `level:teleport`, `levelselect:open`/`close`, `game:over` and
    `game:restart`. There were no console errors.
  - `npm test`: 581/582 pass. The one failure, `WO9 new exports`, is caused by
    `touch.onLevelsButton` and `level.teleportTo`, which agents G and INT have not landed yet.
    It is not caused by audio.
