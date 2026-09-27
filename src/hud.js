// hud.js — Agent J. DOM overlay drawn inside #hud (see WORK_ORDER.md 5.11).
// Reads state every frame but only touches the DOM when a displayed value changed.
// Animations are CSS-driven (class toggles / self-removing elements), no timers.

import { on } from './events.js';
import { POWERUP_LABEL } from './powerups.js';
import { createFaceState, updateFaceState, faceEvent, faceFrameKey, composeFace } from './sprites/face.js';
import * as bossMod from './boss.js'; // WO5: boss bar reads bossHpFrac lazily (guarded)
import * as config from './config.js'; // WO7: PERKS (perk row, revive overlay, banner), guarded
import * as weaponsMod from './weapons.js'; // WO7: favourite weapon name on game over (guarded)
import * as touchMod from './touch.js'; // WO9: LEVELS click -> touch.triggerLevelsButton (guarded)

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
let lastLevelStyle = null;       // WO9 FIX-4: mirrored onto #stage/#hud[data-level-style]
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
// WO6: touch HUD. mobileHud swaps the key hints for touch hints and hides .hud-prompt (the touch
// ACTION button carries the prompt). Kept across initHud so either call order works.
let mobileHud = false;
let lastState = null;            // for rebuilding the centre screen when mobileHud flips
// WO7 T4: high-score data for the menu (setScores) and the game-over run summary
// (setGameOverSummary). scoreSummary survives initHud (menu data, set at boot); the game-over
// summary is dropped when a new game starts (phase -> playing / menu).
let scoreSummary = null;
let gameOverSummary = null;
const TOP_ROWS = 5;
// WO9 (Agent I): pause-screen LEVELS button listeners (hud.onLevelsButton). Module level, so they
// survive initHud / screen rebuilds; each button click calls every listener once.
const levelsListeners = new Set();
const PRACTICE_TEXT = 'PRACTICE RUN — NOT RANKED';

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

// WO9: small six-armed ice crystal (inline SVG, stroke = currentColor).
function iceIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('class', 'hud-slow-icon');
  svg.setAttribute('aria-hidden', 'true');
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const c = Math.cos(a), s = Math.sin(a);
    const p = (r, t) => `${(c * r - s * t).toFixed(2)} ${(s * r + c * t).toFixed(2)}`;
    d += `M0 0L${p(11, 0)}M${p(6, 0)}L${p(9, 3)}M${p(6, 0)}L${p(9, -3)}`;
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
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
  // WO9: the label row swaps "HEALTH" for an ice-crystal icon + "SLOWED" while player.slowT > 0
  // (frost breath). Same row, same width budget, so nothing else in the bottom-left moves.
  const healthLabel = el('div', 'hud-vital-label');
  const healthLabelText = el('span', 'hud-vital-label-text', 'HEALTH');
  const slow = el('span', 'hud-slow hidden');
  slow.append(iceIcon(), el('span', 'hud-slow-text', 'SLOWED'));
  healthLabel.append(healthLabelText, slow);
  health.append(healthLabel, healthValue);
  const kills = el('div', 'hud-vital hud-vital-kills');
  const killsValue = el('div', 'hud-vital-value', '0');
  kills.append(el('div', 'hud-vital-label', 'KILLS'), killsValue);
  vitals.append(health, kills);

  const screen = el('div', 'hud-screen hidden');

  // WO7 T2: perk bottles above HEALTH (bottom-left) and the Quick Revive "down" overlay.
  const perks = el('div', 'hud-perks hidden');
  const down = el('div', 'hud-down hidden');
  const downFill = el('div', 'hud-down-fill');
  const downTrack = el('div', 'hud-down-track');
  downTrack.append(downFill);
  down.append(el('div', 'hud-down-text', 'REVIVING\u2026'), downTrack);

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

  root.append(points, round, weapon, powerups, bossBar, bottomCenter, down, screen, faceBox, vitals, perks);
  faceCtx = faceCanvas.getContext('2d');

  els = {
    points, pointsValue, pointsFlicks,
    round, roundTally, roundNum,
    weapon, weaponSecondary, weaponName, weaponAmmo, ammoMag, ammoSep, ammoReserve, weaponReload,
    powerups, banner, prompt, screen,
    faceBox, vitals, health, healthValue, faceCanvas, kills, killsValue, healthLabelText, slow,
    levelLabel, bossBar, bossName, bossLag: bossLagEl, bossFill,
    perks, down, downFill,
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
    s.append(el('div', 'screen-title', 'SOL ZOMBIES'));
    // WO7 T4: best run under the title.
    const best = bestOf(scoreSummary);
    if (best) s.append(el('div', 'screen-best', `BEST: ROUND ${best.round} · ${fmtInt(best.points)} PTS`));
    s.append(el('div', 'screen-sub blink', mobileHud ? 'Tap to start' : 'Click / press Enter to start'));
    const list = el('ul', 'screen-controls');
    const controls = mobileHud ? [
      ['Left stick', 'Move (full = sprint)'],
      ['Right stick', 'Aim + fire'],
      ['RELOAD / SWAP / ‖', 'Reload / swap weapon / pause'],
      ['KNIFE', 'Melee swing'],
      ['ACTION', 'Buy / open / rebuild (hold)'],
      ['‖ → LEVELS', 'Level select'],
    ] : [
      ['WASD / Arrows', 'Move'],
      ['Shift', 'Sprint'],
      ['Mouse', 'Aim / Fire'],
      ['R', 'Reload'],
      ['V', 'Knife'],
      ['F / E', 'Buy guns / perks / doors / rebuild (hold)'],
      ['1 / 2 / 3 / Q / Wheel', 'Swap weapon (3 = Mule Kick)'],
      ['Esc / P', 'Pause'],
      ['Shift+M', 'Level select'],
    ];
    for (const [k, v] of controls) {
      const li = el('li');
      li.append(el('span', 'key', k), el('span', 'what', v));
      list.append(li);
    }
    // WO7 T4: controls and the top-5 table side by side (fits 16:9 on desktop and mobile).
    const cols = el('div', 'screen-cols');
    cols.append(list);
    const top = topOf(scoreSummary);
    if (top.length) cols.append(buildTopTable(top, 0));
    s.append(cols);
  } else if (phase === 'gameover') {
    const g = gameOverSummary;
    const sum = runSummary(state, g);
    s.append(
      el('div', 'screen-title gameover', 'GAME OVER'),
      el('div', 'screen-headline', `YOU SURVIVED ${sum.rounds} ROUND${sum.rounds === 1 ? '' : 'S'}`),
    );
    // WO7 T4: rank line ("NEW BEST ROUND!" and/or "#3 ALL TIME").
    // WO9: a run that used the level select is practice: fixed line, no rank, no table highlight.
    const practice = isPractice(state, g);
    if (practice) {
      const line = el('div', 'screen-rank practice');
      line.append(el('span', 'rank-practice', PRACTICE_TEXT));
      s.append(line);
    } else if (g && g.rankText) {
      // FIX-2 (playtest #13): unranked runs (died before round 1) show main.js's rankText instead.
      const line = el('div', 'screen-rank');
      line.append(el('span', 'rank-pos', String(g.rankText)));
      s.append(line);
    } else if (g) {
      const rank = Number(g.rank) > 0 ? (g.rank | 0) : 0;
      const bestText = g.isBestRound ? 'NEW BEST ROUND!' : (g.isBestPoints ? 'NEW BEST SCORE!' : '');
      if (bestText || rank) {
        const line = el('div', 'screen-rank' + (bestText ? ' best' : ''));
        if (bestText) line.append(el('span', 'rank-best', bestText));
        if (rank) line.append(el('span', 'rank-pos', `#${rank} ALL TIME`));
        s.append(line);
      }
    }
    const table = el('div', 'screen-stats');
    const rows = [
      ['Rounds', sum.rounds],
      ['Kills', fmtInt(sum.kills)],
      ['Points earned', fmtInt(sum.points)],
      ['Accuracy', sum.accuracy + '%'],
      ['Time', fmtTime(sum.timeSec)],
    ];
    if (sum.level != null) rows.push(['Level reached', sum.level]);
    if (sum.bosses != null) rows.push(['Bosses', sum.bosses]);
    if (sum.perks) rows.push(['Perks used', sum.perks]);
    if (sum.pap != null) rows.push(['Upgrades', sum.pap]); // WO8: Pack-a-Punch upgrades this run
    if (sum.weapon) rows.push(['Favourite weapon', sum.weapon]);
    for (const [k, v] of rows) {
      const row = el('div', 'stat');
      row.append(el('span', 'stat-k', k), el('span', 'stat-v', String(v)));
      table.append(row);
    }
    const cols = el('div', 'screen-cols');
    cols.append(table);
    const top = topOf(g);
    if (top.length) cols.append(buildTopTable(top, !practice && g && Number(g.rank) > 0 ? (g.rank | 0) : 0));
    s.append(cols, el('div', 'screen-sub blink', mobileHud ? 'Tap to restart' : 'Press Enter to restart'));
  } else if (phase === 'paused') {
    s.append(
      el('div', 'screen-title', 'PAUSED'),
      el('div', 'screen-sub', mobileHud ? 'Tap ‖ to resume' : 'Press Esc / P to resume'),
      buildLevelsButton(),
    );
    // WO9: key hint on desktop; on touch the LEVELS button is the hint.
    if (!mobileHud) s.append(el('div', 'screen-hint', 'Shift+M — Level select'));
  }
  s.dataset.phase = phase;
}

// ---------- WO9: LEVELS button + practice flag ----------

// Pause-screen LEVELS button (desktop and touch). data-action="levels" is the touch.js /
// levelselect contract hook; a click (mouse or tap) calls every hud.onLevelsButton listener.
function buildLevelsButton() {
  const b = el('button', 'screen-btn screen-btn-levels', 'LEVELS');
  b.type = 'button';
  b.dataset.action = 'levels';
  b.setAttribute('aria-label', 'Level select');
  b.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // not a stage/stick tap
  b.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try { b.blur(); } catch { /* ignore */ } // Enter / Space must not re-press it later
    fireLevels();
  });
  return b;
}

// One click = one notification per channel: hud.onLevelsButton listeners, then touch.js's
// onLevelsButton callbacks via touch.triggerLevelsButton (Agent G's single channel for taps and
// clicks). Main should subscribe through ONE of the two, else a click fires twice.
function fireLevels() {
  try {
    if (typeof touchMod.triggerLevelsButton === 'function') touchMod.triggerLevelsButton();
  } catch (err) { console.error('[hud] touch.triggerLevelsButton', err); }
  for (const cb of [...levelsListeners]) {
    try { cb(); } catch (err) { console.error('[hud] levels listener', err); }
  }
}

function isPractice(state, g) {
  if (g && typeof g === 'object' && g.practice != null) return !!g.practice;
  return !!(state && state.stats && state.stats.practice);
}

// ---------- WO7 T4: score formatting helpers ----------

function numOr(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function fmtInt(v) {
  const n = Math.floor(numOr(v));
  try { return n.toLocaleString('en-US'); } catch { return String(n); }
}

function fmtTime(sec) {
  const t = Math.max(0, Math.floor(numOr(sec)));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function perksCfg() {
  return (config.PERKS && config.PERKS.list) || {};
}

function perkName(id) {
  const d = perksCfg()[id];
  return d && d.name ? d.name : String(id);
}

function weaponName(id) {
  if (!id) return '';
  try {
    const W = weaponsMod.WEAPONS;
    if (W && W[id] && W[id].name) return W[id].name;
  } catch { /* weapons.js not ready */ }
  return String(id).toUpperCase();
}

// WO8: Pack-a-Punch. weapons.isUpgraded (Agent A) when present, else the w.upgraded flag.
function isUpgradedWeapon(w) {
  if (!w || typeof w !== 'object') return false;
  try {
    if (typeof weaponsMod.isUpgraded === 'function') return !!weaponsMod.isUpgraded(w);
  } catch { /* fall through */ }
  return !!(w.upgraded || (w.def && w.def.upgraded));
}

// Display name of a held weapon (the upgraded def carries the Pack-a-Punch name).
function heldName(w) {
  return String((w.def && w.def.name) || w.id || '');
}

// Upgraded name for a weapon id: weapons.upgradedName, then UPGRADES[id].name, then the base name.
function papName(id) {
  if (!id) return '';
  try {
    if (typeof weaponsMod.upgradedName === 'function') {
      const n = weaponsMod.upgradedName(id);
      if (n) return String(n);
    }
    const U = weaponsMod.UPGRADES;
    if (U && U[id] && U[id].name) return U[id].name;
  } catch { /* weapons.js not ready */ }
  return weaponName(id);
}

// Best run for the menu line: summary.best, else the first top entry. Null on an empty table.
function bestOf(sum) {
  if (!sum) return null;
  const b = sum.best || (Array.isArray(sum.top) && sum.top[0]) || null;
  if (!b) return null;
  const round = Math.floor(numOr(b.round));
  if (!(round > 0)) return null;
  return { round, points: numOr(b.points) };
}

function topOf(sum) {
  return sum && Array.isArray(sum.top) ? sum.top.filter((e) => e && typeof e === 'object').slice(0, TOP_ROWS) : [];
}

// Top-5 table: # / ROUND / POINTS / KILLS / TIME / LVL. highlightRank (1-based) marks this run.
function buildTopTable(top, highlightRank) {
  const wrap = el('div', 'screen-top');
  wrap.append(el('div', 'screen-top-title', 'TOP RUNS'));
  const grid = el('div', 'screen-top-grid');
  // FIX-2 (playtest #7): KILLS / LVL carry .c-opt and are dropped on the touch layout.
  const heads = [['#', ''], ['ROUND', ''], ['POINTS', ''], ['KILLS', ' c-opt'], ['TIME', ''], ['LVL', ' c-opt']];
  for (const [h, c] of heads) grid.append(el('span', 'th' + c, h));
  top.forEach((e, i) => {
    const hl = highlightRank === i + 1 ? ' me' : '';
    grid.append(
      el('span', 'td rank' + hl, String(i + 1)),
      el('span', 'td' + hl, String(Math.floor(numOr(e.round)))),
      el('span', 'td pts' + hl, fmtInt(e.points)),
      el('span', 'td c-opt' + hl, fmtInt(e.kills)),
      el('span', 'td' + hl, fmtTime(e.timeSec)),
      el('span', 'td c-opt' + hl, String(Math.floor(numOr(e.level, 1)))),
    );
  });
  wrap.append(grid);
  return wrap;
}

// Merge the game-over summary (stats spread + rank/top, maybe an entry) with live state.stats.
// Summary fields win; missing ones fall back to the entry, then state.stats / state.player.
function runSummary(state, g) {
  const st = state.stats || {};
  const src = g && typeof g === 'object' ? g : {};
  const entry = src.entry && typeof src.entry === 'object' ? src.entry : {};
  const pick = (...vals) => { for (const v of vals) if (v != null && v !== '') return v; return null; };
  const rounds = Math.floor(numOr(pick(src.roundReached, src.round, entry.round, st.roundReached,
    state.rounds && state.rounds.round), 0));
  const fired = numOr(pick(src.shotsFired, st.shotsFired), 0);
  const hit = numOr(pick(src.shotsHit, st.shotsHit), 0);
  const accuracy = fired > 0 ? Math.round((hit / fired) * 100) : 0;
  const level = pick(src.levelReached, src.level, entry.level, st.levelReached);
  const bosses = pick(src.bossesKilled, src.bosses, entry.bosses, st.bossesKilled);
  // FIX-2 (playtest #6): perksRun = every perk bought this run (main.js), so a Quick Revive death
  // (which strips p.perks) still lists them. Falls back to the held list.
  let perks = pick(src.perksRun, src.perks, entry.perksRun, entry.perks, state.player && state.player.perks);
  if (Array.isArray(perks)) perks = perks.filter((id, i, a) => typeof id === 'string' && a.indexOf(id) === i);
  perks = Array.isArray(perks) ? (perks.length ? perks.map(perkName).join(', ') : 'None') : null;
  const wid = pick(src.bestWeaponId, src.weapon, entry.weapon, st.bestWeaponId);
  const pap = pick(src.papCount, src.pap, entry.pap, st.papCount);
  return {
    rounds,
    kills: numOr(pick(src.kills, entry.kills, st.kills), 0),
    points: numOr(pick(src.pointsEarned, src.points, entry.points, st.pointsEarned), 0),
    accuracy,
    timeSec: numOr(pick(src.timeSurvived, src.timeSec, entry.timeSec, st.timeSurvived, state.time), 0),
    level: level == null ? null : Math.floor(numOr(level, 1)),
    bosses: bosses == null ? null : Math.floor(numOr(bosses)),
    perks,
    weapon: pick(src.weaponName, wid ? weaponName(wid) : null),
    pap: pap == null ? null : Math.max(0, Math.floor(numOr(pap))),
  };
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
  if (p.teleport) return;           // WO9 (INT): level:teleport shows "TELEPORTED — L<n> <NAME>" instead
  const n = (p.index | 0) + 1;
  queueBanner(p.name ? `LEVEL ${n} — ${String(p.name).toUpperCase()}` : `LEVEL ${n}`);
}

// WO9 (INT): level-select teleport banner, same queue. `to` is the absolute index (L<to+1>).
function onLevelTeleport(p) {
  if (!p || !Number.isFinite(p.to)) return;
  const n = (p.to | 0) + 1;
  const name = p.name || (lastState && lastState.level && lastState.level.name) || '';
  bannerQueue = bannerQueue.filter((t) => !t.startsWith('TELEPORTED')); // only the latest teleport waits
  queueBanner(`TELEPORTED — L${n}${name ? ' ' + String(name).toUpperCase() : ''}`);
}

// WO7 T2: "<PERK NAME>" banner on purchase (same queue as FIRE SALE! / BOSS / LEVEL banners).
function onPerkBought(p) {
  if (!p || !p.perkId) return;
  queueBanner(perkName(p.perkId).toUpperCase());
}

// WO8: "<UPGRADED NAME>" banner when an upgraded gun is taken from the Pack-a-Punch machine.
function onPapDone(p) {
  if (!p || !p.weaponId) return;
  queueBanner(papName(p.weaponId).toUpperCase());
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
  lastLevelStyle = null;
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
  lastState = null;
  build();
  root.classList.toggle('mobile', mobileHud);
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
    on('level:teleport', onLevelTeleport),
    on('perk:bought', onPerkBought),
    on('pap:done', onPapDone),
  );
}

export function updateHud(state) {
  if (!root || !els || !state) return;

  lastState = state;
  const phase = state.phase || 'menu';
  if (phase !== lastPhase) {
    lastPhase = phase;
    root.dataset.phase = phase;
    const showScreen = phase === 'menu' || phase === 'gameover' || phase === 'paused';
    if (phase === 'playing' || phase === 'menu') gameOverSummary = null; // new game: drop last run
    if (showScreen) buildScreen(state);
    setHidden(els.screen, !showScreen);
    if (phase === 'menu' || phase === 'gameover') resetBanners();
  }

  updateLevelStyle(state);
  updatePoints(state.player);
  updateRound(state.rounds);
  updateWeapon(state.player);
  updatePowerups(state);
  updatePrompt(state.shop && state.shop.prompt);
  if (bannerBusy && nowMs() - bannerStartedAt > BANNER_FALLBACK_MS) endBanner();
  updateStatus(state);
  updateLevelLabel(state);
  updateBossBar(state);
  updatePerks(state);
  updateDown(state);
  markSeenWeapons(state.player);
}

// WO9 FIX-4 (QA OUTPOST #3): expose the level's theme style for CSS (bright-level contrast on
// the HUD and touch controls). Set on #hud and its #stage parent (#touch is a sibling of #hud).
// Polled per frame because the first level's level:start fires before the HUD listens.
function updateLevelStyle(state) {
  const th = (state.map && state.map.theme) || (state.level && state.level.def && state.level.def.theme) || null;
  const style = (state.phase !== 'menu' && th && typeof th.style === 'string') ? th.style : '';
  if (style === lastLevelStyle) return;
  lastLevelStyle = style;
  const targets = [root, root.parentElement];
  for (const el of targets) {
    if (!el || !el.dataset) continue;
    if (style) el.dataset.levelStyle = style;
    else delete el.dataset.levelStyle;
  }
}

// ---------- WO7 T4: high scores (menu) + run summary (game over) ----------

// Menu data: { best: { round, points } | null, top: Entry[] }. Kept across initHud; rebuilds the
// menu screen at once if it is showing. Safe before initHud; null clears it.
export function setScores(summary) {
  scoreSummary = summary && typeof summary === 'object' ? summary : null;
  if (els && lastState && lastPhase === 'menu') buildScreen(lastState);
}

// Game-over data: { ...stats, rank, isBestRound, isBestPoints, top, entry? }. May be called just
// before or after the phase flips to 'gameover'; rebuilds the screen if game over is showing.
// Cleared when the next game starts (phase -> playing / menu).
export function setGameOverSummary(summary) {
  gameOverSummary = summary && typeof summary === 'object' ? summary : null;
  if (els && lastState && lastPhase === 'gameover') buildScreen(lastState);
}

// WO9: subscribe to the pause-screen LEVELS button (desktop click and touch tap). Returns an
// unsubscribe function. Listeners are kept across initHud; the same function is added once.
export function onLevelsButton(cb) {
  if (typeof cb !== 'function') return () => {};
  levelsListeners.add(cb);
  return () => { levelsListeners.delete(cb); };
}

// ---------- WO7 T2: perk row + revive overlay ----------

// Bottle icons in purchase order, above HEALTH. Rebuilt only when the perk list changes.
// #hud gets .has-perks so the points block moves up above the row.
function updatePerks(state) {
  const p = state.player;
  const list = p && Array.isArray(p.perks) ? p.perks.filter((id) => typeof id === 'string') : [];
  const cfg = perksCfg();
  // FIX-2 (playtest #11): the Quick Revive badge shows revives in hand (always 1 while the perk
  // is held), not purchases left; purchases left belong to the machine prompt.
  const key = list.join(',');
  setHidden(els.perks, list.length === 0);
  root.classList.toggle('has-perks', list.length > 0); // direct: build() resets root.className
  if (els.perks.__key === key) return;
  els.perks.__key = key;
  els.perks.textContent = '';
  for (const id of list) {
    const d = cfg[id] || {};
    const b = el('div', 'hud-perk');
    b.dataset.perk = id;
    b.style.setProperty('--perk-color', d.color || '#cccccc');
    b.append(el('span', 'hud-perk-letter', d.letter || String(id).charAt(0).toUpperCase()));
    if (id === 'revive') b.append(el('span', 'hud-perk-uses', '×1'));
    els.perks.append(b);
  }
}

// "REVIVING…" with a bar filling over PERKS.list.revive.downSeconds while player.downT > 0.
function updateDown(state) {
  const p = state.player;
  const t = p ? numOr(p.downT, 0) : 0;
  const show = t > 0 && (lastPhase === 'playing' || lastPhase === 'paused');
  setHidden(els.down, !show);
  if (!show) return;
  const total = numOr((perksCfg().revive || {}).downSeconds, 1.5) || 1.5;
  const frac = Math.max(0, Math.min(1, 1 - t / total));
  const w = (frac * 100).toFixed(1) + '%';
  if (els.downFill.__w !== w) { els.downFill.__w = w; els.downFill.style.width = w; }
}


// ---------- WO6: mobile HUD + rotate overlay ----------

// Touch hints instead of key hints: "Tap to start" / "Tap to restart", the touch controls list,
// and .hud-prompt hidden (touch.js shows the prompt on its ACTION button). Safe before initHud
// (the flag is applied when the HUD is built) and idempotent.
export function setMobileHud(onOff) {
  const want = !!onOff;
  if (want === mobileHud && (!root || root.classList.contains('mobile') === want)) return;
  mobileHud = want;
  if (!root || !els) return;
  root.classList.toggle('mobile', want);
  if (want) setHidden(els.prompt, true);
  // Rebuild the centre screen now if one is showing, else on the next phase change.
  const phase = lastPhase;
  if (lastState && (phase === 'menu' || phase === 'gameover' || phase === 'paused')) buildScreen(lastState);
}

// Full-screen "Rotate your phone" plate. Lives on <body> (position: fixed, z-index above #stage
// and #touch) so it covers the whole portrait screen, not just the 16:9 stage strip. Re-init
// safe: reuses an existing .hud-rotate element, never creates a second one.
export function setRotateOverlay(onOff) {
  if (typeof document === 'undefined' || !document.body) return;
  let plate = document.querySelector('.hud-rotate');
  if (!onOff && !plate) return;
  if (!plate) {
    plate = el('div', 'hud-rotate hidden');
    plate.setAttribute('role', 'alert');
    plate.append(
      el('div', 'hud-rotate-phone'),
      el('div', 'hud-rotate-text', 'Rotate your phone'),
      el('div', 'hud-rotate-sub', 'Sol Zombies plays in landscape'),
    );
    // Swallow gestures on the plate (no scroll / zoom / stray stick input).
    const stop = (ev) => { if (ev.cancelable) ev.preventDefault(); };
    plate.addEventListener('touchmove', stop, { passive: false });
    plate.addEventListener('contextmenu', stop);
    document.body.append(plate);
  }
  setHidden(plate, !onOff);
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
  // WO9: frost slow (Agent E's player.slowT) -> ice icon + "SLOWED" in the HEALTH label row.
  const slowed = !p.down && numOr(p.slowT, 0) > 0 && lastPhase !== 'gameover' && lastPhase !== 'menu';
  setHidden(els.slow, !slowed);
  setHidden(els.healthLabelText, slowed);
  setClass(els.health, 'slowed', slowed);

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
  // WO8: upgraded guns show the Pack-a-Punch name in gold with a leading star.
  const up = isUpgradedWeapon(w);
  setText(els.weaponName, (up ? '★ ' : '') + heldName(w));
  setClass(els.weaponName, 'upgraded', up);

  // FIX-2 (playtest #2 / review L5): every held weapon other than the active one, in slot order
  // (2 with Mule Kick). While a temp weapon (Death Machine) is out, every slot weapon is listed.
  updateWeaponSecondary(player);

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

function updateWeaponSecondary(player) {
  const list = [];
  const ws = Array.isArray(player.weapons) ? player.weapons : [];
  ws.forEach((w, i) => {
    if (!w || (!player.tempWeapon && i === player.activeSlot)) return;
    const up = isUpgradedWeapon(w);
    const full = heldName(w).toUpperCase();
    list.push({ slot: i + 1, up, name: (up ? '★ ' : '') + full, short: shortWeaponName(full) });
  });
  const key = list.map((x) => x.slot + ':' + (x.up ? 'u:' : '') + x.name).join('|');
  const box = els.weaponSecondary;
  if (box.__key === key) return;
  box.__key = key;
  box.textContent = '';
  // WO8 FIX-B (playtest #2): with two holstered guns the mobile line shows the short names
  // ("WARDEN · SEKHMET", gold = upgraded, no star), styled by .multi in styles.css; desktop always
  // shows the full names.
  setClass(box, 'multi', list.length > 1);
  for (const x of list) {
    const line = el('div', 'hud-weapon-sec' + (x.up ? ' upgraded' : ''));
    line.append(el('span', 'hud-weapon-sec-slot', String(x.slot)), el('span', 'hud-weapon-sec-name', x.name),
      el('span', 'hud-weapon-sec-short', x.short));
    box.append(line);
  }
}

// Compact holstered name: names of up to 7 chars stay whole ("KN-44", "L-CAR 9"); otherwise the
// first distinctive word (no digit-only / 1-2 char words, no GUN / RAY / X2 / CANNON, "'S" dropped):
// "WARDEN'S WRATH" -> "WARDEN", "PORTER'S X2 RAY GUN" -> "PORTER", "48 DREDGE" -> "DREDGE".
const SHORT_SKIP = new Set(['GUN', 'RAY', 'X2', 'CANNON', '&']);
function shortWeaponName(full) {
  const s = String(full || '').trim();
  if (s.length <= 7) return s;
  const words = s.split(/\s+/).map((x) => x.replace(/['’]S$/, ''));
  const pick = words.find((x) => x.length > 2 && !/^\d+$/.test(x) && !SHORT_SKIP.has(x));
  return pick || words[0] || s;
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
  const show = !mobileHud && !!(prompt && prompt.text) && lastPhase === 'playing';
  setHidden(els.prompt, !show);
  if (!show) return;
  setText(els.prompt, prompt.text);
  // shop.js prompt: grey when unaffordable OR blocked (e.g. ammo already full). Integrator fix.
  setClass(els.prompt, 'cant-afford', prompt.canAfford === false || !!prompt.blocked);
}
