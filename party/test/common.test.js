import test from 'node:test';
import assert from 'node:assert/strict';
import { pressed, lerpSnap, circleCollide, mulberry32, clamp } from '../js/games/common.js';

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});
test('pressed is true only when the counter went up', () => {
  assert.equal(pressed({ b: { Dash: 1 } }, { b: { Dash: 2 } }, 'Dash'), true);
  assert.equal(pressed({ b: { Dash: 2 } }, { b: { Dash: 2 } }, 'Dash'), false);
  assert.equal(pressed(undefined, { b: { Dash: 1 } }, 'Dash'), true);
  assert.equal(pressed({ b: {} }, { x: 0, y: 0, b: {} }, 'Dash'), false);
});
test('lerpSnap interpolates numbers and takes everything else from b', () => {
  const a = { t: 0, p: [{ x: 0, name: 'a' }], s: 'old' };
  const b = { t: 10, p: [{ x: 4, name: 'b' }], s: 'new' };
  assert.deepEqual(lerpSnap(a, b, 0.5), { t: 5, p: [{ x: 2, name: 'b' }], s: 'new' });
  assert.deepEqual(lerpSnap(null, b, 0.5), b);
});
test('circleCollide separates overlapping circles and pushes them apart', () => {
  const p = { x: 0, y: 0, vx: 1, vy: 0, r: 10 }, q = { x: 15, y: 0, vx: -1, vy: 0, r: 10 };
  assert.equal(circleCollide(p, q, 0.8), true);
  assert.ok(q.x - p.x >= 20 - 1e-9);
  assert.ok(p.vx < 0 && q.vx > 0);
  const far = { x: 100, y: 0, vx: 0, vy: 0, r: 10 };
  assert.equal(circleCollide(p, far, 0.8), false);
});
test('clamp', () => { assert.equal(clamp(5, 0, 3), 3); assert.equal(clamp(-1, 0, 3), 0); });
