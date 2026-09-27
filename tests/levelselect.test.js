// tests/levelselect.test.js (WO9 Agent G) - Node-safe parts of the level-select overlay + input edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ls from '../src/levelselect.js';
import * as input from '../src/input.js';
import * as touch from '../src/touch.js';
import { LEVELS } from '../src/levels/levels.js';

test('levelselect imports in node and exposes the 3.4 API', () => {
  for (const f of ['initLevelSelect', 'openLevelSelect', 'closeLevelSelect', 'isLevelSelectOpen', 'levelThumbnail']) {
    assert.equal(typeof ls[f], 'function', f);
  }
  assert.equal(ls.isLevelSelectOpen(), false);
  // No DOM: every DOM entry point is a harmless no-op.
  assert.doesNotThrow(() => ls.initLevelSelect(null, { levels: LEVELS }));
  assert.doesNotThrow(() => ls.openLevelSelect({ level: { index: 2 } }));
  assert.equal(ls.isLevelSelectOpen(), false);
  assert.doesNotThrow(() => ls.closeLevelSelect());
  assert.equal(ls.levelThumbnail(LEVELS[0], 3), null);
});

test('difficultyLine / cardInfo', () => {
  assert.equal(ls.difficultyLine(LEVELS[3]), 'HP x2.4 · SPD x1.22');
  assert.equal(ls.difficultyLine(LEVELS[0]), 'HP x1 · SPD x1');
  assert.equal(ls.difficultyLine({}), 'HP x1 · SPD x1');
  const c = ls.cardInfo(LEVELS[4], 4);
  assert.equal(c.label, 'L5');
  assert.equal(c.name, LEVELS[4].name);
  assert.equal(c.boss, LEVELS[4].boss.name);
});

test('currentIndexOf wraps loop levels onto the authored list', () => {
  const n = LEVELS.length;
  assert.equal(ls.currentIndexOf({ level: { index: 0 } }, n), 0);
  assert.equal(ls.currentIndexOf({ level: { index: n + 1 } }, n), 1);
  assert.equal(ls.currentIndexOf(3, n), 3);
  assert.equal(ls.currentIndexOf({}, n), -1);
  assert.equal(ls.currentIndexOf(null, n), -1);
});

test('thumbnailColors: one hex colour per tile, themed', () => {
  for (const def of LEVELS) {
    const g = ls.thumbnailColors(def);
    assert.equal(g.length, def.ascii.length, def.id);
    g.forEach((row, y) => {
      assert.equal(row.length, def.ascii[y].length);
      for (const c of row) assert.match(c, /^#[0-9a-f]{6}$/);
    });
  }
  const def = { id: 't', ascii: ['#####', '#.PW#', '#D~A#', '#####'], wallbuys: { 1: 'sheiva' },
    theme: { floor: '#102030', floorAlt: '#102030', wall: '#000000', pit: '#0000ff' }, boss: { tint: '#ff0000' } };
  const g = ls.thumbnailColors(def);
  assert.equal(g[1][1], '#102030');           // floor from the theme
  assert.equal(g[2][2], '#0000ff');           // pit from theme.pit
  assert.notEqual(g[1][3], g[1][1]);          // window differs from floor
  assert.notEqual(g[2][1], g[1][1]);          // door differs from floor
  assert.notEqual(g[2][3], g[2][1]);          // PaP differs from door
  assert.equal(ls.mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('input: levelSelect edge is a boolean, false by default and after endFrame()', () => {
  assert.equal(input.getInput().levelSelect, false);
  input.endFrame();
  assert.equal(input.getInput().levelSelect, false);
});

test('touch: onLevelsButton / triggerLevelsButton', () => {
  let hits = 0;
  const off = touch.onLevelsButton(() => { hits++; });
  touch.triggerLevelsButton();
  assert.equal(hits, 1);
  off();
  touch.triggerLevelsButton();
  assert.equal(hits, 1);
  assert.equal(typeof touch.onLevelsButton(null), 'function');
});
