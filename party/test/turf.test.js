import test from 'node:test';
import assert from 'node:assert/strict';
const SPLAT_WAIT = 4.1;
import turf, { makeTeams, brushRadius, GRID_W, GRID_H, COUNTDOWN, MATCH, OVER } from '../js/games/turf.js';
import { mulberry32 } from '../js/games/common.js';

const STEP = 1 / 60;
const ids = n => Array.from({ length: n }, (_, i) => 'p' + i);
function setup(n) {
  const players = ids(n).map((pid, i) => ({ pid, name: 'P' + i, color: '#000' }));
  const host = turf.createHost({ players, rng: mulberry32(5), emit: () => {} });
  const run = secs => { for (let i = 0; i < Math.round(secs * 60); i++) host.step(STEP); };
  return { players, host, run, S: host._state() };
}

test('grid is 64 by 40', () => { assert.equal(GRID_W, 64); assert.equal(GRID_H, 40); });

test('teams: free-for-all up to 3, then two teams', () => {
  const sizes = n => makeTeams(ids(n), mulberry32(1)).map(t => t.length).sort((a, b) => a - b);
  assert.deepEqual(sizes(2), [1, 1]);
  assert.deepEqual(sizes(3), [1, 1, 1]);
  assert.deepEqual(sizes(4), [2, 2]);
  assert.deepEqual(sizes(5), [2, 3]);
  assert.deepEqual(sizes(9), [4, 5]);
  assert.deepEqual(sizes(10), [5, 5]);
  const t = makeTeams(ids(7), mulberry32(2));
  assert.deepEqual(t.flat().sort(), ids(7).sort());
});

test('the smaller team paints a wider trail', () => {
  const teams = [['a', 'b'], ['c', 'd', 'e']];
  assert.equal(brushRadius(teams, 0), 2.2);
  assert.equal(brushRadius(teams, 1), 1.6);
  assert.equal(brushRadius([['a', 'b'], ['c', 'd']], 0), 1.6);
});

test('moving right for a second paints cells in your team', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  const before = S.grid.filter(v => v === S.teamOf.p0 + 1).length;
  host.input('p0', { x: 1, y: 0, b: {} });
  run(1);
  const after = S.grid.filter(v => v === S.teamOf.p0 + 1).length;
  assert.ok(after > before, `${before} -> ${after}`);
});

test('splat paints a big blob once per cooldown', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  const count = () => S.grid.filter(v => v === S.teamOf.p1 + 1).length;
  const c0 = count();
  host.input('p1', { x: 0, y: 0, b: { Splat: 1 } }); host.step(STEP);
  const c1 = count();
  assert.ok(c1 - c0 > 30, `splat painted ${c1 - c0}`);
  const p = S.ps.find(q => q.pid === 'p1'); p.x += 120;
  host.input('p1', { x: 0, y: 0, b: { Splat: 2 } }); host.step(STEP);
  assert.ok(count() - c1 < 30, 'second splat is on cooldown');
});

test('match ends after 90 s and the bigger team wins together', () => {
  const { host, run, S } = setup(4);
  run(COUNTDOWN + 0.05);
  const [t0, t1] = S.teams;
  for (const pid of t0) host.input(pid, { x: 1, y: 0.3, b: {} });
  run(MATCH + OVER);
  const res = host.result();
  assert.ok(res);
  assert.deepEqual(res[0].slice().sort(), t0.slice().sort());
  assert.deepEqual(res[1].slice().sort(), t1.slice().sort());
});

test('snapshots carry only changed cells, plus a full grid every 2 s', () => {
  const { host, run } = setup(2);
  run(COUNTDOWN + 0.05);
  host.snapshot();
  host.input('p0', { x: 1, y: 0, b: {} });
  run(0.05);
  const s1 = host.snapshot();
  assert.ok(Array.isArray(s1.d) && s1.d.length > 0 && s1.d.length < 60, `delta ${s1.d?.length}`);
  run(0.05);
  host.input('p0', { x: 0, y: 0, b: {} });
  run(0.05); host.snapshot();
  run(0.05);
  assert.equal(host.snapshot().d.length, 0);
  let sawFull = false;
  for (let i = 0; i < 50 && !sawFull; i++) { run(0.05); sawFull = typeof host.snapshot().full === 'string'; }
  assert.ok(sawFull, 'full grid within 2.5 s');
});

test('ten players finish with every pid placed once', () => {
  const { host, run } = setup(10);
  run(COUNTDOWN + MATCH + OVER + 0.1);
  const flat = host.result().flat();
  assert.equal(flat.length, 10); assert.equal(new Set(flat).size, 10);
});

test('after a rejoin the splat counter restarts and the next press still splats', () => {
  const { host, run, S } = setup(2);
  run(COUNTDOWN + 0.05);
  host.input('p0', { x: 0, y: 0, b: { Splat: 5 } }); host.step(STEP);
  run(SPLAT_WAIT);
  host.setConnected('p0', false); host.setConnected('p0', true);
  const p = S.ps.find(q => q.pid === 'p0'); p.x += 150;
  const count = () => S.grid.filter(v => v === S.teamOf.p0 + 1).length;
  const c0 = count();
  host.input('p0', { x: 0, y: 0, b: { Splat: 1 } }); host.step(STEP);
  assert.ok(count() - c0 > 30, 'splat after rejoin');
});
