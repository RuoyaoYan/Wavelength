import test from 'node:test';
import assert from 'node:assert/strict';
import fallguys, { raceQualifiers, COURSE, COUNTDOWN, RACE_LIMIT, HEX_LIMIT, isVoid } from '../js/games/fallguys.js';
import { mulberry32 } from '../js/games/common.js';

const STEP = 1 / 60;
function setup(n) {
  const players = Array.from({ length: n }, (_, i) => ({ pid: n === 2 ? 'ab'[i] : 'p' + i, name: 'P' + i, color: '#000' }));
  const host = fallguys.createHost({ players, rng: mulberry32(9), emit: () => {} });
  const run = secs => { for (let i = 0; i < Math.round(secs * 60); i++) host.step(STEP); };
  const until = (cond, secs = 300) => { for (let i = 0; i < secs * 60 && !cond(); i++) host.step(STEP); };
  return { players, host, run, until, S: host._state() };
}
const bean = (S, pid) => S.beans.find(b => b.pid === pid);
const finish = b => { b.x = 300; b.y = COURSE.finishY - 30; b.vx = 0; b.vy = 0; };

test('race qualifiers by player count', () => {
  assert.deepEqual([2, 3, 4, 6, 10].map(raceQualifiers), [2, 3, 3, 4, 7]);
});

test('a bean in a gap respawns at its last checkpoint without losing progress', () => {
  const { run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  const b = bean(S, 'a');
  const cp = COURSE.checkpoints[1];
  b.x = 300; b.y = cp - 20; run(0.05);
  const best = b.best;
  const gap = COURSE.voids.find(v => v.y + v.h < cp);
  b.x = gap.x + gap.w / 2; b.y = gap.y + gap.h / 2; b.vx = b.vy = 0;
  assert.ok(isVoid(b.x, b.y));
  run(0.05);
  assert.equal(b.falling > 0, true);
  run(1.2);
  assert.equal(b.falling, 0);
  assert.ok(Math.abs(b.y - cp) < 40, `respawned at y=${b.y}, checkpoint ${cp}`);
  assert.ok(b.best >= best);
});

test('two players finish, go to Hex-A-Gone, b drops through both layers, a wins', () => {
  const { host, run, until, S } = setup(2);
  run(COUNTDOWN + 0.05);
  finish(bean(S, 'a')); finish(bean(S, 'b'));
  until(() => S.phase === 'hex');
  assert.equal(S.phase, 'hex');
  const b = bean(S, 'b');
  b.x = 5000; b.y = 5000;
  until(() => host.result() !== null, 30);
  assert.deepEqual(host.result(), [['a'], ['b']]);
});

test('ten idle players: race times out, hex ends, everyone placed once, 3 non-qualifiers last', () => {
  const { host, players, until, S } = setup(10);
  until(() => S.phase === 'race-over', COUNTDOWN + RACE_LIMIT + 5);
  assert.equal(S.phase, 'race-over');
  until(() => host.result() !== null, 10 + COUNTDOWN + HEX_LIMIT + 10);
  const res = host.result();
  assert.ok(res);
  const flat = res.flat();
  assert.equal(flat.length, 10);
  assert.deepEqual(new Set(flat), new Set(players.map(p => p.pid)));
  const out = S.beans.filter(b => !b.qualified).map(b => b.pid);
  assert.equal(out.length, 3);
  const tail = res.slice(-1).flat();
  assert.deepEqual(new Set(tail), new Set(out));
});

test('a disconnected leader does not block the race ending', () => {
  const { host, run, until, S } = setup(4);
  run(COUNTDOWN + 0.05);
  host.setConnected('p0', false);
  bean(S, 'p0').y = COURSE.finishY + 200;
  for (const pid of ['p1', 'p2', 'p3']) finish(bean(S, pid));
  run(0.1);
  assert.equal(S.phase, 'race-over');
  assert.equal(bean(S, 'p0').qualified, false);
});

test('beans steer with the stick and dive once per cooldown', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  const a = bean(S, 'a'); const y0 = a.y;
  host.input('a', { x: 0, y: -1, b: {} });
  run(0.5);
  assert.ok(a.y < y0 - 40, 'moved up the course');
  a.vx = a.vy = 0;
  host.input('a', { x: 0, y: -1, b: { Dive: 1 } }); host.step(STEP);
  const v1 = Math.hypot(a.vx, a.vy);
  a.vx = a.vy = 0;
  host.input('a', { x: 0, y: -1, b: { Dive: 2 } }); host.step(STEP);
  const v2 = Math.hypot(a.vx, a.vy);
  assert.ok(v1 > 250 && v2 < 120, `${v1} ${v2}`);
});

test('after a rejoin the dive counter restarts and the next press still dives', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  const a = bean(S, 'a');
  host.input('a', { x: 0, y: -1, b: { Dive: 5 } }); host.step(STEP);
  run(1.2);
  host.setConnected('a', false); host.setConnected('a', true);
  a.vx = a.vy = 0;
  host.input('a', { x: 0, y: -1, b: { Dive: 1 } }); host.step(STEP);
  assert.ok(Math.hypot(a.vx, a.vy) > 250, 'dive after rejoin');
});
