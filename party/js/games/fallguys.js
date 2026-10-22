// Fall Guys: wobbly beans race an obstacle course (the slowest third are knocked out),
// then the survivors play Hex-A-Gone: tiles drop shortly after you step on them, two
// floors deep. Last bean standing takes the crown.
import { createRenderLoop, SnapBuffer, drawBlob, drawCrown, nameTag, fitWorld, banner, circleCollide, groupByScore, shuffle, NO_INPUT, round1, clamp } from './common.js';

export const COUNTDOWN = 3, RACE_LIMIT = 120, RACE_OVER = 4, HEX_LIMIT = 150, HEX_OVER = 4.5;
const BEAN_R = 14, ACC = 1400, MAX_SPEED = 210, FRICTION = 4, DIVE = 380, DIVE_CD = 1, DIVE_TIME = 0.35;
const RESPAWN = 1, TILE_DELAY = 0.6, DROP_TIME = 0.45, HEX = 36, SQ3 = Math.sqrt(3);
const COURSE_W = 600;

export const raceQualifiers = n => (n <= 3 ? n : n - Math.floor(n / 3));

// The course runs upward: beans start near y=2900 and cross the finish below y=200.
const band = (y, h, bridges) => {
  const out = []; let x = 0;
  for (const [a, b] of bridges) { if (a > x) out.push({ x, y, w: a - x, h }); x = b; }
  if (x < COURSE_W) out.push({ x, y, w: COURSE_W - x, h });
  return out;
};
export const COURSE = {
  startY: 2900, finishY: 200, length: 3000,
  checkpoints: [2900, 2380, 1880, 1380, 880],
  sections: [
    { y0: 2800, y1: 3000, color: '#c9f2ff', name: 'Start' },
    { y0: 2400, y1: 2800, color: '#ffe3f1', name: 'Sweepers' },
    { y0: 1900, y1: 2400, color: '#fff1c9', name: 'Gaps' },
    { y0: 1400, y1: 1900, color: '#e3ffd9', name: 'Pushers' },
    { y0: 900, y1: 1400, color: '#efe3ff', name: 'The Bridge' },
    { y0: 300, y1: 900, color: '#ffe8d6', name: 'Bumpers' },
    { y0: 0, y1: 300, color: '#fff7b8', name: 'Finish' },
  ],
  voids: [
    ...band(2250, 80, [[90, 170], [260, 340], [430, 510]]),
    ...band(2060, 80, [[170, 250], [350, 430]]),
    { x: 0, y: 950, w: 190, h: 380 }, { x: 410, y: 950, w: 190, h: 380 },
  ],
  bars: [
    { cx: 300, cy: 2680, len: 300, w: 1.1, a0: 0 },
    { cx: 300, cy: 2500, len: 300, w: -1.4, a0: 1.2 },
    { cx: 300, cy: 1140, len: 270, w: 1.6, a0: 0.4 },
  ],
  pushers: [
    { y: 1780, w: 150, h: 36, amp: 220, sp: 1.2, ph: 0 },
    { y: 1660, w: 150, h: 36, amp: 220, sp: 1.6, ph: 2 },
    { y: 1540, w: 150, h: 36, amp: 220, sp: 1.0, ph: 4 },
    { y: 1450, w: 150, h: 36, amp: 220, sp: 1.9, ph: 1 },
  ],
  bumpers: [[150, 780], [300, 720], [450, 780], [225, 600], [375, 600], [150, 450], [300, 500], [450, 450], [300, 360]].map(([x, y]) => ({ x, y, r: 32 })),
};

export const isVoid = (x, y) => COURSE.voids.some(v => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
export const barEnds = (b, t) => {
  const a = b.a0 + b.w * t, dx = Math.cos(a) * b.len / 2, dy = Math.sin(a) * b.len / 2;
  return [b.cx - dx, b.cy - dy, b.cx + dx, b.cy + dy];
};
export const pusherX = (p, t) => COURSE_W / 2 + p.amp * Math.sin(p.sp * t + p.ph);

// Hex grid (pointy-top, axial coords), centred on (0,0).
export const hexRings = n => 4 + Math.ceil(n / 2);
export function hexTiles(rings) {
  const tiles = [];
  for (let q = -rings; q <= rings; q++) for (let r = -rings; r <= rings; r++)
    if (Math.abs(q + r) <= rings) tiles.push({ q, r, x: HEX * SQ3 * (q + r / 2), y: HEX * 1.5 * r });
  return tiles;
}
function hexAt(x, y, index) {
  let q = (SQ3 / 3 * x - y / 3) / HEX, r = (2 / 3 * y) / HEX, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return index.get(rq + ',' + rr) ?? -1;
}

function createHost({ players, rng }) {
  const n = players.length, Q = raceQualifiers(n);
  const S = { phase: 'race-count', t: 0, rt: 0, Q, finished: 0, beans: [], hex: null, winners: [], done: false, placements: null };
  S.beans = players.map((p, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    return { pid: p.pid, x: 100 + col * 100 + (row % 2) * 50, y: COURSE.startY + row * 40, vx: 0, vy: 0, r: BEAN_R, fx: 0, fy: -1,
      in: NO_INPUT, diveSeen: 0, cd: 0, dive: 0, falling: 0, cp: 0, best: 0, fin: false, finOrder: 0, qualified: false,
      layer: 0, drop: 0, elim: false, elimAt: 0, online: true, tie: rng() };
  });
  const bean = pid => S.beans.find(b => b.pid === pid);

  function steer(b, dt) {
    b.cd = Math.max(0, b.cd - dt); b.dive = Math.max(0, b.dive - dt);
    const ix = b.in.x || 0, iy = b.in.y || 0, m = Math.hypot(ix, iy);
    if (m > 0.01) { b.fx = ix / m; b.fy = iy / m; }
    const presses = b.in.b?.Dive || 0;
    if (presses > b.diveSeen) {
      b.diveSeen = presses;
      if (b.cd <= 0) { b.vx += b.fx * DIVE; b.vy += b.fy * DIVE; b.cd = DIVE_CD; b.dive = DIVE_TIME; }
    }
    const control = b.dive > 0 ? 0.25 : 1;
    b.vx += ix * ACC * control * dt; b.vy += iy * ACC * control * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED && b.dive <= 0) { const k = Math.max(MAX_SPEED / sp, 1 - 6 * dt); b.vx *= k; b.vy *= k; }
    b.vx -= b.vx * FRICTION * dt * (b.dive > 0 ? 0.3 : 1); b.vy -= b.vy * FRICTION * dt * (b.dive > 0 ? 0.3 : 1);
    b.x += b.vx * dt; b.y += b.vy * dt;
  }

  function obstacles(b) {
    const t = S.rt;
    for (const bar of COURSE.bars) {
      const [x1, y1, x2, y2] = barEnds(bar, t), dx = x2 - x1, dy = y2 - y1;
      const k = clamp(((b.x - x1) * dx + (b.y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = x1 + dx * k, py = y1 + dy * k, ex = b.x - px, ey = b.y - py, d = Math.hypot(ex, ey), min = b.r + 9;
      if (d < min) {
        const nx = d ? ex / d : 1, ny = d ? ey / d : 0;
        b.x = px + nx * min; b.y = py + ny * min;
        const tvx = -bar.w * (py - bar.cy), tvy = bar.w * (px - bar.cx); // spin velocity at the contact point
        b.vx = tvx * 1.1 + nx * 140; b.vy = tvy * 1.1 + ny * 140;
      }
    }
    for (const p of COURSE.pushers) {
      const cx = pusherX(p, t), vx = p.amp * p.sp * Math.cos(p.sp * t + p.ph);
      const qx = clamp(b.x, cx - p.w / 2, cx + p.w / 2), qy = clamp(b.y, p.y - p.h / 2, p.y + p.h / 2);
      const ex = b.x - qx, ey = b.y - qy, d = Math.hypot(ex, ey);
      if (d < b.r) {
        const nx = d ? ex / d : Math.sign(b.x - cx) || 1, ny = d ? ey / d : 0;
        b.x = qx + nx * b.r; b.y = qy + ny * b.r;
        b.vx = vx * 1.2 + nx * 120; b.vy += ny * 120;
      }
    }
    for (const u of COURSE.bumpers) {
      const ex = b.x - u.x, ey = b.y - u.y, d = Math.hypot(ex, ey), min = b.r + u.r;
      if (d < min) {
        const nx = d ? ex / d : 0, ny = d ? ey / d : 1, sp = Math.max(330, Math.hypot(b.vx, b.vy));
        b.x = u.x + nx * min; b.y = u.y + ny * min; b.vx = nx * sp; b.vy = ny * sp;
      }
    }
  }

  function respawn(b) {
    const cy = COURSE.checkpoints[b.cp];
    b.x = 160 + rng() * 280; b.y = cy + 10 + rng() * 25; b.vx = b.vy = 0; b.falling = 0;
  }

  function raceStep(dt) {
    S.rt += dt;
    const racers = S.beans.filter(b => !b.fin);
    for (const b of racers) {
      if (b.falling > 0) { b.falling += dt; if (b.falling >= RESPAWN) respawn(b); continue; }
      steer(b, dt);
      b.x = clamp(b.x, b.r, COURSE_W - b.r);
      b.y = clamp(b.y, 20, COURSE.length - b.r);
      obstacles(b);
      b.x = clamp(b.x, b.r, COURSE_W - b.r);
      if (isVoid(b.x, b.y)) { b.falling = dt; continue; }
      while (b.cp + 1 < COURSE.checkpoints.length && b.y <= COURSE.checkpoints[b.cp + 1]) b.cp++;
      b.best = Math.max(b.best, COURSE.startY - b.y);
      if (b.y <= COURSE.finishY) { b.fin = true; b.finOrder = ++S.finished; b.vx = b.vy = 0; b.best = COURSE.startY; }
    }
    const live = racers.filter(b => !b.fin && b.falling === 0);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) circleCollide(live[i], live[j], 0.5);
    if (S.finished >= Q || S.rt >= RACE_LIMIT) endRace();
  }

  function endRace() {
    const order = S.beans.slice().sort((a, b) =>
      (a.fin ? a.finOrder : 1e9) - (b.fin ? b.finOrder : 1e9) || b.best - a.best || a.tie - b.tie);
    order.forEach((b, i) => { b.qualified = i < Q; b.raceRank = i; });
    S.phase = 'race-over'; S.t = 0;
  }

  function startHex() {
    const qs = S.beans.filter(b => b.qualified), rings = hexRings(qs.length), tiles = hexTiles(rings);
    const index = new Map(tiles.map((t, i) => [t.q + ',' + t.r, i]));
    S.hex = { rings, tiles, index, touched: [new Float64Array(tiles.length).fill(-1), new Float64Array(tiles.length).fill(-1)], gone: [new Uint8Array(tiles.length), new Uint8Array(tiles.length)], t: 0 };
    const R = HEX * 1.5 * rings * 0.5;
    qs.forEach((b, i) => {
      const a = (i / qs.length) * Math.PI * 2;
      Object.assign(b, { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: 0, vy: 0, layer: 0, drop: 0, elim: false, dive: 0, cd: 0, fx: -Math.cos(a), fy: -Math.sin(a) });
    });
    S.phase = 'hex-count'; S.t = 0;
  }

  function hexStep(dt) {
    const H = S.hex; H.t += dt;
    const qs = S.beans.filter(b => b.qualified && !b.elim);
    for (const b of qs) {
      if (b.drop > 0) {
        b.drop -= dt;
        if (b.drop <= 0) { b.drop = 0; b.layer++; if (b.layer > 1) { b.elim = true; b.elimAt = Math.round(H.t * 60); } }
        continue;
      }
      steer(b, dt);
    }
    const standing = qs.filter(b => !b.elim && b.drop === 0);
    for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++)
      if (standing[i].layer === standing[j].layer) circleCollide(standing[i], standing[j], 0.5);
    for (const b of standing) {
      const i = hexAt(b.x, b.y, H.index);
      if (i < 0 || H.gone[b.layer][i]) { b.drop = DROP_TIME; continue; }
      if (H.touched[b.layer][i] < 0) H.touched[b.layer][i] = H.t;
    }
    for (let L = 0; L < 2; L++) for (let i = 0; i < H.tiles.length; i++)
      if (!H.gone[L][i] && H.touched[L][i] >= 0 && H.t - H.touched[L][i] >= TILE_DELAY) H.gone[L][i] = 1;
    const alive = S.beans.filter(b => b.qualified && !b.elim);
    if (alive.length <= 1 || H.t >= HEX_LIMIT) endHex(alive);
  }

  function endHex(alive) {
    S.winners = alive.map(b => b.pid);
    const qs = S.beans.filter(b => b.qualified), out = S.beans.filter(b => !b.qualified);
    const hexGroups = groupByScore(qs.map(b => b.pid), pid => { const b = bean(pid); return b.elim ? b.elimAt : 1e9; });
    const raceGroups = groupByScore(out.map(b => b.pid), pid => Math.round(bean(pid).best));
    S.placements = [...hexGroups, ...raceGroups];
    S.phase = 'hex-over'; S.t = 0;
  }

  return {
    _state: () => S,
    input(pid, s) { const b = bean(pid); if (b && b.online) b.in = s; },
    event() {},
    setConnected(pid, v) { const b = bean(pid); if (b) { b.online = v; if (!v) b.in = NO_INPUT; } },
    step(dt) {
      S.t += dt;
      switch (S.phase) {
        case 'race-count': if (S.t >= COUNTDOWN) { S.phase = 'race'; S.t = 0; } break;
        case 'race': raceStep(dt); break;
        case 'race-over': if (S.t >= RACE_OVER) startHex(); break;
        case 'hex-count': if (S.t >= COUNTDOWN) { S.phase = 'hex'; S.t = 0; } break;
        case 'hex': hexStep(dt); break;
        case 'hex-over': if (S.t >= HEX_OVER) S.done = true; break;
      }
    },
    snapshot() {
      const s = {
        ph: S.phase, t: round1(S.t), rt: Math.round(S.rt * 100) / 100, Q, fin: S.finished,
        beans: S.beans.map(b => ({ pid: b.pid, x: round1(b.x), y: round1(b.y), fx: round1(b.fx), fy: round1(b.fy),
          fa: b.falling > 0 ? 1 : 0, fn: b.fin ? 1 : 0, q: b.qualified ? 1 : 0, l: b.layer, d: b.drop > 0 ? 1 : 0, e: b.elim ? 1 : 0, dv: b.dive > 0 ? 1 : 0 })),
      };
      if (S.hex) {
        const H = S.hex, enc = L => Array.from(H.gone[L], (g, i) => (g ? '2' : H.touched[L][i] >= 0 ? '1' : '0')).join('');
        s.rings = H.rings; s.tiles = [enc(0), enc(1)];
      }
      if (S.phase === 'hex-over') s.win = S.winners;
      return s;
    },
    result: () => (S.done ? S.placements : null),
  };
}

// ---------------- view ----------------
function drawBean(ctx, x, y, r, p, opts) {
  drawBlob(ctx, { x, y, r, color: p.color, name: opts.name === false ? '' : p.name, me: opts.me, dx: opts.fx, dy: opts.fy, alpha: opts.alpha ?? 1, squash: opts.squash ?? -0.14, crown: opts.crown });
}

function createView({ el, me, players, isScreen }) {
  const buf = new SnapBuffer();
  const info = pid => players.find(p => p.pid === pid);
  let raw = null, hexCache = null;
  const loop = createRenderLoop(el, (ctx, w, h, now) => {
    const s = buf.get(); if (!s || !raw) return;
    const big = clamp(Math.min(w, h) * 0.16, 30, 92);
    const meB = s.beans.find(b => b.pid === me), meRaw = raw.beans.find(b => b.pid === me);
    if (raw.ph.startsWith('race')) drawRace(ctx, w, h, now, s, meB, meRaw);
    else drawHex(ctx, w, h, now, s);
    // Banners
    if (raw.ph === 'race-count') banner(ctx, w, h, String(Math.max(1, Math.ceil(COUNTDOWN - s.t))), { size: big * 1.2, color: '#ffc21a', sub: `Round 1: the race · top ${raw.Q} go through` });
    else if (raw.ph === 'race' && s.t < 0.7) banner(ctx, w, h, 'GO!', { size: big * 1.2, color: '#22b573' });
    else if (raw.ph === 'race' && meRaw?.fn) banner(ctx, w, h, 'QUALIFIED!', { size: big * 0.7, color: '#22b573', y: h * 0.3 });
    else if (raw.ph === 'race-over') {
      if (meRaw) banner(ctx, w, h, meRaw.q ? 'QUALIFIED!' : 'ELIMINATED', { size: big * 0.7, color: meRaw.q ? '#22b573' : '#ff3b4e', sub: 'Next: Hex-A-Gone' });
      else banner(ctx, w, h, 'Race over!', { size: big * 0.8, color: '#ffc21a', sub: `${raw.beans.filter(b => b.q).length} through to Hex-A-Gone` });
    } else if (raw.ph === 'hex-count') banner(ctx, w, h, String(Math.max(1, Math.ceil(COUNTDOWN - s.t))), { size: big * 1.2, color: '#ffc21a', sub: 'Final: Hex-A-Gone · keep moving!' });
    else if (raw.ph === 'hex' && s.t < 0.7) banner(ctx, w, h, 'GO!', { size: big * 1.2, color: '#22b573' });
    else if (raw.ph === 'hex' && meRaw?.e) banner(ctx, w, h, 'ELIMINATED', { size: big * 0.6, color: '#ff3b4e', y: h * 0.22 });
    else if (raw.ph === 'hex-over') {
      const ws = (raw.win || []).map(info).filter(Boolean);
      banner(ctx, w, h, ws.length === 1 ? `${ws[0].name} wins the crown!` : ws.length ? 'Shared crown!' : 'Everyone fell!', { size: big * 0.55, color: '#ffc21a', y: h * 0.3 });
    }
  });

  function drawRace(ctx, w, h, now, s, meB, meRaw) {
    ctx.fillStyle = '#ff6fb5'; ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / (COURSE_W + 40), isScreen ? h / 900 : 10);
    const viewH = h / scale;
    // Follow me while I'm racing; otherwise follow the leading bean still on the course.
    let focus = meB && !meRaw?.fn ? meB : null;
    if (!focus) {
      const racing = s.beans.filter((b, i) => !raw.beans[i].fn);
      focus = racing.sort((a, b) => a.y - b.y)[0] || s.beans[0];
    }
    const camY = clamp(focus.y - viewH * 0.62, 0, Math.max(0, COURSE.length - viewH));
    const ox = (w - COURSE_W * scale) / 2;
    const X = x => ox + x * scale, Y = y => (y - camY) * scale;
    // slime ripples
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 14; i++) { const yy = ((i * 97 + now / 30) % (h + 40)) - 20; ctx.beginPath(); ctx.ellipse((i * 131) % w, yy, 30, 8, 0, 0, 7); ctx.fill(); }
    for (const sec of COURSE.sections) {
      if (Y(sec.y1) < 0 || Y(sec.y0) > h) continue;
      ctx.fillStyle = sec.color; ctx.fillRect(X(0), Y(sec.y0), COURSE_W * scale, (sec.y1 - sec.y0) * scale);
      ctx.fillStyle = 'rgba(0,0,0,.035)';
      for (let yy = sec.y0; yy < sec.y1; yy += 40) ctx.fillRect(X(0), Y(yy), COURSE_W * scale, 20 * scale);
    }
    // gaps show the slime underneath
    for (const v of COURSE.voids) {
      if (Y(v.y + v.h) < 0 || Y(v.y) > h) continue;
      ctx.fillStyle = '#ff6fb5'; ctx.fillRect(X(v.x), Y(v.y), v.w * scale, v.h * scale);
      ctx.strokeStyle = '#d43d8c'; ctx.lineWidth = 3; ctx.strokeRect(X(v.x) + 1.5, Y(v.y) + 1.5, v.w * scale - 3, v.h * scale - 3);
    }
    // finish line checkers + checkpoints
    const cs = 20 * scale;
    for (let i = 0; i < COURSE_W / 20; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#1d1d2c' : '#fff'; ctx.fillRect(X(i * 20), Y(COURSE.finishY - 40 + j * 20), cs + 0.5, cs + 0.5);
    }
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(29,29,44,.35)'; ctx.lineWidth = 3;
    for (const cy of COURSE.checkpoints.slice(1)) { ctx.beginPath(); ctx.moveTo(X(0), Y(cy)); ctx.lineTo(X(COURSE_W), Y(cy)); ctx.stroke(); }
    ctx.setLineDash([]);
    // rails
    ctx.fillStyle = '#ffc21a'; ctx.fillRect(X(0) - 8, Y(0), 8, COURSE.length * scale); ctx.fillRect(X(COURSE_W), Y(0), 8, COURSE.length * scale);
    const t = s.rt;
    for (const bar of COURSE.bars) {
      const [x1, y1, x2, y2] = barEnds(bar, t);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1d1d2c'; ctx.lineWidth = 22 * scale; ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke();
      ctx.strokeStyle = '#ff3b4e'; ctx.lineWidth = 16 * scale; ctx.stroke();
      ctx.fillStyle = '#ffc21a'; ctx.beginPath(); ctx.arc(X(bar.cx), Y(bar.cy), 16 * scale, 0, 7); ctx.fill();
    }
    for (const p of COURSE.pushers) {
      const cx = pusherX(p, t);
      ctx.fillStyle = '#2f8cff'; ctx.strokeStyle = '#1b5fc4'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(X(cx - p.w / 2), Y(p.y - p.h / 2), p.w * scale, p.h * scale, 8 * scale); ctx.fill(); ctx.stroke();
    }
    for (const u of COURSE.bumpers) {
      ctx.fillStyle = '#a45cff'; ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), u.r * scale, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * scale; ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), u.r * scale * 0.62, 0, 7); ctx.stroke();
    }
    const order = s.beans.map((b, i) => [b, raw.beans[i]]).sort((a, b) => a[0].y - b[0].y);
    for (const [b, r] of order) {
      const p = info(b.pid); if (!p) continue;
      const wob = Math.sin(now / 90 + b.x * 0.05) * 0.04;
      drawBean(ctx, X(b.x), Y(b.y), BEAN_R * scale * (r.fa ? 0.6 : 1), p, { me: b.pid === me, fx: b.fx, fy: b.fy, alpha: r.fa ? 0.5 : 1, squash: r.dv ? 0.2 : -0.14 + wob });
    }
    // HUD
    ctx.save(); ctx.font = '800 14px Outfit, system-ui'; ctx.textBaseline = 'middle';
    const label = `Qualified ${raw.fin}/${raw.Q}`, left = Math.max(0, Math.ceil(RACE_LIMIT - s.rt));
    ctx.fillStyle = 'rgba(29,29,44,.8)'; ctx.beginPath(); ctx.roundRect(10, 8, ctx.measureText(label).width + 18, 26, 13); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, 19, 21);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(29,29,44,.8)'; ctx.beginPath(); ctx.roundRect(w - 70, 8, 60, 26, 13); ctx.fill();
    ctx.fillStyle = left <= 15 ? '#ff6f7d' : '#fff'; ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, w - 18, 21);
    ctx.restore();
  }

  function drawHex(ctx, w, h, now, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a1b5e'); bg.addColorStop(1, '#ff6fb5');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (!raw.tiles) return;
    if (!hexCache || hexCache.rings !== raw.rings) hexCache = { rings: raw.rings, tiles: hexTiles(raw.rings) };
    const span = HEX * 1.5 * raw.rings + HEX * 2;
    let f;
    const meB = s.beans.find(b => b.pid === me && raw.beans.find(r => r.pid === me)?.q);
    if (isScreen || !meB) f = fitWorld(w, h, span * 2, span * 2, 6), f.cx = span, f.cy = span;
    else { const sc = Math.min(w / 460, h / 460); f = { scale: sc, ox: w / 2 - (meB.x + span) * sc, oy: h / 2 - (meB.y + span) * sc }; }
    const X = x => f.ox + (x + span) * f.scale, Y = y => f.oy + (y + span) * f.scale, k = f.scale;
    const hexPath = (cx, cy, rr) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); };
    const layerColors = [['#ffe14d', '#fff7c2'], ['#4dd6ff', '#c8f3ff']];
    const beans = s.beans.map((b, i) => [b, raw.beans[i]]).filter(([, r]) => r.q && !r.e);
    for (let L = 1; L >= 0; L--) {
      const st = raw.tiles[L], off = L === 1 ? 26 * k : 0;
      hexCache.tiles.forEach((tile, i) => {
        const c = st[i]; if (c === '2') return;
        const flash = c === '1' && Math.floor(now / 90) % 2;
        hexPath(X(tile.x), Y(tile.y) + off, HEX * k * 0.94);
        ctx.fillStyle = flash ? layerColors[L][1] : layerColors[L][0]; ctx.fill();
        ctx.strokeStyle = L ? '#1a8fb3' : '#c79a00'; ctx.lineWidth = Math.max(1, 2 * k); ctx.stroke();
      });
      for (const [b, r] of beans) {
        if (r.l !== L) continue;
        const p = info(b.pid); if (!p) continue;
        drawBean(ctx, X(b.x), Y(b.y) + off + (r.d ? 18 * k : 0), BEAN_R * k * (r.d ? 0.8 : 1) * (L ? 0.9 : 1), p, { me: b.pid === me, fx: b.fx, fy: b.fy, alpha: r.d ? 0.6 : 1, crown: raw.ph === 'hex-over' && raw.win?.includes(b.pid) });
      }
    }
    const left = raw.beans.filter(b => b.q && !b.e).length;
    ctx.save(); ctx.font = '800 14px Outfit, system-ui'; ctx.textBaseline = 'middle';
    const label = `${left} left`;
    ctx.fillStyle = 'rgba(29,29,44,.8)'; ctx.beginPath(); ctx.roundRect(10, 8, ctx.measureText(label).width + 18, 26, 13); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, 19, 21); ctx.restore();
  }

  return {
    snapshot(s) { raw = s; buf.push(s); },
    event() {},
    destroy: () => loop.destroy(),
  };
}

export default {
  id: 'fallguys', name: 'Fall Guys', color: '#ff5fb7',
  blurb: 'Race the obstacle course, then survive Hex-A-Gone for the crown.',
  controls: { stick: true, buttons: ['Dive'] },
  createHost, createView,
};
