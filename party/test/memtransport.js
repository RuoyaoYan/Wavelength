// In-memory stand-in for net.js so the session protocol runs under node --test.
export function createMemNet() {
  const hosts = new Map();
  let dropU = false, nextId = 1;
  const end = () => ({ r: [], u: [], c: [], closed: false });
  function pair() {
    const a = end(), b = end();
    const mk = (me, other) => ({
      id: 'c' + nextId++,
      sendR(msg) { if (!me.closed) { const m = JSON.parse(JSON.stringify(msg)); queueMicrotask(() => !other.closed && other.r.forEach(f => f(m))); } },
      sendU(msg) { if (!me.closed && !dropU) { const m = JSON.parse(JSON.stringify(msg)); queueMicrotask(() => !other.closed && other.u.forEach(f => f(m))); } },
      onR(f) { me.r.push(f); }, onU(f) { me.u.push(f); }, onClose(f) { me.c.push(f); },
      close() { if (me.closed) return; me.closed = other.closed = true; queueMicrotask(() => { me.c.forEach(f => f()); other.c.forEach(f => f()); }); },
    });
    return [mk(a, b), mk(b, a)];
  }
  return {
    host(code) {
      const t = { code, cbs: [], onConnection(f) { t.cbs.push(f); }, close() { hosts.delete(code); } };
      hosts.set(code, t);
      return t;
    },
    async connect(code) {
      const h = hosts.get(code);
      if (!h) throw new Error('timeout');
      const [client, server] = pair();
      h.cbs.forEach(f => f(server));
      return client;
    },
    dropU(v) { dropU = v; },
  };
}
