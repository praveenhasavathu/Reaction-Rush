# Reaction Rush — production-ready multiplayer web game

Reaction Rush is a real-time 2–8 player browser game. Players create or join a room, wait for the server-controlled signal, and click as fast as possible across 5 rounds.

## What changed in v2

- **Removed `better-sqlite3` completely.** It was the reason Windows/npm tried to compile native C++ code and failed on Node 24.
- **Removed unnecessary animation/icon dependencies.** The client is now intentionally small: React + Socket.IO client.
- **Authoritative server state.** The browser never submits a score or reaction time; the server timestamps clicks and calculates points.
- **Reconnect support.** A session token is stored locally so refreshes/network drops can restore the same player for 60 seconds.
- **Host transfer.** If the host disconnects, another connected player becomes host.
- **Safe room cleanup.** Empty rooms expire after inactivity.
- **Room links.** `/join/ABC123` and `?room=ABC123` are supported.
- **Production single-server deployment.** The Node server serves the built React app and Socket.IO from one public URL.

### Important persistence note

Room/game state is intentionally **in memory**. This is the simplest reliable architecture for a small casual multiplayer game and avoids unnecessary database/native-build complexity. A server restart/deploy clears active rooms. If the game later needs multiple server instances or durable rooms, add Redis (or another shared store) behind the same game API.

## Requirements

- Node.js 20+ (your Node.js 24.13.0 is supported by this project)
- npm 10+
- VS Code optional
- No Python, Visual Studio C++ workload, SQLite CLI, or database setup required

## Run locally on Windows

Open PowerShell in the extracted project folder:

```powershell
cd C:\Users\Dell\Downloads\reaction-rush

Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue

npm install
npm run dev
```

You should see:

```text
SERVER  Reaction Rush server listening on http://localhost:3001
CLIENT  Local: http://localhost:5173/
```

Open:

```text
http://localhost:5173
```

### Test two devices

1. Start the game on your PC.
2. Create a room.
3. Copy the room link.
4. Open the link on another phone/PC on the internet or same local network as appropriate.
5. Enter a different nickname.
6. Start when at least two players are connected.
7. Verify both screens change at the same time for WAIT → CLICK → RESULT.

For a phone on the same Wi-Fi to reach your development server, Vite may need to listen on the LAN interface. If needed, temporarily change `client/vite.config.ts` to include `host: true`, then open the displayed LAN URL from the phone. Production deployment is recommended for internet play.

## Production build

```powershell
npm run build
npm start
```

The server listens on `PORT` (default `3001`) and serves `client/dist` when `NODE_ENV=production`.

Health check:

```text
http://localhost:3001/healthz
```

## Deploy publicly on Render

This repository includes `render.yaml`.

1. Put this project in a GitHub repository.
2. In Render, create a Web Service from that repository.
3. Render can use the included settings:
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - Health check: `/healthz`
4. After deployment, Render gives you a public URL such as `https://reaction-rush-xxxx.onrender.com`.
5. Open that URL on two separate devices and test a full 5-round match.

The app uses the same public origin for React and Socket.IO in production, so no separate frontend host is required.

## Game rules

- 5 rounds.
- Server waits a random 2–6 seconds before changing WAIT → CLICK.
- First valid server-received click gets 100 points.
- Then 70, 50, 30, 20 for subsequent valid positions.
- Clicking before CLICK is a false start: −30 points.
- No click before the 5-second round timeout: 0 points.
- A player's score is never accepted from the browser.
- A click can only be counted once per round.
- Late new players cannot interrupt an active match; they can join after it returns to the lobby.

## Main server events

- `createRoom`
- `joinRoom`
- `reconnectRoom`
- `startGame`
- `click`
- `playAgain`
- `returnLobby`
- `leaveRoom`

## Reliability behavior

- Duplicate nicknames in a room are rejected case-insensitively.
- Room capacity is 8.
- Invalid room codes are rejected.
- Refresh/network loss gets a 60-second reconnect window.
- Host disconnect triggers host transfer.
- Duplicate clicks are ignored after the player's first action.
- Wrong/stale round numbers are rejected.
- Server timers control signal/result transitions.
- Empty inactive rooms are removed automatically.
- No client can set another player's score, points, rank, or reaction time.

## Folder structure

```text
reaction-rush/
├─ client/                 # React + Vite UI
│  └─ src/
├─ server/                 # Express + Socket.IO authoritative game server
│  └─ src/
├─ shared/                 # Shared types/constants
├─ render.yaml             # Render deployment configuration
├─ .env.example
└─ package.json
```

## Environment variables

Local development needs none.

For production you can set:

```text
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=https://YOUR-APP.onrender.com
```

If your host does not require `CLIENT_ORIGIN`, the server still allows the browser connection by default. Setting it is preferable for a known production origin.

## Troubleshooting

### `better-sqlite3` / `node-gyp` / Visual Studio errors

That error belongs to the old build. **This v2 package does not contain `better-sqlite3` at all.** After replacing the old folder, verify:

```powershell
Select-String -Path package.json,server\package.json,client\package.json,shared\package.json -Pattern "better-sqlite3"
```

It should return no matches.

### `concurrently is not recognized`

Run `npm install` successfully first. `concurrently` is a normal JavaScript dev dependency in the root package.

### Port 5173 or 3001 is already in use

Stop the old process, or change the port in `client/vite.config.ts` / `PORT` for the server.

## Final production checklist

- [ ] `npm install` completes without native-build errors.
- [ ] `npm run dev` starts both server and client.
- [ ] Create/join works from two devices.
- [ ] Room link opens the join screen with the code filled in.
- [ ] Host can start only with 2+ connected players.
- [ ] Early clicks are −30.
- [ ] Server controls reaction time and points.
- [ ] 5 rounds complete automatically.
- [ ] Play Again resets scores and starts another match.
- [ ] Return to Lobby works.
- [ ] Refresh restores a player during the reconnect grace period.
- [ ] Host transfer works after disconnect.
- [ ] `/healthz` returns `{ "ok": true }`.
