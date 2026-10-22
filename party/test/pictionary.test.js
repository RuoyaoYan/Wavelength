import test from 'node:test';
import assert from 'node:assert/strict';
import pictionary, { normalizeGuess, TURN_TIME, CHOOSE_TIME } from '../js/games/pictionary.js';
import { WORDS } from '../js/games/words.js';
import { mulberry32 } from '../js/games/common.js';

const STEP = 1 / 60;
function setup(n) {
  const players = Array.from({ length: n }, (_, i) => ({ pid: n === 2 ? 'ab'[i] : 'p' + i, name: 'P' + i, color: '#000' }));
  const sent = [];
  const host = pictionary.createHost({ players, rng: mulberry32(4), emit: (ev, to) => sent.push({ ev, to }) });
  const run = secs => { for (let i = 0; i < Math.round(secs * 60); i++) host.step(STEP); };
  const until = (cond, secs = 30) => { for (let i = 0; i < secs * 60 && !cond(); i++) host.step(STEP); };
  return { players, host, sent, run, until };
}
const lastOf = (sent, type) => sent.filter(s => s.ev.type === type).at(-1);
const leaks = (sent, word, pid) => sent.filter(s => s.ev.type !== 'reveal' && (s.to === undefined || s.to === pid) && JSON.stringify(s.ev).toLowerCase().includes(word.toLowerCase()));

test('word list has 150+ distinct words', () => {
  assert.ok(WORDS.length >= 150);
  assert.equal(new Set(WORDS.map(normalizeGuess)).size, WORDS.length);
});

test('normalizeGuess strips case, spaces and punctuation', () => {
  assert.equal(normalizeGuess(' Ice-Cream! '), 'icecream');
});

test('the word choice goes only to the drawer and never into snapshots', () => {
  const { host, sent, until } = setup(2);
  until(() => lastOf(sent, 'choose'));
  const ch = lastOf(sent, 'choose');
  const drawer = host.snapshot().drawer;
  assert.equal(ch.to, drawer);
  assert.equal(ch.ev.options.length, 3);
  host.event(drawer, { type: 'pick', word: ch.ev.options[1] });
  host.step(STEP);
  const s = host.snapshot();
  assert.equal(s.phase, 'draw');
  assert.equal(JSON.stringify(s).toLowerCase().includes(ch.ev.options[1].toLowerCase()), false);
  assert.equal(s.hint.length, ch.ev.options[1].length);
});

test('a correct guess at 30 s left scores 300 for the guesser and 100 for the drawer, without leaking the word', () => {
  const { host, sent, until, run } = setup(2);
  until(() => lastOf(sent, 'choose'));
  const drawer = host.snapshot().drawer, guesser = drawer === 'a' ? 'b' : 'a';
  const word = lastOf(sent, 'choose').ev.options[0];
  host.event(drawer, { type: 'pick', word });
  run(TURN_TIME - 30);
  host.event(guesser, { type: 'guess', text: word.toUpperCase() + '!' });
  const sc = host.snapshot().scores;
  assert.equal(sc[guesser], 300);
  assert.equal(sc[drawer], 100);
  assert.deepEqual(leaks(sent, word, guesser), []);
  assert.ok(sent.some(s => s.ev.type === 'correct' && s.ev.pid === guesser));
});

test('wrong guesses are shared as chat, correct ones are not', () => {
  const { host, sent, until } = setup(3);
  until(() => lastOf(sent, 'choose'));
  const drawer = host.snapshot().drawer, [g1, g2] = ['p0', 'p1', 'p2'].filter(p => p !== drawer);
  const word = lastOf(sent, 'choose').ev.options[0];
  host.event(drawer, { type: 'pick', word });
  host.event(g1, { type: 'guess', text: 'zzzzqqq' });
  host.event(g2, { type: 'guess', text: word });
  const chats = sent.filter(s => s.ev.type === 'chat').map(s => s.ev.text);
  assert.deepEqual(chats, ['zzzzqqq']);
});

test('a near miss is told privately and not shared', () => {
  const { host, sent, until } = setup(3);
  until(() => lastOf(sent, 'choose'));
  const drawer = host.snapshot().drawer, g = ['p0', 'p1', 'p2'].find(p => p !== drawer);
  const word = lastOf(sent, 'choose').ev.options.find(w => w.length >= 4) || 'apple';
  host.event(drawer, { type: 'pick', word });
  host.event(g, { type: 'guess', text: word.slice(0, -1) });
  const close = sent.filter(s => s.ev.type === 'close');
  assert.equal(close.length, 1); assert.equal(close[0].to, g);
  assert.equal(sent.filter(s => s.ev.type === 'chat').length, 0);
});

test('two players take four turns; ten players take ten and all are placed', () => {
  for (const [n, turns] of [[2, 4], [10, 10]]) {
    const { host, sent, until } = setup(n);
    until(() => host.result() !== null, (CHOOSE_TIME + TURN_TIME + 10) * turns + 10);
    assert.equal(sent.filter(s => s.ev.type === 'reveal').length, turns);
    const flat = host.result().flat();
    assert.equal(flat.length, n); assert.equal(new Set(flat).size, n);
  }
});

test('a drawer who drops before picking gets the first option after the choose time', () => {
  const { host, sent, until, run } = setup(2);
  until(() => lastOf(sent, 'choose'));
  const drawer = host.snapshot().drawer;
  host.setConnected(drawer, false);
  run(CHOOSE_TIME + 0.1);
  assert.equal(host.snapshot().phase, 'draw');
  assert.equal(host.snapshot().hint.length, lastOf(sent, 'choose').ev.options[0].length);
});

test('strokes from the drawer are relayed; strokes from guessers are ignored; sync replays them', () => {
  const { host, sent, until } = setup(2);
  until(() => lastOf(sent, 'choose'));
  const drawer = host.snapshot().drawer, guesser = drawer === 'a' ? 'b' : 'a';
  host.event(drawer, { type: 'pick', word: lastOf(sent, 'choose').ev.options[0] });
  host.event(drawer, { type: 'stroke', id: 's1', pts: [[0.1, 0.1], [0.2, 0.2]], color: '#000', size: 0 });
  host.event(drawer, { type: 'stroke', id: 's1', pts: [[0.3, 0.3]] });
  host.event(guesser, { type: 'stroke', id: 'x', pts: [[0.5, 0.5]], color: '#f00', size: 1 });
  assert.equal(host.snapshot().strokes, 1);
  host.event(guesser, { type: 'sync' });
  const sync = lastOf(sent, 'strokes');
  assert.equal(sync.to, guesser);
  assert.equal(sync.ev.strokes[0].pts.length, 3);
});
