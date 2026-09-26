// WO6 (Agent A): touch auto-fire cycles semi-auto guns at their rpm; input/touch are node-safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.js';
import { createEmptyState } from '../src/state.js';
import * as weapons from '../src/weapons.js';
import { createPlayer, updatePlayer, giveWeapon } from '../src/player.js';
import { getInput, endFrame } from '../src/input.js';
import { getTouchState, isTouchActive, endTouchFrame } from '../src/touch.js';

const weaponsStub = String(weapons.tryFire).includes('not implemented');

function makeState() {
  events.clearAll();
  const s = createEmptyState(1);
  s.player = createPlayer(100, 100);
  s.phase = 'playing';
  return s;
}

const base = { moveX: 0, moveY: 0, fire: true, reload: false, swap: false, sprint: false };

function shotsOver(autoFire, seconds, dt = 1 / 60) {
  const s = makeState();
  const w = giveWeapon(s, 'mr6'); // semi-auto pistol, 320 rpm
  w.mag = 1000; w.reserve = 0;
  let shots = 0;
  events.on('weapon:fired', () => shots++);
  for (let t = 0; t < seconds; t += dt) updatePlayer(s, { ...base, autoFire }, { x: 200, y: 100 }, dt);
  return { shots, w };
}

test('held fire without autoFire shoots a semi-auto once', { skip: weaponsStub }, () => {
  const { shots } = shotsOver(false, 1);
  assert.equal(shots, 1);
});

test('autoFire cycles a semi-auto at roughly its rpm', { skip: weaponsStub }, () => {
  const { shots, w } = shotsOver(true, 3);
  const expected = (weapons.WEAPONS.mr6.rpm / 60) * 3;
  assert.ok(shots >= expected * 0.85 && shots <= expected * 1.1, `shots=${shots} expected~${expected}`);
  assert.equal(w.triggerHeld, false);
});

test('autoFire on an empty mag keeps the trigger held (no weapon:empty spam)', { skip: weaponsStub }, () => {
  const s = makeState();
  const w = giveWeapon(s, 'mr6');
  w.mag = 0; w.reserve = 0;
  let empties = 0;
  events.on('weapon:empty', () => empties++);
  for (let i = 0; i < 30; i++) updatePlayer(s, { ...base, autoFire: true }, null, 1 / 60);
  assert.equal(empties, 1);
});

test('input/touch are node-safe; desktop snapshot has aimVector null and autoFire false', () => {
  assert.equal(isTouchActive(), false);
  const t = getTouchState();
  assert.equal(t.active, false);
  assert.equal(t.moveX, 0); assert.equal(t.fire, false);
  endTouchFrame();
  const inp = getInput();
  assert.equal(inp.aimVector, null);
  assert.equal(inp.autoFire, false);
  endFrame();
});
