import test from 'node:test';
import assert from 'node:assert/strict';
import quickdraw from '../js/games/quickdraw.js';
import { mulberry32 } from '../js/games/common.js';

const STEP = 1 / 60;
function setup(n) {
  const players = Array.from({ length: n }, (_, i) => ({ pid: n === 2 ? 'ab'[i] : 'p' + i, name: 'P' + i, color: '#000' }));
  const sent = [];
  const host = quickdraw.createHost({ players, rng: mulberry32(1), emit: (ev, to) => sent.push({ ev, to }) });
  const run = secs => { for (let i = 0; i < Math.round(secs * 60); i++) host.step(STEP); };
  const lastArm = () => sent.filter(s => s.ev.type === 'arm').at(-1)?.ev;
  // Steps until the next arm event shows up (intro / reveal pauses), max 10 s.
  const nextArm = () => { const k = sent.filter(s => s.ev.type === 'arm').length; for (let i = 0; i < 600 && sent.filter(s => s.ev.type === 'arm').length === k; i++) host.step(STEP); return lastArm(); };
  return { players, host, sent, run, nextArm };
}

test('two players, a always faster, a wins', () => {
  const { host, nextArm } = setup(2);
  for (let r = 1; r <= 5; r++) {
    const arm = nextArm();
    assert.equal(arm.round, r);
    host.event('a', { type: 'shot', round: r, ms: 200 });
    host.event('b', { type: 'shot', round: r, ms: 300 });
  }
  for (let i = 0; i < 600 && !host.result(); i++) host.step(STEP);
  assert.deepEqual(host.result(), [['a'], ['b']]);
});

test('arm delay is between 1.5 and 4.5 seconds', () => {
  const { nextArm } = setup(2);
  const d = nextArm().delay;
  assert.ok(d >= 1.5 && d <= 4.5, String(d));
});

test('a foul earns zero that round', () => {
  const { host, nextArm, sent } = setup(2);
  nextArm();
  host.event('a', { type: 'foul', round: 1 });
  host.event('b', { type: 'shot', round: 1, ms: 400 });
  const reveal = sent.find(s => s.ev.type === 'reveal').ev;
  assert.equal(reveal.times.a, 'foul');
  assert.equal(host.snapshot().totals.a, 0);
  assert.ok(host.snapshot().totals.b > 0);
});

test('equal times get equal points', () => {
  const { host, nextArm } = setup(3);
  nextArm();
  host.event('p0', { type: 'shot', round: 1, ms: 250 });
  host.event('p1', { type: 'shot', round: 1, ms: 250 });
  host.event('p2', { type: 'shot', round: 1, ms: 300 });
  const t = host.snapshot().totals;
  assert.equal(t.p0, t.p1);
  assert.ok(t.p0 > t.p2);
});

test('a player who never answers does not stall the round', () => {
  const { host, nextArm, sent } = setup(2);
  const arm = nextArm();
  host.event('a', { type: 'shot', round: 1, ms: 200 });
  assert.equal(sent.some(s => s.ev.type === 'reveal'), false);
  for (let i = 0; i < Math.ceil((arm.delay + 3) * 60) + 2; i++) host.step(STEP);
  const reveal = sent.find(s => s.ev.type === 'reveal').ev;
  assert.equal(reveal.times.b, null);
  for (let i = 0; i < 60 * 60 && !host.result(); i++) host.step(STEP);
  assert.ok(host.result());
});

test('a disconnected player is not waited for', () => {
  const { host, nextArm, sent } = setup(2);
  nextArm();
  host.setConnected('b', false);
  host.event('a', { type: 'shot', round: 1, ms: 200 });
  host.step(STEP);
  assert.equal(sent.some(s => s.ev.type === 'reveal'), true);
});

test('ten players finish with every pid placed exactly once', () => {
  const { host, players, nextArm } = setup(10);
  for (let r = 1; r <= 5; r++) {
    nextArm();
    players.forEach((p, i) => host.event(p.pid, { type: 'shot', round: r, ms: 150 + ((i * 37 + r * 11) % 200) }));
  }
  for (let i = 0; i < 600 && !host.result(); i++) host.step(STEP);
  const flat = host.result().flat();
  assert.equal(flat.length, 10);
  assert.equal(new Set(flat).size, 10);
});

test('late or wrong-round answers are ignored', () => {
  const { host, nextArm } = setup(2);
  nextArm();
  host.event('a', { type: 'shot', round: 2, ms: 100 });
  host.event('a', { type: 'shot', round: 1, ms: 200 });
  host.event('a', { type: 'shot', round: 1, ms: 50 });
  host.event('b', { type: 'shot', round: 1, ms: 300 });
  const t = host.snapshot().totals;
  assert.equal(t.a, 2); assert.equal(t.b, 1);
});
