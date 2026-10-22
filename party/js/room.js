// Lobby state shared by the host: who is in the room, their colors, and party points.
// Pure data in, data out, so the host and the tests use the exact same rules.

export const MAX_PLAYERS = 10;
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const COLORS = ['#ff4f5e', '#2f8cff', '#ffc21a', '#2ec27e', '#a45cff',
  '#ff8a1f', '#14c3c9', '#ff5fb7', '#7a8a00', '#6b4a2b'];
const POINTS = [5, 3, 1];

export function createRoom() {
  return { players: [], scores: {}, inGame: false, lastGame: null, partyOver: false };
}

const key = name => name.trim().toLowerCase();

export function addPlayer(room, { pid, name }) {
  const known = room.players.find(p => p.pid === pid);
  if (known) {
    known.connected = true;
    return { ok: true, player: known, rejoined: true };
  }
  const clean = String(name ?? '').trim().slice(0, 16);
  if (!clean) return { ok: false, reason: 'empty' };
  // Same name as someone who dropped out: that's them coming back on a new tab or device.
  const away = room.players.find(p => !p.connected && key(p.name) === key(clean));
  if (away) {
    away.connected = true;
    return { ok: true, player: away, rejoined: true };
  }
  if (room.players.length >= MAX_PLAYERS) {
    // Between games, someone who left gives up their seat to a newcomer.
    const gone = !room.inGame && room.players.find(p => !p.connected);
    if (!gone) return { ok: false, reason: 'full' };
    room.players.splice(room.players.indexOf(gone), 1);
    delete room.scores[gone.pid];
  }
  if (room.players.some(p => key(p.name) === key(clean))) return { ok: false, reason: 'name' };
  const used = new Set(room.players.map(p => p.color));
  const player = { pid, name: clean, color: COLORS.find(c => !used.has(c)), connected: true, waiting: room.inGame };
  room.players.push(player);
  return { ok: true, player, rejoined: false };
}

export function setConnected(room, pid, connected) {
  const p = room.players.find(x => x.pid === pid);
  if (p) p.connected = connected;
}

// Who gets dealt into the next game: here now, and not waiting for a game in progress.
export const activePlayers = room => room.players.filter(p => !p.waiting && p.connected);

// placements: groups of tied pids, best first. A tied group shares the place of
// its first member; the next group's place skips past everyone in it.
export function placementPoints(placements) {
  const out = {};
  let place = 0;
  for (const group of placements) {
    for (const pid of group) out[pid] = POINTS[place] ?? 0;
    place += group.length;
  }
  return out;
}

export function awardPlacements(room, placements) {
  for (const [pid, pts] of Object.entries(placementPoints(placements)))
    room.scores[pid] = (room.scores[pid] || 0) + pts;
  for (const p of room.players) p.waiting = false;
}

export function standings(room) {
  const rows = room.players.map(p => ({ pid: p.pid, name: p.name, color: p.color, score: room.scores[p.pid] || 0 }))
    .sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; });
  return rows;
}

export function makeCode(rng) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function pickRandomGame(ids, lastId, rng) {
  const pool = ids.length > 1 ? ids.filter(id => id !== lastId) : ids;
  return pool[Math.floor(rng() * pool.length)];
}
