// main.js (Integrator) — boot, game loop, menu / pause / game over / restart, debug hooks.
// WORK_ORDER.md 5.13 (flow) and 3.7 (update order).
import { CANVAS, FIXED_DT_CAP, PLAYER, LOOP } from './config.js';
import * as events from './events.js';
import { createEmptyState } from './state.js';
import * as input from './input.js';
import * as player from './player.js';
import * as weapons from './weapons.js';
import * as zombie from './zombie.js';
import * as pathfinding from './pathfinding.js';
import * as waves from './waves.js';
import * as powerups from './powerups.js';
import * as map from './map.js';
import * as shop from './shop.js';
import * as render from './render.js';
import * as hud from './hud.js';
import * as audio from './audio.js';
import * as boss from './boss.js';
import * as level from './level.js';
import * as touch from './touch.js';
import * as device from './device.js';

const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const stageEl = document.getElementById('stage');
const touchLayer = document.getElementById('touch');
const DEBUG_URL = /[?&]debug=1\b/.test(location.search);
const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

let state = null;
let flowTimer = 0;       // seconds since the last flow field rebuild
let timeScale = 1;       // debug only
let lastNow = 0;
let flowMap = null;      // map object / version the current flow field was built for (WO5)
let flowVersion = -1;
// WO6 mobile / touch.
let mobile = false;       // device.isMobile() at boot
let rotatePaused = false; // the game was auto-paused because the phone turned to portrait
let lastRotate = null;    // last value sent to hud.setRotateOverlay (null = resend)
let lastPrompt;           // last value sent to touch.setTouchPrompt (undefined = resend)

// touch.js / hud.js mobile exports are optional at runtime: call only when present.
function call(mod, name, ...args) {
  const fn = mod && mod[name];
  return typeof fn === 'function' ? fn(...args) : undefined;
}

// ---------------------------------------------------------------------------
// State construction and wiring
// ---------------------------------------------------------------------------

// WO5: the map comes from level.startLevel(state, 0) (level 1 of the registry). The player is
// created first (startLevel moves it to map.playerStart) and rounds exist so startLevel resets
// them in place. Runs before initAll, so the index-0 level:start reaches no listener (HUD/audio
// suppress index 0 anyway).
function buildState(seed) {
  const s = createEmptyState(seed);
  s.player = player.createPlayer(0, 0);
  s.rounds = waves.createRoundState();
  s.debug = DEBUG_URL;
  level.startLevel(s, 0);
  player.giveWeapon(s, PLAYER.startWeapon);
  flowMap = null;
  flowVersion = -1;
  updateCamera(s);
  return s;
}

// Every init that subscribes to the event bus. Must run again after events.clearAll().
// DOM inits first, gameplay listeners after (5.13).
function initAll(s) {
  input.initInput(canvas);   // idempotent: removes its previous DOM listeners first
  render.initRender(canvas);
  hud.initHud(hudRoot);
  audio.initAudio();
  player.initPlayer(s);
  waves.initRounds(s);
  powerups.initPowerups(s);
  shop.initShop(s);
  boss.initBoss(s);
  events.on('player:down', onPlayerDown);
  applyMobile();
}

// WO6: (re)apply the touch scheme. Runs after hud.initHud so the HUD mobile mode survives restarts.
function applyMobile() {
  lastRotate = null;
  lastPrompt = undefined;
  rotatePaused = false;
  if (!mobile) return;
  try {
    call(touch, 'initTouch', touchLayer, canvas);
    call(touch, 'setTouchEnabled', true);
    call(hud, 'setMobileHud', true);
  } catch (err) {
    console.error('[main] mobile setup error', err);
  }
}

// "Press F to buy Sheiva [50]" -> "Buy Sheiva [50]" (touch ACTION button label).
function touchPromptText(text) {
  if (!text) return null;
  const t = String(text).replace(/^(press f to|press f for|hold f to)\s+/i, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

// Per-frame touch ACTION label (after the shop update, so it matches this frame's prompt).
function updateTouchPrompt(s) {
  if (!mobile) return;
  const prompt = s.phase === 'playing' && s.shop && s.shop.prompt ? touchPromptText(s.shop.prompt.text) : null;
  if (prompt !== lastPrompt) {
    lastPrompt = prompt;
    call(touch, 'setTouchPrompt', prompt);
  }
}

// Per-frame portrait handling (rotate overlay + auto-pause), before the gameplay update.
function updateOrientation(s) {
  if (!mobile) return;
  const portrait = device.isPortrait();
  if (portrait !== lastRotate) {
    lastRotate = portrait;
    call(hud, 'setRotateOverlay', portrait);
  }
  if (portrait) {
    if (s.phase === 'playing') { s.phase = 'paused'; rotatePaused = true; }
  } else if (rotatePaused) {
    rotatePaused = false;
    if (s.phase === 'paused') s.phase = 'playing';
  }
}

function onPlayerDown(p) {
  if (!state || state.phase === 'gameover') return;
  state.phase = 'gameover';
  events.emit('game:over', {
    round: (p && p.round) || state.stats.roundReached || 0,
    kills: (p && p.kills) || state.stats.kills,
    points: (p && p.points) || (state.player ? state.player.points : 0),
  });
}

// Called from inside a DOM user-gesture handler so audio.js can create/resume its AudioContext.
function startGame() {
  if (!state || state.phase !== 'menu') return;
  state.phase = 'playing';
  input.resetInput();        // swallow the click / key that started the game (no stray shot)
  flowTimer = LOOP.flowRebuildInterval; // build the flow field on the first frame
  events.emit('game:start', {});
}

function restartGame() {
  events.clearAll();
  state = buildState(Date.now());
  initAll(state);
  flowTimer = LOOP.flowRebuildInterval;
  state.phase = 'playing';
  events.emit('game:restart', {});
  events.emit('game:start', {}); // audio: create/resume context (we are in a user gesture)
}

// ---------------------------------------------------------------------------
// Per-frame update (3.7)
// ---------------------------------------------------------------------------

function updateCamera(s) {
  const p = s.player, m = s.map;
  if (!p || !m) return;
  const vw = canvas ? canvas.width : CANVAS.width, vh = canvas ? canvas.height : CANVAS.height;
  let cx = p.x - vw / 2, cy = p.y - vh / 2;
  cx = m.width <= vw ? (m.width - vw) / 2 : Math.max(0, Math.min(m.width - vw, cx));
  cy = m.height <= vh ? (m.height - vh) / 2 : Math.max(0, Math.min(m.height - vh, cy));
  s.camera.x = cx;
  s.camera.y = cy;
}

function update(s, inp, dt) {
  s.dt = dt;
  s.time += dt;
  // WO5: level transition first. While it runs (fade out, swap at the midpoint, fade in) no
  // gameplay system updates; render/HUD still run from tick().
  level.updateLevel(s, dt);
  updateCamera(s);
  if (s.transition) {
    // WO5 FIX-1 (QA review L2): timed power-ups store absolute expiry times (state.time based);
    // push them forward so the fade (nothing playable) costs them no time.
    const act = s.powerups && s.powerups.active;
    if (act) for (const k in act) if (typeof act[k] === 'number') act[k] += dt;
    render.updateEffects(s, dt);
    return;
  }
  // WO6: touch aim stick gives a direction; aim 300 px along it from the player.
  const av = inp.aimVector;
  const aim = av
    ? { x: s.player.x + av.x * 300, y: s.player.y + av.y * 300 }
    : { x: inp.mouseX + s.camera.x, y: inp.mouseY + s.camera.y };
  player.updatePlayer(s, inp, aim, dt);
  waves.updateRounds(s, dt);
  flowTimer += dt;
  // Rebuild on the interval, and at once when the map object (new level) or its version (doors,
  // mega door seal/unseal, stairs) changed.
  if (!s.flow || flowTimer >= LOOP.flowRebuildInterval || s.map !== flowMap || s.map.version !== flowVersion) {
    flowTimer = 0;
    flowMap = s.map;
    flowVersion = s.map.version;
    s.flow = pathfinding.buildFlowField(s.map, s.player.x, s.player.y);
  }
  zombie.updateZombies(s, dt);
  boss.updateBoss(s, dt);
  weapons.updateBullets(s, dt);
  powerups.updatePowerups(s, dt);
  shop.updateShop(s, inp, dt);
  render.updateEffects(s, dt);
  updateCamera(s); // follow the post-move player position for this frame's render
}

// Edge-triggered flags must only act once even when a frame is split into sub-steps.
function withoutEdges(inp) {
  return { ...inp, firePressed: false, reload: false, interact: false, swap: false, slot: 0, wheel: 0,
    restart: false, start: false, pause: false, debugKey: false };
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = lastNow ? (now - lastNow) / 1000 : 0;
  lastNow = now;
  tick(Math.min(FIXED_DT_CAP, Math.max(0, raw)), input.getInput());
}

// One frame of the 3.7 loop with an explicit dt (also driven by the debug step() hook).
function tick(dt, inp) {
  if (inp.debugKey) state.debug = !state.debug;
  if (inp.pause) {
    if (state.phase === 'playing') state.phase = 'paused';
    else if (state.phase === 'paused') state.phase = 'playing';
  }
  try { updateOrientation(state); } catch (err) { console.error('[main] mobile frame error', err); }

  try {
    if (state.phase === 'playing' && dt > 0) {
      // Debug time scale: split into sub-steps no longer than FIXED_DT_CAP (no tunneling at 10x).
      const total = dt * timeScale;
      const steps = Math.max(1, Math.ceil(total / FIXED_DT_CAP - 1e-9));
      const sdt = total / steps;
      for (let i = 0; i < steps && state.phase === 'playing'; i++) {
        update(state, i === 0 ? inp : withoutEdges(inp), sdt);
      }
    } else {
      updateCamera(state);
    }
    render.render(state);
    hud.updateHud(state);
    updateTouchPrompt(state);
  } catch (err) {
    console.error('[main] frame error', err);
  }
  input.endFrame();
}

// ---------------------------------------------------------------------------
// User-gesture handlers (start / restart). Registered once; they survive restarts.
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  if (e.repeat || !START_KEYS.has(e.code) || !state) return;
  if (state.phase === 'menu') startGame();
  else if (state.phase === 'gameover') restartGame();
}

function onCanvasClick() {
  if (state && state.phase === 'menu') startGame();
}

// WO6: on touch devices any tap on the stage is the user gesture that goes immersive and
// starts (menu) or restarts (game over) the game; game:start then creates/resumes audio.
function onStagePointerDown() {
  if (!mobile || !state) return;
  device.requestImmersive();
  if (state.phase === 'menu') startGame();
  else if (state.phase === 'gameover') restartGame();
}

// ---------------------------------------------------------------------------
// Debug hooks (?debug=1)
// ---------------------------------------------------------------------------

function aliveZombies() {
  return state.zombies.filter((z) => z.mode !== 'dying');
}

function installDebug() {
  const debug = {
    spawnPowerup(type, x, y) {
      if (!powerups.POWERUP_TYPES.includes(type)) throw new Error(`unknown power-up "${type}"`);
      const p = state.player;
      // Default: on the player, so it is collected on the next frame.
      return powerups.spawnPowerup(state, type, x ?? p.x, y ?? p.y);
    },
    skipToRound(n) {
      for (const z of aliveZombies()) zombie.killZombie(state, z, 'debug');
      state.powerups.nuke = null;
      waves.skipToRound(state, n);
    },
    giveWeapon(id) { return player.giveWeapon(state, id); },
    // WO2 Phase 2: status face and health helpers.
    face(kind = 'hurt') {
      if (kind !== 'hurt' && kind !== 'grin') throw new Error(`unknown face event "${kind}"`);
      return hud.debugFaceEvent(kind);
    },
    // n is in health points (0..maxHealth). 0 goes through damagePlayer (down -> game over).
    // holdRegen (default true) pauses regen until the next hit so a face tier can be inspected.
    setHealth(n, holdRegen = true) {
      const p = state.player;
      const v = Math.max(0, Math.min(p.maxHealth, Number(n) || 0));
      if (v <= 0) {
        if (state.phase === 'playing') player.damagePlayer(state, p.health + 1);
        return p.health;
      }
      p.health = v;
      p.regenTimer = holdRegen ? 1e9 : PLAYER.regenDelay;
      return p.health;
    },
    addPoints(n) {
      const p = state.player;
      p.points += n;
      events.emit('points:changed', { delta: n, total: p.points });
      return p.points;
    },
    killAll(cause = 'debug') {
      const list = aliveZombies();
      for (const z of list) zombie.killZombie(state, z, cause);
      return list.length;
    },
    god(on = true) { state.player.invulnerable = !!on; return state.player.invulnerable; },
    spawnZombie(n = 1, spawnPointId) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const sp = spawnPointId != null
          ? state.map.spawnPoints.find((s) => s.id === spawnPointId)
          : waves.pickSpawnPoint(state);
        if (sp) out.push(zombie.spawnZombie(state, sp));
      }
      return out;
    },
    setTimeScale(x) { timeScale = Math.max(0, Math.min(20, Number(x) || 0)); return timeScale; },
    // Advance the game synchronously by `seconds` of frames (works while rAF is paused, e.g. a
    // hidden tab). Uses the live input snapshot (real key edges apply on the first frame only),
    // with `inp` fields overriding it.
    step(seconds = 1, frameDt = 1 / 60, inp = null) {
      const n = Math.max(1, Math.round(seconds / frameDt));
      for (let i = 0; i < n; i++) {
        const live = input.getInput();
        tick(frameDt, { ...(i === 0 ? live : withoutEdges(live)), ...(inp || {}) });
      }
      return { time: state.time, phase: state.phase, round: state.rounds.round };
    },
    // WO4 doors. openDoor/openAllDoors bypass the shop (free, no purchase:made event); to test
    // the real purchase path, stand next to a door and call step(dt, dt, { interact: true }).
    openDoor(id) {
      const ok = map.openDoor(state.map, id);
      if (ok) state.flow = null; // rebuild the flow field next frame
      return ok;
    },
    openAllDoors() {
      let n = 0;
      for (const d of state.map.doors || []) if (debug.openDoor(d.id)) n++;
      return n;
    },
    doors() {
      return (state.map.doors || []).map((d) => ({ id: d.id, letter: d.letter, cost: d.cost, open: d.open }));
    },
    // WO5. openMegaDoor opens every normal door and then the mega door (free, no purchase:made).
    openMegaDoor() {
      debug.openAllDoors();
      const ok = map.openMegaDoor(state.map);
      if (ok) state.flow = null;
      return ok;
    },
    // Teleports the player onto the arena tile nearest the mega door and starts the fight.
    startBoss() {
      const m = state.map;
      if (!m.megaDoor || !m.arenaTiles || !m.arenaTiles.size) return false;
      if (state.boss && state.boss.phase !== 'idle') return false;
      if (!m.megaDoor.open && !m.megaDoor.sealed) debug.openMegaDoor();
      const T = m.width / m.cols;
      let best = null, bd = Infinity;
      for (const i of m.arenaTiles) {
        const x = (i % m.cols + 0.5) * T, y = (Math.floor(i / m.cols) + 0.5) * T;
        const d = Math.hypot(x - m.megaDoor.cx, y - m.megaDoor.cy);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      state.player.x = best.x;
      state.player.y = best.y;
      const ok = boss.startFight(state);
      state.flow = null;
      return ok;
    },
    // Kills the live boss with cause 'weapon' (pays like a real kill: 10 + 190 = 200).
    killBoss() {
      const z = boss.bossZombie(state);
      if (!z) return false;
      zombie.killZombie(state, z, 'weapon');
      return true;
    },
    boss() { return state.boss; },
    // Starts the stairs descent (opens the stairs first if they are still closed).
    descend() {
      if (state.map.stairs && !state.map.stairs.open) map.openStairs(state.map);
      return level.beginDescent(state);
    },
    // Loads level i (absolute progression index) at once, no fade.
    setLevel(i = 0) {
      state.transition = null;
      const lv = level.startLevel(state, i);
      return { index: lv.index, name: lv.name, loop: lv.loop, difficulty: { ...lv.difficulty } };
    },
    // Merges fields into the current level difficulty ({ healthMult, speedMult, countMult, sprintShift }).
    setDifficulty(obj = {}) {
      Object.assign(state.level.difficulty, obj);
      return { ...state.level.difficulty };
    },
    // Extras for QA:
    damagePlayer(n) { player.damagePlayer(state, n); return state.player.health; },
    teleport(x, y) { state.player.x = x; state.player.y = y; },
    start() { if (state.phase === 'menu') startGame(); },
    restart() { restartGame(); },
    // WO6: the boot-time touch detection result (true = touch scheme active).
    mobile() { return mobile; },
  };
  window.__game = {
    get state() { return state; },
    debug,
    modules: { events, input, player, weapons, zombie, pathfinding, waves, powerups, map, shop, render, hud, audio, boss, level, touch, device },
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  mobile = device.isMobile();
  state = buildState(Date.now());
  initAll(state);
  window.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('click', onCanvasClick);
  if (stageEl) stageEl.addEventListener('pointerdown', onStagePointerDown, { capture: true });
  if (DEBUG_URL) installDebug();
  requestAnimationFrame(frame);
}

boot();
