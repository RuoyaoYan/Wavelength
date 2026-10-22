import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemNet } from './memtransport.js';
import { HostSession, ClientSession } from '../js/session.js';

const flush = () => new Promise(r => setTimeout(r, 0));
const STEP = 1 / 60;

function stubGame() {
  const g = { last: {}, done: false, t: 0, conn: {} };
  g.mod = {
    id: 'stub', name: 'Stub',
    createHost: () => ({
      input(p, s) { g.last[p] = s; }, event() {}, step() { g.t++; },
      snapshot: () => ({ t: g.t }), result: () => (g.done ? [['a'], ['b']] : null),
      setConnected(p, v) { g.conn[p] = v; },
    }),
    createView() {},
  };
  return g;
}

async function setup(n = 2, pids = ['a', 'b']) {
  const net = createMemNet(), g = stubGame();
  const host = new HostSession({ transport: net.host('ABCD'), games: [g.mod], rng: Math.random });
  const clients = [];
  for (let i = 0; i < n; i++) clients.push(await join(net, pids[i] ?? 'p' + i, 'P' + i));
  await flush();
  return { net, g, host, clients };
}
async function join(net, pid, name) {
  const conn = await net.connect('ABCD');
  const c = new ClientSession({ conn, pid, name });
  c.log = []; c.snaps = 0;
  for (const k of ['onRoom', 'onStart', 'onEvent', 'onEnd', 'onReject', 'onHostGone'])
    c[k] = x => c.log.push([k, x]);
  c.onSnap = () => c.snaps++;
  return c;
}
const got = (c, k) => c.log.filter(e => e[0] === k).map(e => e[1]);

test('two clients join and both see a two-player room', async () => {
  const { clients } = await setup();
  for (const c of clients) {
    assert.equal(c.welcomed, true);
    assert.equal(got(c, 'onRoom').at(-1).players.length, 2);
  }
});

test('eleventh client is rejected as full', async () => {
  const { net } = await setup(10);
  const c = await join(net, 'late', 'Late');
  await flush();
  assert.deepEqual(got(c, 'onReject'), ['full']);
  assert.equal(got(c, 'onHostGone').length, 0);
});

test('duplicate name is rejected', async () => {
  const { net } = await setup();
  const c = await join(net, 'z', 'p0');
  await flush();
  assert.deepEqual(got(c, 'onReject'), ['name']);
});

test('start game then snapshots reach clients within three ticks', async () => {
  const { host, clients } = await setup();
  assert.equal(host.startGame('stub'), true);
  await flush();
  for (const c of clients) assert.equal(got(c, 'onStart')[0].game, 'stub');
  host.tick(STEP); host.tick(STEP); host.tick(STEP);
  await flush();
  for (const c of clients) assert.ok(c.snaps >= 1);
});

test('startGame refuses below two active players', async () => {
  const { host } = await setup(1);
  assert.equal(host.startGame('stub'), false);
});

test('client input reaches the game host', async () => {
  const { host, g, clients } = await setup();
  host.startGame('stub'); await flush();
  clients[0].sendInput({ x: 1, y: 0, b: { Dash: 2 } });
  await flush();
  assert.equal(g.last.a.b.Dash, 2);
});

test('a lost unreliable packet does not lose the press counter', async () => {
  const { host, g, net, clients } = await setup();
  host.startGame('stub'); await flush();
  net.dropU(true);
  clients[0].sendInput({ x: 0, y: 0, b: { Dash: 1 } });
  await flush();
  assert.equal(g.last.a, undefined);
  net.dropU(false);
  clients[0].sendInput({ x: 0.5, y: 0, b: { Dash: 1 } });
  await flush();
  assert.equal(g.last.a.b.Dash, 1);
});

test('finished game awards points and tells everyone', async () => {
  const { host, g, clients } = await setup();
  host.startGame('stub'); await flush();
  g.done = true; host.tick(STEP); await flush();
  for (const c of clients) assert.deepEqual(got(c, 'onEnd')[0].placements, [['a'], ['b']]);
  assert.deepEqual(host.room.scores, { a: 5, b: 3 });
  assert.equal(host.room.inGame, false);
  assert.equal(host.room.lastGame, 'stub');
});

test('rejoin mid-game gets room then start and keeps the slot', async () => {
  const { host, g, net, clients } = await setup();
  host.startGame('stub'); await flush();
  clients[0].conn.close(); await flush();
  assert.equal(g.conn.a, false);
  assert.equal(host.room.players.find(p => p.pid === 'a').connected, false);
  const back = await join(net, 'a', 'whatever'); await flush();
  assert.equal(got(back, 'onRoom').length >= 1, true);
  assert.equal(got(back, 'onStart')[0].game, 'stub');
  assert.equal(host.room.players.length, 2);
  assert.equal(g.conn.a, true);
});

test('new client mid-game waits and gets no start', async () => {
  const { host, net } = await setup();
  host.startGame('stub'); await flush();
  const c = await join(net, 'c', 'Cee'); await flush();
  const me = got(c, 'onRoom').at(-1).players.find(p => p.pid === 'c');
  assert.equal(me.waiting, true);
  assert.equal(got(c, 'onStart').length, 0);
});

test('host close tells every client the host is gone', async () => {
  const { host, clients } = await setup();
  host.close(); await flush();
  for (const c of clients) assert.equal(got(c, 'onHostGone').length, 1);
});

test('host and play: local player joins and gets local events', async () => {
  const { host, g } = await setup();
  const pid = host.selfJoin('Hosty');
  assert.equal(host.room.players.length, 3);
  const seen = [];
  host.onStart = x => seen.push(['start', x.game]);
  host.onSnap = () => seen.push(['snap']);
  host.startGame('stub');
  host.localInput({ x: 0, y: 1, b: {} });
  assert.equal(g.last[pid].y, 1);
  host.tick(STEP); host.tick(STEP); host.tick(STEP);
  assert.deepEqual(seen.map(s => s[0]), ['start', 'snap']);
});

test('client knows the host closed the room on purpose', async () => {
  const { host, clients } = await setup();
  host.close(); await flush();
  for (const c of clients) assert.equal(c.closedByHost, true);
});

test('dropped connection is not mistaken for the host closing', async () => {
  const { clients } = await setup();
  clients[0].conn.close(); await flush();
  assert.equal(got(clients[0], 'onHostGone').length, 1);
  assert.notEqual(clients[0].closedByHost, true);
});

test('reclaiming a dropped player by name from a new device id takes over their slot', async () => {
  const { host, g, net, clients } = await setup();
  host.startGame('stub'); await flush();
  clients[0].conn.close(); await flush();
  const back = await join(net, 'fresh-id', 'P0'); await flush();
  assert.equal(back.pid, 'a');
  assert.equal(got(back, 'onStart')[0].game, 'stub');
  back.sendInput({ x: 1, y: 0, b: {} }); await flush();
  assert.equal(g.last.a.x, 1);
});

test('a second tab with the same id replaces the first, which is told and stays off', async () => {
  const { net, host, clients } = await setup();
  const old = clients[0];
  let replaced = 0; old.onReplaced = () => replaced++;
  const dup = await join(net, 'a', 'P0'); await flush();
  await new Promise(r => setTimeout(r, 400));
  assert.equal(replaced, 1);
  assert.equal(old.replaced, true);
  assert.equal(got(old, 'onHostGone').length, 0);
  assert.equal(host.room.players.find(p => p.pid === 'a').connected, true);
  assert.equal(dup.welcomed, true);
});
