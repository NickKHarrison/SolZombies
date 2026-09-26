// hud.js — Agent J. DOM overlay drawn inside #hud (see WORK_ORDER.md 5.11).
// Reads state every frame but only touches the DOM when a displayed value changed.
// Animations are CSS-driven (class toggles / self-removing elements), no timers.

import { on } from './events.js';
import { POWERUP_LABEL } from './powerups.js';
import { createFaceState, updateFaceState, faceEvent, faceFrameKey, composeFace } from './sprites/face.js';
import * as bossMod from './boss.js'; // WO5: boss bar reads bossHpFrac lazily (guarded)

// Fallback labels in case powerups.js does not (yet) provide a key.
const FALLBACK_LABEL = {
  instaKill: 'INSTA-KILL',
  doublePoints: 'DOUBLE POINTS',
  maxAmmo: 'MAX AMMO',
  nuke: 'NUKE',
  carpenter: 'CARPENTER',
  fireSale: 'FIRE SALE',
  deathMachine: 'DEATH MACHINE',
  zombieBlood: 'ZOMBIE BLOOD',
};

const CHIP_FLASH_SECONDS = 5;   // chips flash in their last 5 seconds (spec)
const MAX_POINT_FLICKS = 6;     // cap concurrent "+N" floaters
const GRIN_SUPPRESS_SECONDS = 1; // WO2 3.8: no grin for the initial loadout after game:start/restart
const HEALTH_YELLOW = 0.65;      // health % text colour thresholds (WO2 3.8)
const HEALTH_RED = 0.25;

let root = null;
let els = null;
let unsubs = [];
let lastPhase = null;
let chips = new Map();           // type -> { el, label, time }
let faceState = null;            // WO2 3.8: status face state machine (sprites/face.js)
let faceKey = null;              // last drawn faceFrameKey
let faceCtx = null;
let grinBlockT = 0;              // seconds left during which grin events are ignored
// FIX-4 (QA review #1): weapon objects the HUD has already seen in player.weapons. weapon:equipped
// is also emitted on a plain slot swap and when the Death Machine expires; only a weapon object
// that was never seen before (buy, box take) counts as "getting a new gun" and grins.
let seenWeapons = new WeakSet();
let seenPlayer = null;           // the player whose weapons were last marked as seen
// WO5 3.6: banner queue. Every banner (FIRE SALE!, BOSS: .., STAIRS OPENED, LEVEL n — NAME)
// plays the same 3 s CSS animation on the one banner element; a banner requested while another
// is showing waits its turn, so back-to-back banners never clobber each other.
const BANNER_QUEUE_MAX = 4;
let bannerQueue = [];
let bannerBusy = false;
let bannerStartedAt = 0;         // performance.now() when the current banner started
const BANNER_FALLBACK_MS = 3400; // CSS animation is 3 s; advance anyway if animationend is lost
// WO5 3.6: boss bar damage-lag (white bar holds, then drains to the red bar).
const BOSS_LAG_HOLD = 0.45;      // seconds the white lag bar holds after a hit
const BOSS_LAG_RATE = 0.6;       // lag drain speed, fraction of max HP per second
let bossLag = 1;
let bossLagHold = 0;
let bossBarKey = null;           // bossId of the fight the lag belongs to

// ---------- small DOM helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setText(e, value) {
  const v = String(value);
  if (e.__text !== v) { e.__text = v; e.textContent = v; }
}

function setClass(e, cls, onOff) {
  const key = '__c_' + cls;
  const want = !!onOff;
  if (e[key] !== want) { e[key] = want; e.classList.toggle(cls, want); }
}

function setHidden(e, hidden) { setClass(e, 'hidden', hidden); }

// Restart a CSS animation class on an element.
function retrigger(e, cls) {
  e.classList.remove(cls);
  void e.offsetWidth; // force reflow so the animation restarts
  e.classList.add(cls);
}

function labelFor(type) {
  return (POWERUP_LABEL && POWERUP_LABEL[type]) || FALLBACK_LABEL[type] || String(type).toUpperCase();
}

// ---------- build ----------

function build() {
  root.textContent = '';
  root.className = 'hud';

  const points = el('div', 'hud-points');
  const pointsValue = el('div', 'hud-points-value', '0');
  const pointsFlicks = el('div', 'hud-points-flicks');
  points.append(pointsFlicks, pointsValue);

  const round = el('div', 'hud-round');
  const roundTally = el('div', 'hud-round-tally');
  const roundNum = el('div', 'hud-round-num');
  round.append(roundTally, roundNum);

  const weapon = el('div', 'hud-weapon');
  const weaponSecondary = el('div', 'hud-weapon-secondary');
  const weaponName = el('div', 'hud-weapon-name');
  const weaponAmmo = el('div', 'hud-weapon-ammo');
  const ammoMag = el('span', 'hud-ammo-mag');
  const ammoSep = el('span', 'hud-ammo-sep', ' / ');
  const ammoReserve = el('span', 'hud-ammo-reserve');
  weaponAmmo.append(ammoMag, ammoSep, ammoReserve);
  const weaponReload = el('div', 'hud-weapon-reload', 'RELOADING');
  weapon.append(weaponSecondary, weaponName, weaponAmmo, weaponReload);

  const powerups = el('div', 'hud-powerups');

  const bottomCenter = el('div', 'hud-bottom-center');
  const banner = el('div', 'hud-banner hidden', 'FIRE SALE!');
  const prompt = el('div', 'hud-prompt hidden');
  bottomCenter.append(banner, prompt);

  // WO2 3.8 face, WO4 layout: the Wolfenstein face keeps its own small steel box in the top-left
  // corner; HEALTH and KILLS are plain readouts in the bottom-left, styled like the ammo display.
  const faceBox = el('div', 'hud-facebox hidden');
  const face = el('div', 'hud-face');
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 24;
  faceCanvas.height = 30;
  faceCanvas.className = 'hud-face-canvas';
  face.append(faceCanvas);
  faceBox.append(face);

  const vitals = el('div', 'hud-vitals hidden');
  const health = el('div', 'hud-vital hud-vital-health');
  const healthValue = el('div', 'hud-vital-value', '100%');
  health.append(el('div', 'hud-vital-label', 'HEALTH'), healthValue);
  const kills = el('div', 'hud-vital hud-vital-kills');
  const killsValue = el('div', 'hud-vital-value', '0');
  kills.append(el('div', 'hud-vital-label', 'KILLS'), killsValue);
  vitals.append(health, kills);

  const screen = el('div', 'hud-screen hidden');

  // WO5 3.6: persistent level label under the round counter, boss bar below the power-up chips.
  const levelLabel = el('div', 'hud-level hidden');
  round.append(levelLabel);
  const bossBar = el('div', 'hud-boss hidden');
  const bossName = el('div', 'hud-boss-name');
  const bossTrack = el('div', 'hud-boss-track');
  const bossLagEl = el('div', 'hud-boss-lag');
  const bossFill = el('div', 'hud-boss-fill');
  bossTrack.append(bossLagEl, bossFill);
  bossBar.append(bossName, bossTrack);

  root.append(points, round, weapon, powerups, bossBar, bottomCenter, screen, faceBox, vitals);
  faceCtx = faceCanvas.getContext('2d');

  els = {
    points, pointsValue, pointsFlicks,
    round, roundTally, roundNum,
    weapon, weaponSecondary, weaponName, weaponAmmo, ammoMag, ammoSep, ammoReserve, weaponReload,
    powerups, banner, prompt, screen,
    faceBox, vitals, health, healthValue, faceCanvas, kills, killsValue,
    levelLabel, bossBar, bossName, bossLag: bossLagEl, bossFill,
  };

  // Self-cleaning animations.
  banner.addEventListener('animationend', endBanner);
  round.addEventListener('animationend', (ev) => {
    if (ev.target === round) round.classList.remove('round-start');
  });
  pointsValue.addEventListener('animationend', () => {
    pointsValue.classList.remove('bump');
  });
}

function buildScreen(state) {
  const s = els.screen;
  s.textContent = '';
  const phase = state.phase;
  if (phase === 'menu') {
    s.append(
      el('div', 'screen-title', 'SOL ZOMBIES'),
      el('div', 'screen-sub blink', 'Click / press Enter to start'),
    );
    const list = el('ul', 'screen-controls');
    const controls = [
      ['WASD / Arrows', 'Move'],
      ['Shift', 'Sprint'],
      ['Mouse', 'Aim / Fire'],
      ['R', 'Reload'],
      ['F / E', 'Buy guns / open doors / rebuild (hold)'],
      ['1 / 2 / Q / Wheel', 'Swap weapon'],
      ['Esc / P', 'Pause'],
    ];
    for (const [k, v] of controls) {
      const li = el('li');
      li.append(el('span', 'key', k), el('span', 'what', v));
      list.append(li);
    }
    s.append(list);
  } else if (phase === 'gameover') {
    const st = state.stats || {};
    const n = st.roundReached || (state.rounds && state.rounds.round) || 0;
    const fired = st.shotsFired || 0;
    const acc = fired > 0 ? Math.round(((st.shotsHit || 0) / fired) * 100) : 0;
    s.append(
      el('div', 'screen-title gameover', 'GAME OVER'),
      el('div', 'screen-headline', `YOU SURVIVED ${n} ROUND${n === 1 ? '' : 'S'}`),
    );
    const table = el('div', 'screen-stats');
    for (const [k, v] of [['Kills', st.kills || 0], ['Points earned', st.pointsEarned || 0], ['Accuracy', acc + '%']]) {
      const row = el('div', 'stat');
      row.append(el('span', 'stat-k', k), el('span', 'stat-v', String(v)));
      table.append(row);
    }
    s.append(table, el('div', 'screen-sub blink', 'Press Enter to restart'));
  } else if (phase === 'paused') {
    s.append(
      el('div', 'screen-title', 'PAUSED'),
      el('div', 'screen-sub', 'Press Esc / P to resume'),
    );
  }
  s.dataset.phase = phase;
}

// ---------- event-driven animations ----------

function onPointsChanged(p) {
  if (!els || !p) return;
  const delta = Number(p.delta) || 0;
  if (delta === 0) return;
  const flicks = els.pointsFlicks;
  while (flicks.childElementCount >= MAX_POINT_FLICKS) flicks.firstElementChild.remove();
  const f = el('div', 'hud-flick ' + (delta > 0 ? 'gain' : 'spend'), (delta > 0 ? '+' : '-') + Math.abs(delta));
  f.addEventListener('animationend', () => f.remove());
  flicks.append(f);
  if (delta > 0) retrigger(els.pointsValue, 'bump');
}

function onRoundStart() {
  if (!els) return;
  retrigger(els.round, 'round-start');
}

function onPowerupCollected(p) {
  if (!els || !p || p.type !== 'fireSale') return;
  queueBanner('FIRE SALE!');
}

// WO5 3.6 banners. Queued (see bannerQueue); an identical text already waiting is not re-added.
function queueBanner(text) {
  if (!els || !text) return;
  if (bannerQueue.includes(text)) return;
  if (bannerQueue.length >= BANNER_QUEUE_MAX) bannerQueue.shift();
  bannerQueue.push(text);
  if (!bannerBusy) playNextBanner();
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function endBanner() {
  if (!els) return;
  els.banner.classList.remove('show');
  setHidden(els.banner, true);
  bannerBusy = false;
  playNextBanner();
}

function playNextBanner() {
  if (!els || bannerBusy || bannerQueue.length === 0) return;
  const text = bannerQueue.shift();
  bannerBusy = true;
  bannerStartedAt = nowMs();
  setText(els.banner, text);
  setClass(els.banner, 'long', text.length > 14);
  setHidden(els.banner, false);
  retrigger(els.banner, 'show');
}

// The banner lives in .hud-bottom-center, which is display:none on menu/game over; a CSS
// animation never ends there, so the queue is flushed when the game leaves 'playing'/'paused'.
function resetBanners() {
  bannerQueue = [];
  bannerBusy = false;
  if (!els) return;
  els.banner.classList.remove('show');
  setHidden(els.banner, true);
}

function onBossStart(p) {
  const name = (p && p.name) || 'BOSS';
  queueBanner('BOSS: ' + name);
}

function onBossDefeated() {
  queueBanner('STAIRS OPENED');
}

function onLevelStart(p) {
  if (!p || !(p.index > 0)) return; // no banner for the first level of a new game
  const n = (p.index | 0) + 1;
  queueBanner(p.name ? `LEVEL ${n} — ${String(p.name).toUpperCase()}` : `LEVEL ${n}`);
}

function onPlayerDamaged() {
  if (faceState) faceEvent(faceState, 'hurt');
}

function onGrinPowerup() {
  if (faceState && grinBlockT <= 0) faceEvent(faceState, 'grin');
}

function onWeaponEquipped(p) {
  if (!p || !(p.slot >= 0)) return; // slot -1 = temporary Death Machine (the power-up grins already)
  const w = seenPlayer && seenPlayer.weapons ? seenPlayer.weapons[p.slot] : null;
  if (!w || typeof w !== 'object' || seenWeapons.has(w)) return; // swap / Death Machine expiry
  seenWeapons.add(w);
  onGrinPowerup();
}

// Mark every weapon the player currently holds as seen (called each frame). A new player object
// (restart) is marked silently, so its starting loadout never grins.
function markSeenWeapons(player) {
  if (!player || !Array.isArray(player.weapons)) return;
  seenPlayer = player;
  for (const w of player.weapons) if (w && typeof w === 'object') seenWeapons.add(w);
}

function onGameStart() {
  grinBlockT = GRIN_SUPPRESS_SECONDS;
}

// ---------- public API ----------

export function initHud(rootEl) {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  root = rootEl || (typeof document !== 'undefined' ? document.getElementById('hud') : null);
  if (!root) return;
  chips = new Map();
  lastPhase = null;
  faceState = createFaceState(1);
  faceKey = null;
  grinBlockT = GRIN_SUPPRESS_SECONDS;
  seenWeapons = new WeakSet();
  seenPlayer = null;
  bannerQueue = [];
  bannerBusy = false;
  bossLag = 1;
  bossLagHold = 0;
  bossBarKey = null;
  build();
  unsubs.push(
    on('points:changed', onPointsChanged),
    on('round:start', onRoundStart),
    on('powerup:collected', onPowerupCollected),
    on('player:damaged', onPlayerDamaged),
    on('powerup:collected', onGrinPowerup),
    on('weapon:equipped', onWeaponEquipped),
    on('game:start', onGameStart),
    on('game:restart', onGameStart),
    on('boss:start', onBossStart),
    on('boss:defeated', onBossDefeated),
    on('level:start', onLevelStart),
  );
}

export function updateHud(state) {
  if (!root || !els || !state) return;

  const phase = state.phase || 'menu';
  if (phase !== lastPhase) {
    lastPhase = phase;
    root.dataset.phase = phase;
    const showScreen = phase === 'menu' || phase === 'gameover' || phase === 'paused';
    if (showScreen) buildScreen(state);
    setHidden(els.screen, !showScreen);
    if (phase === 'menu' || phase === 'gameover') resetBanners();
  }

  updatePoints(state.player);
  updateRound(state.rounds);
  updateWeapon(state.player);
  updatePowerups(state);
  updatePrompt(state.shop && state.shop.prompt);
  if (bannerBusy && nowMs() - bannerStartedAt > BANNER_FALLBACK_MS) endBanner();
  updateStatus(state);
  updateLevelLabel(state);
  updateBossBar(state);
  markSeenWeapons(state.player);
}

// WO5 3.6: small "L2 CATACOMBS" label under the round counter (shown whenever state.level exists).
function updateLevelLabel(state) {
  const lv = state.level;
  setHidden(els.levelLabel, !lv);
  if (!lv) return;
  const n = ((lv.index | 0) + 1);
  const name = lv.name || (lv.def && lv.def.name) || '';
  setText(els.levelLabel, name ? `L${n} ${String(name).toUpperCase()}` : `L${n}`);
}

// WO5 3.6: boss bar, visible only while state.boss.phase === 'active'.
function updateBossBar(state) {
  const b = state.boss;
  const active = !!b && b.phase === 'active';
  setHidden(els.bossBar, !active);
  if (!active) { bossBarKey = null; return; }
  let frac = 0;
  try {
    frac = typeof bossMod.bossHpFrac === 'function' ? Number(bossMod.bossHpFrac(state)) : 0;
  } catch { frac = 0; }
  if (!Number.isFinite(frac)) frac = 0;
  frac = Math.max(0, Math.min(1, frac));
  const key = b.bossId != null ? b.bossId : (b.startedAt || 0);
  if (key !== bossBarKey) { bossBarKey = key; bossLag = frac; bossLagHold = 0; }
  const dt = lastPhase === 'playing' ? Math.max(0, Number(state.dt) || 0) : 0;
  if (frac >= bossLag) {
    bossLag = frac;
    bossLagHold = 0;
  } else if (els.bossFill.__frac != null && frac < els.bossFill.__frac) {
    bossLagHold = BOSS_LAG_HOLD; // fresh hit: hold the white bar before it drains
  } else if (bossLagHold > 0) {
    bossLagHold = Math.max(0, bossLagHold - dt);
  } else {
    bossLag = Math.max(frac, bossLag - BOSS_LAG_RATE * dt);
  }
  els.bossFill.__frac = frac;
  setText(els.bossName, String(b.name || 'BOSS').toUpperCase());
  const fw = (frac * 100).toFixed(2) + '%';
  const lw = (bossLag * 100).toFixed(2) + '%';
  if (els.bossFill.__w !== fw) { els.bossFill.__w = fw; els.bossFill.style.width = fw; }
  if (els.bossLag.__w !== lw) { els.bossLag.__w = lw; els.bossLag.style.width = lw; }
}

// Debug/QA helper (main.js __game.debug.face): fire a face event directly, bypassing the
// post-start grin block. Returns the resulting faceFrameKey, or null before initHud.
export function debugFaceEvent(kind) {
  if (!faceState) return null;
  faceEvent(faceState, kind);
  return faceFrameKey(faceState);
}

// WO2 3.8 status readouts (WO4 layout): face box top-left, health % and kills bottom-left.
function updateStatus(state) {
  const p = state.player;
  setHidden(els.faceBox, !p);
  setHidden(els.vitals, !p);
  if (!p) return;
  // Timers only run while playing (paused / game over freeze the face; dt is stale then).
  const dt = lastPhase === 'playing' ? Math.max(0, Number(state.dt) || 0) : 0;
  grinBlockT = Math.max(0, grinBlockT - dt);

  const max = p.maxHealth > 0 ? p.maxHealth : 100;
  const frac = Math.max(0, Math.min(1, (Number(p.health) || 0) / max));
  const shownPct = p.down ? 0 : Math.ceil(frac * 100);
  setText(els.healthValue, shownPct + '%');
  setClass(els.health, 'warn', !p.down && frac < HEALTH_YELLOW && frac >= HEALTH_RED);
  setClass(els.health, 'crit', p.down || frac < HEALTH_RED);

  setText(els.killsValue, (state.stats && state.stats.kills) | 0);

  if (!faceState) return;
  updateFaceState(faceState, frac, !!p.down, dt);
  const key = faceFrameKey(faceState);
  if (key !== faceKey) {
    faceKey = key;
    drawFace(composeFace(faceState));
  }
}

function drawFace(sprite) {
  if (!faceCtx || !sprite || !sprite.pixels) return;
  const w = sprite.w | 0, h = sprite.h | 0;
  if (w <= 0 || h <= 0 || sprite.pixels.length !== w * h * 4) return;
  faceCtx.clearRect(0, 0, els.faceCanvas.width, els.faceCanvas.height);
  faceCtx.putImageData(new ImageData(new Uint8ClampedArray(sprite.pixels), w, h), 0, 0);
}

function updatePoints(player) {
  setHidden(els.points, !player);
  if (!player) return;
  setText(els.pointsValue, Math.floor(player.points || 0));
}

function updateRound(rounds) {
  const r = rounds ? (rounds.round | 0) : 0;
  setHidden(els.round, !rounds);
  if (!rounds) return;
  if (els.round.__round !== r) {
    els.round.__round = r;
    const tally = r >= 1 && r <= 5;
    setHidden(els.roundTally, !tally);
    setHidden(els.roundNum, tally || r < 1);
    if (tally) {
      els.roundTally.textContent = '';
      const strokes = Math.min(r, 4);
      for (let i = 0; i < strokes; i++) els.roundTally.append(el('i', 'stroke'));
      if (r === 5) els.roundTally.append(el('i', 'stroke slash'));
    } else {
      setText(els.roundNum, r >= 1 ? r : '');
    }
  }
  // Brighter red during the break between rounds (CSS transition fades it in and out).
  setClass(els.round, 'break', rounds.phase === 'break' && r > 0);
}

function updateWeapon(player) {
  const w = player ? (player.tempWeapon || (player.weapons && player.weapons[player.activeSlot])) : null;
  setHidden(els.weapon, !w);
  if (!w) return;
  const def = w.def || {};
  const infinite = def.id === 'deathmachine' || w.id === 'deathmachine' || !Number.isFinite(w.mag);
  setText(els.weaponName, def.name || w.id || '');

  let secondary = null;
  if (player.weapons) {
    secondary = player.tempWeapon
      ? player.weapons[player.activeSlot] || player.weapons.find(Boolean)
      : player.weapons[player.activeSlot === 0 ? 1 : 0];
  }
  setText(els.weaponSecondary, secondary ? ((secondary.def && secondary.def.name) || secondary.id) : '');

  if (infinite) {
    setText(els.ammoMag, '∞');
    setHidden(els.ammoSep, true);
    setHidden(els.ammoReserve, true);
    setClass(els.ammoReserve, 'empty', false);
  } else {
    setText(els.ammoMag, w.mag | 0);
    setText(els.ammoReserve, Number.isFinite(w.reserve) ? (w.reserve | 0) : '∞');
    setHidden(els.ammoSep, false);
    setHidden(els.ammoReserve, false);
    setClass(els.ammoReserve, 'empty', w.reserve === 0);
  }
  setClass(els.ammoMag, 'empty', !infinite && (w.mag | 0) === 0);
  const reloading = !infinite && !!w.reloading;
  setClass(els.weapon, 'reloading', reloading);
}

function updatePowerups(state) {
  const active = (state.powerups && state.powerups.active) || {};
  const now = state.time || 0;
  // Remove chips that are no longer active.
  for (const [type, chip] of chips) {
    if (!(type in active)) { chip.el.remove(); chips.delete(type); }
  }
  for (const type of Object.keys(active)) {
    const left = Math.max(0, Math.ceil((active[type] || 0) - now));
    let chip = chips.get(type);
    if (!chip) {
      const c = el('div', 'hud-chip');
      c.dataset.type = type;
      const label = el('span', 'chip-label', labelFor(type));
      const time = el('span', 'chip-time');
      c.append(label, time);
      els.powerups.append(c);
      chip = { el: c, label, time };
      chips.set(type, chip);
    }
    setText(chip.time, left);
    setClass(chip.el, 'flash', left <= CHIP_FLASH_SECONDS);
  }
}

function updatePrompt(prompt) {
  const show = !!(prompt && prompt.text) && lastPhase === 'playing';
  setHidden(els.prompt, !show);
  if (!show) return;
  setText(els.prompt, prompt.text);
  // shop.js prompt: grey when unaffordable OR blocked (e.g. ammo already full). Integrator fix.
  setClass(els.prompt, 'cant-afford', prompt.canAfford === false || !!prompt.blocked);
}
