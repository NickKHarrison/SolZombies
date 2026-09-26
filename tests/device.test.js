import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMobile, isMobile, isPortrait, requestImmersive, _resetForTests } from '../src/device.js';

// Fake browser environment. coarse: matchMedia('(pointer: coarse)') result.
function env({ search = '', coarse = false, touchPoints = 0, sw = 1920, sh = 1080, iw = 1280, ih = 720, matchMedia = true } = {}) {
  const window = {
    innerWidth: iw, innerHeight: ih,
    matchMedia: matchMedia ? (q) => ({ matches: q === '(pointer: coarse)' && coarse }) : undefined,
  };
  return { window, navigator: { maxTouchPoints: touchPoints }, location: { search }, screen: { width: sw, height: sh } };
}

test('Node without window: not mobile, not portrait, requestImmersive does not throw', () => {
  _resetForTests();
  assert.equal(isMobile(), false);
  assert.equal(isPortrait(), false);
  assert.doesNotThrow(() => requestImmersive());
});

test('desktop: fine pointer, no touch points', () => {
  assert.equal(detectMobile(env()), false);
});

test('coarse pointer is mobile', () => {
  assert.equal(detectMobile(env({ coarse: true })), true);
});

test('touch points + short screen side under 900 is mobile', () => {
  assert.equal(detectMobile(env({ touchPoints: 5, sw: 390, sh: 844 })), true);
  assert.equal(detectMobile(env({ touchPoints: 5, sw: 1024, sh: 768 })), true);
});

test('touch laptop with a big screen is not mobile', () => {
  assert.equal(detectMobile(env({ touchPoints: 10, sw: 1920, sh: 1080 })), false);
});

test('falls back to inner size when screen size is missing', () => {
  const e = env({ touchPoints: 5, iw: 800, ih: 400 });
  e.screen = {};
  assert.equal(detectMobile(e), true);
});

test('?touch=1 forces mobile, ?touch=0 forces desktop', () => {
  assert.equal(detectMobile(env({ search: '?touch=1' })), true);
  assert.equal(detectMobile(env({ search: '?debug=1&touch=1' })), true);
  assert.equal(detectMobile(env({ search: '?touch=0', coarse: true, touchPoints: 5, sw: 390, sh: 844 })), false);
  assert.equal(detectMobile(env({ search: '?touch=10' })), false);
});

test('missing matchMedia does not throw', () => {
  assert.equal(detectMobile(env({ matchMedia: false })), false);
  assert.equal(detectMobile(env({ matchMedia: false, touchPoints: 2, sw: 360, sh: 740 })), true);
});

test('isMobile memoizes the first result', () => {
  _resetForTests();
  assert.equal(isMobile(env({ search: '?touch=1' })), true); // env refreshes the cache
  assert.equal(isMobile(), true);                              // memoized, no window needed
  _resetForTests();
  assert.equal(isMobile(), false);
});

test('isPortrait compares inner height and width', () => {
  assert.equal(isPortrait(env({ iw: 390, ih: 844 })), true);
  assert.equal(isPortrait(env({ iw: 844, ih: 390 })), false);
  assert.equal(isPortrait(env({ iw: 500, ih: 500 })), false);
});

test('requestImmersive requests fullscreen then locks landscape, swallowing rejections', async () => {
  const calls = [];
  const e = env();
  e.document = {
    fullscreenElement: null,
    documentElement: { requestFullscreen() { calls.push('fs'); return Promise.resolve(); } },
  };
  e.screen.orientation = { lock(o) { calls.push('lock:' + o); return Promise.reject(new Error('not supported')); } };
  assert.doesNotThrow(() => requestImmersive(e));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['fs', 'lock:landscape']);
});

test('requestImmersive never throws on hostile APIs', async () => {
  const e = env();
  e.document = { documentElement: { requestFullscreen() { throw new Error('boom'); } } };
  e.screen.orientation = { lock() { throw new Error('boom'); } };
  assert.doesNotThrow(() => requestImmersive(e));
  const e2 = env();
  e2.document = { documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } };
  assert.doesNotThrow(() => requestImmersive(e2));
  await new Promise((r) => setTimeout(r, 0));
});
