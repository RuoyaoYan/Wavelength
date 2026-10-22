// The room protocol. The host owns the room and the running game; phones say hello,
// send joystick input (unreliable, latest wins) and game events (reliable), and draw
// whatever snapshots come back. Transports are injected so tests run without a network.
import { createRoom, addPlayer, setConnected, activePlayers, awardPlacements } from './room.js';

const STEP = 1 / 60;
const SNAP_EVERY = 3; // 60 Hz sim → 20 Hz snapshots
const noop = () => {};

export class HostSession {
  constructor({ transport, games, rng = Math.random }) {
    this.transport = transport;
    this.code = transport.code;
    this.games = games;
    this.rng = rng;
    this.room = createRoom();
    this.room.code = this.code;
    this.conns = new Map(); // pid → conn
    this.selfPid = null;
    this.game = null; this.gameId = null; this.gamePlayers = []; this.acc = 0; this.steps = 0;
    // Callbacks for the host's own screen, named like ClientSession's so one view path serves both.
    this.onRoom = noop; this.onStart = noop; this.onSnap = noop; this.onEvent = noop; this.onEnd = noop;
    transport.onConnection(conn => this.accept(conn));
  }

  accept(conn) {
    let pid = null;
    conn.onR(msg => {
      if (msg.t === 'hello' && !pid) {
        const res = addPlayer(this.room, { pid: msg.pid, name: msg.name });
        if (!res.ok) { conn.sendR({ t: 'reject', reason: res.reason }); setTimeout(() => conn.close(), 300); return; }
        pid = res.player.pid; // may differ from msg.pid when a dropped player is reclaimed by name
        const old = this.conns.get(pid);
        this.conns.set(pid, conn);
        if (old && old !== conn) old.close();
        conn.sendR({ t: 'welcome', pid });
        if (res.rejoined && this.game) this.game.setConnected?.(pid, true);
        this.broadcastRoom();
        if (this.game && this.inGame(pid)) conn.sendR({ t: 'start', game: this.gameId, players: this.gamePlayers });
      } else if (msg.t === 'ev' && pid && this.game && this.inGame(pid)) {
        this.game.event(pid, msg.d);
      }
    });
    conn.onU(msg => {
      if (msg.t === 'in' && pid && this.game && this.inGame(pid)) this.game.input(pid, msg.d);
    });
    conn.onClose(() => {
      if (!pid || this.conns.get(pid) !== conn) return;
      this.conns.delete(pid);
      setConnected(this.room, pid, false);
      if (this.game && this.inGame(pid)) this.game.setConnected?.(pid, false);
      this.broadcastRoom();
    });
  }

  inGame(pid) { return this.gamePlayers.some(p => p.pid === pid); }

  broadcastRoom() {
    for (const c of this.conns.values()) c.sendR({ t: 'room', room: this.room });
    this.onRoom(this.room);
  }

  selfJoin(name, pid = 'host-' + Math.random().toString(36).slice(2, 8)) {
    const res = addPlayer(this.room, { pid, name });
    if (!res.ok) return null;
    this.selfPid = pid;
    this.broadcastRoom();
    return pid;
  }

  startGame(id) {
    const mod = this.games.find(g => g.id === id);
    const active = activePlayers(this.room);
    if (!mod || this.game || active.length < (mod.minPlayers ?? 2)) return false;
    this.gamePlayers = active.map(({ pid, name, color }) => ({ pid, name, color }));
    this.gameId = id; this.acc = 0; this.steps = 0;
    this.room.inGame = true;
    this.game = mod.createHost({ players: this.gamePlayers, rng: this.rng, emit: (ev, to) => this.emit(ev, to) });
    for (const p of this.room.players) if (this.inGame(p.pid) && !p.connected) this.game.setConnected?.(p.pid, false);
    for (const p of this.gamePlayers) this.conns.get(p.pid)?.sendR({ t: 'start', game: id, players: this.gamePlayers });
    this.broadcastRoom();
    this.onStart({ game: id, players: this.gamePlayers });
    return true;
  }

  emit(ev, to) {
    if (to !== undefined) {
      if (to === this.selfPid) this.onEvent(ev);
      else this.conns.get(to)?.sendR({ t: 'ev', d: ev });
      return;
    }
    for (const p of this.gamePlayers) this.conns.get(p.pid)?.sendR({ t: 'ev', d: ev });
    this.onEvent(ev);
  }

  localInput(state) { if (this.game && this.selfPid && this.inGame(this.selfPid)) this.game.input(this.selfPid, state); }
  localEvent(data) { if (this.game && this.selfPid && this.inGame(this.selfPid)) this.game.event(this.selfPid, data); }

  tick(dt) {
    if (!this.game) return;
    this.acc += dt;
    while (this.game && this.acc >= STEP - 1e-9) {
      this.acc -= STEP;
      this.game.step(STEP);
      if (++this.steps % SNAP_EVERY === 0) {
        const s = this.game.snapshot();
        for (const p of this.gamePlayers) this.conns.get(p.pid)?.sendU({ t: 'snap', s });
        this.onSnap(s);
      }
      const placements = this.game.result();
      if (placements) this.finish(placements);
    }
  }

  finish(placements) {
    awardPlacements(this.room, placements);
    this.room.inGame = false;
    this.room.lastGame = this.gameId;
    this.game = null; this.gamePlayers = [];
    for (const c of this.conns.values()) c.sendR({ t: 'end', placements, room: this.room });
    this.onEnd({ placements, room: this.room });
  }

  endParty() { this.room.partyOver = true; this.broadcastRoom(); }

  close() {
    // Give the goodbye a moment to leave before the links drop.
    const conns = [...this.conns.values()];
    for (const c of conns) c.sendR({ t: 'bye' });
    this.conns.clear();
    this.game = null;
    setTimeout(() => { conns.forEach(c => c.close()); this.transport.close(); }, 250);
  }
}

export class ClientSession {
  constructor({ conn, pid, name }) {
    this.conn = conn; this.pid = pid;
    this.welcomed = false; this.gone = false;
    this.onRoom = noop; this.onStart = noop; this.onSnap = noop; this.onEvent = noop;
    this.onEnd = noop; this.onReject = noop; this.onHostGone = noop;
    conn.onR(msg => {
      switch (msg.t) {
        case 'welcome': this.welcomed = true; this.pid = msg.pid; break;
        case 'reject': this.gone = this.rejected = true; this.onReject(msg.reason); break;
        case 'room': this.onRoom(msg.room); break;
        case 'start': this.onStart({ game: msg.game, players: msg.players }); break;
        case 'ev': this.onEvent(msg.d); break;
        case 'end': this.onEnd({ placements: msg.placements, room: msg.room }); break;
        case 'bye': this.closedByHost = true; this.hostGone(); break;
      }
    });
    conn.onU(msg => { if (msg.t === 'snap') this.onSnap(msg.s); });
    conn.onClose(() => this.hostGone());
    conn.sendR({ t: 'hello', pid, name });
  }
  hostGone() { if (this.gone) return; this.gone = true; this.onHostGone(); }
  sendInput(state) { this.conn.sendU({ t: 'in', d: state }); }
  sendEvent(data) { this.conn.sendR({ t: 'ev', d: data }); }
  close() { this.gone = true; this.conn.close(); }
}
