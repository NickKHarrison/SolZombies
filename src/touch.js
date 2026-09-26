// touch.js (WO6 Agent A) - twin-stick touch controls + on-screen buttons.
// DOM module: no window/document access at module top level, so importing it under node is safe
// (input.js imports it). Everything DOM happens inside initTouch().
//
// Contract (WORK_ORDER_6 section 3):
//   initTouch(layerEl, canvas)  idempotent; builds the DOM inside layerEl and installs pointer listeners
//   setTouchEnabled(on)         show / hide the layer (and release everything when hidden)
//   setTouchPrompt(text|null)   ACTION button label; null / '' hides it
//   getTouchState()             fresh snapshot (see below); edge flags persist until endTouchFrame()
//   endTouchFrame()             clear edge flags
//   isTouchActive()             layer initialised and enabled
//
// DOM created (styled by styles.css, Agent B):
//   .tj-zone.tj-left / .tj-zone.tj-right  (full-height halves)
//   .tj-base + .tj-knob inside each zone (always visible at a FIXED position set by CSS; only the
//   knob moves while dragged, left/top in % of the zone; released knob recentres on the base)
//   .tbtn.tbtn-reload "RELOAD", .tbtn.tbtn-swap "SWAP", .tbtn.tbtn-pause "‖", .tbtn.tbtn-action (> .tbtn-label)
//   pressed state: class .pressed

const STICK_RADIUS_H = 0.13;  // stick travel radius as a fraction of the layer height
const MOVE_DEADZONE = 0.08;   // move stick magnitude below this = no movement
const SPRINT_MAG = 0.92;      // move stick magnitude above this = sprint
const AIM_DEADZONE = 0.12;    // aim direction only updates above this magnitude (keeps last aim)
const FIRE_MAG = 0.35;        // aim stick magnitude above this = auto-fire
const GRAB_RADIUS = 2.2;      // a touch within this many stick radii of a fixed stick grabs it

let layer = null;
let enabled = false;
let allowMouse = false;
let cleanup = null;

// Per-stick state. pointerId === null means the stick is free.
function makeStick(side) {
  return { side, zone: null, base: null, knob: null, pointerId: null, ox: 0, oy: 0, dx: 0, dy: 0, mag: 0, radius: 1 };
}
const sticks = { left: makeStick('left'), right: makeStick('right') };

// Buttons: name -> { el, pointerId }
const buttons = {};
let promptText = null;

// Continuous touch values.
let aimX = 0, aimY = 0;       // last non-zero aim direction (unit) or 0,0 before the first aim
let firing = false;

const edge = { firePressed: false, reload: false, swap: false, interact: false, pause: false, start: false };

function clearEdges() {
  edge.firePressed = false;
  edge.reload = false;
  edge.swap = false;
  edge.interact = false;
  edge.pause = false;
  edge.start = false;
}

function accepts(e) {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse' && allowMouse) return e.button === 0 || e.type !== 'pointerdown';
  return false;
}

// ---------------------------------------------------------------- sticks

// Fixed sticks (mobile follow-up): base and knob are always shown; `on` only marks the stick active.
function stickVisible(s, on) {
  if (!s.base) return;
  s.zone.classList.toggle('active', on);
}

// Fixed centre of a stick in client coordinates, read from its CSS-positioned base.
function stickCentre(s) {
  const b = s.base.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}

function placeStick(s) {
  const r = s.zone.getBoundingClientRect();
  const w = r.width || 1, h = r.height || 1;
  s.knob.style.left = (((s.ox + s.dx * s.radius) - r.left) / w) * 100 + '%';
  s.knob.style.top = (((s.oy + s.dy * s.radius) - r.top) / h) * 100 + '%';
}

function stickDown(s, e) {
  const lr = layer.getBoundingClientRect();
  s.pointerId = e.pointerId;
  s.radius = Math.max(8, (lr.height || 400) * STICK_RADIUS_H);
  const c = stickCentre(s);
  s.ox = c.x;
  s.oy = c.y;
  try { s.zone.setPointerCapture(e.pointerId); } catch (_) { /* synthetic / already gone */ }
  stickVisible(s, true);
  stickMove(s, e); // the finger's offset from the fixed centre applies at once
}

function stickMove(s, e) {
  let dx = (e.clientX - s.ox) / s.radius;
  let dy = (e.clientY - s.oy) / s.radius;
  let mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; mag = 1; }
  s.dx = dx; s.dy = dy; s.mag = mag;
  placeStick(s);
  if (s.side === 'right') updateAim(s);
}

function stickUp(s) {
  if (s.zone && s.pointerId !== null) {
    try { s.zone.releasePointerCapture(s.pointerId); } catch (_) { /* ignore */ }
  }
  s.pointerId = null;
  s.dx = 0; s.dy = 0; s.mag = 0;
  if (s.knob) { s.knob.style.left = ''; s.knob.style.top = ''; } // spring back to the base centre
  stickVisible(s, false);
  if (s.side === 'right') firing = false; // aimX/aimY are kept (last aim retention)
}

function updateAim(s) {
  if (s.mag > AIM_DEADZONE) {
    aimX = s.dx / s.mag;
    aimY = s.dy / s.mag;
  }
  const f = s.mag > FIRE_MAG;
  if (f && !firing) edge.firePressed = true;
  firing = f;
}

// ---------------------------------------------------------------- buttons

function pressButton(name, e) {
  const b = buttons[name];
  b.pointerId = e.pointerId;
  b.el.classList.add('pressed');
  try { b.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (name === 'reload') edge.reload = true;
  else if (name === 'swap') edge.swap = true;
  else if (name === 'pause') edge.pause = true;
  else if (name === 'action') edge.interact = true;
}

function releaseButton(name) {
  const b = buttons[name];
  if (!b) return;
  if (b.pointerId !== null) {
    try { b.el.releasePointerCapture(b.pointerId); } catch (_) { /* ignore */ }
  }
  b.pointerId = null;
  b.el.classList.remove('pressed');
}

function releaseAll() {
  stickUp(sticks.left);
  stickUp(sticks.right);
  for (const name of Object.keys(buttons)) releaseButton(name);
  firing = false;
}

// ---------------------------------------------------------------- DOM

function el(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildDom(root) {
  for (const side of ['left', 'right']) {
    const s = sticks[side];
    s.zone = el('div', `tj-zone tj-${side}`);
    s.zone.dataset.stick = side;
    s.base = el('div', 'tj-base');
    s.knob = el('div', 'tj-knob');
    s.zone.append(s.base, s.knob);
    root.appendChild(s.zone);
    stickVisible(s, false);
  }
  const defs = [['reload', 'RELOAD'], ['swap', 'SWAP'], ['pause', '‖']];
  for (const [name, label] of defs) {
    const b = el('div', `tbtn tbtn-${name}`, label);
    b.dataset.btn = name;
    root.appendChild(b);
    buttons[name] = { el: b, pointerId: null };
  }
  const action = el('div', 'tbtn tbtn-action');
  action.dataset.btn = 'action';
  const lbl = el('span', 'tbtn-label', '');
  action.appendChild(lbl);
  root.appendChild(action);
  buttons.action = { el: action, pointerId: null, label: lbl };
  applyPrompt();
}

function applyPrompt() {
  const b = buttons.action;
  if (!b) return;
  const on = !!promptText;
  if (on) b.label.textContent = promptText;
  b.el.style.display = on ? '' : 'none';
  if (!on) releaseButton('action');
}

// ---------------------------------------------------------------- listeners

function onPointerDown(e) {
  if (!enabled || !accepts(e)) return;
  const btnEl = e.target && e.target.closest ? e.target.closest('.tbtn') : null;
  if (btnEl && layer.contains(btnEl)) {
    const name = btnEl.dataset.btn;
    const b = buttons[name];
    if (b && b.pointerId === null) { pressButton(name, e); return; }
    return; // button already held by another finger: ignore
  }
  // Anything that is not a button is a "tap" for menu start / gameover restart (main decides by phase).
  edge.start = true;
  const lr = layer.getBoundingClientRect();
  const r = Math.max(8, (lr.height || 400) * STICK_RADIUS_H);
  let best = null, bestD = Infinity;
  for (const side of ['left', 'right']) {
    const st = sticks[side];
    if (!st.base || st.pointerId !== null) continue;
    const c = stickCentre(st);
    const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
    if (d < bestD) { bestD = d; best = st; }
  }
  if (best && bestD <= r * GRAB_RADIUS) stickDown(best, e);
  if (e.pointerType === 'mouse') e.preventDefault();
}

function onPointerMove(e) {
  if (!enabled) return;
  for (const side of ['left', 'right']) {
    const s = sticks[side];
    if (s.pointerId === e.pointerId) { stickMove(s, e); return; }
  }
}

function onPointerUp(e) {
  for (const side of ['left', 'right']) {
    const s = sticks[side];
    if (s.pointerId === e.pointerId) stickUp(s);
  }
  for (const name of Object.keys(buttons)) {
    if (buttons[name].pointerId === e.pointerId) releaseButton(name);
  }
}

const prevent = (e) => { if (e.cancelable) e.preventDefault(); };

/**
 * Build the touch UI inside layerEl and install listeners. Idempotent: a second call with the same
 * layer is a no-op; a different layer tears down the previous one first.
 * @param {HTMLElement} layerEl  the #touch div
 * @param {HTMLCanvasElement} [canvas]  unused for now (kept for the contract)
 */
export function initTouch(layerEl, canvas) { // eslint-disable-line no-unused-vars
  if (!layerEl) return;
  if (layer === layerEl && cleanup) return;
  if (cleanup) cleanup();
  layer = layerEl;
  try {
    allowMouse = new URLSearchParams(window.location.search).get('touch') === '1';
  } catch (_) { allowMouse = false; }

  layer.replaceChildren();
  buildDom(layer);

  const onBlur = () => releaseAll();
  const onVisibility = () => { if (document.hidden) releaseAll(); };

  layer.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  layer.addEventListener('lostpointercapture', onPointerUp);
  for (const t of ['touchstart', 'touchmove', 'contextmenu', 'dblclick']) {
    layer.addEventListener(t, prevent, { passive: false });
  }
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  setTouchEnabled(enabled);

  cleanup = () => {
    layer.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    layer.removeEventListener('lostpointercapture', onPointerUp);
    for (const t of ['touchstart', 'touchmove', 'contextmenu', 'dblclick']) {
      layer.removeEventListener(t, prevent);
    }
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    releaseAll();
    layer.replaceChildren();
    for (const k of Object.keys(buttons)) delete buttons[k];
    for (const side of ['left', 'right']) Object.assign(sticks[side], makeStick(side));
    cleanup = null;
  };
}

/** Show / hide the touch layer. Hiding releases every stick and button. */
export function setTouchEnabled(on) {
  enabled = !!on;
  if (!layer) return;
  layer.style.display = enabled ? '' : 'none';
  layer.classList.toggle('on', enabled);
  if (!enabled) { releaseAll(); clearEdges(); }
}

/** ACTION button label (e.g. "Buy Sheiva [50]"); null / '' hides the button. */
export function setTouchPrompt(text) {
  const t = text ? String(text) : null;
  if (t === promptText) return; // called every frame: avoid DOM churn
  promptText = t;
  applyPrompt();
}

/** Fresh snapshot of the touch controls. */
export function getTouchState() {
  const L = sticks.left, R = sticks.right;
  const moving = L.pointerId !== null && L.mag > MOVE_DEADZONE;
  const held = (n) => !!(buttons[n] && buttons[n].pointerId !== null);
  return {
    active: isTouchActive(),
    moveX: moving ? L.dx : 0,
    moveY: moving ? L.dy : 0,
    sprint: moving && L.mag > SPRINT_MAG,
    aimX,
    aimY,
    aimActive: R.pointerId !== null,
    fire: firing,
    firePressed: edge.firePressed,
    reload: edge.reload,
    swap: edge.swap,
    interact: edge.interact,
    interactHeld: held('action'),
    pause: edge.pause,
    start: edge.start,
  };
}

/** Clear edge flags. input.endFrame() calls this once per frame. */
export function endTouchFrame() {
  clearEdges();
}

export function isTouchActive() {
  return enabled && layer !== null;
}
