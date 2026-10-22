# Party Games: design

Date: 2026-10-22 · Branch: `feat/party-games`

## The five games

| # | Name | Plays like |
|---|------|-----------|
| 1 | **Fall Guys** | Wobbly beans race an obstacle course, then a Hex-A-Gone tile-drop final; the last one standing gets the crown |
| 2 | **Bumper Balls** | Balls on a shrinking floating platform; ram others off; last one on wins |
| 3 | **Turf War** | Paint the floor your color for 90 s; most coverage wins |
| 4 | **Quick Draw** | "Wait…" → "DRAW!"; fastest tap wins; tapping early is a foul |
| 5 | **Pictionary** | One player draws a secret word live, everyone else races to type the guess |

## Intent

A Switch-style party collection that sits next to Wavelength and Imposter in the Game Portal. A group of **2 to 10 friends** plays together, **each on their own phone**. Everyone opens the same link and types a room code. Optionally, a TV or laptop acts as the shared screen.

Success means friends can start a game night with no install and no accounts, and every game is fun at both 2 players and 10.

## Goals

- One link. One device creates a room and shows a 4-letter code. Everyone else types it and joins with their name.
- Two ways to host, picked on the start screen:
  - **Big screen**: a TV or laptop hosts and shows the game. It is not a player. Phones are controllers but still show the game view.
  - **Host & play**: one phone hosts and plays too.
- A lobby that shows the players (name plus one of 10 colors) and the party scoreboard. The host picks the next game or hits Random.
- Party points across games, like Mario Party stars: after each game, 1st gets 5, 2nd 3, 3rd 1.
- A bright, chunky, rounded Switch-like look, built for phones in portrait, with big touch targets.
- Controls on the phone: a thumb joystick on the left and one or two action buttons on the right. Quick Draw and the drawing game use their own phone screens.

## Non-goals

- Accounts, saved history, or online matchmaking with strangers.
- Moving the host to another device if the host leaves; the room ends.
- Computer players.
- Sound effects or music (could come later).

## Anti-goals

- Lag that makes the action games feel unfair or unplayable with 10 players on the same Wi-Fi.
- Any game that breaks or is pointless at 2 players.
- Breaking the existing portal, Wavelength, or Imposter.

## How it's built (my calls)

- **Files:** a new folder `party/` with `party/index.html` plus plain JS files: one shared networking/lobby layer and one file per game. No build step and no frameworks. Fonts and libraries come from CDNs, as the existing games do. The portal (`index.html`) gets a third pill, a normal link to `party/` (not a `#hash` link, since the portal's router only knows its embedded games). The party page's back link goes to `../`. Nothing else in the portal changes.
- **Networking:** PeerJS, a free public service that introduces the phones to each other. After that, they talk directly to the host (WebRTC). No server of our own.
  - The host runs the real game (physics, scoring) and sends snapshots about 20 times a second. Phones send joystick/button input and draw the game from the snapshots, smoothing between them.
  - Fast position data uses an unreliable channel so a dropped packet doesn't stall the game. Events (join, game start, scores) use a reliable channel.
  - The host's game loop runs on timers, not animation frames, so it keeps running when the host tab isn't the active window.
- **Known limits (to tell players):**
  - **Same Wi-Fi is recommended.** Without a relay server, phones on mobile data or strict school/office Wi-Fi may fail to connect. Adding a relay (TURN) server is a later option.
  - If the host is a phone and it locks or switches apps, the game freezes for everyone. The host requests a screen wake lock, and phones show "Host disconnected".
  - A player whose phone drops can rejoin with the same name on the same phone and gets their slot and points back.
- **Shareable link:** the room code goes in the link (`party/#ABCD`), so opening it pre-fills the code. The big screen also shows a QR code for that link.

## Each game at 2 and at 10 players

- **Fall Guys:** the course scrolls upward, with spinning sweeper bars, moving pushers, and gaps. Beans bump each other, and a Dive button gives a short lunge. Falling off sends you back to the last checkpoint.
  - Round 1 is a race. With 4+ players, roughly the bottom third is eliminated. With 2–3 players, nobody is eliminated.
  - The final is Hex-A-Gone: tiles fall shortly after you step on them, and the last bean standing wins the crown.
  - Party placement is the reverse order of elimination.
- **Bumper Balls:** the platform starts with a radius sized to the player count and shrinks over about 60 s. Dash has a cooldown. Best of 3 rounds, and the most round wins takes 1st.
- **Turf War:** 2–3 players play free-for-all, each in their own color. 4+ players split into two teams. With an odd count, the smaller team's players paint a wider trail. A Splat button paints a big blob on a cooldown. Final coverage is shown as percentages.
- **Quick Draw:** everyone duels at once. The host tells every phone the random delay, and each phone times the reaction itself, so the network doesn't affect fairness. Tapping early is a foul worth 0 for that round. 5 rounds, the fastest gets the most points, and exact ties share.
- **Pictionary:** players take turns drawing. The word comes from a built-in list, and the drawer sees 3 choices. Everyone else sees the strokes live and types guesses. Faster correct guesses earn more points, and the drawer earns points for each correct guess. With 2 players, you take turns, one draws and one guesses. 60 s per drawing. Each player draws once (twice at 2–3 players).

## Rules settled by the builder (my calls, after the review)

- **10 players in both host modes.** The host phone does the physics, which is cheap at this size. Each game is tested with 10 players.
- **Connection failures:** v1 ships without a relay. If a phone can't reach the host within about 10 s, it shows "Couldn't connect. Are you on the same Wi-Fi as the host?" with a Retry button.
- **Joining late or rejoining:** someone joining mid-game waits in the lobby and plays from the next game, starting with 0 party points. A player who drops mid-round gets their slot back. Their character stands still while they're gone, and in Fall Guys a bean that falls while its player is disconnected counts as eliminated.
- **Ties:** tied players share the higher placement. If two players tie for 1st, both get 5 points and the next player gets 1 (3rd place). At 2 players, only 5 and 3 points are given.
- **Fall Guys at 2–3 players:** the race only warms everyone up. Party placement comes from the final.
- **Party length:** there's no fixed number of games. The host picks a game or hits Random (which avoids repeating the last game). An "End party" button shows a podium with the overall winner.
- **Portal pill:** it matches the existing pills (block-ring icon in a party yellow, `#f2b31b`) and is labeled "Party".

## Testing

- The host plus several players are run as tabs in the built-in browser to check joining, every game start to finish, scores, rejoin, and the host leaving.
- A layout check at phone width (375 px).
- Tabs on one computer **can't** test real phones, mobile data, or Wi-Fi restrictions. You'll need to try it on real phones yourself.

## Decided by the user

- Game 5 is **Pictionary**: one player draws, everyone else guesses. Drawful's bluffing rules were considered and turned down.

## Left to the builder

The exact course layouts, tuning numbers (speeds, cooldowns, sizes), colors, the word list (aim for 150+ easy-to-draw words), and code structure inside each file.
