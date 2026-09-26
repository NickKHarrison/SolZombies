// WO7 (Agent K): knife melee edge + slot 3 in the input snapshot; node-safe (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getInput, endFrame } from '../src/input.js';
import { getTouchState, isTouchActive } from '../src/touch.js';

test('getInput() has melee false by default (desktop, no listeners)', () => {
  const i = getInput();
  assert.equal(i.melee, false);
  assert.equal(i.slot, 0);
  endFrame();
  assert.equal(getInput().melee, false);
});

test('getTouchState() exposes melee false while touch is inactive', () => {
  assert.equal(isTouchActive(), false);
  assert.equal(getTouchState().melee, false);
});
