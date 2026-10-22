# Party Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a phone-controller party collection (Fall Guys, Bumper Balls, Turf War, Quick Draw, Pictionary) for 2 to 10 players to the Game Portal.

**Architecture:** A static folder `party/` of plain ES modules with no build step. One device hosts: it runs the authoritative game simulation on a worker-driven 60 Hz ticker and talks to each phone over PeerJS (WebRTC). It sends snapshots on an unreliable channel and events on a reliable one. A transport-agnostic session layer holds all protocol logic, so tests can run it in Node with an in-memory transport. Each game is one module with a pure `createHost` (simulation) and a DOM/canvas `createView` (rendering and custom controls).

**Tech Stack:** Vanilla JS (ES2022 modules), Canvas 2D, PeerJS 1.5.4 (`https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js`, global `Peer`), qrcode-generator 1.4.4 (`https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js`, global `qrcode`), Outfit from Google Fonts, Node 24 `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-10-22-party-games-design.md`

## Global Constraints

- Players: 2 to 10 in both host modes (`Big screen`: the host is not a player; `Host & play`: the host phone is a player).
- Room code: 4 letters from `ABCDEFGHJKMNPQRSTUVWXYZ`. The PeerJS id is `wlparty-v1-<CODE>`. Share link: `party/#<CODE>` pre-fills the code.
- Party points per game: 1st 5, 2nd 3, 3rd 1. Tied players share the higher place. The next group's place skips past the tied players.
- Late joiners wait in the lobby and play from the next game with 0 points. Reconnecting with the same `pid` (localStorage `party_pid`) reclaims the slot and points.
- A connect timeout of 10 s shows: "Couldn't connect. Are you on the same Wi-Fi as the host?" plus a Retry button. When the host goes away, phones show "Host disconnected".
- The host requests a screen wake lock (`navigator.wakeLock.request('screen')`, failures ignored). Phones request it too.
- Look: bright, chunky, rounded, Switch-like; Outfit font; portrait phone first; works at 375 px wide with no horizontal scroll; big touch targets (≥ 56 px).
- The host loop must keep running when the host tab is hidden: drive it from a Web Worker ticker, never `requestAnimationFrame` or main-thread `setInterval` alone.
- No changes to the Wavelength/Imposter embedded games. In `index.html`, the only change is one new pill.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A player's phone locks mid-game and reopens. They rejoin with the same pid, get their slot and points back, and their character resumes. A newcomer mid-game waits for the next game. *(Task 2 tests)*
2. An 11th player, or a duplicate name (case-insensitive), is rejected with a readable message, not a hang. *(Task 2 tests)*
3. A lost unreliable packet must not drop a button press. Inputs carry cumulative press counters, and the host acts on counter increases. *(Task 2 test)*
4. In Pictionary, the secret word must never reach guessers through a snapshot, a broadcast event, or a chat echo of a correct guess. *(Task 8 tests)*
5. Every game finishes with a valid placement at exactly 2 players and at 10 players: no game hangs waiting for a disconnected player. *(each game task has a 2-player, a 10-player and a disconnected-player test)*

---

## File Structure

```
party/
  package.json            {"type":"module","private":true}, so Node runs the modules as ESM
  index.html              page shell, CSS tokens, loads PeerJS + qrcode + js/app.js
  js/room.js              pure lobby state: players, colors, scores, placements → points
  js/session.js           pure protocol: HostSession / ClientSession over an injected transport
  js/net.js               PeerJS → transport adapter (the only file that touches Peer)
  js/ticker.js            Web Worker-backed fixed-rate ticker
  js/controls.js          on-screen joystick + buttons → input state with press counters
  js/app.js               screens: start, join, lobby, game host/view mounting, results, podium
  js/games/index.js       registry: export const GAMES = [fallguys, bumper, turf, quickdraw, pictionary]
  js/games/common.js      shared canvas + physics helpers
  js/games/quickdraw.js
  js/games/bumper.js
  js/games/turf.js
  js/games/fallguys.js
  js/games/pictionary.js
  test/*.test.js          node --test
  test/memtransport.js    in-memory transport for session tests
.claude/launch.json       static server for the browser pane
index.html (portal)       + one "Party" pill linking to party/
```

## Shared Interfaces (every task relies on these)

**Placements:** `string[][]`: groups of tied pids, best first. Example: `[['a'],['b','c'],['d']]`.

**Input state** (phone → host, unreliable, ~20 Hz): `{x:number, y:number, b:{[buttonLabel]:number}}`. Here `x` and `y` are in −1..1 with a 0.15 dead-zone already applied, and `b` holds cumulative press counts since the game started.

**Game module** (`export default` from each `js/games/<id>.js`):
```js
{
  id: 'quickdraw', name: 'Quick Draw', blurb: 'One line of rules', color: '#hex',
  controls: { stick: true, buttons: ['Dash'] } | null,   // null → the view draws its own controls
  createHost({ players, rng, emit }) → {
    input(pid, inputState), event(pid, data), step(dt), snapshot(), result(),
    // players: [{pid,name,color}] (active players at start)
    // emit(ev, toPid?) sends a reliable game event to everyone, or to one pid
    // step(dt) is called with dt = 1/60 at 60 Hz
    // snapshot() returns a JSON-safe object sent at 20 Hz (it must not contain secrets)
    // result() returns null while running, Placements once finished
    setConnected(pid, bool)   // optional; the session calls it on drop/rejoin
  },
  createView({ el, me, players, isScreen, send }) → { snapshot(s), event(ev), destroy() }
    // el: an empty container filling the game area; me: pid or null (big screen)
    // send(data): reliable game event to the host (arrives as host.event(me, data))
}
```

**Transport** (implemented by `net.js` and `test/memtransport.js`):
```js
// host side
hostTransport = { code, onConnection(cb /* conn => void */), close() }
// client side
connect(code) → Promise<conn>          // rejects on timeout or failure
conn = { id, sendR(msg), sendU(msg), onR(cb), onU(cb), onClose(cb), close() }
```

**Protocol messages** (all JSON):
- client→host reliable: `{t:'hello',pid,name}`, `{t:'ev',d}`
- client→host unreliable: `{t:'in',d:inputState}`
- host→client reliable: `{t:'welcome',pid}`, `{t:'reject',reason:'full'|'name'|'empty'}`, `{t:'room',room}`, `{t:'start',game,players}`, `{t:'ev',d}`, `{t:'end',placements,room}`, `{t:'bye'}`
- host→client unreliable: `{t:'snap',s}`

---

### Task 1: Scaffold, test harness, and room logic

**Files:**
- Create: `party/package.json`, `party/js/room.js`, `party/test/room.test.js`, `.claude/launch.json`

**Interfaces:**
- Produces (in `room.js`):
  - `COLORS: string[10]`, `MAX_PLAYERS = 10`, `CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'`
  - `createRoom() → {players:[], scores:{}, inGame:false, lastGame:null}`
  - `addPlayer(room, {pid,name}) → {ok:true, player, rejoined:boolean} | {ok:false, reason:'full'|'name'|'empty'}`
    - `player = {pid, name, color, connected:true, waiting:boolean}`. `waiting` is true if `room.inGame`.
    - A rejoin with a known pid sets `connected:true`, keeps the color/score, and keeps `waiting`.
  - `setConnected(room, pid, bool)`
  - `activePlayers(room) → player[]`: not waiting
  - `placementPoints(placements) → {pid: points}`
  - `awardPlacements(room, placements)`: adds to `room.scores` and clears every player's `waiting` flag
  - `standings(room) → [{pid,name,color,score,rank}]`: score desc; ties share a rank
  - `makeCode(rng) → string`, `pickRandomGame(ids, lastId, rng) → id`: never `lastId` when `ids.length > 1`

- [ ] **Step 1:** Create `party/package.json` = `{"type":"module","private":true}`. Create `.claude/launch.json` with config `name:"party"`, `runtimeExecutable:"python3"`, `runtimeArgs:["-m","http.server","8765"]`, `port:8765`.
- [ ] **Step 2: Write failing tests** in `party/test/room.test.js` (`node:test` + `node:assert/strict`):
  - `placementPoints([['a'],['b'],['c'],['d']])` deep-equals `{a:5,b:3,c:1,d:0}`
  - `placementPoints([['a','b'],['c']])` deep-equals `{a:5,b:5,c:1}` (tie shares 1st; c is 3rd)
  - `placementPoints([['a'],['b']])` deep-equals `{a:5,b:3}`
  - `addPlayer` 10 times succeeds, and the 11th returns `{ok:false,reason:'full'}`
  - `addPlayer` with `name:'Ann'` after `'ann '` returns `reason:'name'`. A blank name returns `'empty'`.
  - Rejoin: add `p1`, award 5 points, `setConnected(room,'p1',false)`, then `addPlayer` with the same pid and any name gives `rejoined:true` and the score is still 5
  - With `room.inGame=true`, a new player gets `waiting:true`, `activePlayers` excludes them, and `awardPlacements` clears the flag
  - The 10 players get 10 distinct colors from `COLORS`
  - `makeCode(()=>0)` is `'AAAA'`, and every char of 100 random codes is in `CODE_ALPHABET`
  - `pickRandomGame(['a','b'],'a',Math.random)` is always `'b'` over 50 calls
- [ ] **Step 3:** Run `cd party && node --test test/`. Expected: FAIL (module not found).
- [ ] **Step 4:** Implement `party/js/room.js`. A rejoining player keeps their color. A new player gets the first color no current player uses.
- [ ] **Step 5:** Run `cd party && node --test test/`. Expected: all pass.
- [ ] **Step 6:** Commit: `feat(party): room state and scoring`.

### Task 2: Session protocol (host + client) over an injected transport

**Files:**
- Create: `party/js/session.js`, `party/test/memtransport.js`, `party/test/session.test.js`

**Interfaces:**
- Consumes: `room.js` (Task 1), the game module shape (Shared Interfaces).
- Produces:
  - `memtransport.js`: `createMemNet() → { host(code) → hostTransport, connect(code) → Promise<conn>, dropU(bool) }`. Delivery is synchronous via `queueMicrotask`. `dropU(true)` discards unreliable messages. Closing either end fires `onClose` on the other.
  - `session.js`:
    - `class HostSession { constructor({transport, games, rng, onChange}) }`
      - `room`: a room.js room
      - `selfJoin(name) → pid`: Host & play; the local player uses the same path as remote ones
      - `startGame(id)`: rejects/no-ops when the active count is below `game.minPlayers ?? 2`
      - `tick(dt)`: steps the game; every 3rd tick sends `snap` unreliable to all, and to the local view via `onLocalSnap`
      - `onLocalSnap / onLocalEvent`: callbacks the app sets for the host's own view
      - `localInput(inputState)`, `localEvent(data)`: input/events from the host's own player
      - `endParty()`: emits `{t:'room'}` with `room.partyOver = true`
      - `close()`: sends `bye`
    - `class ClientSession { constructor({conn, pid, name}) }`
      - Callbacks: `onRoom(room)`, `onStart({game,players})`, `onSnap(s)`, `onEvent(d)`, `onEnd({placements,room})`, `onReject(reason)`, `onHostGone()`
      - Methods: `sendInput(inputState)` (unreliable), `sendEvent(data)` (reliable)
    - Input press counters: the host keeps the last-seen counts per pid. It passes `input(pid, state)` through unchanged; games compare counters themselves via `common.pressed()` (Task 4). The session only guarantees the latest state arrives.
    - When `game.result()` is non-null: `awardPlacements`, set `room.inGame=false`, `room.lastGame=id`, then broadcast `{t:'end',placements,room}`.
    - On conn close: `setConnected(false)` and `game.setConnected?.(pid,false)`. On a rejoin hello: `setConnected(true)`, `game.setConnected?.(pid,true)`, resend `room`, and, if a game is running and the player is not waiting, resend `start`.

- [ ] **Step 1: Write failing tests** in `party/test/session.test.js`, using a stub game `{id:'stub', createHost:()=>({input(p,s){last[p]=s}, event(){}, step(){t++}, snapshot:()=>({t}), result:()=> done?[['a'],['b']]:null}), createView(){}}`:
  - Two clients say hello. Both get `welcome`, and both get `room` with 2 players.
  - The 11th client gets `reject` with `reason:'full'`.
  - `startGame('stub')` → clients get `start`. After 3 `tick(1/60)` calls, each client's `onSnap` has fired at least once.
  - A client `sendInput({x:1,y:0,b:{Dash:2}})` reaches the stub's `input(pid, …)` with `b.Dash===2`.
  - With `dropU(true)`, the first `sendInput({…b:{Dash:1}})` is lost. With `dropU(false)`, a later `{…b:{Dash:1}}` still arrives with the counter at 1 (the press is not lost).
  - Setting `done=true` then `tick` → clients get `end` with placements, and `room.scores` = `{a:5,b:3}`.
  - Rejoin mid-game: close client A's conn, reconnect with the same pid → A gets `room` then `start`, and `room.players` still has 2 entries.
  - A new client joining mid-game gets `room` with themselves `waiting:true` and no `start`.
  - Host `close()` → every client's `onHostGone` fires.
- [ ] **Step 2:** Run `cd party && node --test test/`. Expected: session tests FAIL.
- [ ] **Step 3:** Implement `memtransport.js` and `session.js`.
- [ ] **Step 4:** Run `cd party && node --test test/`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(party): host/client session protocol`.

### Task 3: Browser shell: net, ticker, controls, app screens, portal pill

**Files:**
- Create: `party/index.html`, `party/js/net.js`, `party/js/ticker.js`, `party/js/controls.js`, `party/js/app.js`, `party/js/games/index.js`, `party/js/games/common.js`
- Modify: `index.html` (portal): add one pill after Imposter: `<a class="pill" href="party/"><span data-icon="#f2b31b"></span><span>Party</span></a>`

**Interfaces:**
- Consumes: `session.js`, `room.js`.
- Produces:
  - `net.js`: `hostRoom(code) → Promise<hostTransport>` (rejects with `'taken'` if the id is in use, after which the app picks a new code), `connect(code, {timeoutMs=10000}) → Promise<conn>`. Each conn opens two PeerJS DataConnections, labels `r` (reliable) and `u` (`reliable:false`), and is ready when both are open.
  - `ticker.js`: `startTicker(hz, cb) → stop()`. A Blob-URL Worker posts at `1000/hz` ms. `cb(dt)` gets the real elapsed seconds, capped at 0.25.
  - `controls.js`: `mountControls(el, {stick, buttons}, onChange) → {state(), destroy()}`. It supports multitouch with the stick on the left half and buttons on the right. Each button increments `b[label]`. It also calls `navigator.vibrate?.(15)` on press.
  - `common.js` (shared by the games):
    - `pressed(prev, cur, label) → boolean`: true if `cur.b[label] > prev.b[label]`
    - `fitCanvas(canvas, worldW, worldH) → {scale, ox, oy}`: DPR-aware, handles resize
    - `lerpSnap(a, b, t)`
    - `circleCollide(p, q, restitution)`
    - `drawBlob(ctx, {x,y,r,color,name,me})`: a chunky avatar with eyes and a name tag; `me` gets a ring
    - `mulberry32(seed) → rng`
  - `games/index.js`: `export const GAMES = []` (each game task appends its import)
- Screens in `app.js`:
  1. **Start:** a "Party" logo, "Back to portal" (`../`), and buttons **Host on a big screen**, **Host & play**, and **Join** (code + name fields, with the code pre-filled from `location.hash`). The name is remembered in localStorage `party_name`. The pid is stored in `party_pid` (created with `crypto.randomUUID()`).
  2. **Lobby:** the code in big letters, the join URL, and a QR code (big screen only). Player chips show color, name, a waiting tag, and a disconnected dim state. The party scoreboard (`standings`) is shown. On the host only: game cards from `GAMES` (disabled below `minPlayers`, with "Needs 3+" style text), plus **Random** and **End party** buttons. Phones show "Waiting for host to pick a game…".
  3. **Game:** a full-viewport container. When the game has `controls` and `me` is not null, the bottom ~38% holds the `mountControls` area, and inputs are sent at 20 Hz via `setInterval` (and immediately on button press).
  4. **Results:** after `end`, show the placements with points gained for 6 s, then the lobby.
  5. **Podium:** when `room.partyOver`, show the top 3 on a podium and a "New party" button.
  6. **Error states:** connect timeout copy (Global Constraints) with Retry; `reject` reasons: `full` → "Room is full (10 players)", `name` → "Someone already has that name"; host gone → "Host disconnected" plus a Back button.
  - The host starts `startTicker(60, dt => session.tick(dt))` while a game runs and calls `wakeLock` when the room is created.

- [ ] **Step 1:** Implement the files above. `GAMES` stays empty except for a temporary `debug` game in `games/index.js`: dots that move with the stick and finish after 20 s with placements by x position.
- [ ] **Step 2:** Run `cd party && node --test test/`. Expected: still all pass. Also run `node -e "import('./party/js/games/common.js')"`. Expected: no error (Node-safe; no top-level DOM).
- [ ] **Step 3: Browser check.** `preview_start` with `party`, open `http://localhost:8765/party/` in 3 tabs: tab 1 is Host on a big screen, and tabs 2–3 join as Ann and Bob. Expected: the lobby lists both with distinct colors. Start debug → both phone tabs show the stick, moving it moves the dot on all tabs, and after 20 s the results screen and then the lobby show points. Close tab 3 → Bob shows disconnected. Reopen and join with the same name → Bob is back with his points. Then check at 375×812 that nothing scrolls sideways.
- [ ] **Step 4:** Open `http://localhost:8765/` → the portal shows the Party pill, it opens `party/`, and Back returns to the portal. Wavelength and Imposter still open.
- [ ] **Step 5:** Commit: `feat(party): browser shell, lobby, portal link`.

### Task 4: Quick Draw

**Files:** Create `party/js/games/quickdraw.js`, `party/test/quickdraw.test.js`. Modify `party/js/games/index.js` (register it and remove `debug`).

**Interfaces:** Consumes the game module shape, `common.js`. `controls: null`.

**Rules (pinned):**
- 5 rounds. Each round the host emits `{type:'arm', round, delay}` to all, with `delay` uniform in 1.5–4.5 s from `rng`.
- Each phone shows WAIT, switches to DRAW! after `delay` measured with its own `performance.now()`, and sends `{type:'shot', round, ms}`. A tap before DRAW sends `{type:'foul', round}`.
- The round closes when every connected player has answered, or `delay + 3 s` after arm in host time.
- Round points: rank the valid shots by `ms` ascending. Points = `count_of_valid_shots - rank_index`, and ties share the higher value. Fouls and missing answers get 0.
- After each round, the host emits `{type:'reveal', round, times:{pid:ms|'foul'|null}}` and waits 3 s.
- Final placements come from total points, with ties grouped.
- `snapshot()` → `{round, phase:'arming'|'reveal'|'done', totals}`.

- [ ] **Step 1: Failing tests** (fixed `rng = mulberry32(1)`, drive with `step(1/60)` and `event`):
  - 2 players: a shoots 200 ms and b 300 ms in all 5 rounds → `result()` is `[['a'],['b']]`
  - A foul in round 1 earns 0 that round (check `snapshot().totals` after reveal)
  - Equal ms → equal round points
  - A player who never answers: the round still closes after `delay+3` s of steps, and the game finishes
  - 10 players finish with a placement containing all 10 pids exactly once
- [ ] **Step 2:** `node --test test/quickdraw.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the host plus a view. The phone view is a full-screen tap target: WAIT is red, DRAW! is a big green flash, and a foul shows "Too early!". It also shows the reveal list with times. The big-screen view shows a western-duel scene, the player list with ✓ as answers arrive, and the reveal.
- [ ] **Step 4:** Run `node --test test/`. Expected: all pass.
- [ ] **Step 5:** Browser check with 1 host and 2 phone tabs: play all 5 rounds, see the results and the points in the lobby.
- [ ] **Step 6:** Commit: `feat(party): Quick Draw`.

### Task 5: Bumper Balls

**Files:** Create `party/js/games/bumper.js`, `party/test/bumper.test.js`. Modify `games/index.js`.

**Rules (pinned):**
- `controls: {stick:true, buttons:['Dash']}`.
- A circular platform with starting radius `R0 = 140 + 22*n` world units shrinks linearly to 35% of R0 over 60 s.
- A ball leaves the platform when its center distance from the platform center exceeds R. It is out for the round.
- Dash is an impulse with a 1.2 s cooldown.
- A round ends when ≤1 ball is left. Last alive wins; if all fall together, nobody wins.
- Best of 3: the game ends when someone has 2 round wins or after 3 rounds.
- Placements: by round wins, then by total survival time; ties grouped.
- A disconnected player's ball stays (no input) and can be pushed off.

- [ ] **Step 1: Failing tests:**
  - A player whose position is set outside R is out after one `step`
  - The radius after 60 s of steps ≈ `0.35*R0` (±1)
  - 2 players where b is pushed off in rounds 1 and 2 → `result()[0]` is `['a']` and the game ended after round 2
  - 10 players with no input still finish: shrinking forces an end. Run ≤ 4 min of simulated steps and expect a result that contains every pid exactly once.
  - Dash pressed twice within 1.2 s gives only one impulse (use `pressed` counters)
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the host and view: a canvas with a floating island over clouds/sea, blobs via `drawBlob`, round-win pips, and a countdown between rounds. **Step 4:** Run `node --test test/` → pass. **Step 5:** Browser check with 3 tabs, playing to the end. **Step 6:** Commit: `feat(party): Bumper Balls`.

### Task 6: Turf War

**Files:** Create `party/js/games/turf.js`, `party/test/turf.test.js`. Modify `games/index.js`.

**Rules (pinned):**
- `controls: {stick:true, buttons:['Splat']}`.
- The arena is a `64×40` cell grid; a match lasts 90 s.
- Teams: export `makeTeams(pids, rng) → string[][]`. With n≤3, each player is their own team. With n≥4, two shuffled teams with sizes `floor(n/2)` and `ceil(n/2)`.
- Brush radius is 1.6 cells, or 2.2 for players on the smaller team when sizes differ. Movement paints cells in the team color.
- Splat paints radius 4 at the player's position, with a 4 s cooldown.
- Players bump each other (`circleCollide`).
- `snapshot()` includes only the cells changed since the previous snapshot (`[[i,team],…]`) plus positions. Every 2 s it sends a full grid (`full: Uint8 → base64`) so a view that joins late or loses packets heals.
- Placement: rank teams by cell count, and all members of a team share the team's place.

- [ ] **Step 1: Failing tests:**
  - `makeTeams` for n = 2, 3, 4, 5, 9, 10 gives the expected team counts and sizes (5 → sizes 2 and 3)
  - The 5-player smaller-team brush is 2.2 and the larger is 1.6
  - A player moving right for 1 s paints > 0 cells in their team
  - After 90 s, `result()` is non-null, and with 2 teams the team with more cells is first, with all its members in one group
  - A snapshot delta lists only the changed cells, and every 2 s a `full` field is present
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the host and view: a top-down grid canvas, team colors (FFA uses player colors), a coverage bar at the top, and a timer. **Step 4:** Run → pass. **Step 5:** Browser check with 5 tabs (teams 2 vs 3). **Step 6:** Commit: `feat(party): Turf War`.

### Task 7: Fall Guys

**Files:** Create `party/js/games/fallguys.js`, `party/test/fallguys.test.js`. Modify `games/index.js`.

**Rules (pinned):**
- `controls: {stick:true, buttons:['Dive']}`.
- **Round 1, Race:** a top-down course about 3000 world units long, scrolling upward and 600 wide. It has spinning sweeper bars, sliding pushers, and gaps with edges. Falling into a gap or off the side respawns the bean at the last checkpoint after 1 s.
  - Export `raceQualifiers(n) → number`: `n<=3 ? n : n - Math.floor(n/3)`.
  - The race ends when that many have finished, or 120 s after the start (unfinished beans are ranked by progress).
  - With n≤3, everyone advances.
- **Round 2, Hex-A-Gone:** a hex-tile floor in 2 layers. A tile falls 0.6 s after it's first stepped on. Dropping through both layers eliminates the bean. The last bean standing wins. If a round runs over 150 s, the remaining beans tie.
- Dive: a short lunge with a 1 s cooldown. Beans bump each other (`circleCollide`).
- A disconnected player's bean stays idle. In Hex-A-Gone it can fall and is eliminated normally.
- Placements:
  - final survivors (the winner first, then others in reverse order of elimination)
  - then race non-qualifiers by race rank
  - the crown goes to `result()[0]`
- A 3-2-1-GO countdown starts each round, and a "Qualified!/Eliminated" banner shows between rounds.

- [ ] **Step 1: Failing tests:**
  - `raceQualifiers`: 2→2, 3→3, 4→3, 6→4, 10→7
  - A bean placed in a gap respawns at its checkpoint with progress not reset below it
  - 2 players: once both finish the race, the game enters the hex round. With b set to fall through both layers, `result()` is `[['a'],['b']]`.
  - 10 players with no input: the race times out at 120 s, the hex round times out at 150 s, and the result contains all 10 pids exactly once, with 3 race non-qualifiers in the last groups
  - The race leader with `setConnected(pid,false)` does not block the round ending
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the host and view. The camera follows `me` (the big screen follows the leader, or the median on the hex round). Beans are jelly-bean shaped blobs that wobble. Course pieces are bright pastel; tiles flash before dropping. **Step 4:** Run → pass. **Step 5:** Browser check with 4 tabs: one eliminated in the race, then the final, then the crown. **Step 6:** Commit: `feat(party): Fall Guys`.

### Task 8: Pictionary

**Files:** Create `party/js/games/pictionary.js`, `party/js/games/words.js` (export `WORDS: string[]`, 150+ easy-to-draw nouns), `party/test/pictionary.test.js`. Modify `games/index.js`.

**Rules (pinned):**
- `controls: null`.
- Turn order: shuffled players; each draws once, or twice when n≤3.
- At the start of a turn, the host emits `{type:'choose', options:[3 words]}` **only to the drawer**. The drawer replies `{type:'pick', word}`, or after 10 s the first option is used.
- Then 60 s of drawing. The drawer sends `{type:'stroke', pts:[[x,y]…], color, size, id}` in 0–1 normalized coordinates, plus `{type:'clear'}`. The host rebroadcasts strokes to all, and the snapshot holds the full stroke list for the current turn so late or rejoining viewers redraw.
- Guessers send `{type:'guess', text}`. Export `normalizeGuess(s)`: lowercase, then strip non-letters/digits.
  - A correct guess gives the guesser `round(100 + 400 * secondsLeft/60)` and the drawer +100. The host emits `{type:'correct', pid}` with no text.
  - A wrong guess is emitted as `{type:'chat', pid, text}`.
  - A guess within one edit of the word gets a private `{type:'close'}` to that guesser only.
- A turn ends when all connected guessers are correct or 60 s pass. The host then emits `{type:'reveal', word}` to all and waits 4 s.
- Snapshot during a turn: `{drawer, hint:'_ _ _ _', timeLeft, strokes, scores, correct:[pids]}`. It **never** contains the word.
- Placements: by total score, ties grouped.
- Phone views:
  - The drawer gets a canvas, 6 colors, 2 sizes, undo, and clear.
  - Guessers see the canvas plus a text field.
  - The big screen shows the canvas large plus a guess feed.

- [ ] **Step 1: Failing tests:**
  - `normalizeGuess(' Ice-Cream! ')` is `'icecream'`
  - 2 players: a draws first. `choose` is emitted to a only, and `JSON.stringify(snapshot())` doesn't contain the picked word.
  - A correct guess from b at 30 s left gives b `300` points and a `100` points. Every emitted event is captured, and none sent to b (or to all) contains the word until `reveal`.
  - A wrong guess is echoed as chat, and a correct one is not
  - 2 players → 4 turns total. 10 players → 10 turns, and the result contains all 10 pids exactly once.
  - A drawer who disconnects before picking: after 10 s the first option is used, and the game still finishes
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass. **Step 5:** Browser check with 3 tabs: draw a word, the other tab guesses, and the reveal shows. **Step 6:** Commit: `feat(party): Pictionary`.

### Task 9: End-to-end pass and polish

**Files:** Any of the above. Modify `README.md` with a short "Party" section covering how to play, the same-Wi-Fi note, and `node --test` for developers.

- [ ] **Step 1:** Run `cd party && node --test test/`. Expected: all pass.
- [ ] **Step 2:** In the browser, run a Host & play session with 3 extra tabs and play all 5 games back to back, using Random at least once. Expected: scores accumulate correctly, and End party shows the podium.
- [ ] **Step 3:** At phone size (375×812), screenshot each game's phone view and the lobby. Expected: no horizontal scroll, controls reachable, text legible.
- [ ] **Step 4:** Hide the host tab (switch tabs) for 10 s during Bumper Balls. Expected: the phone tabs keep receiving snapshots (worker ticker).
- [ ] **Step 5:** Fix what turned up, re-run the tests, update the README, and commit: `chore(party): polish and docs`.
