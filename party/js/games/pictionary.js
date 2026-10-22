// Pictionary: one player draws a secret word on their phone; everyone else watches the
// strokes appear live and races to type it. Faster correct guesses score more.
import { groupByScore, shuffle, esc } from './common.js';
import { WORDS } from './words.js';

export const INTRO = 2, CHOOSE_TIME = 10, TURN_TIME = 60, REVEAL_TIME = 4;
const MAX_PTS = 200, MAX_STROKES = 400;

export const normalizeGuess = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const num = v => (Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000 : 0);

function createHost({ players, rng, emit }) {
  const pids = players.map(p => p.pid);
  const rounds = pids.length <= 3 ? 2 : 1;
  const turns = [];
  for (let r = 0; r < rounds; r++) turns.push(...shuffle(pids, rng));
  const scores = Object.fromEntries(pids.map(p => [p, 0]));
  const online = new Set(pids);
  const used = new Set();
  let phase = 'intro', t = 0, turn = -1, drawer = null, options = [], word = '', correct = [], gained = {}, strokes = [];

  const pickOptions = () => {
    let pool = WORDS.filter(w => !used.has(w));
    if (pool.length < 3) { used.clear(); pool = WORDS.slice(); }
    const out = shuffle(pool, rng).slice(0, 3);
    out.forEach(w => used.add(w));
    return out;
  };
  function nextTurn() {
    turn++;
    if (turn >= turns.length) { phase = 'done'; return; }
    drawer = turns[turn]; options = pickOptions(); word = ''; correct = []; gained = {}; strokes = [];
    phase = 'choose'; t = 0;
    emit({ type: 'turn', drawer, turn });
    emit({ type: 'choose', options }, drawer);
  }
  function startDrawing(w) {
    word = w; phase = 'draw'; t = 0;
    emit({ type: 'word', word }, drawer);
  }
  function endTurn() {
    phase = 'reveal'; t = 0;
    emit({ type: 'reveal', word, drawer, gained: { ...gained } });
  }
  const guessersLeft = () => pids.filter(p => p !== drawer && online.has(p) && !correct.includes(p));

  return {
    input() {},
    setConnected(pid, v) { if (v) online.add(pid); else online.delete(pid); },
    event(pid, d) {
      if (!d || typeof d !== 'object') return;
      if (d.type === 'sync') {
        // A view that fell behind (or rejoined) gets the whole drawing, and the drawer their word.
        for (let i = 0; i < strokes.length || i === 0; i += 40) emit({ type: 'strokes', first: i === 0, strokes: strokes.slice(i, i + 40) }, pid);
        if (pid === drawer && phase === 'choose') emit({ type: 'choose', options }, pid);
        if (pid === drawer && phase === 'draw') emit({ type: 'word', word }, pid);
        return;
      }
      if (pid === drawer) {
        if (phase === 'choose' && d.type === 'pick' && options.includes(d.word)) startDrawing(d.word);
        if (phase !== 'draw') return;
        if (d.type === 'stroke' && typeof d.id === 'string' && Array.isArray(d.pts)) {
          const pts = d.pts.slice(0, MAX_PTS).filter(p => Array.isArray(p)).map(([x, y]) => [num(x), num(y)]);
          let s = strokes.find(q => q.id === d.id);
          if (!s) {
            if (strokes.length >= MAX_STROKES) return;
            s = { id: d.id.slice(0, 16), color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#1d1d2c', size: d.size ? 1 : 0, pts: [] };
            strokes.push(s);
          }
          if (s.pts.length + pts.length > 4000) return;
          s.pts.push(...pts);
          emit({ type: 'stroke', id: s.id, color: s.color, size: s.size, pts });
        } else if (d.type === 'undo') {
          const s = strokes.pop();
          if (s) emit({ type: 'undo', id: s.id });
        } else if (d.type === 'clear') {
          strokes = [];
          emit({ type: 'clear' });
        }
        return;
      }
      if (phase !== 'draw' || d.type !== 'guess' || correct.includes(pid)) return;
      const text = String(d.text ?? '').slice(0, 40).trim();
      const g = normalizeGuess(text), target = normalizeGuess(word);
      if (!g) return;
      if (g === target) {
        const pts = Math.round(100 + 400 * Math.max(0, TURN_TIME - t) / TURN_TIME);
        scores[pid] += pts; scores[drawer] += 100;
        gained[pid] = (gained[pid] || 0) + pts; gained[drawer] = (gained[drawer] || 0) + 100;
        correct.push(pid);
        emit({ type: 'correct', pid, pts });
        if (!guessersLeft().length) endTurn();
      } else if (target.length >= 4 && editDistance(g, target) === 1) {
        emit({ type: 'close', text }, pid);
      } else {
        emit({ type: 'chat', pid, text });
      }
    },
    step(dt) {
      t += dt;
      if (phase === 'intro' && t >= INTRO) nextTurn();
      else if (phase === 'choose' && t >= CHOOSE_TIME) startDrawing(options[0]);
      else if (phase === 'draw' && (t >= TURN_TIME || (online.size > 1 && !guessersLeft().length && correct.length))) endTurn();
      else if (phase === 'reveal' && t >= REVEAL_TIME) nextTurn();
    },
    snapshot: () => ({
      phase, turn, turns: turns.length, drawer, scores: { ...scores }, correct: correct.slice(), strokes: strokes.length,
      timeLeft: phase === 'draw' ? Math.max(0, Math.ceil(TURN_TIME - t)) : phase === 'choose' ? Math.max(0, Math.ceil(CHOOSE_TIME - t)) : 0,
      hint: phase === 'draw' ? word.replace(/[^ \-]/g, '_') : '',
    }),
    result: () => (phase === 'done' ? groupByScore(pids, p => scores[p]) : null),
  };
}

// ---------------- view ----------------
const CSS = `
.pc{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:10px;background:#fff4dc;color:#1d1d2c;overflow:hidden}
.pc-top{display:flex;align-items:center;gap:10px;min-height:44px}
.pc-hint{flex:1;min-width:0;font-weight:900;font-size:1.6rem;letter-spacing:.18em;overflow-wrap:anywhere;line-height:1.1}
.pc-hint small{display:block;letter-spacing:0;font-size:.8rem;font-weight:700;color:#6a6f85}
.pc-time{flex-shrink:0;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#1d1d2c;color:#fff;font-weight:900;font-size:1.2rem}
.pc-time.low{background:#ff3b4e}
.pc-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.pc-board{position:relative;width:100%;max-height:100%;aspect-ratio:4/3;margin:0 auto;background:#fff;border-radius:18px;box-shadow:0 4px 0 #e5d3ad;overflow:hidden;touch-action:none}
.pc-board canvas{position:absolute;inset:0;width:100%;height:100%}
.pc-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
.pc-tools button{border:0;border-radius:999px;min-width:40px;height:40px;font:800 .9rem Outfit,system-ui;cursor:pointer;background:#fff;box-shadow:0 3px 0 #e5d3ad;padding:0 12px}
.pc-tools .sw{width:40px;padding:0;background:var(--c)}
.pc-tools .sw.on,.pc-tools .sz.on{outline:3px solid #1d1d2c;outline-offset:2px}
.pc-form{display:flex;gap:8px}
.pc-form input{flex:1;min-width:0;font:700 1.1rem Outfit,system-ui;border:2.5px solid #e5d3ad;border-radius:14px;padding:12px 14px;background:#fff}
.pc-form input:focus{outline:none;border-color:#1d1d2c}
.pc-form button{border:0;border-radius:14px;padding:0 18px;font:900 1rem Outfit,system-ui;background:#22b573;color:#fff;box-shadow:0 4px 0 #16804f;cursor:pointer}
.pc-feed{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;overflow:auto;min-height:48px;max-height:22vh;font-weight:700;font-size:.95rem}
.pc-feed li{background:#fff;border-radius:10px;padding:5px 10px;overflow-wrap:anywhere}
.pc-feed li.ok{background:#d8f5e7;color:#16804f}
.pc-feed li.close{background:#fff1c9;color:#8a5a00}
.pc-feed b{color:var(--c)}
.pc-choose{display:flex;flex-direction:column;gap:10px;align-items:stretch;justify-content:center;flex:1}
.pc-choose button{border:0;border-radius:18px;padding:18px;font:900 1.4rem Outfit,system-ui;background:#ff5fb7;color:#fff;box-shadow:0 5px 0 #c43d8b;cursor:pointer}
.pc-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px}
.pc-center h3{margin:0;font-size:1.8rem;font-weight:900}
.pc-center .w{font-size:2.6rem;font-weight:900;color:#ff5fb7}
.pc-scores{display:flex;flex-wrap:wrap;gap:6px}
.pc-scores span{background:#fff;border-radius:999px;padding:4px 10px;font-weight:800;font-size:.85rem}
.pc-scores span.dr{background:#1d1d2c;color:#fff}
.pc-scores span.ok{background:#d8f5e7}
.pc.screen .pc-body{flex-direction:row}
.pc.screen .pc-hint{font-size:2.4rem}.pc.screen .pc-hint small{font-size:1rem}.pc.screen .pc-time{width:64px;height:64px;font-size:1.5rem}
.pc.screen .pc-board{flex:1;width:auto;height:100%;max-width:calc((100vh - 140px) * 4 / 3)}
.pc.screen .pc-side{width:min(320px,32vw);display:flex;flex-direction:column;gap:8px;min-height:0}
.pc.screen .pc-feed{max-height:none;flex:1}
`;
const COLORS = ['#1d1d2c', '#ff3b4e', '#2f8cff', '#22b573', '#ffc21a', '#a45cff'];
const SIZES = [0.008, 0.022];

function createView({ el, me, players, isScreen, send }) {
  if (!document.getElementById('pc-css')) { const s = document.createElement('style'); s.id = 'pc-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = document.createElement('div');
  root.className = 'pc' + (isScreen ? ' screen' : '');
  el.appendChild(root);
  const info = pid => players.find(p => p.pid === pid) || { name: '?', color: '#999' };
  let snap = null, strokes = [], myWord = '', options = [], feed = [], mode = '', color = COLORS[0], size = 0, revealed = null, lastSync = 0;
  let canvas = null, ctx = null, drawing = null, pending = [], flushTimer = 0, raf = 0;

  const isDrawer = () => snap && me && snap.drawer === me;
  function redraw() {
    raf = 0;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(2, SIZES[s.size] * r.width);
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * r.width, y * r.height) : ctx.moveTo(x * r.width, y * r.height)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * r.width + 0.1, s.pts[0][1] * r.height);
      ctx.stroke();
    }
  }
  const queueDraw = () => { if (!raf) raf = requestAnimationFrame(redraw); };

  function feedHtml() {
    return feed.slice(-30).map(f => f.k === 'ok' ? `<li class="ok">✓ ${esc(info(f.pid).name)} got it! +${f.pts}</li>`
      : f.k === 'close' ? `<li class="close">“${esc(f.text)}” is so close!</li>`
      : `<li style="--c:${info(f.pid).color}"><b>${esc(info(f.pid).name)}:</b> ${esc(f.text)}</li>`).join('');
  }
  function scoresHtml() {
    if (!snap) return '';
    return `<div class="pc-scores">${players.slice().sort((a, b) => (snap.scores[b.pid] || 0) - (snap.scores[a.pid] || 0)).map(p =>
      `<span class="${p.pid === snap.drawer ? 'dr' : snap.correct.includes(p.pid) ? 'ok' : ''}">${esc(p.name)} ${snap.scores[p.pid] || 0}</span>`).join('')}</div>`;
  }
  function updateFeed() { const f = root.querySelector('.pc-feed'); if (f) { f.innerHTML = feedHtml(); f.scrollTop = f.scrollHeight; } }
  function updateTop() {
    const t = root.querySelector('.pc-time'); if (t && snap) { t.textContent = snap.timeLeft; t.classList.toggle('low', snap.phase === 'draw' && snap.timeLeft <= 10); }
    const sc = root.querySelector('.pc-scores'); if (sc) sc.outerHTML = scoresHtml();
  }

  function render() {
    if (!snap) { root.innerHTML = `<div class="pc-center"><h3>Pictionary</h3><p>Get your drawing finger ready…</p></div>`; return; }
    const drawerName = esc(info(snap.drawer).name);
    let m;
    if (revealed) m = 'reveal';
    else if (snap.phase === 'choose') m = isDrawer() ? 'choose' : 'waiting';
    else if (snap.phase === 'draw') m = isDrawer() ? 'draw' : 'guess';
    else m = 'intro';
    mode = m;
    const turnLbl = `Turn ${snap.turn + 1} of ${snap.turns}`;
    if (m === 'intro') root.innerHTML = `<div class="pc-center"><h3>Pictionary</h3><p>Everyone takes a turn drawing.</p></div>`;
    else if (m === 'choose') root.innerHTML = `<div class="pc-top"><div class="pc-hint">Pick a word to draw<small>${turnLbl}</small></div><div class="pc-time">${snap.timeLeft}</div></div>
        <div class="pc-choose">${options.map(w => `<button data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
    else if (m === 'waiting') root.innerHTML = `<div class="pc-top"><div class="pc-hint">${drawerName} is picking a word…<small>${turnLbl}</small></div><div class="pc-time">${snap.timeLeft}</div></div>
        <div class="pc-center"><p>Get ready to guess!</p></div>${scoresHtml()}`;
    else if (m === 'reveal') root.innerHTML = `<div class="pc-center"><p>The word was</p><div class="w">${esc(revealed.word)}</div>
        <p>${Object.entries(revealed.gained).map(([pid, g]) => `${esc(info(pid).name)} +${g}`).join(' · ') || 'Nobody got it!'}</p></div>${scoresHtml()}`;
    else {
      const top = m === 'draw'
        ? `<div class="pc-top"><div class="pc-hint">Draw: ${esc(myWord)}<small>${turnLbl} · no letters or numbers!</small></div><div class="pc-time">${snap.timeLeft}</div></div>`
        : `<div class="pc-top"><div class="pc-hint">${esc(snap.hint).split('').join(' ').replace(/ {3}/g, '&nbsp;&nbsp;&nbsp;')}<small>${drawerName} is drawing · ${turnLbl}</small></div><div class="pc-time">${snap.timeLeft}</div></div>`;
      const tools = m === 'draw' ? `<div class="pc-tools">${COLORS.map(c => `<button class="sw${c === color ? ' on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Colour"></button>`).join('')}
          <button class="sz${size === 0 ? ' on' : ''}" data-s="0">Thin</button><button class="sz${size === 1 ? ' on' : ''}" data-s="1">Thick</button>
          <button data-a="undo">Undo</button><button data-a="clear">Clear</button></div>` : '';
      const form = m === 'guess' && me && !snap.correct.includes(me)
        ? `<form class="pc-form"><input maxlength="40" placeholder="Type your guess" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"><button>Guess</button></form>`
        : m === 'guess' && me ? `<p style="margin:0;font-weight:800;color:#16804f;text-align:center">You got it! Watch the others squirm.</p>` : '';
      root.innerHTML = isScreen
        ? `${top}<div class="pc-body"><div class="pc-board"><canvas></canvas></div><div class="pc-side">${scoresHtml()}<ul class="pc-feed"></ul></div></div>`
        : `${top}<div class="pc-body"><div class="pc-board"><canvas></canvas></div>${tools}${form}${m === 'guess' ? '<ul class="pc-feed"></ul>' : ''}${scoresHtml()}</div>`;
      canvas = root.querySelector('canvas'); ctx = canvas.getContext('2d');
      updateFeed(); queueDraw();
    }
    if (mode !== 'draw' && mode !== 'guess') canvas = null;
    root.querySelectorAll('.pc-choose button').forEach(b => b.onclick = () => send({ type: 'pick', word: b.dataset.w }));
    root.querySelectorAll('.pc-tools .sw').forEach(b => b.onclick = () => { color = b.dataset.c; root.querySelectorAll('.pc-tools .sw').forEach(x => x.classList.toggle('on', x === b)); });
    root.querySelectorAll('.pc-tools .sz').forEach(b => b.onclick = () => { size = +b.dataset.s; root.querySelectorAll('.pc-tools .sz').forEach(x => x.classList.toggle('on', x === b)); });
    root.querySelectorAll('.pc-tools [data-a]').forEach(b => b.onclick = () => send({ type: b.dataset.a }));
    const form = root.querySelector('.pc-form');
    if (form) form.onsubmit = e => { e.preventDefault(); const i = form.querySelector('input'); if (i.value.trim()) send({ type: 'guess', text: i.value }); i.value = ''; i.focus(); };
    if (m === 'draw') bindDrawing();
  }

  function bindDrawing() {
    const pos = e => { const r = canvas.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000]; };
    const flush = () => {
      if (!drawing || !pending.length) return;
      send({ type: 'stroke', id: drawing.id, color: drawing.color, size: drawing.size, pts: pending });
      pending = [];
    };
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      drawing = { id: Math.random().toString(36).slice(2, 10), color, size, pts: [pos(e)] };
      strokes.push(drawing); pending = [pos(e)]; queueDraw();
      clearInterval(flushTimer); flushTimer = setInterval(flush, 60);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pos(e), last = drawing.pts.at(-1);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) return;
      drawing.pts.push(p); pending.push(p); queueDraw();
    });
    const end = () => { if (!drawing) return; flush(); drawing = null; clearInterval(flushTimer); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }

  render();
  const onResize = () => queueDraw();
  addEventListener('resize', onResize);

  return {
    snapshot(s) {
      const prev = snap;
      snap = s;
      if (!prev || prev.phase !== s.phase || prev.turn !== s.turn || prev.drawer !== s.drawer
        || (me && prev.correct.includes(me) !== s.correct.includes(me))) {
        if (prev && prev.turn !== s.turn) revealed = null;
        if (s.phase !== 'reveal') revealed = s.phase === 'draw' || s.phase === 'choose' ? null : revealed;
        render();
      } else updateTop();
      // Behind on strokes (joined late, a message dropped)? Ask for the whole drawing.
      if (s.phase === 'draw' && !isDrawer() && s.strokes !== strokes.length && performance.now() - lastSync > 1500) { lastSync = performance.now(); send({ type: 'sync' }); }
      if (isDrawer() && ((s.phase === 'choose' && !options.length) || (s.phase === 'draw' && !myWord)) && performance.now() - lastSync > 1500) { lastSync = performance.now(); send({ type: 'sync' }); }
    },
    event(ev) {
      switch (ev.type) {
        case 'turn': strokes = []; feed = []; myWord = ''; options = []; revealed = null; break;
        case 'choose': options = ev.options; if (snap) render(); break;
        case 'word': myWord = ev.word; if (snap && snap.phase === 'draw') render(); break;
        case 'stroke': {
          if (isDrawer()) break;
          let s = strokes.find(q => q.id === ev.id);
          if (!s) { s = { id: ev.id, color: ev.color, size: ev.size, pts: [] }; strokes.push(s); }
          s.pts.push(...ev.pts); queueDraw(); break;
        }
        case 'strokes': if (ev.first) strokes = []; if (!isDrawer() || ev.first) strokes.push(...ev.strokes); queueDraw(); break;
        case 'undo': { const i = strokes.findIndex(q => q.id === ev.id); if (i >= 0) strokes.splice(i, 1); queueDraw(); break; }
        case 'clear': strokes = []; queueDraw(); break;
        case 'chat': feed.push({ k: 'chat', pid: ev.pid, text: ev.text }); updateFeed(); break;
        case 'correct': feed.push({ k: 'ok', pid: ev.pid, pts: ev.pts }); updateFeed(); if (ev.pid === me) { navigator.vibrate?.(60); render(); } break;
        case 'close': feed.push({ k: 'close', text: ev.text }); updateFeed(); break;
        case 'reveal': revealed = ev; render(); break;
      }
    },
    destroy() { clearInterval(flushTimer); cancelAnimationFrame(raf); removeEventListener('resize', onResize); root.remove(); },
  };
}

export default {
  id: 'pictionary', name: 'Pictionary', color: '#22b573',
  blurb: 'One draws, everyone guesses. Faster guesses score more.',
  controls: null,
  createHost, createView,
};
