// audio.js (Agent L) — synthesized WebAudio sound effects. No audio files.
// Contract (WORK_ORDER 3.6): initAudio(), playSfx(name), setMuted(bool).
// Every entry point is a silent no-op until an AudioContext exists (created lazily on game:start).

import { on } from './events.js';
import { WEAPONS } from './weapons.js';
import { AUDIO, PAP } from './config.js';

// Tunables live in config.js AUDIO (moved by integrator).
const MASTER_GAIN = AUDIO.masterGain;
const CATEGORY_GAIN = AUDIO.categoryGain;
const MAX_GUN_VOICES = AUDIO.maxGunVoices;
const EMPTY_CLICK_MIN_INTERVAL = AUDIO.emptyClickMinInterval; // seconds between dry clicks
const ZOMBIE_HIT_MIN_INTERVAL = AUDIO.zombieHitMinInterval;   // avoid a wall of thuds from shotgun pellets
const GROAN_MIN_INTERVAL = AUDIO.groanMinInterval;
const DENIED_MIN_INTERVAL = AUDIO.deniedMinInterval;
// WO2 3.11 Thundergun: own bus, louder than guns (guns bus is categoryGain.guns), compressed so
// the stacked sub + whoosh + thuds never clip. Tunables live in config.js AUDIO.
const THUNDER_BUS_GAIN = AUDIO.thunderBusGain ?? 1.0;        // vs guns 0.55
const MAX_THUNDER_VOICES = AUDIO.maxThunderVoices ?? 2;      // extra booms beyond this are skipped (never cut mid-boom)
const THUNDER_THUD_DELAY = AUDIO.thunderThudDelay ?? 0.12;   // seconds after the boom: "bodies thud"

// ---------------------------------------------------------------------------------------------
// Module state (survives restarts: the AudioContext is created once and reused)
let ctx = null;
let master = null;
let buses = {};
let noiseBuf = null;
let muted = false;
let unsubs = [];
let gunVoices = []; // { gain, sources, endAt }
let thunderBus = null;   // WO2: dedicated compressed bus for the Thundergun (bypasses the gun limiter)
let thunderVoices = [];  // { endAt } — small separate cap so spam cannot pile up boom on boom
const lastPlayed = {};

// Local audio-only PRNG (cosmetic pitch variation). Rule 6 forbids Math.random(); audio has no
// access to state.rng and must not consume it (that would perturb gameplay determinism).
let seed = 0x2f6b1a3d;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rrange(lo, hi) { return lo + (hi - lo) * rand(); }

// ---------------------------------------------------------------------------------------------
// Context management

function tryResume() {
  if (ctx && ctx.state === 'suspended' && ctx.resume) {
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  }
}

function createContext() {
  if (ctx) { tryResume(); return; }
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    buses = {};
    for (const [name, g] of Object.entries(CATEGORY_GAIN)) {
      const bus = ctx.createGain();
      bus.gain.value = g;
      bus.connect(master);
      buses[name] = bus;
    }
    // Thundergun bus: gain -> compressor -> master. Falls back to a plain gain if the
    // browser lacks DynamicsCompressorNode.
    thunderBus = ctx.createGain();
    thunderBus.gain.value = THUNDER_BUS_GAIN;
    if (ctx.createDynamicsCompressor) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      thunderBus.connect(comp);
      comp.connect(master);
    } else {
      thunderBus.connect(master);
    }
    // 1 second of white noise, reused by every noise-based sound.
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1;
  } catch (_) {
    ctx = null; master = null; buses = {}; noiseBuf = null; thunderBus = null;
    return;
  }
  tryResume();
}

function ready() {
  return !!(ctx && master && noiseBuf && ctx.state !== 'closed');
}

function rateLimited(key, interval) {
  const now = ctx.currentTime;
  if (lastPlayed[key] !== undefined && now - lastPlayed[key] >= 0 && now - lastPlayed[key] < interval) return true;
  lastPlayed[key] = now;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Synth primitives. All take an explicit destination node so gun voices can be grouped.

// Attack/decay envelope on a fresh gain node connected to dest.
function envGain(dest, t, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

// Oscillator tone with optional pitch glide. Returns the source node.
function tone(dest, { type = 'sine', f0 = 440, f1 = null, t = 0, dur = 0.2, peak = 0.3, attack = 0.005 }) {
  const start = ctx.currentTime + t;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, start);
  if (f1 !== null && f1 > 0) osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
  const g = envGain(dest, start, peak, Math.max(0.001, attack), dur);
  osc.connect(g);
  osc.start(start);
  osc.stop(start + attack + dur + 0.05);
  return osc;
}

// Filtered noise burst. Returns the source node.
function noise(dest, { t = 0, dur = 0.1, peak = 0.4, attack = 0.002, filter = 'lowpass', freq = 2000, freq1 = null, q = 1 }) {
  const start = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, start);
  if (freq1 !== null && freq1 > 0) f.frequency.exponentialRampToValueAtTime(freq1, start + dur);
  f.Q.value = q;
  const g = envGain(dest, start, peak, Math.max(0.001, attack), dur);
  src.connect(f);
  f.connect(g);
  src.start(start, rand() * 0.5);
  src.stop(start + attack + dur + 0.05);
  return src;
}

// Formant-ish voice: a gliding sawtooth (glottal buzz) through parallel bandpass "vowel" formants.
// formants: [[freq, q, gain], ...]. Returns the source node.
function voice(dest, { f0 = 160, f1 = null, t = 0, dur = 0.2, peak = 0.3, attack = 0.01, formants = [] }) {
  const start = ctx.currentTime + t;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, start);
  if (f1 !== null && f1 > 0) osc.frequency.exponentialRampToValueAtTime(f1, start + attack + dur);
  const g = envGain(dest, start, peak, Math.max(0.001, attack), dur);
  for (const [freq, q, fg] of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, start);
    bp.Q.value = q;
    const fgain = ctx.createGain();
    fgain.gain.value = fg;
    osc.connect(bp);
    bp.connect(fgain);
    fgain.connect(g);
  }
  osc.start(start);
  osc.stop(start + attack + dur + 0.05);
  return osc;
}

function notes(dest, freqs, { type = 'triangle', step = 0.12, dur = 0.18, peak = 0.25, t0 = 0 } = {}) {
  freqs.forEach((f, i) => tone(dest, { type, f0: f, t: t0 + i * step, dur, peak }));
}

// ---------------------------------------------------------------------------------------------
// Gunshot voices (max 8 concurrent, steal oldest)

function gunVoice(build) {
  const now = ctx.currentTime;
  gunVoices = gunVoices.filter(v => v.endAt > now);
  while (gunVoices.length >= MAX_GUN_VOICES) {
    const old = gunVoices.shift();
    try {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.01);
      for (const s of old.sources) { try { s.stop(now + 0.02); } catch (_) { /* already stopped */ } }
    } catch (_) { /* ignore */ }
  }
  const vg = ctx.createGain();
  vg.gain.value = 1;
  vg.connect(buses.guns);
  const sources = [];
  const dur = build(vg, sources);
  gunVoices.push({ gain: vg, sources, endAt: now + dur });
}

const GUN_SOUNDS = {
  pistol(d, s) { // pop
    s.push(noise(d, { dur: 0.08, peak: 0.5, filter: 'bandpass', freq: 2200, q: 0.8 }));
    s.push(tone(d, { type: 'square', f0: 320 * rrange(0.95, 1.05), f1: 90, dur: 0.07, peak: 0.18 }));
    return 0.15;
  },
  smg(d, s) { // snap
    s.push(noise(d, { dur: 0.05, peak: 0.45, filter: 'highpass', freq: 1800, q: 0.7 }));
    s.push(tone(d, { type: 'square', f0: 420 * rrange(0.95, 1.05), f1: 140, dur: 0.045, peak: 0.14 }));
    return 0.1;
  },
  ar(d, s) { // crack
    s.push(noise(d, { dur: 0.1, peak: 0.55, filter: 'bandpass', freq: 1500, freq1: 500, q: 0.9 }));
    s.push(tone(d, { type: 'sawtooth', f0: 180 * rrange(0.95, 1.05), f1: 60, dur: 0.09, peak: 0.2 }));
    return 0.16;
  },
  shotgun(d, s) { // boom
    s.push(noise(d, { dur: 0.28, peak: 0.7, filter: 'lowpass', freq: 2500, freq1: 300, q: 0.7 }));
    s.push(tone(d, { type: 'sine', f0: 120 * rrange(0.95, 1.05), f1: 40, dur: 0.25, peak: 0.5 }));
    return 0.35;
  },
  sniper(d, s) { // thump
    s.push(noise(d, { dur: 0.35, peak: 0.6, filter: 'lowpass', freq: 1800, freq1: 200, q: 1 }));
    s.push(tone(d, { type: 'sine', f0: 90, f1: 30, dur: 0.4, peak: 0.6 }));
    s.push(noise(d, { t: 0.02, dur: 0.05, peak: 0.3, filter: 'highpass', freq: 4000 }));
    return 0.45;
  },
  lmg(d, s) { // thud
    s.push(noise(d, { dur: 0.1, peak: 0.55, filter: 'lowpass', freq: 1200, freq1: 300, q: 1 }));
    s.push(tone(d, { type: 'triangle', f0: 110 * rrange(0.95, 1.05), f1: 45, dur: 0.1, peak: 0.35 }));
    return 0.16;
  },
  raygun(d, s) { // zap
    s.push(tone(d, { type: 'sawtooth', f0: 1400, f1: 300, dur: 0.25, peak: 0.22 }));
    s.push(tone(d, { type: 'sine', f0: 2200, f1: 600, dur: 0.2, peak: 0.15 }));
    return 0.3;
  },
  deathmachine(d, s) { // whir
    s.push(tone(d, { type: 'sawtooth', f0: 220 * rrange(0.97, 1.03), f1: 180, dur: 0.05, peak: 0.12 }));
    s.push(noise(d, { dur: 0.04, peak: 0.4, filter: 'bandpass', freq: 3000, q: 1.2 }));
    return 0.08;
  },
};

// ---------------------------------------------------------------------------------------------
// Thundergun (WO2 3.11). Bypasses the 8-voice gun limiter entirely: it has its own compressed
// bus and its own tiny voice cap, so it never steals a gun voice and is never stolen mid-boom.

function thundergun() {
  if (!thunderBus) return;
  const now = ctx.currentTime;
  thunderVoices = thunderVoices.filter(v => v.endAt > now);
  if (thunderVoices.length >= MAX_THUNDER_VOICES) return;
  const b = thunderBus;
  // Deep sub-bass boom: sine drop plus a quieter triangle an octave up for small speakers.
  tone(b, { type: 'sine', f0: 72, f1: 26, dur: 0.6, peak: 0.75, attack: 0.004 });
  tone(b, { type: 'triangle', f0: 140, f1: 45, dur: 0.35, peak: 0.25, attack: 0.004 });
  // Initial air punch.
  noise(b, { dur: 0.08, peak: 0.45, filter: 'lowpass', freq: 5000, freq1: 900, q: 0.7 });
  // Downward air whoosh: noise through a lowpass sweeping from bright to dull over ~0.6 s.
  noise(b, { t: 0.01, dur: 0.6, peak: 0.4, attack: 0.05, filter: 'lowpass', freq: 6000, freq1: 180, q: 1.2 });
  // Delayed "bodies thud": a few soft, low, slightly staggered thumps.
  for (let i = 0; i < 3; i++) {
    const t = THUNDER_THUD_DELAY + i * rrange(0.035, 0.06);
    tone(b, { type: 'sine', f0: rrange(85, 110), f1: 40, t, dur: 0.09, peak: 0.22 });
    noise(b, { t, dur: 0.07, peak: 0.12, filter: 'lowpass', freq: 500, freq1: 150, q: 1 });
  }
  thunderVoices.push({ endAt: now + 0.7 });
}

function gunKindFor(weaponId) {
  if (weaponId === 'raygun') return 'raygun';
  if (weaponId === 'deathmachine') return 'deathmachine';
  // Looked up lazily at event time: weapons.js may be a stub when this module loads.
  const def = WEAPONS ? WEAPONS[weaponId] : undefined;
  const cls = def && def.cls;
  if (cls && GUN_SOUNDS[cls]) return cls;
  return 'pistol'; // generic gunshot fallback (also covers cls 'special' with an unknown id)
}

// ---------------------------------------------------------------------------------------------
// Named sound effects. Each receives an optional payload.

const POWERUP_MOTIFS = {
  instaKill: [880, 660, 440],
  doublePoints: [523, 523, 784],
  maxAmmo: [392, 523, 659, 784],
  nuke: [220, 165, 110],
  carpenter: [330, 392, 330],
  fireSale: [659, 784, 988, 784],
  deathMachine: [196, 247, 196],
  zombieBlood: [311, 233, 311],
};

// WO5: boss sounds share the Thundergun's compressed bus (loud but limited); world bus fallback.
const BOSS_HIT_MIN_INTERVAL = AUDIO.bossHitMinInterval ?? 0.12;
function bossBus() { return thunderBus || buses.world || master; }
// War-drum hit: pitched sine body + low noise skin slap.
function drum(dest, t, level) {
  tone(dest, { type: 'sine', f0: 110, f1: 42, t, dur: 0.45, peak: 0.5 * level, attack: 0.003 });
  noise(dest, { t, dur: 0.18, peak: 0.25 * level, attack: 0.002, filter: 'lowpass', freq: 900, freq1: 200 });
}

// ---- WO7 helpers ----
// Six distinct 4-6 note chiptune motifs keyed by perkId (Hz).
const PERK_MOTIFS = {
  jugg:   { type: 'square',   step: 0.11,  notes: [196, 247, 294, 392, 294] },       // heavy, low, marching
  revive: { type: 'triangle', step: 0.09,  notes: [659, 784, 988, 1319] },           // bright, bell-like
  speed:  { type: 'square',   step: 0.065, notes: [523, 659, 523, 784, 1047] },      // fast
  dtap:   { type: 'square',   step: 0.08,  notes: [440, 440, 554, 659, 880] },       // double-hit start
  stamin: { type: 'triangle', step: 0.1,   notes: [392, 494, 587, 494, 784] },       // bouncy
  mule:   { type: 'square',   step: 0.09,  notes: [330, 294, 392, 494, 440, 587] },  // quirky 6-note
  _default: { type: 'square', step: 0.09,  notes: [523, 659, 784, 1047] },
};
// Drink: two quick low "glug" bubbles (rising sine blips + dull noise), then a soft exhale.
function gulp(b, t) {
  for (let i = 0; i < 2; i++) {
    const tt = t + i * 0.16;
    tone(b, { type: 'sine', f0: 170 * rrange(0.95, 1.05), f1: 340, t: tt, dur: 0.07, peak: 0.2, attack: 0.004 });
    noise(b, { t: tt, dur: 0.06, peak: 0.08, filter: 'lowpass', freq: 600, freq1: 250, q: 4 });
  }
  noise(b, { t: t + 0.42, dur: 0.22, peak: 0.04, attack: 0.04, filter: 'bandpass', freq: 1200, freq1: 800, q: 1.2 });
}
const ACID_SIZZLE_DELAY = 0.8; // seconds after boss:spit (no hazard-spawn event exists)
// Looped noise through a high-Q bandpass whose centre an LFO wobbles: a bubbling gurgle.
function gurgle(dest, t, dur) {
  const start = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(420, start);
  f.Q.value = 12;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(9, start);
  lfo.frequency.linearRampToValueAtTime(16, start + dur);
  const depth = ctx.createGain();
  depth.gain.value = 260;
  lfo.connect(depth);
  depth.connect(f.frequency);
  const g = envGain(dest, start, 0.5, 0.05, dur);
  src.connect(f);
  f.connect(g);
  src.start(start, rand() * 0.5);
  lfo.start(start);
  src.stop(start + dur + 0.1);
  lfo.stop(start + dur + 0.1);
}
// Acid pools landing: a fading hiss (high-passed noise) with a few crackle pops.
function acidSizzle(dest, t) {
  noise(dest, { t, dur: 0.9, peak: 0.12, attack: 0.02, filter: 'highpass', freq: 3500, freq1: 2200, q: 0.8 });
  noise(dest, { t, dur: 0.5, peak: 0.06, attack: 0.01, filter: 'bandpass', freq: 6000, q: 3 });
  for (let i = 0; i < 5; i++) {
    tone(dest, { type: 'square', f0: rrange(1800, 3200), t: t + 0.05 + i * rrange(0.08, 0.16), dur: 0.015, peak: 0.03, attack: 0.001 });
  }
}

// Lab ambience: a quiet looping electrical hum (60 Hz saw + harmonics through a lowpass, a
// slow level flutter, a faint band-passed crackle) on its own small gain into the world bus.
// At most one instance; stopped on level change, game over, restart and re-init.
const LAB_HUM_GAIN = 0.035;
let labHum = null; // { gain, sources }
function isLabLevel(p) {
  if (!p) return false;
  if (typeof p.name === 'string' && p.name) return /LABORATORY/i.test(p.name);
  return p.index === 2;
}
function startLabHum() {
  if (!ready() || labHum) return;
  try {
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(LAB_HUM_GAIN, now + 1.5);
    out.connect(buses.world || master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.7;
    lp.connect(out);
    const sources = [];
    for (const [type, f, lvl] of [['sawtooth', 60, 0.5], ['sine', 120, 0.8], ['square', 180, 0.12], ['sine', 240.4, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g);
      g.connect(lp);
      o.start(now);
      sources.push(o);
    }
    // Slow flutter (+-30 % of the hum level), like a tired ballast.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.23;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = LAB_HUM_GAIN * 0.3;
    lfo.connect(lfoDepth);
    lfoDepth.connect(out.gain);
    lfo.start(now);
    sources.push(lfo);
    const crackle = ctx.createBufferSource();
    crackle.buffer = noiseBuf;
    crackle.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 2;
    const cg = ctx.createGain();
    cg.gain.value = 0.08;
    crackle.connect(bp);
    bp.connect(cg);
    cg.connect(out);
    crackle.start(now);
    sources.push(crackle);
    labHum = { gain: out, sources };
  } catch (_) { labHum = null; }
}
function stopLabHum() {
  const h = labHum;
  labHum = null;
  if (!h || !ctx) return;
  try {
    const now = ctx.currentTime;
    h.gain.gain.cancelScheduledValues(now);
    h.gain.gain.setValueAtTime(h.gain.gain.value, now);
    h.gain.gain.linearRampToValueAtTime(0, now + 0.3);
    for (const s of h.sources) { try { s.stop(now + 0.35); } catch (_) { /* already stopped */ } }
  } catch (_) { /* ignore */ }
}
// ---- WO8 (Agent F): Pack-a-Punch ----
// pap:start -> clank (gun goes in), then a machine hum for PAP.workSeconds plus an original 8-note
// carnival-style jingle on its own quiet sub-bus. Hum + jingle are one stoppable "working" voice:
// stopped early on game:restart, game:over, level:descend, pap:done and every initAudio() re-init.
const PAP_HUM_GAIN = 0.05;     // world-bus level of the working hum
const PAP_JINGLE_GAIN = 0.35;  // sub-bus gain (into ui) for the jingle
// Original motif (D harmonic minor, lilting waltz feel, a sly chromatic Bb->C# turn at the end).
// [frequency Hz, beats]; one beat = PAP_JINGLE_BEAT seconds.
const PAP_JINGLE = [
  [440.00, 1], [554.37, 0.5], [587.33, 0.5], [698.46, 1.5],
  [659.26, 0.5], [466.16, 1], [554.37, 1], [587.33, 2],
];
const PAP_JINGLE_BEAT = 0.3;
let papBus = null;   // lazily created sub-bus: gain -> ui bus
let papWork = null;  // { gains: [...], sources: [...] }
function papWorkSeconds() {
  const s = PAP && Number(PAP.workSeconds);
  return s > 0 ? s : 3;
}
function getPapBus() {
  if (papBus && papBus.context === ctx) return papBus;
  papBus = ctx.createGain();
  papBus.gain.value = PAP_JINGLE_GAIN;
  papBus.connect(buses.ui || master);
  return papBus;
}
function stopPapWork(fade = 0.25) {
  const w = papWork;
  papWork = null;
  if (!w || !ctx) return;
  try {
    const now = ctx.currentTime;
    for (const g of w.gains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fade);
      } catch (_) { /* ignore */ }
    }
    for (const s of w.sources) { try { s.stop(now + fade + 0.05); } catch (_) { /* already stopped */ } }
  } catch (_) { /* ignore */ }
}
// Heavy mechanical clank: a short slide rattle, then a low slam with inharmonic metal partials.
function papClank(b) {
  const k = rrange(0.96, 1.04);
  noise(b, { dur: 0.18, peak: 0.08, attack: 0.03, filter: 'bandpass', freq: 900 * k, freq1: 500 * k, q: 4 }); // slide in
  const t = 0.18;
  tone(b, { type: 'sine', f0: 120 * k, f1: 42, t, dur: 0.28, peak: 0.45, attack: 0.002 });
  tone(b, { type: 'triangle', f0: 70 * k, f1: 38, t, dur: 0.22, peak: 0.2, attack: 0.002 });
  for (const [f, pk, d] of [[1230, 0.05, 0.25], [1870, 0.035, 0.18], [2740, 0.025, 0.12], [640, 0.06, 0.35]]) {
    tone(b, { type: 'square', f0: f * k, t, dur: d, peak: pk * 0.6, attack: 0.001 });
  }
  noise(b, { t, dur: 0.1, peak: 0.25, attack: 0.001, filter: 'lowpass', freq: 2200 });
  noise(b, { t: t + 0.09, dur: 0.05, peak: 0.08, attack: 0.001, filter: 'highpass', freq: 3500 }); // latch
}
function startPapWork(t0) {
  stopPapWork(0.05);
  const dur = papWorkSeconds();
  const now = ctx.currentTime;
  const start = now + t0;
  const end = start + dur;
  const gains = [];
  const sources = [];
  // Machine hum: detuned low saws + a sine through a lowpass, 7 Hz tremolo, a faint servo whirr.
  const hum = ctx.createGain();
  hum.gain.setValueAtTime(0.0001, now);
  hum.gain.setValueAtTime(0.0001, start);
  hum.gain.linearRampToValueAtTime(PAP_HUM_GAIN, start + 0.2);
  hum.gain.setValueAtTime(PAP_HUM_GAIN, Math.max(start + 0.2, end - 0.3));
  hum.gain.linearRampToValueAtTime(0.0001, end);
  hum.connect(buses.world || master);
  gains.push(hum);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 480;
  lp.Q.value = 1.2;
  lp.connect(hum);
  for (const [type, f, lvl] of [['sawtooth', 55, 0.45], ['sawtooth', 55.6, 0.35], ['sine', 110, 0.6], ['triangle', 165, 0.15]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = lvl;
    o.connect(g);
    g.connect(lp);
    o.start(start);
    o.stop(end + 0.05);
    sources.push(o);
  }
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 7;
  const depth = ctx.createGain();
  depth.gain.value = PAP_HUM_GAIN * 0.35;
  lfo.connect(depth);
  depth.connect(hum.gain);
  lfo.start(start);
  lfo.stop(end + 0.05);
  sources.push(lfo);
  const whirr = ctx.createBufferSource();
  whirr.buffer = noiseBuf;
  whirr.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(700, start);
  bp.frequency.linearRampToValueAtTime(1400, end);
  bp.Q.value = 5;
  const wg = ctx.createGain();
  wg.gain.value = 0.25;
  whirr.connect(bp);
  bp.connect(wg);
  wg.connect(hum);
  whirr.start(start);
  whirr.stop(end + 0.05);
  sources.push(whirr);
  // Jingle: calliope-ish lead (triangle + quiet square octave) with an oom-pah bass, on papBus.
  const jg = ctx.createGain();
  jg.gain.value = 1;
  jg.connect(getPapBus());
  gains.push(jg);
  let t = t0 + 0.1;
  const tEnd = t0 + dur - 0.05;
  PAP_JINGLE.forEach(([f, beats], i) => {
    if (t >= tEnd) return;
    const d = Math.min(beats * PAP_JINGLE_BEAT, tEnd - t);
    sources.push(tone(jg, { type: 'triangle', f0: f, t, dur: d * 0.95, peak: 0.16, attack: 0.01 }));
    sources.push(tone(jg, { type: 'square', f0: f * 2, t, dur: d * 0.6, peak: 0.025, attack: 0.01 }));
    // oom (root) on each note, pah (fifth) halfway through the longer ones
    const root = i < 4 ? 73.42 : 110.0;
    sources.push(tone(jg, { type: 'triangle', f0: root, t, dur: 0.12, peak: 0.12, attack: 0.005 }));
    if (d >= 0.3) sources.push(tone(jg, { type: 'triangle', f0: root * 1.5, t: t + d / 2, dur: 0.1, peak: 0.08, attack: 0.005 }));
    t += beats * PAP_JINGLE_BEAT;
  });
  papWork = { gains, sources };
}

function onLevelStart(p) {
  stopLabHum();
  if (p && p.index > 0) playSfx('levelStart', p);
  if (isLabLevel(p)) startLabHum();
}

const SFX = {
  gunshot(p) {
    if (p && p.weaponId === 'thundergun') { thundergun(); return; }
    const kind = gunKindFor(p && p.weaponId);
    gunVoice((d, s) => GUN_SOUNDS[kind](d, s));
  },
  reload() {
    const b = buses.guns;
    noise(b, { dur: 0.03, peak: 0.35, filter: 'highpass', freq: 3000 });
    noise(b, { t: 0.12, dur: 0.04, peak: 0.4, filter: 'bandpass', freq: 1800, q: 2 });
    tone(b, { type: 'square', f0: 900, f1: 600, t: 0.12, dur: 0.03, peak: 0.08 });
  },
  empty() {
    if (rateLimited('empty', EMPTY_CLICK_MIN_INTERVAL)) return;
    noise(buses.guns, { dur: 0.02, peak: 0.3, filter: 'highpass', freq: 4000 });
    tone(buses.guns, { type: 'square', f0: 1200, f1: 800, dur: 0.02, peak: 0.06 });
  },
  zombieHit() {
    if (rateLimited('zhit', ZOMBIE_HIT_MIN_INTERVAL)) return;
    const b = buses.zombies;
    noise(b, { dur: 0.09, peak: 0.35, filter: 'lowpass', freq: 700, freq1: 200, q: 1.5 });
    tone(b, { type: 'sine', f0: 140 * rrange(0.85, 1.15), f1: 60, dur: 0.08, peak: 0.25 });
  },
  zombieKilled() {
    if (rateLimited('groan', GROAN_MIN_INTERVAL)) return;
    const b = buses.zombies;
    const f = rrange(70, 130);
    const dur = rrange(0.45, 0.8);
    tone(b, { type: 'sawtooth', f0: f * 1.3, f1: f * 0.6, dur, peak: 0.16, attack: 0.05 });
    tone(b, { type: 'square', f0: f * 1.31, f1: f * 0.62, dur, peak: 0.06, attack: 0.05 });
    noise(b, { dur: dur * 0.8, peak: 0.08, filter: 'bandpass', freq: 600, q: 3, attack: 0.05 });
  },
  playerDamaged() {
    // WO7 INT: acid pools call damagePlayer every frame; one "ugh" per 0.35 s at most.
    if (rateLimited('phurt', 0.35)) return;
    const b = buses.player;
    // WO2: short pained "ugh" (~0.25 s) to match the face wince. Low impact thump, then a
    // voiced "uh" (formants ~650/1150 Hz) whose pitch drops, plus a breathy onset.
    const p0 = 190 * rrange(0.92, 1.08);
    tone(b, { type: 'sine', f0: 75, f1: 45, dur: 0.1, peak: 0.45 });
    voice(b, { f0: p0, f1: p0 * 0.62, t: 0.015, dur: 0.22, peak: 0.5, attack: 0.015,
      formants: [[650, 5, 1.0], [1150, 6, 0.6], [2500, 8, 0.2]] });
    noise(b, { t: 0.01, dur: 0.08, peak: 0.08, attack: 0.01, filter: 'bandpass', freq: 1200, freq1: 700, q: 1.5 });
  },
  playerDown() {
    const b = buses.player;
    tone(b, { type: 'sawtooth', f0: 110, f1: 40, dur: 2.5, peak: 0.25, attack: 0.1 });
    tone(b, { type: 'sine', f0: 55, f1: 30, dur: 3.0, peak: 0.4, attack: 0.1 });
    tone(b, { type: 'triangle', f0: 82, f1: 35, dur: 2.8, peak: 0.2, attack: 0.2 });
  },
  roundStart() {
    notes(buses.ui, [220, 277, 330], { type: 'sawtooth', step: 0.28, dur: 0.5, peak: 0.16 });
    tone(buses.ui, { type: 'sine', f0: 110, t: 0.56, dur: 1.2, peak: 0.25, attack: 0.05 });
  },
  roundEnd() {
    notes(buses.ui, [330, 277, 220, 165], { type: 'sawtooth', step: 0.3, dur: 0.6, peak: 0.15 });
    tone(buses.ui, { type: 'sine', f0: 82, t: 0.9, dur: 1.5, peak: 0.25, attack: 0.05 });
  },
  powerupSpawned() {
    for (let i = 0; i < 6; i++) {
      tone(buses.ui, { type: 'sine', f0: 1200 + i * 180, t: i * 0.04, dur: 0.25, peak: 0.06 });
    }
  },
  powerupCollected(p) {
    const b = buses.ui;
    for (const f of [65, 98, 131, 165]) {  // deep "announcer-ish" chord
      tone(b, { type: 'sawtooth', f0: f, dur: 0.8, peak: 0.08, attack: 0.03 });
    }
    const motif = POWERUP_MOTIFS[p && p.type] || [440, 660];
    notes(b, motif, { type: 'square', t0: 0.25, step: 0.1, dur: 0.14, peak: 0.08 });
  },
  powerupExpired() {
    tone(buses.ui, { type: 'triangle', f0: 660, f1: 220, dur: 0.6, peak: 0.15, attack: 0.02 });
  },
  purchase() {
    const b = buses.ui;
    tone(b, { type: 'square', f0: 1800, dur: 0.04, peak: 0.08 });
    tone(b, { type: 'square', f0: 2400, t: 0.06, dur: 0.08, peak: 0.08 });
    noise(b, { dur: 0.05, peak: 0.12, filter: 'highpass', freq: 5000 });
  },
  denied() {
    if (rateLimited('denied', DENIED_MIN_INTERVAL)) return;
    tone(buses.ui, { type: 'square', f0: 110, dur: 0.25, peak: 0.12 });
    tone(buses.ui, { type: 'square', f0: 116, dur: 0.25, peak: 0.12 });
  },
  boxOpened() {
    notes(buses.ui, [523, 659, 784, 1047, 784, 1047], { type: 'triangle', step: 0.09, dur: 0.15, peak: 0.12 });
  },
  // WO4 2.4: buyable door opening. A heavy wooden creak (band-passed noise plus a low rasping
  // saw, both with a slow pitch fall), then a metallic clank ~0.35 s later. World bus, peaks
  // kept below the gunshot layers so it never sits over gunfire.
  door() {
    const b = buses.world;
    const k = rrange(0.94, 1.06);
    noise(b, { dur: 0.42, peak: 0.22, attack: 0.06, filter: 'bandpass', freq: 520 * k, freq1: 260 * k, q: 7 });
    noise(b, { t: 0.03, dur: 0.36, peak: 0.12, attack: 0.05, filter: 'bandpass', freq: 1150 * k, freq1: 640 * k, q: 9 });
    tone(b, { type: 'sawtooth', f0: 92 * k, f1: 58 * k, dur: 0.4, peak: 0.07, attack: 0.06 });
    // Clank: inharmonic metal partials with a fast decay plus a sharp noise tick.
    const tc = 0.35;
    tone(b, { type: 'square', f0: 1480 * k, t: tc, dur: 0.18, peak: 0.05, attack: 0.002 });
    tone(b, { type: 'triangle', f0: 2210 * k, t: tc, dur: 0.24, peak: 0.07, attack: 0.002 });
    tone(b, { type: 'sine', f0: 3390 * k, t: tc, dur: 0.12, peak: 0.04, attack: 0.002 });
    tone(b, { type: 'sine', f0: 140, f1: 70, t: tc, dur: 0.12, peak: 0.16, attack: 0.002 });
    noise(b, { t: tc, dur: 0.05, peak: 0.16, attack: 0.001, filter: 'highpass', freq: 3000 });
  },
  // ---- WO5 3.6 (Agent E): boss, levels, mega door ----
  // Boss roar + war-drum hit (boss:start). Compressed boss bus so the long roar never clips.
  bossRoar() {
    const b = bossBus();
    const k = rrange(0.95, 1.05);
    voice(b, { f0: 92 * k, f1: 58 * k, dur: 1.35, peak: 0.55, attack: 0.08,
      formants: [[420, 4, 1.0], [880, 5, 0.55], [2100, 6, 0.18]] });
    voice(b, { f0: 61 * k, f1: 41 * k, t: 0.04, dur: 1.25, peak: 0.35, attack: 0.1,
      formants: [[300, 3, 1.0], [700, 4, 0.5]] });
    noise(b, { dur: 1.2, peak: 0.16, attack: 0.1, filter: 'bandpass', freq: 900, freq1: 300, q: 1.2 });
    tone(b, { type: 'sine', f0: 48, f1: 30, dur: 1.4, peak: 0.35, attack: 0.1 });
    drum(b, 0.0, 1.0);
    drum(b, 0.42, 0.75);
  },
  // Charge telegraph sting (boss:charge): short dissonant rising brass stab + snort.
  bossCharge() {
    if (rateLimited('bcharge', 0.3)) return;
    const b = bossBus();
    tone(b, { type: 'sawtooth', f0: 220, f1: 330, dur: 0.5, peak: 0.16, attack: 0.02 });
    tone(b, { type: 'sawtooth', f0: 233, f1: 349, dur: 0.5, peak: 0.14, attack: 0.02 });
    tone(b, { type: 'square', f0: 110, f1: 165, dur: 0.5, peak: 0.08, attack: 0.02 });
    voice(b, { f0: 120, f1: 80, dur: 0.35, peak: 0.3, attack: 0.02, formants: [[520, 4, 1.0], [1000, 5, 0.4]] });
    noise(b, { dur: 0.3, peak: 0.1, attack: 0.03, filter: 'highpass', freq: 2500, freq1: 5000 });
  },
  // Boss hit: heavy flesh thud, lower than zombieHit, own rate limit.
  bossHit() {
    if (rateLimited('bhit', BOSS_HIT_MIN_INTERVAL)) return;
    const b = buses.zombies || bossBus();
    tone(b, { type: 'sine', f0: 90 * rrange(0.9, 1.1), f1: 38, dur: 0.14, peak: 0.4 });
    noise(b, { dur: 0.12, peak: 0.3, filter: 'lowpass', freq: 500, freq1: 150, q: 1.2 });
  },
  // Victory sting (boss:defeated): rising major arpeggio over a bright chord and a low boom.
  bossDefeated() {
    const b = buses.ui;
    drum(bossBus(), 0, 0.9);
    notes(b, [262, 330, 392, 523], { type: 'square', step: 0.11, dur: 0.22, peak: 0.08 });
    for (const f of [262, 330, 392, 523]) tone(b, { type: 'triangle', f0: f, t: 0.46, dur: 1.4, peak: 0.08, attack: 0.02 });
    tone(b, { type: 'sawtooth', f0: 131, t: 0.46, dur: 1.4, peak: 0.07, attack: 0.03 });
    tone(b, { type: 'sine', f0: 1047, t: 0.46, dur: 0.9, peak: 0.05 });
  },
  // Descending the stairs (level:descend): stone footsteps getting deeper + low drone.
  levelDescend() {
    const b = buses.world;
    for (let i = 0; i < 6; i++) {
      const t = i * 0.19;
      const f = 150 - i * 12;
      tone(b, { type: 'sine', f0: f, f1: f * 0.5, t, dur: 0.09, peak: 0.3 - i * 0.03 });
      noise(b, { t, dur: 0.07, peak: 0.16 - i * 0.015, filter: 'bandpass', freq: 1400 - i * 120, q: 2 });
    }
    tone(b, { type: 'sawtooth', f0: 55, f1: 41, dur: 1.4, peak: 0.08, attack: 0.3 });
    tone(b, { type: 'sine', f0: 41, f1: 33, dur: 1.5, peak: 0.25, attack: 0.3 });
  },
  // New level (level:start): ominous minor swell with a bell on top.
  levelStart() {
    const b = buses.ui;
    for (const f of [110, 131, 165]) tone(b, { type: 'sawtooth', f0: f, dur: 1.3, peak: 0.06, attack: 0.25 });
    tone(b, { type: 'sine', f0: 55, dur: 1.6, peak: 0.25, attack: 0.2 });
    tone(b, { type: 'triangle', f0: 880, t: 0.25, dur: 1.2, peak: 0.07 });
    tone(b, { type: 'sine', f0: 1320 * 1.007, t: 0.25, dur: 0.8, peak: 0.03 });
  },
  // Mega door (purchase:made kind 'megadoor'): long heavy iron grind, then a deep clang.
  megaDoor() {
    const b = buses.world;
    const k = rrange(0.96, 1.04);
    tone(b, { type: 'sawtooth', f0: 70 * k, f1: 48 * k, dur: 1.3, peak: 0.12, attack: 0.15 });
    tone(b, { type: 'square', f0: 71.5 * k, f1: 47 * k, dur: 1.3, peak: 0.05, attack: 0.15 });
    noise(b, { dur: 1.3, peak: 0.2, attack: 0.15, filter: 'bandpass', freq: 380 * k, freq1: 210 * k, q: 6 });
    noise(b, { t: 0.1, dur: 1.1, peak: 0.1, attack: 0.1, filter: 'bandpass', freq: 2200 * k, freq1: 1500 * k, q: 10 });
    const tc = 1.3;
    tone(b, { type: 'sine', f0: 95, f1: 40, t: tc, dur: 0.5, peak: 0.35, attack: 0.002 });
    tone(b, { type: 'triangle', f0: 620 * k, t: tc, dur: 0.7, peak: 0.06, attack: 0.002 });
    tone(b, { type: 'square', f0: 1310 * k, t: tc, dur: 0.3, peak: 0.03, attack: 0.002 });
    noise(b, { t: tc, dur: 0.12, peak: 0.2, attack: 0.001, filter: 'lowpass', freq: 1800 });
  },
  // ---- WO7 (Agent L): perks, Quick Revive, knife, acid boss ----
  // perk:bought: a short bright per-perk chiptune jingle, then a "drink" gulp.
  perkJingle(p) {
    const b = buses.ui;
    const m = PERK_MOTIFS[p && p.perkId] || PERK_MOTIFS._default;
    const n = m.notes.length;
    // Lead, a quiet octave-down triangle shadow for body, and a sparkle on the last note.
    notes(b, m.notes, { type: m.type, step: m.step, dur: m.step * 1.4, peak: 0.09 });
    notes(b, m.notes.map(f => f / 2), { type: 'triangle', step: m.step, dur: m.step * 1.2, peak: 0.05 });
    const tEnd = n * m.step;
    tone(b, { type: 'sine', f0: m.notes[n - 1] * 2, t: tEnd - m.step, dur: 0.35, peak: 0.03 });
    gulp(b, tEnd + 0.12);
  },
  // player:downed (Quick Revive path): falling low tone + a slow heartbeat under it.
  playerDowned(p) {
    const b = buses.player;
    const span = Math.max(0.6, Math.min(3, (p && Number(p.reviveIn)) || 1.5));
    tone(b, { type: 'sawtooth', f0: 180, f1: 45, dur: span, peak: 0.12, attack: 0.03 });
    tone(b, { type: 'sine', f0: 90, f1: 32, dur: span + 0.2, peak: 0.3, attack: 0.03 });
    for (let t = 0.15; t < span; t += 0.55) {
      tone(b, { type: 'sine', f0: 62, f1: 40, t, dur: 0.12, peak: 0.42, attack: 0.004 });          // lub
      tone(b, { type: 'sine', f0: 55, f1: 36, t: t + 0.17, dur: 0.1, peak: 0.3, attack: 0.004 });   // dub
    }
  },
  // player:revived: rising revive sting (upward sweep, major arpeggio, shimmer).
  playerRevived() {
    const b = buses.player;
    tone(b, { type: 'sawtooth', f0: 110, f1: 440, dur: 0.45, peak: 0.08, attack: 0.02 });
    notes(buses.ui, [392, 494, 587, 784], { type: 'square', step: 0.07, dur: 0.14, peak: 0.08, t0: 0.12 });
    tone(buses.ui, { type: 'triangle', f0: 784, t: 0.4, dur: 0.6, peak: 0.08 });
    tone(buses.ui, { type: 'sine', f0: 1568 * 1.005, t: 0.4, dur: 0.5, peak: 0.03 });
    noise(b, { dur: 0.45, peak: 0.05, attack: 0.1, filter: 'highpass', freq: 2500, freq1: 7000 });
  },
  // perk:lost: short descending blip (rate limited: removeAllPerks emits one per perk).
  perkLost() {
    if (rateLimited('perklost', 0.09)) return;
    tone(buses.ui, { type: 'square', f0: 880, f1: 330, dur: 0.12, peak: 0.07 });
    tone(buses.ui, { type: 'triangle', f0: 440, f1: 165, dur: 0.14, peak: 0.06 });
  },
  // melee:swing: quick whoosh, band-passed noise sweeping upward.
  meleeSwing() {
    if (rateLimited('mswing', 0.08)) return;
    const k = rrange(0.9, 1.1);
    noise(buses.player, { dur: 0.16, peak: 0.22, attack: 0.03, filter: 'bandpass', freq: 500 * k, freq1: 3200 * k, q: 2.5 });
    noise(buses.player, { t: 0.02, dur: 0.1, peak: 0.06, attack: 0.02, filter: 'highpass', freq: 3000, freq1: 6000 });
  },
  // melee:hit: wet thud; heavier (lower, longer, extra body) when the hit killed.
  meleeHit(p) {
    if (rateLimited('mhit', 0.03)) return;
    const b = buses.zombies;
    const heavy = !!(p && p.killed);
    const k = rrange(0.9, 1.1);
    tone(b, { type: 'sine', f0: (heavy ? 120 : 160) * k, f1: heavy ? 38 : 60, dur: heavy ? 0.18 : 0.1, peak: heavy ? 0.45 : 0.3 });
    noise(b, { dur: heavy ? 0.16 : 0.09, peak: heavy ? 0.3 : 0.22, filter: 'lowpass', freq: 900, freq1: 180, q: 3 });
    // Wet squelch: resonant band sweeping down.
    noise(b, { t: 0.01, dur: heavy ? 0.14 : 0.08, peak: heavy ? 0.14 : 0.08, filter: 'bandpass', freq: 1400, freq1: 450, q: 6 });
    if (heavy) tone(b, { type: 'triangle', f0: 90, f1: 45, t: 0.04, dur: 0.15, peak: 0.15 });
  },
  // boss:spit: gurgling telegraph plus a throat voice; the acid sizzle is scheduled
  // ACID_SIZZLE_DELAY later on the audio clock (there is no hazard-spawn event).
  bossSpit() {
    if (rateLimited('bspit', 0.3)) return;
    const b = bossBus();
    gurgle(b, 0, 0.6);
    voice(b, { f0: 95, f1: 140, dur: 0.5, peak: 0.18, attack: 0.05, formants: [[380, 4, 1.0], [900, 6, 0.4]] });
    acidSizzle(buses.world, ACID_SIZZLE_DELAY);
  },
  acidSizzle() { acidSizzle(buses.world, 0); },
  // ---- WO8 (Agent F): Pack-a-Punch ----
  // pap:start: heavy clank as the gun goes in, then the working hum + jingle (stoppable).
  papStart() {
    papClank(buses.world);
    startPapWork(0.35);
  },
  // pap:done: eject thunk + a bright rising sparkle shimmer.
  papDone() {
    stopPapWork(0.08);
    const b = buses.world;
    const k = rrange(0.95, 1.05);
    tone(b, { type: 'sine', f0: 150 * k, f1: 55, dur: 0.16, peak: 0.4, attack: 0.002 });
    noise(b, { dur: 0.08, peak: 0.2, attack: 0.001, filter: 'lowpass', freq: 1200, freq1: 300 });
    tone(b, { type: 'square', f0: 980 * k, t: 0.03, dur: 0.06, peak: 0.03, attack: 0.001 });
    const u = buses.ui;
    [1318.5, 1760, 2093, 2637, 3136, 3520].forEach((f, i) => {
      const fj = f * rrange(0.995, 1.005);
      tone(u, { type: 'sine', f0: fj, t: 0.12 + i * 0.05, dur: 0.5, peak: 0.05 - i * 0.004, attack: 0.004 });
      tone(u, { type: 'triangle', f0: fj * 1.004, t: 0.12 + i * 0.05, dur: 0.25, peak: 0.02, attack: 0.004 });
    });
    noise(u, { t: 0.1, dur: 0.7, peak: 0.06, attack: 0.08, filter: 'highpass', freq: 5000, freq1: 9000 });
  },
  board(p) {
    const byZombie = p && p.by === 'zombie';
    const f = byZombie ? rrange(120, 160) : rrange(200, 260);
    tone(buses.world, { type: 'triangle', f0: f, f1: f * 0.6, dur: 0.08, peak: 0.35 });
    noise(buses.world, { dur: 0.06, peak: 0.25, filter: 'bandpass', freq: byZombie ? 500 : 900, q: 3 });
  },
};

// ---------------------------------------------------------------------------------------------
// Public API

// name: one of the SFX keys above. Optional payload is the event payload (e.g. { weaponId }).
export function playSfx(name, payload) {
  if (!ready()) return;
  const fn = SFX[name];
  if (!fn) return;
  try { fn(payload); } catch (_) { /* never let audio break the game */ }
}

export function setMuted(bool) {
  muted = !!bool;
  if (!ready()) return;
  try {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, now, 0.02);
  } catch (_) { /* ignore */ }
}

// WO5 fix (review I2): one death groan per frame at most, none for cause 'debug' (the boss's
// finishFight clears leftover minions that way in the same frame as the victory sting).
let lastGroanMs = -1e9;
const GROAN_MIN_GAP_MS = 12;
function onZombieKilledSfx(p) {
  if (p && p.cause === 'debug') return;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - lastGroanMs < GROAN_MIN_GAP_MS) return;
  lastGroanMs = nowMs;
  playSfx('zombieKilled');
}

// Safe to call repeatedly (main calls it again after events.clearAll() on restart).
// Re-subscribes every call (dropping any previous subscriptions first); never creates a
// second AudioContext.
export function initAudio() {
  for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
  unsubs = [];
  stopLabHum(); // WO7: a re-init (restart path) never leaves the lab hum running
  stopPapWork(0.05); // WO8: nor the Pack-a-Punch hum/jingle
  const sub = (event, fn) => { unsubs.push(on(event, fn)); };

  sub('game:start', () => createContext());
  sub('game:restart', () => { tryResume(); gunVoices = []; thunderVoices = []; stopLabHum(); stopPapWork(); });

  sub('weapon:fired', p => playSfx('gunshot', p));
  sub('weapon:reload', () => playSfx('reload'));
  sub('weapon:empty', () => playSfx('empty'));
  sub('zombie:hit', p => playSfx(p && p.zombie && p.zombie.kind === 'boss' ? 'bossHit' : 'zombieHit'));
  sub('zombie:killed', onZombieKilledSfx);
  sub('player:damaged', () => playSfx('playerDamaged'));
  sub('player:down', () => playSfx('playerDown'));
  sub('round:start', () => playSfx('roundStart'));
  sub('round:end', () => playSfx('roundEnd'));
  sub('powerup:spawned', () => playSfx('powerupSpawned'));
  sub('powerup:collected', p => playSfx('powerupCollected', p));
  sub('powerup:expired', () => playSfx('powerupExpired'));
  sub('purchase:made', p => {
    if (p && p.kind === 'perk') return; // WO7: the perk:bought jingle replaces the cash tick
    if (p && p.kind === 'pap') return;  // WO8: the pap:start clank replaces the cash tick
    playSfx(p && p.kind === 'door' ? 'door' : p && p.kind === 'megadoor' ? 'megaDoor' : 'purchase', p);
  });
  // WO5 3.6
  sub('boss:start', () => playSfx('bossRoar'));
  sub('boss:charge', () => playSfx('bossCharge'));
  sub('boss:defeated', () => playSfx('bossDefeated'));
  sub('level:descend', () => playSfx('levelDescend'));
  sub('level:start', onLevelStart);
  sub('purchase:denied', () => playSfx('denied'));
  sub('box:opened', () => playSfx('boxOpened'));
  sub('barricade:board', p => playSfx('board', p));
  // WO7
  sub('perk:bought', p => playSfx('perkJingle', p));
  sub('perk:lost', () => playSfx('perkLost'));
  sub('player:downed', p => playSfx('playerDowned', p));
  sub('player:revived', () => playSfx('playerRevived'));
  sub('melee:swing', () => playSfx('meleeSwing'));
  sub('melee:hit', p => playSfx('meleeHit', p));
  sub('boss:spit', () => playSfx('bossSpit'));
  sub('game:over', () => stopLabHum());
  sub('level:descend', () => stopLabHum());
  // WO8
  sub('pap:start', p => playSfx('papStart', p));
  sub('pap:done', p => playSfx('papDone', p));
  sub('game:over', () => stopPapWork());
  sub('level:descend', () => stopPapWork());
}
