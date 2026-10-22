// PeerJS adapter: turns a room code into the transport shape session.js expects.
// Each link is one PeerJS connection (reliable, ordered JSON) plus a raw negotiated
// WebRTC channel with no retransmits for snapshots and joystick input, where a stale
// packet is worse than a missing one. A heartbeat notices phones that went to sleep.
const PREFIX = 'wlparty-v1-';
const FAST_ID = 7;
const HEARTBEAT_MS = 2000, DEAD_MS = 9000;

function wrap(dc) {
  const r = [], u = [], c = [];
  let closed = false, lastSeen = Date.now(), fast = null;
  const conn = {
    id: dc.connectionId,
    sendR(msg) { if (!closed && dc.open) { try { dc.send(msg); } catch (_) {} } },
    sendU(msg) {
      if (closed) return;
      if (fast && fast.readyState === 'open') { try { fast.send(JSON.stringify(msg)); } catch (_) {} }
      else if (dc.open) dc.send({ _u: msg });
    },
    onR(f) { r.push(f); }, onU(f) { u.push(f); }, onClose(f) { c.push(f); },
    close() { shut(); },
  };
  function shut() {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    try { fast?.close(); } catch (_) {}
    try { dc.close(); } catch (_) {}
    c.forEach(f => f());
  }
  dc.on('data', msg => {
    lastSeen = Date.now();
    if (msg && msg._hb) return;
    if (msg && msg._u) return u.forEach(f => f(msg._u));
    r.forEach(f => f(msg));
  });
  dc.on('close', shut);
  // PeerJS reports per-message problems (e.g. message-too-big) as errors; they don't mean
  // the link is dead, so leave that call to the heartbeat instead of hanging up.
  dc.on('error', () => {});
  try {
    fast = dc.peerConnection.createDataChannel('fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    fast.onmessage = e => { lastSeen = Date.now(); try { const m = JSON.parse(e.data); u.forEach(f => f(m)); } catch (_) {} };
  } catch (_) { fast = null; }
  const hb = setInterval(() => {
    if (Date.now() - lastSeen > DEAD_MS) return shut();
    if (dc.open) dc.send({ _hb: 1 });
  }, HEARTBEAT_MS);
  return conn;
}

export function hostRoom(code) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0 });
    const cbs = [];
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ code, onConnection(f) { cbs.push(f); }, close() { peer.destroy(); } });
    });
    peer.on('connection', dc => {
      dc.on('open', () => { const conn = wrap(dc); cbs.forEach(f => f(conn)); });
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', err => {
      if (opened) return;
      peer.destroy();
      reject(err.type === 'unavailable-id' ? 'taken' : err.type || 'error');
    });
  });
}

export function connect(code, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let done = false;
    const fail = why => { if (done) return; done = true; clearTimeout(timer); peer.destroy(); reject(why); };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        const conn = wrap(dc);
        conn.onClose(() => setTimeout(() => peer.destroy(), 100));
        resolve(conn);
      });
      dc.on('error', () => fail('error'));
    });
    peer.on('error', err => fail(err.type === 'peer-unavailable' ? 'no-room' : 'error'));
  });
}
