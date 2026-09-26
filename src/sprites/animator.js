// WO2 3.6 — player animation state (Agent D). Pure: no DOM, no randomness, deterministic.
// Drives the two-layer soldier sprite: leg walk cycle + leg direction, torso recoil, reload
// frames and the arm pose for the held gun. See docs/notes/animator.md for edge-case rules.
// WO4: the legs turn toward their target at a capped rate (no snapping), and moving more than
// ~100 deg away from the aim switches to a backpedal (legs face movement + 180 deg, the walk
// cycle runs backwards), with hysteresis so it does not flicker around 90 deg.
// WO7 (T3): knife swing. While player.meleeT > 0 (seconds left, set to MELEE.swingTime by
// weapons.meleeAttack) pose = 'knife', melee = swing progress 0..1 and meleeFrame = 0 (cocked) for
// the first MELEE.thrustAt of the swing, then 1 (thrust). gunPose always keeps the held gun's pose.
import * as CONFIG from '../config.js';
import { gunSpriteFor } from './guns.js';

const FRAMES = 8;
const IDLE_SNAP = 0.1;      // seconds without movement before the legs snap to frame 0
const TELEPORT_PX = 100;    // a single-update jump larger than this does not advance the cycle
const MOVE_EPS = 1e-6;
const POSES = { onehand: 1, twohand: 1, heavy: 1 };
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const FLIP_ARC = 170 * DEG; // a turn this large goes through the aim side, not the back
const MELEE_THRUST_AT_DEFAULT = 0.4; // fallback for CONFIG.MELEE.thrustAt (swing progress cocked -> thrust)
const SPRITES = CONFIG.SPRITES;

// Knife swing state from player.meleeT (seconds remaining) and MELEE.swingTime.
// Returns { active, melee (0..1 progress), meleeFrame (0 cocked | 1 thrust) }.
export function meleePose(player) {
  const M = CONFIG.MELEE || {};
  const swing = num(M.swingTime, 0.25) > 0 ? M.swingTime : 0.25;
  const t = player ? player.meleeT : 0;
  if (!(Number.isFinite(t) && t > 0)) return { active: false, melee: 0, meleeFrame: 0 };
  const melee = Math.min(1, Math.max(0, 1 - t / swing));
  const thrustAt = num(M.thrustAt, MELEE_THRUST_AT_DEFAULT);
  return { active: true, melee, meleeFrame: melee < thrustAt ? 0 : 1 };
}

function num(v, fallback) { return Number.isFinite(v) ? v : fallback; }

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

// Turn `cur` toward `target` by at most `maxStep` radians along the shortest arc. A near-180 deg
// turn (e.g. the backpedal flip) swings through the side the aim is on, so the hips turn under
// the torso instead of spinning through its back.
function turnToward(cur, target, maxStep, aim) {
  let delta = wrapAngle(target - cur);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  if (Math.abs(delta) >= FLIP_ARC) {
    const side = wrapAngle(aim - cur);
    if (side !== 0 && Math.sign(side) !== Math.sign(delta)) delta -= Math.sign(delta) * TAU;
  }
  return wrapAngle(cur + Math.sign(delta) * maxStep);
}

function cfg() {
  const S = SPRITES || {};
  return {
    stride: num(S.strideLength, 44) > 0 ? S.strideLength : 44,
    sprint: num(S.sprintCycleMult, 1.5),
    recoilPx: num(S.recoilPx, 3),
    recoilTime: num(S.recoilTime, 0.06) > 0 ? S.recoilTime : 0.06,
    reloadFrameTime: num(S.reloadFrameTime, 0.15) > 0 ? S.reloadFrameTime : 0.15,
    turnRate: (num(S.legTurnRate, 900) > 0 ? S.legTurnRate : 900) * DEG,          // rad/s
    bpEnter: num(S.backpedalEnter, 100) * DEG,
    bpExit: Math.min(num(S.backpedalExit, 80), num(S.backpedalEnter, 100)) * DEG,
  };
}

// Gun info with safe defaults: guns.js may be mid-rewrite or missing entries.
function gunInfo(weaponDef) {
  let g = null;
  try { g = gunSpriteFor(weaponDef); } catch (_) { g = null; }
  const pose = g && POSES[g.pose] ? g.pose : 'twohand';
  const weight = g && Number.isFinite(g.weight) && g.weight > 0 ? g.weight : 1;
  return { pose, weight };
}

export function createPlayerAnim() {
  return {
    walkDist: 0, legFrame: 0, legAngle: 0, moving: false,
    recoil: 0, recoilDir: 0, reloadFrame: 0, reloadT: 0,
    pose: 'twohand', lastX: 0, lastY: 0, initialized: false,
    // Extras beyond the 3.6 field list (read-only for consumers):
    aim: 0,          // last player.angle seen; default recoilDir for noteShot
    stillT: 0,       // seconds since the last observed movement
    recoilPeak: 0,   // recoil value at the last shot; sets the linear decay rate
    recoilFresh: false, // set by noteShot: the next update skips decay so the peak is drawn once
    legTarget: 0,    // WO4: angle the legs are turning toward (movement, movement + PI, or aim)
    backpedal: false, // WO4: moving away from the aim: legs face movement + PI, cycle reversed
    melee: 0,        // WO7: knife swing progress 0..1 (0 when not swinging)
    meleeFrame: 0,   // WO7: SOLDIER.torso.knife frame index (0 cocked, 1 thrust)
    gunPose: 'twohand', // WO7: the held gun's pose even while pose === 'knife'
  };
}

export function updatePlayerAnim(anim, player, weaponDef, weapon, dt) {
  if (!anim) return anim;
  const c = cfg();
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;

  if (player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
    const aim = num(player.angle, anim.aim);
    anim.aim = aim;

    if (!anim.initialized) {
      // First call: no history, so no movement and no giant jump from (0,0).
      anim.lastX = player.x; anim.lastY = player.y; anim.initialized = true;
      anim.walkDist = 0; anim.legFrame = 0; anim.moving = false;
      anim.stillT = IDLE_SNAP; anim.legAngle = wrapAngle(aim); anim.legTarget = anim.legAngle;
      anim.backpedal = false;
    } else {
      const dx = player.x - anim.lastX, dy = player.y - anim.lastY;
      const moved = Math.hypot(dx, dy);
      anim.lastX = player.x; anim.lastY = player.y;

      if (player.down) {
        // Frozen: keep the leg frame/angle, but track position so revive does not jump.
        anim.moving = false;
      } else if (moved > TELEPORT_PX) {
        // Teleport / respawn: do not advance the cycle or turn the legs.
      } else {
        if (moved > MOVE_EPS) {
          anim.stillT = 0;
          anim.moving = true;
          const move = Math.atan2(dy, dx);
          // Backpedal with hysteresis: enter past bpEnter from the aim, leave below bpExit.
          const off = Math.abs(wrapAngle(move - aim));
          if (!anim.backpedal && off > c.bpEnter) anim.backpedal = true;
          else if (anim.backpedal && off < c.bpExit) anim.backpedal = false;
          anim.legTarget = wrapAngle(anim.backpedal ? move + Math.PI : move);
          // Backpedalling, the body moves toward the legs' back, so the cycle runs backwards
          // (the planted boot then still moves back under the body at ground speed).
          const step = moved * (player.sprinting ? c.sprint : 1) * (anim.backpedal ? -1 : 1);
          anim.walkDist = (((anim.walkDist + step) % c.stride) + c.stride) % c.stride;
          anim.legFrame = Math.floor(anim.walkDist / (c.stride / FRAMES)) % FRAMES;
        } else if (d > 0) {
          // No movement this update. Hold the current frame briefly (render may run faster than
          // the sim), then return to the passing/stance frame and turn toward the aim.
          anim.stillT += d;
          if (anim.stillT >= IDLE_SNAP) {
            anim.moving = false;
            anim.walkDist = 0;
            anim.legFrame = 0;
            anim.backpedal = false;
          }
        }
        if (!anim.moving) anim.legTarget = wrapAngle(aim);
        // Smooth turn at a capped rate (dt 0 = no turning).
        anim.legAngle = turnToward(num(anim.legAngle, aim), anim.legTarget, c.turnRate * d, aim);
      }
    }
  }

  // Recoil: linear decay from the last shot's peak to 0 over recoilTime. The first update after
  // noteShot does not decay (FIX-2, review #3): noteShot runs in the sim update and the same
  // frame's render calls this with that frame's dt, so the peak would otherwise never be drawn.
  if (anim.recoilFresh) {
    anim.recoilFresh = false;
  } else if (anim.recoil > 0 && d > 0) {
    const peak = anim.recoilPeak > 0 ? anim.recoilPeak : anim.recoil;
    anim.recoil = Math.max(0, anim.recoil - (peak / c.recoilTime) * d);
  }
  if (!(anim.recoil > 0)) anim.recoil = 0;

  // Reload: alternate frames 0/1 every reloadFrameTime while reloading.
  if (weapon && weapon.reloading) {
    anim.reloadT += d;
    anim.reloadFrame = Math.floor(anim.reloadT / c.reloadFrameTime) % 2;
  } else {
    anim.reloadT = 0;
    anim.reloadFrame = 0;
  }

  anim.gunPose = gunInfo(weaponDef).pose;
  const mp = meleePose(player);
  anim.melee = mp.melee;
  anim.meleeFrame = mp.meleeFrame;
  anim.pose = mp.active ? 'knife' : anim.gunPose;
  return anim;
}

// recoil = SPRITES.recoilPx * gun weight; recoilDir = aimAngle if given, else the last aim seen
// by updatePlayerAnim (player.angle).
export function noteShot(anim, weaponDef, aimAngle) {
  if (!anim) return anim;
  const c = cfg();
  anim.recoil = c.recoilPx * gunInfo(weaponDef).weight;
  anim.recoilPeak = anim.recoil;
  anim.recoilFresh = true;
  anim.recoilDir = Number.isFinite(aimAngle) ? aimAngle : num(anim.aim, anim.recoilDir);
  return anim;
}

export function resetPlayerAnim(anim) {
  if (!anim) return createPlayerAnim();
  Object.assign(anim, createPlayerAnim());
  return anim;
}
