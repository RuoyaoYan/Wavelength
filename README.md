# Game Portal

**Play: https://ruoyaoyan.github.io/Wavelength/**

One page with three games for playing together in the same room:

- **Wavelength**: everyone writes secret clues, then the whole group turns one shared dial to guess where each clue lands. Every phone joins with a 4-letter room code.
- **Imposter**: a pass-the-phone word game. Everyone gets the same word except the imposters, who get a similar one.
- **Party**: five phone-controller party games (see below).

## Achievements

The home page shows an achievement log for Wavelength and Imposter. The game detects an unlock and shows it on screen, and the portal adds it to the log with the date and player names.

**Wavelength**

| Achievement | How to unlock |
| --- | --- |
| Co-op high score | Finish a game with the highest total score ever recorded. |
| Perfect Sync | Hit the 4-point bullseye on three clues in a row. |
| Clutch Comeback | Hit the 4-point bullseye right after a clue that scored 0. |
| Tug of War | On the same clue, two guessers drag the arrow in opposite directions, yet it lands in the 3-point zone. |

**Imposter**

| Achievement | How to unlock |
| --- | --- |
| Framed | The group votes out an innocent player first, and the imposters go on to win. |
| Born Actor | Win as an imposter in a game of 5 or more players without any imposter ever being voted out. |
| Sharp Eye | The very first vote of the game catches an imposter. |

In Wavelength only the host's phone reports unlocks, so each one is logged once.

### Where the log is stored

The log lives on a small server in `backend/`: a [Cloudflare Worker](https://developers.cloudflare.com/workers/) with a [D1](https://developers.cloudflare.com/d1/) (SQLite) database, both on Cloudflare's free plan. The server also decides whether a Wavelength score beats the record.

Each new unlock is first saved on the device that played the game, then sent to the server. If the page is closed or the phone is offline, it is sent the next time the portal is opened. Until the server is set up, unlocks are kept on each device and marked "not synced yet".

**Setting up the server (one time)**

```
cd backend
npx wrangler login
npx wrangler d1 create game-portal-achievements   # copy the database_id it prints into wrangler.toml
npx wrangler d1 execute game-portal-achievements --remote --file=schema.sql
npx wrangler deploy                               # prints the Worker URL
```

Then put the Worker URL in `index.html`:

```js
const ACH_API='https://game-portal-achievements.<your-account>.workers.dev';
```

The server accepts posts from anyone who has the page, so someone could add fake entries. To remove one, run:
`npx wrangler d1 execute game-portal-achievements --remote --command "DELETE FROM achievements WHERE id='<id>'"`.

## Party

`party/` is a collection of five phone-controller party games for 2 to 10 players:
**Fall Guys**, **Bumper Balls**, **Turf War**, **Quick Draw** and **Pictionary**.
Open it from the **Party** button in the Game Portal.

**How to play**

1. One device opens the page and taps **Host on a big screen** (a TV or laptop shows the game) or **Host & play** (this phone hosts and also plays).
2. Everyone else opens the same link on their phone, types the 4-letter room code and their name, or scans the QR code on the big screen.
3. The host picks a game or taps **Random**. Each game awards party points (5 / 3 / 1), and **End party** shows the podium.

Phones talk to the host directly over WebRTC (via the free PeerJS matchmaking service), so there is no server to run. **Same Wi-Fi works best**: phones on mobile data or on strict school/office networks may not be able to connect. If the host's screen locks, the game pauses for everyone, so keep the host awake and plugged in.

## For developers

No build step. Serve the repo root with any static server, for example `python3 -m http.server`, then open `/` (portal) or `/party/`. Wavelength and Imposter are stored inside `index.html` as base64 strings in `GAMES`, so to change one, decode it, edit it, and encode it again.

Tests run in Node 22.5+ (the backend tests use Node's built-in SQLite):

```
cd party && node --test
cd backend && node --test
```

To try the achievement log locally, run `node backend/dev-server.js` (the log is saved to `backend/achievements.db`) and set `ACH_API='http://localhost:8787'` in `index.html`.
