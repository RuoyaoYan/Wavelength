# Wavelength
Play: link coming soon

## Party

`party/` is a collection of five phone-controller party games for 2 to 10 players:
**Fall Guys**, **Bumper Balls**, **Turf War**, **Quick Draw** and **Pictionary**.
Open it from the **Party** button in the Game Portal.

**How to play**

1. One device opens the page and taps **Host on a big screen** (a TV or laptop shows the game) or **Host & play** (this phone hosts and also plays).
2. Everyone else opens the same link on their phone, types the 4-letter room code and their name, or scans the QR code on the big screen.
3. The host picks a game or taps **Random**. Each game awards party points (5 / 3 / 1), and **End party** shows the podium.

Phones talk to the host directly over WebRTC (via the free PeerJS matchmaking service), so there is no server to run. **Same Wi-Fi works best**: phones on mobile data or on strict school/office networks may not be able to connect. If the host's screen locks, the game pauses for everyone, so keep the host awake and plugged in.

**For developers**

No build step. Serve the repo root with any static server, for example `python3 -m http.server`, then open `/party/`. Game logic tests run in Node 20+:

```
cd party && node --test
```
