// Turf War: run around painting the floor your colour. Up to 3 players it's every ink
// for themselves; from 4 it's Orange vs Blue. Most floor covered after 90 s wins.
import { createRenderLoop, SnapBuffer, drawBlob, fitWorld, banner, circleCollide, groupByScore, shuffle, NO_INPUT, round1, clamp } from './common.js';

export const GRID_W = 64, GRID_H = 40, CELL = 10, COUNTDOWN = 3, MATCH = 90, OVER = 3;
const W = GRID_W * CELL, H = GRID_H * CELL;
const R = 9, SPEED = 165, SPLAT_R = 4, SPLAT_CD = 4, FULL_EVERY = 2;
const TEAM_COLORS = ['#ff7a1a', '#3b5bff'], TEAM_NAMES = ['Orange', 'Blue'];

export function makeTeams(pids, rng) {
  if (pids.length <= 3) return pids.map(p => [p]);
  const s = shuffle(pids, rng), half = Math.floor(pids.length / 2);
  return [s.slice(0, half), s.slice(half)];
}

// When teams are uneven the short-handed side gets a fatter brush to keep it fair.
export function brushRadius(teams, i) {
  const min = Math.min(...teams.map(t => t.length)), max = Math.max(...teams.map(t => t.length));
  return min !== max && teams[i].length === min ? 2.2 : 1.6;
}

const toB64 = u8 => { let s = ''; for (const v of u8) s += String.fromCharCode(v); return btoa(s); };
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

function createHost({ players, rng }) {
  const pids = players.map(p => p.pid);
  const teams = makeTeams(pids, rng);
  const teamOf = {};
  teams.forEach((t, i) => t.forEach(pid => { teamOf[pid] = i; }));
  const S = {
    phase: 'count', t: 0, teams, teamOf, grid: new Uint8Array(GRID_W * GRID_H), dirty: new Map(), sinceFull: FULL_EVERY,
    ps: [], done: false,
  };
  // Spawns: two teams start on opposite walls; free-for-all starts around a ring.
  S.ps = players.map(p => {
    const ti = teamOf[p.pid];
    let x, y;
    if (teams.length === 2 && teams[0].length > 1) {
      const k = teams[ti].indexOf(p.pid), m = teams[ti].length;
      x = ti === 0 ? 50 : W - 50; y = H * (k + 1) / (m + 1);
    } else {
      const a = (ti / teams.length) * Math.PI * 2 + Math.PI;
      x = W / 2 + Math.cos(a) * W * 0.36; y = H / 2 + Math.sin(a) * H * 0.34;
    }
    return { pid: p.pid, team: ti, x, y, vx: 0, vy: 0, r: R, fx: 0, fy: 1, cd: 0, in: NO_INPUT, splatSeen: 0, online: true, brush: brushRadius(teams, ti) };
  });

  function paint(x, y, radius, team) {
    const gx = x / CELL, gy = y / CELL, v = team + 1;
    for (let cy = Math.max(0, Math.floor(gy - radius)); cy <= Math.min(GRID_H - 1, Math.ceil(gy - 0.5 + radius)); cy++)
      for (let cx = Math.max(0, Math.floor(gx - radius)); cx <= Math.min(GRID_W - 1, Math.ceil(gx - 0.5 + radius)); cx++) {
        const dx = cx + 0.5 - gx, dy = cy + 0.5 - gy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = cy * GRID_W + cx;
        if (S.grid[i] !== v) { S.grid[i] = v; S.dirty.set(i, v); }
      }
  }
  const counts = () => { const c = teams.map(() => 0); for (const v of S.grid) if (v) c[v - 1]++; return c; };
  const p = pid => S.ps.find(q => q.pid === pid);

  return {
    _state: () => S,
    input(pid, s) { const q = p(pid); if (q && q.online) q.in = s; },
    event() {},
    setConnected(pid, v) { const q = p(pid); if (q) { q.online = v; if (!v) q.in = NO_INPUT; } },
    step(dt) {
      S.t += dt; S.sinceFull += dt;
      if (S.phase === 'count') { if (S.t >= COUNTDOWN) { S.phase = 'play'; S.t = 0; } return; }
      if (S.phase === 'over') { if (S.t >= OVER) S.done = true; return; }
      if (S.t >= MATCH) { S.phase = 'over'; S.t = 0; return; }
      for (const q of S.ps) {
        q.cd = Math.max(0, q.cd - dt);
        const ix = q.in.x || 0, iy = q.in.y || 0, m = Math.hypot(ix, iy);
        if (m > 0.01) { q.fx = ix / m; q.fy = iy / m; }
        const k = Math.min(1, 10 * dt);
        q.vx += (ix * SPEED - q.vx) * k; q.vy += (iy * SPEED - q.vy) * k;
        q.x = clamp(q.x + q.vx * dt, R, W - R); q.y = clamp(q.y + q.vy * dt, R, H - R);
        const presses = q.in.b?.Splat || 0;
        if (presses > q.splatSeen) {
          q.splatSeen = presses;
          if (q.cd <= 0) { paint(q.x, q.y, SPLAT_R, q.team); q.cd = SPLAT_CD; }
        }
      }
      for (let i = 0; i < S.ps.length; i++) for (let j = i + 1; j < S.ps.length; j++) circleCollide(S.ps[i], S.ps[j], 0.6);
      for (const q of S.ps) paint(q.x, q.y, q.brush, q.team);
    },
    snapshot() {
      const s = {
        phase: S.phase, t: round1(S.t), counts: counts(),
        ps: S.ps.map(q => ({ pid: q.pid, x: round1(q.x), y: round1(q.y), fx: round1(q.fx), fy: round1(q.fy), cd: Math.round(q.cd * 10) / 10 })),
        d: [...S.dirty],
      };
      S.dirty.clear();
      if (S.sinceFull >= FULL_EVERY) { s.full = toB64(S.grid); s.teams = teams; S.sinceFull = 0; }
      return s;
    },
    result() {
      if (!S.done) return null;
      const c = counts();
      return groupByScore(pids, pid => c[teamOf[pid]]);
    },
  };
}

function createView({ el, me, players }) {
  const n = players.length;
  const buf = new SnapBuffer();
  const grid = new Uint8Array(GRID_W * GRID_H);
  const ink = document.createElement('canvas');
  ink.width = GRID_W; ink.height = GRID_H;
  const ictx = ink.getContext('2d'), img = ictx.createImageData(GRID_W, GRID_H);
  let teamColors = null, teamNames = null, teamOfPid = {}, inkDirty = true;
  const info = pid => players.find(p => p.pid === pid);
  const rgb = hex => { const v = parseInt(hex.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

  function setTeams(teams) {
    teams.forEach((t, i) => t.forEach(pid => { teamOfPid[pid] = i; }));
    if (teams.length === 2 && n >= 4) { teamColors = TEAM_COLORS; teamNames = TEAM_NAMES; }
    else { teamColors = teams.map(t => info(t[0]).color); teamNames = teams.map(t => info(t[0]).name); }
  }
  function redrawInk() {
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i], o = i * 4;
      if (v && teamColors) { const [r, g, b] = rgb(teamColors[v - 1]); img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; }
      else img.data[o + 3] = 0;
    }
    ictx.putImageData(img, 0, 0);
    inkDirty = false;
  }

  const loop = createRenderLoop(el, (ctx, w, h) => {
    ctx.fillStyle = '#2b2d42'; ctx.fillRect(0, 0, w, h);
    const s = buf.get(); if (!s || !teamColors) return;
    const top = 40, f = fitWorld(w, h - top, W, H, 8);
    f.oy += top;
    const X = x => f.ox + x * f.scale, Y = y => f.oy + y * f.scale;
    // Floor tiles, then the ink (smoothed so it looks splattered rather than pixelly).
    ctx.fillStyle = '#e9ecf3'; ctx.beginPath(); ctx.roundRect(X(0), Y(0), W * f.scale, H * f.scale, 12); ctx.fill();
    ctx.strokeStyle = '#d6dbe6'; ctx.lineWidth = 1;
    for (let gx = 4; gx < GRID_W; gx += 4) { ctx.beginPath(); ctx.moveTo(X(gx * CELL), Y(0)); ctx.lineTo(X(gx * CELL), Y(H)); ctx.stroke(); }
    for (let gy = 4; gy < GRID_H; gy += 4) { ctx.beginPath(); ctx.moveTo(X(0), Y(gy * CELL)); ctx.lineTo(X(W), Y(gy * CELL)); ctx.stroke(); }
    if (inkDirty) redrawInk();
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ink, X(0), Y(0), W * f.scale, H * f.scale); ctx.restore();
    for (const q of s.ps.slice().sort((a, b) => a.y - b.y)) {
      const p = info(q.pid); if (!p) continue;
      drawBlob(ctx, { x: X(q.x), y: Y(q.y), r: R * f.scale * 1.15, color: teamColors[teamOfPid[q.pid]], name: p.name, me: q.pid === me, dx: q.fx, dy: q.fy });
    }
    // Coverage bar + clock.
    const total = GRID_W * GRID_H, bw = Math.min(w - 120, 560), bx = (w - bw) / 2;
    ctx.fillStyle = '#44475e'; ctx.beginPath(); ctx.roundRect(bx, 10, bw, 20, 10); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(bx, 10, bw, 20, 10); ctx.clip();
    let x = bx;
    s.counts.forEach((c, i) => { const ww = bw * c / total; ctx.fillStyle = teamColors[i]; ctx.fillRect(x, 10, ww, 20); x += ww; });
    ctx.restore();
    const left = s.phase === 'play' ? Math.max(0, Math.ceil(MATCH - s.t)) : s.phase === 'count' ? MATCH : 0;
    ctx.fillStyle = left <= 10 && s.phase === 'play' ? '#ff3b4e' : '#fff';
    ctx.font = '900 18px Outfit, system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, w - 10, 21);
    const big = clamp(Math.min(w, h) * 0.16, 32, 90);
    if (s.phase === 'count') banner(ctx, w, h, String(Math.max(1, Math.ceil(COUNTDOWN - s.t))), { size: big * 1.2, color: '#ffc21a', sub: 'Paint the floor your colour!' });
    else if (s.phase === 'play' && s.t < 0.7) banner(ctx, w, h, 'GO!', { size: big * 1.2, color: '#22b573' });
    else if (s.phase === 'play' && left <= 10) banner(ctx, w, h, String(left), { size: big * 0.8, color: '#ff3b4e', y: h * 0.25 });
    else if (s.phase === 'over') {
      const best = s.counts.indexOf(Math.max(...s.counts));
      const tie = s.counts.filter(c => c === s.counts[best]).length > 1;
      banner(ctx, w, h, tie ? 'It\'s a tie!' : `${teamNames[best]} wins!`, { size: big * 0.75, color: tie ? '#fff' : teamColors[best],
        sub: s.counts.map((c, i) => `${teamNames[i]} ${Math.round(100 * c / total)}%`).join('  ·  ') });
    }
  });

  return {
    snapshot(s) {
      if (!teamColors && s.teams) setTeams(s.teams);
      if (s.full) { grid.set(fromB64(s.full)); inkDirty = true; }
      for (const [i, v] of s.d || []) { grid[i] = v; inkDirty = true; }
      buf.push({ phase: s.phase, t: s.t, counts: s.counts, ps: s.ps });
    },
    event() {},
    destroy() { loop.destroy(); },
  };
}

export default {
  id: 'turf', name: 'Turf War', color: '#7b3cff',
  blurb: 'Paint the most floor in 90 seconds. 4+ players: Orange vs Blue.',
  controls: { stick: true, buttons: ['Splat'] },
  createHost, createView,
};
