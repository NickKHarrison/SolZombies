// levelselect.js (WO9 Agent G) - level-select overlay (Shift+M), DOM module, self-contained.
// No window/document access at module top level: importing it under node is safe (tests use the
// pure helpers thumbnailColors / difficultyLine / cardInfo).
//
// Contract (WORK_ORDER_9 3.4):
//   initLevelSelect(rootEl, { levels, onPick(index), onClose() })  idempotent; builds the overlay inside
//                                   rootEl (recommended: #stage, so it sits above #hud and #touch) and
//                                   injects its own <style id="levelselect-style"> once
//   openLevelSelect(state)          refresh cards (state.level.index % levels.length highlighted), show, focus;
//                                   emits levelselect:open {} (only on a closed -> open change)
//   closeLevelSelect()              hide; emits levelselect:close {} (only on an open -> closed change).
//                                   Does NOT call onClose (the caller already knows).
//   isLevelSelectOpen()
//   levelThumbnail(def, scale)      -> HTMLCanvasElement (cached per level id + scale); null without a DOM
//
// User actions inside the overlay:
//   arrows / 1-6 select, Enter / Space / NumpadEnter / click / tap on a card -> onPick(index)
//     (the overlay stays open: main teleports, then calls closeLevelSelect()).
//   Esc or the X button -> closeLevelSelect() then onClose().
//   Shift+M is NOT handled here: input.js turns it into getInput().levelSelect and main toggles.
// Keys the overlay consumes are stopped in a window capture listener, so input.js never sees them;
// input.js additionally neutralises every gameplay field while isLevelSelectOpen().

import * as events from './events.js';
import * as config from './config.js';
import * as levelsMod from './levels/levels.js';

const LS = (config && config.LEVEL_SELECT) || { thumbScale: 3 };
const STYLE_ID = 'levelselect-style';
const OPEN_CLASS = 'ls-open'; // on <html> while open (hides / disables the #touch layer)

// ---------------------------------------------------------------- pure helpers

const PERK_COLORS = { J: '#e0413a', Q: '#4aa3ff', C: '#45d06a', N: '#f0a030', U: '#f2e24a', K: '#4fd1b0' };
const MARK = { pap: '#b46cff', box: '#46d2ff', start: '#ffffff', buy: '#f2d36b', stairs: '#efe6cc', mega: '#d8452f' };
const FLOORISH = new Set(['.', 'P', 'O', 'Z', 'X']);

function parseHex(c) {
  if (typeof c !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Mix two hex colours (t = 0 -> a, 1 -> b). Unparsable input falls back to whichever parses. */
export function mixHex(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  if (!A && !B) return '#000000';
  if (!A) return toHex(B);
  if (!B) return toHex(A);
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
}

function paletteFor(def) {
  const th = (def && def.theme) || {};
  const floor = parseHex(th.floor) ? th.floor : '#555555';
  const floorAlt = parseHex(th.floorAlt) ? th.floorAlt : floor;
  const wall = parseHex(th.wall) ? th.wall : '#222222';
  const edge = parseHex(th.wallEdge) ? th.wallEdge : mixHex(wall, '#ffffff', 0.3);
  const accent = parseHex(th.accent) ? th.accent : '#dddddd';
  const doorWood = parseHex(th.doorWood) ? th.doorWood : '#6a4a2a';
  const doorIron = parseHex(th.doorIron) ? th.doorIron : '#444444';
  // FIX-2 (WO9 QA TEMPLE #7): TEMPLE's `water: true` + waterDeep / waterLight -> teal channels.
  const pit = parseHex(th.pit) ? th.pit : parseHex(th.water) ? th.water
    : parseHex(th.waterDeep) ? mixHex(th.waterDeep, parseHex(th.waterLight) ? th.waterLight : '#3fd6a8', 0.25) : '#0e2c44';
  const tint = def && def.boss && parseHex(def.boss.tint) ? def.boss.tint : '#c03030';
  return {
    floor, floorAlt,
    rock: mixHex(wall, '#000000', 0.45),
    wall: mixHex(wall, edge, 0.35),
    pocket: mixHex(floor, '#000000', 0.45),
    spawn: mixHex(floor, '#000000', 0.3),
    window: mixHex(accent, '#8fd0ff', 0.55),
    door: mixHex(doorWood, '#ffe0a0', 0.35),
    mega: mixHex(doorIron, MARK.mega, 0.7),
    pit,
    boss: tint,
    minion: mixHex(tint, floor, 0.5),
  };
}

/**
 * Colour of every tile of a level's ASCII map for the mini-map (pure).
 * @returns {string[][]} rows x cols of '#rrggbb'
 */
export function thumbnailColors(def) {
  const rows = (def && Array.isArray(def.ascii)) ? def.ascii : [];
  const buys = new Set(Object.keys((def && def.wallbuys) || {}));
  const P = paletteFor(def);
  const at = (x, y) => (rows[y] && x >= 0 && x < rows[y].length ? rows[y][x] : '#');
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    const line = [];
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      let col;
      if (c === '#') {
        let open = false;
        for (let dy = -1; dy <= 1 && !open; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const n = at(x + dx, y + dy);
            if (n !== '#' && n !== 'S') { open = true; break; }
          }
        }
        col = open ? P.wall : P.rock;
      } else if (c === '.') col = ((x + y) & 1) ? P.floorAlt : P.floor;
      else if (c === 'P') col = MARK.start;
      else if (c === 'O') col = P.spawn;
      else if (c === 'S') col = P.pocket;
      else if (c === 'W') col = P.window;
      else if (c === 'Z') col = P.boss;
      else if (c === 'X') col = P.minion;
      else if (c === 'B') col = MARK.box;
      else if (c === 'A') col = MARK.pap;
      else if (c === 'M') col = P.mega;
      else if (c === 'T') col = MARK.stairs;
      else if (c === '~') col = P.pit;
      else if ('DEFGH'.includes(c)) col = P.door;
      else if (PERK_COLORS[c]) col = PERK_COLORS[c];
      else if (buys.has(c)) col = MARK.buy;
      else col = FLOORISH.has(c) ? P.floor : P.wall;
      line.push(col);
    }
    out.push(line);
  }
  return out;
}

function fmtMult(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '1';
  return String(Number(n.toFixed(2)));
}

/** "HP x2.4 · SPD x1.22" from def.difficulty (missing values = 1). */
export function difficultyLine(def) {
  const d = (def && def.difficulty) || {};
  return `HP x${fmtMult(d.healthMult ?? 1)} · SPD x${fmtMult(d.speedMult ?? 1)}`;
}

/** FIX-2 (WO9 QA KINO #9): the rest of the difficulty row, "COUNT x1.6 · SPRINT +7" (pure). */
export function difficultyExtra(def) {
  const d = (def && def.difficulty) || {};
  const s = Number(d.sprintShift);
  return `COUNT x${fmtMult(d.countMult ?? 1)} · SPRINT +${Number.isFinite(s) ? Math.round(s) : 0}`;
}

/** Text shown on a card (pure). */
export function cardInfo(def, index) {
  return {
    label: `L${index + 1}`,
    name: String((def && def.name) || (def && def.id) || `LEVEL ${index + 1}`),
    boss: String((def && def.boss && def.boss.name) || '???'),
    difficulty: difficultyLine(def),
    difficultyExtra: difficultyExtra(def),
  };
}

/** Authored-level index (0..n-1) of the current level from a state (or a plain number). */
export function currentIndexOf(stateOrIndex, n) {
  let i = typeof stateOrIndex === 'number' ? stateOrIndex
    : stateOrIndex && stateOrIndex.level && typeof stateOrIndex.level.index === 'number' ? stateOrIndex.level.index
      : -1;
  if (!(n > 0) || !Number.isFinite(i) || i < 0) return -1;
  return Math.floor(i) % n;
}

// ---------------------------------------------------------------- thumbnails

const thumbCache = new Map(); // `${id}@${scale}` -> canvas

/**
 * Mini-map canvas of a level (60x40 tiles -> 60*scale x 40*scale px). Cached per level id + scale;
 * the same canvas element is returned each time (drawImage it if you need a second copy).
 * Returns null when there is no DOM (node).
 */
export function levelThumbnail(def, scale) {
  if (typeof document === 'undefined' || !def) return null;
  const s = Math.max(1, Math.floor(scale || LS.thumbScale || 3));
  const key = `${def.id || def.name || 'level'}@${s}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const cols = thumbnailColors(def);
  const h = cols.length, w = h ? Math.max(...cols.map((r) => r.length)) : 0;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w * s);
  cv.height = Math.max(1, h * s);
  cv.className = 'ls-thumb';
  const g = cv.getContext && cv.getContext('2d');
  if (g) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < cols[y].length; x++) {
        g.fillStyle = cols[y][x];
        g.fillRect(x * s, y * s, s, s);
      }
    }
  }
  thumbCache.set(key, cv);
  return cv;
}

// ---------------------------------------------------------------- DOM

const CSS = `
.ls-overlay{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
  background:rgba(4,4,8,.86);container-type:size;container-name:ls;pointer-events:auto!important;
  font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;color:#eee;text-shadow:none;line-height:1.15;
  -webkit-user-select:none;user-select:none;touch-action:pan-y;box-sizing:border-box}
.ls-overlay[hidden]{display:none!important}
.ls-overlay *{pointer-events:auto!important;box-sizing:border-box}
.ls-panel{position:relative;width:min(94cqw,126cqh);max-height:94cqh;display:flex;flex-direction:column;
  background:#101016;border:.3cqh solid #3a3a48;border-radius:1.2cqh;box-shadow:0 0 4cqh rgba(0,0,0,.8);padding:2.2cqh 2.4cqh}
.ls-head{display:flex;align-items:baseline;gap:2cqh;margin:0 6cqh 1.6cqh 0}
.ls-title{margin:0;font-size:4.6cqh;letter-spacing:.35em;font-weight:800;color:#f2d36b}
.ls-hint{font-size:2cqh;color:#9a9aa8;letter-spacing:.05em}
.ls-close{position:absolute;top:1.4cqh;right:1.4cqh;width:6cqh;height:6cqh;border-radius:.8cqh;border:.25cqh solid #555;
  background:#1c1c24;color:#ddd;font-size:4cqh;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.ls-close:hover,.ls-close:focus-visible{border-color:#f2d36b;color:#fff;outline:none}
.ls-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.6cqh;overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;padding:.6cqh;min-height:0}
.ls-card{position:relative;display:flex;flex-direction:column;gap:.6cqh;text-align:left;cursor:pointer;
  background:#17171f;border:.35cqh solid #2c2c38;border-radius:1cqh;padding:1.2cqh;color:#eee;font:inherit;
  border-left:.9cqh solid var(--ls-accent,#666)}
.ls-card:hover{background:#1e1e28}
.ls-card:focus{outline:none}
.ls-card.selected{border-color:#f2d36b;border-left-color:var(--ls-accent,#666);box-shadow:0 0 0 .35cqh rgba(242,211,107,.35)}
.ls-card.current{background:#241d12}
.ls-row{display:flex;align-items:baseline;gap:1cqh;min-width:0}
.ls-num{font-weight:800;font-size:3cqh;color:var(--ls-num,#eee);text-shadow:0 0 .4cqh rgba(0,0,0,.9),0 .15cqh .2cqh #000;
  background:rgba(0,0,0,.35);border-radius:.5cqh;padding:0 .6cqh}
.ls-name{font-weight:700;font-size:2.7cqh;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ls-badge{margin-left:auto;font-size:1.7cqh;font-weight:800;letter-spacing:.1em;color:#101016;background:#f2d36b;
  border-radius:.5cqh;padding:.25cqh .7cqh;display:none}
.ls-card.current .ls-badge{display:inline-block}
.ls-thumb{display:block;width:100%;height:auto;aspect-ratio:3/2;image-rendering:pixelated;border-radius:.4cqh;background:#000}
.ls-boss{font-size:2cqh;color:#c8c8d0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ls-boss b{color:var(--ls-tint,#e55)}
.ls-diff{font-size:1.9cqh;color:#b4b4c0;letter-spacing:.04em}
.ls-diff-x{font-size:.85em;color:#8e8e9c;white-space:nowrap}
.ls-foot{margin-top:1.2cqh;font-size:1.8cqh;color:#8a8a96;text-align:center}
@container ls (max-height: 480px){
  .ls-panel{width:96cqw;max-height:96cqh;padding:1.6cqh 2cqh}
  .ls-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ls-title{font-size:5.4cqh}.ls-hint{display:none}
  .ls-close{width:9cqh;height:9cqh;font-size:6cqh}
  .ls-num,.ls-name{font-size:4.2cqh}.ls-boss,.ls-diff{font-size:3.2cqh}.ls-badge{font-size:2.6cqh}
  .ls-foot{font-size:2.8cqh}
}
@media (prefers-reduced-motion: no-preference){.ls-card{transition:background .12s,border-color .12s}}
html.${OPEN_CLASS} #touch,html.${OPEN_CLASS} #touch *{visibility:hidden!important;pointer-events:none!important}
`;

const ui = {
  root: null, overlay: null, grid: null, closeBtn: null, cards: [],
  levels: null, levelsKey: '', onPick: null, onClose: null,
  open: false, selected: 0, current: -1, keyHandler: null,
};

function hasDom() {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function levelList() {
  if (Array.isArray(ui.levels) && ui.levels.length) return ui.levels;
  return (levelsMod && Array.isArray(levelsMod.LEVELS)) ? levelsMod.LEVELS : [];
}

function buildOverlay() {
  const ov = mk('div', 'ls-overlay');
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Select level');
  const panel = mk('div', 'ls-panel');
  const head = mk('div', 'ls-head');
  head.append(mk('h2', 'ls-title', 'SELECT LEVEL'),
    mk('span', 'ls-hint', 'ARROWS / 1-6 select · ENTER teleport · ESC close'));
  const close = mk('button', 'ls-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', (e) => { e.stopPropagation(); userClose(); });
  const grid = mk('div', 'ls-grid');
  const foot = mk('div', 'ls-foot', 'Teleporting marks this run as a PRACTICE RUN (not ranked).');
  panel.append(head, close, grid, foot);
  ov.appendChild(panel);
  // Taps on the dark backdrop do nothing (no accidental close); keep them off the game.
  ov.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  ov.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.overlay = ov;
  ui.grid = grid;
  ui.closeBtn = close;
}

// FIX-2 (WO9 QA KINO #9): the L<n> number in the level accent, lifted toward white until it is
// clearly readable on the dark card (relative luminance >= ~0.55).
function numberColor(hex) {
  let c = parseHex(hex) ? hex : '#888888';
  for (let k = 0; k < 8; k++) {
    const [r, g, b] = parseHex(c);
    if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.55) break;
    c = mixHex(c, '#ffffff', 0.25);
  }
  return c;
}

function buildCards() {
  const list = levelList();
  ui.grid.replaceChildren();
  ui.cards = list.map((def, i) => {
    const info = cardInfo(def, i);
    const card = mk('button', 'ls-card');
    card.type = 'button';
    card.dataset.index = String(i);
    const th = (def && def.theme) || {};
    card.style.setProperty('--ls-accent', th.wallEdge || th.accent || '#888');
    card.style.setProperty('--ls-num', numberColor(th.accent || th.wallEdge || '#888'));
    if (def && def.boss && def.boss.tint) card.style.setProperty('--ls-tint', def.boss.tint);
    const top = mk('div', 'ls-row');
    top.append(mk('span', 'ls-num', info.label), mk('span', 'ls-name', info.name), mk('span', 'ls-badge', 'CURRENT'));
    const thumb = levelThumbnail(def, LS.thumbScale || 3);
    const boss = mk('div', 'ls-boss');
    boss.append('BOSS ', mk('b', null, info.boss));
    card.append(top);
    if (thumb) card.append(thumb);
    const diff = mk('div', 'ls-diff', info.difficulty + ' ');
    const extra = mk('span', 'ls-diff-x', '· ' + info.difficultyExtra);
    extra.title = 'Zombie count multiplier · sprinters start this many rounds earlier';
    diff.append(extra);
    card.append(boss, diff);
    card.setAttribute('aria-label', `${info.label} ${info.name}, boss ${info.boss}, ${info.difficulty} · ${info.difficultyExtra}`);
    card.addEventListener('click', (e) => { e.stopPropagation(); select(i, false); pick(); });
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') select(i, false); });
    ui.grid.appendChild(card);
    return card;
  });
  ui.levelsKey = list.map((d) => d && d.id).join('|');
}

function refreshClasses() {
  ui.cards.forEach((c, i) => {
    c.classList.toggle('selected', i === ui.selected);
    c.classList.toggle('current', i === ui.current);
    c.setAttribute('aria-current', i === ui.current ? 'true' : 'false');
  });
}

function select(i, focus = true) {
  const n = ui.cards.length;
  if (!n) return;
  ui.selected = ((i % n) + n) % n;
  refreshClasses();
  const c = ui.cards[ui.selected];
  if (focus && c) {
    try { c.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    try { c.scrollIntoView({ block: 'nearest' }); } catch (_) { /* ignore */ }
  }
}

function columns() {
  try {
    const t = window.getComputedStyle(ui.grid).gridTemplateColumns;
    const n = t && t !== 'none' ? t.trim().split(/\s+/).length : 0;
    if (n > 0) return n;
  } catch (_) { /* ignore */ }
  return 3;
}

function pick() {
  if (!ui.open) return;
  const i = ui.selected;
  if (typeof ui.onPick === 'function') {
    try { ui.onPick(i); } catch (err) { console.error('[levelselect] onPick threw', err); }
  } else closeLevelSelect();
}

function userClose() {
  if (!ui.open) return;
  closeLevelSelect();
  if (typeof ui.onClose === 'function') {
    try { ui.onClose(); } catch (err) { console.error('[levelselect] onClose threw', err); }
  }
}

// Window capture listener: runs before input.js (window, bubble), so consumed keys never reach it.
function onKeyDown(e) {
  if (!ui.open) return;
  const code = e.code;
  if (code === 'KeyM' && e.shiftKey) return; // input.js -> getInput().levelSelect -> main toggles
  let used = true;
  const cols = columns();
  const n = ui.cards.length;
  if (code === 'ArrowLeft') select(ui.selected - 1);
  else if (code === 'ArrowRight') select(ui.selected + 1);
  else if (code === 'ArrowUp') select(ui.selected - cols >= 0 ? ui.selected - cols : ui.selected);
  else if (code === 'ArrowDown') select(ui.selected + cols < n ? ui.selected + cols : ui.selected);
  else if (/^(Digit|Numpad)[1-9]$/.test(code)) {
    const k = Number(code.slice(-1)) - 1;
    if (k < n) select(k);
  } else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { if (!e.repeat) pick(); }
  else if (code === 'Escape') { if (!e.repeat) userClose(); }
  else if (code === 'Tab') select(ui.selected + (e.shiftKey ? -1 : 1));
  else used = false;
  if (used) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// Stop the native button activation of Space / Enter on keyup (pick already ran on keydown).
function onKeyUp(e) {
  if (!ui.open) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    e.stopPropagation();
  }
}

/**
 * Build the overlay inside rootEl (recommended: #stage). Idempotent: the same root only updates
 * the options (cards are rebuilt when the level list changed); a different root moves the overlay.
 */
export function initLevelSelect(rootEl, opts = {}) {
  if (!hasDom()) return;
  const o = opts || {};
  if ('levels' in o) ui.levels = o.levels;
  if ('onPick' in o) ui.onPick = o.onPick;
  if ('onClose' in o) ui.onClose = o.onClose;
  injectStyle();
  const root = rootEl || document.getElementById('stage') || document.body;
  if (!ui.overlay) buildOverlay();
  if (ui.root !== root || ui.overlay.parentNode !== root) {
    root.appendChild(ui.overlay);
    ui.root = root;
  }
  const key = levelList().map((d) => d && d.id).join('|');
  if (!ui.cards.length || key !== ui.levelsKey) buildCards();
  if (!ui.keyHandler) {
    ui.keyHandler = onKeyDown;
    window.addEventListener('keydown', ui.keyHandler, true);
    window.addEventListener('keyup', onKeyUp, true);
  }
  refreshClasses();
}

/** Show the overlay with the current level (state.level.index, or a number) highlighted. */
export function openLevelSelect(state) {
  if (!hasDom()) return;
  if (!ui.overlay) initLevelSelect(null, {});
  const key = levelList().map((d) => d && d.id).join('|');
  if (key !== ui.levelsKey) buildCards();
  ui.current = currentIndexOf(state, ui.cards.length);
  const was = ui.open;
  ui.open = true;
  ui.overlay.hidden = false;
  document.documentElement.classList.add(OPEN_CLASS);
  select(ui.current >= 0 ? ui.current : 0);
  if (!was) events.emit('levelselect:open', {});
}

/** Hide the overlay (no onClose call). */
export function closeLevelSelect() {
  if (!ui.open) return;
  ui.open = false;
  if (ui.overlay) ui.overlay.hidden = true;
  if (hasDom()) {
    document.documentElement.classList.remove(OPEN_CLASS);
    const a = document.activeElement;
    if (a && ui.overlay && ui.overlay.contains(a) && a.blur) a.blur();
  }
  events.emit('levelselect:close', {});
}

export function isLevelSelectOpen() {
  return ui.open;
}
