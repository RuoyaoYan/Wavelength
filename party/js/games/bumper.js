// Bumper Balls: bouncy balls on a floating platform that keeps shrinking.
// Ram people off the edge; last one on wins the round; best of three.
import { createRenderLoop, SnapBuffer, drawBlob, fitWorld, banner, circleCollide, groupByScore, NO_INPUT, shade, round1, clamp } from './common.js';

export const COUNTDOWN = 3, SHRINK_TIME = 60, COLLAPSE_TIME = 30, ROUND_OVER = 3.2, ROUNDS = 3, WINS_NEEDED = 2;
const BALL_R = 18, ACC = 1100, FRICTION = 1.8, MAX_SPEED = 230, DASH = 480, DASH_CD = 1.2, BOUNCE = 1.25;

export const startRadius = n => 140 + 22 * n;
// Shrinks to 35% over SHRINK_TIME, then keeps going to nothing so every round ends.
export function platformRadius(R0, t) {
  if (t <= SHRINK_TIME) return R0 * (1 - 0.65 * t / SHRINK_TIME);
  return Math.max(0, 0.35 * R0 * (1 - (t - SHRINK_TIME) / COLLAPSE_TIME));
}

function createHost({ players }) {
  const n = players.length, R0 = startRadius(n);
  const S = {
    phase: 'count', round: 1, t: 0, R: R0, R0, winner: null,
    wins: Object.fromEntries(players.map(p => [p.pid, 0])),
    survived: Object.fromEntries(players.map(p => [p.pid, 0])),
    balls: players.map(p => ({ pid: p.pid, x: 0, y: 0, vx: 0, vy: 0, r: BALL_R, alive: true, fall: 0, cd: 0, fx: 0, fy: 1, in: NO_INPUT, dashSeen: 0, online: true })),
    done: false,
  };
  function place() {
    S.balls.forEach((b, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      Object.assign(b, { x: Math.cos(a) * R0 * 0.6, y: Math.sin(a) * R0 * 0.6, vx: 0, vy: 0, alive: true, fall: 0, cd: 0, fx: -Math.cos(a), fy: -Math.sin(a) });
    });
    S.R = R0; S.t = 0; S.phase = 'count'; S.winner = null;
  }
  place();
  const ball = pid => S.balls.find(b => b.pid === pid);

  function endRound() {
    const alive = S.balls.filter(b => b.alive);
    S.winner = alive.length === 1 ? alive[0].pid : null;
    if (S.winner) S.wins[S.winner]++;
    S.phase = 'over'; S.t = 0;
  }

  return {
    _state: () => S,
    input(pid, s) { const b = ball(pid); if (b && b.online) b.in = s; },
    event() {},
    setConnected(pid, v) { const b = ball(pid); if (b) { b.online = v; if (!v) b.in = NO_INPUT; } },
    step(dt) {
      S.t += dt;
      if (S.phase === 'count') { if (S.t >= COUNTDOWN) { S.phase = 'play'; S.t = 0; } return; }
      if (S.phase === 'over') {
        for (const b of S.balls) if (!b.alive) { b.fall += dt; b.x += b.vx * dt * 0.5; b.y += b.vy * dt * 0.5; }
        if (S.t < ROUND_OVER) return;
        if (Object.values(S.wins).some(w => w >= WINS_NEEDED) || S.round >= ROUNDS) { S.phase = 'done'; S.done = true; return; }
        S.round++; place(); return;
      }
      if (S.phase !== 'play') return;
      S.R = platformRadius(R0, S.t);
      for (const b of S.balls) {
        if (!b.alive) { b.fall += dt; b.x += b.vx * dt * 0.5; b.y += b.vy * dt * 0.5; continue; }
        S.survived[b.pid] += dt;
        b.cd = Math.max(0, b.cd - dt);
        const ix = b.in.x || 0, iy = b.in.y || 0, mag = Math.hypot(ix, iy);
        if (mag > 0.01) { b.fx = ix / mag; b.fy = iy / mag; }
        const presses = b.in.b?.Dash || 0;
        if (presses < b.dashSeen) b.dashSeen = 0; // phone restarted its counter (rejoin)
        if (presses > b.dashSeen) {
          b.dashSeen = presses;
          if (b.cd <= 0) { b.vx += b.fx * DASH; b.vy += b.fy * DASH; b.cd = DASH_CD; }
        }
        b.vx += ix * ACC * dt; b.vy += iy * ACC * dt;
        const sp = Math.hypot(b.vx, b.vy);
        // Steering alone tops out at MAX_SPEED; dashes and bumps may go faster and bleed off.
        if (sp > MAX_SPEED && b.cd < DASH_CD - 0.25) { const k = Math.max(MAX_SPEED / sp, 1 - 3 * dt); b.vx *= k; b.vy *= k; }
        b.vx -= b.vx * FRICTION * dt; b.vy -= b.vy * FRICTION * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
      const live = S.balls.filter(b => b.alive);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) circleCollide(live[i], live[j], BOUNCE);
      for (const b of live) if (Math.hypot(b.x, b.y) > S.R) { b.alive = false; b.fall = 0; }
      if (S.balls.filter(b => b.alive).length <= (n > 1 ? 1 : 0)) endRound();
    },
    snapshot: () => ({
      phase: S.phase, round: S.round, t: round1(S.t), R: round1(S.R), R0, winner: S.winner, wins: { ...S.wins },
      balls: S.balls.map(b => ({ pid: b.pid, x: round1(b.x), y: round1(b.y), a: b.alive ? 1 : 0, f: round1(b.fall), cd: Math.round(b.cd * 10) / 10, fx: round1(b.fx), fy: round1(b.fy) })),
    }),
    result() {
      if (!S.done) return null;
      return groupByScore(players.map(p => p.pid), pid => S.wins[pid] * 1e6 + Math.round(S.survived[pid] * 10));
    },
  };
}

function createView({ el, me, players }) {
  const buf = new SnapBuffer();
  const info = pid => players.find(p => p.pid === pid);
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: (i * 0.37) % 1, y: 0.1 + ((i * 0.53) % 0.8), s: 0.6 + ((i * 0.29) % 0.7) }));
  const loop = createRenderLoop(el, (ctx, w, h, now) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5ec8ff'); sky.addColorStop(1, '#cdf0ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const c of clouds) {
      const x = ((c.x + now / 90000 * c.s) % 1.2 - 0.1) * w, y = c.y * h, s = 26 * c.s;
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.arc(x + s, y + 4, s * 0.8, 0, 7); ctx.arc(x - s, y + 6, s * 0.7, 0, 7); ctx.fill();
    }
    const s = buf.get(); if (!s) return;
    const span = s.R0 + 70, f = fitWorld(w, h, span * 2, span * 2, 6);
    const X = x => f.ox + (x + span) * f.scale, Y = y => f.oy + (y + span) * f.scale, k = f.scale;
    const R = s.R * k, cx = X(0), cy = Y(0);
    if (R > 1) {
      // Platform: a thick disc with candy stripes; the rim flashes red as it shrinks.
      ctx.fillStyle = '#8a5a2b';
      ctx.beginPath(); ctx.ellipse(cx, cy + 16 * k, R, R, 0, 0, Math.PI * 2); ctx.fill();
      const slices = 12;
      for (let i = 0; i < slices; i++) {
        ctx.fillStyle = i % 2 ? '#ffd23f' : '#fff6d8';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, (i / slices) * Math.PI * 2 + s.t * 0.05, ((i + 1) / slices) * Math.PI * 2 + s.t * 0.05); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#ff5fb7'; ctx.beginPath(); ctx.arc(cx, cy, Math.min(R, 26 * k), 0, Math.PI * 2); ctx.fill();
      const danger = s.phase === 'play' && s.R < s.R0 * 0.999;
      ctx.lineWidth = Math.max(3, 7 * k);
      ctx.strokeStyle = danger && Math.floor(now / 250) % 2 ? '#ff3b4e' : '#c47a00';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    }
    const order = s.balls.slice().sort((a, b) => a.y - b.y);
    for (const b of order) {
      const p = info(b.pid); if (!p) continue;
      if (!b.a && b.f > 1.2) continue;
      const shrink = b.a ? 1 : Math.max(0.05, 1 - b.f / 1.2);
      const r = BALL_R * k * shrink;
      if (b.pid === me && b.a && b.cd > 0) {
        ctx.strokeStyle = 'rgba(29,29,44,.35)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), r * 1.55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.cd / DASH_CD)); ctx.stroke();
      }
      drawBlob(ctx, { x: X(b.x), y: Y(b.y) + (b.a ? 0 : b.f * 40 * k), r, color: p.color, name: b.a ? p.name : '', me: b.pid === me, dx: b.fx, dy: b.fy, alpha: b.a ? 1 : shrink });
    }
    // Round + wins strip.
    ctx.save();
    ctx.font = '800 13px Outfit, system-ui'; ctx.textBaseline = 'middle';
    let x = 10;
    const label = `Round ${s.round}/${ROUNDS}`;
    ctx.fillStyle = 'rgba(29,29,44,.8)'; ctx.beginPath(); ctx.roundRect(x, 8, ctx.measureText(label).width + 16, 24, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, x + 8, 20); x += ctx.measureText(label).width + 24;
    for (const p of players) {
      const wn = s.wins[p.pid] || 0; if (!wn) continue;
      const t = `${p.name} ${'★'.repeat(wn)}`;
      const tw = ctx.measureText(t).width + 16;
      if (x + tw > w - 6) break;
      ctx.fillStyle = shade(p.color, 0.8); ctx.beginPath(); ctx.roundRect(x, 8, tw, 24, 12); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(t, x + 8, 20); x += tw + 6;
    }
    ctx.restore();
    const big = clamp(Math.min(w, h) * 0.18, 34, 96);
    if (s.phase === 'count') banner(ctx, w, h, String(Math.max(1, Math.ceil(COUNTDOWN - s.t))), { size: big * 1.2, color: '#ffc21a', sub: s.round === 1 ? 'Push everyone off!' : `Round ${s.round}` });
    else if (s.phase === 'play' && s.t < 0.7) banner(ctx, w, h, 'GO!', { size: big * 1.2, color: '#22b573' });
    else if (s.phase === 'over' || s.phase === 'done') {
      const wp = s.winner && info(s.winner);
      banner(ctx, w, h, wp ? `${wp.name} wins!` : 'Nobody survived!', { size: big * 0.7, color: wp ? wp.color : '#fff', sub: `Round ${s.round}` });
    }
  });
  return { snapshot: s => buf.push(s), event() {}, destroy: () => loop.destroy() };
}

export default {
  id: 'bumper', name: 'Bumper Balls', color: '#ff8a1f',
  blurb: 'Ram everyone off the shrinking platform. Best of 3.',
  controls: { stick: true, buttons: ['Dash'] },
  createHost, createView,
};
