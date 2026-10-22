// Screens and glue: start → lobby → game → results → lobby … → podium.
// The host device runs a HostSession; phones run a ClientSession. Both feed the same views.
import { HostSession, ClientSession } from './session.js';
import { makeCode, standings, pickRandomGame, placementPoints, activePlayers } from './room.js';
import { hostRoom, connect } from './net.js';
import { startTicker } from './ticker.js';
import { mountControls } from './controls.js';
import { GAMES } from './games/index.js';
import { esc } from './games/common.js';

const app = document.getElementById('app');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
// One id per tab (survives reloads and the phone sleeping); a fresh tab reclaims its slot by name.
let myPid = null;
try { myPid = sessionStorage.getItem('party_pid'); } catch (_) {}
if (!myPid) {
  myPid = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('party_pid', myPid); } catch (_) {}
}

// role: 'screen' (big-screen host, not a player) | 'hostplay' | 'phone'
const S = { role: null, session: null, room: null, code: null, me: null, screen: 'start', play: null, stopTicker: null, name: store.get('party_name') || '', resultsTimer: 0 };
const isHost = () => S.role === 'screen' || S.role === 'hostplay';
const gameById = id => GAMES.find(g => g.id === id);
const joinUrl = code => location.href.split('#')[0] + '#' + code;

// ---------- screen helpers ----------
function show(screen, html) {
  S.screen = screen;
  app.dataset.screen = screen;
  app.dataset.role = S.role || '';
  app.innerHTML = html;
}
const logo = (size = '') => `<h1 class="logo ${size}" aria-label="Party!">${[...'Party!'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</h1>`;

function renderStart(err = '') {
  S.role = null;
  const pre = (location.hash.slice(1) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  show('start', `
  <div class="wrap start">
    <a class="back" href="../">‹ Game portal</a>
    ${logo()}
    <p class="tag">5 party games · 2 to 10 players · everyone on their own phone</p>
    <section class="card">
      <label class="lbl" for="name">Your name</label>
      <input id="name" class="field" maxlength="16" autocomplete="nickname" placeholder="Name" value="${esc(S.name)}">
      <label class="lbl" for="code">Room code</label>
      <div class="row">
        <input id="code" class="field code-field" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD" value="${esc(pre)}">
        <button class="btn red" id="join">Join</button>
      </div>
      <p class="err" id="err" role="alert">${esc(err)}</p>
    </section>
    <div class="or"><span>or start a room</span></div>
    <div class="host-btns">
      <button class="btn blue tall" id="hostScreen"><b>Host on a big screen</b><small>TV or laptop shows the game</small></button>
      <button class="btn yellow tall" id="hostPlay"><b>Host &amp; play</b><small>This phone hosts and plays</small></button>
    </div>
    <p class="note">Works best when everyone is on the same Wi-Fi.</p>
  </div>`);
  const nameEl = document.getElementById('name'), codeEl = document.getElementById('code');
  codeEl.oninput = () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  const needName = () => {
    const n = nameEl.value.trim();
    if (!n) { document.getElementById('err').textContent = 'Type your name first.'; nameEl.focus(); return null; }
    S.name = n; store.set('party_name', n); return n;
  };
  document.getElementById('join').onclick = () => {
    const n = needName(); if (!n) return;
    const code = codeEl.value.trim();
    if (code.length !== 4) { document.getElementById('err').textContent = 'Room codes have 4 letters.'; codeEl.focus(); return; }
    joinRoom(code);
  };
  [nameEl, codeEl].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('join').click(); }));
  document.getElementById('hostScreen').onclick = () => startHost(false);
  document.getElementById('hostPlay').onclick = () => { if (needName()) startHost(true); };
  if (pre.length === 4 && !S.name) nameEl.focus();
}

function renderBusy(text) {
  show('busy', `<div class="wrap center-col">${logo('small')}<div class="spinner" aria-hidden="true"></div><p class="big-msg">${esc(text)}</p></div>`);
}

function renderError(title, msg, retry) {
  stopEverything();
  show('error', `<div class="wrap center-col">${logo('small')}
    <section class="card center"><h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p>
      <div class="row">${retry ? '<button class="btn red" id="retry">Retry</button>' : ''}<button class="btn ghost" id="home">Back</button></div></section></div>`);
  document.getElementById('home').onclick = () => { history.replaceState(null, '', location.pathname); renderStart(); };
  if (retry) document.getElementById('retry').onclick = retry;
}

// ---------- hosting ----------
async function startHost(play) {
  renderBusy('Creating a room…');
  let transport = null;
  for (let i = 0; i < 5 && !transport; i++) {
    try { transport = await hostRoom(makeCode(Math.random)); }
    catch (why) { if (why !== 'taken') return renderError('Couldn\'t create a room', 'The matchmaking service didn\'t answer. Check your internet connection and try again.', () => startHost(play)); }
  }
  if (!transport) return renderError('Couldn\'t create a room', 'Please try again.', () => startHost(play));
  S.role = play ? 'hostplay' : 'screen';
  S.code = transport.code;
  const session = new HostSession({ transport, games: GAMES });
  S.session = session;
  S.me = play ? session.selfJoin(S.name, myPid) : null;
  bind(session);
  S.stopTicker = startTicker(60, dt => session.tick(dt));
  keepAwake();
  S.room = session.room;
  renderLobby();
}

// ---------- joining ----------
async function joinRoom(code, quiet = false) {
  S.code = code;
  if (!quiet) renderBusy(`Joining ${code}…`);
  try {
    const conn = await connect(code);
    S.role = 'phone';
    S.me = myPid;
    const session = new ClientSession({ conn, pid: myPid, name: S.name });
    S.session = session;
    bind(session);
    keepAwake();
    history.replaceState(null, '', '#' + code);
    return true;
  } catch (why) {
    if (quiet) return false;
    if (why === 'no-room') renderError('Room not found', `There's no room called ${code}. Check the code with the host.`, () => joinRoom(code));
    else renderError('Couldn\'t connect', 'Couldn\'t connect. Are you on the same Wi-Fi as the host?', () => joinRoom(code));
    return false;
  }
}

let reconnecting = false;
async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;
  teardownPlay();
  renderBusy('Reconnecting…');
  for (let i = 0; i < 3; i++) {
    if (await joinRoom(S.code, true)) { reconnecting = false; return; }
  }
  reconnecting = false;
  renderError('Host disconnected', 'The host\'s device left or went to sleep.', () => joinRoom(S.code));
}

// ---------- session events → screens ----------
function bind(session) {
  const adopt = () => { if (session instanceof ClientSession) S.me = session.pid; };
  session.onRoom = room => {
    adopt();
    S.room = room;
    if (room.partyOver) { if (S.screen !== 'podium') renderPodium(); return; }
    if (S.screen === 'lobby' || S.screen === 'busy') renderLobby();
  };
  session.onStart = ({ game, players }) => { adopt(); startPlay(game, players); };
  session.onSnap = s => S.play?.view.snapshot(s);
  session.onEvent = d => S.play?.view.event(d);
  session.onEnd = ({ placements, room }) => { S.room = room; const id = S.play?.id; teardownPlay(); renderResults(placements, id); };
  if (session instanceof ClientSession) {
    session.onReject = reason => renderError(
      reason === 'full' ? 'Room is full (10 players)' : reason === 'name' ? 'Someone already has that name' : 'Please type a name',
      reason === 'name' ? 'Pick a different name and join again.' : 'Ask the host to start another room.', null);
    session.onHostGone = () => {
      if (session !== S.session) return;
      if (session.closedByHost) renderError('Host disconnected', 'The host closed the room.', null);
      else reconnect();
    };
  }
}

// ---------- lobby ----------
function renderLobby() {
  const room = S.room;
  if (!room) return renderBusy('Joining…');
  const me = room.players.find(p => p.pid === S.me);
  const rows = standings(room);
  const anyScore = rows.some(r => r.score > 0);
  const active = activePlayers(room).length;
  const joinBox = isHost() ? `
    <section class="card joinbox">
      <p class="lbl">Join on your phone</p>
      <div class="bigcode" aria-label="Room code ${room.code}">${[...room.code].map(c => `<span>${c}</span>`).join('')}</div>
      <p class="url">${esc(joinUrl(room.code).replace(/^https?:\/\//, ''))}</p>
      <div class="qr" id="qr"></div>
    </section>` : `<div class="roompill">Room <b>${esc(S.code)}</b></div>`;
  const players = `
    <section class="card">
      <div class="head"><p class="lbl">Players</p><span class="count">${room.players.length}/10</span></div>
      <div class="chips">${room.players.length ? room.players.map(p => `
        <span class="pchip${p.connected ? '' : ' off'}${p.pid === S.me ? ' me' : ''}" style="--c:${p.color}">
          <i></i>${esc(p.name)}${p.waiting ? '<em>next game</em>' : ''}${p.connected ? '' : '<em>away</em>'}</span>`).join('') : '<p class="muted">Waiting for players to join…</p>'}</div>
    </section>`;
  const scores = anyScore ? `
    <section class="card">
      <p class="lbl">Party points</p>
      <ol class="board">${rows.map(r => `<li><b class="rk">${r.rank}</b><i style="--c:${r.color}"></i><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>
    </section>` : '';
  const picker = isHost() ? `
    <section class="card">
      <div class="head"><p class="lbl">Pick a game</p>${active < 2 ? '<span class="muted small">Needs 2+ players</span>' : ''}</div>
      <div class="games">${GAMES.map(g => {
        const need = g.minPlayers ?? 2, ok = active >= need;
        return `<button class="gcard" data-g="${g.id}" style="--c:${g.color}" ${ok ? '' : 'disabled'}>
          <b>${esc(g.name)}</b><small>${esc(g.blurb)}</small>${ok ? '' : `<em>Needs ${need}+</em>`}</button>`;
      }).join('')}</div>
      <div class="row"><button class="btn green" id="random" ${active < 2 ? 'disabled' : ''}>Random game</button><button class="btn ghost" id="endparty" ${anyScore ? '' : 'disabled'}>End party</button></div>
    </section>` : `
    <section class="card center waitcard">
      <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="big-msg">${me?.waiting && room.inGame ? 'A game is running. You\'ll join the next one.' : 'Waiting for the host to pick a game…'}</p>
    </section>`;
  show('lobby', `
    <div class="wrap lobby">
      <header class="bar">${logo('small')}<button class="btn ghost slim" id="leave">${isHost() ? 'Close room' : 'Leave'}</button></header>
      <div class="lobby-grid">
        <div class="col">${joinBox}${S.role === 'screen' ? '' : players}</div>
        <div class="col">${S.role === 'screen' ? players : ''}${picker}${scores}</div>
      </div>
    </div>`);
  const qr = document.getElementById('qr');
  if (qr && window.qrcode) {
    try { const q = qrcode(0, 'M'); q.addData(joinUrl(room.code)); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (_) {}
  }
  document.getElementById('leave').onclick = () => {
    if (isHost() && !confirm('Close the room for everyone?')) return;
    leave();
  };
  app.querySelectorAll('.gcard').forEach(b => b.onclick = () => S.session.startGame(b.dataset.g));
  const rnd = document.getElementById('random');
  if (rnd) rnd.onclick = () => {
    const ok = GAMES.filter(g => active >= (g.minPlayers ?? 2)).map(g => g.id);
    S.session.startGame(pickRandomGame(ok, room.lastGame, Math.random));
  };
  const end = document.getElementById('endparty');
  if (end) end.onclick = () => { if (confirm('End the party and show the winners?')) S.session.endParty(); };
}

// ---------- in a game ----------
function startPlay(id, players) {
  const mod = gameById(id);
  if (!mod) return;
  teardownPlay();
  clearTimeout(S.resultsTimer);
  const playing = !!S.me && players.some(p => p.pid === S.me);
  const pad = !!mod.controls && playing;
  show('game', `
    <div class="game${pad ? ' with-pad' : ''}" style="--c:${mod.color}">
      <div class="game-top"><b>${esc(mod.name)}</b><span>${esc(mod.blurb)}</span></div>
      <div class="stage" id="stage"></div>
      ${pad ? '<div class="padwrap" id="pad"></div>' : ''}
    </div>`);
  const send = d => (S.role === 'phone' ? S.session.sendEvent(d) : S.session.localEvent(d));
  const sendInput = st => (S.role === 'phone' ? S.session.sendInput(st) : S.session.localInput(st));
  const view = mod.createView({ el: document.getElementById('stage'), me: playing ? S.me : null, players, isScreen: S.role === 'screen', send });
  let controls = null, timer = 0;
  if (pad) {
    controls = mountControls(document.getElementById('pad'), mod.controls, st => sendInput(st));
    timer = setInterval(() => sendInput(controls.state()), 50);
  }
  S.play = { id, view, controls, timer };
}

function teardownPlay() {
  if (!S.play) return;
  clearInterval(S.play.timer);
  S.play.controls?.destroy();
  try { S.play.view.destroy(); } catch (_) {}
  S.play = null;
}

function renderResults(placements, id) {
  const mod = gameById(id);
  const pts = placementPoints(placements);
  const who = pid => S.room.players.find(p => p.pid === pid) || { name: '?', color: '#999' };
  let place = 1;
  const rows = placements.map(group => {
    const html = group.map(pid => `<li class="${pid === S.me ? 'me' : ''}"><b class="rk">${place}</b><i style="--c:${who(pid).color}"></i><span>${esc(who(pid).name)}</span><b class="plus">+${pts[pid]}</b></li>`).join('');
    place += group.length;
    return html;
  }).join('');
  const winner = placements[0].map(pid => esc(who(pid).name)).join(' & ');
  show('results', `
    <div class="wrap center-col results">
      <p class="lbl">${esc(mod?.name || 'Results')}</p>
      <h2 class="winner"><span class="crown" aria-hidden="true">👑</span>${winner} ${placements[0].length > 1 ? 'win' : 'wins'}!</h2>
      <section class="card"><ol class="board">${rows}</ol></section>
      <p class="muted small">Back to the lobby in a moment…</p>
    </div>`);
  S.resultsTimer = setTimeout(() => { if (S.screen === 'results') S.room.partyOver ? renderPodium() : renderLobby(); }, 6000);
}

function renderPodium() {
  teardownPlay();
  const top = standings(S.room).slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  show('podium', `
    <div class="wrap center-col podium-wrap">
      ${logo('small')}
      <h2 class="winner">${esc(top[0]?.name || '')} wins the party!</h2>
      <div class="podium">${order.map(r => `
        <div class="step s${r.rank}" style="--c:${r.color}"><span class="pname">${esc(r.name)}</span><span class="ppts">${r.score} pts</span><div class="block">${r.rank}</div></div>`).join('')}</div>
      <section class="card"><ol class="board">${standings(S.room).map(r => `<li><b class="rk">${r.rank}</b><i style="--c:${r.color}"></i><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol></section>
      <button class="btn red" id="again">${isHost() ? 'New party' : 'Back to start'}</button>
    </div>`);
  document.getElementById('again').onclick = leave;
}

// ---------- lifecycle ----------
function stopEverything() {
  teardownPlay();
  clearTimeout(S.resultsTimer);
  S.stopTicker?.(); S.stopTicker = null;
}

function leave() {
  const s = S.session;
  S.session = null;
  stopEverything();
  try { s?.close(); } catch (_) {}
  S.room = null;
  history.replaceState(null, '', location.pathname);
  renderStart();
}

let wakeLock = null;
async function keepAwake() {
  try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.session) return;
  keepAwake();
  if (S.role === 'phone' && S.session.gone && !S.session.rejected && !S.session.closedByHost) reconnect();
});
// Leaving the page: the host says goodbye to everyone; a phone drops its link at once so the
// host marks it away now instead of after the heartbeat runs out (it rejoins on return).
addEventListener('pagehide', () => { S.session?.close(); });
// Opening a different room link in the same tab only changes the hash.
addEventListener('hashchange', () => { if (S.screen === 'start') renderStart(); });

renderStart();
