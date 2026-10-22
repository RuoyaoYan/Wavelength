// Helpers every game shares: deterministic randomness, input edges, physics, and
// canvas drawing. No DOM access at import time, so game hosts run under node --test.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Button presses travel as running counts so a dropped packet never loses one.
export const pressed = (prev, cur, label) => (cur?.b?.[label] || 0) > (prev?.b?.[label] || 0);

export const NO_INPUT = Object.freeze({ x: 0, y: 0, b: {} });

// Groups ids by a numeric score, best (highest) first; equal scores share a group.
export function groupByScore(ids, score) {
  const sorted = ids.slice().sort((a, b) => score(b) - score(a));
  const out = [];
  for (const id of sorted) {
    const last = out.at(-1);
    if (last && score(last[0]) === score(id)) last.push(id); else out.push([id]);
  }
  return out;
}

export function lerpSnap(a, b, t) {
  if (a == null) return b;
  if (typeof b === 'number' && typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(b)) return b.map((v, i) => (Array.isArray(a) ? lerpSnap(a[i], v, t) : v));
  if (b && typeof b === 'object') {
    const o = {};
    for (const k in b) o[k] = a && typeof a === 'object' && !(k === 'id' || k === 'pid') ? lerpSnap(a[k], b[k], t) : b[k];
    return o;
  }
  return b;
}

// Equal-mass circle bounce: push apart, then swap the closing velocity along the normal.
export function circleCollide(p, q, restitution = 0.8) {
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = p.r + q.r;
  if (d >= min) return false;
  const nx = d ? dx / d : 1, ny = d ? dy / d : 0, push = (min - d) / 2;
  p.x -= nx * push; p.y -= ny * push; q.x += nx * push; q.y += ny * push;
  const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (rel < 0) {
    const j = -(1 + restitution) * rel / 2;
    p.vx -= j * nx; p.vy -= j * ny; q.vx += j * nx; q.vy += j * ny;
  }
  return true;
}

export const round1 = v => Math.round(v * 10) / 10;

// ---- browser-only helpers below (called by views, never at import) ----

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const m = v => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

// Keeps the last two snapshots and hands back a smoothed one for the current frame.
export class SnapBuffer {
  constructor(period = 50) { this.prev = null; this.cur = null; this.at = 0; this.period = period; }
  push(s) { this.prev = this.cur; this.cur = s; this.at = performance.now(); }
  get() {
    if (!this.cur) return null;
    return lerpSnap(this.prev, this.cur, clamp((performance.now() - this.at) / this.period, 0, 1));
  }
}

// A canvas that fills `el` and redraws every frame. draw(ctx, w, h, now) works in CSS pixels.
export function createRenderLoop(el, draw) {
  const canvas = document.createElement('canvas');
  canvas.className = 'game-canvas';
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0, alive = true;
  const frame = now => {
    if (!alive) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, now);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { canvas, ctx, destroy() { alive = false; cancelAnimationFrame(raf); canvas.remove(); } };
}

// Scale/offset that fits a world rectangle inside w×h (contain), centred.
export function fitWorld(w, h, worldW, worldH, pad = 8) {
  const scale = Math.min((w - pad * 2) / worldW, (h - pad * 2) / worldH);
  return { scale, ox: (w - worldW * scale) / 2, oy: (h - worldH * scale) / 2 };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

// A chunky round character with eyes that look where it's heading and a name tag.
export function drawBlob(ctx, { x, y, r, color, name, me = false, dx = 0, dy = 1, alpha = 1, squash = 0, crown = false }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  if (me) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.beginPath(); ctx.arc(x, y, r * 1.28, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(x, y);
  ctx.scale(1 + squash, 1 - squash);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(color, 1.35)); g.addColorStop(1, color);
  ctx.fillStyle = g; ctx.strokeStyle = shade(color, 0.55); ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const len = Math.hypot(dx, dy) || 1, lx = dx / len, ly = dy / len;
  for (const s of [-1, 1]) {
    const ex = s * r * 0.34 + lx * r * 0.18, ey = -r * 0.12 + ly * r * 0.18;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.24, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d1d2c'; ctx.beginPath(); ctx.arc(ex + lx * r * 0.09, ey + ly * r * 0.11, r * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (crown) drawCrown(ctx, x, y - r * 1.25, r * 0.8);
  if (name) nameTag(ctx, x, y - r - (crown ? r * 0.9 : 0) - 8, name, me);
}

export function nameTag(ctx, x, y, name, me) {
  ctx.save();
  ctx.font = '800 12px Outfit, system-ui, sans-serif';
  const w = ctx.measureText(name).width + 12;
  ctx.fillStyle = me ? '#1d1d2c' : 'rgba(255,255,255,.92)';
  roundRect(ctx, x - w / 2, y - 16, w, 17, 9); ctx.fill();
  ctx.fillStyle = me ? '#fff' : '#1d1d2c';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y - 7.5);
  ctx.restore();
}

export function drawCrown(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = '#ffc21a'; ctx.strokeStyle = '#b07d00'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.45); ctx.lineTo(x - s, y - s * 0.35); ctx.lineTo(x - s * 0.5, y + s * 0.05);
  ctx.lineTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.5, y + s * 0.05); ctx.lineTo(x + s, y - s * 0.35);
  ctx.lineTo(x + s, y + s * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Big centred banner text with a dark outline, for countdowns and "Round 2!" moments.
export function banner(ctx, w, h, text, { size = 64, color = '#fff', y = h * 0.4, sub = '' } = {}) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${size}px Outfit, system-ui, sans-serif`;
  ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#1d1d2c';
  ctx.strokeText(text, w / 2, y); ctx.fillStyle = color; ctx.fillText(text, w / 2, y);
  if (sub) {
    ctx.font = `800 ${Math.round(size * 0.32)}px Outfit, system-ui, sans-serif`;
    ctx.lineWidth = size * 0.08; ctx.strokeText(sub, w / 2, y + size * 0.75); ctx.fillText(sub, w / 2, y + size * 0.75);
  }
  ctx.restore();
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
