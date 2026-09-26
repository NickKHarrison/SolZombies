import test from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';
import * as events from '../src/events.js';
import { createRng, norm, rayCircle, rayRect } from '../src/math.js';
import { createEmptyState } from '../src/state.js';

test('rng is deterministic', () => {
  assert.equal(createRng(1).next(), createRng(1).next());
  assert.notEqual(createRng(1).next(), createRng(2).next());
});

test('rng helpers stay in range', () => {
  const r = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(1, 3);
    assert.ok(v >= 1 && v <= 3);
  }
  assert.ok(['a', 'b'].includes(r.weighted({ a: 1, b: 1, c: 0 })));
});

test('norm handles zero vector', () => {
  assert.deepEqual(norm(0, 0), { x: 0, y: 0 });
});

test('ray helpers', () => {
  assert.equal(rayCircle(0, 0, 1, 0, 10, 0, 2), 8);
  assert.equal(rayCircle(0, 0, -1, 0, 10, 0, 2), Infinity);
  assert.equal(rayRect(0, 5, 1, 0, 10, 0, 10, 10), 10);
});

test('events on/off/emit/clearAll', () => {
  let n = 0;
  const unsub = events.on('x', () => n++);
  events.emit('x');
  unsub();
  events.emit('x');
  assert.equal(n, 1);
  events.on('y', () => n++);
  events.clearAll();
  events.emit('y');
  assert.equal(n, 1);
});

test('state shape', () => {
  const s = createEmptyState(1);
  assert.equal(s.phase, 'menu');
  assert.ok(Array.isArray(s.zombies));
  assert.equal(config.POINTS.perKill, 10);
});
