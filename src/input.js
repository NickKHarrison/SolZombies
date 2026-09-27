// input.js (Agent A) - keyboard + mouse state for the game loop.
// DOM module: only touches window/document inside initInput(), so importing it under node is safe.
//
// Contract (WORK_ORDER 3.6):
//   initInput(canvas)
//   getInput() -> { moveX, moveY, mouseX, mouseY, fire, firePressed, reload, interact, interactHeld,
//                   swap, sprint, restart, start, pause, debugKey, slot, wheel }
//   endFrame()  -> clears edge-triggered flags
//
// Additions beyond the contract (documented in docs/notes/input.md):
//   slot  : 0 (no digit pressed this frame) | 1 | 2  (1-based weapon slot chosen with digit keys)
//   wheel : -1 | 0 | 1 wheel direction this frame (also sets swap = true)
//   resetInput() : releases everything (optional helper for restart/tests)
//
// WO6 (touch): getInput() also returns
//   aimVector : {x, y} unit (last non-zero touch aim) while touch is active, else null (desktop)
//   autoFire  : true while the touch aim stick is past the fire threshold (semi-autos cycle at rpm)
// and merges touch.getTouchState() when touch.isTouchActive(). Keyboard/mouse keep working.
//
// WO7 (knife / Mule Kick): getInput() also returns
//   melee : edge, true for the frame V was pressed (or the touch KNIFE button was tapped)
//   slot  : may now be 3 (digit 3) for the Mule Kick third weapon slot
//
// WO9 (level select): getInput() also returns
//   levelSelect : edge, true for the frame Shift+M was pressed (plain M never sets it)
// While levelselect.isLevelSelectOpen(): keydowns set no edges except levelSelect and are not
// recorded as held; getInput() returns a neutral snapshot (no move/fire/start/restart/pause/...)
// apart from mouseX/mouseY and levelSelect. The overlay handles its own keys (window capture).

import { INPUT, LEVEL_SELECT } from './config.js';
import * as touch from './touch.js';
import * as levelselect from './levelselect.js'; // WO9: gameplay input is neutral while the overlay is open

const WHEEL_THRESHOLD = INPUT.wheelThreshold; // config.js (moved by integrator) // min |deltaY| to count as a wheel step (ignores trackpad jitter of 0)

const MOVE_UP = ['KeyW', 'ArrowUp'];
const MOVE_DOWN = ['KeyS', 'ArrowDown'];
const MOVE_LEFT = ['KeyA', 'ArrowLeft'];
const MOVE_RIGHT = ['KeyD', 'ArrowRight'];
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const RELOAD = ['KeyR'];
const INTERACT = ['KeyF', 'KeyE'];
const SWAP = ['KeyQ'];
const SLOT1 = ['Digit1', 'Numpad1'];
const SLOT2 = ['Digit2', 'Numpad2'];
const SLOT3 = ['Digit3', 'Numpad3'];
const MELEE = ['KeyV'];
const START = ['Enter', 'NumpadEnter', 'Space'];
const PAUSE = ['Escape', 'KeyP'];
const DEBUG = ['Backquote'];
const LEVEL_SELECT_KEY = (LEVEL_SELECT && LEVEL_SELECT.key) || 'KeyM';           // WO9 3.1
const LEVEL_SELECT_SHIFT = !LEVEL_SELECT || LEVEL_SELECT.requireShift !== false;

// Keys whose browser default (scrolling, focus moves) must be suppressed.
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

const held = new Set();          // currently held key codes
let mouseX = 0, mouseY = 0;      // canvas-space (backing-store pixels)
let mouseDown = false;           // left button held

// Edge flags (true for the frame(s) until endFrame()).
const edge = {
  firePressed: false, reload: false, interact: false, swap: false,
  restart: false, start: false, pause: false, debugKey: false,
  slot: 0, wheel: 0, melee: false, levelSelect: false,
};

let cleanup = null;

function anyHeld(codes) {
  for (const c of codes) if (held.has(c)) return true;
  return false;
}

function clearEdges() {
  edge.firePressed = false;
  edge.reload = false;
  edge.interact = false;
  edge.swap = false;
  edge.restart = false;
  edge.start = false;
  edge.pause = false;
  edge.debugKey = false;
  edge.slot = 0;
  edge.wheel = 0;
  edge.melee = false;
  edge.levelSelect = false;
}

function overlayOpen() {
  try { return !!(levelselect.isLevelSelectOpen && levelselect.isLevelSelectOpen()); } catch (_) { return false; }
}

function isLevelSelectKey(e) {
  if (e.code !== LEVEL_SELECT_KEY) return false;
  const shift = !!e.shiftKey || held.has('ShiftLeft') || held.has('ShiftRight');
  return LEVEL_SELECT_SHIFT ? shift : true;
}

/** Release all held keys/buttons and clear edges (used on blur, hidden tab, restart). */
export function resetInput() {
  held.clear();
  mouseDown = false;
  clearEdges();
}

function onKeyDown(e) {
  const code = e.code;
  if (PREVENT.has(code)) e.preventDefault();
  const first = !e.repeat && !held.has(code);
  if (overlayOpen()) {
    // WO9: only the level-select toggle gets through while the overlay is open.
    if (first && isLevelSelectKey(e)) edge.levelSelect = true;
    return;
  }
  held.add(code);
  if (!first) return;
  if (isLevelSelectKey(e)) { edge.levelSelect = true; return; } // Shift+M: no other edge
  if (RELOAD.includes(code)) edge.reload = true;
  if (INTERACT.includes(code)) edge.interact = true;
  if (SWAP.includes(code)) edge.swap = true;
  if (SLOT1.includes(code)) edge.slot = 1;
  if (SLOT2.includes(code)) edge.slot = 2;
  if (SLOT3.includes(code)) edge.slot = 3;
  if (MELEE.includes(code)) edge.melee = true;
  if (START.includes(code)) { edge.start = true; edge.restart = true; }
  if (PAUSE.includes(code)) edge.pause = true;
  if (DEBUG.includes(code)) edge.debugKey = true;
}

function onKeyUp(e) {
  if (PREVENT.has(e.code)) e.preventDefault();
  held.delete(e.code);
}

function makeMouseMove(canvas) {
  return (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? canvas.height / rect.height : 1;
    mouseX = (e.clientX - rect.left) * sx;
    mouseY = (e.clientY - rect.top) * sy;
  };
}

/**
 * Attach listeners. Safe to call more than once (previous listeners are removed first).
 * @param {HTMLCanvasElement} canvas
 */
export function initInput(canvas) {
  if (cleanup) cleanup();
  resetInput();

  const onMove = makeMouseMove(canvas);
  const onMouseDown = (e) => {
    onMove(e);
    if (e.button === 0) {
      if (!mouseDown) edge.firePressed = true;
      mouseDown = true;
      e.preventDefault();
    }
  };
  const onMouseUp = (e) => {
    if (e.button === 0) mouseDown = false;
  };
  const onContextMenu = (e) => e.preventDefault();
  const onWheel = (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
    edge.wheel = e.deltaY > 0 ? 1 : -1;
    edge.swap = true;
  };
  const onBlur = () => resetInput();
  const onVisibility = () => { if (document.hidden) resetInput(); };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMove);       // window: keep aiming when cursor leaves canvas
  window.addEventListener('mouseup', onMouseUp);      // window: release even if let go outside
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  cleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    cleanup = null;
  };
}

/** Snapshot of the current input. Returns a fresh object every call. */
export function getInput() {
  let mx = (anyHeld(MOVE_RIGHT) ? 1 : 0) - (anyHeld(MOVE_LEFT) ? 1 : 0);
  let my = (anyHeld(MOVE_DOWN) ? 1 : 0) - (anyHeld(MOVE_UP) ? 1 : 0);
  if (mx !== 0 && my !== 0) {
    const inv = 1 / Math.SQRT2;
    mx *= inv;
    my *= inv;
  }
  const out = {
    moveX: mx,
    moveY: my,
    mouseX,
    mouseY,
    // A click that starts and ends between two frames still fires once.
    fire: mouseDown || edge.firePressed,
    firePressed: edge.firePressed,
    reload: edge.reload,
    interact: edge.interact,
    interactHeld: anyHeld(INTERACT),
    swap: edge.swap,
    sprint: anyHeld(SPRINT),
    restart: edge.restart,
    start: edge.start,
    pause: edge.pause,
    debugKey: edge.debugKey,
    slot: edge.slot,
    wheel: edge.wheel,
    melee: edge.melee,
    levelSelect: edge.levelSelect,
    aimVector: null,
    autoFire: false,
  };
  if (overlayOpen()) return neutralise(out);
  if (touch.isTouchActive()) mergeTouch(out, touch.getTouchState());
  return out;
}

/** WO9: gameplay-neutral snapshot while the level-select overlay is open (keeps mouse + levelSelect). */
function neutralise(out) {
  out.moveX = 0; out.moveY = 0;
  out.fire = false; out.firePressed = false;
  out.reload = false; out.interact = false; out.interactHeld = false;
  out.swap = false; out.sprint = false;
  out.restart = false; out.start = false; out.pause = false; out.debugKey = false;
  out.slot = 0; out.wheel = 0; out.melee = false;
  out.aimVector = null; out.autoFire = false;
  return out;
}

/** WO6: fold the touch snapshot into an input snapshot (touch wins for movement when the stick is used). */
function mergeTouch(out, t) {
  if (t.moveX !== 0 || t.moveY !== 0) {
    out.moveX = t.moveX;
    out.moveY = t.moveY;
  }
  out.sprint = out.sprint || t.sprint;
  if (t.aimX !== 0 || t.aimY !== 0) out.aimVector = { x: t.aimX, y: t.aimY };
  out.fire = out.fire || t.fire || t.firePressed;
  out.firePressed = out.firePressed || t.firePressed;
  out.autoFire = t.fire;
  out.reload = out.reload || t.reload;
  out.swap = out.swap || t.swap;
  out.interact = out.interact || t.interact;
  out.interactHeld = out.interactHeld || t.interactHeld;
  out.pause = out.pause || t.pause;
  out.start = out.start || t.start;
  out.restart = out.restart || t.start;
  out.melee = out.melee || !!t.melee;
}

/** Clear edge-triggered flags. Call once at the end of each frame. */
export function endFrame() {
  clearEdges();
  touch.endTouchFrame();
}
