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
import * as zombieArt from './sprites/zombie.js'; // WO7 T1 (Agent A): ZOMBIE_SPRITES, zombieSpriteFor

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
const T_ARENA = 8, T_STAIRS = 9; // WO5 3.1: arena minion spawn (floor), staircase (solid until opened)
const T_PERK = 10; // WO7 T2: perk machine (blocking, like a wall buy)
const T_PAP = 11;  // WO8: Pack-a-Punch machine (blocking, like a perk machine)
const T_PIT = 12;  // WO9: '~' ice hole / water channel (blocks movers, not rays; never drawn as wall)
const DOOR_FX_TTL = 0.6;
const DOOR_SHAKE = { ttl: 0.35, magnitude: 3 };
// WO5 3.6 tunables (config RENDER; local fallbacks keep older configs working)
const BOSS_START_SHAKE = RENDER.bossStartShake || { ttl: 0.9, magnitude: 10 };
const BOSS_DEATH_SHAKE = RENDER.bossDeathShake || { ttl: 0.8, magnitude: 12 };
const BOSS_DEATH_FLASH = RENDER.bossDeathFlash || { ttl: 0.4, maxTtl: 0.65 };   // starts at ~60 % white
const MEGA_SHAKE = RENDER.megaDoorShake || { ttl: 0.6, magnitude: 5 };
// FIX-3 (review I3): zombie.js owns the boss blood pool (a 'blood' effect with boss:true, drawn
// here as the big lobed pool); render's own 'bossDeath' effect is only the short shock ring.
const BOSS_RING_TTL = RENDER.bossRingTtl ?? 0.6;
const BOSS_SCALE = RENDER.bossScale ?? 2.4, MINION_SCALE = RENDER.minionScale ?? 0.7;

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
  unsubs.push(events.on('game:restart', () => { pending = []; resetAnim(); zTrack.clear(); papAnim.weapon = null; papAnim.readyAt = -1; }));
  unsubs.push(events.on('weapon:fired', onWeaponFired));
  unsubs.push(events.on('purchase:made', onPurchaseMade));
  unsubs.push(events.on('boss:start', onBossStart));
  unsubs.push(events.on('zombie:killed', onZombieKilled));
  unsubs.push(events.on('pap:done', onPapDone)); // WO8: sparkle burst at the machine
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
  const zoom = state.zoom > 0 ? state.zoom : 1;
  const view = viewScratch;
  view.x = camX; view.y = camY; view.w = W / zoom; view.h = H / zoom;

  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);

  // ---- world space ----
  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  const theme = themeOf(state);
  papStateCode = papCodeOf(state);
  drawStaticLayer(map, view, theme);
  if (theme.style === 'temple') drawTempleWater(view, t, theme);   // WO9: ripples on the water channels
  if (theme.torch) { if (theme.style === 'kino') drawKinoLamps(view, now, theme); else drawTorches(view, now); }
  drawBarricades(map, view);
  drawBox(state, map, t);
  drawPap(state, map, t, view);         // WO8: Pack-a-Punch glow, gun sliding in, sparks, tray gun
  drawEffectsOfType(state, 'blood', view);
  drawHazards(state, view, t);          // WO7 T5: acid pools on the floor
  // FIX-3 (playtest #1): power-ups above every blood decal so the boss's Max Ammo stays visible.
  drawPowerups(state, t, view);
  drawBossAbilitiesFloor(state, view, t); // WO9: frost cone / tide ring (under the crowd)
  drawZombies(state, view);
  drawBossAbilitiesFx(state, view, t);    // WO9: icy glow + mist, water swirl
  drawBullets(state);
  drawAcidGlobs(state, view);           // WO7 T5: lobbed globs (state.acidGlobs) in flight
  drawPlayer(state);
  drawPlayerFrost(state, now);          // WO9: frost-slowed player (ice crystals + glow)
  drawEffectsOfType(state, 'slash', view); // WO7 T3: knife arc
  drawLabelsOverPlayer(state);
  drawBoxLabel(state, map, t);
  drawEffectsOfType(state, 'bossDeath', view);
  drawEffectsOfType(state, 'tracer', view);
  drawEffectsOfType(state, 'muzzle', view);
  drawEffectsOfType(state, 'shockwave', view);
  drawEffectsOfType(state, 'explosion', view);
  drawEffectsOfType(state, 'doorOpen', view);
  drawEffectsOfType(state, 'papSparkle', view);
  sealedMegaBox = map.megaDoor && map.megaDoor.sealed ? doorBox(map.megaDoor) : null;
  drawEffectsOfType(state, 'text', view);
  if (state.debug) drawDebugWorld(state, view);

  ctx.restore();

  // ---- screen space ----
  drawAmbient(theme, W, H);
  if (theme.style) drawStyleOverlay(theme, W, H, view, zoom, now); // WO9: film grain / snowfall / spores
  if (theme.flicker) drawFlicker(t, W, H); // WO7 T5: failing fluorescent tubes (LABORATORY)
  drawZombieBloodTint(state, W, H);
  drawDamageVignette(state, W, H);
  drawFrostVignette(state, W, H);       // WO9: frosty screen edges while slowed
  drawFlash(state, W, H);
  drawTransition(state, W, H);
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
    text: '+' + p.delta, color: COLORS.hudPoints, ttl: TEXT_TTL, maxTtl: TEXT_TTL, pts: p.delta,
  });
}

// FIX-1 (playtest #12): a points popup spawned within RENDER.textMergeTime s of another one and
// within textMergeDist px of it (knife kill +10 at the zombie, +5 bonus at the player, chained
// kills) is folded into that popup as one accumulating "+N". The popup keeps its current
// on-screen height and restarts its life, so it does not jump. Returns true when merged.
const TEXT_MERGE_TIME = RENDER.textMergeTime ?? 0.3;
const TEXT_MERGE_DIST = RENDER.textMergeDist ?? 44;
function mergePointsPopup(state, e) {
  const list = state.effects;
  if (!Array.isArray(list)) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (!o || o.type !== 'text' || !(o.pts > 0) || o.color !== e.color) continue;
    const age = (o.maxTtl || TEXT_TTL) - o.ttl;
    if (age > TEXT_MERGE_TIME) continue;
    const dx = o.x - e.x, dy = o.y - e.y;
    if (dx * dx + dy * dy > TEXT_MERGE_DIST * TEXT_MERGE_DIST) continue;
    const f = lifeFrac(o);
    o.y -= TEXT_RISE * (1 - f); // keep the drawn position when the life restarts
    o.pts += e.pts;
    o.text = '+' + o.pts;
    o.ttl = o.maxTtl = TEXT_TTL;
    return true;
  }
  return false;
}

function onPlayerDamaged(p) {
  // WO7 INT: acid pools deal damage as per-frame ticks (< 1 HP); no screen shake for those.
  if (p && Number.isFinite(p.amount) && p.amount < 1) return;
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
  if (p && p.kind === 'megadoor') {
    pending.push({ type: 'shake', ttl: MEGA_SHAKE.ttl, maxTtl: MEGA_SHAKE.ttl, magnitude: MEGA_SHAKE.magnitude });
    return;
  }
  if (!p || p.kind !== 'door') return;
  pending.push({ type: 'doorOpen', doorId: p.id, ttl: DOOR_FX_TTL, maxTtl: DOOR_FX_TTL });
  pending.push({ type: 'shake', ttl: DOOR_SHAKE.ttl, maxTtl: DOOR_SHAKE.ttl, magnitude: DOOR_SHAKE.magnitude });
}

// WO5 3.6: boss:start -> shake 10.
function onBossStart() {
  pending.push({ type: 'shake', ttl: BOSS_START_SHAKE.ttl, maxTtl: BOSS_START_SHAKE.ttl, magnitude: BOSS_START_SHAKE.magnitude });
}

// WO5 3.6: the boss's zombie:killed (start of its 2 s dying linger) -> shock ring, white flash and
// a heavy shake. The pool itself is zombie.js's boss blood effect (FIX-3, review I3: no duplicate).
function onZombieKilled(p) {
  const z = p && p.zombie;
  if (!z || z.kind !== 'boss') return;
  const x = Number.isFinite(p.x) ? p.x : z.x, y = Number.isFinite(p.y) ? p.y : z.y;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    pending.push({ type: 'bossDeath', x, y, r: (z.radius || ZOMBIE.radius * BOSS_SCALE) * 2.1, ttl: BOSS_RING_TTL, maxTtl: BOSS_RING_TTL });
  }
  pending.push({ type: 'flash', ttl: BOSS_DEATH_FLASH.ttl, maxTtl: BOSS_DEATH_FLASH.maxTtl });
  pending.push({ type: 'shake', ttl: BOSS_DEATH_SHAKE.ttl, maxTtl: BOSS_DEATH_SHAKE.ttl, magnitude: BOSS_DEATH_SHAKE.magnitude });
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
    if (e.type === 'papSparkle' && !placePapEffect(state, e)) continue;
    if (e.type === 'text' && e.pts > 0 && mergePointsPopup(state, e)) continue;
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
    case 'bossDeath': return BOSS_RING_TTL;
    case 'papSparkle': return PAP_SPARKLE_TTL;
    case 'slash': return (CFG.MELEE && CFG.MELEE.swingTime) || 0.25;
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

function isSolidCode(c) { return c === T_WALL || c === T_WALLBUY || c === T_BOX || c === T_WINDOW || c === T_PERK || c === T_PAP; }

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
// WO5 3.6: the key also carries the level id + theme signature (a level swap or theme change
// repaints) and a small integer of mega-door / stairs flags (a seal/unseal/open repaints even
// without a version bump). The memo check compares identities and ints only: no per-frame allocs.
let staticKeyMemo = { map: null, version: 0, theme: null, flags: -1, pap: -1, key: '' };
// WO8: Pack-a-Punch state painted into the layer (0 none / 1 idle / 2 working / 3 ready), set by
// render() from state.shop.pap.state before the static layer is fetched.
let papStateCode = 0;
function staticKey(map, theme) {
  const ver = Number.isFinite(map.version) ? map.version : 0;
  const flags = featureFlags(map);
  if (staticKeyMemo.map === map && staticKeyMemo.version === ver && staticKeyMemo.theme === theme &&
      staticKeyMemo.flags === flags && staticKeyMemo.pap === papStateCode) return staticKeyMemo.key;
  const W = weaponsMod && weaponsMod.WEAPONS;
  const n = W ? Object.keys(W).length : 0;
  const art = gunArtKey();
  const key = n + ':' + (map.cols || 0) + 'x' + (map.rows || 0) + ':' + art + ':v' + ver +
    ':L' + (map.levelId != null ? map.levelId : '') + ':T' + theme.sig + ':f' + flags + ':pap' + papStateCode;
  if (n > 0 && art === 'gunart') staticKeyMemo = { map, version: ver, theme, flags, pap: papStateCode, key };
  return key;
}

// Mega door / stairs state as an int (0 when the map has neither).
function featureFlags(map) {
  const md = map.megaDoor, st = map.stairs;
  let f = 0;
  if (md) f |= 1 | (md.open ? 2 : 0) | (md.sealed ? 4 : 0);
  if (st) f |= 8 | (st.open ? 16 : 0);
  // WO7 T2: perk machines (count in bits 5-9, sold-out mask from bit 10) so a sell-out repaints.
  const pm = map.perkMachines;
  if (Array.isArray(pm) && pm.length) {
    f |= (Math.min(31, pm.length) << 5);
    for (let i = 0; i < pm.length && i < 20; i++) if (pm[i] && pm[i].soldOut) f |= (1 << (10 + i));
  }
  return f;
}

// ---------------------------------------------------------------------------
// Themes (WO5 3.6)
// ---------------------------------------------------------------------------

// Fallback = the WO4 look (COLORS + the WO4 door panel colours): a map without a theme is unchanged.
const WO4_DOOR_WOOD = '#3e2412', WO4_DOOR_IRON = '#2b2d31', WO4_ACCENT = '#9aa0a8';
let defaultTheme = null;
const themeCache = new WeakMap(); // raw theme object -> resolved theme
function resolveTheme(raw) {
  if (!raw || typeof raw !== 'object') {
    if (!defaultTheme) defaultTheme = buildTheme({});
    return defaultTheme;
  }
  let t = themeCache.get(raw);
  if (!t) { t = buildTheme(raw); themeCache.set(raw, t); }
  return t;
}
function buildTheme(raw) {
  const str = (v, d) => (typeof v === 'string' && v ? v : d);
  const floor = str(raw.floor, COLORS.floor);
  const t = {
    name: str(raw.name, ''),
    floor,
    floorAlt: str(raw.floorAlt, floor),
    wall: str(raw.wall, COLORS.wall),
    wallEdge: str(raw.wallEdge, COLORS.wallEdge),
    accent: str(raw.accent, WO4_ACCENT),
    doorWood: str(raw.doorWood, WO4_DOOR_WOOD),
    doorIron: str(raw.doorIron, WO4_DOOR_IRON),
    ambient: str(raw.ambient, null),   // null / '' = no tint
    torch: !!raw.torch,
    flicker: !!raw.flicker, // WO7 T5: failing fluorescent tubes (screen pass only, not in sig)
    // FIX-1 (#5): 'panel' = steel panels + glass-tank decor blocks + door hazard stripes. An
    // explicit raw.wallStyle wins; otherwise any LABORATORY theme (incl. loop names) gets panels.
    wallStyle: raw.wallStyle === 'panel' || raw.wallStyle === 'brick' ? raw.wallStyle
      : (/LABORATORY/i.test(str(raw.name, '')) ? 'panel' : 'brick'),
    // WO9: 'kino' | 'outpost' | 'temple' | '' (raw.style, else the name prefix; loop themes drop style).
    style: resolveStyle(raw),
  };
  t.hints = styleHints(raw, t.style);
  // A theme with a distinct floorAlt gets the checker, accent flecks and wall brickwork. Level 1
  // (floorAlt = floor) therefore keeps the flat WO4 look exactly.
  t.textured = t.floorAlt.toLowerCase() !== t.floor.toLowerCase();
  t.sig = [t.name, t.floor, t.floorAlt, t.wall, t.wallEdge, t.accent, t.doorWood, t.doorIron, t.torch ? 1 : 0, t.wallStyle, t.style, t.hints ? t.hints.sig : ''].join('|');
  return t;
}
// map.theme first (map.js 3.1), then the level def (state.level.def.theme), else the WO4 look.
// Note: mutating a theme object in place is not picked up (resolved themes are cached per object);
// assign a new object instead.
function themeOf(state) {
  const map = state.map;
  const raw = (map && map.theme) || (state.level && state.level.def && state.level.def.theme) || null;
  return resolveTheme(raw);
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

function getStaticLayer(map, theme) {
  const key = staticKey(map, theme);
  if (staticLayer && staticLayer.map === map && staticLayer.key === key) return staticLayer.canvas;
  if (typeof document === 'undefined') return null;
  const width = map.width || (map.cols || 0) * TILE;
  const height = map.height || (map.rows || 0) * TILE;
  if (!(width > 0 && height > 0)) return null;
  const oc = document.createElement('canvas');
  oc.width = width; oc.height = height;
  const c = oc.getContext('2d');
  labelRects = [];
  try { paintStatic(c, map, width, height, theme); } finally {
    staticLayer = { canvas: oc, map, key, torches: theme.torch ? findTorches(map) : [], labels: labelRects,
      pits: findPits(map), cols: map.cols || Math.round(width / TILE) };
    labelRects = null;
    styleNoTorch = null;
    styleNoEdge = null;
  }
  return oc;
}

function paintStatic(c, map, width, height, theme) {
  const cols = map.cols || Math.round(width / TILE);
  const rows = map.rows || Math.round(height / TILE);
  const th = theme || resolveTheme(null);

  // Floor (WO5: theme floor, plus a floorAlt checker and accent flecks when the theme has one)
  c.fillStyle = th.floor;
  c.fillRect(0, 0, width, height);
  styleNoTorch = null;
  styleNoEdge = null;
  if (th.style) paintStyleFloor(c, map, th, cols, rows); // WO9: carpet / snow / flagstones
  else {
  if (th.textured) {
    c.fillStyle = th.floorAlt;
    for (let ty = 0; ty < rows; ty++) for (let tx = (ty & 1); tx < cols; tx += 2) c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
  }
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
  if (th.textured) paintFloorFlecks(c, th, cols, rows);
  }
  // WO5: the boss arena floor is slightly darker.
  paintArenaFloor(c, map, cols);
  // Grid (WO9 styles carry their own tile pattern)
  if (!th.style) {
    c.strokeStyle = 'rgba(255,255,255,0.04)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= width; x += TILE) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, height); }
    for (let y = 0; y <= height; y += TILE) { c.moveTo(0, y + 0.5); c.lineTo(width, y + 0.5); }
    c.stroke();
  }

  // Spawn pockets, open spawns, window frames
  if (map.tiles) {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const code = map.tiles[ty * cols + tx];
        const x = tx * TILE, y = ty * TILE;
        if (code === T_POCKET) {
          c.fillStyle = '#0a0a0c';
          c.fillRect(x, y, TILE, TILE);
        } else if (code === T_OPEN && th.style === 'outpost') {
          paintSnowHole(c, x, y, ty * cols + tx);  // FIX-2 (WO9 QA OUTPOST #9)
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
        } else if (code === T_ARENA) {
          // Minion spawn: faint scratched ring on the arena floor.
          c.strokeStyle = 'rgba(150,30,30,0.28)';
          c.lineWidth = 2;
          c.beginPath();
          c.arc(x + TILE / 2, y + TILE / 2, TILE * 0.32, 0, Math.PI * 2);
          c.stroke();
          c.lineWidth = 1;
        }
      }
    }
  }

  // WO9: pits ('~') per theme; never walls (no brick, no wall edge of their own).
  if (map.tiles) paintPits(c, map, th, cols);

  // Walls: prefer merged rects, fall back to tiles
  const rects = Array.isArray(map.walls) && map.walls.length ? map.walls : null;
  c.fillStyle = th.wall;
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
  if (th.style) paintStyleWalls(c, map, th, cols, rows); // WO9: wood + curtains + seats / rock, huts, fences / sandstone
  else if (th.wallStyle === 'panel') paintLabWalls(c, map, th, cols, rows);
  else if (th.textured) paintBrickwork(c, map, th, cols, rows);
  // Edges: draw per-tile edges only where a wall borders a non-solid tile (clean outlines)
  if (map.tiles) {
    c.strokeStyle = th.wallEdge;
    c.lineWidth = 1;
    c.beginPath();
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const code = map.tiles[ty * cols + tx];
        if (code !== T_WALL && code !== T_WALLBUY) continue;
        if (styleNoEdge && styleNoEdge.has(ty * cols + tx)) continue;
        const x = tx * TILE, y = ty * TILE;
        if (!isSolidCode(tileAt(map, tx, ty - 1)) || tileAt(map, tx, ty - 1) === T_WINDOW) { c.moveTo(x, y + 0.5); c.lineTo(x + TILE, y + 0.5); }
        if (!isSolidCode(tileAt(map, tx, ty + 1)) || tileAt(map, tx, ty + 1) === T_WINDOW) { c.moveTo(x, y + TILE - 0.5); c.lineTo(x + TILE, y + TILE - 0.5); }
        if (!isSolidCode(tileAt(map, tx - 1, ty)) || tileAt(map, tx - 1, ty) === T_WINDOW) { c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + TILE); }
        if (!isSolidCode(tileAt(map, tx + 1, ty)) || tileAt(map, tx + 1, ty) === T_WINDOW) { c.moveTo(x + TILE - 0.5, y); c.lineTo(x + TILE - 0.5, y + TILE); }
      }
    }
    c.stroke();
  } else if (rects) {
    c.strokeStyle = th.wallEdge;
    for (const r of rects) c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  if (th.style === 'temple') paintVines(c, map, th, cols, rows); // WO9: hanging vines over wall edges

  // Wall buys: chalk outline + name + price
  // FIX-1 (#3): their plates are tagged 'buy' so the over-player re-blit keeps the player visible.
  labelKind = 'buy';
  try {
    if (Array.isArray(map.wallBuys)) {
      for (const wb of map.wallBuys) paintWallBuy(c, map, wb);
    }
    // WO7 T2: perk machines (vending box + label plate on the floor side)
    paintPerkMachines(c, map);
    // WO8: Pack-a-Punch cabinet + "PACK-A-PUNCH" / cost plates (buy plates: 35 % over the player)
    paintPapMachine(c, map);
  } finally { labelKind = 'door'; }

  // WO4: closed doors (planks + iron bands + labels on both sides). Open doors are floor.
  paintDoors(c, map, cols, rows, th);
  // WO5: staircase (barred gate / open steps) and the mega door.
  paintStairs(c, map, th, cols, rows);
  paintMegaDoor(c, map, th, cols);
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

function paintDoors(c, map, cols, rows, th) {
  const doors = Array.isArray(map.doors) ? map.doors : [];
  const covered = new Set();
  // WO5: mega door tiles are code 7 too; paintMegaDoor draws them (while not open).
  if (map.megaDoor && Array.isArray(map.megaDoor.tiles)) {
    for (const t of map.megaDoor.tiles) { const i = tileIndexOf(t, cols); if (i >= 0) covered.add(i); }
  }
  const labels = [];
  for (const d of doors) {
    if (!d || d.open) continue;
    const b = doorBox(d);
    if (!b) continue;
    if (Array.isArray(d.tiles)) for (const t of d.tiles) covered.add(t.ty * cols + t.tx);
    const axis = doorAxis(d, b);
    paintDoorPanel(c, b, axis, (d.id || 0) * 97, th);
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
        paintDoorPanel(c, { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, alongX ? 'h' : 'v', i, th);
      }
    }
  }
  // Labels last so no panel covers them.
  for (const [b, s, price] of labels) paintWallBuyLabel(c, b, b.w, b.h, s, 'OPEN DOOR', price);
}

// Heavy dark wooden planks running along the doorway, crossed by riveted iron bands.
// Painted in a local frame: u along the doorway (length L), v across it (depth D).
function paintDoorPanel(c, b, axis, seed, th) {
  const wood = th && th.doorWood !== WO4_DOOR_WOOD ? hexRgb(th.doorWood) : null; // null = WO4 planks
  const iron = th ? th.doorIron : WO4_DOOR_IRON;
  const rivet = th ? th.accent : WO4_ACCENT;
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
    if (wood) {
      const f = 0.85 + h * 0.35;
      c.fillStyle = `rgb(${Math.min(255, Math.round(wood[0] * f))},${Math.min(255, Math.round(wood[1] * f))},${Math.min(255, Math.round(wood[2] * f))})`;
    } else c.fillStyle = `rgb(${base + 16},${Math.round(base * 0.66)},${Math.round(base * 0.36)})`;
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
      c.fillStyle = iron;
      c.fillRect(u, 1, bandW, D - 2);
      c.fillStyle = 'rgba(160,165,172,0.35)';
      c.fillRect(u, 1, 1, D - 2);
      c.fillStyle = rivet;
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

// ---------------------------------------------------------------------------
// WO5 3.6: themed floor/walls, arena, torches, mega door, stairs (all static-layer painters
// except the torch flames, which are drawn per frame by drawTorches)
// ---------------------------------------------------------------------------

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Like shade() but always returns #rrggbb (so the result can be shaded again).
function shadeHex(hex, f) {
  const c = hexRgb(hex);
  if (!c) return hex;
  const h = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

// Tile reference -> tile index. Accepts {tx, ty}, {x, y} in tiles, or a bare index.
function tileIndexOf(t, cols) {
  if (typeof t === 'number') return t;
  if (t && Number.isFinite(t.tx) && Number.isFinite(t.ty)) return t.ty * cols + t.tx;
  return -1;
}

// Bone-white (theme accent) flecks scattered on the floor, deterministic per tile.
function paintFloorFlecks(c, th, cols, rows) {
  c.save();
  c.fillStyle = th.accent;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const h = hash(tx * 57.3 + ty * 911.7);
      if (h < 0.45) continue;
      const n = 1 + Math.floor(hash(h * 331 + tx) * 3);
      for (let k = 0; k < n; k++) {
        const fx = tx * TILE + 3 + Math.floor(hash(tx * 13 + ty * 7 + k * 3.1) * (TILE - 6));
        const fy = ty * TILE + 3 + Math.floor(hash(tx * 5 + ty * 17 + k * 7.7) * (TILE - 6));
        c.globalAlpha = 0.14 + hash(fx * 0.37 + fy) * 0.22;
        const sz = hash(fx + fy * 0.5) > 0.8 ? 3 : 2;
        c.fillRect(fx, fy, sz, hash(fy * 0.9 + k) > 0.6 ? 1 : sz);
      }
    }
  }
  c.restore();
}

// Arena floor: slightly darker (map.arenaTiles: Set or array of tile indices).
function paintArenaFloor(c, map, cols) {
  const at = map.arenaTiles;
  if (!at || !cols) return;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.3)';
  const paint = (i) => {
    if (!Number.isFinite(i)) return;
    c.fillRect((i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE);
  };
  if (typeof at.forEach === 'function') at.forEach((i) => paint(i));
  c.restore();
}

// Stone brickwork on wall tiles for textured themes (mortar lines, staggered per row).
function paintBrickwork(c, map, th, cols, rows) {
  if (!map.tiles) return;
  const bh = TILE / 3;
  c.save();
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = 1;
  c.beginPath();
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (map.tiles[ty * cols + tx] !== T_WALL) continue;
      const x = tx * TILE, y = ty * TILE;
      for (let r = 0; r < 3; r++) {
        const yy = Math.round(y + r * bh) + 0.5;
        c.moveTo(x, yy); c.lineTo(x + TILE, yy);
        const off = ((r + ty) & 1) ? TILE / 2 : TILE / 4;
        const xx = Math.round(x + off) + 0.5;
        c.moveTo(xx, yy); c.lineTo(xx, yy + bh);
      }
    }
  }
  c.stroke();
  // Faint lit specks of the edge colour so the stone reads as stone.
  c.fillStyle = th.wallEdge;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (map.tiles[ty * cols + tx] !== T_WALL) continue;
      const h = hash(tx * 3.3 + ty * 71.1);
      if (h < 0.5) continue;
      c.globalAlpha = 0.18 + (h - 0.5) * 0.3;
      c.fillRect(tx * TILE + Math.floor(h * 30) + 3, ty * TILE + Math.floor(hash(h * 91) * 30) + 3, 3, 2);
    }
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// FIX-1 (playtest #5): LABORATORY walls. Steel panels (seams, light top edge, corner rivets)
// instead of brick; free-standing decor blocks drawn as glass specimen tanks; yellow/black hazard
// stripes on the wall tiles either side of every door. Static layer only.
// ---------------------------------------------------------------------------
const LAB_TANK_MAX = RENDER.labTankMaxTiles ?? 6;

// Wall tiles in small free-standing clusters: connected groups of solid tiles (4-neighbour; any
// non-floor code except the mystery box connects) that do not touch the map border and hold at
// most LAB_TANK_MAX plain wall tiles. Returns a Set of tile indices (plain T_WALL tiles only).
function findDecorBlocks(map, cols, rows) {
  const out = new Set();
  const T = map.tiles;
  if (!T) return out;
  const conn = (code) => code != null && code !== T_FLOOR && code !== T_OPEN && code !== T_ARENA && code !== T_BOX && code !== T_PIT;
  const seen = new Uint8Array(cols * rows);
  const stack = [], comp = [];
  for (let i = 0; i < cols * rows; i++) {
    if (seen[i] || T[i] !== T_WALL) continue;
    stack.length = 0; comp.length = 0;
    stack.push(i); seen[i] = 1;
    let border = false, walls = 0;
    while (stack.length) {
      const j = stack.pop();
      const x = j % cols, y = (j / cols) | 0;
      if (T[j] === T_WALL) { comp.push(j); walls++; }
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) border = true;
      if (x > 0 && !seen[j - 1] && conn(T[j - 1])) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < cols - 1 && !seen[j + 1] && conn(T[j + 1])) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - cols] && conn(T[j - cols])) { seen[j - cols] = 1; stack.push(j - cols); }
      if (y < rows - 1 && !seen[j + cols] && conn(T[j + cols])) { seen[j + cols] = 1; stack.push(j + cols); }
    }
    if (!border && walls <= LAB_TANK_MAX) for (const j of comp) out.add(j);
  }
  return out;
}

function paintLabWalls(c, map, th, cols, rows) {
  if (!map.tiles) return;
  const tanks = findDecorBlocks(map, cols, rows);
  const edge = hexRgb(th.wallEdge) || [90, 125, 158];
  c.save();
  // Steel panels: a slightly lighter plate inset in every wall tile, lit top edge, rivets.
  const plate = shadeHex(th.wall, 1.22);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx;
      if (map.tiles[i] !== T_WALL || tanks.has(i)) continue;
      const x = tx * TILE, y = ty * TILE;
      c.fillStyle = plate;
      c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      c.fillStyle = `rgba(${edge[0]},${edge[1]},${edge[2]},0.22)`;
      c.fillRect(x + 1, y + 1, TILE - 2, 1);                 // lit top edge
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(x + 1, y + TILE - 2, TILE - 2, 1);          // shadowed bottom edge
      if (hash(tx * 7.7 + ty * 13.1) > 0.55) c.fillRect(x + 1, y + (TILE >> 1), TILE - 2, 1); // half seam
      c.fillStyle = `rgba(${edge[0]},${edge[1]},${edge[2]},0.55)`;
      c.fillRect(x + 3, y + 3, 2, 2); c.fillRect(x + TILE - 5, y + 3, 2, 2);
      c.fillRect(x + 3, y + TILE - 5, 2, 2); c.fillRect(x + TILE - 5, y + TILE - 5, 2, 2);
    }
  }
  // Seams between panels
  c.strokeStyle = 'rgba(0,0,0,0.5)';
  c.lineWidth = 1;
  c.beginPath();
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx;
      if (map.tiles[i] !== T_WALL || tanks.has(i)) continue;
      const x = tx * TILE, y = ty * TILE;
      c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + TILE);
      c.moveTo(x, y + 0.5); c.lineTo(x + TILE, y + 0.5);
    }
  }
  c.stroke();
  for (const i of tanks) paintGlassTank(c, (i % cols) * TILE, ((i / cols) | 0) * TILE, i);
  paintHazardStripes(c, map, tanks, cols);
  c.restore();
}

// One specimen tank seen from above: steel base plate, glass cylinder, liquid, a dark floating
// silhouette, bubbles, a highlight streak and a bright rim.
function paintGlassTank(c, x, y, seed) {
  const cx = x + TILE / 2, cy = y + TILE / 2, R = TILE / 2 - 3;
  c.save();
  c.fillStyle = '#1a232b';
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = '#3a4a58';
  c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  c.fillStyle = '#9fb3c4';
  c.fillRect(x + 3, y + 3, 2, 2); c.fillRect(x + TILE - 5, y + 3, 2, 2);
  c.fillRect(x + 3, y + TILE - 5, 2, 2); c.fillRect(x + TILE - 5, y + TILE - 5, 2, 2);
  // Glass body + liquid
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.fillStyle = 'rgba(150,240,220,0.35)';
  c.fill();
  c.save();
  c.clip();
  const lvl = y + 9 + Math.floor(hash(seed * 1.37) * 6); // liquid level line
  const g = c.createLinearGradient(0, lvl, 0, y + TILE);
  g.addColorStop(0, 'rgba(110,240,170,0.75)');
  g.addColorStop(1, 'rgba(30,140,110,0.85)');
  c.fillStyle = g;
  c.fillRect(x, lvl, TILE, TILE);
  c.fillStyle = 'rgba(210,255,230,0.8)';
  c.fillRect(x, lvl, TILE, 1);
  // Floating specimen
  const sx = cx + (hash(seed) - 0.5) * 4;
  c.fillStyle = 'rgba(20,50,40,0.55)';
  c.beginPath();
  c.ellipse(sx, cy + 3, 5, 7, (hash(seed * 3.1) - 0.5) * 0.8, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(sx, cy - 5, 3.5, 0, Math.PI * 2);
  c.fill();
  // Bubbles
  c.fillStyle = 'rgba(230,255,240,0.8)';
  for (let k = 0; k < 3; k++) c.fillRect(Math.round(cx - 7 + hash(seed * 5 + k) * 14), Math.round(lvl + 3 + hash(seed * 7 + k) * 14), 2, 2);
  // Highlight streak
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillRect(cx - R + 4, cy - R + 6, 2, R);
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.fillRect(cx - R + 7, cy - R + 5, 1, R - 4);
  c.restore();
  // Rim
  c.strokeStyle = 'rgba(200,255,245,0.85)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(10,30,30,0.7)';
  c.lineWidth = 1;
  c.beginPath();
  c.arc(cx, cy, R + 1.5, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

// Yellow/black diagonal stripes on a 12 px band of each plain wall tile at either end of a door
// (and the mega door), on the side nearest the doorway.
function paintHazardStripes(c, map, tanks, cols) {
  const list = Array.isArray(map.doors) ? map.doors.slice() : [];
  if (map.megaDoor) list.push(map.megaDoor);
  const BAND = 12;
  for (const d of list) {
    if (!d) continue;
    const b = doorBox(d);
    if (!b) continue;
    const axis = doorAxis(d, b);
    const bands = [];
    if (axis === 'h') {
      for (let y = b.y; y < b.y + b.h; y += TILE) {
        bands.push([b.x - TILE, y, b.x - BAND, y, BAND, TILE]);
        bands.push([b.x + b.w, y, b.x + b.w, y, BAND, TILE]);
      }
    } else {
      for (let x = b.x; x < b.x + b.w; x += TILE) {
        bands.push([x, b.y - TILE, x, b.y - BAND, TILE, BAND]);
        bands.push([x, b.y + b.h, x, b.y + b.h, TILE, BAND]);
      }
    }
    for (const [tx0, ty0, x, y, w, h] of bands) {
      const tx = Math.floor(tx0 / TILE), ty = Math.floor(ty0 / TILE);
      if (tileAt(map, tx, ty) !== T_WALL || tanks.has(ty * cols + tx)) continue;
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.fillStyle = '#16140c';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#f2c21b';
      c.beginPath();
      for (let k = -h; k < w + h; k += 10) {
        c.moveTo(x + k, y + h); c.lineTo(x + k + 5, y + h); c.lineTo(x + k + 5 + h, y); c.lineTo(x + k + h, y);
      }
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      c.restore();
    }
  }
}

// Torch positions: plain wall tiles that touch floor, every ~6 tiles along a wall run
// ((tx + 5*ty) % 6 === 0 hits every 6th tile on both horizontal and vertical runs).
// Deterministic from the tile index; computed once per static-layer build.
function findTorches(map) {
  const out = [];
  if (!map.tiles || !map.cols) return out;
  const cols = map.cols, rows = map.rows;
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if ((tx + 5 * ty) % 6 !== 0) continue;
      const i = ty * cols + tx;
      if (map.tiles[i] !== T_WALL) continue;
      if (styleNoTorch && styleNoTorch.has(i)) continue; // WO9: seats, curtains, fences, huts
      for (const [dx, dy] of dirs) {
        if (!isOpenFloorCode(tileAt(map, tx + dx, ty + dy))) continue;
        out.push({
          x: tx * TILE + TILE / 2 + dx * TILE * 0.32,
          y: ty * TILE + TILE / 2 + dy * TILE * 0.32,
          dx, dy, seed: hash(i * 1.37) * 100,
        });
        break;
      }
    }
  }
  return out;
}

// Local drawing frame over box b: u runs along the doorway (length L), v across it (depth D),
// with v = 0 on the `front` side ({dx, dy}). Mirrored frames are fine: no text is drawn in them.
function applyFrontFrame(c, b, axis, front) {
  if (axis === 'v') {
    if (front && front.dx > 0) c.transform(0, 1, -1, 0, b.x + b.w, b.y);
    else c.transform(0, 1, 1, 0, b.x, b.y);
  } else if (front && front.dy > 0) c.transform(1, 0, 0, -1, b.x, b.y + b.h);
  else c.transform(1, 0, 0, 1, b.x, b.y);
}

function labelSides(axis) {
  return axis === 'v' ? [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }] : [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
}

// Single-line plate beside box b on `side` (same placement rules as paintWallBuyLabel).
function paintPlate(c, b, side, text, fg, bg, border) {
  c.save();
  c.font = 'bold 13px monospace';
  const tw = c.measureText(text).width;
  const plateW = Math.ceil(tw + 12), plateH = 19, gap = 3;
  let px, py;
  if (side.dy === 1) { px = b.x + b.w / 2 - plateW / 2; py = b.y + b.h + gap; }
  else if (side.dy === -1) { px = b.x + b.w / 2 - plateW / 2; py = b.y - gap - plateH; }
  else if (side.dx === 1) { px = b.x + b.w + gap; py = b.y + b.h / 2 - plateH / 2; }
  else { px = b.x - gap - plateW; py = b.y + b.h / 2 - plateH / 2; }
  px = Math.round(px); py = Math.round(py);
  if (labelRects) labelRects.push({ x: px, y: py, w: plateW, h: plateH, buy: labelKind === 'buy' });
  c.fillStyle = bg;
  roundRect(c, px, py, plateW, plateH, 3);
  c.fill();
  c.strokeStyle = border;
  c.lineWidth = 1;
  roundRect(c, px + 0.5, py + 0.5, plateW - 1, plateH - 1, 3);
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = fg;
  c.fillText(text, px + plateW / 2, py + plateH / 2 + 0.5);
  c.restore();
}

// Mega door: a tall riveted iron door. Frame posts stick out past both ends of the doorway and a
// few px past the wall faces, riveted plates per tile, cross braces, an upright skull plate in the
// middle; "MEGA DOOR" + cost labels while buyable, red "SEALED" plates while sealed. Not drawn
// once open (its tiles are floor then).
function paintMegaDoor(c, map, th) {
  const md = map.megaDoor;
  if (!md || md.open) return;
  const b = doorBox(md);
  if (!b) return;
  const axis = doorAxis(md, b);
  const sealed = !!md.sealed;
  const L = axis === 'v' ? b.h : b.w;
  const D = axis === 'v' ? b.w : b.h;
  const iron = th.doorIron;
  const ext = 7, over = 4;
  c.save();
  if (axis === 'v') { c.translate(b.x + b.w, b.y); c.rotate(Math.PI / 2); } else c.translate(b.x, b.y);
  // Backing + frame (posts + lintels) in dark iron.
  c.fillStyle = '#060505';
  c.fillRect(-ext, -over, L + ext * 2, D + over * 2);
  c.fillStyle = shadeHex(iron, 0.75);
  c.fillRect(-ext, -over, ext + 2, D + over * 2);
  c.fillRect(L - 2, -over, ext + 2, D + over * 2);
  c.fillRect(-ext, -over, L + ext * 2, 3);
  c.fillRect(-ext, D + over - 3, L + ext * 2, 3);
  c.fillStyle = th.accent;
  for (const u of [-ext / 2 - 1, L + ext / 2 - 1]) {
    for (let v = 2; v < D; v += 8) c.fillRect(u, v, 2, 2);
  }
  // Plates, one per tile.
  const n = Math.max(1, Math.round(L / TILE));
  const step = L / n;
  for (let k = 0; k < n; k++) {
    const u0 = Math.round(k * step) + 2, pw = Math.round(step) - 4;
    c.fillStyle = shadeHex(iron, 1.05 + hash(k * 3.7 + 1) * 0.3);
    c.fillRect(u0, 2, pw, D - 4);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fillRect(u0, 2, pw, 1);
    c.fillRect(u0, 2, 1, D - 4);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(u0, D - 3, pw, 1);
    c.fillRect(u0 + pw - 1, 2, 1, D - 4);
    // Rust streaks
    c.fillStyle = 'rgba(120,50,20,0.25)';
    c.fillRect(u0 + Math.floor(hash(k * 9.1) * (pw - 4)) + 2, 3, 2, Math.floor(D * 0.6));
    // Rivet rows along both long edges
    c.fillStyle = th.accent;
    for (let u = u0 + 3; u < u0 + pw - 2; u += 7) { c.fillRect(u, 4, 2, 2); c.fillRect(u, D - 6, 2, 2); }
  }
  // Cross braces over the whole door
  c.strokeStyle = shadeHex(iron, 0.6);
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(3, 4); c.lineTo(L - 3, D - 4);
  c.moveTo(3, D - 4); c.lineTo(L - 3, 4);
  c.stroke();
  if (sealed) {
    // Glowing red locking bar along the door
    c.fillStyle = 'rgba(40,0,0,0.9)';
    c.fillRect(-ext + 2, D / 2 - 4, L + ext * 2 - 4, 8);
    c.fillStyle = '#b01818';
    c.fillRect(-ext + 3, D / 2 - 2.5, L + ext * 2 - 6, 5);
    c.fillStyle = 'rgba(255,120,120,0.6)';
    c.fillRect(-ext + 3, D / 2 - 2.5, L + ext * 2 - 6, 1);
  }
  c.restore();
  // Skull plate, always upright.
  const cx = Number.isFinite(md.cx) ? md.cx : b.x + b.w / 2;
  const cy = Number.isFinite(md.cy) ? md.cy : b.y + b.h / 2;
  paintSkullPlate(c, cx, cy, Math.max(10, Math.min(D, 44) * 0.46), th, sealed);
  // Labels (on a box grown by the frame overhang so plates clear the posts/lintels)
  const lb = axis === 'v'
    ? { x: b.x - over, y: b.y, w: b.w + over * 2, h: b.h }
    : { x: b.x, y: b.y - over, w: b.w, h: b.h + over * 2 };
  const price = Number.isFinite(md.cost) ? String(md.cost)
    : (CFG.DOORS && Number.isFinite(CFG.DOORS.megaCost) ? String(CFG.DOORS.megaCost) : '');
  // FIX-2 (WO9 QA TEMPLE #5 / OUTPOST #10 / KINO #6): mega door plates (SEALED on the arena side
  // at the boss start) are re-blitted over the player at the 35 % buy-plate alpha.
  const prevKind = labelKind;
  labelKind = 'buy';
  try {
    for (const s of labelSides(axis)) {
      if (sealed) paintPlate(c, lb, s, 'SEALED', '#ffe0e0', 'rgba(110,8,8,0.94)', '#ff5a5a');
      else paintWallBuyLabel(c, lb, lb.w, lb.h, s, 'MEGA DOOR', price);
    }
  } finally { labelKind = prevKind; }
}

function paintSkullPlate(c, x, y, R, th, sealed) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  // Round iron plate with a rim of rivets
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.fillStyle = sealed ? '#3a0c0c' : shadeHex(th.doorIron, 0.7);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#050404';
  c.stroke();
  c.fillStyle = th.accent;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    c.fillRect(Math.cos(a) * (R - 3) - 1, Math.sin(a) * (R - 3) - 1, 2, 2);
  }
  // Skull
  const s = R * 0.62;
  const bone = '#d9d0b8';
  c.fillStyle = bone;
  c.beginPath();
  c.arc(0, -s * 0.18, s * 0.72, 0, Math.PI * 2);
  c.fill();
  c.fillRect(-s * 0.42, s * 0.2, s * 0.84, s * 0.5);
  c.fillStyle = sealed ? '#ff2a1a' : '#120c0c';
  c.beginPath();
  c.arc(-s * 0.3, -s * 0.12, s * 0.2, 0, Math.PI * 2);
  c.arc(s * 0.3, -s * 0.12, s * 0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#120c0c';
  c.beginPath();
  c.moveTo(0, s * 0.08); c.lineTo(-s * 0.1, s * 0.28); c.lineTo(s * 0.1, s * 0.28); c.closePath();
  c.fill();
  for (let k = -1; k <= 1; k++) c.fillRect(k * s * 0.22 - 0.5, s * 0.42, 1, s * 0.28);
  c.restore();
}

// Which side of the stairs faces the arena: {dx, dy}. Counts arena tiles (else walkable floor)
// in the row/column just outside each long side of the run.
function stairsFront(map, b, axis) {
  const cols = map.cols || 0;
  const tx0 = Math.floor(b.x / TILE), ty0 = Math.floor(b.y / TILE);
  const tx1 = Math.floor((b.x + b.w - 1) / TILE), ty1 = Math.floor((b.y + b.h - 1) / TILE);
  const at = map.arenaTiles;
  const has = at && typeof at.has === 'function' ? (i) => at.has(i) : null;
  const score = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= cols || ty >= (map.rows || 0)) return 0;
    if (has && has(ty * cols + tx)) return 2;
    return isOpenFloorCode(tileAt(map, tx, ty)) ? 1 : 0;
  };
  let a = 0, z = 0;
  if (axis === 'v') {
    for (let ty = ty0; ty <= ty1; ty++) { a += score(tx0 - 1, ty); z += score(tx1 + 1, ty); }
    return z > a ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
  }
  for (let tx = tx0; tx <= tx1; tx++) { a += score(tx, ty0 - 1); z += score(tx, ty1 + 1); }
  return z > a ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
}

// Staircase: closed = barred iron gate in a stone frame; open = dark steps descending away from
// the arena, with a "DESCEND" plate on the arena side. Stray code-9 tiles (no map.stairs) get a
// one-tile gate.
function paintStairs(c, map, th, cols, rows) {
  const st = map.stairs;
  const covered = new Set();
  if (st) {
    if (Array.isArray(st.tiles)) for (const t of st.tiles) { const i = tileIndexOf(t, cols); if (i >= 0) covered.add(i); }
    const b = doorBox(st);
    if (b) {
      const axis = doorAxis(st, b);
      const front = stairsFront(map, b, axis);
      if (st.open) {
        paintStepsOpen(c, b, axis, front, th);
        paintPlate(c, b, front, 'DESCEND', '#ffd27a', 'rgba(14,9,4,0.92)', '#c98a2a');
      } else paintBarredGate(c, b, axis, front, th);
    }
  }
  if (!map.tiles) return;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx;
      if (map.tiles[i] !== T_STAIRS || covered.has(i)) continue;
      const b = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      const l = tileAt(map, tx - 1, ty), r = tileAt(map, tx + 1, ty);
      const axis = (isSolidCode(l) || l === T_STAIRS || isSolidCode(r) || r === T_STAIRS) ? 'h' : 'v';
      paintBarredGate(c, b, axis, stairsFront(map, b, axis), th);
    }
  }
}

function paintStepsOpen(c, b, axis, front, th) {
  const L = axis === 'v' ? b.h : b.w;
  const D = axis === 'v' ? b.w : b.h;
  const stone = hexRgb(shadeHex(th.floor, 2.8)) || [110, 104, 96];
  c.save();
  applyFrontFrame(c, b, axis, front);
  c.fillStyle = '#030203';
  c.fillRect(0, 0, L, D);
  const n = 5;
  const sh = D / n;
  for (let k = 0; k < n; k++) {
    const f = 1 - k / n;                         // nearer steps are lighter
    const v0 = k * sh;
    const inset = 2 + k * 1.2;                   // the stairwell narrows as it descends
    c.fillStyle = `rgb(${Math.round(stone[0] * f)},${Math.round(stone[1] * f)},${Math.round(stone[2] * f)})`;
    c.fillRect(inset, v0, L - inset * 2, sh - 1);
    c.fillStyle = `rgba(255,235,200,${(0.22 * f).toFixed(3)})`; // worn lip
    c.fillRect(inset, v0, L - inset * 2, 1);
    c.fillStyle = 'rgba(0,0,0,0.55)';                           // riser shadow
    c.fillRect(inset, v0 + sh - 2, L - inset * 2, 1);
  }
  const g = c.createLinearGradient(0, 0, 0, D);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.7)');
  c.fillStyle = g;
  c.fillRect(0, 0, L, D);
  // Stone side walls
  c.fillStyle = shadeHex(th.wallEdge, 0.8);
  c.fillRect(0, 0, 2, D);
  c.fillRect(L - 2, 0, 2, D);
  c.restore();
}

function paintBarredGate(c, b, axis, front, th) {
  const L = axis === 'v' ? b.h : b.w;
  const D = axis === 'v' ? b.w : b.h;
  c.save();
  applyFrontFrame(c, b, axis, front);
  // Dark stairwell glimpsed behind the bars
  c.fillStyle = '#040303';
  c.fillRect(0, 0, L, D);
  c.fillStyle = 'rgba(70,60,50,0.35)';
  for (let k = 0; k < 3; k++) c.fillRect(3, D * 0.3 + k * D * 0.2, L - 6, 1);
  // Stone frame
  c.fillStyle = shadeHex(th.wallEdge, 0.9);
  c.fillRect(0, 0, L, 3);
  c.fillRect(0, 0, 3, D);
  c.fillRect(L - 3, 0, 3, D);
  // Vertical bars (across the doorway) + two cross bars
  const bar = shadeHex(th.doorIron, 1.4);
  for (let u = 6; u < L - 4; u += 7) {
    c.fillStyle = bar;
    c.fillRect(u, 2, 3, D - 3);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(u, 2, 1, D - 3);
  }
  c.fillStyle = shadeHex(th.doorIron, 1.1);
  c.fillRect(3, D * 0.28, L - 6, 3);
  c.fillRect(3, D * 0.68, L - 6, 3);
  c.fillStyle = th.accent;
  for (let u = 7; u < L - 4; u += 7) { c.fillRect(u, D * 0.28 + 0.5, 1.5, 1.5); c.fillRect(u, D * 0.68 + 0.5, 1.5, 1.5); }
  c.restore();
  // Padlock at the centre (upright)
  const x = Math.round(b.x + b.w / 2), y = Math.round(b.y + b.h / 2);
  c.save();
  c.strokeStyle = '#8a8f96';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(x, y - 3, 4, Math.PI, 0);
  c.stroke();
  c.fillStyle = '#b08a2a';
  c.fillRect(x - 5, y - 3, 10, 8);
  c.fillStyle = '#1a1206';
  c.fillRect(x - 1, y, 2, 3);
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

// ---------------------------------------------------------------------------
// WO7 T2: perk machines. map.perkMachines = [{ id, perkId, tx, ty, x, y, w, h, soldOut }] (map.js,
// Agent G). Painted into the static layer: a tall vending box in PERKS.list[perkId].color seen
// from above/front (dark cabinet sides, coloured front with a glowing panel and a bottle glyph,
// the perk letter on a cap), plus a name / price plate on every open floor side (wall-buy label
// helper). Sold out: the cabinet goes dark and the plate reads "SOLD OUT".
// ---------------------------------------------------------------------------

function perkDef(id) {
  const L = CFG.PERKS && CFG.PERKS.list;
  return (L && id != null && L[id]) || null;
}

function paintPerkMachines(c, map) {
  const list = map.perkMachines;
  if (!Array.isArray(list) || !list.length) return;
  const plates = [];
  for (const m of list) {
    if (!m) continue;
    try { paintPerkMachine(c, map, m, plates); } catch (_) { /* malformed entry: skip */ }
  }
  // Labels after every cabinet so a neighbouring box never covers a plate.
  for (const pl of plates) paintWallBuyLabel(c, pl.b, pl.b.w, pl.b.h, pl.side, pl.name, pl.price, pl.sold);
}

function perkBox(m) {
  const w = m.w > 0 ? m.w : TILE, h = m.h > 0 ? m.h : TILE;
  const x = Number.isFinite(m.x) ? m.x : (m.tx | 0) * TILE;
  const y = Number.isFinite(m.y) ? m.y : (m.ty | 0) * TILE;
  return { x, y, w, h };
}

function paintPerkMachine(c, map, m, plates) {
  const def = perkDef(m.perkId);
  const b = perkBox(m);
  const tx = Number.isFinite(m.tx) ? m.tx : Math.floor((b.x + b.w / 2) / TILE);
  const ty = Number.isFinite(m.ty) ? m.ty : Math.floor((b.y + b.h / 2) / TILE);
  const sold = !!m.soldOut;
  const base = def && typeof def.color === 'string' && hexRgb(def.color) ? def.color : '#888888';
  const col = sold ? shadeHex(base, 0.28) : base;
  const letter = def && def.letter ? String(def.letter) : '?';
  // Floor sides (where the player stands): the machine's front faces the first one.
  const sides = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }]
    .filter((s) => isOpenFloorCode(tileAt(map, tx + s.dx, ty + s.dy)));
  if (!sides.length) sides.push({ dx: 0, dy: 1 });
  const front = sides[0];

  const rot = Math.atan2(front.dy, front.dx) - Math.PI / 2;
  // FIX-1 (#10): a tall vending cabinet. When the tile behind is wall, the cabinet's top rises
  // ext px into it so the silhouette is taller than one floor tile.
  const back = tileAt(map, tx - front.dx, ty - front.dy);
  const ext = back === T_WALL ? 8 : 0;

  c.save();
  // Recess / wall behind the cabinet
  c.fillStyle = '#0c0c0f';
  c.fillRect(b.x, b.y, b.w, b.h);
  // Work in a local frame where the front faces +y (down), centred on the tile.
  c.translate(b.x + b.w / 2, b.y + b.h / 2);
  c.rotate(rot);
  const W = (front.dx ? b.h : b.w) - 4, H = (front.dx ? b.w : b.h) - 2;
  const x0 = -W / 2, y1 = H / 2, y0 = -H / 2 - ext;
  const Ht = y1 - y0;
  const [r0, g0, b0] = hexRgb(base);
  // Glow spilling onto the floor in front (baked, soft)
  if (!sold) {
    const g = c.createRadialGradient(0, y1 + 4, 2, 0, y1 + 4, W * 0.95);
    g.addColorStop(0, `rgba(${r0},${g0},${b0},0.42)`);
    g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
    c.fillStyle = g;
    c.fillRect(-W, y1 - 2, W * 2, W);
  }
  // Drop shadow on the back wall, then the dark cabinet frame
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(x0 + 2, y0 + 2, W, Ht);
  c.fillStyle = shadeHex(col, 0.28);
  c.fillRect(x0, y0, W, Ht);
  // Body in the perk colour, darker side trims (depth)
  c.fillStyle = col;
  c.fillRect(x0 + 2, y0 + 2, W - 4, Ht - 3);
  c.fillStyle = shadeHex(col, 0.6);
  c.fillRect(x0 + 2, y0 + 2, 3, Ht - 3);
  c.fillRect(x0 + W - 5, y0 + 2, 3, Ht - 3);
  // Lit top sign (the machine's marquee) in the perk colour, with a bulb row
  const signH = 6 + Math.round(ext * 0.5);
  const sx0 = x0 + 3, sw = W - 6, sy0 = y0 + 2;
  c.fillStyle = sold ? '#1a1a1f' : shadeHex(base, 1.6);
  if (!sold) { c.shadowColor = base; c.shadowBlur = 10; }
  c.fillRect(sx0, sy0, sw, signH);
  c.shadowBlur = 0;
  c.fillStyle = sold ? '#24242a' : 'rgba(255,255,255,0.75)';
  c.fillRect(sx0 + 1, sy0 + 1, sw - 2, 1);
  if (!sold) {
    c.fillStyle = 'rgba(255,250,220,0.95)';
    for (let bx = sx0 + 3; bx < sx0 + sw - 2; bx += 5) c.fillRect(bx, sy0 + signH - 2, 2, 1);
  }
  c.fillStyle = shadeHex(col, 0.3);
  c.fillRect(sx0, sy0 + signH, sw, 1);
  // Logo panel with the big perk letter (upright in screen space)
  const pw = W - 10, ph = 14 + Math.round(ext * 0.5);
  const px = -pw / 2, py = sy0 + signH + 2;
  c.fillStyle = sold ? '#15151a' : shadeHex(base, 1.3);
  c.fillRect(px, py, pw, ph);
  c.fillStyle = sold ? '#1d1d22' : 'rgba(255,255,255,0.45)';
  c.fillRect(px + 1, py + 1, pw - 2, 1);
  c.strokeStyle = shadeHex(col, 0.35);
  c.lineWidth = 1;
  c.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  const upright = (lx, ly, fn) => { c.save(); c.translate(lx, ly); c.rotate(-rot); fn(); c.restore(); };
  upright(0, py + ph / 2 + 0.5, () => {
    c.font = 'bold 15px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 2.5;
    c.strokeStyle = sold ? '#101014' : shadeHex(base, 0.3);
    c.strokeText(letter, 0, 0);
    c.fillStyle = sold ? '#3a3a40' : '#fffaf0';
    c.fillText(letter, 0, 0);
  });
  // Dispenser alcove with a bottle standing in it (upright in screen space)
  const ah = Math.min(12, y1 - 2 - (py + ph + 2));
  const aw = 12, ay = y1 - 2 - ah;
  c.fillStyle = '#0b0b0d';
  c.fillRect(-aw / 2 - 3, ay, aw, ah);
  c.fillStyle = shadeHex(col, 0.45);
  c.fillRect(-aw / 2 - 3, ay, aw, 1);
  upright(-3, ay + ah / 2, () => {
    c.fillStyle = sold ? '#2a2a30' : shadeHex(base, 0.75);
    c.fillRect(-2, -1, 5, 6);   // bottle body
    c.fillRect(-1, -3, 3, 2);   // shoulder
    c.fillRect(0, -5, 1, 2);    // neck
    c.fillStyle = sold ? '#26262c' : '#f4f4ea';
    c.fillRect(-2, 1, 5, 2);    // label band
  });
  // Coin slot on a small steel plate, right of the alcove
  const cx = aw / 2 - 1, cw = W / 2 - 3 - cx;
  if (cw >= 4) {
    c.fillStyle = sold ? '#2a2a2e' : '#b9bec4';
    c.fillRect(cx, ay + 1, cw, 7);
    c.fillStyle = '#16161a';
    c.fillRect(cx + Math.floor(cw / 2) - 0.5, ay + 2, 1, 4);
    c.fillStyle = sold ? '#3a1414' : '#ff5a3a';
    c.fillRect(cx + 1, ay + ah - 3, 2, 2); // "insert coin" LED
  }
  // Outline
  c.strokeStyle = '#0b0b0d';
  c.lineWidth = 1;
  c.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, Ht - 1);
  c.restore();

  const name = (def && def.name ? def.name : String(m.perkId || 'PERK')).toUpperCase();
  // FIX-1: shop.syncPerkMachines sets m.price (escalating Quick Revive 50/150/300) and bumps map.version.
  const cost = Number.isFinite(m.price) ? m.price : (def && Number.isFinite(def.cost) ? def.cost : null);
  const price = sold ? 'SOLD OUT' : (cost != null ? String(cost) : '');
  for (const s of sides) plates.push({ b, side: s, name, price, sold });
}

// ---------------------------------------------------------------------------
// Pack-a-Punch (WO8, Agent D): cabinet (static layer), dynamic glow / gun in-out / sparks,
// pap:done sparkle burst, and the purple-and-gold camo on upgraded held guns.
// ---------------------------------------------------------------------------

const PAP_SPARKLE_TTL = 0.9;
const PAP_SLIDE_TIME = 0.6;   // s for the gun to slide into the feed slot
const PAP_PURPLE = '#b44dff', PAP_GOLD = '#ffd54a';
// Camo ramps (dark -> light). Metals/greys/olive -> violet, wood/tan -> gold.
const PAP_VIOLET = [[36, 12, 60], [68, 22, 114], [108, 42, 180], [156, 82, 234], [212, 168, 255]];
const PAP_GOLDS = [[106, 70, 8], [168, 120, 24], [224, 176, 48], [255, 224, 120]];
const PAP_SMALL_W = 14; // FIX-B: sprites narrower than this use the bright small-gun camo
const papAnim = { weapon: null, state: '', start: 0, readyAt: -1 }; // tracks the gun currently inside (slide timing)
const PAP_READY_FLASH = 0.35; // WO8 FIX-B: gold flash at working -> ready

// 0 no machine, 1 idle, 2 working, 3 ready (part of the static-layer key).
function papCodeOf(state) {
  const map = state.map;
  if (!map || !map.pap) return 0;
  const st = state.shop && state.shop.pap && state.shop.pap.state;
  return st === 'working' ? 2 : st === 'ready' ? 3 : 1;
}

// weapons.isUpgraded (Agent A) when present, else the w.upgraded / w.def.upgraded flags.
function isUpgradedWeapon(w) {
  if (!w) return false;
  try { if (typeof weaponsMod.isUpgraded === 'function') return !!weaponsMod.isUpgraded(w); } catch (_) { /* sibling mid-rewrite */ }
  return w.upgraded === true || !!(w.def && w.def.upgraded === true);
}

// The base (un-upgraded) def, so an upgraded def without sprite/id fields still finds its art.
function baseDefOf(w, def) {
  const id = (def && def.baseId) || (w && w.id);
  return weaponDef(id) || def;
}

// Deterministic camo recolour of a gun sprite. 'k' outline (and any near-black) is kept; greys,
// steel and olive become violet by brightness with 2-px diagonal stripes (+1 / 0 / -1 tone) and
// sparse gold flecks; brown / tan / wood becomes gold; saturated energy colours (ray gun green,
// thundergun cyan, blood red) stay, the purple accent turns gold. Cached per sprite (key 'pap').
function papSprite(sp) {
  let m = tintCache.get(sp);
  if (!m) { m = new Map(); tintCache.set(sp, m); }
  let out = m.get('pap');
  if (out) return out;
  // WO8 FIX-B (playtest #7): small sprites (pistols, w < PAP_SMALL_W) read dark with the full
  // ramp, so they get a light violet base (ramp steps 2-4 only) with alternating gold stripes.
  const small = sp.w < PAP_SMALL_W;
  out = pixel.tint(sp, (r, g, b, a, x, y) => {
    if (!a) return null;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 24) return null; // outline
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    const sat = mx - mn;
    const band = ((x + y) >> 1) % 3; // x, y >= 0
    if (r > b + 40 && r >= g && g > b) { // brown / tan / wood / blond
      let i = Math.min(3, Math.floor((lum / 256) * 4) + (band === 0 ? 1 : 0));
      const c = PAP_GOLDS[i];
      return [c[0], c[1], c[2], a];
    }
    if (sat >= 100) {
      if (r > 150 && b > 200 && g < 110) { const c = PAP_GOLDS[3]; return [c[0], c[1], c[2], a]; } // 'p' -> gold
      return null; // energy colours keep their identity
    }
    let i = Math.min(4, Math.floor((lum / 256) * 5));
    if (small) {
      if (band === 0) { const c = PAP_GOLDS[i >= 2 ? 3 : 2]; return [c[0], c[1], c[2], a]; }
      i = Math.max(2, Math.min(4, i + (band === 1 ? 2 : 1)));
      const c = PAP_VIOLET[i];
      return [c[0], c[1], c[2], a];
    }
    if (band === 0) i = Math.min(4, i + 1);
    else if (band === 2) i = Math.max(0, i - 1);
    if (i >= 2 && (x * 5 + y * 3) % 13 === 0) { const c = PAP_GOLDS[2]; return [c[0], c[1], c[2], a]; }
    const c = PAP_VIOLET[i];
    return [c[0], c[1], c[2], a];
  });
  if (m.size > 8) m.clear();
  m.set('pap', out);
  return out;
}

// Gun entry (sprite + grip/muzzle/pose) with the camo sprite, one per base entry.
const papGunCache = new WeakMap();
function papGunEntry(gun) {
  if (!gun || !gun.sprite || !gun.sprite.pixels) return gun;
  let e = papGunCache.get(gun);
  if (!e || e.base !== gun.sprite) {
    e = Object.assign({}, gun, { sprite: papSprite(gun.sprite) });
    e.base = gun.sprite;
    papGunCache.set(gun, e);
  }
  return e;
}

// Pre-rendered soft glows (additive).
const papGlows = {};
function papGlow(kind) {
  if (papGlows[kind] !== undefined || typeof document === 'undefined') return papGlows[kind] || null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgb = kind === 'gold' ? '255,200,70' : '180,77,255';
  grad.addColorStop(0, `rgba(${rgb},0.85)`);
  grad.addColorStop(0.35, `rgba(${rgb},0.4)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  papGlows[kind] = c;
  return c;
}
function blitGlow(kind, x, y, r, alpha) {
  const gl = papGlow(kind);
  if (!gl || !(alpha > 0) || !(r > 0)) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(gl, x - r, y - r, r * 2, r * 2);
}

// Faint pulsing purple glow around the held upgraded gun (between the hand and the muzzle).
function drawPapGunGlow(ps, muzzle, t) {
  if (!muzzle) return;
  const cx = ps.x + (muzzle.x - ps.x) * 0.6, cy = ps.y + (muzzle.y - ps.y) * 0.6;
  const len = Math.hypot(muzzle.x - ps.x, muzzle.y - ps.y);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  blitGlow('purple', cx, cy, Math.max(16, len * 0.85), 0.3 + 0.08 * Math.sin(t * 4));
  ctx.restore();
}

// Machine geometry: box, front side (first open floor side, like a perk machine), rotation of the
// local frame (front = +y), and the world points of the feed slot and the tray. Memoized per
// map / pap object / version (a door opening next to it can change the open sides).
let papGeomMemo = { map: null, pap: null, ver: -1, g: null };
function papGeom(map) {
  const m = map && map.pap;
  if (!m) return null;
  const ver = Number.isFinite(map.version) ? map.version : 0;
  if (papGeomMemo.map === map && papGeomMemo.pap === m && papGeomMemo.ver === ver) return papGeomMemo.g;
  const b = perkBox(m);
  const tx = Number.isFinite(m.tx) ? m.tx : Math.floor((b.x + b.w / 2) / TILE);
  const ty = Number.isFinite(m.ty) ? m.ty : Math.floor((b.y + b.h / 2) / TILE);
  const sides = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }]
    .filter((s) => isOpenFloorCode(tileAt(map, tx + s.dx, ty + s.dy)));
  if (!sides.length) sides.push({ dx: 0, dy: 1 });
  const front = sides[0];
  const rot = Math.atan2(front.dy, front.dx) - Math.PI / 2;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const half = (front.dx ? b.w : b.h) / 2 - 1;   // local y of the front face
  const across = (front.dx ? b.h : b.w) - 2;     // cabinet width along the front
  const c = Math.cos(rot), s = Math.sin(rot);
  const wx = (lx, ly) => cx + lx * c - ly * s, wy = (lx, ly) => cy + lx * s + ly * c;
  const slotLy = half - 15, trayLy = half - 4;
  const back = tileAt(map, tx - front.dx, ty - front.dy);
  const g = {
    b, tx, ty, sides, front, rot, cx, cy, half, across, ext: back === T_WALL ? 8 : 0,
    slotLy, trayLy,
    slotX: wx(0, slotLy), slotY: wy(0, slotLy),
    trayX: wx(0, trayLy), trayY: wy(0, trayLy),
  };
  papGeomMemo = { map, pap: m, ver, g };
  return g;
}

function papCost(map) {
  const m = map && map.pap;
  if (m && Number.isFinite(m.cost)) return m.cost;
  return CFG.PAP && Number.isFinite(CFG.PAP.cost) ? CFG.PAP.cost : 500;
}

// Static layer: dark cabinet with purple neon trim and gold corners, a purple-and-gold emblem
// (upright lightning bolt), the feed slot with gold rollers, a status lamp (dim gold idle,
// purple working, bright gold ready), the steel tray on the front lip, purple/gold light on the
// floor in front, and a "PACK-A-PUNCH" / cost plate on every open floor side.
function paintPapMachine(c, map) {
  let g = null;
  try { g = papGeom(map); } catch (_) { g = null; }
  if (!g) return;
  const st = papStateCode;
  const { b, rot, front, ext } = g;
  c.save();
  try {
    c.fillStyle = '#0a0810';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.translate(g.cx, g.cy);
    c.rotate(rot);
    const W = g.across, H = (front.dx ? b.w : b.h) - 2;
    const x0 = -W / 2, y1 = H / 2, y0 = -H / 2 - ext, Ht = y1 - y0;
    // Light on the floor in front: purple wash + a warm gold core under the tray.
    let gr = c.createRadialGradient(0, y1 + 4, 2, 0, y1 + 4, W * 1.15);
    gr.addColorStop(0, 'rgba(180,77,255,0.5)');
    gr.addColorStop(1, 'rgba(180,77,255,0)');
    c.fillStyle = gr;
    c.fillRect(-W * 1.2, y1 - 2, W * 2.4, W * 1.2);
    gr = c.createRadialGradient(0, y1 + 2, 1, 0, y1 + 2, W * 0.55);
    gr.addColorStop(0, 'rgba(255,200,70,0.35)');
    gr.addColorStop(1, 'rgba(255,200,70,0)');
    c.fillStyle = gr;
    c.fillRect(-W * 0.6, y1 - 2, W * 1.2, W * 0.6);
    // Drop shadow, outer frame, body with a subtle top-lit gradient, darker side panels.
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(x0 + 2, y0 + 2, W, Ht);
    c.fillStyle = '#07050b';
    c.fillRect(x0, y0, W, Ht);
    gr = c.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, '#2a1840');
    gr.addColorStop(1, '#150b20');
    c.fillStyle = gr;
    c.fillRect(x0 + 2, y0 + 2, W - 4, Ht - 3);
    c.fillStyle = '#100818';
    c.fillRect(x0 + 2, y0 + 2, 3, Ht - 3);
    c.fillRect(x0 + W - 5, y0 + 2, 3, Ht - 3);
    // Purple neon trim (glowing) just inside the frame.
    c.strokeStyle = PAP_PURPLE;
    c.lineWidth = 1;
    c.shadowColor = PAP_PURPLE;
    c.shadowBlur = 8;
    c.strokeRect(x0 + 5.5, y0 + 2.5, W - 11, Ht - 5);
    c.shadowBlur = 0;
    // Gold marquee strip on top with bulbs.
    c.fillStyle = '#c99a2a';
    c.fillRect(x0 + 6, y0 + 3, W - 12, 3);
    c.fillStyle = '#fff1b0';
    for (let bx = x0 + 8; bx < x0 + W - 8; bx += 4) c.fillRect(bx, y0 + 4, 1, 1);
    // Gold corner caps.
    c.fillStyle = '#e0b030';
    c.fillRect(x0, y0, 3, 3); c.fillRect(x0 + W - 3, y0, 3, 3);
    c.fillRect(x0, y1 - 3, 3, 3); c.fillRect(x0 + W - 3, y1 - 3, 3, 3);
    // Emblem: purple disc, gold rim, upright gold lightning bolt.
    const ey = (y0 + 7 + g.slotLy - 1) / 2;
    const er = Math.max(5, Math.min(8, (g.slotLy - 1 - (y0 + 7)) / 2));
    c.save();
    c.translate(0, ey);
    c.rotate(-rot);
    c.shadowColor = PAP_PURPLE;
    c.shadowBlur = 10;
    c.fillStyle = '#5a1f98';
    c.beginPath(); c.arc(0, 0, er, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#e0b030';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = PAP_GOLD;
    const k = er / 8;
    c.beginPath();
    c.moveTo(1.5 * k, -6 * k); c.lineTo(-3.5 * k, 1 * k); c.lineTo(-0.2 * k, 1 * k);
    c.lineTo(-1.5 * k, 6 * k); c.lineTo(3.5 * k, -1.2 * k); c.lineTo(0.2 * k, -1.2 * k);
    c.closePath(); c.fill();
    c.restore();
    // Feed slot: dark opening, purple glow inside (brighter while working), gold rollers.
    const sw = W - 14, sx = -sw / 2, sy = g.slotLy - 2;
    c.fillStyle = '#030205';
    c.fillRect(sx, sy, sw, 4);
    c.fillStyle = st === 2 ? 'rgba(230,170,255,0.95)' : 'rgba(180,77,255,0.55)';
    c.fillRect(sx + 1, sy + 2, sw - 2, 1);
    c.fillStyle = '#a87818';
    c.fillRect(sx - 2, sy, 2, 4); c.fillRect(sx + sw, sy, 2, 4);
    // Status lamp right of the emblem row.
    const lampC = st === 2 ? '#d9a0ff' : st === 3 ? '#ffe680' : '#7a5a14';
    c.fillStyle = '#050307';
    c.fillRect(x0 + W - 10, ey - 2, 4, 4);
    if (st >= 2) { c.shadowColor = lampC; c.shadowBlur = 6; }
    c.fillStyle = lampC;
    c.fillRect(x0 + W - 9, ey - 1, 2, 2);
    c.shadowBlur = 0;
    // Tray: steel lip across the front, recessed bed, gold front edge.
    const ty0 = g.trayLy - 4, tw = W - 4;
    c.fillStyle = '#2c2636';
    c.fillRect(-tw / 2, ty0, tw, y1 - ty0 + 2);
    c.fillStyle = '#0d0a12';
    c.fillRect(-tw / 2 + 2, ty0 + 1, tw - 4, y1 - ty0 - 2);
    c.fillStyle = '#e0b030';
    c.fillRect(-tw / 2, y1 + 1, tw, 1);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(-tw / 2, ty0, tw, 1);
    // Outline
    c.strokeStyle = '#040306';
    c.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, Ht - 1);
  } finally { c.restore(); }
  const price = String(papCost(map));
  // WO8 FIX-B (playtest #5): ONE plate, placed where the player never stands to use the machine.
  // Every open 4-neighbour is a use tile, so each side (and the same side one tile further out) is
  // scored by the floor its plate rect covers: use tiles x100, diagonal tiles x10, other floor x1
  // (+200 for the far offset, +0.5 for a non-back side). On L1/L2/L3 this picks a wall side next
  // to the cabinet (L1 east, L2 west, L3 east), clear of the tray and of the soldier.
  const pl = papPlatePlacement(c, map, g, 'PACK-A-PUNCH', price);
  paintWallBuyLabel(c, pl.lb, pl.lb.w, pl.lb.h, pl.side, 'PACK-A-PUNCH', price, false);
}

// Plate rect for side s with the box pushed out by k px (mirrors paintWallBuyLabel's layout).
function papPlateRect(b, s, k, pw, ph) {
  const lb = {
    x: b.x - (s.dx < 0 ? k : 0), y: b.y - (s.dy < 0 ? k : 0),
    w: b.w + (s.dx ? k : 0), h: b.h + (s.dy ? k : 0),
  };
  let px, py;
  if (s.dy === 1) { px = lb.x + lb.w / 2 - pw / 2; py = lb.y + lb.h + 3; }
  else if (s.dy === -1) { px = lb.x + lb.w / 2 - pw / 2; py = lb.y - 3 - ph; }
  else if (s.dx === 1) { px = lb.x + lb.w + 3; py = lb.y + lb.h / 2 - ph / 2; }
  else { px = lb.x - 3 - pw; py = lb.y + lb.h / 2 - ph / 2; }
  return { lb, px, py };
}

function papPlatePlacement(c, map, g, name, price) {
  c.save();
  c.font = 'bold 12px monospace';
  const pw = Math.ceil(Math.max(c.measureText(name).width, c.measureText(price).width) + 10);
  c.restore();
  const ph = 32;
  const b = g.b;
  const walk = (code) => isOpenFloorCode(code) || code === T_DOOR;
  const all = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
  let best = null;
  for (const s of all) {
    const isFront = s.dx === g.front.dx && s.dy === g.front.dy;
    const isBack = s.dx === -g.front.dx && s.dy === -g.front.dy;
    for (const extra of [0, TILE]) {
      const k = (isFront ? PAP_TRAY_LABEL_CLEAR : 0) + (isBack ? g.ext : 0) + extra;
      const r = papPlateRect(b, s, k, pw, ph);
      let score = extra ? 200 : 0;
      for (let y = r.py + 2; y < r.py + ph; y += 4) {
        for (let x = r.px + 2; x < r.px + pw; x += 4) {
          const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
          const ax = Math.abs(tx - g.tx), ay = Math.abs(ty - g.ty);
          if (ax + ay === 0) { score += 100; continue; }          // over the cabinet / tray
          if (!walk(tileAt(map, tx, ty))) continue;
          score += ax + ay === 1 ? 100 : (ax <= 1 && ay <= 1) ? 10 : 1; // use tile / diagonal / far floor
        }
      }
      score += isBack ? 0 : 0.5;
      if (!best || score < best.score) best = { score, side: s, lb: r.lb };
    }
  }
  return best;
}
const PAP_TRAY_LABEL_CLEAR = 12;

// Gun entry for the weapon object inside the machine (base art; camo when `tinted`).
function papWeaponGun(w, tinted) {
  if (!w) return null;
  const def = w.def || weaponDef(w.id) || (w.id != null ? { id: w.id } : null);
  const gun = gunEntryFor(baseDefOf(w, def));
  return tinted ? papGunEntry(gun) : gun;
}

// Dynamic overlays: breathing glow (all states), the gun sliding into the slot and then sparks
// while working, the upgraded gun bobbing on the tray while ready.
function drawPap(state, map, t, view) {
  const pap = state.shop && state.shop.pap;
  const inside = pap && (pap.state === 'working' || pap.state === 'ready') ? pap.weapon : null;
  if (!inside) papAnim.weapon = null;
  if (!map.pap) return;
  let g;
  try { g = papGeom(map); } catch (_) { return; }
  if (!g || !inView(view, g.cx, g.cy, 110)) return;
  const st = pap ? pap.state : 'idle';
  const scale = spriteScale(), dirs = spriteDirections();
  ctx.save();
  try {
    // Cabinet jitter first, so the glows below still light the shaken cabinet.
    if (st === 'working' && inside && papAnim.weapon === inside && papAnim.state === 'working'
        && t - papAnim.start >= PAP_SLIDE_TIME) drawPapShake(g, t);
    ctx.globalCompositeOperation = 'lighter';
    if (st === 'working') {
      // WO8 FIX-B (playtest #6): a clearly busy machine. Bigger breathing purple halo, and the slot
      // pulses purple <-> gold (3 Hz), plus the cabinet jitter and heavier sparks below.
      const p = Math.abs(Math.sin(t * 9));
      const q = 0.5 + 0.5 * Math.sin(t * 6 * Math.PI);
      blitGlow('purple', g.cx, g.cy, 48 + 14 * p, 0.4 + 0.4 * p);
      blitGlow('purple', g.slotX, g.slotY, 24 + 8 * (1 - q), 0.6 + 0.4 * (1 - q));
      blitGlow('gold', g.slotX, g.slotY, 16 + 10 * q, 0.35 + 0.55 * q);
    } else if (st === 'ready') {
      blitGlow('purple', g.cx, g.cy, 38, 0.3 + 0.08 * Math.sin(t * 4));
      blitGlow('gold', g.trayX, g.trayY, 26, 0.45 + 0.15 * Math.sin(t * 5));
    } else {
      blitGlow('purple', g.cx, g.cy, 32, 0.16 + 0.06 * Math.sin(t * 2));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (st === 'working' && inside) {
      if (papAnim.weapon !== inside || papAnim.state !== 'working') { papAnim.weapon = inside; papAnim.state = 'working'; papAnim.start = t; }
      const el = Math.max(0, t - papAnim.start);
      if (el < PAP_SLIDE_TIME) drawPapSlide(g, papWeaponGun(inside, false), el / PAP_SLIDE_TIME, scale, dirs);
      else drawPapSparks(g, t);
    } else if (st === 'ready' && inside) {
      // Gold flash on the working -> ready switch (PAP_READY_FLASH s).
      if (papAnim.state === 'working' && papAnim.weapon === inside) papAnim.readyAt = t;
      papAnim.weapon = inside; papAnim.state = 'ready';
      const fa = papAnim.readyAt >= 0 ? 1 - (t - papAnim.readyAt) / PAP_READY_FLASH : 0;
      if (fa > 0 && fa <= 1) {
        ctx.globalCompositeOperation = 'lighter';
        blitGlow('gold', g.cx, g.cy, 30 + 40 * (1 - fa), fa);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      const gun = papWeaponGun(inside, true);
      if (gun && gun.sprite && gun.sprite.pixels) {
        const sp = gun.sprite;
        const ang = g.front.dx ? -Math.PI / 2 : 0;
        const bob = Math.round(Math.sin(t * 2.6)) * 2;
        drawCrisp(sp, Math.round(g.trayX), Math.round(g.trayY) - 2, 0, bob, ang, sp.w / 2, sp.h / 2, scale, dirs);
        // Twinkles on the tray
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const ph = (t * 1.3 + i / 3) % 1;
          const a = Math.sin(ph * Math.PI);
          const ox = (hash(i * 13.7 + Math.floor(t * 1.3 + i / 3)) - 0.5) * sp.w * scale;
          const x = g.trayX + (g.front.dx ? 0 : ox), y = g.trayY + (g.front.dx ? ox : 0) - 4;
          drawStar(x, y, 1 + 2.5 * a, i % 2 ? PAP_GOLD : '#e8c8ff', a * 0.9);
        }
      }
    }
  } finally { ctx.restore(); }
}

// The gun (muzzle first) slides from the floor in front of the tray into the slot, clipped at
// the slot line so it disappears into the cabinet. k = 0..1 (eased in).
function drawPapSlide(g, gun, k, scale, dirs) {
  if (!gun || !gun.sprite || !gun.sprite.pixels) return;
  const sp = gun.sprite;
  const fx = g.front.dx, fy = g.front.dy;
  const L = Math.max(sp.w, sp.h) * scale;
  const e = k * k;
  const sx = g.trayX + fx * L * 0.3, sy = g.trayY + fy * L * 0.3;
  const ex = g.slotX - fx * (L * 0.5 + 4), ey = g.slotY - fy * (L * 0.5 + 4);
  const x = sx + (ex - sx) * e, y = sy + (ey - sy) * e;
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.rot);
  ctx.beginPath();
  ctx.rect(-120, g.slotLy, 240, 200);
  ctx.rotate(-g.rot);
  ctx.translate(-g.cx, -g.cy);
  ctx.clip();
  drawCrisp(sp, Math.round(x), Math.round(y), 0, 0, Math.atan2(-fy, -fx), sp.w / 2, sp.h / 2, scale, dirs);
  ctx.restore();
  // Slot flares as the gun goes in.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  blitGlow('gold', g.slotX, g.slotY, 10 + 10 * k, 0.3 + 0.5 * k);
  ctx.restore();
}

// WO8 FIX-B (playtest #6): while working, the cabinet (its static-layer pixels) is re-blitted with a
// 1-2 px jitter (deterministic from time, ~30 Hz), along the front face mostly. Skipped under
// prefers-reduced-motion. One drawImage of a ~40x48 px rect.
function drawPapShake(g, t) {
  if (!staticLayer || !staticLayer.canvas || prefersReducedMotion()) return;
  const n = Math.floor(t * 30);
  const a = Math.round((hash(n * 1.37 + 5) * 2 - 1) * 2);
  const bb = Math.round((hash(n * 2.71 + 9) * 2 - 1));
  if (!a && !bb) return;
  const jx = g.front.dx ? bb : a, jy = g.front.dx ? a : bb;
  const b = g.b, f = g.front, e = g.ext;
  const x = b.x - (f.dx > 0 ? e : 0), y = b.y - (f.dy > 0 ? e : 0);
  const w = b.w + (f.dx ? e : 0), h = b.h + (f.dy ? e : 0);
  ctx.fillStyle = '#07050b';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(staticLayer.canvas, x, y, w, h, x + jx, y + jy, w, h);
}

// Gold / white / lilac sparks spraying out of the slot (deterministic from time). FIX-B
// (playtest #6): 20 thicker, longer sparks, plus a burst of 6 stars from the slot every 0.5 s.
function drawPapSparks(g, t) {
  const fa = Math.atan2(g.front.dy, g.front.dx);
  const ax = Math.cos(fa + Math.PI / 2), ay = Math.sin(fa + Math.PI / 2);
  const cols = [PAP_GOLD, '#fff3c0', '#d9a0ff'];
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 20; i++) {
    const cyc = t * 2.8 + hash(i * 7.31);
    const ph = cyc % 1, n = Math.floor(cyc);
    const off = (hash(i * 3.7 + n * 11.1) - 0.5) * (g.across - 12);
    const ang = fa + (hash(i * 5.3 + n * 2.9) - 0.5) * 2.6;
    const d = 3 + ph * (24 + 22 * hash(i + n * 1.7));
    const ox = g.slotX + ax * off, oy = g.slotY + ay * off;
    const x = ox + Math.cos(ang) * d, y = oy + Math.sin(ang) * d + ph * ph * 8;
    ctx.globalAlpha = 1 - ph;
    ctx.strokeStyle = cols[i % 3];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(ang) * 8, y - Math.sin(ang) * 8);
    ctx.stroke();
  }
  const bc = t * 2, bn = Math.floor(bc), bp = bc - bn;
  if (bp < 0.5) {
    const k = bp / 0.5, fade = 1 - k;
    for (let i = 0; i < 6; i++) {
      const ang = fa + (hash(i * 4.1 + bn * 3.3) - 0.5) * 2.8;
      const d = 6 + k * (22 + 14 * hash(i * 9.7 + bn));
      drawStar(g.slotX + Math.cos(ang) * d, g.slotY + Math.sin(ang) * d, 1.5 + 3 * fade, i % 2 ? PAP_GOLD : '#f0d8ff', fade);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// 4-point star (two thin diamonds) at (x, y).
function drawStar(x, y, r, color, alpha) {
  if (!(alpha > 0) || !(r > 0)) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.fillStyle = color;
  const q = Math.max(0.6, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + q, y); ctx.lineTo(x, y + r); ctx.lineTo(x - q, y); ctx.closePath();
  ctx.moveTo(x - r, y); ctx.lineTo(x, y - q); ctx.lineTo(x + r, y); ctx.lineTo(x, y + q); ctx.closePath();
  ctx.fill();
}

// pap:done -> purple/gold sparkle burst at the machine's tray (placed when the queue is flushed).
function onPapDone(p) {
  pending.push({ type: 'papSparkle', weaponId: p && p.weaponId, ttl: PAP_SPARKLE_TTL, maxTtl: PAP_SPARKLE_TTL });
}

function placePapEffect(state, e) {
  if (Number.isFinite(e.x) && Number.isFinite(e.y)) return true;
  const map = state && state.map;
  if (!map || !map.pap) return false;
  let g = null;
  try { g = papGeom(map); } catch (_) { g = null; }
  e.x = g ? g.trayX : map.pap.cx;
  e.y = g ? g.trayY : map.pap.cy;
  return Number.isFinite(e.x) && Number.isFinite(e.y);
}

function drawPapSparkle(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 90)) return;
  const f = 1 - lifeFrac(e);            // 0 -> 1 over the life
  const ease = 1 - (1 - f) * (1 - f);
  const fade = 1 - f;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  blitGlow('purple', e.x, e.y, 22 + 40 * ease, fade * 0.8);
  blitGlow('gold', e.x, e.y, 12 + 18 * ease, fade * fade * 0.9);
  ctx.globalAlpha = fade * 0.6;
  ctx.strokeStyle = PAP_PURPLE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, 8 + 52 * ease, 0, Math.PI * 2);
  ctx.stroke();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash(i * 3.3) * 0.5;
    const d = (12 + 46 * hash(i * 7.7 + 1)) * ease;
    const tw = 0.6 + 0.4 * Math.sin(f * 30 + i * 1.7);
    drawStar(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d - 8 * f, 1.2 + 3.2 * fade, i % 2 ? PAP_GOLD : '#dcb4ff', fade * tw);
  }
  ctx.restore();
}

function isOpenFloorCode(code) { return code === T_FLOOR || code === T_OPEN || code === T_ARENA; }

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

function paintWallBuyLabel(c, wb, w, h, side, name, price, soldOut) {
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
  if (labelRects) labelRects.push({ x: px, y: py, w: plateW, h: plateH, buy: labelKind === 'buy' });
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
    c.fillStyle = soldOut ? '#c8483c' : COLORS.hudPoints; // WO7: perk "SOLD OUT"
    c.fillText(price, px + plateW / 2, py + 2 + lineH * 1.5 + 0.5);
  }
  c.restore();
}

// FIX-3 (playtest #10): label plates painted into the static layer are recorded while painting;
// a plate the player stands on is re-blitted from the static layer over the player at 75 % so the
// wall-buy / mega-door text stays readable. Only plates overlapping the player are touched.
// FIX-1 (playtest #3): wall-buy and perk plates (buy: true) sit exactly where the player stands to
// buy, and the HUD prompt already shows name + price there, so they are re-blitted at
// RENDER.buyPlateOverPlayerAlpha (35 %): the soldier stays clearly visible, the text stays faint.
let labelRects = null;
let labelKind = 'door'; // 'buy' while wall buys / perk machines paint their plates
const BUY_PLATE_ALPHA = RENDER.buyPlateOverPlayerAlpha ?? 0.35;
function drawLabelsOverPlayer(state) {
  const p = state.player;
  const L = staticLayer && staticLayer.labels;
  if (!p || !L || !L.length || staticLayer.map !== state.map) return;
  const pr = (p.radius || 14) + 6;
  let drew = false;
  for (let i = 0; i < L.length; i++) {
    const b = L[i];
    if (p.x + pr <= b.x || p.x - pr >= b.x + b.w || p.y + pr <= b.y || p.y - pr >= b.y + b.h) continue;
    if (!drew) { ctx.save(); drew = true; }
    ctx.globalAlpha = b.buy ? BUY_PLATE_ALPHA : 0.75;
    ctx.drawImage(staticLayer.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
  }
  if (drew) ctx.restore();
}

function drawStaticLayer(map, view, theme) {
  const layer = getStaticLayer(map, theme);
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
  zTrackFrame++;
  // Corpses first so live zombies draw over them
  for (let pass = 0; pass < 2; pass++) {
    for (const z of zs) {
      if (!z) continue;
      const dying = z.mode === 'dying';
      if ((pass === 0) !== dying) continue;
      const kind = z.kind;
      if (kind === 'boss') { if (inView(view, z.x, z.y, 140)) drawBoss(state, z, dying); continue; }
      if (!inView(view, z.x, z.y, 40)) continue;
      // WO7 T1: pixel-art sprites once Agent A's art is in (vector fallback while placeholder).
      if (drawZombieSprite(state, z, dying, linger)) continue;
      drawZombieLegacy(state, z, dying, linger);
    }
  }
  pruneZombieTrack();
}

// Pre-WO7 vector zombie (circle, arms, eyes). Used only while the zombie art is missing or still
// placeholder, or if a sprite draw throws.
function drawZombieLegacy(state, z, dying, linger) {
  {
    {
      const kind = z.kind;
      const minion = kind === 'minion';
      const r0 = z.radius || (minion ? ZOMBIE.radius * MINION_SCALE : ZOMBIE.radius);
      let alpha = 1, scale = 1;
      if (dying) {
        const f = Math.max(0, Math.min(1, (z.dyingT != null ? z.dyingT : 0) / linger));
        alpha = f; scale = 0.5 + 0.5 * f;
      }
      const r = r0 * scale;
      const col = minion ? minionColor(z.tier) : zombieColor(z.tier);
      if (!dying && z.stun > 0) { drawStunnedZombie(z, r, col, state.time || 0); return; }
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
        const aw = minion ? 3 : 4;
        ctx.fillRect(r * 0.2, -r * 0.75, reach, aw);
        ctx.fillRect(r * 0.2, r * 0.75 - aw, reach, aw);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dying ? shade(col, 0.6) : col;
      ctx.fill();
      if (minion) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = dying ? shade(MINION_OUTLINE, 0.5) : MINION_OUTLINE;
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = shade(col, 0.45);
      }
      ctx.stroke();

      if (!dying) {
        // Eyes
        const ex = Math.cos(ang), ey = Math.sin(ang);
        const px = -ey, py = ex;
        if (minion) {  // eye glow
          ctx.fillStyle = 'rgba(255,50,20,0.35)';
          for (let s = -1; s <= 1; s += 2) {
            ctx.fillRect(z.x + ex * r * 0.45 + px * s * r * 0.35 - 3, z.y + ey * r * 0.45 + py * s * r * 0.35 - 3, 6, 6);
          }
        }
        ctx.fillStyle = minion ? '#ff3a1a' : z.tier === 'sprint' ? '#ffb040' : '#e0e070';
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

// ---------------------------------------------------------------------------
// WO7 T1: pixel-art zombies (ZOMBIE_SPRITES from sprites/zombie.js, Agent A).
// Two layers like the soldier: legs rotated to the movement direction (from per-zombie position
// deltas tracked here, keyed by id), body rotated to the player while chasing / attacking and to
// the movement direction otherwise. Walk phase from distance moved (SPRITES.zombieStride /
// bossStride per full cycle). Every layer goes through drawCrisp (1x nearest-neighbour rotation,
// cached per sprite x direction), so pixels stay square at all 32 directions.
// ---------------------------------------------------------------------------

const zTrack = new Map();   // zombie id (or object) -> { x, y, mx, my, legA, bodyA, dist, still, seen }
let zTrackFrame = 0;
const Z_TRACK_JUMP = 60;    // a per-frame move larger than this (teleport / respawn) is not walked
const Z_STILL_FRAMES = 8;   // frames without movement before the legs return to the stance frame

function pruneZombieTrack() {
  if ((zTrackFrame & 63) !== 0 || zTrack.size < 8) return;
  for (const [k, r] of zTrack) if (zTrackFrame - r.seen > 120) zTrack.delete(k);
}

function trackZombie(state, z) {
  const key = z.id != null ? z.id : z;
  let r = zTrack.get(key);
  if (!r) {
    let dx = z.vx || 0, dy = z.vy || 0;
    const p = state.player;
    if (Math.abs(dx) + Math.abs(dy) < 1e-3 && p) { dx = p.x - z.x; dy = p.y - z.y; }
    const a = Math.abs(dx) + Math.abs(dy) > 1e-6 ? Math.atan2(dy, dx) : 0;
    r = { x: z.x, y: z.y, mx: Math.cos(a), my: Math.sin(a), legA: a, bodyA: a, dist: 0, still: Z_STILL_FRAMES, seen: zTrackFrame };
    zTrack.set(key, r);
    return r;
  }
  if (r.seen === zTrackFrame) return r; // drawn twice in one frame
  const dx = z.x - r.x, dy = z.y - r.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.01 && d < Z_TRACK_JUMP) {
    r.dist += d;
    // Low-pass the heading so path-following jitter does not flip the legs between directions.
    r.mx = r.mx * 0.7 + dx; r.my = r.my * 0.7 + dy;
    if (Math.abs(r.mx) + Math.abs(r.my) > 0.15) r.legA = Math.atan2(r.my, r.mx);
    r.still = 0;
  } else if (r.still < 1e6) r.still++;
  r.x = z.x; r.y = z.y;
  r.seen = zTrackFrame;
  return r;
}

// Is the given sprite real art (not the Phase 0 checker)? Only the explicit flag counts
// (pixel.isPlaceholder flags any 'x' pixel; the boss tint marker is 'p' / #b44dff, see below).
// globalThis.__zombieSpritesForce = true draws the placeholders anyway (art debugging).
function realArt(sp) {
  return !!(sp && sp.pixels && (sp.placeholder !== true || globalThis.__zombieSpritesForce));
}

function zombieSpritesFor(z) {
  const Z = zombieArt.ZOMBIE_SPRITES;
  if (!Z || typeof zombieArt.zombieSpriteFor !== 'function') return null;
  let spr;
  try { spr = zombieArt.zombieSpriteFor(z); } catch (_) { return null; }
  if (!spr || !realArt(spr.body) || !spr.legs || !Array.isArray(spr.legs.frames) || !spr.legs.frames.length) return null;
  return spr;
}

function anchorOf(a, sp) {
  return a && Number.isFinite(a.x) && Number.isFinite(a.y) ? a : { x: sp.w / 2, y: sp.h / 2 };
}

// White silhouette (hit flash / boss telegraph), cached per source sprite.
const whiteCache = new WeakMap();
function whiteSprite(sp) {
  let w = whiteCache.get(sp);
  if (!w) {
    w = pixel.tint(sp, (r, g, b, a) => (a ? [255, 255, 255, a] : [0, 0, 0, 0]));
    whiteCache.set(sp, w);
  }
  return w;
}

// Boss tint marker: pixels whose colour is ZOMBIE_SPRITES.boss.tintColor ('p' / #b44dff, used
// only in the boss crown/helmet) become levelDef.boss.tint. Darker shades of a magenta marker (r === b, g === 0,
// e.g. from a custom palette) keep their relative brightness. Cached per sprite x tint.
const tintCache = new WeakMap(); // sprite -> Map(tint -> sprite)
function bossTinted(sp, tint, marker, bodyMix) {
  let m = tintCache.get(sp);
  if (!m) { m = new Map(); tintCache.set(sp, m); }
  const mix = bodyMix > 0 ? Math.min(0.8, bodyMix) : 0;
  const key = mix ? tint + '@' + mix : tint;
  let out = m.get(key);
  if (out) return out;
  const mk = hexRgb(marker) || [255, 0, 255];
  const tc = hexRgb(tint) || [122, 31, 31];
  const magenta = mk[0] === 255 && mk[1] === 0 && mk[2] === 255;
  out = pixel.tint(sp, (r, g, b, a) => {
    if (!a) return null;
    if (r === mk[0] && g === mk[1] && b === mk[2]) return [tc[0], tc[1], tc[2], a];
    if (magenta && g === 0 && r === b && r >= 64) {
      const f = r / 255;
      return [Math.round(tc[0] * f), Math.round(tc[1] * f), Math.round(tc[2] * f), a];
    }
    // FIX-2 (WO9 QA KINO #7 / TEMPLE #11): optional body wash in the tint, luminance-preserving;
    // glowing red eyes / blood (strong red) keep their colour.
    if (mix && !(r > 150 && g < 90 && b < 90)) {
      const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const k = 0.35 + L * 1.25;
      return [Math.min(255, Math.round(r + (tc[0] * k - r) * mix)), Math.min(255, Math.round(g + (tc[1] * k - g) * mix)),
        Math.min(255, Math.round(b + (tc[2] * k - b) * mix)), a];
    }
    return null;
  });
  if (m.size > 8) m.clear();
  m.set(key, out);
  return out;
}

function legFrameOf(legs, r, stride) {
  const n = legs.frames.length;
  if (r.still >= Z_STILL_FRAMES) return legs.frames[0];
  const st = stride > 0 ? stride : 36;
  const i = Math.floor((r.dist / st) * n) % n;
  return legs.frames[i] || legs.frames[0];
}

// Normal zombies and minions. Returns false when the art is not available (caller falls back).
function drawZombieSprite(state, z, dying, linger) {
  const spr = zombieSpritesFor(z);
  if (!spr) return false;
  const Z = zombieArt.ZOMBIE_SPRITES;
  const minion = z.kind === 'minion';
  const scale = spriteScale();
  const dirs = spriteDirections();
  const r = trackZombie(state, z);
  const p = state.player;
  try {
    if (!dying && !(z.stun > 0)) {
      const face = (z.mode === 'chasing' || z.mode === 'attacking') && p;
      r.bodyA = face ? Math.atan2(p.y - z.y, p.x - z.x) : r.legA;
    }
    const zx = Math.round(z.x), zy = Math.round(z.y);
    const rad = (spr.body.w * scale) / 2;
    if (dying) {
      // Corpse: lying sprite at the last facing, fading out over deathLinger.
      const f = Math.max(0, Math.min(1, (z.dyingT != null ? z.dyingT : 0) / linger));
      const cs = realArt(spr.corpse) ? spr.corpse : spr.body;
      const ca = anchorOf(spr.anchor, cs);
      ctx.globalAlpha = f;
      drawCrisp(cs, zx, zy, 0, 0, r.bodyA, ca.x, ca.y, scale, dirs);
      ctx.globalAlpha = 1;
      return true;
    }
    if (z.stun > 0) { drawStunnedSprite(z, spr, zx, zy, rad, scale, dirs, state.time || 0); return true; }
    const sr = stunSeen.get(z);
    if (sr) sr.last = 0;
    // Shadow
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(zx + 1, zy + 3, rad * 0.72, rad * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Legs
    const stride = CFG.SPRITES && CFG.SPRITES.zombieStride;
    const lf = legFrameOf(spr.legs, r, stride);
    if (lf && lf.pixels) {
      const la = anchorOf(spr.legs.anchor, lf);
      drawCrisp(lf, zx, zy, 0, 0, r.legA, la.x, la.y, scale, dirs);
    }
    // Body (arms-forward frame while tearing boards)
    let body = spr.body;
    if (!minion && z.mode === 'tearing') {
      // Per-tier tearing frame (Agent A extra) first, then the 3.3 walker frame.
      if (realArt(spr.tearing)) body = spr.tearing;
      else if (Z.normal && realArt(Z.normal.tearing)) body = Z.normal.tearing;
    }
    const ba = anchorOf(spr.anchor, body);
    drawCrisp(body, zx, zy, 0, 0, r.bodyA, ba.x, ba.y, scale, dirs);
    // Blood overlay under 50 % HP
    if (!minion && Z.normal && realArt(Z.normal.damaged) && z.maxHp > 0 && z.hp < z.maxHp * 0.5) {
      drawCrisp(Z.normal.damaged, zx, zy, 0, 0, r.bodyA, ba.x, ba.y, scale, dirs);
    }
    if (z.hitFlash > 0) {
      ctx.globalAlpha = 0.85 * Math.min(1, z.hitFlash / 0.08);
      drawCrisp(whiteSprite(body), zx, zy, 0, 0, r.bodyA, ba.x, ba.y, scale, dirs);
      ctx.globalAlpha = 1;
    }
  } catch (_) {
    ctx.globalAlpha = 1;
    return false;
  }
  return true;
}

// Knocked-back (stunned) zombie with sprites: the corpse (lying) sprite rotated to the knock
// direction, plus the WO2 dust puff.
function drawStunnedSprite(z, spr, zx, zy, rad, scale, dirs, t) {
  const stun = z.stun;
  let rec = stunSeen.get(z);
  if (!rec) { rec = { start: t, last: stun }; stunSeen.set(z, rec); }
  else if (stun > rec.last + 1e-6 || rec.start > t) rec.start = t;
  rec.last = stun;
  const ka = Number.isFinite(z.knockAngle) ? z.knockAngle
    : (Math.abs(z.kvx || 0) + Math.abs(z.kvy || 0) > 1e-3 ? Math.atan2(z.kvy || 0, z.kvx || 0) : 0);
  const age = t - rec.start;
  if (age < STUN_PUFF_TIME) {
    const f = 1 - age / STUN_PUFF_TIME;
    ctx.fillStyle = '#b3a78f';
    for (let k = 0; k < 5; k++) {
      const a = ka + Math.PI + (k - 2) * 0.45;
      const d = rad * (0.6 + (1 - f) * 1.2);
      ctx.globalAlpha = 0.6 * f;
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 3 + (1 - f) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const cs = realArt(spr.corpse) ? spr.corpse : spr.body;
  const ca = anchorOf(spr.anchor, cs);
  drawCrisp(cs, zx, zy, 0, 0, ka, ca.x, ca.y, scale, dirs);
  if (z.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, z.hitFlash / 0.08);
    drawCrisp(whiteSprite(cs), zx, zy, 0, 0, ka, ca.x, ca.y, scale, dirs);
    ctx.globalAlpha = 1;
  }
}

// Boss body via sprites (called from drawBoss after the shadow, before the telegraph ring).
// Returns false when the boss art is missing / placeholder (drawBoss then draws the vector boss).
// FIX-2: body wash strength per WO9 look (KINO: gold PROJECTIONIST, TEMPLE: teal DROWNED KING).
const BOSS_BODY_MIX = { kino: 0.42, temple: 0.38 };
function bossBodyMix(state) {
  return BOSS_BODY_MIX[themeOf(state).style] || 0;
}

function drawBossSprite(state, z, dying, alpha, ang, phase, t) {
  const B = zombieArt.ZOMBIE_SPRITES && zombieArt.ZOMBIE_SPRITES.boss;
  const spr = B ? zombieSpritesFor(z) : null;
  if (!spr) return false;
  const tint = bossTint(state);
  const marker = typeof B.tintColor === 'string' ? B.tintColor : '#b44dff';
  const mix = bossBodyMix(state);
  const scale = spriteScale();
  const dirs = spriteDirections();
  const r = trackZombie(state, z);
  const zx = Math.round(z.x), zy = Math.round(z.y);
  try {
    if (!dying) r.bodyA = ang;
    ctx.globalAlpha = alpha;
    if (dying) {
      const cs = bossTinted(realArt(spr.corpse) ? spr.corpse : spr.body, tint, marker, mix);
      const ca = anchorOf(spr.anchor, cs);
      drawCrisp(cs, zx, zy, 0, 0, r.bodyA, ca.x, ca.y, scale, dirs);
      ctx.globalAlpha = 1;
      return true;
    }
    const stride = CFG.SPRITES && CFG.SPRITES.bossStride > 0 ? CFG.SPRITES.bossStride : 90;
    const lf = legFrameOf(spr.legs, r, stride);
    if (lf && lf.pixels) {
      const lt = bossTinted(lf, tint, marker, mix);
      const la = anchorOf(spr.legs.anchor, lt);
      // Legs follow the dash while charging, else the tracked movement.
      drawCrisp(lt, zx, zy, 0, 0, phase === 'dash' ? ang : r.legA, la.x, la.y, scale, dirs);
    }
    const charging = phase === 'telegraph' || phase === 'dash';
    const raw = charging && realArt(B.charge) ? B.charge : spr.body;
    const body = bossTinted(raw, tint, marker, mix);
    const ba = anchorOf(spr.anchor, body);
    drawCrisp(body, zx, zy, 0, 0, ang, ba.x, ba.y, scale, dirs);
    if (phase === 'telegraph') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 40);
      ctx.globalAlpha = alpha * (0.3 + 0.35 * pulse);
      drawCrisp(whiteSprite(body), zx, zy, 0, 0, ang, ba.x, ba.y, scale, dirs);
      ctx.globalAlpha = alpha * (0.7 + 0.3 * pulse);
      ctx.strokeStyle = pulse > 0.5 ? '#ff4030' : '#ffd0c8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(zx, zy, (body.w * scale) / 2 + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (z.hitFlash > 0) {
      ctx.globalAlpha = alpha * 0.7 * Math.min(1, z.hitFlash / 0.08);
      drawCrisp(whiteSprite(body), zx, zy, 0, 0, ang, ba.x, ba.y, scale, dirs);
    }
  } catch (_) {
    ctx.globalAlpha = 1;
    return false;
  }
  ctx.globalAlpha = 1;
  return true;
}

// ---------------------------------------------------------------------------
// WO5 3.6: boss, minions, torches, boss death pool, ambient tint, level transition
// ---------------------------------------------------------------------------

// Minions (FIX-3, playtest #8): their own near-black purple palette whatever the theme or tier
// (tan level-2 zombies no longer look alike), a thin red outline and glowing red eyes.
const MINION_BODY = { walk: '#2c1236', jog: '#301339', sprint: '#35143e' };
const MINION_OUTLINE = '#d02a1c';
function minionColor(tier) {
  return MINION_BODY[tier] || MINION_BODY.walk;
}

const BOSS_BODY = shadeHex(COLORS.zombieWalk, 0.72);
function bossTint(state) {
  const b = state.level && state.level.def && state.level.def.boss;
  const t = b && typeof b.tint === 'string' && hexRgb(b.tint) ? b.tint : '#7a1f1f';
  return t;
}

// Boss: a zombie at 2.4x (its radius is BOSS.radius = 34) with thick clawed arms, pauldrons and a
// spiked rusted crown/helmet in the level's boss tint, glowing red eyes. Charge phases: white
// pulsing flash + warning ring on 'telegraph', ghost trail + speed lines on 'dash', circling
// stars on 'recover'. Dying (BOSS.deathLinger, 2 s): darkens, slumps and fades.
function drawBoss(state, z, dying) {
  const t = state.time || 0;
  const tint = bossTint(state);
  const R0 = z.radius || ZOMBIE.radius * BOSS_SCALE;
  const linger = CFG.BOSS && CFG.BOSS.deathLinger > 0 ? CFG.BOSS.deathLinger : 2;
  let alpha = 1, scale = 1;
  if (dying) {
    const f = Math.max(0, Math.min(1, (z.dyingT != null ? z.dyingT : 0) / linger));
    alpha = 0.15 + 0.85 * f; scale = 0.8 + 0.2 * f;
  }
  const r = R0 * scale;
  const ch = !dying && z.charge ? z.charge : null;
  const phase = ch ? ch.phase : null;
  // Facing: the dash direction while charging, else velocity, else toward the player.
  let dx = 0, dy = 0;
  if ((phase === 'dash' || phase === 'telegraph') && Number.isFinite(ch.dx) && Number.isFinite(ch.dy) && (ch.dx || ch.dy)) { dx = ch.dx; dy = ch.dy; }
  else { dx = z.vx || 0; dy = z.vy || 0; }
  if (Math.abs(dx) + Math.abs(dy) < 1e-3 && state.player) { dx = state.player.x - z.x; dy = state.player.y - z.y; }
  const ang = Math.atan2(dy, dx || 1e-6);
  const ex = Math.cos(ang), ey = Math.sin(ang);

  ctx.save();
  if (phase === 'telegraph') drawChargeLane(state, z, r, ex, ey, t);
  // Dash motion streak (behind the body)
  if (phase === 'dash') {
    ctx.fillStyle = tint;
    for (let k = 4; k >= 1; k--) {
      ctx.globalAlpha = 0.22 / k;
      ctx.beginPath();
      ctx.arc(z.x - ex * r * 0.75 * k, z.y - ey * r * 0.75 * k, r * (1 - 0.07 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const s = (k / 5 - 0.5) * 1.6 * r;
      const len = r * (1.6 + hash(k * 7.7 + Math.floor(t * 20)) * 1.4);
      const bx = z.x - ex * r * 0.5 - ey * s, by = z.y - ey * r * 0.5 + ex * s;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ex * len, by - ey * len);
    }
    ctx.stroke();
  }
  // Ground shadow
  ctx.globalAlpha = 0.35 * alpha;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(z.x + 4, z.y + 6, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // WO7 T1: sprite boss (tint marker recoloured, charge frame); vector art while placeholder.
  if (!drawBossSprite(state, z, dying, alpha, ang, phase, t)) {
  ctx.globalAlpha = alpha;
  ctx.translate(z.x, z.y);
  ctx.rotate(ang);
  const body = dying ? shadeHex(BOSS_BODY, 0.6) : BOSS_BODY;
  if (!dying) {
    // Arms with claws (reach further while attacking / dashing)
    const reach = z.mode === 'attacking' || phase === 'dash' ? r * 1.3 : r * 1.0;
    const aw = r * 0.24;
    ctx.fillStyle = shadeHex(BOSS_BODY, 0.8);
    for (let s = -1; s <= 1; s += 2) {
      const ay = s * r * 0.72;
      ctx.fillRect(r * 0.3, ay - aw / 2, reach, aw);
      ctx.fillStyle = '#d8d0b8';
      for (let c = -1; c <= 1; c++) {
        ctx.beginPath();
        ctx.moveTo(r * 0.3 + reach, ay + c * aw * 0.35 - 2);
        ctx.lineTo(r * 0.3 + reach + r * 0.2, ay + c * aw * 0.45);
        ctx.lineTo(r * 0.3 + reach, ay + c * aw * 0.35 + 2);
        ctx.fill();
      }
      ctx.fillStyle = shadeHex(BOSS_BODY, 0.8);
    }
  }
  // Body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = shadeHex(BOSS_BODY, 0.4);
  ctx.stroke();
  // Pauldrons (tint)
  ctx.fillStyle = shadeHex(tint, 0.85);
  ctx.strokeStyle = shadeHex(tint, 0.45);
  ctx.lineWidth = 2;
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, s * r * 0.62, r * 0.36, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Crown / helmet: rusted ring in the boss tint with spikes and rivets
  const hr = r * 0.5;
  ctx.fillStyle = shadeHex(tint, 0.55);
  ctx.beginPath();
  ctx.arc(-r * 0.08, 0, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tint;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + Math.PI / 7;
    const tip = hr + r * 0.26, base = hr * 0.9;
    ctx.beginPath();
    ctx.moveTo(-r * 0.08 + Math.cos(a - 0.22) * base, Math.sin(a - 0.22) * base);
    ctx.lineTo(-r * 0.08 + Math.cos(a) * tip, Math.sin(a) * tip);
    ctx.lineTo(-r * 0.08 + Math.cos(a + 0.22) * base, Math.sin(a + 0.22) * base);
    ctx.fill();
  }
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.strokeStyle = tint;
  ctx.beginPath();
  ctx.arc(-r * 0.08, 0, hr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(140,70,30,0.55)'; // rust
  ctx.fillRect(-r * 0.08 - hr * 0.7, -hr * 0.2, r * 0.12, r * 0.08);
  ctx.fillStyle = '#e0c89a';
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    ctx.fillRect(-r * 0.08 + Math.cos(a) * hr - 1.5, Math.sin(a) * hr - 1.5, 3, 3);
  }
  if (!dying) {
    // Glowing red eyes (front of the head)
    for (let s = -1; s <= 1; s += 2) {
      ctx.fillStyle = 'rgba(255,40,20,0.35)';
      ctx.beginPath();
      ctx.arc(r * 0.6, s * r * 0.26, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff2a1a';
      ctx.fillRect(r * 0.6 - 3, s * r * 0.26 - 3, 6, 6);
      ctx.fillStyle = '#ffd0c0';
      ctx.fillRect(r * 0.6 - 1, s * r * 0.26 - 1, 2, 2);
    }
  }
  // Telegraph: pulsing white flash over the body + a bright red outline (FIX-3, playtest #7)
  if (phase === 'telegraph') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 40);
    ctx.globalAlpha = alpha * (0.45 + 0.3 * pulse);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha * (0.7 + 0.3 * pulse);
    ctx.strokeStyle = pulse > 0.5 ? '#ff4030' : '#ffd0c8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (z.hitFlash > 0) {
    ctx.globalAlpha = alpha * 0.6 * Math.min(1, z.hitFlash / 0.08);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  } // end vector boss
  ctx.restore();

  if (phase === 'telegraph') {
    // Expanding warning ring
    const f = (t * 2.5) % 1;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - f);
    ctx.strokeStyle = '#ff4030';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(z.x, z.y, r * (1.1 + f * 0.9), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (phase === 'recover') {
    // Dazed after hitting a wall: little stars circling the head
    ctx.save();
    ctx.fillStyle = '#ffe070';
    for (let k = 0; k < 3; k++) {
      const a = t * 6 + k * 2.094;
      ctx.fillRect(z.x + Math.cos(a) * r * 0.7 - 2, z.y - r * 0.2 + Math.sin(a) * r * 0.35 - 2, 4, 4);
    }
    ctx.restore();
  }
  // WO7 T5: acid boss spit telegraph (z.acid.phase === 'telegraph'): swelling green glow, an
  // outline ring pulsing faster as the spit nears, and a dripping glob at the mouth.
  if (!dying && z.acid && z.acid.phase === 'telegraph') drawAcidTelegraph(z, r, ex, ey, t);
  ctx.globalAlpha = 1;
}

function drawAcidTelegraph(z, r, ex, ey, t) {
  const A = CFG.BOSS && CFG.BOSS.acid;
  const tel = A && A.telegraph > 0 ? A.telegraph : 0.5;
  const prog = Math.max(0, Math.min(1, (z.acid.t > 0 ? z.acid.t : 0) / tel));
  const pulse = 0.5 + 0.5 * Math.sin(t * (18 + prog * 30));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = r * (1.05 + 0.25 * prog);
  const g = ctx.createRadialGradient(z.x, z.y, r * 0.3, z.x, z.y, R * 1.35);
  g.addColorStop(0, 'rgba(127,224,64,0)');
  g.addColorStop(0.6, `rgba(127,224,64,${0.18 + 0.2 * pulse})`);
  g.addColorStop(1, 'rgba(127,224,64,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(z.x, z.y, R * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.6 + 0.4 * pulse;
  ctx.strokeStyle = pulse > 0.5 ? '#b8ff6a' : '#4fb82a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(z.x, z.y, R, 0, Math.PI * 2);
  ctx.stroke();
  // Glob swelling at the mouth
  const mx = z.x + ex * r * 0.85, my = z.y + ey * r * 0.85;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#5fcf2a';
  ctx.beginPath();
  ctx.arc(mx, my, 3 + prog * 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8ffa8';
  ctx.fillRect(mx - 2, my - 2 - prog * 2, 2, 2);
  ctx.restore();
}

// FIX-3 (playtest #7): charge warning lane. During the telegraph a pulsing translucent red lane,
// boss-wide, runs from the boss toward the charge direction (charge.dx/dy once set, else the
// player, which is where zombie.js aims when the telegraph ends), with chevrons sweeping outward.
// Length = the dash reach (speed x chargeSpeedMult x chargeMaxTime), cut short at the first
// solid tile (sampled every 16 px). Called inside drawBoss's save/restore, world space.
function drawChargeLane(state, z, r, ex, ey, t) {
  const B = CFG.BOSS || {};
  const reach = Math.min(700, Math.max(160, (z.speed || B.speed || 90) * (B.chargeSpeedMult || 3.5) * (B.chargeMaxTime || 1.1)));
  const map = state.map;
  let len = reach;
  if (map && map.tiles) {
    for (let d = r; d <= reach; d += 16) {
      const code = tileAt(map, Math.floor((z.x + ex * d) / TILE), Math.floor((z.y + ey * d) / TILE));
      if (code !== T_FLOOR && code !== T_OPEN && code !== T_ARENA && code !== T_POCKET) { len = Math.max(r, d - 8); break; }
    }
  }
  const tel = B.chargeTelegraph > 0 ? B.chargeTelegraph : 0.6;
  const prog = z.charge && z.charge.t > 0 ? Math.min(1, z.charge.t / tel) : 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 18);
  const hw = r * 0.95;
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.rotate(Math.atan2(ey, ex));
  ctx.globalAlpha = 0.16 + 0.14 * pulse + 0.12 * prog;
  ctx.fillStyle = '#ff2a1a';
  ctx.fillRect(r * 0.6, -hw, len - r * 0.6, hw * 2);
  ctx.globalAlpha = 0.55 + 0.35 * pulse;
  ctx.fillStyle = '#ff4030';
  ctx.fillRect(r * 0.6, -hw, len - r * 0.6, 2);
  ctx.fillRect(r * 0.6, hw - 2, len - r * 0.6, 2);
  // Chevrons sweeping toward the target
  ctx.strokeStyle = '#ffb0a0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const sp = 46, off = (t * 160) % sp;
  for (let u = r + off; u < len - 12; u += sp) {
    ctx.moveTo(u, -hw * 0.55); ctx.lineTo(u + 14, 0); ctx.lineTo(u, hw * 0.55);
  }
  ctx.globalAlpha = 0.45 + 0.4 * prog;
  ctx.stroke();
  ctx.restore();
}

// Torch flames on the wall tiles picked by findTorches (theme.torch). Drawn every frame (not in
// the static layer): an additive amber glow sprite plus a flame, both flickering with wall time
// through a sum of sines per torch (seeded from the tile index).
let torchGlow = null;
function getTorchGlow() {
  if (torchGlow || typeof document === 'undefined') return torchGlow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,170,70,0.9)');
  grad.addColorStop(0.25, 'rgba(255,130,40,0.45)');
  grad.addColorStop(0.6, 'rgba(200,80,20,0.12)');
  grad.addColorStop(1, 'rgba(160,50,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  torchGlow = c;
  return c;
}

function drawTorches(view, now) {
  const list = staticLayer && staticLayer.torches;
  if (!list || !list.length) return;
  const glow = getTorchGlow();
  ctx.save();
  for (let i = 0; i < list.length; i++) {
    const tc = list[i];
    if (!inView(view, tc.x, tc.y, 70)) continue;
    const sd = tc.seed;
    const fl = 0.8 + 0.1 * Math.sin(now * 9.1 + sd) + 0.07 * Math.sin(now * 23.3 + sd * 1.7) +
      0.05 * (hash(Math.floor(now * 14) + sd) - 0.5);
    if (glow) {
      const sz = 120 * (0.9 + fl * 0.2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.34 * fl;
      ctx.drawImage(glow, tc.x + tc.dx * 8 - sz / 2, tc.y + tc.dy * 8 - sz / 2, sz, sz);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Iron bracket
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1b1410';
    ctx.fillRect(tc.x - 3, tc.y - 3, 6, 6);
    // Flame, leaning out of the wall
    const fx = tc.x + tc.dx * 3, fy = tc.y + tc.dy * 3 - 1;
    ctx.fillStyle = '#ff8a1e';
    ctx.beginPath();
    ctx.arc(fx, fy, 3.2 + fl * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.arc(fx + tc.dx, fy + tc.dy - 0.5, 1.4 + fl, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Boss death shock ring ('bossDeath' effect, BOSS_RING_TTL): red-white ring over the first 0.6 s.
function drawBossDeath(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  const R = e.r > 0 ? e.r : 70;
  if (!inView(view, e.x, e.y, R * 2.1)) return;
  const age = e.maxTtl - e.ttl;
  if (age >= 0.6) return;
  const f = age / 0.6;
  ctx.save();
  ctx.globalAlpha = 1 - f;
  ctx.lineWidth = 6 * (1 - f) + 1;
  ctx.strokeStyle = f < 0.3 ? '#ffffff' : '#ff5040';
  ctx.beginPath();
  ctx.arc(e.x, e.y, R * (0.4 + f * 1.6), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Boss blood pool: zombie.js's boss 'blood' effect (radius 44, boss:true) drawn as a large, lobed
// pool that spreads over ~1.2 s and fades in its last 3 s.
function drawBossPool(e, view) {
  const R = (e.radius > 0 ? e.radius : 44) * 1.6;
  if (!inView(view, e.x, e.y, R * 1.3)) return;
  const age = e.maxTtl - e.ttl;
  const g0 = Math.min(1, age / 1.2);
  const grow = 1 - (1 - g0) * (1 - g0);
  const fade = Math.min(1, e.ttl / 3);
  const seed = Math.floor(e.x * 3.1 + e.y * 7.3);
  ctx.save();
  ctx.globalAlpha = 0.9 * fade;
  ctx.fillStyle = '#4a0505';
  ctx.beginPath();
  ctx.arc(e.x, e.y, R * 0.55 * grow, 0, Math.PI * 2);
  for (let k = 0; k < 11; k++) {
    const a = hash(seed + k * 13) * Math.PI * 2;
    const d = R * (0.3 + hash(seed + k * 29) * 0.3) * grow;
    const rr = R * (0.16 + hash(seed + k * 41) * 0.18) * grow;
    const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d;
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, rr, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = COLORS.blood;
  ctx.globalAlpha = 0.75 * fade;
  ctx.beginPath();
  ctx.arc(e.x - R * 0.06, e.y - R * 0.05, R * 0.38 * grow, 0, Math.PI * 2);
  for (let k = 0; k < 14; k++) {  // satellite drops
    const a = hash(seed + k * 53) * Math.PI * 2;
    const d = R * (0.75 + hash(seed + k * 61) * 0.45) * grow;
    const rr = 2 + hash(seed + k * 67) * 4;
    const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d;
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, rr, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,200,200,0.12)';  // wet highlight
  ctx.globalAlpha = fade;
  ctx.beginPath();
  ctx.ellipse(e.x - R * 0.15, e.y - R * 0.15, R * 0.14 * grow, R * 0.07 * grow, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// theme.ambient: flat full-screen tint (null / '' = none, e.g. level 1).
function drawAmbient(theme, W, H) {
  if (!theme || !theme.ambient) return;
  ctx.fillStyle = theme.ambient;
  ctx.fillRect(0, 0, W, H);
}

// Level transition (level.js 3.3): black overlay, alpha 0 -> 1 at t = dur/2 (the level swap),
// then 1 -> 0 at t = dur.
function transitionAlpha(tr) {
  if (!tr) return 0;
  const dur = tr.dur > 0 ? tr.dur : ((CFG.LEVELS_CFG && CFG.LEVELS_CFG.fadeSeconds) || 1.2);
  const t = Number.isFinite(tr.t) ? tr.t : 0;
  const h = dur / 2;
  const a = t < h ? t / h : 1 - (t - h) / h;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
function drawTransition(state, W, H) {
  const a = transitionAlpha(state.transition);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
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

// WO8 FIX-B (playtest #8): upgraded wonder-weapon effect colours. Porter's X2 Ray Gun: red-pink
// bolt, muzzle and splash; Zeus Cannon: gold-white shockwave. Effects carry no weapon, so an
// explosion / shockwave is latched as upgraded (e.pap) on its first draw when its radius / range
// matches the upgraded def (weapons.UPGRADES, checked with isUpgraded) and not the base def.
const RAY_FX = { trail: 'rgba(80,255,110,0.35)', glow: '#50ff6e', core: '#b8ffc4' };
const PAP_FX = {
  ray: { trail: 'rgba(255,70,120,0.4)', glow: '#ff3d7f', core: '#ffc4d8', splash: '#ff4d88' },
  zeus: { arcs: [[1, 7, '#fffbe8', 0.9], [0.8, 5, '#ffcc33', 0.7], [0.58, 3, '#fff0b0', 0.45]], fill: '#ffe9a0', dust: '#e8c060' },
};
function upgradedFxDef(id) {
  try {
    const U = weaponsMod.UPGRADES;
    const d = U && U[id];
    return d && isUpgradedWeapon({ def: d }) ? d : null;
  } catch (_) { return null; }
}
function latchPapFx(e, id, pick) {
  if (e.pap !== undefined) return e.pap;
  let up = false;
  try {
    const ud = upgradedFxDef(id), bd = weaponDef(id);
    const uv = ud ? pick(ud) : NaN, bv = bd ? pick(bd) : NaN;
    const v = pick(e);
    up = Number.isFinite(v) && Number.isFinite(uv) && Math.abs(v - uv) < 0.5 && !(Math.abs(v - bv) < 0.5);
  } catch (_) { up = false; }
  e.pap = up;
  return up;
}

function drawBullets(state) {
  const bs = state.bullets;
  if (!Array.isArray(bs) || !bs.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of bs) {
    if (!b) continue;
    if (b.kind === 'acid' || (b.def && b.def.kind === 'acid')) { drawAcidGlob(b, b.x, b.y, 0); continue; }
    const vx = b.vx || 0, vy = b.vy || 0;
    // WO8 FIX-B (playtest #8): Porter's X2 Ray Gun bolts are red-pink.
    const pc = isUpgradedWeapon(b) ? PAP_FX.ray : RAY_FX;
    ctx.strokeStyle = pc.trail;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(b.x - vx * 0.05, b.y - vy * 0.05);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.shadowColor = pc.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = pc.core;
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
const poseScratch = { entry: null, x: 0, y: 0, angle: 0, qa: 0, ox: 0, oy: 0, rx: 0, ry: 0, pap: false };
function resolveTorsoPose(state, out) {
  const p = state && state.player;
  const S = soldierMod.SOLDIER;
  if (!p || p.down || p.downT > 0 || !S || !S.torso) return null;
  const w = activeWeapon(p);
  const def = activeWeaponDef(w);
  // WO8: an upgraded gun keeps its base art (looked up from the base def), recoloured with the
  // Pack-a-Punch camo; the tinted entry is cached per base sprite (wall-buy chalk art untouched).
  const up = isUpgradedWeapon(w);
  // WO8 FIX-B (review L2): empty hands (the only gun is in the Pack-a-Punch) -> no gun layer and
  // the free-hand 'onehand' torso, instead of gunSpriteFor(null)'s default gun art.
  const gun = !w ? null : up ? papGunEntry(gunEntryFor(baseDefOf(w, def))) : gunEntryFor(def);
  const animPose = anim && (anim.gunPose || (anim.pose !== 'knife' ? anim.pose : null)); // WO7: 'knife' is not a gun pose
  const pose = !w ? 'onehand' : (gun && gun.pose) || animPose || 'twohand';
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
  // WO7 T3: knife swing (animator pose 'knife' + meleeFrame, else player.meleeT) replaces the
  // torso + gun with SOLDIER.torso.knife[frame] (arm and blade are in the torso art).
  const kf = knifeTorso(T, p);
  if (kf) torso = kf;
  if (!torso || !torso.pixels) return null;
  const entry = getTorsoGun(torso, kf ? null : gun, kf ? 'knife' : pose, kf ? 0 : offX, kf ? 0 : offY);
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
  out.pap = up && !kf;
  return out;
}

function knifeTorso(T, p) {
  const K = T && T.knife;
  if (!Array.isArray(K) || !K.length) return null;
  const animKnife = anim && anim.pose === 'knife';
  if (!animKnife && !(p.meleeT > 0)) return null;
  let f;
  if (anim && Number.isFinite(anim.meleeFrame)) f = anim.meleeFrame | 0;
  else {
    const sw = (CFG.MELEE && CFG.MELEE.swingTime) || 0.25;
    f = p.meleeT > sw * 0.6 ? 0 : 1; // cocked for the first 40 % of the swing, then the thrust
  }
  f = Math.max(0, Math.min(K.length - 1, f));
  const sp = K[f] && K[f].pixels ? K[f] : (K[f] && K[f].sprite && K[f].sprite.pixels ? K[f].sprite : null);
  return sp;
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
  const qrDown = !p.down && p.downT > 0; // WO7 T2: Quick Revive "down" pause
  if (!p.down && !qrDown) downSince = null;
  try {
    if (qrDown) { drawReviveDown(p, S, scale, dirs, t); return; }
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
    // FIX-1 (playtest #9): faint light ground ring so the player pops out of a crowd.
    drawPlayerRing(p, scale);
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
    frameMuzzle = muzzleFromPose(ps, muzzleScratch);
    // WO8: faint purple glow around an upgraded gun (under the sprite, between hand and muzzle).
    if (ps.pap) drawPapGunGlow(ps, frameMuzzle, state.time || 0);
    drawCrisp(e.sprite, p.x, p.y, ps.ox, ps.oy, ps.angle, e.ax, e.ay, scale, dirs);
    frameMuzzleRest.x = frameMuzzle.x - ps.rx;
    frameMuzzleRest.y = frameMuzzle.y - ps.ry;
  } catch (_) {
    drawPlayerFallback(p);
  }
}

const PLAYER_RING = Object.assign({ alpha: 0.4, color: '#e8f4ff' }, RENDER.playerRing || {});
function drawPlayerRing(p, scale) {
  const r = (p.radius || 14) + 3;
  ctx.save();
  ctx.globalAlpha = PLAYER_RING.alpha;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = PLAYER_RING.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
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
// Quick Revive down: the lying sprite on a small pool, with a cyan ring filling up as the
// revive approaches (PERKS.list.revive.downSeconds).
function drawReviveDown(p, S, scale, dirs, now) {
  if (downSince == null || downSince > now) downSince = now;
  drawBloodPool(p.x, p.y, Math.min(0.4, now - downSince), scale);
  const d = S.down;
  if (d && d.sprite && d.sprite.pixels) {
    const a = d.anchor || { x: d.sprite.w / 2, y: d.sprite.h / 2 };
    drawCrisp(d.sprite, p.x, p.y, 0, 0, 0, a.x, a.y, scale, dirs);
  } else drawPlayerFallback(p);
  const R = CFG.PERKS && CFG.PERKS.list && CFG.PERKS.list.revive;
  const total = R && R.downSeconds > 0 ? R.downSeconds : 1.5;
  const f = Math.max(0, Math.min(1, 1 - p.downT / total));
  const col = (R && R.color) || '#3ec9ff';
  ctx.save();
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

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

let fxState = null; // the state whose effects are being drawn (drawMuzzle reads the held gun)
function drawEffectsOfType(state, type, view) {
  fxState = state;
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
      case 'papSparkle': drawPapSparkle(e, view); break;
      case 'bossDeath': drawBossDeath(e, view); break;
      case 'slash': drawSlash(e, view); break;
      case 'text': drawText(e, view); break;
      default: break;
    }
  }
}

function drawBlood(e, view, i) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  if (e.boss) { drawBossPool(e, view); return; }
  if (!inView(view, e.x, e.y, 30)) return;
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
  let mc = e.color || 'rgba(255,200,80,0.6)';
  if (snap && e.color && e.pap === undefined) {
    // FIX-B (#8): a wonder-weapon flash at the player's muzzle takes the held gun's upgrade state.
    const w = activeWeapon(fxState && fxState.player);
    const d = w && (w.def || weaponDef(w.id));
    e.pap = !!(d && (d.projectile || d.cone) && isUpgradedWeapon(w)) ? (d.cone ? 'zeus' : 'ray') : false;
  }
  if (e.pap === 'ray') mc = PAP_FX.ray.splash;
  else if (e.pap === 'zeus') mc = '#ffd54a';
  ctx.fillStyle = mc;
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
  const isRay = e.color && CFG.WEAPON_FX && e.color === CFG.WEAPON_FX.raygunColor;
  const up = isRay && latchPapFx(e, 'raygun', (o) => (o.projectile ? o.projectile.splashRadius : o.radius));
  const col = up ? PAP_FX.ray.splash : (e.color || COLORS.powerupGlow);
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
  const up = latchPapFx(e, 'thundergun', (o) => (o.cone ? o.cone.range : o.range));
  const arcs = up ? PAP_FX.zeus.arcs : SHOCK_ARCS;
  ctx.save();
  // Clip to the cone
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, range + 12, ang - half, ang + half);
  ctx.closePath();
  ctx.clip();
  // Faint pressure fill behind the front
  ctx.globalAlpha = 0.18 * f;
  ctx.fillStyle = up ? PAP_FX.zeus.fill : '#bfefff';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, R, ang - half, ang + half);
  ctx.closePath();
  ctx.fill();
  // Expanding arcs (front is brightest)
  ctx.lineCap = 'round';
  for (let i = 0; i < arcs.length; i++) {
    const arc = arcs[i];
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
  ctx.fillStyle = up ? PAP_FX.zeus.dust : '#b8a888';
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

// FIX-3 (playtest #6): once the mega door is sealed its "MEGA DOOR OPENED" text is dropped, so it
// never shows through the red SEALED plates. render() sets sealedMegaBox each frame.
let sealedMegaBox = null;
const MEGA_OPENED_TEXT = 'MEGA DOOR OPENED';
function drawText(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inView(view, e.x, e.y, 60)) return;
  if (sealedMegaBox && e.text === MEGA_OPENED_TEXT) {
    const b = sealedMegaBox, m = 90;
    if (e.x > b.x - m && e.x < b.x + b.w + m && e.y > b.y - m && e.y < b.y + b.h + m) { e.ttl = 0; return; }
  }
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

// ---------------------------------------------------------------------------
// WO7 T3 / T5: knife slash, acid pools + globs, lab flicker
// ---------------------------------------------------------------------------

// 'slash' {x, y, angle, ttl, maxTtl}: a white crescent sweeping across the knife cone
// (MELEE.halfAngle either side of `angle`) at about the reach, fading over its life.
function drawSlash(e, view) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  const M = CFG.MELEE || {};
  const R = e.r > 0 ? e.r : 14 + (M.reach || 44) * 0.75;
  if (!inView(view, e.x, e.y, R + 10)) return;
  const half = e.halfAngle > 0 ? e.halfAngle : (M.halfAngle || 0.7);
  const ang = Number.isFinite(e.angle) ? e.angle : 0;
  const p = 1 - lifeFrac(e);           // 0 -> 1 over the swing
  const sweep = Math.min(1, p * 1.8);  // the blade crosses the cone in the first ~55 %
  const a0 = ang - half, a1 = ang - half + 2 * half * sweep;
  const tail = Math.max(a0, a1 - 1.1);
  const fade = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
  ctx.save();
  ctx.lineCap = 'round';
  // Soft outer smear
  ctx.globalAlpha = 0.25 * fade;
  ctx.strokeStyle = '#dfe8ff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(e.x, e.y, R - 2, tail, a1);
  ctx.stroke();
  // Crescent: a few arcs, thicker toward the leading edge
  for (let k = 0; k < 3; k++) {
    const s = tail + (a1 - tail) * (k / 3);
    ctx.globalAlpha = (0.45 + 0.25 * k) * fade;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 + k * 1.2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, R + k * 0.5, s, a1);
    ctx.stroke();
  }
  // Glint at the blade tip
  if (fade > 0 && sweep < 1) {
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(e.x + Math.cos(a1) * R - 2, e.y + Math.sin(a1) * R - 2, 4, 4);
  }
  ctx.restore();
}

// Acid pools (state.hazards kind 'acid' {x, y, r, ttl, maxTtl}): a green lobed puddle that
// spreads in over 0.3 s and fades out over its last second, with bubbles rising and popping
// (deterministic from game time and the pool id).
function drawHazards(state, view, t) {
  const hs = state.hazards;
  if (!Array.isArray(hs) || !hs.length) return;
  ctx.save();
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    if (!h || h.kind !== 'acid' || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
    const R = h.r > 0 ? h.r : 50;
    if (!inView(view, h.x, h.y, R * 1.3)) continue;
    const max = h.maxTtl > 0 ? h.maxTtl : 5;
    const ttl = Number.isFinite(h.ttl) ? h.ttl : max;
    const age = Math.max(0, max - ttl);
    const grow = Math.min(1, age / 0.3);
    const rr = R * (0.35 + 0.65 * (1 - (1 - grow) * (1 - grow)));
    const fade = Math.max(0, Math.min(1, ttl / 1.0));
    const seed = (Number.isFinite(h.id) ? h.id : i) * 17.3 + Math.floor(h.x) * 0.13 + Math.floor(h.y) * 0.29;
    // Dark scorched rim + body lobes
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = '#1f4a10';
    ctx.beginPath();
    ctx.arc(h.x, h.y, rr, 0, Math.PI * 2);
    for (let k = 0; k < 7; k++) {
      const a = hash(seed + k * 3.1) * Math.PI * 2;
      const d = rr * (0.55 + hash(seed + k * 5.7) * 0.3);
      const lr = rr * (0.28 + hash(seed + k * 7.9) * 0.2);
      const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
      ctx.moveTo(x + lr, y);
      ctx.arc(x, y, lr, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 0.6 * fade;
    ctx.fillStyle = '#4fb82a';
    ctx.beginPath();
    ctx.arc(h.x, h.y, rr * 0.82, 0, Math.PI * 2);
    ctx.fill();
    // Glossy core, gently pulsing
    ctx.globalAlpha = (0.35 + 0.1 * Math.sin(t * 5 + seed)) * fade;
    ctx.fillStyle = '#9dff5a';
    ctx.beginPath();
    ctx.ellipse(h.x - rr * 0.15, h.y - rr * 0.18, rr * 0.4, rr * 0.25, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // Bubbles: 6 slots, each grows over its own 0.7-1.1 s cycle then pops
    for (let k = 0; k < 6; k++) {
      const per = 0.7 + hash(seed + k * 11.3) * 0.4;
      const ph = ((t + hash(seed + k * 13.7) * per) % per) / per;
      const cyc = Math.floor((t + hash(seed + k * 13.7) * per) / per);
      const a = hash(seed + k * 19.1 + cyc * 3.3) * Math.PI * 2;
      const d = rr * 0.7 * Math.sqrt(hash(seed + k * 23.9 + cyc * 5.1));
      const bx = h.x + Math.cos(a) * d, by = h.y + Math.sin(a) * d;
      if (ph < 0.85) {
        const br = 1.5 + ph * 4;
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = '#c8ff9a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#e8ffd0';
        ctx.fillRect(bx - br * 0.5, by - br * 0.6, 1.5, 1.5);
      } else {
        // pop: a few droplets flung out
        const q = (ph - 0.85) / 0.15;
        ctx.globalAlpha = 0.7 * (1 - q) * fade;
        ctx.fillStyle = '#b8ff80';
        for (let j = 0; j < 4; j++) {
          const da = j * 1.571 + a;
          ctx.fillRect(bx + Math.cos(da) * (3 + q * 5) - 1, by + Math.sin(da) * (3 + q * 5) - 1, 2, 2);
        }
      }
    }
    // Fumes above the pool
    ctx.globalAlpha = 0.12 * fade;
    ctx.fillStyle = '#b8ff80';
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.6 + k / 3 + hash(seed + k)) % 1;
      ctx.beginPath();
      ctx.arc(h.x + (hash(seed + k * 29) - 0.5) * rr, h.y - ph * rr * 0.8, 5 + ph * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Acid globs in flight: state.acidGlobs (Agent H) {sx, sy, tx, ty, ttl, maxTtl, r} lobbed on a
// parabola (purely visual height), drawn as a green blob with a dripping trail over a ground
// shadow that closes in on the landing point.
const GLOB_ARC = 70; // peak visual height in world px
function drawAcidGlobs(state, view) {
  const gs = state.acidGlobs;
  if (!Array.isArray(gs) || !gs.length) return;
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    if (!g) continue;
    const hasPath = Number.isFinite(g.sx) && Number.isFinite(g.sy) && Number.isFinite(g.tx) && Number.isFinite(g.ty);
    const max = g.maxTtl > 0 ? g.maxTtl : 0.8;
    const p = Math.max(0, Math.min(1, 1 - (Number.isFinite(g.ttl) ? g.ttl : 0) / max));
    let gx = g.x, gy = g.y;
    if (hasPath) { gx = g.sx + (g.tx - g.sx) * p; gy = g.sy + (g.ty - g.sy) * p; }
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || !inView(view, gx, gy, GLOB_ARC + 30)) continue;
    // Ground shadow + landing marker
    if (hasPath) {
      // FIX-1 (playtest #14): dark outline under a bright yellow-green dash, readable on the
      // pale lab floor.
      const rr = (g.r > 0 ? g.r : 50) * (0.4 + 0.6 * p);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.4 * p;
      ctx.beginPath();
      ctx.arc(g.tx, g.ty, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(8,20,4,0.85)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#c8ff3a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(gx, gy + 2, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const hgt = hasPath ? 4 * GLOB_ARC * p * (1 - p) : 0;
    // Trail: earlier points on the arc
    if (hasPath) {
      ctx.save();
      for (let k = 4; k >= 1; k--) {
        const q = Math.max(0, p - k * 0.035);
        const qx = g.sx + (g.tx - g.sx) * q, qy = g.sy + (g.ty - g.sy) * q - 4 * GLOB_ARC * q * (1 - q);
        ctx.globalAlpha = 0.5 - k * 0.1;
        ctx.fillStyle = '#6fd03a';
        ctx.beginPath();
        ctx.arc(qx, qy, 5 - k * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    drawAcidGlob(g, gx, gy - hgt, hasPath ? 0 : 1);
  }
}

// One green blob (also used for kind 'acid' entries in state.bullets). `trail` 1 draws a velocity
// streak behind it (no path information).
function drawAcidGlob(g, x, y, trail) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ctx.save();
  if (trail) {
    const vx = g.vx || 0, vy = g.vy || 0;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(111,208,58,0.45)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x - vx * 0.06, y - vy * 0.06);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.shadowColor = '#7fe040';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#4fb82a';
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#9dff5a';
  ctx.beginPath();
  ctx.arc(x - 1.5, y - 1.5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0ffe0';
  ctx.fillRect(x - 3, y - 3, 2, 2);
  ctx.restore();
}

// theme.flicker (LABORATORY): a failing fluorescent tube, as a rare, subtle mood dim (FIX-1,
// playtest #1: the WO7 version strobed). Game time is cut into RENDER.flicker.period windows;
// every window holds exactly one burst starting at a hashed offset in [0, period - minGap], so
// consecutive bursts start minGap..(2*period - minGap) s apart (8-20 s by default). A burst is
// 1..maxDips smooth sin^2 dips of dipTime s whose starts are dipGap s apart (< 3 flashes per
// second, WCAG 2.3.1), each darkening to alphaMin..alphaMax. Deterministic from state.time
// (freezes when paused). Skipped entirely under prefers-reduced-motion.
const FLICKER = Object.assign(
  { period: 14, minGap: 8, maxDips: 2, dipTime: 0.24, dipGap: 0.42, alphaMin: 0.08, alphaMax: 0.18 },
  RENDER.flicker || {});
let reducedMotionMq; // undefined = not looked up yet, null = unsupported
function prefersReducedMotion() {
  if (reducedMotionMq === undefined) {
    try {
      reducedMotionMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch (_) { reducedMotionMq = null; }
  }
  return !!(reducedMotionMq && reducedMotionMq.matches);
}
function flickerAlpha(t) {
  const P = FLICKER.period > 0 ? FLICKER.period : 14;
  const w = Math.floor(t / P);
  const start = hash(w * 3.71 + 1.3) * Math.max(0, P - FLICKER.minGap);
  const u = t - w * P - start;
  if (u < 0) return 0;
  const dips = 1 + Math.floor(hash(w * 9.91 + 4.2) * Math.max(1, FLICKER.maxDips | 0));
  const gap = Math.max(FLICKER.dipGap, FLICKER.dipTime);
  let a = 0;
  for (let d = 0; d < dips; d++) {
    const v = u - d * gap;
    if (v < 0 || v >= FLICKER.dipTime) continue;
    const s = Math.sin(Math.PI * v / FLICKER.dipTime);
    const amp = FLICKER.alphaMin + hash(w * 11.3 + d * 1.7) * (FLICKER.alphaMax - FLICKER.alphaMin);
    a = Math.max(a, amp * s * s);
  }
  return a;
}
function drawFlicker(t, W, H) {
  if (prefersReducedMotion()) return;
  const a = flickerAlpha(t);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#02040a';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// WO9 (Agent F): KINO / OUTPOST / TEMPLE looks (static layer), pit tiles '~', water / snow /
// spores / film-grain overlays, frost breath + tide ring, frosty slowed player.
// ---------------------------------------------------------------------------
const WO9_STYLES = ['kino', 'outpost', 'temple'];
// theme.style wins; otherwise the theme name prefix (loop themes are named 'KINO — FLOODED' and
// level.loopTheme() drops `style`).
function resolveStyle(raw) {
  const s = typeof raw.style === 'string' ? raw.style.toLowerCase() : '';
  if (WO9_STYLES.indexOf(s) >= 0) return s;
  const n = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (/^KINO\b/i.test(n)) return 'kino';
  if (/^OUTPOST\b/i.test(n)) return 'outpost';
  if (/^TEMPLE\b/i.test(n)) return 'temple';
  return '';
}

// Integer hash -> [0, 1) (better spread than the sin hash for dense noise).
function ihash(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function fract(v) { return v - Math.floor(v); }
function rgbaHex(hex, a) {
  const c = hexRgb(hex) || [128, 128, 128];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
// Mixes two #rrggbb colours (f = 0 -> a, 1 -> b), then scales brightness by k.
function mixHex(a, b, f, k) {
  const x = hexRgb(a) || [0, 0, 0], y = hexRgb(b) || x;
  const m = (i) => Math.max(0, Math.min(255, Math.round((x[i] + (y[i] - x[i]) * f) * (k || 1)))).toString(16).padStart(2, '0');
  return '#' + m(0) + m(1) + m(2);
}
function isOpenish(code) { return isOpenFloorCode(code) || code === T_DOOR; }

// Wall tiles the WO9 styles repaint as non-wall decor (seat rows, curtains, fences): no torches.
let styleNoTorch = null;
// FIX-2: wall tiles a WO9 painter draws with their own outline (KINO props, brick, cinder): the
// generic wallEdge line (gold on KINO) is skipped for them.
let styleNoEdge = null;

// Connected wall masses (4-neighbour). Everything solid-ish connects (walls, buys, perks, doors,
// windows, pockets, stairs) so a wall run between two doors still counts as part of its building;
// floor, open spawns, arena floor, the box and pits separate. `walls` = plain T_WALL tiles.
function wallComponents(map, cols, rows) {
  const T = map.tiles, n = cols * rows;
  const comp = new Int32Array(n).fill(-1);
  const list = [];
  const stack = [];
  const conn = (c) => c != null && c !== T_FLOOR && c !== T_OPEN && c !== T_ARENA && c !== T_BOX && c !== T_PIT;
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || !conn(T[i])) continue;
    const info = { id: list.length, walls: 0, other: 0, border: false, x0: cols, y0: rows, x1: -1, y1: -1 };
    stack.length = 0; stack.push(i); comp[i] = info.id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % cols, y = (j / cols) | 0;
      if (T[j] === T_WALL) info.walls++; else info.other++;
      if (x < info.x0) info.x0 = x; if (x > info.x1) info.x1 = x;
      if (y < info.y0) info.y0 = y; if (y > info.y1) info.y1 = y;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) info.border = true;
      if (x > 0 && comp[j - 1] < 0 && conn(T[j - 1])) { comp[j - 1] = info.id; stack.push(j - 1); }
      if (x < cols - 1 && comp[j + 1] < 0 && conn(T[j + 1])) { comp[j + 1] = info.id; stack.push(j + 1); }
      if (y > 0 && comp[j - cols] < 0 && conn(T[j - cols])) { comp[j - cols] = info.id; stack.push(j - cols); }
      if (y < rows - 1 && comp[j + cols] < 0 && conn(T[j + cols])) { comp[j + cols] = info.id; stack.push(j + cols); }
    }
    info.bw = info.x1 - info.x0 + 1; info.bh = info.y1 - info.y0 + 1;
    list.push(info);
  }
  return { comp, list };
}

// Which sides of tile (tx, ty) face walkable floor: bit 1 up, 2 down, 4 left, 8 right.
function openSides(map, tx, ty) {
  return (isOpenish(tileAt(map, tx, ty - 1)) ? 1 : 0) | (isOpenish(tileAt(map, tx, ty + 1)) ? 2 : 0) |
    (isOpenish(tileAt(map, tx - 1, ty)) ? 4 : 0) | (isOpenish(tileAt(map, tx + 1, ty)) ? 8 : 0);
}

// ---- floors ----
function paintStyleFloor(c, map, th, cols, rows) {
  const W = cols * TILE, H = rows * TILE;
  c.save();
  if (th.style === 'kino') {
    // Carpet: a floorAlt diamond in every tile inside a gold diamond lattice, gold centre studs,
    // dark nap specks.
    c.fillStyle = th.floorAlt;
    c.beginPath();
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const x = tx * TILE, y = ty * TILE, h = TILE / 2;
      c.moveTo(x + h, y + 5); c.lineTo(x + TILE - 5, y + h); c.lineTo(x + h, y + TILE - 5); c.lineTo(x + 5, y + h); c.closePath();
    }
    c.fill();
    c.strokeStyle = rgbaHex(th.accent, 0.32);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let k = -H; k <= W + H; k += TILE) {
      const o = k + TILE / 2;
      c.moveTo(o, 0); c.lineTo(o + H, H);          // x - y = o
      c.moveTo(o, 0); c.lineTo(o - H, H);          // x + y = o
    }
    c.stroke();
    c.fillStyle = rgbaHex(th.accent, 0.5);
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) c.fillRect(tx * TILE + 19, ty * TILE + 19, 2, 2);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      for (let k = 0; k < 4; k++) {
        const h = ihash((ty * cols + tx) * 7 + k);
        c.fillRect(tx * TILE + Math.floor(h * 38), ty * TILE + Math.floor(ihash(h * 1e6 + k) * 38), 1, 1);
      }
    }
    paintKinoZoneFloors(c, map, th, cols, rows);   // FIX-2: boards / asphalt / concrete zones
  } else if (th.style === 'outpost') {
    // Snow: soft drifts (bright ellipse with a blue shadow), wind streaks, drift speckles.
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx, x = tx * TILE, y = ty * TILE;
      const h = ihash(i * 3 + 1);
      if (h > 0.8) {
        const cx = x + 8 + ihash(i * 5) * 24, cy = y + 8 + ihash(i * 5 + 1) * 24;
        const rx = 12 + ihash(i * 5 + 2) * 14, ry = 4 + ihash(i * 5 + 3) * 4;
        c.fillStyle = 'rgba(150,175,205,0.22)';
        c.beginPath(); c.ellipse(cx + 1, cy + 3, rx, ry, -0.15, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.beginPath(); c.ellipse(cx, cy, rx, ry, -0.15, 0, Math.PI * 2); c.fill();
      } else if (h < 0.08) {
        c.strokeStyle = 'rgba(150,175,205,0.3)';
        c.lineWidth = 1;
        c.beginPath();
        const sx = x + ihash(i * 7) * 20, sy = y + 6 + ihash(i * 7 + 1) * 28;
        c.moveTo(sx, sy); c.lineTo(sx + 18 + ihash(i * 7 + 2) * 16, sy - 3);
        c.stroke();
      }
      const n = 3 + Math.floor(ihash(i * 11) * 4);
      for (let k = 0; k < n; k++) {
        const u = ihash(i * 13 + k), v = ihash(i * 17 + k * 3);
        const blue = ihash(i * 19 + k) > 0.55;
        c.fillStyle = blue ? 'rgba(120,150,185,0.35)' : 'rgba(255,255,255,0.8)';
        c.fillRect(x + Math.floor(u * 38), y + Math.floor(v * 38), blue ? 1 : 2, blue ? 1 : 2);
      }
    }
  } else if (th.style === 'temple') {
    // Flagstones: mortar, then one / two / four stones per tile shaded between floor and floorAlt,
    // moss tufts at the joints and hairline cracks.
    c.fillStyle = shadeHex(th.floor, 0.58);
    c.fillRect(0, 0, W, H);
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx, x = tx * TILE, y = ty * TILE;
      const p = ihash(i * 5 + 2);
      const stone = (sx, sy, sw, sh, k) => {
        c.fillStyle = mixHex(th.floor, th.floorAlt, ihash(i * 9 + k), 0.9 + ihash(i * 23 + k) * 0.2);
        c.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);
        c.fillStyle = 'rgba(255,255,230,0.06)';
        c.fillRect(sx + 1, sy + 1, sw - 2, 1);
      };
      if (p < 0.4) stone(x, y, TILE, TILE, 0);
      else if (p < 0.7) {
        if (ihash(i * 3) > 0.5) { stone(x, y, TILE, TILE / 2, 0); stone(x, y + TILE / 2, TILE, TILE / 2, 1); }
        else { stone(x, y, TILE / 2, TILE, 0); stone(x + TILE / 2, y, TILE / 2, TILE, 1); }
      } else {
        const hw = TILE / 2;
        stone(x, y, hw, hw, 0); stone(x + hw, y, hw, hw, 1); stone(x, y + hw, hw, hw, 2); stone(x + hw, y + hw, hw, hw, 3);
      }
      if (ihash(i * 29) > 0.5) {
        const nm = 1 + Math.floor(ihash(i * 31) * 3);
        c.fillStyle = rgbaHex(hintsOf(th).moss, 0.4);
        c.beginPath();
        for (let k = 0; k < nm; k++) {
          const side = Math.floor(ihash(i * 37 + k) * 4);
          const u = 4 + ihash(i * 41 + k) * 32;
          const mx = side < 2 ? x + u : x + (side === 2 ? 1 : TILE - 1);
          const my = side < 2 ? y + (side === 0 ? 1 : TILE - 1) : y + u;
          const r = 2.5 + ihash(i * 43 + k) * 4;
          c.moveTo(mx + r, my); c.arc(mx, my, r, 0, Math.PI * 2);
        }
        c.fill();
      }
      if (ihash(i * 47) > 0.78) {
        c.strokeStyle = 'rgba(18,22,16,0.55)';
        c.lineWidth = 1;
        c.beginPath();
        let cx = x + 6 + ihash(i * 53) * 28, cy = y + 6 + ihash(i * 59) * 28;
        c.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += (ihash(i * 61 + k) - 0.5) * 14; cy += (ihash(i * 67 + k) - 0.5) * 14;
          c.lineTo(Math.max(x + 1, Math.min(x + TILE - 1, cx)), Math.max(y + 1, Math.min(y + TILE - 1, cy)));
        }
        c.stroke();
      }
    }
  }
  c.restore();
}

// FIX-2 (WO9 QA OUTPOST #9): an open spawn on snow is a dug-up, churned hole (not a UI square):
// trampled blue-grey snow, a dark frozen-earth hole, a few white clods and claw scrapes at the rim.
function paintSnowHole(c, x, y, i) {
  const cx = x + TILE / 2, cy = y + TILE / 2 + 1;
  c.save();
  c.fillStyle = 'rgba(120,145,170,0.28)';
  c.beginPath(); c.ellipse(cx, cy + 1, 17, 12.5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#9fb4c8';
  c.beginPath(); c.ellipse(cx, cy, 14, 10, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5f7488';
  c.beginPath(); c.ellipse(cx, cy + 0.5, 9, 6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2a3440';
  c.beginPath(); c.ellipse(cx + 0.5, cy + 1.5, 6, 3.6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(60,40,30,0.55)';       // frozen earth specks in the hole
  c.fillRect(cx - 3, cy + 1, 2, 1); c.fillRect(cx + 2, cy + 2, 1, 1);
  c.strokeStyle = 'rgba(70,90,110,0.55)';    // claw scrapes out of the hole
  c.lineWidth = 1;
  c.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = ihash(i * 7 + k) * Math.PI * 2;
    const r0 = 11, r1 = 15 + ihash(i * 11 + k) * 4;
    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.72);
    c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.72);
  }
  c.stroke();
  c.fillStyle = '#f4f9fd';                    // clods of snow thrown onto the rim
  for (let k = 0; k < 4; k++) {
    const a = ihash(i * 13 + k) * Math.PI * 2, r = 12 + ihash(i * 17 + k) * 4;
    const s = 2 + Math.floor(ihash(i * 19 + k) * 3);
    c.fillRect(Math.round(cx + Math.cos(a) * r - s / 2), Math.round(cy + Math.sin(a) * r * 0.75 - s / 2), s, s);
  }
  c.restore();
}

// ---- pits ('~', TILE_PIT) ----
function findPits(map) {
  const T = map && map.tiles;
  if (!T) return new Int32Array(0);
  let n = 0;
  for (let i = 0; i < T.length; i++) if (T[i] === T_PIT) n++;
  const out = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < T.length; i++) if (T[i] === T_PIT) out[k++] = i;
  return out;
}

// Pits are never walls (no brick, no wall edge). OUTPOST: dark blue-cyan ice water with an ice
// shelf and cracks on every shore; TEMPLE: deep teal water with a stone lip (ripples are drawn
// per frame by drawTempleWater); anything else: a dark hole with a lip.
function paintPits(c, map, th, cols) {
  const pits = findPits(map);
  if (!pits.length) return;
  const style = th.style;
  const H = hintsOf(th);
  const iceWater = shadeHex(H.iceDeep, 0.6), iceEdge = H.ice, deep = H.waterDeep;
  const notPit = (tx, ty) => tileAt(map, tx, ty) !== T_PIT;
  c.save();
  for (let q = 0; q < pits.length; q++) {
    const i = pits[q], tx = i % cols, ty = (i / cols) | 0, x = tx * TILE, y = ty * TILE;
    const up = notPit(tx, ty - 1), dn = notPit(tx, ty + 1), lf = notPit(tx - 1, ty), rt = notPit(tx + 1, ty);
    if (style === 'outpost') {
      c.fillStyle = iceWater;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = 'rgba(4,22,34,0.45)';
      c.fillRect(x + (lf ? 9 : 0), y + (up ? 9 : 0), TILE - (lf ? 9 : 0) - (rt ? 9 : 0), TILE - (up ? 9 : 0) - (dn ? 9 : 0));
      c.strokeStyle = 'rgba(160,225,245,0.28)';
      c.lineWidth = 1;
      c.beginPath();
      for (let k = 0; k < 2; k++) {
        const gx = x + 8 + ihash(i * 7 + k) * 20, gy = y + 10 + ihash(i * 11 + k) * 20;
        c.moveTo(gx, gy); c.lineTo(gx + 6 + ihash(i * 13 + k) * 6, gy);
      }
      c.stroke();
      if (ihash(i * 17) > 0.7) {  // a small ice floe
        const fx = x + 10 + ihash(i * 19) * 18, fy = y + 10 + ihash(i * 23) * 18;
        c.fillStyle = 'rgba(215,238,248,0.85)';
        c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + 7, fy + 1); c.lineTo(fx + 5, fy + 5); c.lineTo(fx - 1, fy + 4); c.closePath(); c.fill();
      }
      const shelf = (sx, sy, horiz, dir) => {
        // ice band 5 px along the shore with a jagged water-side edge
        c.fillStyle = '#d6ecf6';
        if (horiz) c.fillRect(x, sy, TILE, 5 * dir > 0 ? 5 : -5); else c.fillRect(sx, y, 5 * dir > 0 ? 5 : -5, TILE);
        c.fillStyle = iceEdge;
        c.beginPath();
        for (let k = 0; k < 5; k++) {
          const u = k * 8 + ihash(i * 29 + k + (horiz ? 0 : 50)) * 3;
          const d = 3 + ihash(i * 31 + k + (horiz ? 0 : 50)) * 5;
          if (horiz) { c.moveTo(x + u, sy + 5 * dir); c.lineTo(x + u + 4, sy + (5 + d) * dir); c.lineTo(x + u + 8, sy + 5 * dir); }
          else { c.moveTo(sx + 5 * dir, y + u); c.lineTo(sx + (5 + d) * dir, y + u + 4); c.lineTo(sx + 5 * dir, y + u + 8); }
        }
        c.fill();
        // cracks running from the shore into the snow / ice
        c.strokeStyle = 'rgba(40,95,130,0.55)';
        c.lineWidth = 1;
        c.beginPath();
        for (let k = 0; k < 1; k++) {
          if (ihash(i * 39 + (horiz ? dir : dir * 3)) < 0.5) continue;
          const u = 6 + ihash(i * 37 + k + (horiz ? 0 : 50)) * 28;
          let px = horiz ? x + u : sx, py = horiz ? sy : y + u;
          c.moveTo(px, py);
          for (let s = 0; s < 3; s++) {
            const along = (ihash(i * 41 + k * 3 + s) - 0.5) * 7, out = -(3 + ihash(i * 43 + k * 3 + s) * 4) * dir;
            px += horiz ? along : out; py += horiz ? out : along;
            c.lineTo(px, py);
          }
        }
        c.stroke();
      };
      if (up) shelf(0, y, true, 1);
      if (dn) shelf(0, y + TILE, true, -1);
      if (lf) shelf(x, 0, false, 1);
      if (rt) shelf(x + TILE, 0, false, -1);
    } else if (style === 'temple') {
      c.fillStyle = deep;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = 'rgba(2,20,22,0.4)';                  // depth toward the middle of a channel
      c.fillRect(x + (lf ? 6 : 0), y + (up ? 6 : 0), TILE - (lf ? 6 : 0) - (rt ? 6 : 0), TILE - (up ? 6 : 0) - (dn ? 6 : 0));
      c.fillStyle = 'rgba(0,0,0,0.35)';                  // lip shadow on the far side
      if (up) c.fillRect(x, y, TILE, 7);
      if (lf) c.fillRect(x, y, 5, TILE);
      const lip = shadeHex(th.wall, 0.78);
      c.fillStyle = lip;
      if (up) c.fillRect(x, y, TILE, 3);
      if (dn) c.fillRect(x, y + TILE - 3, TILE, 3);
      if (lf) c.fillRect(x, y, 3, TILE);
      if (rt) c.fillRect(x + TILE - 3, y, 3, TILE);
      c.fillStyle = rgbaHex(H.moss, 0.6);                 // algae / lily pads
      for (let k = 0; k < 1; k++) {
        if (ihash(i * 53 + k) < 0.8) continue;
        const px = x + 8 + ihash(i * 59 + k) * 24, py = y + 8 + ihash(i * 61 + k) * 24;
        c.beginPath(); c.arc(px, py, 2.5 + ihash(i * 67 + k) * 2.5, 0.4, Math.PI * 2 - 0.2); c.fill();
      }
    } else {
      c.fillStyle = '#060607';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      if (up) c.fillRect(x, y, TILE, 8);
      if (lf) c.fillRect(x, y, 6, TILE);
      c.fillStyle = style === 'kino' ? rgbaHex(th.wallEdge, 0.55) : '#2c2c32';
      if (up) c.fillRect(x, y, TILE, 2);
      if (dn) c.fillRect(x, y + TILE - 2, TILE, 2);
      if (lf) c.fillRect(x, y, 2, TILE);
      if (rt) c.fillRect(x + TILE - 2, y, 2, TILE);
    }
  }
  c.restore();
}

// ---- walls ----
function paintStyleWalls(c, map, th, cols, rows) {
  if (!map.tiles) return;
  const { comp, list } = wallComponents(map, cols, rows);
  styleNoTorch = new Set();
  styleNoEdge = new Set();
  c.save();
  if (th.style === 'kino') paintKinoWalls(c, map, th, cols, rows, comp, list);
  else if (th.style === 'outpost') paintOutpostWalls(c, map, th, cols, rows, comp, list);
  else if (th.style === 'temple') paintTempleWalls(c, map, th, cols, rows);
  c.restore();
}

// Optional per-style render hints from the level theme (level4-6.js). loopTheme drops them, so
// every hint has a default / heuristic fallback. KINO: curtain / seat / lamp colours, grain,
// stageRows [y0, y1], curtainRow, seatRows. OUTPOST: ice, iceDeep, hutWood, snow. TEMPLE:
// waterDeep, waterLight, moss, vine, glyph, spores.
function styleHints(raw, style) {
  if (!style) return null;
  const hex = (v, d) => (typeof v === 'string' && hexRgb(v) ? v : d);
  const row = (v) => (Number.isInteger(v) ? v : null);
  const rowsOf = (v) => (Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : null);
  const h = {
    curtain: hex(raw.curtain, '#8a1020'), seat: hex(raw.seat, '#4c0a10'), lamp: hex(raw.lamp, '#ffdea0'),
    grain: Number.isFinite(raw.grain) && raw.grain >= 0 ? Math.min(0.2, raw.grain) : 0.035,
    curtainRow: row(raw.curtainRow), seatRows: rowsOf(raw.seatRows),
    stageRows: Array.isArray(raw.stageRows) && raw.stageRows.length === 2 && raw.stageRows.every(Number.isInteger) ? raw.stageRows : null,
    ice: hex(raw.ice, '#8cc4e8'), iceDeep: hex(raw.iceDeep, '#2f6f9e'), hutWood: hex(raw.hutWood, null),
    snow: raw.snow !== false,
    waterDeep: hex(raw.waterDeep, '#123f3a'), waterLight: hex(raw.waterLight, '#3fd6a8'),
    moss: hex(raw.moss, '#5f8436'), vine: hex(raw.vine, '#3a6428'), glyph: hex(raw.glyph, null),
    spores: raw.spores !== false,
    // FIX-2: optional tile hints (KINO floorZones / booth / projector, OUTPOST dish / shed).
    floorZones: normFloorZones(raw.floorZones),
    booth: tilePt(raw.booth), projector: tilePt(raw.projector), dish: tilePt(raw.dish), shed: tilePt(raw.shed),
  };
  // Pre-built colour strings for the per-frame water pass (no per-frame string building).
  h.ripple = rgbaHex(shadeHex(h.waterLight, 1.5), 0.42);
  h.rippleRing = rgbaHex(shadeHex(h.waterLight, 1.7), 0.2);
  h.sig = [style, h.curtain, h.seat, h.lamp, h.grain, h.curtainRow, h.seatRows && h.seatRows.join(','),
    h.stageRows && h.stageRows.join(','), h.ice, h.iceDeep, h.hutWood, h.snow, h.waterDeep, h.waterLight,
    h.moss, h.vine, h.glyph, h.spores,
    h.floorZones ? h.floorZones.map((z) => `${z.floor}:${z.x0},${z.y0},${z.x1},${z.y1}`).join(';') : '',
    h.booth, h.projector, h.dish, h.shed].join('/');
  return h;
}
function tilePt(v) {
  return Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) ? v : null;
}
let defaultHints = null;
function hintsOf(th) {
  if (th && th.hints) return th.hints;
  if (!defaultHints) defaultHints = styleHints({}, 'default');
  return defaultHints;
}

// Free-standing straight single-tile wall rows (only plain walls): seat rows and the curtain line.
function isThinRow(info, minLen) {
  if (info.border || info.other) return false;
  return Math.min(info.bw, info.bh) === 1 && Math.max(info.bw, info.bh) >= minLen && info.walls === info.bw * info.bh;
}

// Classifies KINO decor: { curtain: Set, seats: Set, stage: {y0, y1, x0, x1} | null }.
// Hints: curtainRow / seatRows pick the rows. Fallback (loop themes): free-standing thin rows
// (>= 6 long); the one nearest the Pack-a-Punch (within 5 tiles) is the curtain line, the rest are
// seat rows. The wall run directly behind the Pack-a-Punch (if any) is curtained too.
function kinoDecor(map, th, cols, rows, comp, list, g) {
  const H = hintsOf(th);
  const curtain = new Set(), seats = new Set();
  const hinted = !!(H.seatRows || H.curtainRow != null);
  const rowComps = list.filter((info) => isThinRow(info, hinted ? 3 : 6));
  let curtainComps = [];
  if (H.curtainRow != null) curtainComps = rowComps.filter((info) => info.bh === 1 && info.y0 === H.curtainRow);
  else if (g) {
    let best = null, bd = Infinity;
    for (const info of rowComps) {
      const dx = Math.max(info.x0 - g.tx, 0, g.tx - info.x1), dy = Math.max(info.y0 - g.ty, 0, g.ty - info.y1);
      const d = Math.max(dx, dy);
      if (d < bd) { bd = d; best = info; }
    }
    if (best && bd <= 5) curtainComps = [best];
  }
  for (const info of rowComps) {
    if (curtainComps.indexOf(info) >= 0) continue;
    if (H.seatRows && !(info.bh === 1 && H.seatRows.indexOf(info.y0) >= 0)) continue;
    for (let y = info.y0; y <= info.y1; y++) for (let x = info.x0; x <= info.x1; x++) seats.add(y * cols + x);
  }
  let cx0 = cols, cx1 = -1;
  for (const info of curtainComps) {
    for (let y = info.y0; y <= info.y1; y++) for (let x = info.x0; x <= info.x1; x++) curtain.add(y * cols + x);
    cx0 = Math.min(cx0, info.x0); cx1 = Math.max(cx1, info.x1);
  }
  // Wall run right behind the Pack-a-Punch (a stage backed by a wall).
  if (g) {
    const fx = g.front.dx, fy = g.front.dy, bx = g.tx - fx, by = g.ty - fy;
    const ax = fy ? 1 : 0, ay = fy ? 0 : 1;
    if (tileAt(map, bx, by) === T_WALL) {
      for (const s of [-1, 1]) {
        for (let k = s < 0 ? 0 : 1; k <= 12; k++) {
          const tx = bx + ax * s * k, ty = by + ay * s * k;
          if (tileAt(map, tx, ty) !== T_WALL || !isOpenish(tileAt(map, tx + fx, ty + fy))) break;
          curtain.add(ty * cols + tx);
        }
      }
    }
  }
  // Stage floor (wood boards): the hinted rows across the curtain line's span (+-3 tiles).
  let stage = null;
  if (H.stageRows && cx1 >= cx0) stage = { y0: H.stageRows[0], y1: H.stageRows[1], x0: cx0 - 3, x1: cx1 + 3 };
  return { curtain, seats, stage };
}

function paintKinoWalls(c, map, th, cols, rows, comp, list) {
  const T = map.tiles;
  let g = null;
  try { g = papGeom(map); } catch (_) { g = null; }
  const { curtain: curtains, seats, stage } = kinoDecor(map, th, cols, rows, comp, list, g);
  const H = hintsOf(th);
  if (stage) paintStageBoards(c, map, stage, cols);
  // FIX-2 (WO9 QA KINO #2 / #7): floor zones (painted in the floor pass), zone walls, props,
  // ticket booth, projection booth, stair treads.
  const zg = kinoZoneGrid(H, cols, rows);
  const props = kinoPropKinds(map, H, cols, rows, comp, list, zg, seats, curtains);
  paintKinoStairs(c, map, th, cols, rows, zg);
  let seatLast = -1;
  if (H.seatRows && H.seatRows.length) seatLast = Math.max(...H.seatRows);
  const faceZone = (tx, ty) => {
    let best = 0;
    const chk = (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows || !isOpenish(tileAt(map, x, y))) return;
      const z = zg[y * cols + x];
      if (z === 2 || (z === 3 && best !== 2) || (z === 1 && !best)) best = z;
    };
    chk(tx, ty - 1); chk(tx, ty + 1); chk(tx - 1, ty); chk(tx + 1, ty);
    return best;
  };
  const panel = shadeHex(th.wall, 1.18), dark = shadeHex(th.wall, 0.7);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const i = ty * cols + tx;
    if (T[i] !== T_WALL) continue;
    const x = tx * TILE, y = ty * TILE;
    const pk = comp[i] >= 0 && !seats.has(i) && !curtains.has(i) ? props.get(comp[i]) : undefined;
    if (pk) {
      styleNoTorch.add(i);
      if (pk !== 'booth') styleNoEdge.add(i);
      if (pk === 'booth') paintKinoBoothTile(c, map, x, y, tx, ty, i, th);
      else if (pk === 'projector' || pk === 'cabinet') paintKinoMachineTile(c, x, y, i);
      else paintKinoPropTile(c, map, x, y, tx, ty, i, pk, list[comp[i]]);
      continue;
    }
    const fz = seats.has(i) || curtains.has(i) ? 0 : faceZone(tx, ty);
    if (fz === 2) { styleNoEdge.add(i); paintKinoBrickTile(c, x, y, ty, i); continue; }
    if (fz === 3) { styleNoEdge.add(i); paintKinoCinderTile(c, x, y, ty, i); continue; }
    if (seats.has(i)) {
      styleNoTorch.add(i);
      const info = list[comp[i]];
      const horiz = info.bw >= info.bh;
      // Seats face the stage (the Pack-a-Punch) when there is one, else up / left.
      let face;
      if (horiz) face = g && g.cy > (info.y0 + info.y1 + 1) * TILE / 2 ? Math.PI : 0;
      else face = g && g.cx > (info.x0 + info.x1 + 1) * TILE / 2 ? Math.PI / 2 : -Math.PI / 2;
      paintSeatTile(c, x, y, face, th, i, H.seat);
      continue;
    }
    if (curtains.has(i)) { styleNoTorch.add(i); continue; } // painted below
    // Dark wood panelling: inset panel, 3 vertical boards with grain, gold trim on open sides.
    c.fillStyle = dark;
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = panel;
    c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(x + 14, y + 2, 1, TILE - 4); c.fillRect(x + 27, y + 2, 1, TILE - 4);
    c.fillStyle = 'rgba(255,210,150,0.07)';
    for (let k = 0; k < 3; k++) {
      const gx = x + 4 + k * 13 + Math.floor(ihash(i * 3 + k) * 7);
      c.fillRect(gx, y + 4 + Math.floor(ihash(i * 5 + k) * 10), 1, 12 + Math.floor(ihash(i * 7 + k) * 12));
    }
    const os = openSides(map, tx, ty);
    if (os && fz === 1) {
      // Dressing rooms: plain wood (no gold trim), the odd make-up mirror with bulbs.
      if (ihash(i * 97) > 0.72) {
        const s = [0, 1, 2, 3].find((k) => os & (1 << k));
        const mx = s < 2 ? x + 14 : (s === 2 ? x + 1 : x + TILE - 7), my = s < 2 ? (s === 0 ? y + 1 : y + TILE - 7) : y + 14;
        const mw = s < 2 ? 12 : 6, mh = s < 2 ? 6 : 12;
        c.fillStyle = '#c8d4dc';
        c.fillRect(mx, my, mw, mh);
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(mx + 1, my + 1, Math.max(1, mw / 3), 1);
        c.fillStyle = '#ffe6a0';
        if (s < 2) { c.fillRect(mx - 3, my + 2, 2, 2); c.fillRect(mx + mw + 1, my + 2, 2, 2); }
        else { c.fillRect(mx + 2, my - 3, 2, 2); c.fillRect(mx + 2, my + mh + 1, 2, 2); }
      }
    } else if (os) {
      c.fillStyle = rgbaHex(th.accent, 0.85);
      if (os & 1) c.fillRect(x, y + 3, TILE, 2);
      if (os & 2) c.fillRect(x, y + TILE - 5, TILE, 2);
      if (os & 4) c.fillRect(x + 3, y, 2, TILE);
      if (os & 8) c.fillRect(x + TILE - 5, y, 2, TILE);
      c.fillStyle = rgbaHex(th.accent, 0.95);           // brass studs on the trim
      if (os & 1) c.fillRect(x + 19, y + 2, 3, 4);
      if (os & 2) c.fillRect(x + 19, y + TILE - 6, 3, 4);
      if (os & 4) c.fillRect(x + 2, y + 19, 4, 3);
      if (os & 8) c.fillRect(x + TILE - 6, y + 19, 4, 3);
    }
  }
  for (const i of curtains) {
    const tx = i % cols, ty = (i / cols) | 0;
    // Front (+y in the local frame: gold fringe) faces away from the Pack-a-Punch, toward the
    // audience; a wall run behind the machine faces the machine's front.
    let fdx = 0, fdy = 1;
    if (g) {
      const vx = tx - g.tx, vy = ty - g.ty;
      // Along a horizontal run the curtain faces up/down, along a vertical run left/right.
      const horizRun = curtains.has(i - 1) || curtains.has(i + 1) ||
        (!curtains.has(i - cols) && !curtains.has(i + cols) && Math.abs(vy) >= Math.abs(vx));
      if (horizRun) { fdx = 0; fdy = vy >= 0 ? 1 : -1; } else { fdx = vx >= 0 ? 1 : -1; fdy = 0; }
      if (fdx === -g.front.dx && fdy === -g.front.dy) { fdx = g.front.dx; fdy = g.front.dy; }
    }
    paintCurtainTile(c, tx * TILE, ty * TILE, Math.atan2(fdy, fdx) - Math.PI / 2, th, i, H.curtain);
  }
  for (const [id, pk] of props) {
    const info = list[id];
    if (!info) continue;
    if (pk === 'projector') paintKinoProjector(c, info, seatLast >= 0 ? seatLast < info.y0 : true);
    else if (pk === 'cabinet') paintKinoCabinet(c, info, th);
  }
}

// Stage floor: warm wooden boards across the stage rows (plain floor tiles only).
function paintStageBoards(c, map, st, cols) {
  for (let ty = st.y0; ty <= st.y1; ty++) for (let tx = st.x0; tx <= st.x1; tx++) {
    if (tileAt(map, tx, ty) !== T_FLOOR) continue;
    paintBoardTile(c, tx * TILE, ty * TILE, ty * cols + tx, true);
  }
}

// ---- FIX-2 (WO9 QA KINO #2 / #7): KINO floor zones, zone walls and props, booth, projector, stairs ----
const KINO_ZONE = { boards: 1, asphalt: 2, concrete: 3 };
// theme.floorZones: [{ x0, y0, x1, y1 (inclusive tiles), floor: 'boards' | 'asphalt' | 'concrete' }]
// (`kind` is accepted as an alias of `floor`). Normalised; bad entries are dropped.
function normFloorZones(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const z of v) {
    if (!z || typeof z !== 'object') continue;
    const f = typeof z.floor === 'string' ? z.floor : z.kind;
    if (!KINO_ZONE[f] || ![z.x0, z.y0, z.x1, z.y1].every(Number.isInteger)) continue;
    out.push({ x0: Math.min(z.x0, z.x1), y0: Math.min(z.y0, z.y1), x1: Math.max(z.x0, z.x1), y1: Math.max(z.y0, z.y1), floor: f });
  }
  return out.length ? out : null;
}
// Per-tile zone code (0 none, 1 boards, 2 asphalt, 3 concrete); a later zone wins on overlap.
function kinoZoneGrid(H, cols, rows) {
  const g = new Int8Array(cols * rows);
  if (!H.floorZones) return g;
  for (const z of H.floorZones) {
    const code = KINO_ZONE[z.floor];
    for (let ty = Math.max(0, z.y0); ty <= Math.min(rows - 1, z.y1); ty++) {
      for (let tx = Math.max(0, z.x0); tx <= Math.min(cols - 1, z.x1); tx++) g[ty * cols + tx] = code;
    }
  }
  return g;
}

// Worn floorboards (stage, dressing rooms): 4 planks per tile with joints and grain.
function paintBoardTile(c, x, y, i, warm) {
  c.fillStyle = warm ? '#3a2412' : '#2e2016';
  c.fillRect(x, y, TILE, TILE);
  for (let k = 0; k < 4; k++) {
    c.fillStyle = warm ? mixHex('#6a4424', '#7a5230', ihash(i * 4 + k), 1) : mixHex('#5a4030', '#6a4c34', ihash(i * 4 + k), 1);
    c.fillRect(x, y + k * 10 + 1, TILE, 8);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    const j = Math.floor(ihash(i * 9 + k) * 30) + 5;
    c.fillRect(x + j, y + k * 10 + 1, 1, 8);
    if (!warm && ihash(i * 13 + k) > 0.7) {
      c.fillStyle = 'rgba(255,230,190,0.08)';
      c.fillRect(x + Math.floor(ihash(i * 15 + k) * 20), y + k * 10 + 3, 14, 1);
    }
  }
}

// Zone floors, painted over the carpet in the floor pass (before arena shading and spawn marks).
function paintKinoZoneFloors(c, map, th, cols, rows) {
  const H = hintsOf(th);
  if (!H.floorZones) return;
  const zg = kinoZoneGrid(H, cols, rows);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const i = ty * cols + tx, z = zg[i];
    if (!z) continue;
    const x = tx * TILE, y = ty * TILE;
    if (z === 1) { paintBoardTile(c, x, y, i, false); continue; }
    if (z === 2) {
      // Alley asphalt: dark with grit, hairline cracks, the odd rain puddle and oil stain.
      c.fillStyle = '#2a2a2e';
      c.fillRect(x, y, TILE, TILE);
      for (let k = 0; k < 7; k++) {
        c.fillStyle = k & 1 ? 'rgba(0,0,0,0.35)' : 'rgba(170,170,180,0.14)';
        c.fillRect(x + Math.floor(ihash(i * 11 + k) * 38), y + Math.floor(ihash(i * 13 + k) * 38), 2, 1);
      }
      const h = ihash(i * 17);
      if (h > 0.9) {
        const px = x + 10 + ihash(i * 19) * 20, py = y + 10 + ihash(i * 23) * 20, rx = 9 + ihash(i * 29) * 8;
        c.fillStyle = '#1b2330';
        c.beginPath(); c.ellipse(px, py, rx, rx * 0.55, ihash(i * 31) * 2, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(150,180,215,0.28)';
        c.lineWidth = 1;
        c.beginPath(); c.ellipse(px - 1, py - 1, rx * 0.7, rx * 0.3, ihash(i * 31) * 2, 3.6, 5.4); c.stroke();
      } else if (h < 0.08) {
        c.fillStyle = 'rgba(8,8,12,0.55)';
        c.beginPath(); c.ellipse(x + 20, y + 20, 8 + ihash(i * 37) * 6, 5, ihash(i * 41) * 3, 0, Math.PI * 2); c.fill();
      }
      if (ihash(i * 43) > 0.72) {
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 1;
        c.beginPath();
        let cx = x + ihash(i * 47) * TILE, cy = y + ihash(i * 53) * TILE;
        c.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += (ihash(i * 59 + k) - 0.5) * 18; cy += (ihash(i * 61 + k) - 0.5) * 18;
          c.lineTo(Math.max(x, Math.min(x + TILE, cx)), Math.max(y, Math.min(y + TILE, cy)));
        }
        c.stroke();
      }
      continue;
    }
    // Backstage concrete: 2x2-tile slabs with seams, speckle and stains.
    c.fillStyle = mixHex('#4a4640', '#524d46', ihash(((ty >> 1) * cols + (tx >> 1)) * 5), 1);
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    if (!(tx & 1)) c.fillRect(x, y, 1, TILE);
    if (!(ty & 1)) c.fillRect(x, y, TILE, 1);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    if (!(tx & 1)) c.fillRect(x + 1, y, 1, TILE);
    if (!(ty & 1)) c.fillRect(x, y + 1, TILE, 1);
    for (let k = 0; k < 5; k++) {
      c.fillStyle = k & 1 ? 'rgba(0,0,0,0.25)' : 'rgba(230,220,200,0.1)';
      c.fillRect(x + Math.floor(ihash(i * 67 + k) * 38), y + Math.floor(ihash(i * 71 + k) * 38), 1, 1);
    }
    if (ihash(i * 73) > 0.88) {
      c.fillStyle = 'rgba(30,24,18,0.3)';
      c.beginPath(); c.ellipse(x + 12 + ihash(i * 79) * 16, y + 12 + ihash(i * 83) * 16, 9, 6, ihash(i * 89) * 3, 0, Math.PI * 2); c.fill();
    }
  }
}

// Brick course for walls facing the alley (asphalt): staggered dark-red bricks, mortar, grime.
function paintKinoBrickTile(c, x, y, ty, i) {
  c.fillStyle = '#3a1a12';
  c.fillRect(x, y, TILE, TILE);
  for (let r = 0; r < 4; r++) {
    const off = ((r + ty * 4) & 1) ? 10 : 0;
    for (let bx = -10; bx < TILE; bx += 20) {
      const x0 = Math.max(x, x + bx + off), x1 = Math.min(x + TILE, x + bx + off + 19);
      if (x1 - x0 < 2) continue;
      c.fillStyle = mixHex('#5a2a1e', '#6e3624', ihash(i * 7 + r * 5 + bx), 1);
      c.fillRect(x0, y + r * 10 + 1, x1 - x0, 8);
      c.fillStyle = 'rgba(255,200,170,0.08)';
      c.fillRect(x0, y + r * 10 + 1, x1 - x0, 1);
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(x, y + TILE - 12, TILE, 12);
}

// Grey cinder blocks for walls facing the backstage vault (concrete).
function paintKinoCinderTile(c, x, y, ty, i) {
  c.fillStyle = '#2c2a28';
  c.fillRect(x, y, TILE, TILE);
  for (let r = 0; r < 2; r++) {
    const off = ((r + ty * 2) & 1) ? 13 : 0;
    for (let bx = -13; bx < TILE; bx += 26) {
      const x0 = Math.max(x, x + bx + off), x1 = Math.min(x + TILE, x + bx + off + 25);
      if (x1 - x0 < 2) continue;
      c.fillStyle = mixHex('#57534c', '#646058', ihash(i * 5 + r * 3 + bx), 1);
      c.fillRect(x0, y + r * 20 + 1, x1 - x0, 18);
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fillRect(x0, y + r * 20 + 1, x1 - x0, 1);
    }
  }
}

// Free-standing props inside a zone (no gold trim): bins (alley), crates / scenery flats (vault),
// costume racks / crates (dressing rooms).
function paintKinoPropTile(c, map, x, y, tx, ty, i, kind, info) {
  const horiz = info.bw >= info.bh;
  if (kind === 'bin') {
    c.fillStyle = '#1c2220';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#34403a';
    c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    c.fillStyle = '#48564e';                                  // lid
    c.fillRect(x + 4, y + 4, TILE - 8, TILE - 12);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(x + 4, y + TILE / 2 - 2, TILE - 8, 2);         // lid seam
    c.fillRect(x + 4, y + TILE - 9, TILE - 8, 1);             // hinge
    c.fillStyle = '#6a7a70';
    c.fillRect(x + 15, y + 7, 10, 2);                          // handle
    c.fillStyle = 'rgba(180,200,190,0.12)';
    c.fillRect(x + 4, y + 4, TILE - 8, 1);
    if (ihash(i * 3) > 0.5) { c.fillStyle = 'rgba(210,200,170,0.5)'; c.fillRect(x + 6 + Math.floor(ihash(i * 5) * 20), y + TILE - 7, 6, 3); }
    return;
  }
  if (kind === 'rack') {
    // Costume rack: a chrome rail along the run, garments hanging across it.
    c.fillStyle = '#1a1210';
    c.fillRect(x, y, TILE, TILE);
    const cols4 = ['#7a1a2a', '#23305a', '#2e5a3a', '#8a6a24', '#4a2a5a', '#6a6a70'];
    c.save();
    c.translate(x + TILE / 2, y + TILE / 2);
    if (!horiz) c.rotate(Math.PI / 2);
    for (let k = 0; k < 5; k++) {
      c.fillStyle = cols4[Math.floor(ihash(i * 7 + k) * cols4.length)];
      const gx = -18 + k * 8;
      c.fillRect(gx, -14, 6, 28);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(gx, -14, 1, 28);
    }
    c.fillStyle = '#c8ccd2';
    c.fillRect(-TILE / 2, -1, TILE, 2);
    c.restore();
    return;
  }
  if (kind === 'flat') {
    // Scenery flat: painted canvas (sky / hills) in a wooden batten frame.
    c.fillStyle = '#3a2a1a';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#4e6a7a';
    c.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    c.fillStyle = '#5a7a4a';
    c.beginPath(); c.moveTo(x + 3, y + 26); c.quadraticCurveTo(x + 14 + ihash(i) * 12, y + 12, x + TILE - 3, y + 24); c.lineTo(x + TILE - 3, y + TILE - 3); c.lineTo(x + 3, y + TILE - 3); c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x + 3, y + 3, TILE - 6, TILE - 6 > 0 ? 2 : 0);
    c.fillStyle = '#6a4a2a';
    if (horiz) { c.fillRect(x, y, TILE, 3); c.fillRect(x, y + TILE - 3, TILE, 3); }
    else { c.fillRect(x, y, 3, TILE); c.fillRect(x + TILE - 3, y, 3, TILE); }
    return;
  }
  // crate: plain wood with a frame and cross bracing
  c.fillStyle = '#2a1c10';
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = mixHex('#6a4a2a', '#7a5832', ihash(i * 3), 1);
  c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  for (let k = 1; k < 4; k++) c.fillRect(x + 2, y + k * 9 + 2, TILE - 4, 1);
  c.strokeStyle = '#4a321c';
  c.lineWidth = 3;
  c.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
  c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + TILE - 5, y + TILE - 5); c.stroke();
  c.fillStyle = 'rgba(20,14,8,0.8)';
  c.fillRect(x + 5, y + 5, 2, 2); c.fillRect(x + TILE - 7, y + 5, 2, 2); c.fillRect(x + 5, y + TILE - 7, 2, 2); c.fillRect(x + TILE - 7, y + TILE - 7, 2, 2);
}

// Ticket booth tile: wood base, a lighter counter strip and a brass grille over dark glass on the
// sides facing open floor.
function paintKinoBoothTile(c, map, x, y, tx, ty, i, th) {
  c.fillStyle = shadeHex(th.wall, 0.7);
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = shadeHex(th.wall, 1.3);
  c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  const os = openSides(map, tx, ty);
  const brass = th.accent;
  for (let s = 0; s < 4; s++) {
    if (!(os & (1 << s))) continue;
    c.save();
    c.translate(x + TILE / 2, y + TILE / 2);
    c.rotate(s === 0 ? Math.PI : s === 1 ? 0 : s === 2 ? Math.PI / 2 : -Math.PI / 2);
    // local frame: +y faces the open side
    c.fillStyle = '#8a6038';                                   // counter strip
    c.fillRect(-TILE / 2, TILE / 2 - 8, TILE, 6);
    c.fillStyle = 'rgba(255,230,180,0.35)';
    c.fillRect(-TILE / 2, TILE / 2 - 8, TILE, 1);
    c.fillStyle = '#141a20';                                   // glass
    c.fillRect(-TILE / 2 + 3, TILE / 2 - 20, TILE - 6, 11);
    c.fillStyle = 'rgba(255,220,150,0.18)';
    c.fillRect(-TILE / 2 + 3, TILE / 2 - 20, TILE - 6, 3);
    c.fillStyle = brass;                                       // brass grille bars
    for (let u = -TILE / 2 + 5; u < TILE / 2 - 3; u += 5) c.fillRect(u, TILE / 2 - 20, 1, 11);
    c.fillRect(-TILE / 2 + 3, TILE / 2 - 21, TILE - 6, 1);
    c.restore();
  }
}

// Projection booth machines: the projector (metal body, two film reels, a lens and a faint beam
// toward the auditorium) and reel cabinets (film cans on a metal cabinet).
function paintKinoMachineTile(c, x, y, i) {
  c.fillStyle = '#18181c';
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = '#34343c';
  c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  c.fillStyle = 'rgba(255,255,255,0.08)';
  c.fillRect(x + 2, y + 2, TILE - 4, 1);
}
function paintKinoProjector(c, info, up) {
  const x0 = info.x0 * TILE, y0 = info.y0 * TILE, w = info.bw * TILE, h = info.bh * TILE;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const dir = up ? -1 : 1;
  // beam (drawn first so the body sits on top)
  c.save();
  c.globalCompositeOperation = 'lighter';
  const lx = cx, ly = up ? y0 : y0 + h;
  for (let k = 0; k < 3; k++) {
    c.fillStyle = `rgba(255,236,190,${0.05 - k * 0.012})`;
    const len = 46 + k * 16, spread = 14 + k * 10;
    c.beginPath(); c.moveTo(lx - 4, ly); c.lineTo(lx - spread, ly + dir * len); c.lineTo(lx + spread, ly + dir * len); c.lineTo(lx + 4, ly); c.closePath(); c.fill();
  }
  c.restore();
  // reels
  const R = Math.min(12, h / 2 - 5);
  for (const ox of [-w / 4, w / 4]) {
    const rx = cx + ox, ry = cy - dir * 2;
    c.fillStyle = '#0e0e10';
    c.beginPath(); c.arc(rx, ry, R + 1.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#6a6a74';
    c.beginPath(); c.arc(rx, ry, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1e1e22';
    for (let k = 0; k < 3; k++) {
      const a = k * (Math.PI * 2 / 3) + 0.3;
      c.beginPath(); c.arc(rx + Math.cos(a) * R * 0.55, ry + Math.sin(a) * R * 0.55, R * 0.28, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#b8b8c0';
    c.beginPath(); c.arc(rx, ry, 2, 0, Math.PI * 2); c.fill();
  }
  // lens barrel + glass
  c.fillStyle = '#26262c';
  c.fillRect(lx - 5, up ? ly - 2 : ly - 6, 10, 8);
  c.fillStyle = '#cfe4ff';
  c.beginPath(); c.arc(lx, ly, 4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(lx - 1, ly - 1, 1.5, 0, Math.PI * 2); c.fill();
}
function paintKinoCabinet(c, info, th) {
  for (let ty = info.y0; ty <= info.y1; ty++) for (let tx = info.x0; tx <= info.x1; tx++) {
    const x = tx * TILE, y = ty * TILE;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(x + 19, y + 4, 2, TILE - 8);
    for (const [ox, oy] of [[10, 12], [30, 28]]) {
      c.fillStyle = '#8a8a94';
      c.beginPath(); c.arc(x + ox, y + oy, 7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2a2a30';
      c.lineWidth = 1;
      c.beginPath(); c.arc(x + ox, y + oy, 4, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = rgbaHex(th.accent, 0.6);
    c.fillRect(x + 8, y + TILE - 6, 8, 2);
  }
}

// Stair treads: floor tiles on a stepped diagonal (wall on one horizontal side and one vertical
// side, the diagonal neighbour continuing the staircase is also such a tile).
function paintKinoStairs(c, map, th, cols, rows, zg) {
  const T = map.tiles;
  const wall = (x, y) => { const k = tileAt(map, x, y); return k === T_WALL || k === T_WALLBUY || k === T_PERK; };
  const cand = new Int8Array(cols * rows);
  for (let ty = 1; ty < rows - 1; ty++) for (let tx = 1; tx < cols - 1; tx++) {
    const i = ty * cols + tx;
    if (T[i] !== T_FLOOR || zg[i]) continue;
    // corner orientation: bit set per (horizontal wall side, vertical wall side)
    let o = 0;
    if (wall(tx - 1, ty) && wall(tx, ty - 1)) o |= 1;   // NW corner, diagonal NE-SW
    if (wall(tx + 1, ty) && wall(tx, ty - 1)) o |= 2;   // NE corner, diagonal NW-SE
    if (wall(tx - 1, ty) && wall(tx, ty + 1)) o |= 4;   // SW corner, diagonal NW-SE
    if (wall(tx + 1, ty) && wall(tx, ty + 1)) o |= 8;   // SE corner, diagonal NE-SW
    cand[i] = o;
  }
  const out = [];
  for (let ty = 1; ty < rows - 1; ty++) for (let tx = 1; tx < cols - 1; tx++) {
    const o = cand[ty * cols + tx];
    if (!o) continue;
    const at = (x, y) => cand[y * cols + x];
    let ok = false;
    if (o & 1) ok = ok || !!(at(tx + 1, ty - 1) & 1) || !!(at(tx - 1, ty + 1) & 1);
    if (o & 2) ok = ok || !!(at(tx - 1, ty - 1) & 2) || !!(at(tx + 1, ty + 1) & 2);
    if (o & 4) ok = ok || !!(at(tx - 1, ty - 1) & 4) || !!(at(tx + 1, ty + 1) & 4);
    if (o & 8) ok = ok || !!(at(tx + 1, ty - 1) & 8) || !!(at(tx - 1, ty + 1) & 8);
    if (ok) out.push(ty * cols + tx);
  }
  for (const i of out) {
    const x = (i % cols) * TILE, y = ((i / cols) | 0) * TILE;
    for (let k = 0; k < 5; k++) {
      const yy = y + k * 8;
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.fillRect(x, yy + 5, TILE, 3);
      c.fillStyle = rgbaHex(th.accent, 0.45);                  // brass nosing
      c.fillRect(x, yy + 4, TILE, 1);
    }
  }
}

// Classifies KINO free-standing masses for the zone / booth / projection-booth painters:
// Map(component id -> 'bin' | 'crate' | 'flat' | 'rack' | 'booth' | 'projector' | 'cabinet').
function kinoPropKinds(map, H, cols, rows, comp, list, zg, seats, curtains) {
  const out = new Map();
  const free = [];
  for (const info of list) {
    if (info.border) continue;
    let special = false;
    for (let y = info.y0; y <= info.y1 && !special; y++) for (let x = info.x0; x <= info.x1; x++) {
      const i = y * cols + x;
      if (comp[i] === info.id && (seats.has(i) || curtains.has(i))) { special = true; break; }
    }
    if (!special) free.push(info);
  }
  const compAt = (p) => (Array.isArray(p) && p.length === 2 && tileAt(map, p[0], p[1]) != null ? comp[p[1] * cols + p[0]] : -1);
  for (const info of free) {
    const cx = (info.x0 + info.x1) >> 1, cy = (info.y0 + info.y1) >> 1;
    const z = zg[cy * cols + cx];
    if (!z) continue;
    const thin = Math.min(info.bw, info.bh) === 1 && Math.max(info.bw, info.bh) >= 3;
    out.set(info.id, z === 2 ? 'bin' : z === 3 ? (thin ? 'flat' : 'crate') : (thin ? 'rack' : 'crate'));
  }
  // Ticket booth: hint, else the free mass nearest the player start (within 6 tiles, >= 3 wide).
  let booth = compAt(H.booth);
  if (booth < 0 && map.playerStart) {
    const sx = Math.floor(map.playerStart.x / TILE), sy = Math.floor(map.playerStart.y / TILE);
    let bd = 7;
    for (const info of free) {
      if (out.has(info.id) || Math.max(info.bw, info.bh) < 3 || Math.min(info.bw, info.bh) < 2) continue;
      const d = Math.max(Math.max(info.x0 - sx, 0, sx - info.x1), Math.max(info.y0 - sy, 0, sy - info.y1));
      if (d < bd) { bd = d; booth = info.id; }
    }
  }
  if (booth >= 0) out.set(booth, 'booth');
  // Projection booth: small free masses 3-10 rows behind the last seat row; the widest (or the
  // `projector` hint) is the projector, the rest are reel cabinets.
  const seatRows = H.seatRows && H.seatRows.length ? H.seatRows : null;
  const last = seatRows ? Math.max(...seatRows) : -1;
  let sx0 = cols, sx1 = -1;
  for (const i of seats) { const x = i % cols; if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; }
  if (last >= 0 && sx1 >= sx0) {
    const band = free.filter((info) => !out.has(info.id) && info.y0 >= last + 3 && info.y1 <= last + 10 &&
      info.bw * info.bh <= 8 && info.x1 >= sx0 && info.x0 <= sx1);
    let proj = compAt(H.projector);
    if (proj < 0 && band.length) proj = band.reduce((a, b) => (b.bw * b.bh > a.bw * a.bh ? b : a)).id;
    for (const info of band) out.set(info.id, info.id === proj ? 'projector' : 'cabinet');
    if (proj >= 0 && !out.has(proj)) out.set(proj, 'projector');
  }
  return out;
}

// Two theatre seats per tile in a local frame facing -y (backs at +y): cushion, raised back
// with a lit top, dark wood armrests.
function paintSeatTile(c, x, y, face, th, seed, seatHex) {
  c.save();
  c.translate(x + TILE / 2, y + TILE / 2);
  c.rotate(face);
  const H = TILE / 2;
  c.fillStyle = shadeHex(th.floor, 0.55);   // aisle carpet in the shadow of the seats
  c.fillRect(-H, -H, TILE, TILE);
  for (let k = 0; k < 2; k++) {
    const sx = -H + k * H;
    const f = 0.92 + ihash(seed * 2 + k) * 0.16;
    c.fillStyle = mixHex('#7a141c', '#7a141c', 0, f);
    c.fillRect(sx + 3, -H + 8, H - 6, 18);                 // cushion
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(sx + 3, -H + 8, H - 6, 2);
    c.fillStyle = mixHex(seatHex || '#4c0a10', seatHex || '#4c0a10', 0, f);
    c.fillRect(sx + 2, H - 14, H - 4, 10);                  // seat back
    c.fillStyle = '#b3323b';
    c.fillRect(sx + 3, H - 14, H - 6, 2);                   // lit top of the back
    c.fillStyle = rgbaHex(th.accent, 0.8);
    c.fillRect(sx + H / 2 - 1, H - 7, 2, 2);                // brass seat number plate
  }
  c.fillStyle = '#24140c';
  c.fillRect(-H, -H + 6, 2, TILE - 10); c.fillRect(-1, -H + 6, 2, TILE - 10); c.fillRect(H - 2, -H + 6, 2, TILE - 10);
  c.restore();
}

// Red velvet curtain seen from above: pleats (light / dark bands across the run), a dark valance
// at the back and a gold fringe with tassels on the stage side (+y in the local frame).
function paintCurtainTile(c, x, y, rot, th, seed, curtainHex) {
  c.save();
  c.translate(x + TILE / 2, y + TILE / 2);
  c.rotate(rot);
  const H = TILE / 2;
  const base = curtainHex || '#8a1020';
  c.fillStyle = shadeHex(base, 0.62);
  c.fillRect(-H, -H, TILE, TILE);
  for (let k = 0; k < 5; k++) {
    const u = -H + k * 8;
    c.fillStyle = base;
    c.fillRect(u + 1, -H + 6, 4, TILE - 6);
    c.fillStyle = shadeHex(base, 1.45);
    c.fillRect(u + 2, -H + 6, 1, TILE - 8);
    c.fillStyle = shadeHex(base, 0.35);
    c.fillRect(u + 6, -H + 6, 1, TILE - 6);
  }
  c.fillStyle = '#2a0408';
  c.fillRect(-H, -H, TILE, 6);                               // valance / back
  c.fillStyle = rgbaHex(th.accent, 0.9);
  c.fillRect(-H, H - 3, TILE, 2);                            // gold fringe
  for (let k = 0; k < 4; k++) c.fillRect(-H + 4 + k * 10, H - 2, 2, 2 + Math.floor(ihash(seed + k) * 2));
  c.restore();
}

// OUTPOST walls. Per connected mass: free-standing hollow shapes are buildings (wooden huts, or
// concrete when they hold a perk machine / Pack-a-Punch: radar ring, command bunker); small solid
// free blocks (<= 3x3) are fuel tanks. Everything else is grey-blue rock, except single-tile-thick
// lines (floor / ice / gate on both sides), which are orange hazard fences.
function paintOutpostWalls(c, map, th, cols, rows, comp, list) {
  const T = map.tiles;
  const H = hintsOf(th);
  const machines = new Set();
  for (let i = 0; i < T.length; i++) if ((T[i] === T_PERK || T[i] === T_PAP) && comp[i] >= 0) machines.add(comp[i]);
  const kindOf = (info) => {
    if (info.border) return 'rock';
    const area = info.bw * info.bh, n = info.walls + info.other;
    if (Math.min(info.bw, info.bh) >= 3 && Math.max(info.bw, info.bh) <= 12 && n / area < 0.72) return machines.has(info.id) ? 'bunker' : 'hut';
    if (info.bw <= 3 && info.bh <= 3 && info.bw >= 2 && info.bh >= 2 && n / area >= 0.85) return info.other ? 'tank' : 'ice';
    return 'rock';
  };
  const kinds = list.map(kindOf);
  const glassGroups = outpostSpecialKinds(map, H, cols, rows, comp, list, kinds, machines);
  const open = (code) => code === T_FLOOR || code === T_OPEN || code === T_ARENA || code === T_PIT || code === T_DOOR;
  const rock = shadeHex(th.wall, 0.92);
  const wood = H.hutWood || shadeHex(th.doorWood, 1.15);
  const concrete = mixHex(th.wall, '#9aa6b2', 0.45, 1);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const i = ty * cols + tx;
    if (T[i] !== T_WALL) continue;
    const x = tx * TILE, y = ty * TILE;
    let kind = comp[i] >= 0 ? kinds[comp[i]] : 'rock';
    let horiz = true;
    if (kind === 'rock') {
      const ud = open(tileAt(map, tx, ty - 1)) && open(tileAt(map, tx, ty + 1));
      const lr = open(tileAt(map, tx - 1, ty)) && open(tileAt(map, tx + 1, ty));
      if (ud || lr) { kind = 'fence'; horiz = ud; }
    }
    if (kind === 'fence') {
      styleNoTorch.add(i);
      c.fillStyle = th.floor;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = 'rgba(90,115,140,0.2)';
      c.fillRect(x, y, TILE, TILE);
      c.save();
      c.translate(x + TILE / 2, y + TILE / 2);
      if (!horiz) c.rotate(Math.PI / 2);
      const h = TILE / 2;
      // chain-link mesh across the whole tile (the blocked area), then the orange hazard rail
      c.strokeStyle = 'rgba(70,85,100,0.45)';
      c.lineWidth = 1;
      c.beginPath();
      for (let k = -h - 16; k < h + 16; k += 6) { c.moveTo(k, -8); c.lineTo(k + 16, 8); c.moveTo(k + 16, -8); c.lineTo(k, 8); }
      c.stroke();
      c.fillStyle = 'rgba(40,60,80,0.25)';
      c.fillRect(-h, 1, TILE, 6);                              // shadow on the snow
      c.fillStyle = th.accent;
      c.fillRect(-h, -4, TILE, 7);                             // orange rail
      c.save();
      c.beginPath(); c.rect(-h, -4, TILE, 7); c.clip();
      c.fillStyle = '#1b1712';
      c.beginPath();
      for (let k = -h - 10; k < h + 10; k += 10) { c.moveTo(k, 3); c.lineTo(k + 4, 3); c.lineTo(k + 11, -4); c.lineTo(k + 7, -4); }
      c.fill();
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(-h, -4, TILE, 1);
      c.fillStyle = '#3b444e';                                 // posts at both tile ends
      c.fillRect(-h, -9, 4, 16); c.fillRect(h - 4, -9, 4, 16);
      c.fillStyle = '#eef5fb';                                 // snow caps on the posts
      c.fillRect(-h, -9, 4, 2); c.fillRect(h - 4, -9, 4, 2);
      c.restore();
    } else if (kind === 'glass') {
      styleNoTorch.add(i);
      paintGlassPaneTile(c, map, x, y, tx, ty, i);
    } else if (kind === 'hut' || kind === 'bunker' || kind === 'shed' || kind === 'plinth' || kind === 'minidish') {
      styleNoTorch.add(i);
      const lr = isSolidCode(tileAt(map, tx - 1, ty)) || isSolidCode(tileAt(map, tx + 1, ty));
      if (kind === 'hut' || kind === 'shed') {
        // Wooden hut wall: planks along the run, dark seams, nails, frost on the upper edge.
        c.fillStyle = shadeHex(wood, 0.6);
        c.fillRect(x, y, TILE, TILE);
        for (let k = 0; k < 4; k++) {
          c.fillStyle = mixHex(wood, wood, 0, 0.82 + ihash(i * 4 + k) * 0.3);
          if (lr) c.fillRect(x, y + k * 10 + 1, TILE, 8); else c.fillRect(x + k * 10 + 1, y, 8, TILE);
        }
        c.fillStyle = 'rgba(20,12,6,0.8)';
        if (lr) { c.fillRect(x + 3, y + 4, 2, 2); c.fillRect(x + TILE - 5, y + 24, 2, 2); }
        else { c.fillRect(x + 4, y + 3, 2, 2); c.fillRect(x + 24, y + TILE - 5, 2, 2); }
      } else {
        // Concrete: poured panels with a lit top edge, form-tie dots and a hazard-orange stripe.
        c.fillStyle = shadeHex(concrete, 0.7);
        c.fillRect(x, y, TILE, TILE);
        c.fillStyle = mixHex(concrete, concrete, 0, 0.94 + ihash(i * 3) * 0.1);
        c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(x + 1, y + 1, TILE - 2, 1);
        c.fillStyle = 'rgba(30,38,48,0.45)';
        c.fillRect(x + 8, y + 8, 2, 2); c.fillRect(x + 30, y + 8, 2, 2); c.fillRect(x + 8, y + 30, 2, 2); c.fillRect(x + 30, y + 30, 2, 2);
        const os = openSides(map, tx, ty);
        c.fillStyle = rgbaHex(th.accent, 0.8);
        if (os & 1) c.fillRect(x, y + 2, TILE, 3);
        if (os & 2) c.fillRect(x, y + TILE - 5, TILE, 3);
        if (os & 4) c.fillRect(x + 2, y, 3, TILE);
        if (os & 8) c.fillRect(x + TILE - 5, y, 3, TILE);
      }
      if (kind !== 'plinth' && kind !== 'minidish' && !isSolidCode(tileAt(map, tx, ty - 1))) {
        c.fillStyle = 'rgba(235,245,252,0.85)';
        c.fillRect(x, y, TILE, 3);
      }
    } else if (kind === 'ice') {
      // Ice column: pale blue-white block with bright facets and a cold rim.
      styleNoTorch.add(i);
      c.fillStyle = '#9fc9e4';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#c6e3f4';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + TILE, y); c.lineTo(x + 8 + ihash(i) * 20, y + 18 + ihash(i * 3) * 12); c.closePath(); c.fill();
      c.fillStyle = '#7fb0d2';
      c.beginPath(); c.moveTo(x, y + TILE); c.lineTo(x + TILE, y + TILE); c.lineTo(x + 12 + ihash(i * 5) * 16, y + 20); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + 6, y + 6 + ihash(i * 7) * 10); c.lineTo(x + 16 + ihash(i * 9) * 12, y + 4); c.stroke();
    } else if (kind === 'tank') {
      styleNoTorch.add(i);
      c.fillStyle = th.floor;                                  // the cylinder is drawn per block below
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = 'rgba(90,115,140,0.25)';
      c.fillRect(x, y, TILE, TILE);
    } else {
      // Grey-blue rock: two or three lit boulder facets, dark cracks, snow caps on top edges.
      c.fillStyle = rock;
      c.fillRect(x, y, TILE, TILE);
      const nb = 2 + Math.floor(ihash(i * 3) * 2);
      for (let k = 0; k < nb; k++) {
        const bx = x + 6 + ihash(i * 5 + k) * 28, by = y + 6 + ihash(i * 7 + k) * 28;
        const r = 7 + ihash(i * 11 + k) * 8;
        c.fillStyle = mixHex(th.wall, th.wallEdge, ihash(i * 13 + k) * 0.35, 1.0);
        c.beginPath(); c.ellipse(bx, by, r, r * 0.8, ihash(i * 17 + k) * 3, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(220,235,250,0.22)';
        c.beginPath(); c.ellipse(bx - r * 0.3, by - r * 0.3, r * 0.5, r * 0.35, 0.3, 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = 'rgba(20,28,38,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      const cx0 = x + 4 + ihash(i * 19) * 32, cy0 = y + 4 + ihash(i * 23) * 32;
      c.moveTo(cx0, cy0); c.lineTo(cx0 + (ihash(i * 29) - 0.5) * 16, cy0 + (ihash(i * 31) - 0.5) * 16);
      c.stroke();
      if (!isSolidCode(tileAt(map, tx, ty - 1)) || ihash(i * 37) > 0.72) {
        c.fillStyle = 'rgba(240,248,255,0.9)';
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + TILE, y);
        for (let k = 4; k >= 0; k--) c.lineTo(x + k * 10, y + 3 + ihash(i * 41 + k) * 5);
        c.closePath();
        c.fill();
      }
    }
  }
  // Fuel tanks: one steel cylinder (seen from above) per tank block, orange hazard band, frost cap.
  for (let k = 0; k < list.length; k++) {
    if (kinds[k] !== 'tank') continue;
    const info = list[k];
    const cx = (info.x0 + info.bw / 2) * TILE, cy = (info.y0 + info.bh / 2) * TILE;
    const R = Math.min(info.bw, info.bh) * TILE / 2 - 3;
    c.fillStyle = 'rgba(30,45,60,0.35)';
    c.beginPath(); c.arc(cx + 3, cy + 4, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7d8b99';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9aa8b5';
    c.beginPath(); c.arc(cx - R * 0.12, cy - R * 0.12, R * 0.78, 0, Math.PI * 2); c.fill();
    c.strokeStyle = th.accent;
    c.lineWidth = 5;
    c.beginPath(); c.arc(cx, cy, R - 4, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#2c343d';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#56626e';                                  // hatch
    c.beginPath(); c.arc(cx, cy, R * 0.22, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(240,248,255,0.75)';                   // frost cap
    c.beginPath(); c.ellipse(cx - R * 0.3, cy - R * 0.35, R * 0.35, R * 0.18, -0.5, 0, Math.PI * 2); c.fill();
  }
  // FIX-2 (WO9 QA OUTPOST #6 / #7): greenhouse dome interiors, sheds, radar dishes.
  for (const g of glassGroups) paintGlassDome(c, map, g, cols);
  for (let k = 0; k < list.length; k++) {
    if (kinds[k] === 'shed') paintShedRoof(c, map, list[k], wood);
    else if (kinds[k] === 'plinth' || kinds[k] === 'minidish') {
      const info = list[k];
      const hint = H.dish && kinds[k] === 'plinth' ? H.dish : null;
      const cx = hint ? (hint[0] + 0.5) * TILE : (info.x0 + info.bw / 2) * TILE;
      const cy = hint ? (hint[1] + 0.5) * TILE : (info.y0 + info.bh / 2) * TILE;
      const R = kinds[k] === 'plinth' ? Math.min(62, Math.min(info.bw, info.bh) * TILE / 2 - 6) : Math.min(info.bw, info.bh) * TILE / 2 - 3;
      paintRadarDish(c, cx, cy, R, th, info.id);
    }
  }
}

// FIX-2 (WO9 QA OUTPOST #6 / #7): re-classifies OUTPOST wall masses in place (kinds[]):
// - 'glass': hollow buildings (hut / bunker) whose bounding boxes touch within 2 tiles are merged
//   (a doorway row splits the dome in two); a merged group >= 8 x 5 with cut (octagonal) corners
//   is the greenhouse dome, whatever machine it holds. Other merged groups holding a machine get
//   one material (bunker). Returns the dome groups.
// - 'plinth': a free solid blob 4-6 x 3-6 with all four bbox corners open (the dish plinth), or
//   the mass holding the optional `dish: [tx, ty]` hint tile.
// - 'minidish': a 2-3 x 2-3 pure block that does not touch the boss arena (arena ones stay ice).
// - 'shed': a 'tank' block with no other tank within 7 tiles (fuel tanks stand in rows), or the
//   mass holding the optional `shed: [tx, ty]` hint tile.
function outpostSpecialKinds(map, H, cols, rows, comp, list, kinds, machines) {
  const solidAt = (x, y) => { const c = tileAt(map, x, y); return c != null && c !== T_FLOOR && c !== T_OPEN && c !== T_ARENA && c !== T_PIT && c !== T_BOX; };
  const compAt = (p) => (Array.isArray(p) && p.length === 2 && tileAt(map, p[0], p[1]) != null ? comp[p[1] * cols + p[0]] : -1);
  // Glass domes.
  const hollow = [];
  for (let k = 0; k < list.length; k++) if (kinds[k] === 'hut' || kinds[k] === 'bunker') hollow.push(k);
  const parent = new Map(hollow.map((k) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (let a = 0; a < hollow.length; a++) for (let b = a + 1; b < hollow.length; b++) {
    const A = list[hollow[a]], B = list[hollow[b]];
    const gx = Math.max(A.x0 - B.x1, B.x0 - A.x1) - 1, gy = Math.max(A.y0 - B.y1, B.y0 - A.y1) - 1;
    if (gx <= 2 && gy <= 2 && (gx < 0 || gy < 0)) parent.set(find(hollow[a]), find(hollow[b]));
  }
  const groups = new Map();
  for (const k of hollow) { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
  const domes = [];
  for (const members of groups.values()) {
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    for (const k of members) { const I = list[k]; x0 = Math.min(x0, I.x0); y0 = Math.min(y0, I.y0); x1 = Math.max(x1, I.x1); y1 = Math.max(y1, I.y1); }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const cut = !solidAt(x0, y0) && !solidAt(x1, y0) && !solidAt(x0, y1) && !solidAt(x1, y1);
    if (Math.max(bw, bh) >= 8 && Math.min(bw, bh) >= 5 && cut) {
      for (const k of members) kinds[k] = 'glass';
      domes.push({ x0, y0, x1, y1, bw, bh });
    } else if (members.length > 1 && members.some((k) => machines.has(k))) {
      for (const k of members) kinds[k] = 'bunker';
    }
  }
  // Dish plinth / small dish / shed.
  const dishComp = compAt(H.dish), shedComp = compAt(H.shed);
  const nearArena = (I) => {
    if (!map.arenaTiles || !map.arenaTiles.size) return false;
    for (let y = I.y0 - 1; y <= I.y1 + 1; y++) for (let x = I.x0 - 1; x <= I.x1 + 1; x++) {
      if (x >= 0 && y >= 0 && x < cols && y < rows && map.arenaTiles.has(y * cols + x)) return true;
    }
    return false;
  };
  const tanks = [];
  for (let k = 0; k < list.length; k++) {
    const I = list[k];
    if (I.border) continue;
    const fill = (I.walls + I.other) / (I.bw * I.bh);
    if (k === dishComp) { kinds[k] = 'plinth'; continue; }
    if (k === shedComp) { kinds[k] = 'shed'; continue; }
    if (kinds[k] === 'rock' && I.bw >= 4 && I.bw <= 6 && I.bh >= 3 && I.bh <= 6 && fill >= 0.72 &&
        !solidAt(I.x0, I.y0) && !solidAt(I.x1, I.y0) && !solidAt(I.x0, I.y1) && !solidAt(I.x1, I.y1)) kinds[k] = 'plinth';
    else if (kinds[k] === 'ice' && !nearArena(I)) kinds[k] = 'minidish';
    else if (kinds[k] === 'tank') tanks.push(k);
  }
  if (shedComp < 0) {
    for (const k of tanks) {
      const A = list[k];
      const paired = tanks.some((j) => j !== k && Math.max(list[j].x0 - A.x1, A.x0 - list[j].x1, list[j].y0 - A.y1, A.y0 - list[j].y1) <= 7);
      if (!paired) kinds[k] = 'shed';
    }
  }
  return domes;
}

// Greenhouse glass wall tile: pale cyan panes, white mullions every 10 px, a diagonal glint and
// frost along a snow-facing top edge.
function paintGlassPaneTile(c, map, x, y, tx, ty, i) {
  c.fillStyle = '#8fb9cc';
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = '#bfe6f5';
  c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  c.fillStyle = 'rgba(80,170,110,0.28)';            // plants behind the glass
  if (ihash(i * 3) > 0.4) c.fillRect(x + 4 + Math.floor(ihash(i * 5) * 20), y + 6 + Math.floor(ihash(i * 7) * 20), 10, 8);
  c.fillStyle = '#f4fbff';
  for (let k = 10; k < TILE; k += 10) { c.fillRect(x + k, y, 1, TILE); c.fillRect(x, y + k, TILE, 1); }
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath(); c.moveTo(x + 4, y + 20); c.lineTo(x + 20, y + 4); c.lineTo(x + 24, y + 4); c.lineTo(x + 8, y + 20); c.closePath(); c.fill();
  c.strokeStyle = '#6e98ad';
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  if (!isSolidCode(tileAt(map, tx, ty - 1))) {
    c.fillStyle = 'rgba(244,251,255,0.9)';
    c.fillRect(x, y, TILE, 3);
    c.fillStyle = 'rgba(244,251,255,0.45)';
    c.fillRect(x, y + 3, TILE, 3);
  }
}

// Greenhouse interior: planting beds (green sprouts) on the floor inside the dome, then faint
// glass-dome ribs (an inscribed ellipse + a meridian ellipse) and a sheen over the footprint.
function paintGlassDome(c, map, g, cols) {
  c.save();
  for (let ty = g.y0 + 1; ty < g.y1; ty++) for (let tx = g.x0 + 1; tx < g.x1; tx++) {
    if (tileAt(map, tx, ty) !== T_FLOOR) continue;
    const i = ty * cols + tx, x = tx * TILE, y = ty * TILE;
    c.fillStyle = 'rgba(150,215,190,0.22)';
    c.fillRect(x, y, TILE, TILE);
    for (let k = 0; k < 5; k++) {
      const px = x + 3 + Math.floor(ihash(i * 17 + k) * 32), py = y + 3 + Math.floor(ihash(i * 19 + k) * 32);
      c.fillStyle = k & 1 ? 'rgba(62,140,70,0.8)' : 'rgba(96,170,84,0.75)';
      c.fillRect(px, py, 3, 2); c.fillRect(px + 1, py - 1, 1, 4);
    }
  }
  const cx = (g.x0 + g.bw / 2) * TILE, cy = (g.y0 + g.bh / 2) * TILE, rx = g.bw * TILE / 2 - 6, ry = g.bh * TILE / 2 - 6;
  c.strokeStyle = 'rgba(255,255,255,0.3)';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  c.moveTo(cx + rx * 0.5, cy); c.ellipse(cx, cy, rx * 0.5, ry, 0, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(210,240,255,0.12)';
  c.beginPath(); c.ellipse(cx - rx * 0.25, cy - ry * 0.3, rx * 0.45, ry * 0.3, -0.3, 0, Math.PI * 2); c.fill();
  c.restore();
}

// Storage shed: plank walls (painted per tile) under a corrugated metal roof whose ribs run
// across the whole block, a ridge, rust and snow. The window tile is left alone (barricade).
function paintShedRoof(c, map, I, wood) {
  c.save();
  const x0 = I.x0 * TILE, y0 = I.y0 * TILE, w = I.bw * TILE, h = I.bh * TILE;
  c.beginPath();
  for (let ty = I.y0; ty <= I.y1; ty++) for (let tx = I.x0; tx <= I.x1; tx++) {
    const code = tileAt(map, tx, ty);
    if (code === T_WALL || code === T_POCKET) c.rect(tx * TILE, ty * TILE, TILE, TILE);
  }
  c.clip();
  c.fillStyle = '#6f7a84';
  c.fillRect(x0 + 5, y0 + 5, w - 10, h - 10);
  for (let x = x0 + 5; x < x0 + w - 5; x += 6) {
    c.fillStyle = '#8d99a4'; c.fillRect(x, y0 + 5, 3, h - 10);
    c.fillStyle = '#58626b'; c.fillRect(x + 3, y0 + 5, 1, h - 10);
  }
  c.fillStyle = 'rgba(120,60,30,0.35)';                       // rust streaks
  c.fillRect(x0 + 12, y0 + h * 0.5, 3, h * 0.4 - 5); c.fillRect(x0 + w - 24, y0 + h * 0.6, 2, h * 0.3 - 5);
  c.fillStyle = '#3c444c';                                    // ridge
  c.fillRect(x0 + 5, y0 + h / 2 - 2, w - 10, 4);
  c.fillStyle = 'rgba(244,250,255,0.92)';                     // snow on the roof
  c.fillRect(x0 + 5, y0 + 5, w - 10, 4);
  c.beginPath(); c.ellipse(x0 + w * 0.35, y0 + h / 2 - 3, w * 0.22, 4, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = shadeHex(wood, 0.5);
  c.lineWidth = 2;
  c.strokeRect(x0 + 5, y0 + 5, w - 10, h - 10);
  c.restore();
}

// Radar dish seen from above on its plinth: shadow, a white-grey bowl with rings and ribs, a
// feed horn on three struts offset from the centre, a red beacon on the rim, frost.
function paintRadarDish(c, cx, cy, R, th, seed) {
  if (!(R > 6)) return;
  c.save();
  const a = -0.7 + ihash(seed * 7) * 0.4;
  c.fillStyle = 'rgba(30,45,60,0.35)';
  c.beginPath(); c.ellipse(cx + R * 0.12, cy + R * 0.16, R, R * 0.92, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#b8c4cf';
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e4ecf2';
  c.beginPath(); c.arc(cx - R * 0.08, cy - R * 0.08, R * 0.9, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(90,110,130,0.45)';
  c.lineWidth = 1;
  c.beginPath();
  for (const f of [0.3, 0.55, 0.78]) { c.moveTo(cx + R * f, cy); c.arc(cx, cy, R * f, 0, Math.PI * 2); }
  for (let k = 0; k < 6; k++) { const b = (k / 6) * Math.PI * 2; c.moveTo(cx + Math.cos(b) * R * 0.3, cy + Math.sin(b) * R * 0.3); c.lineTo(cx + Math.cos(b) * R * 0.9, cy + Math.sin(b) * R * 0.9); }
  c.stroke();
  c.strokeStyle = '#4a5866';
  c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  const hx = cx + Math.cos(a) * R * 0.35, hy = cy + Math.sin(a) * R * 0.35;
  c.strokeStyle = '#56626e';
  c.lineWidth = Math.max(1.5, R * 0.05);
  c.beginPath();
  for (let k = 0; k < 3; k++) { const b = a + Math.PI + (k - 1) * 1.2; c.moveTo(cx + Math.cos(b) * R * 0.85, cy + Math.sin(b) * R * 0.85); c.lineTo(hx, hy); }
  c.stroke();
  c.fillStyle = '#39434d';
  const hs = Math.max(4, R * 0.16);
  c.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  c.fillStyle = th.accent;
  c.fillRect(hx - hs / 2, hy - hs / 2, hs, Math.max(1, hs * 0.3));
  const bx = cx + Math.cos(a - 1.8) * R * 0.92, by = cy + Math.sin(a - 1.8) * R * 0.92;
  c.fillStyle = 'rgba(255,60,40,0.35)';
  c.beginPath(); c.arc(bx, by, Math.max(3, R * 0.12), 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ff3a2a';
  c.beginPath(); c.arc(bx, by, Math.max(1.5, R * 0.05), 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(248,252,255,0.8)';
  c.beginPath(); c.ellipse(cx - R * 0.35, cy - R * 0.62, R * 0.4, R * 0.12, -0.35, 0, Math.PI * 2); c.fill();
  c.restore();
}

function paintTempleWalls(c, map, th, cols, rows) {
  const T = map.tiles;
  const H = hintsOf(th);
  const glyphInk = shadeHex(th.wall, 0.42), band = shadeHex(th.wall, 0.72), lit = H.glyph || shadeHex(th.wall, 1.25);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const i = ty * cols + tx;
    if (T[i] !== T_WALL) continue;
    const x = tx * TILE, y = ty * TILE;
    // Sandstone ashlar: two courses per tile, staggered joints, per-block shade and chipped corners.
    c.fillStyle = shadeHex(th.wall, 0.62);
    c.fillRect(x, y, TILE, TILE);
    for (let r = 0; r < 2; r++) {
      const off = ((r + ty) & 1) ? 13 : 0;
      const yy = y + r * 20;
      for (let bx = -13; bx < TILE; bx += 26) {
        const x0 = Math.max(x, x + bx + off), x1 = Math.min(x + TILE, x + bx + off + 26);
        if (x1 - x0 < 2) continue;
        c.fillStyle = mixHex(th.wall, th.wallEdge, ihash(i * 7 + r * 3 + bx) * 0.3, 0.88 + ihash(i * 11 + r + bx) * 0.2);
        c.fillRect(x0 + 1, yy + 1, x1 - x0 - 2, 18);
        c.fillStyle = 'rgba(255,240,200,0.12)';
        c.fillRect(x0 + 1, yy + 1, x1 - x0 - 2, 1);
      }
    }
    // Carved glyph band on every side that faces open floor.
    const os = openSides(map, tx, ty);
    if (os) {
      for (let s = 0; s < 4; s++) {
        if (!(os & (1 << s))) continue;
        const horiz = s < 2;
        const bx = s === 3 ? x + TILE - 9 : x + (s === 2 ? 2 : 0);
        const by = s === 1 ? y + TILE - 9 : y + (s === 0 ? 2 : 0);
        const bw = horiz ? TILE : 7, bh = horiz ? 7 : TILE;
        c.fillStyle = band;
        c.fillRect(bx, by, bw, bh);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        if (horiz) c.fillRect(bx, by, bw, 1); else c.fillRect(bx, by, 1, bh);
        c.strokeStyle = glyphInk;
        c.lineWidth = 1;
        c.beginPath();
        for (let k = 0; k < 4; k++) {
          const gx = horiz ? bx + 5 + k * 10 : bx + 3.5, gy = horiz ? by + 3.5 : by + 5 + k * 10;
          const kind = Math.floor(ihash(i * 13 + s * 5 + k) * 4);
          if (kind === 0) { c.moveTo(gx + 2.5, gy); c.arc(gx, gy, 2.5, 0, Math.PI * 2); }
          // FIX-2 (WO9 QA TEMPLE #6): an eye and a stepped pyramid (the old T bar / zigzag read as letters).
          else if (kind === 1) { c.moveTo(gx - 3, gy); c.quadraticCurveTo(gx, gy - 3, gx + 3, gy); c.quadraticCurveTo(gx, gy + 3, gx - 3, gy); c.moveTo(gx + 0.8, gy); c.arc(gx, gy, 0.8, 0, Math.PI * 2); }
          else if (kind === 2) { c.moveTo(gx - 3, gy + 2.5); c.lineTo(gx - 3, gy + 0.5); c.lineTo(gx - 1, gy + 0.5); c.lineTo(gx - 1, gy - 1.5); c.lineTo(gx + 1, gy - 1.5); c.lineTo(gx + 1, gy + 0.5); c.lineTo(gx + 3, gy + 0.5); c.lineTo(gx + 3, gy + 2.5); }
          else { c.rect(gx - 2.5, gy - 2.5, 5, 5); c.moveTo(gx + 0.5, gy); c.arc(gx, gy, 0.5, 0, Math.PI * 2); }
        }
        c.stroke();
        c.fillStyle = rgbaHex(lit, 0.35);
        if (horiz) c.fillRect(bx, by + bh - 1, bw, 1); else c.fillRect(bx + bw - 1, by, 1, bh);
      }
    }
  }
}

// Hanging vines (TEMPLE, after the wall edges): leafy clumps on floor-facing wall edges, strands
// dangling onto the floor below south faces.
function paintVines(c, map, th, cols, rows) {
  const T = map.tiles;
  if (!T) return;
  const H = hintsOf(th);
  const clump = rgbaHex(shadeHex(H.vine, 1.05), 0.92), leaf = shadeHex(H.moss, 1.1);
  c.save();
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const i = ty * cols + tx;
    if (T[i] !== T_WALL) continue;
    const os = openSides(map, tx, ty);
    if (!os || ihash(i * 71) < 0.45) continue;
    const x = tx * TILE, y = ty * TILE;
    // clumps along one open edge
    const s = [0, 1, 2, 3].find((k) => os & (1 << k));
    c.fillStyle = clump;
    c.beginPath();
    for (let k = 0; k < 4; k++) {
      const u = 4 + ihash(i * 73 + k) * 32, r = 2.5 + ihash(i * 79 + k) * 3;
      const px = s < 2 ? x + u : (s === 2 ? x + 2 : x + TILE - 2);
      const py = s < 2 ? (s === 0 ? y + 2 : y + TILE - 2) : y + u;
      c.moveTo(px + r, py); c.arc(px, py, r, 0, Math.PI * 2);
    }
    c.fill();
    if (os & 2) {
      const n = 1 + Math.floor(ihash(i * 83) * 3);
      for (let k = 0; k < n; k++) {
        const sx = x + 5 + ihash(i * 89 + k) * 30, len = 8 + ihash(i * 97 + k) * 16;
        const sw = (ihash(i * 101 + k) - 0.5) * 8;
        c.strokeStyle = H.vine;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(sx, y + TILE - 2);
        c.quadraticCurveTo(sx + sw, y + TILE + len * 0.5, sx + sw * 0.4, y + TILE + len);
        c.stroke();
        c.fillStyle = leaf;
        for (let l = 4; l < len; l += 5) {
          const lx = sx + sw * (l / len) * 0.8 + ((l / 5) & 1 ? 2.5 : -2.5), ly = y + TILE + l;
          c.beginPath(); c.ellipse(lx, ly, 2.2, 1.3, (l / 5) & 1 ? 0.6 : -0.6, 0, Math.PI * 2); c.fill();
        }
      }
    }
  }
  c.restore();
}

// ---- dynamic: lamps, water, overlays ----
const wo9Glows = {};
function wo9Glow(kind) {
  if (wo9Glows[kind] !== undefined || typeof document === 'undefined') return wo9Glows[kind] || null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const lc = kind === 'lamp' && lampGlowHex ? hexRgb(lampGlowHex) : null;
  const rgb = kind === 'ice' ? '190,235,255' : kind === 'teal' ? '63,214,168' : lc ? lc.join(',') : '255,222,160';
  grad.addColorStop(0, `rgba(${rgb},0.9)`);
  grad.addColorStop(kind === 'lamp' ? 0.2 : 0.35, `rgba(${rgb},0.42)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  wo9Glows[kind] = c;
  return c;
}
function blitWo9Glow(kind, x, y, r, alpha) {
  const gl = wo9Glow(kind);
  if (!gl || !(alpha > 0) || !(r > 0)) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(gl, x - r, y - r, r * 2, r * 2);
}

// KINO wall lamps (theme.torch): steady warm amber-white glow, brass sconce, frosted bulb.
let lampGlowHex = null;
function drawKinoLamps(view, now, theme) {
  const hx = theme && theme.hints ? theme.hints.lamp : null;
  if (hx && hx !== lampGlowHex) { lampGlowHex = hx; wo9Glows.lamp = undefined; }
  const list = staticLayer && staticLayer.torches;
  if (!list || !list.length) return;
  ctx.save();
  for (let i = 0; i < list.length; i++) {
    const tc = list[i];
    if (!inView(view, tc.x, tc.y, 70)) continue;
    const br = 0.92 + 0.05 * Math.sin(now * 1.3 + tc.seed);
    ctx.globalCompositeOperation = 'lighter';
    blitWo9Glow('lamp', tc.x + tc.dx * 10, tc.y + tc.dy * 10, 56 * br, 0.32 * br);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#6a4a1c';
    ctx.fillRect(tc.x - 5, tc.y - 5, 10, 10);
    ctx.fillStyle = '#c99a42';
    ctx.fillRect(tc.x - 4, tc.y - 4, 8, 8);
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath();
    ctx.arc(tc.x + tc.dx * 4, tc.y + tc.dy * 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// TEMPLE water: slow deterministic ripple highlights (from game time) on the visible pit tiles,
// batched into two paths.
function drawTempleWater(view, t, theme) {
  const H = hintsOf(theme);
  const pits = staticLayer && staticLayer.pits;
  if (!pits || !pits.length) return;
  const cols = staticLayer.cols;
  const x0 = Math.floor(view.x / TILE) - 1, y0 = Math.floor(view.y / TILE) - 1;
  const x1 = Math.ceil((view.x + view.w) / TILE) + 1, y1 = Math.ceil((view.y + view.h) / TILE) + 1;
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = H.ripple;
  ctx.beginPath();
  let any = false;
  for (let q = 0; q < pits.length; q++) {
    const i = pits[q], tx = i % cols, ty = (i / cols) | 0;
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    any = true;
    const x = tx * TILE, y = ty * TILE;
    for (let k = 0; k < 2; k++) {
      const s = ihash(i * 5 + k);
      const f = fract(t * 0.22 + s);
      const len = 3 + 11 * Math.sin(Math.PI * f);
      const xx = x + 4 + ihash(i * 7 + k) * (TILE - 20) + f * 6;
      const yy = y + 6 + ihash(i * 11 + k) * (TILE - 12);
      const bump = 1.6 * Math.sin(t * 1.3 + s * 6.28);
      ctx.moveTo(xx, yy);
      ctx.quadraticCurveTo(xx + len / 2, yy - bump, xx + len, yy);
    }
  }
  if (any) ctx.stroke();
  // Occasional concentric rings (a drip), fainter.
  ctx.strokeStyle = H.rippleRing;
  ctx.beginPath();
  for (let q = 0; q < pits.length; q++) {
    const i = pits[q];
    if (ihash(i * 13) < 0.86) continue;
    const tx = i % cols, ty = (i / cols) | 0;
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    const f = fract(t * 0.3 + ihash(i * 17));
    const r = 2 + 13 * f;
    const cx = tx * TILE + 12 + ihash(i * 19) * 16, cy = ty * TILE + 12 + ihash(i * 23) * 16;
    ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

// KINO film grain: one pre-rendered 128 px noise tile as a pattern, static on screen (no flicker).
let grainPattern = null, grainCtx = null;
function getGrainPattern() {
  if (grainPattern && grainCtx === ctx) return grainPattern;
  if (typeof document === 'undefined' || !ctx) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    const d = img.data;
    for (let i = 0; i < 128 * 128; i++) {
      const h = ihash(i * 2654435761 + 17);
      const v = h > 0.5 ? 255 : 0;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = Math.round(Math.abs(h - 0.5) * 2 * 110);
    }
    g.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(c, 'repeat');
    grainCtx = ctx;
  } catch (_) { grainPattern = null; }
  return grainPattern;
}

const WO9_GRAIN_ALPHA = 0.28;
// Screen-space style overlays after the ambient tint.
function drawStyleOverlay(theme, W, H, view, zoom, now) {
  const st = theme.style;
  if (st === 'kino') {
    const pat = getGrainPattern();
    if (pat) {
      const gs = theme.hints ? theme.hints.grain : 0.035;
      ctx.globalAlpha = Math.min(0.6, WO9_GRAIN_ALPHA * gs / 0.035);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  } else if (st === 'outpost') { if (hintsOf(theme).snow) drawSnowfall(W, H, view, zoom, now); }
  else if (st === 'temple') { if (hintsOf(theme).spores) drawSpores(W, H, view, zoom, now); }
}

// Light snowfall: flakes on three depths drifting down and with the wind; under
// prefers-reduced-motion a sparse static field. Positions from wall time (no allocation).
function drawSnowfall(W, H, view, zoom, now) {
  const rm = prefersReducedMotion();
  const N = rm ? 36 : 120;
  const tt = rm ? 0 : now;
  const ox = rm ? 0 : -view.x * zoom, oy = rm ? 0 : -view.y * zoom;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < N; i++) {
    const depth = 0.3 + ihash(i * 3 + 1) * 0.7;
    const size = 1 + depth * 2.2;
    const x = fract((ihash(i * 3) * W + tt * (8 + 26 * depth) + Math.sin(tt * 0.7 + i) * 10 * depth + ox * depth * 0.6) / (W + 20)) * (W + 20) - 10;
    const y = fract((ihash(i * 3 + 2) * H + tt * (16 + 44 * depth) + oy * depth * 0.6) / (H + 20)) * (H + 20) - 10;
    ctx.globalAlpha = 0.35 + 0.45 * depth;
    ctx.fillStyle = '#5f7a96';
    ctx.fillRect(x + 1, y + 1, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

// Very subtle drifting spores (green-gold motes); static and fewer under reduced motion.
function drawSpores(W, H, view, zoom, now) {
  const rm = prefersReducedMotion();
  const N = rm ? 10 : 26;
  const tt = rm ? 0 : now;
  const ox = rm ? 0 : -view.x * zoom * 0.4, oy = rm ? 0 : -view.y * zoom * 0.4;
  ctx.fillStyle = '#e2ef8c';
  for (let i = 0; i < N; i++) {
    const sp = 0.5 + ihash(i * 5 + 3);
    const x = fract((ihash(i * 5) * W + Math.sin(tt * 0.3 * sp + i * 1.7) * 30 + tt * 4 + ox * sp) / W) * W;
    const y = fract((ihash(i * 5 + 1) * H - tt * 7 * sp + oy * sp) / H) * H;
    const a = 0.16 + 0.12 * Math.sin(tt * 0.9 + i * 2.1);
    ctx.globalAlpha = a * 0.4;
    ctx.fillRect(x - 1.5, y - 1.5, 4, 4);
    ctx.globalAlpha = a;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

// ---- boss abilities (frost / tide) ----
function rayBlocks(code) { return isSolidCode(code) || code === T_DOOR || code === T_STAIRS; }
// Distance from (x, y) along angle a to the first ray-blocking tile, capped at max (10 px steps).
function rayReach(map, x, y, a, max) {
  const dx = Math.cos(a), dy = Math.sin(a);
  for (let d = 6; d <= max; d += 10) {
    if (rayBlocks(tileAt(map, Math.floor((x + dx * d) / TILE), Math.floor((y + dy * d) / TILE)))) return Math.max(0, d - 6);
  }
  return max;
}
const CONE_RAYS = 17;
const coneReach = new Float32Array(CONE_RAYS);
const TIDE_RAYS = 72;
const tideReach = new Float32Array(TIDE_RAYS);
const DASH_ICE = [8, 6], NO_DASH = [];

function frostCfgR() {
  const F = CFG.BOSS && CFG.BOSS.frost;
  return F || { telegraph: 0.6, range: 260, halfAngle: 0.5, slowSeconds: 2 };
}
function tideCfgR() {
  const T = CFG.BOSS && CFG.BOSS.tide;
  return T || { telegraph: 0.8, maxRadius: 420, band: 28 };
}
function frostAngle(state, z) {
  const f = z.frost;
  if (Number.isFinite(f.angle) && (f.phase === 'telegraph' || f.phase === 'breath')) return f.angle;
  const p = state.player;
  return p ? Math.atan2(p.y - z.y, p.x - z.x) : 0;
}
// Cone outline from radius r0 to min(len, wall reach) per ray.
function conePath(x, y, ang, half, r0, len) {
  ctx.beginPath();
  for (let k = 0; k < CONE_RAYS; k++) {
    const a = ang - half + (2 * half * k) / (CONE_RAYS - 1);
    const d = Math.max(r0, Math.min(len, coneReach[k]));
    if (k === 0) ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.arc(x, y, r0, ang + half, ang - half, true);
  ctx.closePath();
}

// Floor-level pass before the zombies: frost cone preview / breath cone, tide ring.
function drawBossAbilitiesFloor(state, view, t) {
  const zs = state.zombies;
  if (!Array.isArray(zs)) return;
  for (let n = 0; n < zs.length; n++) {
    const z = zs[n];
    if (!z || z.kind !== 'boss' || z.mode === 'dying') continue;
    try {
      if (z.frost && (z.frost.phase === 'telegraph' || z.frost.phase === 'breath')) drawFrostCone(state, z, view, t);
      if (z.tide && (z.tide.phase === 'telegraph' || z.tide.phase === 'wave')) drawTideFloor(state, z, view, t);
    } catch (_) { /* never break the frame */ }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function frostTelegraphBoost(state) {
  return themeOf(state).style === 'outpost' ? 1.6 : 1;
}

function drawFrostCone(state, z, view, t) {
  const F = frostCfgR();
  const f = z.frost, map = state.map;
  const R = F.range > 0 ? F.range : 260, half = F.halfAngle > 0 ? F.halfAngle : 0.5;
  if (!inView(view, z.x, z.y, R + 40)) return;
  const ang = frostAngle(state, z);
  const r0 = (z.radius || 34) * 0.6;
  for (let k = 0; k < CONE_RAYS; k++) coneReach[k] = rayReach(map, z.x, z.y, ang - half + (2 * half * k) / (CONE_RAYS - 1), R);
  ctx.save();
  if (f.phase === 'telegraph') {
    const tel = F.telegraph > 0 ? F.telegraph : 0.6;
    const prog = Math.max(0, Math.min(1, (f.t || 0) / tel));
    conePath(z.x, z.y, ang, half, r0, R);
    ctx.fillStyle = '#9fd8ff';
    // FIX-2 (WO9 QA OUTPOST #5): brighter telegraph fill on the light OUTPOST look.
    const boost = frostTelegraphBoost(state);
    ctx.globalAlpha = Math.min(0.5, (0.08 + 0.12 * prog) * boost);
    ctx.fill();
    ctx.globalAlpha = 0.55 + 0.35 * prog;
    ctx.strokeStyle = '#d8f4ff';
    ctx.lineWidth = 2;
    ctx.setLineDash(DASH_ICE);
    ctx.lineDashOffset = -t * 40;
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    // Filling sweep: how close the breath is.
    conePath(z.x, z.y, ang, half, r0, r0 + (R - r0) * prog);
    ctx.fillStyle = '#c8ecff';
    ctx.globalAlpha = Math.min(0.5, 0.18 * boost);
    ctx.fill();
  } else {
    const dur = 0.35;
    const prog = Math.max(0, Math.min(1, (f.t || 0) / dur));
    const I = prog < 0.2 ? 0.5 + prog * 2.5 : 1 - (prog - 0.2) * 0.75;
    const len = r0 + (R - r0) * Math.min(1, 0.35 + prog * 2.2);
    conePath(z.x, z.y, ang, half, r0, len);
    ctx.fillStyle = '#bfe6ff';
    ctx.globalAlpha = 0.34 * I;
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    conePath(z.x, z.y, ang, half * 0.55, r0, len * 0.9);
    ctx.fillStyle = '#eaf8ff';
    ctx.globalAlpha = 0.22 * I;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // Ice particles streaming out, cut at the walls.
    for (let k = 0; k < 40; k++) {
      const u = ihash(k * 3 + 1) * 2 - 1;
      const a = ang + u * half * 0.95;
      const ri = Math.min(CONE_RAYS - 1, Math.max(0, Math.round((u + 1) * 0.5 * (CONE_RAYS - 1))));
      const reach = Math.min(len, coneReach[ri]);
      const d = r0 + fract(ihash(k * 3 + 2) + prog * 1.6) * (len - r0);
      if (d > reach) continue;
      const px = z.x + Math.cos(a) * d, py = z.y + Math.sin(a) * d;
      const s = 1.5 + ihash(k * 7) * 2.5;
      ctx.globalAlpha = 0.85 * I;
      ctx.fillStyle = k & 1 ? '#ffffff' : '#bfe8ff';
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
      if (k % 5 === 0) { ctx.fillRect(px - s * 1.5, py - 0.5, s * 3, 1); ctx.fillRect(px - 0.5, py - s * 1.5, 1, s * 3); }
    }
  }
  ctx.restore();
}

function drawTideFloor(state, z, view, t) {
  const T = tideCfgR();
  const w = z.tide, map = state.map;
  const maxR = T.maxRadius > 0 ? T.maxRadius : 420, band = T.band > 0 ? T.band : 28;
  const r = z.radius || 34;
  ctx.save();
  if (w.phase === 'telegraph') {
    if (!inView(view, z.x, z.y, maxR + band)) { ctx.restore(); return; }
    const tel = T.telegraph > 0 ? T.telegraph : 0.8;
    const prog = Math.max(0, Math.min(1, (w.t || 0) / tel));
    // Dark water welling up under the boss.
    ctx.fillStyle = '#0f4a46';
    ctx.globalAlpha = 0.25 + 0.25 * prog;
    ctx.beginPath(); ctx.arc(z.x, z.y, r * (1.2 + 0.6 * prog), 0, Math.PI * 2); ctx.fill();
    // Faint reach circle (where the wave will stop). FIX-2 (WO9 QA TEMPLE #2): at the real hit
    // reach (maxRadius + 0.6 band: a centre hit up to maxRadius + band always overlaps the line)
    // and cut per ray at walls / pillars like the wave ring itself.
    const reachR = maxR + band * 0.6;
    for (let k = 0; k < TIDE_RAYS; k++) tideReach[k] = rayReach(map, z.x, z.y, (k / TIDE_RAYS) * Math.PI * 2, reachR + 4);
    ctx.globalAlpha = 0.12 + 0.18 * prog;
    ctx.strokeStyle = '#6ff0d0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DASH_ICE);
    ctx.lineDashOffset = t * 30;
    const da0 = (Math.PI * 2) / TIDE_RAYS;
    ctx.beginPath();
    let openArc = false;
    for (let k = 0; k < TIDE_RAYS; k++) {
      if (tideReach[k] >= reachR - 2) {
        const a0 = (k - 0.5) * da0, a1 = (k + 0.5) * da0;
        if (!openArc) ctx.moveTo(z.x + Math.cos(a0) * reachR, z.y + Math.sin(a0) * reachR);
        ctx.arc(z.x, z.y, reachR, a0, a1);
        openArc = true;
      } else openArc = false;
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  } else {
    const R = w.radius || 0;
    const cx = Number.isFinite(w.x) ? w.x : z.x, cy = Number.isFinite(w.y) ? w.y : z.y;
    if (R <= 0 || !inView(view, cx, cy, R + band)) { ctx.restore(); return; }
    const fade = 1 - 0.8 * Math.pow(Math.min(1, R / maxR), 3);
    for (let k = 0; k < TIDE_RAYS; k++) tideReach[k] = rayReach(map, cx, cy, (k / TIDE_RAYS) * Math.PI * 2, R + 4);
    const da = (Math.PI * 2) / TIDE_RAYS;
    const ringPath = (rad) => {
      ctx.beginPath();
      let open = false;
      for (let k = 0; k < TIDE_RAYS; k++) {
        const ok = tideReach[k] >= Math.min(rad, R) - 2;
        if (ok) {
          const a0 = (k - 0.5) * da, a1 = (k + 0.5) * da;
          if (!open) ctx.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
          ctx.arc(cx, cy, rad, a0, a1);
          open = true;
        } else open = false;
      }
    };
    ringPath(R);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#1f9a86';
    ctx.globalAlpha = 0.28 * fade;
    ctx.lineWidth = band * 1.2;
    ctx.stroke();
    ctx.strokeStyle = '#3fd6a8';
    ctx.globalAlpha = 0.85 * fade;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#eafff8';
    ctx.globalAlpha = 0.8 * fade;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Trailing ripple
    if (R > 40) {
      ringPath(R * 0.78);
      ctx.strokeStyle = '#6ff0d0';
      ctx.globalAlpha = 0.25 * fade;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Foam flecks on the crest
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85 * fade;
    const nf = Math.min(90, Math.max(16, Math.round(R / 5)));
    for (let k = 0; k < nf; k++) {
      const a = ((k + ihash(k * 7) * 0.8) / nf) * Math.PI * 2;
      const ri = Math.floor(((a / (Math.PI * 2)) * TIDE_RAYS + 0.5)) % TIDE_RAYS;
      if (tideReach[ri] < R - 2) continue;
      const rr = R + 2 + ihash(k * 11 + Math.floor(t * 8)) * 6;
      const s = 1.5 + ihash(k * 13) * 2;
      ctx.fillRect(cx + Math.cos(a) * rr - s / 2, cy + Math.sin(a) * rr - s / 2, s, s);
    }
  }
  ctx.restore();
}

// After the zombies: icy glow + frost mist (frost telegraph / breath), water swirl (tide telegraph).
function drawBossAbilitiesFx(state, view, t) {
  const zs = state.zombies;
  if (!Array.isArray(zs)) return;
  for (let n = 0; n < zs.length; n++) {
    const z = zs[n];
    if (!z || z.kind !== 'boss' || z.mode === 'dying' || !inView(view, z.x, z.y, 160)) continue;
    const r = z.radius || 34;
    ctx.save();
    try {
      const f = z.frost;
      if (f && (f.phase === 'telegraph' || f.phase === 'breath')) {
        const F = frostCfgR();
        const tel = F.telegraph > 0 ? F.telegraph : 0.6;
        const prog = f.phase === 'telegraph' ? Math.max(0, Math.min(1, (f.t || 0) / tel)) : 1;
        const pulse = 0.5 + 0.5 * Math.sin(t * (14 + prog * 26));
        ctx.globalCompositeOperation = 'lighter';
        blitWo9Glow('ice', z.x, z.y, r * (1.6 + 0.5 * prog), 0.35 + 0.35 * prog * pulse);
        ctx.globalCompositeOperation = 'source-over';
        const ang = frostAngle(state, z);
        const mx = z.x + Math.cos(ang) * r * 0.8, my = z.y + Math.sin(ang) * r * 0.8;
        ctx.fillStyle = '#e6f7ff';
        for (let k = 0; k < 7; k++) {
          const u = fract(t * 1.4 + ihash(k * 5));
          const a = ang + (ihash(k * 9) - 0.5) * 1.4;
          ctx.globalAlpha = 0.6 * (1 - u);
          const s = 2 + u * 5;
          ctx.fillRect(mx + Math.cos(a) * u * 16 - s / 2, my + Math.sin(a) * u * 16 - s / 2, s, s);
        }
        if (f.phase === 'telegraph') {
          ctx.globalAlpha = 0.6 + 0.4 * pulse;
          ctx.strokeStyle = pulse > 0.5 ? '#bfe8ff' : '#ffffff';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(z.x, z.y, r + 4 + prog * 6, 0, Math.PI * 2); ctx.stroke();
        }
      }
      const w = z.tide;
      if (w && w.phase === 'telegraph') {
        const T = tideCfgR();
        const tel = T.telegraph > 0 ? T.telegraph : 0.8;
        const prog = Math.max(0, Math.min(1, (w.t || 0) / tel));
        ctx.globalCompositeOperation = 'lighter';
        blitWo9Glow('teal', z.x, z.y, r * (1.8 + 0.4 * prog), 0.3 + 0.3 * prog);
        ctx.globalCompositeOperation = 'source-over';
        // Three spiral arms of water circling the boss, tightening as the wave nears.
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#eafff8' : '#3fd6a8';
          ctx.lineWidth = pass ? 1.2 : 3.5;
          ctx.globalAlpha = pass ? 0.75 : 0.8;
          ctx.beginPath();
          for (let j = 0; j < 3; j++) {
            for (let s = 0; s <= 10; s++) {
              const rr = r * (0.95 + (1.5 - 0.6 * prog) * (s / 10)) + (pass ? 2 : 0);
              const a = t * (4 + 4 * prog) + j * 2.094 + s * 0.32;
              const px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr;
              if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }
        ctx.fillStyle = '#bff8ea';
        for (let k = 0; k < 10; k++) {
          const a = -t * 3 + k * 0.628;
          const rr = r * (1.3 + 0.3 * Math.sin(t * 5 + k));
          ctx.globalAlpha = 0.7;
          ctx.fillRect(z.x + Math.cos(a) * rr - 1.5, z.y + Math.sin(a) * rr - 1.5, 3, 3);
        }
      }
    } catch (_) { /* never break the frame */ }
    ctx.restore();
  }
}

// ---- frost-slowed player ----
function frostSlowAmount(p) {
  if (!p || p.down || !(p.slowT > 0)) return 0;
  const F = frostCfgR();
  const S = F.slowSeconds > 0 ? F.slowSeconds : 2;
  return Math.max(0.35, Math.min(1, p.slowT / S));
}
function drawPlayerFrost(state, now) {
  const p = state.player;
  const k = frostSlowAmount(p);
  if (!k) return;
  const rm = prefersReducedMotion();
  const R = (p.radius || 14);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  blitWo9Glow('ice', p.x, p.y, R * 2.4, 0.4 * k);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.8 * k;
  ctx.strokeStyle = '#bfe8ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, R + 6, R + 4, 0, 0, Math.PI * 2); ctx.stroke();
  // Frost film over the body.
  ctx.fillStyle = '#bfe8ff';
  ctx.globalAlpha = 0.22 * k;
  ctx.beginPath(); ctx.arc(p.x, p.y, R + 1, 0, Math.PI * 2); ctx.fill();
  // Six ice crystals (6-point stars) circling slowly: dark outline pass, then bright.
  ctx.globalAlpha = 0.9 * k;
  const spin = rm ? 0 : now * 0.9;
  for (let pass = 0; pass < 2; pass++) {
  ctx.strokeStyle = pass ? '#f2fbff' : 'rgba(30,70,110,0.7)';
  ctx.lineWidth = pass ? 1.4 : 3;
  ctx.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = spin + j * 1.047;
    const cx = p.x + Math.cos(a) * (R + 10), cy = p.y + Math.sin(a) * (R + 8);
    const s = 3.5 + (j & 1) * 1.5;
    for (let m = 0; m < 3; m++) {
      const b = m * 1.047 + a;
      const dx = Math.cos(b) * s, dy = Math.sin(b) * s;
      ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy);
    }
  }
  ctx.stroke();
  }
  ctx.restore();
}
let frostVignette = null;
function drawFrostVignette(state, W, H) {
  const k = frostSlowAmount(state.player);
  if (!k || !ctx) return;
  if (!frostVignette) {
    frostVignette = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.3);
    frostVignette.addColorStop(0, 'rgba(180,225,255,0)');
    frostVignette.addColorStop(0.5, 'rgba(170,220,255,0.14)');
    frostVignette.addColorStop(1, 'rgba(220,245,255,0.55)');
  }
  fillUnitVignette(frostVignette, W, H, k);
}

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
