// Every game in the collection, in lobby order.
import { createRenderLoop, SnapBuffer, drawBlob, fitWorld, groupByScore, NO_INPUT } from './common.js';

// Temporary shell check: dots move with the stick, rightmost after 20 s wins.
const debug = {
  id: 'debug', name: 'Debug Dots', blurb: 'Move right. Rightmost dot after 20 s wins.', color: '#888',
  controls: { stick: true, buttons: ['Go'] },
  createHost({ players }) {
    const ps = players.map((p, i) => ({ ...p, x: 50, y: 40 + i * 30, in: NO_INPUT }));
    let t = 0;
    return {
      input(pid, s) { const p = ps.find(q => q.pid === pid); if (p) p.in = s; },
      event() {},
      step(dt) { t += dt; for (const p of ps) { p.x = Math.max(0, Math.min(400, p.x + p.in.x * 120 * dt)); p.y = Math.max(0, Math.min(340, p.y + p.in.y * 120 * dt)); } },
      snapshot: () => ({ t, ps: ps.map(p => ({ pid: p.pid, x: p.x, y: p.y })) }),
      result: () => (t >= 20 ? groupByScore(ps.map(p => p.pid), id => Math.round(ps.find(p => p.pid === id).x)) : null),
    };
  },
  createView({ el, me, players }) {
    const buf = new SnapBuffer();
    const loop = createRenderLoop(el, (ctx, w, h) => {
      const s = buf.get(); if (!s) return;
      const f = fitWorld(w, h, 400, 340);
      ctx.fillStyle = '#dfe9ff'; ctx.fillRect(f.ox, f.oy, 400 * f.scale, 340 * f.scale);
      for (const p of s.ps) {
        const info = players.find(q => q.pid === p.pid);
        drawBlob(ctx, { x: f.ox + p.x * f.scale, y: f.oy + p.y * f.scale, r: 12, color: info.color, name: info.name, me: p.pid === me });
      }
      ctx.fillStyle = '#1d1d2c'; ctx.font = '800 16px Outfit'; ctx.fillText(`${Math.max(0, 20 - s.t).toFixed(0)} s`, 12, 22);
    });
    return { snapshot: s => buf.push(s), event() {}, destroy: () => loop.destroy() };
  },
};

export const GAMES = [debug];
