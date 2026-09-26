// render.js — Agent K. Canvas 2D renderer (WORK_ORDER.md 5.10).
// Owns the semantics of state.effects. Reads every other slice of state, never writes gameplay state.
import { TILE, COLORS, ZOMBIE, POWERUPS, RENDER, MYSTERY_BOX } from './config.js';
import * as events from './events.js';
import * as weaponsMod from './weapons.js';
import * as powerupsMod from './powerups.js';
import * as pathfindingMod from './pathfinding.js';
import * as CFG from './config.js';
import * as pixel from './sprites/pixel.js';
import * as soldierMod from './sprites/soldier.js';
import * as gunsMod from './sprites/guns.js';
import * as animMod from './sprites/animator.js';

// Tunables live in config.js RENDER (moved by integrator).
const EFFECT_CAP = RENDER.effectCap;
const TEXT_TTL = RENDER.textTtl;
const TEXT_RISE = RENDER.textRise;
const DAMAGE_SHAKE = RENDER.damageShake;
const NUKE_SHAKE = RENDER.nukeShake;
// Overlay tuning lives in RENDER (config.js): zombieBloodTint, damageVignetteMax, damageWithZbMult.

// Tile codes (map.js 5.1)
const T_FLOOR = 0, T_WALL = 1, T_WINDOW = 2, T_POCKET = 3, T_BOX = 4, T_WALLBUY = 5, T_OPEN = 6;
const T_DOOR = 7; // WO4 2.1: closed buyable door (opening sets its tiles to T_FLOOR)
const DOOR_FX_TTL = 0.6;
const DOOR_SHAKE = { ttl: 0.35, magnitude: 3 };

let canvas = null;
let ctx = null;
let unsubs = [];
let pending = [];          // effects created by event handlers, flushed into state on next update/render
let staticLayer = null;    // { canvas, map, key }
let vignette = null;       // { red, orange } gradients in unit space
let fps = 0, fpsAcc = 0, fpsFrames = 0, lastNow = 0;
let textJitter = 0;

// WO2 3.7: player sprite animation state (one per renderer; reset in initRender / on restart).
let anim = null;
let animPlayer = null;     // the player object `anim` belongs to (a new player object resets it)
let frameMuzzle = null;    // { x, y } muzzle world position for this frame (null when no sprite drawn)
const MUZZLE_SNAP_DIST = 40;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initRender(c) {
  canvas = c || null;
  ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  staticLayer = null;
  vignette = null;
  // Idempotent: safe to call again after events.clearAll() on restart.
  for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
  unsubs = [];
  pending = [];
  unsubs.push(events.on('points:changed', onPointsChanged));
  unsubs.push(events.on('player:damaged', onPlayerDamaged));
  unsubs.push(events.on('powerup:collected', onPowerupCollected));
  unsubs.push(events.on('game:restart', () => { pending = []; resetAnim(); }));
  unsubs.push(events.on('weapon:fired', onWeaponFired));
  unsubs.push(events.on('purchase:made', onPurchaseMade));
  resetAnim();
}

export function addEffect(state, effect) {
  if (!state || !effect) return effect;
  if (!Array.isArray(state.effects)) state.effects = [];
  normalizeEffect(effect);
  state.effects.push(effect);
  if (state.effects.length > EFFECT_CAP) state.effects.splice(0, state.effects.length - EFFECT_CAP);
  return effect;
}

export function updateEffects(state, dt) {
  if (!state) return;
  flushPending(state);
  const list = state.effects;
  if (!Array.isArray(list)) { state.effects = []; return; }
  const d = dt > 0 ? dt : 0;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    normalizeEffect(e);
    e.ttl -= d;
    if (e.ttl > 0) list[w++] = e;
  }
  list.length = w;
  if (list.length > EFFECT_CAP) list.splice(0, list.length - EFFECT_CAP);
}

const viewScratch = { x: 0, y: 0, w: 0, h: 0 };

export function render(state) {
  if (!ctx || !canvas) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  tickFps(now);
  if (state) flushPending(state);

  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  if (!state || state.phase === 'menu' || !state.map) {
    drawMenuBackground(W, H, now);
    return;
  }

  updateAnim(state);

  const map = state.map;
  const t = state.time || 0;
  const cam = state.camera || { x: 0, y: 0 };
  const shake = shakeOffset(state, t);
  const camX = Math.round((cam.x || 0) + shake.x);
  const camY = Math.round((cam.y || 0) + shake.y);
  const view = viewScratch;
  view.x = camX; view.y = camY; view.w = W; view.h = H;

  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);

  // ---- world space ----
  ctx.save();
  ctx.translate(-camX, -camY);

  drawStaticLayer(map, view);
  drawBarricades(map, view);
  drawBox(state, map, t);
  drawPowerups(state, t, view);
  drawEffectsOfType(state, 'blood', view);
  drawZombies(state, view);
  drawBullets(state);
  drawPlayer(state);
  drawBoxLabel(state, map, t);
  drawEffectsOfType(state, 'tracer', view);
  drawEffectsOfType(state, 'muzzle', view);
  drawEffectsOfType(state, 'shockwave', view);
  drawEffectsOfType(state, 'explosion', view);
  drawEffectsOfType(state, 'doorOpen', view);
  drawEffectsOfType(state, 'text', view);
  if (state.debug) drawDebugWorld(state, view);

  ctx.restore();

  // ---- screen space ----
  drawZombieBloodTint(state, W, H);
  drawDamageVignette(state, W, H);
  drawFlash(state, W, H);
  if (state.debug) drawDebugScreen(state);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onPointsChanged(p) {
  if (!p || !(p.delta > 0)) return;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  textJitter = (textJitter + 1) % 7;
  pending.push({
    type: 'text', x: p.x + (textJitter - 3) * 4, y: p.y - 18,
    text: '+' + p.delta, color: COLORS.hudPoints, ttl: TEXT_TTL, maxTtl: TEXT_TTL,
  });
}

function onPlayerDamaged() {
  pending.push({ type: 'shake', ttl: DAMAGE_SHAKE.ttl, maxTtl: DAMAGE_SHAKE.ttl, magnitude: DAMAGE_SHAKE.magnitude });
}

function onPowerupCollected(p) {
  if (p && p.type === 'nuke') {
    pending.push({ type: 'shake', ttl: NUKE_SHAKE.ttl, maxTtl: NUKE_SHAKE.ttl, magnitude: NUKE_SHAKE.magnitude });
  }
}

// WO4 2.4: purchase:made kind 'door' -> dust burst at the door centre + small shake. The handler
// has no state, so the effect carries the door id and is placed when the queue is flushed.
function onPurchaseMade(p) {
  if (!p || p.kind !== 'door') return;
  pending.push({ type: 'doorOpen', doorId: p.id, ttl: DOOR_FX_TTL, maxTtl: DOOR_FX_TTL });
  pending.push({ type: 'shake', ttl: DOOR_SHAKE.ttl, maxTtl: DOOR_SHAKE.ttl, magnitude: DOOR_SHAKE.magnitude });
}

// Fills x/y (and the door's extent/axis) of a queued doorOpen effect from state.map.doors.
// Returns false when the door cannot be found, so the effect is dropped.
function placeDoorEffect(state, e) {
  if (Number.isFinite(e.x) && Number.isFinite(e.y)) return true;
  const doors = state && state.map && Array.isArray(state.map.doors) ? state.map.doors : [];
  const d = doors.find((o) => o && o.id === e.doorId);
  if (!d) return false;
  const b = doorBox(d);
  if (!b) return false;
  e.x = Number.isFinite(d.cx) ? d.cx : b.x + b.w / 2;
  e.y = Number.isFinite(d.cy) ? d.cy : b.y + b.h / 2;
  e.axis = doorAxis(d, b);
  e.len = e.axis === 'v' ? b.h : b.w;
  return true;
}

// weapon:fired -> recoil. The payload carries the fire direction, which is the aim at that moment.
function onWeaponFired(p) {
  if (!anim || !p) return;
  const def = weaponDef(p.weaponId) || (p.weaponId != null ? { id: p.weaponId } : null);
  const aim = Number.isFinite(p.dirX) && Number.isFinite(p.dirY) && (p.dirX || p.dirY)
    ? Math.atan2(p.dirY, p.dirX)
    : (animPlayer && Number.isFinite(animPlayer.angle) ? animPlayer.angle : undefined);
  try { if (typeof animMod.noteShot === 'function') animMod.noteShot(anim, def, aim); } catch (_) { /* art module mid-rewrite */ }
}

function flushPending(state) {
  if (!pending.length) return;
  const q = pending; pending = [];
  for (const e of q) {
    if (e.type === 'doorOpen' && !placeDoorEffect(state, e)) continue;
    addEffect(state, e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEffect(e) {
  if (!(typeof e.ttl === 'number') || Number.isNaN(e.ttl)) e.ttl = defaultTtl(e.type);
  if (!(e.maxTtl > 0)) e.maxTtl = e.ttl > 0 ? e.ttl : defaultTtl(e.type);
}

function defaultTtl(type) {
  switch (type) {
    case 'tracer': return 0.06;
    case 'muzzle': return 0.05;
    case 'blood': return 0.6;
    case 'flash': return 0.5;
    case 'shake': return 0.3;
    case 'text': return TEXT_TTL;
    case 'explosion': return 0.35;
    case 'doorOpen': return DOOR_FX_TTL;
    case 'shockwave': return (CFG.WEAPON_FX && CFG.WEAPON_FX.shockwaveTtl) || 0.45;
    default: return 0.3;
  }
}

function lifeFrac(e) {
  const m = e.maxTtl > 0 ? e.maxTtl : 1;
  const f = e.ttl / m;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// Deterministic visual noise; render must not consume state.rng (would perturb gameplay determinism).
function hash(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function tickFps(now) {
  if (lastNow) {
    fpsAcc += now - lastNow;
    fpsFrames++;
    if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  }
  lastNow = now;
}

function inView(view, x, y, pad) {
  return x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;
}

function weaponDef(id) {
  const W = weaponsMod && weaponsMod.WEAPONS;
  return (W && id != null && W[id]) || null;
}

function weaponName(id) {
  const d = weaponDef(id);
  return (d && d.name) || (id != null ? String(id) : '?');
}

function powerupLabel(type) {
  const L = powerupsMod && powerupsMod.POWERUP_LABEL;
  if (L && L[type]) return L[type];
  return String(type || '?').replace(/([A-Z])/g, ' $1').toUpperCase();
}

function initials(label) {
  const parts = String(label).split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(label).slice(0, 2).toUpperCase();
}

function tileAt(map, tx, ty) {
  if (!map || !map.tiles || tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return T_WALL;
  return map.tiles[ty * map.cols + tx];
}

function isSolidCode(c) { return c === T_WALL || c === T_WALLBUY || c === T_BOX || c === T_WINDOW; }

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function shade(hex, f) {
  // f < 1 darkens, > 1 lightens
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ---------------------------------------------------------------------------
// Menu background
// ---------------------------------------------------------------------------

function drawMenuBackground(W, H, now) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0709');
  g.addColorStop(1, '#170a0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Scrolling faint grid
  const off = (now * 12) % TILE;
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -off; x < W; x += TILE) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
  for (let y = -off; y < H; y += TILE) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();

  // Drifting red fog blobs
  for (let i = 0; i < 7; i++) {
    const bx = (hash(i) * W + Math.sin(now * 0.13 + i * 1.7) * 160 + W) % W;
    const by = (hash(i + 20) * H + Math.cos(now * 0.11 + i * 2.3) * 120 + H) % H;
    const r = 180 + hash(i + 40) * 220;
    const rg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    rg.addColorStop(0, 'rgba(140,20,20,0.16)');
    rg.addColorStop(1, 'rgba(140,20,20,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  }

  // Shambling silhouettes along the bottom
  for (let i = 0; i < 12; i++) {
    const speed = 14 + hash(i + 60) * 18;
    const x = ((hash(i + 80) * (W + 200) + now * speed) % (W + 200)) - 100;
    const y = H - 60 - hash(i + 100) * 140;
    const r = 10 + hash(i + 120) * 6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y + Math.sin(now * 3 + i) * 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// Static map layer (cached offscreen)
// ---------------------------------------------------------------------------

// Memoized per map once weapons and real gun art have loaded (neither changes at runtime), so
// the per-frame check allocates nothing (FIX-2, review Info #9).
// WO4 2.4: map.version (bumped on every door open) is part of the key and of the memo check, so
// an opened door repaints the layer; a missing version counts as 0.
let staticKeyMemo = { map: null, version: 0, key: '' };
function staticKey(map) {
  const ver = Number.isFinite(map.version) ? map.version : 0;
  if (staticKeyMemo.map === map && staticKeyMemo.version === ver) return staticKeyMemo.key;
  const W = weaponsMod && weaponsMod.WEAPONS;
  const n = W ? Object.keys(W).length : 0;
  const art = gunArtKey();
  const key = n + ':' + (map.cols || 0) + 'x' + (map.rows || 0) + ':' + art + ':v' + ver;
  if (n > 0 && art === 'gunart') staticKeyMemo = { map, version: ver, key };
  return key;
}

// Part of the static-layer key: whether the gun art is still placeholder, so the wall-buy chalk
// silhouettes repaint once real GUN_SPRITES exist.
function gunArtKey() {
  const G = gunsMod.GUN_SPRITES;
  if (!G) return 'nogun';
  try {
    for (const k in G) if (!G[k] || !G[k].sprite || pixel.isPlaceholder(G[k].sprite)) return 'gunph';
  } catch (_) { return 'gunerr'; }
  return 'gunart';
}

// Chalk-tinted copy of a gun sprite for wall buys (outline bright, fill faint). Cached per sprite.
const chalkCache = new Map();
function chalkSprite(sprite) {
  let c = chalkCache.get(sprite);
  if (c) return c;
  c = pixel.tint(sprite, (r, g, b, a) => {
    if (!a) return [0, 0, 0, 0];
    const lum = (r + g + b) / 3;
    return lum < 45 ? [245, 245, 235, 240] : [245, 245, 235, Math.round(50 + lum * 0.35)];
  });
  chalkCache.set(sprite, c);
  return c;
}

// Draws the wall-buy gun from GUN_SPRITES in chalk at (0,0) of `c`. False when art is placeholder.
function paintChalkGun(c, def, maxW, maxH) {
  if (!def || gunArtKey() !== 'gunart') return false;
  const gun = gunEntryFor(def);
  if (!gun || !gun.sprite || pixel.isPlaceholder(gun.sprite)) return false;
  const sp = gun.sprite;
  const scale = Math.max(1, Math.min(3, Math.floor(maxW / sp.w), Math.floor(maxH / sp.h)));
  pixel.drawSprite(c, chalkSprite(sp), 0, 0, { scale, angle: 0, ax: sp.w / 2, ay: sp.h / 2, directions: 0 });
  return true;
}

function getStaticLayer(map) {
  const key = staticKey(map);
  if (staticLayer && staticLayer.map === map && staticLayer.key === key) return staticLayer.canvas;
  if (typeof document === 'undefined') return null;
  const width = map.width || (map.cols || 0) * TILE;
  const height = map.height || (map.rows || 0) * TILE;
  if (!(width > 0 && height > 0)) return null;
  const oc = document.createElement('canvas');
  oc.width = width; oc.height = height;
  const c = oc.getContext('2d');
  paintStatic(c, map, width, height);
  staticLayer = { canvas: oc, map, key };
  return oc;
}

function paintStatic(c, map, width, height) {
  const cols = map.cols || Math.round(width / TILE);
  const rows = map.rows || Math.round(height / TILE);

  // Floor
  c.fillStyle = COLORS.floor;
  c.fillRect(0, 0, width, height);
  // Subtle floor mottling
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const h = hash(tx * 131 + ty * 17);
      if (h > 0.7) {
        c.fillStyle = `rgba(0,0,0,${(h - 0.7) * 0.25})`;
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }
  // Grid
  c.strokeStyle = 'rgba(255,255,255,0.04)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= width; x += TILE) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, height); }
  for (let y = 0; y <= height; y += TILE) { c.moveTo(0, y + 0.5); c.lineTo(width, y + 0.5); }
  c.stroke();

  // Spawn pockets, open spawns, window frames
  if (map.tiles) {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const code = map.tiles[ty * cols + tx];
        const x = tx * TILE, y = ty * TILE;
        if (code === T_POCKET) {
          c.fillStyle = '#0a0a0c';
          c.fillRect(x, y, TILE, TILE);
        } else if (code === T_OPEN) {
          c.fillStyle = 'rgba(90,10,10,0.35)';
          c.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
          c.strokeStyle = 'rgba(160,30,30,0.35)';
          c.strokeRect(x + 4.5, y + 4.5, TILE - 9, TILE - 9);
        } else if (code === T_WINDOW) {
          c.fillStyle = '#141416';
          c.fillRect(x, y, TILE, TILE);
          c.strokeStyle = '#4a3a2a';
          c.lineWidth = 2;
          c.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          c.lineWidth = 1;
        }
      }
    }
  }

  // Walls: prefer merged rects, fall back to tiles
  const rects = Array.isArray(map.walls) && map.walls.length ? map.walls : null;
  c.fillStyle = COLORS.wall;
  if (rects) {
    for (const r of rects) c.fillRect(r.x, r.y, r.w, r.h);
  } else if (map.tiles) {
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      if (map.tiles[ty * cols + tx] === T_WALL) c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  // Wall-buy tiles are walls too
  if (Array.isArray(map.wallBuys)) {
    for (const wb of map.wallBuys) c.fillRect(wb.x, wb.y, wb.w || TILE, wb.h || TILE);
  }
  // Edges: draw per-tile edges only where a wall borders a non-solid tile (clean outlines)
  if (map.tiles) {
    c.strokeStyle = COLORS.wallEdge;
    c.lineWidth = 1;
    c.beginPath();
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const code = map.tiles[ty * cols + tx];
        if (code !== T_WALL && code !== T_WALLBUY) continue;
        const x = tx * TILE, y = ty * TILE;
        if (!isSolidCode(tileAt(map, tx, ty - 1)) || tileAt(map, tx, ty - 1) === T_WINDOW) { c.moveTo(x, y + 0.5); c.lineTo(x + TILE, y + 0.5); }
        if (!isSolidCode(tileAt(map, tx, ty + 1)) || tileAt(map, tx, ty + 1) === T_WINDOW) { c.moveTo(x, y + TILE - 0.5); c.lineTo(x + TILE, y + TILE - 0.5); }
        if (!isSolidCode(tileAt(map, tx - 1, ty)) || tileAt(map, tx - 1, ty) === T_WINDOW) { c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + TILE); }
        if (!isSolidCode(tileAt(map, tx + 1, ty)) || tileAt(map, tx + 1, ty) === T_WINDOW) { c.moveTo(x + TILE - 0.5, y); c.lineTo(x + TILE - 0.5, y + TILE); }
      }
    }
    c.stroke();
  } else if (rects) {
    c.strokeStyle = COLORS.wallEdge;
    for (const r of rects) c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  // Wall buys: chalk outline + name + price
  if (Array.isArray(map.wallBuys)) {
    for (const wb of map.wallBuys) paintWallBuy(c, map, wb);
  }

  // WO4: closed doors (planks + iron bands + labels on both sides). Open doors are floor.
  paintDoors(c, map, cols, rows);
}

// ---------------------------------------------------------------------------
// Doors (WO4 2.4)
// ---------------------------------------------------------------------------

// Bounding box of a door in world px: its own x/y/w/h, else derived from its tiles.
function doorBox(d) {
  if (Number.isFinite(d.x) && Number.isFinite(d.y) && d.w > 0 && d.h > 0) return { x: d.x, y: d.y, w: d.w, h: d.h };
  if (!Array.isArray(d.tiles) || !d.tiles.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of d.tiles) {
    x0 = Math.min(x0, t.tx); y0 = Math.min(y0, t.ty); x1 = Math.max(x1, t.tx); y1 = Math.max(y1, t.ty);
  }
  return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
}

// 'h' = the doorway runs along x (a door in a horizontal wall), 'v' = along y.
function doorAxis(d, b) {
  if (d && (d.axis === 'h' || d.axis === 'v')) return d.axis;
  return b && b.h > b.w ? 'v' : 'h';
}

function paintDoors(c, map, cols, rows) {
  const doors = Array.isArray(map.doors) ? map.doors : [];
  const covered = new Set();
  const labels = [];
  for (const d of doors) {
    if (!d || d.open) continue;
    const b = doorBox(d);
    if (!b) continue;
    if (Array.isArray(d.tiles)) for (const t of d.tiles) covered.add(t.ty * cols + t.tx);
    const axis = doorAxis(d, b);
    paintDoorPanel(c, b, axis, (d.id || 0) * 97);
    const price = Number.isFinite(d.cost) ? String(d.cost) : '';
    const sides = axis === 'v' ? [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }] : [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
    for (const s of sides) labels.push([b, s, price]);
  }
  // Stray door tiles not described by map.doors (defensive): plain one-tile panels, no label.
  if (map.tiles) {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const i = ty * cols + tx;
        if (map.tiles[i] !== T_DOOR || covered.has(i)) continue;
        const l = tileAt(map, tx - 1, ty), r = tileAt(map, tx + 1, ty);
        const alongX = isSolidCode(l) || l === T_DOOR || isSolidCode(r) || r === T_DOOR;
        paintDoorPanel(c, { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, alongX ? 'h' : 'v', i);
      }
    }
  }
  // Labels last so no panel covers them.
  for (const [b, s, price] of labels) paintWallBuyLabel(c, b, b.w, b.h, s, 'OPEN DOOR', price);
}

// Heavy dark wooden planks running along the doorway, crossed by riveted iron bands.
// Painted in a local frame: u along the doorway (length L), v across it (depth D).
function paintDoorPanel(c, b, axis, seed) {
  const L = axis === 'v' ? b.h : b.w;
  const D = axis === 'v' ? b.w : b.h;
  c.save();
  if (axis === 'v') { c.translate(b.x + b.w, b.y); c.rotate(Math.PI / 2); }
  else c.translate(b.x, b.y);
  // Recessed dark frame
  c.fillStyle = '#120c07';
  c.fillRect(0, 0, L, D);
  // Planks
  const n = Math.max(3, Math.round(D / 10));
  const inset = 2;
  const ph = (D - inset * 2) / n;
  for (let k = 0; k < n; k++) {
    const v = inset + k * ph;
    const h = hash(seed + k * 7.1);
    const base = 40 + Math.round(h * 14);
    c.fillStyle = `rgb(${base + 16},${Math.round(base * 0.66)},${Math.round(base * 0.36)})`;
    c.fillRect(1, v + 0.5, L - 2, ph - 1);
    // Grain
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    const gy = Math.round(v + ph * (0.35 + hash(seed + k * 3.3) * 0.3)) + 0.5;
    const gx0 = 4 + hash(seed + k * 5.7) * L * 0.3;
    c.moveTo(gx0, gy); c.lineTo(Math.min(L - 4, gx0 + L * 0.45), gy);
    c.stroke();
    // Top highlight + bottom shadow on each plank
    c.fillStyle = 'rgba(255,220,170,0.10)';
    c.fillRect(1, v + 0.5, L - 2, 1);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(1, v + ph - 1.5, L - 2, 1);
  }
  // Iron bands across the planks, two per tile of the doorway, with rivets
  const tiles = Math.max(1, Math.round(L / TILE));
  const bandW = 5;
  const step = L / tiles;
  for (let k = 0; k < tiles; k++) {
    for (const off of [7, step - 7 - bandW]) {
      const u = Math.round(k * step + off);
      c.fillStyle = '#2b2d31';
      c.fillRect(u, 1, bandW, D - 2);
      c.fillStyle = 'rgba(160,165,172,0.35)';
      c.fillRect(u, 1, 1, D - 2);
      c.fillStyle = '#9aa0a8';
      for (let r = 0; r < 3; r++) {
        const v = Math.round(D * (0.2 + r * 0.3));
        c.fillRect(u + 1.5, v - 1, 2, 2);
      }
    }
  }
  // Outline
  c.strokeStyle = '#050302';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, L - 1, D - 1);
  c.restore();
}

function paintWallBuy(c, map, wb) {
  const w = wb.w || TILE, h = wb.h || TILE;
  const cx = wb.x + w / 2, cy = wb.y + h / 2;
  const tx = wb.tx != null ? wb.tx : Math.floor(cx / TILE);
  const ty = wb.ty != null ? wb.ty : Math.floor(cy / TILE);
  const def = weaponDef(wb.weaponId);
  const name = weaponName(wb.weaponId).toUpperCase();
  const price = def && typeof def.cost === 'number' ? String(def.cost) : '';

  // Chalk panel + weapon silhouette on the wall tile itself (always drawn upright).
  c.save();
  c.fillStyle = 'rgba(230,230,220,0.07)';
  c.fillRect(wb.x + 2, wb.y + 2, w - 4, h - 4);
  c.strokeStyle = 'rgba(235,235,225,0.35)';
  c.lineWidth = 1;
  c.setLineDash([3, 2]);
  c.strokeRect(wb.x + 2.5, wb.y + 2.5, w - 5, h - 5);
  c.setLineDash([]);
  c.translate(cx, cy);
  let drewSprite = false;
  // Chalk may spill onto neighbouring wall tiles along a horizontal wall run (scale up to 3).
  const wideOk = isSolidCode(tileAt(map, tx - 1, ty)) && isSolidCode(tileAt(map, tx + 1, ty));
  try { drewSprite = paintChalkGun(c, def, wideOk ? w * 1.6 : w - 6, h - 6); } catch (_) { drewSprite = false; }
  if (!drewSprite) {
    c.strokeStyle = 'rgba(245,245,235,0.95)';
    c.fillStyle = 'rgba(245,245,235,0.18)';
    c.lineWidth = 1.5;
    c.lineJoin = 'round';
    c.beginPath();
    gunSilhouette(c, def ? def.cls : 'ar');
    c.fill();
    c.stroke();
  }
  c.restore();

  // Readable label on every open floor side facing a room (horizontal text, dark plate).
  const sides = [
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
  ].filter((s) => isOpenFloorCode(tileAt(map, tx + s.dx, ty + s.dy)));
  if (!sides.length) sides.push({ dx: 0, dy: 1 });
  for (const s of sides) paintWallBuyLabel(c, wb, w, h, s, name, price);
}

function isOpenFloorCode(code) { return code === T_FLOOR || code === T_OPEN; }

// Chalk gun outline centred on (0,0), about 34x16 px, shape by weapon class.
function gunSilhouette(c, cls) {
  const path = (pts) => { c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };
  if (cls === 'pistol') {
    path([-10, -6, 10, -6, 10, -1, -2, -1, -4, 8, -10, 8, -8, -1, -10, -1]);
  } else if (cls === 'shotgun') {
    path([-17, -1, -11, -4, 17, -4, 17, -1, 2, -1, 2, 2, -4, 2, -7, 1, -11, 4, -17, 4]);
    c.moveTo(4, 2); c.lineTo(12, 2); c.lineTo(12, 0);
  } else if (cls === 'smg') {
    path([-13, -3, -6, -5, 9, -5, 9, -3, 14, -3, 14, -1, 9, -1, 4, 0, 4, 8, 0, 8, 0, 0, -4, 0, -5, 6, -9, 6, -8, 0, -13, 1]);
  } else {
    // ar / default rifle
    path([-17, -3, -9, -5, 8, -5, 8, -3, 17, -3, 17, -1, 8, -1, 3, 0, 5, 7, 1, 8, -1, 0, -5, 0, -6, 6, -10, 6, -9, 0, -17, 3]);
  }
}

function paintWallBuyLabel(c, wb, w, h, side, name, price) {
  const nameFont = 'bold 12px monospace';
  const priceFont = 'bold 12px monospace';
  c.save();
  c.font = nameFont;
  const nameW = c.measureText(name).width;
  c.font = priceFont;
  const priceW = price ? c.measureText(price).width : 0;
  const padX = 5, lineH = 14;
  const plateW = Math.ceil(Math.max(nameW, priceW) + padX * 2);
  const plateH = price ? lineH * 2 + 4 : lineH + 4;
  const gap = 3;
  let px, py;
  if (side.dy === 1) { px = wb.x + w / 2 - plateW / 2; py = wb.y + h + gap; }
  else if (side.dy === -1) { px = wb.x + w / 2 - plateW / 2; py = wb.y - gap - plateH; }
  else if (side.dx === 1) { px = wb.x + w + gap; py = wb.y + h / 2 - plateH / 2; }
  else { px = wb.x - gap - plateW; py = wb.y + h / 2 - plateH / 2; }
  px = Math.round(px); py = Math.round(py);
  // Dark backing plate with a chalk border
  c.fillStyle = 'rgba(8,8,10,0.82)';
  roundRect(c, px, py, plateW, plateH, 3);
  c.fill();
  c.strokeStyle = 'rgba(235,235,225,0.45)';
  c.lineWidth = 1;
  roundRect(c, px + 0.5, py + 0.5, plateW - 1, plateH - 1, 3);
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = nameFont;
  c.fillStyle = '#f4f4ea';
  c.fillText(name, px + plateW / 2, py + 2 + lineH / 2 + 0.5);
  if (price) {
    c.font = priceFont;
    c.fillStyle = COLORS.hudPoints;
    c.fillText(price, px + plateW / 2, py + 2 + lineH * 1.5 + 0.5);
  }
  c.restore();
}

function drawStaticLayer(map, view) {
  const layer = getStaticLayer(map);
  if (!layer) return;
  // Blit only the visible region, clamped to the layer bounds.
  const sx = Math.max(0, view.x), sy = Math.max(0, view.y);
  const ex = Math.min(layer.width, view.x + view.w), ey = Math.min(layer.height, view.y + view.h);
  const sw = ex - sx, sh = ey - sy;
  if (sw <= 0 || sh <= 0) return;
  ctx.drawImage(layer, sx, sy, sw, sh, sx, sy, sw, sh);
}

// ---------------------------------------------------------------------------
// Dynamic world objects
// ---------------------------------------------------------------------------

function drawBarricades(map, view) {
  if (!Array.isArray(map.barricades)) return;
  for (const b of map.barricades) {
    const w = b.w || TILE, h = b.h || TILE;
    if (!inView(view, b.x + w / 2, b.y + h / 2, TILE)) continue;
    const max = b.maxBoards > 0 ? b.maxBoards : 6;
    const boards = Math.max(0, Math.min(max, b.boards | 0));
    const tx = b.tx != null ? b.tx : Math.floor((b.x + w / 2) / TILE);
    const ty = b.ty != null ? b.ty : Math.floor((b.y + h / 2) / TILE);
    // Window in a horizontal wall -> planks run horizontally, stacked along y.
    const horizontal = isSolidCode(tileAt(map, tx - 1, ty)) && isSolidCode(tileAt(map, tx + 1, ty))
      || !(isSolidCode(tileAt(map, tx, ty - 1)) && isSolidCode(tileAt(map, tx, ty + 1)));
    ctx.save();
    ctx.translate(b.x + w / 2, b.y + h / 2);
    if (!horizontal) ctx.rotate(Math.PI / 2);
    const span = horizontal ? w : h;
    const depth = horizontal ? h : w;
    const step = (depth - 4) / max;
    for (let i = 0; i < boards; i++) {
      const y = -depth / 2 + 2 + step * i + step / 2;
      const tilt = (hash(b.id * 7 + i) - 0.5) * 0.25;
      ctx.save();
      ctx.translate(0, y);
      ctx.rotate(tilt);
      ctx.fillStyle = i % 2 ? '#7a5230' : '#8a5e36';
      ctx.fillRect(-span / 2 - 3, -step * 0.38, span + 6, step * 0.76);
      ctx.strokeStyle = '#3a2412';
      ctx.lineWidth = 1;
      ctx.strokeRect(-span / 2 - 3, -step * 0.38, span + 6, step * 0.76);
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawBox(state, map, t) {
  const box = map.box;
  if (!box) return;
  const w = box.w || TILE, h = box.h || TILE;
  const cx = box.x + w / 2, cy = box.y + h / 2;
  const bs = (state.shop && state.shop.box) || { state: 'idle' };

  // Wooden crate
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(box.x + 2, box.y + 2, w - 4, h - 4);
  ctx.strokeStyle = '#2e1c0c';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x + 3, box.y + 3, w - 6, h - 6);
  ctx.beginPath();
  ctx.moveTo(box.x + 4, box.y + 4); ctx.lineTo(box.x + w - 4, box.y + h - 4);
  ctx.moveTo(box.x + w - 4, box.y + 4); ctx.lineTo(box.x + 4, box.y + h - 4);
  ctx.stroke();

  // Glowing ?
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);
  ctx.save();
  ctx.shadowColor = '#7fd4ff';
  ctx.shadowBlur = 10 + 8 * pulse;
  ctx.fillStyle = `rgba(160,225,255,${0.7 + 0.3 * pulse})`;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + 1);
  ctx.restore();

  if (bs.state === 'spinning' || bs.state === 'offering') {
    // Beam of light while active (the name label is drawn later, above the player: drawBoxLabel)
    ctx.fillStyle = bs.state === 'offering' ? 'rgba(255,213,74,0.08)' : 'rgba(127,212,255,0.08)';
    ctx.fillRect(box.x + 6, box.y - 40, w - 12, 40);
  }
}

// Floating weapon label for the box. Drawn after the player so it is never covered, and placed on
// the side of the box away from the player (above by default, below if the player is above).
function drawBoxLabel(state, map, t) {
  const box = map.box;
  if (!box) return;
  const bs = (state.shop && state.shop.box) || { state: 'idle' };
  if (bs.state !== 'spinning' && bs.state !== 'offering') return;
  const w = box.w || TILE, h = box.h || TILE;
  const cx = box.x + w / 2, cy = box.y + h / 2;
  const offering = bs.state === 'offering';
  const name = weaponName(bs.weaponId).toUpperCase();
  const bob = offering ? Math.sin(t * 2) * 2 : Math.sin(t * 20) * 1.5;
  const p = state.player;
  const lift = 44;
  let y = box.y - lift;
  if (p && p.y < cy && Math.abs(p.x - cx) < 70) y = box.y + h + lift - 8;
  y += bob;

  ctx.save();
  ctx.font = 'bold 17px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = Math.max(ctx.measureText(name).width, 60) + 20;
  const th = offering ? 32 : 26;
  const x0 = Math.round(cx - tw / 2), y0 = Math.round(y - 13);
  const accent = offering ? COLORS.hudPoints : '#7fd4ff';
  ctx.fillStyle = 'rgba(6,6,10,0.85)';
  roundRect(ctx, x0, y0, tw, th, 5);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x0 + 0.5, y0 + 0.5, tw - 1, th - 1, 5);
  ctx.stroke();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.fillStyle = offering ? COLORS.hudPoints : '#dff4ff';
  ctx.fillText(name, cx, y0 + 13);
  ctx.shadowBlur = 0;
  if (offering) {
    // Offer countdown bar
    const frac = Math.max(0, Math.min(1, (bs.timer || 0) / (MYSTERY_BOX.offerSeconds || 10)));
    const bw = tw - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x0 + 8, y0 + th - 7, bw, 3);
    ctx.fillStyle = frac < 0.3 ? '#ff6a4a' : COLORS.hudPoints;
    ctx.fillRect(x0 + 8, y0 + th - 7, bw * frac, 3);
  }
  ctx.restore();
}

function drawPowerups(state, t, view) {
  const items = state.powerups && state.powerups.items;
  if (!Array.isArray(items) || !items.length) return;
  const blinkAt = POWERUPS.blinkAt;
  for (const it of items) {
    if (!it || !inView(view, it.x, it.y, 40)) continue;
    if (typeof it.ttl === 'number' && it.ttl < blinkAt) {
      // Blink faster as it nears expiry
      const rate = it.ttl < 3 ? 12 : 6;
      if (Math.floor(t * rate) % 2 === 0) continue;
    }
    const bob = Math.sin(((it.bob != null ? it.bob : t)) * 4) * 4;
    const x = it.x, y = it.y + bob;
    const s = 22;
    ctx.save();
    ctx.shadowColor = COLORS.powerupGlow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(20,40,16,0.9)';
    roundRect(ctx, x - s / 2, y - s / 2, s, s, 5);
    ctx.fill();
    ctx.strokeStyle = COLORS.powerupGlow;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.powerupGlow;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(powerupLabel(it.type)), x, y + 1);
    ctx.restore();
  }
}

function zombieColor(tier) {
  if (tier === 'sprint') return COLORS.zombieSprint;
  if (tier === 'jog') return COLORS.zombieJog;
  return COLORS.zombieWalk;
}

function drawZombies(state, view) {
  const zs = state.zombies;
  if (!Array.isArray(zs) || !zs.length) return;
  const linger = ZOMBIE.deathLinger > 0 ? ZOMBIE.deathLinger : 0.6;
  // Corpses first so live zombies draw over them
  for (let pass = 0; pass < 2; pass++) {
    for (const z of zs) {
      if (!z) continue;
      const dying = z.mode === 'dying';
      if ((pass === 0) !== dying) continue;
      if (!inView(view, z.x, z.y, 40)) continue;
      const r0 = z.radius || ZOMBIE.radius;
      let alpha = 1, scale = 1;
      if (dying) {
        const f = Math.max(0, Math.min(1, (z.dyingT != null ? z.dyingT : 0) / linger));
        alpha = f; scale = 0.5 + 0.5 * f;
      }
      const r = r0 * scale;
      const col = zombieColor(z.tier);
      if (!dying && z.stun > 0) { drawStunnedZombie(z, r, col, state.time || 0); continue; }
      const sr = stunSeen.get(z);
      if (sr) sr.last = 0; // stun over: the next stun (any z.stun > 0) replays the puff
      ctx.globalAlpha = alpha;

      // Arms reaching along velocity (or toward player)
      let dx = z.vx || 0, dy = z.vy || 0;
      if (Math.abs(dx) + Math.abs(dy) < 1e-3 && state.player) { dx = state.player.x - z.x; dy = state.player.y - z.y; }
      const dl = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy / dl, dx / dl);
      if (!dying) {
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.rotate(ang);
        ctx.fillStyle = shade(col, 0.8);
        const reach = z.mode === 'attacking' ? r * 1.25 : r * 0.95;
        ctx.fillRect(r * 0.2, -r * 0.75, reach, 4);
        ctx.fillRect(r * 0.2, r * 0.75 - 4, reach, 4);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dying ? shade(col, 0.6) : col;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = shade(col, 0.45);
      ctx.stroke();

      if (!dying) {
        // Eyes
        const ex = Math.cos(ang), ey = Math.sin(ang);
        const px = -ey, py = ex;
        ctx.fillStyle = z.tier === 'sprint' ? '#ffb040' : '#e0e070';
        for (let s = -1; s <= 1; s += 2) {
          ctx.fillRect(z.x + ex * r * 0.45 + px * s * r * 0.35 - 1.5, z.y + ey * r * 0.45 + py * s * r * 0.35 - 1.5, 3, 3);
        }
      }

      if (z.hitFlash > 0) {
        ctx.globalAlpha = alpha * Math.min(1, z.hitFlash / 0.08);
        ctx.beginPath();
        ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}

// Knocked-back zombies (Thundergun): flattened along the knock direction, plus a dust puff that
// starts on the first frame the stun is seen.
// zombie -> { start: game time the current stun's puff started, last: z.stun when last drawn }.
// FIX-2 (review #6): a stun that increases (re-knock while stunned, or a new stun that began
// off-screen) restarts the puff.
const stunSeen = new WeakMap();
const STUN_PUFF_TIME = 0.35;

function drawStunnedZombie(z, r, col, t) {
  const stun = z.stun;
  let rec = stunSeen.get(z);
  if (!rec) { rec = { start: t, last: stun }; stunSeen.set(z, rec); }
  else if (stun > rec.last + 1e-6 || rec.start > t) rec.start = t;
  rec.last = stun;
  const start = rec.start;
  const ka = Number.isFinite(z.knockAngle) ? z.knockAngle
    : (Math.abs(z.kvx || 0) + Math.abs(z.kvy || 0) > 1e-3 ? Math.atan2(z.kvy || 0, z.kvx || 0) : 0);
  const age = t - start;
  if (age < STUN_PUFF_TIME) {
    const f = 1 - age / STUN_PUFF_TIME;
    ctx.save();
    ctx.fillStyle = '#b3a78f';
    for (let k = 0; k < 5; k++) {
      const a = ka + Math.PI + (k - 2) * 0.45;
      const d = r * (0.6 + (1 - f) * 1.2);
      ctx.globalAlpha = 0.6 * f;
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 3 + (1 - f) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.rotate(ka);
  ctx.scale(1, 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = shade(col, 0.85);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = shade(col, 0.45);
  ctx.stroke();
  // Arms flung back against the knock direction
  ctx.fillStyle = shade(col, 0.7);
  ctx.fillRect(-r * 1.3, -r * 0.8, r * 0.8, 4);
  ctx.fillRect(-r * 1.3, r * 0.8 - 4, r * 0.8, 4);
  if (z.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, z.hitFlash / 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.restore();
}

function drawBullets(state) {
  const bs = state.bullets;
  if (!Array.isArray(bs) || !bs.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of bs) {
    if (!b) continue;
    const vx = b.vx || 0, vy = b.vy || 0;
    ctx.strokeStyle = 'rgba(80,255,110,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(b.x - vx * 0.05, b.y - vy * 0.05);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.shadowColor = '#50ff6e';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#b8ffc4';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Player sprite (WO2 3.7): two-layer soldier (legs -> movement, torso + gun -> aim)
// ---------------------------------------------------------------------------

function spriteScale() {
  const s = CFG.SPRITES && CFG.SPRITES.scale;
  return s > 0 ? s : 2;
}

function spriteDirections() {
  const d = CFG.SPRITES && CFG.SPRITES.directions;
  return typeof d === 'number' ? d : 32;
}

function resetAnim() {
  try {
    if (!anim && typeof animMod.createPlayerAnim === 'function') anim = animMod.createPlayerAnim();
    else if (anim && typeof animMod.resetPlayerAnim === 'function') animMod.resetPlayerAnim(anim);
  } catch (_) { anim = null; }
  animPlayer = null;
  frameMuzzle = null;
  downSince = null;
}

function activeWeapon(p) {
  if (!p) return null;
  return p.tempWeapon || (Array.isArray(p.weapons) ? p.weapons[p.activeSlot] : null) || null;
}

function activeWeaponDef(w) {
  if (!w) return null;
  return w.def || weaponDef(w.id) || (w.id != null ? { id: w.id } : null);
}

// Advance the animation once per render() call. Only a playing game moves time forward.
function updateAnim(state) {
  const p = state && state.player;
  if (!p) return;
  if (!anim || animPlayer !== p) { resetAnim(); animPlayer = p; }
  if (!anim || typeof animMod.updatePlayerAnim !== 'function') return;
  const dt = state.phase === 'playing' && state.dt > 0 ? state.dt : 0;
  const w = activeWeapon(p);
  try { animMod.updatePlayerAnim(anim, p, activeWeaponDef(w), w, dt); } catch (_) { /* art module mid-rewrite */ }
}

function gunEntryFor(def) {
  try {
    if (typeof gunsMod.gunSpriteFor === 'function') {
      const g = gunsMod.gunSpriteFor(def);
      if (g && g.sprite) return g;
    }
  } catch (_) { /* fall through */ }
  const G = gunsMod.GUN_SPRITES;
  return (G && G.default && G.default.sprite) ? G.default : null;
}

const blankCache = new Map();  // "WxH" -> transparent Sprite
function blankSprite(w, h) {
  const k = w + 'x' + h;
  let s = blankCache.get(k);
  if (!s) {
    const row = '.'.repeat(w);
    s = pixel.parseGrid(Array.from({ length: h }, () => row));
    blankCache.set(k, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Crisp rotation (FIX-2, visual #2). pixel.drawSprite rotates the 2x-upscaled canvas, which
// gives mixed pixel sizes and a broken 1-px outline on diagonals. Instead, each sprite is
// rotated at 1x source resolution with nearest-neighbour inverse mapping, once per quantized
// direction, and the result is drawn at integer scale with smoothing off. Every pixel then
// stays a scale x scale block on one grid.
// ---------------------------------------------------------------------------

const ROT_CACHE_MAX = 4096;       // rotated canvases kept before the whole cache is dropped
let rotCache = new WeakMap();     // Sprite -> [{ ax, ay, dirs, list: Array(dirs) }]
let rotCount = 0;

function canMakeCanvas() {
  return typeof document !== 'undefined' && !!document.createElement;
}

function findRotVariant(sprite, ax, ay, dirs) {
  const vs = rotCache.get(sprite);
  if (!vs) return null;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.ax === ax && v.ay === ay && v.dirs === dirs) return v;
  }
  return null;
}

// Rotated 1x copy of `sprite` about its anchor (ax, ay; sprite-px corner coordinates) for
// direction `idx` of `dirs`. Returns { canvas, cx, cy, w, h } where (cx, cy) is the anchor in
// canvas px. Built lazily, cached per (sprite, anchor, direction).
function rotatedEntry(sprite, ax, ay, idx, dirs) {
  let v = findRotVariant(sprite, ax, ay, dirs);
  const hit = v && v.list[idx];
  if (hit) return hit;
  if (rotCount >= ROT_CACHE_MAX) { rotCache = new WeakMap(); rotCount = 0; v = null; }
  if (!v) {
    v = { ax, ay, dirs, list: new Array(dirs).fill(null) };
    let vs = rotCache.get(sprite);
    if (!vs) { vs = []; rotCache.set(sprite, vs); }
    vs.push(v);
  }
  const e = buildRotated(sprite, ax, ay, (idx * Math.PI * 2) / dirs);
  v.list[idx] = e;
  rotCount++;
  return e;
}

function snapTrig(v) {
  if (Math.abs(v) < 1e-9) return 0;
  if (Math.abs(v - 1) < 1e-9) return 1;
  if (Math.abs(v + 1) < 1e-9) return -1;
  return v;
}

function buildRotated(sprite, ax, ay, a) {
  const c = snapTrig(Math.cos(a)), s = snapTrig(Math.sin(a));
  const w = sprite.w, h = sprite.h;
  const rad = Math.max(Math.hypot(ax, ay), Math.hypot(w - ax, ay), Math.hypot(ax, h - ay), Math.hypot(w - ax, h - ay));
  const half = Math.ceil(rad) + 1;
  const N = half * 2 + 1;
  // Keep the anchor's sub-pixel phase so angle 0 is an exact copy of the source.
  const cx = half + (ax - Math.floor(ax));
  const cy = half + (ay - Math.floor(ay));
  const src = sprite.pixels;
  const buf = new Uint8ClampedArray(N * N * 4);
  let minX = N, minY = N, maxX = -1, maxY = -1;
  for (let dy = 0; dy < N; dy++) {
    const vy = dy + 0.5 - cy;
    for (let dx = 0; dx < N; dx++) {
      const vx = dx + 0.5 - cx;
      // Inverse map (rotate by -a) back into the source, nearest neighbour.
      const sx = Math.floor(ax + c * vx + s * vy);
      const sy = Math.floor(ay - s * vx + c * vy);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const si = (sy * w + sx) * 4;
      if (!src[si + 3]) continue;
      const di = (dy * N + dx) * 4;
      buf[di] = src[si]; buf[di + 1] = src[si + 1]; buf[di + 2] = src[si + 2]; buf[di + 3] = src[si + 3];
      if (dx < minX) minX = dx;
      if (dx > maxX) maxX = dx;
      if (dy < minY) minY = dy;
      if (dy > maxY) maxY = dy;
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  img.data.set(buf);
  g.putImageData(img, -minX, -minY); // trimmed to the opaque bounding box
  return { canvas: cv, cx: cx - minX, cy: cy - minY, w: tw, h: th };
}

// Draws `sprite` with its anchor at the grid origin (gx, gy) plus a layer offset (ox, oy) in
// world px, rotated to `angle` quantized to `dirs`. The origin is rounded to whole world px and
// the offset to whole sprite px, so every layer of the player shares one pixel grid.
function drawCrisp(sprite, gx, gy, ox, oy, angle, ax, ay, scale, dirs) {
  const s = Math.round(scale);
  if (!(dirs > 0) || s !== scale || s < 1 || !canMakeCanvas()) {
    pixel.drawSprite(ctx, sprite, gx + ox, gy + oy, { scale, angle, ax, ay, directions: dirs });
    return;
  }
  let idx = Math.round((Number.isFinite(angle) ? angle : 0) / ((Math.PI * 2) / dirs)) % dirs;
  if (idx < 0) idx += dirs;
  const e = rotatedEntry(sprite, ax, ay, idx, dirs);
  const x = Math.round(gx) + Math.round(ox / s) * s - Math.round(e.cx * s);
  const y = Math.round(gy) + Math.round(oy / s) * s - Math.round(e.cy * s);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(e.canvas, x, y, e.w * s, e.h * s);
}

// ---------------------------------------------------------------------------
// Torso + gun (+ helmet) composed into one sprite so they rotate as one unit.
// Cached by sprite identity (no per-frame key strings): torso -> gun sprite -> small list of
// variants (hand offset, grip, muzzle, anchor, helmet). One entry per pose/gun/reloadFrame.
// FIX-2 (visual #1): the optional SOLDIER.torso.helmet ({ sprite, anchor }, plus optional
// SOLDIER.torso.helmetOffset[pose]) is the top layer, so the gun passes under the head.
// ---------------------------------------------------------------------------

const NO_GUN = {};
const TORSO_GUN_CACHE_MAX = 256;
let torsoGunCache = new WeakMap(); // torso Sprite -> Map(gun Sprite | NO_GUN -> entry[])
let torsoGunCount = 0;

function helmetSprite(T) {
  const H = T && T.helmet;
  if (!H) return null;
  if (H.sprite && H.sprite.pixels) return H.sprite;
  if (H.pixels) return H; // a bare Sprite is accepted too
  return null;
}

function getTorsoGun(torso, gun, pose, offX, offY) {
  const T = soldierMod.SOLDIER && soldierMod.SOLDIER.torso;
  const ancX = T && T.anchor ? T.anchor.x : torso.w / 2;
  const ancY = T && T.anchor ? T.anchor.y : torso.h / 2;
  const hd = T && T.hand && T.hand[pose];
  const hx = (hd ? hd.x : Math.round(torso.w * 0.8)) + (offX | 0);
  const hy = (hd ? hd.y : Math.round(torso.h / 2)) + (offY | 0);
  const g = gun && gun.sprite && gun.sprite.pixels ? gun.sprite : null;
  const gripX = gun && gun.grip ? gun.grip.x : 0;
  const gripY = gun && gun.grip ? gun.grip.y : (g ? Math.floor(g.h / 2) : 0);
  const muzX = gun && gun.muzzle ? gun.muzzle.x : (g ? g.w - 1 : 0);
  const muzY = gun && gun.muzzle ? gun.muzzle.y : gripY;
  const hs = helmetSprite(T);
  let hox = 0, hoy = 0;
  if (hs) {
    const H = T.helmet;
    const ha = H.anchor || (hs.w === torso.w && hs.h === torso.h ? { x: ancX, y: ancY } : { x: hs.w / 2, y: hs.h / 2 });
    const ho = T.helmetOffset && T.helmetOffset[pose];
    hox = Math.round(ancX + (ho ? ho.x || 0 : 0) - ha.x);
    hoy = Math.round(ancY + (ho ? ho.y || 0 : 0) - ha.y);
  }

  let byGun = torsoGunCache.get(torso);
  const gk = g || NO_GUN;
  let list = byGun && byGun.get(gk);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.hx === hx && e.hy === hy && e.gripX === gripX && e.gripY === gripY && e.muzX === muzX
          && e.muzY === muzY && e.ancX === ancX && e.ancY === ancY && e.helm === hs
          && e.hox === hox && e.hoy === hoy) return e;
    }
  }
  if (torsoGunCount >= TORSO_GUN_CACHE_MAX) {
    torsoGunCache = new WeakMap(); torsoGunCount = 0; byGun = null; list = null;
  }

  const gx = Math.round(hx - gripX), gy = Math.round(hy - gripY);
  let minX = 0, minY = 0, maxX = torso.w, maxY = torso.h;
  if (g) {
    minX = Math.min(minX, gx); minY = Math.min(minY, gy);
    maxX = Math.max(maxX, gx + g.w); maxY = Math.max(maxY, gy + g.h);
  }
  if (hs) {
    minX = Math.min(minX, hox); minY = Math.min(minY, hoy);
    maxX = Math.max(maxX, hox + hs.w); maxY = Math.max(maxY, hoy + hs.h);
  }
  const layers = [
    { sprite: blankSprite(maxX - minX, maxY - minY), dx: 0, dy: 0 },
    { sprite: torso, dx: -minX, dy: -minY },
  ];
  if (g) layers.push({ sprite: g, dx: gx - minX, dy: gy - minY });
  if (hs) layers.push({ sprite: hs, dx: hox - minX, dy: hoy - minY }); // head drawn over the gun
  const sprite = pixel.compose(layers);
  const e = {
    sprite,
    ax: ancX - minX, ay: ancY - minY,
    // Muzzle point relative to the torso rotation anchor, in sprite px (facing +x). grip, muzzle,
    // hand and anchor are all sprite-px corner coordinates.
    mx: gx + muzX - ancX, my: gy + muzY - ancY,
    hx, hy, gripX, gripY, muzX, muzY, ancX, ancY, helm: hs, hox, hoy,
  };
  if (!byGun) { byGun = new Map(); torsoGunCache.set(torso, byGun); }
  if (!list) { list = []; byGun.set(gk, list); }
  list.push(e);
  torsoGunCount++;
  return e;
}

// Resolves the torso+gun sprite and its world transform for the current frame into `out`
// (a module scratch object, so no per-frame allocation). Returns null when nothing to draw.
// x, y are snapped: the player origin to whole world px, the recoil/lean offset to whole
// sprite px, which is exactly where drawCrisp puts the sprite (so the muzzle matches the art).
const poseScratch = { entry: null, x: 0, y: 0, angle: 0, qa: 0, ox: 0, oy: 0, rx: 0, ry: 0 };
function resolveTorsoPose(state, out) {
  const p = state && state.player;
  const S = soldierMod.SOLDIER;
  if (!p || p.down || !S || !S.torso) return null;
  const w = activeWeapon(p);
  const def = activeWeaponDef(w);
  const gun = gunEntryFor(def);
  const pose = (gun && gun.pose) || (anim && anim.pose) || 'twohand';
  const T = S.torso;
  let torso = null;
  let offX = 0, offY = 0;
  if (w && w.reloading && T.reload && Array.isArray(T.reload[pose])) {
    const rf = (anim && anim.reloadFrame) ? 1 : 0;
    torso = T.reload[pose][rf] || null;
    // Reload: the gun is pulled in toward the chest so the magazine hand reads (WO2 integration).
    const ro = Array.isArray(T.reloadGunOffset) ? T.reloadGunOffset[rf] : null;
    if (ro) { offX = ro.x | 0; offY = ro.y | 0; }
  }
  // Walking with a free arm (onehand): arm-swing frame synced to the legs (WO2 integration).
  // Held while recoiling so the arm does not swing mid-shot.
  if ((!torso || !torso.pixels) && T.walk && Array.isArray(T.walk[pose]) && anim && anim.moving
      && !(anim.recoil > 0)) {
    const wf = T.walk[pose];
    torso = wf[(((anim.legFrame | 0) % wf.length) + wf.length) % wf.length] || null;
  }
  if (!torso || !torso.pixels) torso = (T.idle && (T.idle[pose] || T.idle.twohand)) || null;
  if (!torso || !torso.pixels) return null;
  const entry = getTorsoGun(torso, gun, pose, offX, offY);
  const scale = spriteScale();
  const aim = Number.isFinite(p.angle) ? p.angle : 0;
  let ox = 0, oy = 0;
  out.rx = 0; out.ry = 0;
  const recoil = anim && anim.recoil > 0 ? anim.recoil : 0;
  if (recoil > 0) {
    const rd = Number.isFinite(anim.recoilDir) ? anim.recoilDir : aim;
    ox -= Math.cos(rd) * recoil * scale;
    oy -= Math.sin(rd) * recoil * scale;
    if (gun && gun.weight > 1) {
      // Heavy guns also shake sideways (deterministic, from game time).
      const j = (hash(Math.floor((state.time || 0) * 60) + 31) * 2 - 1) * recoil * 0.35 * scale;
      ox += -Math.sin(rd) * j;
      oy += Math.cos(rd) * j;
    }
    out.rx = ox; out.ry = oy; // recoil part only (for the at-rest muzzle)
  }
  if (p.sprinting && (p.moving || (anim && anim.moving))) {
    // Sprint lean: torso 1 sprite px forward.
    ox += Math.cos(aim) * scale;
    oy += Math.sin(aim) * scale;
  }
  const si = Math.round(scale) || 1;
  out.ox = Math.round(ox / si) * si;
  out.oy = Math.round(oy / si) * si;
  out.entry = entry;
  out.x = Math.round(p.x) + out.ox;
  out.y = Math.round(p.y) + out.oy;
  out.angle = aim;
  out.qa = pixel.quantizeAngle(aim, spriteDirections());
  return out;
}

function muzzleFromPose(ps, out) {
  const scale = spriteScale();
  const c = Math.cos(ps.qa), s = Math.sin(ps.qa);
  const mx = ps.entry.mx * scale, my = ps.entry.my * scale;
  out.x = ps.x + mx * c - my * s;
  out.y = ps.y + mx * s + my * c;
  return out;
}

// World position of the held gun's muzzle for the current pose/aim/recoil (visual only; the
// gameplay hitscan origin is unchanged). Returns null when there is no player, the player is
// down, or the sprite modules are unavailable.
export function getMuzzleWorld(state) {
  try {
    const ps = resolveTorsoPose(state, poseScratch);
    if (!ps) return null;
    return muzzleFromPose(ps, { x: 0, y: 0 });
  } catch (_) {
    return null;
  }
}

const muzzleScratch = { x: 0, y: 0 };
const frameMuzzleRest = { x: 0, y: 0 }; // this frame's muzzle without the recoil kick
let downSince = null;  // wall-clock seconds when the current down was first drawn (blood pool growth)

function drawPlayer(state) {
  frameMuzzle = null;
  const p = state.player;
  if (!p) return;
  const S = soldierMod.SOLDIER;
  if (!S) { drawPlayerFallback(p); return; }
  const scale = spriteScale();
  const dirs = spriteDirections();
  // Wall-clock time: a down is game over, which freezes state.time, and the pool must still grow.
  const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  if (!p.down) downSince = null;
  try {
    if (p.down) {
      // Lying sprite, unrotated, on a pixel-art blood pool that grows over ~1 s.
      if (downSince == null || downSince > t) downSince = t;
      drawBloodPool(p.x, p.y, t - downSince, scale);
      const d = S.down;
      if (d && d.sprite && d.sprite.pixels) {
        const a = d.anchor || { x: d.sprite.w / 2, y: d.sprite.h / 2 };
        drawCrisp(d.sprite, p.x, p.y, 0, 0, 0, a.x, a.y, scale, dirs);
      } else drawPlayerFallback(p);
      return;
    }
    // Shadow
    const sh = S.shadow || { rx: 7, ry: 5 };
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x + 1, p.y + 3, sh.rx * scale, sh.ry * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    // Legs: movement direction (aim when standing still)
    const L = S.legs;
    if (L && Array.isArray(L.frames) && L.frames.length) {
      const n = L.frames.length;
      const fi = anim ? (((anim.legFrame | 0) % n) + n) % n : 0;
      const fr = L.frames[fi] || L.frames[0];
      if (fr && fr.pixels) {
        const la = anim && Number.isFinite(anim.legAngle) ? anim.legAngle : (p.angle || 0);
        const ax = L.anchor ? L.anchor.x : fr.w / 2, ay = L.anchor ? L.anchor.y : fr.h / 2;
        drawCrisp(fr, p.x, p.y, 0, 0, la, ax, ay, scale, dirs);
      }
    }
    // Torso + gun (+ helmet on top): aim direction, one composed sprite
    const ps = resolveTorsoPose(state, poseScratch);
    if (!ps) return;
    const e = ps.entry;
    drawCrisp(e.sprite, p.x, p.y, ps.ox, ps.oy, ps.angle, e.ax, e.ay, scale, dirs);
    frameMuzzle = muzzleFromPose(ps, muzzleScratch);
    frameMuzzleRest.x = frameMuzzle.x - ps.rx;
    frameMuzzleRest.y = frameMuzzle.y - ps.ry;
  } catch (_) {
    drawPlayerFallback(p);
  }
}

// Downed blood pool as pixel art (FIX-2, visual #12): a ragged 'r'/'R' blob on the sprite
// pixel grid, pre-built in POOL_STEPS growth stages and drawn at integer scale.
const POOL_W = 30, POOL_H = 26, POOL_STEPS = 10, POOL_GROW_TIME = 1.0;
const poolStages = new Array(POOL_STEPS).fill(null);

function poolSprite(stage) {
  let sp = poolStages[stage];
  if (sp) return sp;
  const grow = (stage + 1) / POOL_STEPS;
  const cx = POOL_W / 2, cy = POOL_H / 2 + 1;
  const rows = [];
  for (let y = 0; y < POOL_H; y++) {
    let row = '';
    for (let x = 0; x < POOL_W; x++) {
      const vx = (x + 0.5 - cx) / (POOL_W / 2 - 1);
      const vy = (y + 0.5 - cy) / (POOL_H / 2 - 1.5);
      const d = Math.hypot(vx, vy);
      const ang = Math.atan2(vy, vx);
      // Lobed, ragged edge: low-frequency lobes plus a per-pixel nibble.
      const edge = grow * (0.8 + 0.1 * Math.sin(3 * ang + 0.7) + 0.07 * Math.sin(5 * ang + 2.3)
        + 0.05 * Math.sin(8 * ang + 4.1)) + (hash(x * 31 + y * 57 + 7) - 0.5) * 0.08;
      let ch = '.';
      if (d < edge) {
        // Wet highlight toward the upper left, a few bright flecks inside.
        const hx = vx + 0.3, hy = vy + 0.35;
        if (hx * hx + hy * hy < 0.05 * grow * grow) ch = 'R';
        else if (d < edge * 0.7 && hash(x * 13 + y * 101 + 3) > 0.93) ch = 'R';
        else ch = 'r';
      } else if (grow > 0.55 && d < edge + 0.22 && hash(x * 71 + y * 29 + 11) > 0.9) {
        ch = 'r'; // satellite drops just past the rim
      }
      row += ch;
    }
    rows.push(row);
  }
  sp = pixel.parseGrid(rows);
  poolStages[stage] = sp;
  return sp;
}

function drawBloodPool(x, y, age, scale) {
  const f = Math.max(0, Math.min(1, (age > 0 ? age : 0) / POOL_GROW_TIME));
  const grow = 0.3 + 0.7 * (1 - (1 - f) * (1 - f)); // ease-out from 30 % to full size
  const stage = Math.max(0, Math.min(POOL_STEPS - 1, Math.ceil(grow * POOL_STEPS) - 1));
  const sp = poolSprite(stage);
  const s = Math.max(1, Math.round(scale));
  ctx.save();
  ctx.globalAlpha = 0.92;
  if (canMakeCanvas()) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixel.toCanvas(sp, s), Math.round(x) - (POOL_W / 2) * s, Math.round(y) - (POOL_H / 2) * s);
  } else {
    pixel.drawSprite(ctx, sp, x, y, { scale: s, angle: 0, ax: POOL_W / 2, ay: POOL_H / 2, directions: 0 });
  }
  ctx.restore();
}

// v1 circle look, used only if the sprite modules are missing or throw.
function drawPlayerFallback(p) {
  const r = p.radius || 14;
  const a = p.angle || 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.down) ctx.globalAlpha = 0.6;
  ctx.save();
  ctx.rotate(a);
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(r * 0.3, -3, r + 10, 6);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = p.down ? '#8a6060' : COLORS.player;
  ctx.fill();
  ctx.restore();
}

// True when an effect origin (x, y) is close enough to the player to start at the drawn muzzle.
function nearPlayer(x, y) {
  if (!frameMuzzle || !animPlayer) return false;
  const dx = x - animPlayer.x, dy = y - animPlayer.y;
  return dx * dx + dy * dy <= MUZZLE_SNAP_DIST * MUZZLE_SNAP_DIST;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function drawEffectsOfType(state, type, view) {
  const list = state.effects;
  if (!Array.isArray(list) || !list.length) return;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.type !== type) continue;
    switch (type) {
      case 'blood': drawBlood(e, view, i); break;
      case 'tracer': drawTracer(e); break;
      case 'muzzle': drawMuzzle(e, view); break;
      case 'explosion': drawExplosion(e, view); break;
      case 'shockwave': drawShockwave(e, view); break;
      case 'doorOpen': drawDoorOpen(e, view); break;
      case 'text': drawText(e, view); break;
      default: break;
    }
  }
}

function drawBlood(e, view, i) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 30)) return;
  const f = lifeFrac(e);
  const seed = (e.seed != null ? e.seed : Math.floor(e.x * 7.31 + e.y * 3.17));
  // zombie.js sets radius (7 hit / 18 death) and big (death decal). Integrator: honor both.
  const R = Number.isFinite(e.radius) && e.radius > 0 ? e.radius : 7;
  const big = !!e.big;
  const spread = big ? R * (0.6 + Math.min(1, (1 - f) * 8) * 0.5) : (R * 0.55 + (1 - f) * R * 1.4);
  ctx.globalAlpha = big ? Math.min(0.85, f * 2) : Math.min(1, f * 1.2);
  ctx.fillStyle = COLORS.blood;
  ctx.beginPath();
  ctx.arc(e.x, e.y, big ? R * 0.7 : 3 + (1 - f) * 3, 0, Math.PI * 2);
  ctx.fill();
  const drops = big ? 9 : 5;
  for (let k = 0; k < drops; k++) {
    const ang = hash(seed + k * 13) * Math.PI * 2;
    const d = spread * (0.4 + hash(seed + k * 29) * 0.8);
    const rr = (big ? 2.5 : 1.2) + hash(seed + k * 41) * (big ? 4 : 2.2);
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const TRACER_MIN_AHEAD = 3; // world px a snapped tracer must extend past the muzzle
function drawTracer(e) {
  if (!(Number.isFinite(e.x0) && Number.isFinite(e.y0) && Number.isFinite(e.x1) && Number.isFinite(e.y1))) return;
  let x0 = e.x0, y0 = e.y0;
  if (nearPlayer(x0, y0)) {
    // FIX-2 (review #4): the drawn muzzle is 24-42 px ahead of the hitscan origin. If the hit
    // point is not ahead of it along the shot, skip the tracer (the muzzle flash covers it)
    // rather than drawing it backwards into the soldier.
    const tx = e.x1 - e.x0, ty = e.y1 - e.y0;
    const len = Math.hypot(tx, ty);
    const ahead = len > 0 ? ((e.x1 - frameMuzzle.x) * tx + (e.y1 - frameMuzzle.y) * ty) / len : 0;
    if (ahead <= TRACER_MIN_AHEAD) return;
    x0 = frameMuzzle.x; y0 = frameMuzzle.y;
  }
  const f = lifeFrac(e);
  ctx.globalAlpha = f;
  ctx.strokeStyle = COLORS.tracer;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(e.x1, e.y1);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawMuzzle(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 30)) return;
  const a = Number.isFinite(e.angle) ? e.angle
    : (Number.isFinite(e.dirX) && Number.isFinite(e.dirY) ? Math.atan2(e.dirY, e.dirX) : 0);
  const f = lifeFrac(e);
  const snap = nearPlayer(e.x, e.y);
  ctx.save();
  ctx.translate(snap ? frameMuzzle.x : e.x, snap ? frameMuzzle.y : e.y);
  ctx.rotate(a);
  ctx.globalAlpha = f;
  ctx.fillStyle = '#fff2b0';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(14, 0);
  ctx.lineTo(0, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = e.color || 'rgba(255,200,80,0.6)';
  ctx.globalAlpha = f * 0.6;
  ctx.beginPath();
  ctx.arc(2, 0, (e.size || 9) * 0.66, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawExplosion(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  const R = Number.isFinite(e.radius) && e.radius > 0 ? e.radius : 90;
  if (!inView(view, e.x, e.y, R)) return;
  const f = lifeFrac(e);
  const col = e.color || COLORS.powerupGlow;
  ctx.save();
  ctx.globalAlpha = f * 0.45;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(e.x, e.y, R * (0.4 + 0.6 * (1 - f)), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = f;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(e.x, e.y, R * (0.5 + 0.5 * (1 - f)), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const SHOCK_ARCS = [[1, 7, '#ffffff', 0.85], [0.8, 5, '#3ec9ff', 0.6], [0.58, 3, '#dff6ff', 0.4]];
// Thundergun blast: 3 expanding arcs clipped to the cone plus dust specks; reaches `range` at ttl 0.
function drawShockwave(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  const range = Number.isFinite(e.range) && e.range > 0 ? e.range : 480;
  if (!inView(view, e.x, e.y, range)) return;
  const half = Number.isFinite(e.halfAngle) && e.halfAngle > 0 ? Math.min(e.halfAngle, Math.PI) : 0.52;
  const ang = Number.isFinite(e.angle) ? e.angle
    : (Number.isFinite(e.dirX) && Number.isFinite(e.dirY) ? Math.atan2(e.dirY, e.dirX) : 0);
  // FIX-2 (review #5): the apex sits on the drawn gun muzzle when the blast starts at the player,
  // and the cone is shortened by the muzzle's lead so its front still ends at the gameplay range.
  // The apex is latched on the first drawn frame (e.apexX/apexY), so the cone stays put in the
  // world if the player moves while it expands.
  if (e.apexX === undefined) {
    const snap = nearPlayer(e.x, e.y);
    // At-rest muzzle: the blast is latched on the recoil frame, but the gun returns forward.
    e.apexX = snap ? frameMuzzleRest.x : e.x;
    e.apexY = snap ? frameMuzzleRest.y : e.y;
  }
  const x = Number.isFinite(e.apexX) ? e.apexX : e.x, y = Number.isFinite(e.apexY) ? e.apexY : e.y;
  const lead = (x - e.x) * Math.cos(ang) + (y - e.y) * Math.sin(ang);
  const reach = Math.max(1, range - Math.max(0, lead));
  const f = lifeFrac(e);            // 1 -> 0
  const prog = 1 - f;               // 0 -> 1
  const R = reach * (1 - (1 - prog) * (1 - prog)); // ease-out, exactly the range at ttl 0
  if (R <= 1) return;
  ctx.save();
  // Clip to the cone
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, range + 12, ang - half, ang + half);
  ctx.closePath();
  ctx.clip();
  // Faint pressure fill behind the front
  ctx.globalAlpha = 0.18 * f;
  ctx.fillStyle = '#bfefff';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, R, ang - half, ang + half);
  ctx.closePath();
  ctx.fill();
  // Expanding arcs (front is brightest)
  ctx.lineCap = 'round';
  for (let i = 0; i < SHOCK_ARCS.length; i++) {
    const arc = SHOCK_ARCS[i];
    const k = arc[0], lw = arc[1], col = arc[2], al = arc[3];
    const r = R * k;
    if (r <= 2) continue;
    ctx.globalAlpha = al * f;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x, y, r, ang - half - 0.2, ang + half + 0.2);
    ctx.stroke();
  }
  // Dust specks carried by the front
  const seed = Math.floor(e.x * 3.7 + e.y * 1.3);
  ctx.fillStyle = '#b8a888';
  for (let k = 0; k < 14; k++) {
    const a = ang + (hash(seed + k * 7) * 2 - 1) * half;
    const d = R * (0.35 + hash(seed + k * 11) * 0.65);
    const sz = 1.5 + hash(seed + k * 17) * 2.5;
    ctx.globalAlpha = 0.7 * f;
    ctx.fillRect(x + Math.cos(a) * d - sz / 2, y + Math.sin(a) * d - sz / 2, sz, sz);
  }
  ctx.restore();
}

// WO4 2.4: door opening burst. A soft light flash over the doorway plus 12 grey dust/debris
// specks thrown out to both sides, slowing and fading over the 0.6 s life. Deterministic per door.
function drawDoorOpen(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 120)) return;
  const f = lifeFrac(e);
  const p = 1 - f;
  const len = Number.isFinite(e.len) && e.len > 0 ? e.len : TILE * 2;
  const vert = e.axis === 'v';
  ctx.save();
  // Light flash (strongest in the first third of the life)
  const fa = Math.max(0, 1 - p * 3);
  if (fa > 0) {
    // Soft radial glow stretched along the doorway (unit gradient scaled into an ellipse).
    const rw = (vert ? TILE : len) * 0.5 + 18 * p + 10;
    const rh = (vert ? len : TILE) * 0.5 + 18 * p + 10;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(rw, rh);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, 'rgba(255,244,220,0.75)');
    gr.addColorStop(0.5, 'rgba(255,236,200,0.35)');
    gr.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.globalAlpha = fa;
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Dust / debris specks
  const seed = (Number(e.doorId) || 0) * 31 + Math.floor(e.x + e.y);
  const ease = 1 - (1 - p) * (1 - p);
  for (let k = 0; k < 12; k++) {
    const along = (hash(seed + k * 11) - 0.5) * len;      // spread along the doorway
    const side = k % 2 ? 1 : -1;                          // thrown to both sides
    const dist = (14 + hash(seed + k * 17) * 30) * ease;
    const drift = (hash(seed + k * 23) - 0.5) * 16 * ease;
    const sx = vert ? e.x + side * dist : e.x + along + drift;
    const sy = vert ? e.y + along + drift : e.y + side * dist;
    const g = 120 + Math.round(hash(seed + k * 29) * 70);
    const sz = 2 + hash(seed + k * 37) * 2.5;
    ctx.globalAlpha = Math.min(1, f * 1.6) * 0.9;
    ctx.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
    ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
  }
  ctx.restore();
}

function drawText(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 60)) return;
  const f = lifeFrac(e);
  const y = e.y - TEXT_RISE * (1 - f);
  ctx.save();
  ctx.globalAlpha = f;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  const s = String(e.text != null ? e.text : '');
  ctx.strokeText(s, e.x, y);
  ctx.fillStyle = e.color || COLORS.hudPoints;
  ctx.fillText(s, e.x, y);
  ctx.restore();
}

const shakeScratch = { x: 0, y: 0 };
function shakeOffset(state, t) {
  const list = state.effects;
  let mag = 0;
  if (Array.isArray(list)) {
    for (const e of list) {
      if (e && e.type === 'shake' && e.ttl > 0) {
        const m = (Number.isFinite(e.magnitude) ? e.magnitude : 8) * lifeFrac(e);
        if (m > mag) mag = m;
      }
    }
  }
  const out = shakeScratch;
  if (mag <= 0) { out.x = 0; out.y = 0; return out; }
  const k = Math.floor(t * 60);
  out.x = (hash(k) * 2 - 1) * mag;
  out.y = (hash(k + 999) * 2 - 1) * mag;
  return out;
}

// ---------------------------------------------------------------------------
// Screen-space overlays
// ---------------------------------------------------------------------------

// Overlays are elliptical edge vignettes drawn in a unit space (-1..1 on both axes), so the
// centre of the screen stays clear at any aspect ratio. Phase 4 (#5): the flat Zombie Blood tint
// is much subtler than the config's 25% and the damage vignette is capped, so both together stay
// readable. See docs/notes/render.md "Phase 4 fixes".
const ZB_FLAT_TINT = RENDER.zombieBloodTint;
const DAMAGE_VIGNETTE_MAX = RENDER.damageVignetteMax;
const DAMAGE_WITH_ZB_MULT = RENDER.damageWithZbMult;

function getVignettes() {
  if (vignette) return vignette;
  const red = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1.3);
  red.addColorStop(0, 'rgba(170,0,0,0)');
  red.addColorStop(0.45, 'rgba(160,0,0,0.25)');
  red.addColorStop(1, 'rgba(110,0,0,0.9)');
  const orange = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 1.35);
  orange.addColorStop(0, 'rgba(255,120,30,0)');
  orange.addColorStop(0.5, 'rgba(240,100,25,0.12)');
  orange.addColorStop(1, 'rgba(200,70,15,0.36)');
  vignette = { red, orange };
  return vignette;
}

function fillUnitVignette(grad, W, H, alpha) {
  ctx.save();
  ctx.setTransform(W / 2, 0, 0, H / 2, W / 2, H / 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function zombieBloodActive(state) {
  const until = state.powerups && state.powerups.active && state.powerups.active.zombieBlood;
  return typeof until === 'number' && until > (state.time || 0);
}

function drawZombieBloodTint(state, W, H) {
  if (!zombieBloodActive(state)) return;
  ctx.fillStyle = ZB_FLAT_TINT;
  ctx.fillRect(0, 0, W, H);
  fillUnitVignette(getVignettes().orange, W, H, 1);
}

function drawDamageVignette(state, W, H) {
  const p = state.player;
  if (!p || !(p.maxHealth > 0)) return;
  let a = 1 - Math.max(0, Math.min(1, (p.health || 0) / p.maxHealth));
  if (a <= 0.01) return;
  a *= DAMAGE_VIGNETTE_MAX;
  if (zombieBloodActive(state)) a *= DAMAGE_WITH_ZB_MULT;
  fillUnitVignette(getVignettes().red, W, H, a);
}

function drawFlash(state, W, H) {
  const list = state.effects;
  if (!Array.isArray(list)) return;
  let a = 0;
  for (const e of list) if (e && e.type === 'flash') a = Math.max(a, lifeFrac(e));
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

function drawDebugWorld(state, view) {
  const map = state.map;
  // Flow field arrows
  if (state.flow && typeof pathfindingMod.getFlowDir === 'function') {
    ctx.strokeStyle = 'rgba(80,200,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const tx0 = Math.max(0, Math.floor(view.x / TILE)), ty0 = Math.max(0, Math.floor(view.y / TILE));
    const tx1 = Math.min((map.cols || 0) - 1, Math.floor((view.x + view.w) / TILE));
    const ty1 = Math.min((map.rows || 0) - 1, Math.floor((view.y + view.h) / TILE));
    try {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
          const d = pathfindingMod.getFlowDir(state.flow, cx, cy);
          if (!d || (d.x === 0 && d.y === 0)) continue;
          const ex = cx + d.x * 14, ey = cy + d.y * 14;
          ctx.moveTo(cx - d.x * 6, cy - d.y * 6);
          ctx.lineTo(ex, ey);
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - d.x * 5 - d.y * 4, ey - d.y * 5 + d.x * 4);
        }
      }
    } catch (_) { /* pathfinding not ready */ }
    ctx.stroke();
  }
  // Zombie modes
  if (Array.isArray(state.zombies)) {
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#9ff';
    for (const z of state.zombies) {
      if (!z || !inView(view, z.x, z.y, 40)) continue;
      ctx.fillText(`${z.mode || '?'} ${Math.max(0, Math.round(z.hp || 0))}`, z.x, z.y - (z.radius || 14) - 3);
    }
  }
}

function drawDebugScreen(state) {
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = [
    `FPS ${fps.toFixed(0)}`,
    `zombies ${Array.isArray(state.zombies) ? state.zombies.length : 0}`,
    `effects ${Array.isArray(state.effects) ? state.effects.length : 0}`,
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(canvas.width - 150, 8, 142, lines.length * 15 + 8);
  ctx.fillStyle = '#9ff';
  lines.forEach((l, i) => ctx.fillText(l, canvas.width - 144, 12 + i * 15));
}
