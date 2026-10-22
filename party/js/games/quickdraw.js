// Quick Draw: a five-round showdown. Every phone waits a secret, shared delay, flashes
// DRAW!, and times its own owner's tap, so a slow network never costs anyone the duel.
import { groupByScore, esc } from './common.js';

const ROUNDS = 5, INTRO = 2.5, GRACE = 3, REVEAL = 3.5;

function createHost({ players, rng, emit }) {
  const pids = players.map(p => p.pid);
  const totals = Object.fromEntries(pids.map(p => [p, 0]));
  const online = new Set(pids);
  let round = 0, phase = 'intro', t = 0, delay = 0, answers = {};

  function startRound() {
    round++; phase = 'arming'; t = 0; answers = {};
    delay = Math.round((1.5 + rng() * 3) * 1000) / 1000;
    emit({ type: 'arm', round, delay });
  }
  function closeRound() {
    const valid = pids.filter(p => typeof answers[p] === 'number');
    const points = {};
    for (const p of pids) {
      // Ties share the higher score: rank counts only strictly faster shots.
      points[p] = typeof answers[p] === 'number' ? valid.length - valid.filter(q => answers[q] < answers[p]).length : 0;
      totals[p] += points[p];
    }
    const times = Object.fromEntries(pids.map(p => [p, answers[p] ?? null]));
    phase = 'reveal'; t = 0;
    emit({ type: 'reveal', round, times, points, totals: { ...totals }, last: round === ROUNDS });
  }
  const everyoneIn = () => [...online].every(p => p in answers);

  return {
    input() {},
    event(pid, d) {
      if (phase !== 'arming' || !d || d.round !== round || pid in answers || !pids.includes(pid)) return;
      if (d.type === 'foul') answers[pid] = 'foul';
      else if (d.type === 'shot') answers[pid] = Number.isFinite(d.ms) && d.ms > 0 ? Math.round(d.ms) : 'foul';
      else return;
      if (everyoneIn()) closeRound();
    },
    setConnected(pid, v) { if (v) online.add(pid); else online.delete(pid); },
    step(dt) {
      t += dt;
      if (phase === 'intro' && t >= INTRO) startRound();
      else if (phase === 'arming' && (t >= delay + GRACE || (online.size && everyoneIn()))) closeRound();
      else if (phase === 'reveal' && t >= REVEAL) { if (round < ROUNDS) startRound(); else phase = 'done'; }
    },
    snapshot: () => ({ round, phase, totals: { ...totals }, answered: Object.keys(answers) }),
    result: () => (phase === 'done' ? groupByScore(pids, p => totals[p]) : null),
  };
}

const CSS = `
.qd{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:18px;text-align:center;color:#3b2412;
  background:linear-gradient(#ffd18a 0%,#ffb35c 55%,#e98a3c 56%,#d9762c 100%);transition:background .08s;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;overflow:auto}
.qd-round{margin:0;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:.85rem;opacity:.8}
.qd-big{margin:0;font-size:clamp(3rem,16vw,7rem);font-weight:900;line-height:.95;letter-spacing:-.02em}
.qd-sub{margin:0;font-weight:700;font-size:1.1rem;max-width:22ch}
.qd[data-s="wait"]{background:#c8102e;color:#fff}
.qd[data-s="draw"]{background:#00c853;color:#fff}
.qd[data-s="draw"] .qd-big{animation:qdpop .18s ease-out}
.qd[data-s="foul"]{background:#ff8a1f;color:#fff}
.qd[data-s="sent"]{background:#1d1d2c;color:#fff}
@keyframes qdpop{from{transform:scale(.6)}to{transform:scale(1)}}
.qd-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;width:min(420px,100%)}
.qd-list li{display:grid;grid-template-columns:20px 1fr auto auto;gap:10px;align-items:center;background:rgba(255,255,255,.85);color:#1d1d2c;border-radius:14px;padding:8px 12px;font-weight:800;text-align:left}
.qd-list li.me{outline:3px solid #1d1d2c}
.qd-list i{width:20px;height:20px;border-radius:50%;background:var(--c)}
.qd-list span{min-width:0;overflow-wrap:anywhere}
.qd-list em{font-style:normal;color:#6a6f85;font-variant-numeric:tabular-nums}
.qd-list b{color:#16804f;font-variant-numeric:tabular-nums}
.qd-ticks{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:520px}
.qd-ticks span{background:rgba(0,0,0,.25);color:#fff;border-radius:999px;padding:4px 12px;font-weight:800;font-size:.9rem}
.qd-ticks span.in{background:#fff;color:#1d1d2c}
`;

function createView({ el, me, players, isScreen, send }) {
  if (!document.getElementById('qd-css')) { const s = document.createElement('style'); s.id = 'qd-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = document.createElement('div');
  root.className = 'qd';
  el.appendChild(root);
  const info = pid => players.find(p => p.pid === pid);
  let state = 'intro', round = 0, timer = 0, shownAt = 0, answered = [], myTime = null;

  const ticks = () => isScreen || !me ? `<div class="qd-ticks">${players.map(p => `<span class="${answered.includes(p.pid) ? 'in' : ''}">${esc(p.name)}</span>`).join('')}</div>` : '';
  function render(big, sub = '', extra = '') {
    root.dataset.s = state;
    root.innerHTML = `<p class="qd-round">${round ? `Round ${round} of ${ROUNDS}` : 'Quick Draw'}</p><h2 class="qd-big">${big}</h2>${sub ? `<p class="qd-sub">${sub}</p>` : ''}${extra}`;
  }
  render('Get ready', me ? 'Tap anywhere the instant it says DRAW!' : 'Phones out. Tap on DRAW!');

  function onArm(ev) {
    clearTimeout(timer);
    round = ev.round; answered = []; myTime = null; shownAt = 0;
    state = 'wait';
    render('Wait…', me ? 'Don\'t tap yet' : '', ticks());
    timer = setTimeout(() => {
      if (state !== 'wait') return;
      state = 'draw';
      render('DRAW!', me ? 'TAP!' : '', ticks());
      // Start the clock now; move it to the paint moment if a frame comes before the tap.
      shownAt = performance.now();
      const armed = shownAt;
      requestAnimationFrame(now => { if (shownAt === armed && state === 'draw') shownAt = Math.max(armed, now); });
      navigator.vibrate?.(40);
    }, ev.delay * 1000);
  }
  function onReveal(ev) {
    clearTimeout(timer);
    state = 'reveal';
    const order = players.map(p => p.pid).sort((a, b) => {
      const ta = ev.times[a], tb = ev.times[b];
      const k = v => (typeof v === 'number' ? v : v === 'foul' ? 1e6 : 2e6);
      return k(ta) - k(tb);
    });
    const rows = order.map(pid => {
      const t = ev.times[pid], p = info(pid);
      return `<li class="${pid === me ? 'me' : ''}" style="--c:${p.color}"><i></i><span>${esc(p.name)}</span><em>${typeof t === 'number' ? t + ' ms' : t === 'foul' ? 'Too early' : '—'}</em><b>+${ev.points[pid]}</b></li>`;
    }).join('');
    const best = order[0] && typeof ev.times[order[0]] === 'number' ? `${esc(info(order[0]).name)} is fastest!` : 'Nobody drew in time!';
    render(best, ev.last ? 'Final round done' : 'Next round coming up…', `<ol class="qd-list">${rows}</ol>`);
  }
  function tap(e) {
    if (!me) return;
    e.preventDefault();
    if (state === 'wait') {
      clearTimeout(timer);
      state = 'foul';
      send({ type: 'foul', round });
      navigator.vibrate?.([60, 40, 60]);
      render('Too early!', 'You drew before the signal. 0 points this round.');
    } else if (state === 'draw') {
      myTime = Math.max(1, Math.round((e.timeStamp || performance.now()) - shownAt));
      state = 'sent';
      send({ type: 'shot', round, ms: myTime });
      render(`${myTime} ms`, 'Nice! Waiting for the others…');
    }
  }
  root.addEventListener('pointerdown', tap);

  return {
    snapshot(s) {
      answered = s.answered || [];
      const t = root.querySelector('.qd-ticks');
      if (t && (state === 'wait' || state === 'draw')) t.outerHTML = ticks();
    },
    event(ev) { if (ev.type === 'arm') onArm(ev); else if (ev.type === 'reveal') onReveal(ev); },
    destroy() { clearTimeout(timer); root.remove(); },
  };
}

export default {
  id: 'quickdraw', name: 'Quick Draw', color: '#e2582b',
  blurb: 'Wait for it… tap the instant it says DRAW!',
  controls: null,
  createHost, createView,
};
