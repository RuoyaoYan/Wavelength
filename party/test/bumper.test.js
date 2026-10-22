import test from 'node:test';
import assert from 'node:assert/strict';
import bumper, { COUNTDOWN, SHRINK_TIME, platformRadius, startRadius } from '../js/games/bumper.js';
import { mulberry32 } from '../js/games/common.js';

const STEP = 1 / 60;
function setup(n) {
  const players = Array.from({ length: n }, (_, i) => ({ pid: n === 2 ? 'ab'[i] : 'p' + i, name: 'P' + i, color: '#000' }));
  const host = bumper.createHost({ players, rng: mulberry32(3), emit: () => {} });
  const run = secs => { for (let i = 0; i < Math.round(secs * 60); i++) host.step(STEP); };
  return { players, host, run, S: host._state() };
}

test('start radius grows with player count', () => {
  assert.equal(startRadius(2), 184);
  assert.equal(startRadius(10), 360);
});

test('platform shrinks to 35% after the shrink time', () => {
  const R0 = startRadius(4);
  assert.ok(Math.abs(platformRadius(R0, SHRINK_TIME) - 0.35 * R0) < 1);
  assert.equal(platformRadius(R0, 0), R0);
});

test('host radius follows the shrink after the countdown', () => {
  const { run, S } = setup(2);
  run(COUNTDOWN);
  S.balls[0].x = -20; S.balls[0].y = 0; S.balls[1].x = 20; S.balls[1].y = 0;
  run(SHRINK_TIME);
  assert.equal(S.phase, 'play');
  assert.ok(Math.abs(S.R - 0.35 * S.R0) < 1.5, `${S.R} vs ${0.35 * S.R0}`);
});

test('a ball outside the platform is out after one step', () => {
  const { host, run, S } = setup(3);
  run(COUNTDOWN + 0.1);
  const b = S.balls[1];
  b.x = S.R + 30; b.y = 0;
  host.step(STEP);
  assert.equal(b.alive, false);
});

test('two players, b knocked off twice: a wins after round 2', () => {
  const { host, run, S } = setup(2);
  for (let r = 1; r <= 2; r++) {
    for (let i = 0; i < 60 * 10 && S.phase !== 'play'; i++) host.step(STEP);
    assert.equal(S.round, r);
    const b = S.balls.find(x => x.pid === 'b');
    b.x = S.R + 50; b.y = 0;
    host.step(STEP);
    run(0.1);
  }
  for (let i = 0; i < 60 * 10 && !host.result(); i++) host.step(STEP);
  assert.deepEqual(host.result(), [['a'], ['b']]);
  assert.equal(S.round, 2);
  assert.equal(S.wins.a, 2);
});

test('ten idle players still finish with every pid placed once', () => {
  const { host, players } = setup(10);
  for (let i = 0; i < 60 * 240 && !host.result(); i++) host.step(STEP);
  const res = host.result();
  assert.ok(res, 'game should end within 4 minutes');
  const flat = res.flat();
  assert.equal(flat.length, 10);
  assert.deepEqual(new Set(flat), new Set(players.map(p => p.pid)));
});

test('dash pressed twice within the cooldown gives one impulse', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.1);
  const a = S.balls.find(x => x.pid === 'a');
  a.vx = 0; a.vy = 0;
  host.input('a', { x: 1, y: 0, b: { Dash: 1 } });
  host.step(STEP);
  const after1 = Math.hypot(a.vx, a.vy);
  a.vx = 0; a.vy = 0;
  host.input('a', { x: 1, y: 0, b: { Dash: 2 } });
  host.step(STEP);
  const after2 = Math.hypot(a.vx, a.vy);
  assert.ok(after1 > 300, `first dash ${after1}`);
  assert.ok(after2 < 100, `second dash should be on cooldown, got ${after2}`);
});

test('a disconnected ball stops steering', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.1);
  host.input('a', { x: 1, y: 0, b: {} });
  host.setConnected('a', false);
  const a = S.balls.find(x => x.pid === 'a');
  a.vx = 0; a.vy = 0;
  run(0.5);
  assert.ok(Math.hypot(a.vx, a.vy) < 1);
});
