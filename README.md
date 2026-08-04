# CS2 Observer Toolkit

A Windows desktop companion for casting/observing Counter-Strike 2 matches. It reads
live match state from CS2's Game State Integration (GSI) feed and uses it to:

- **Automatically switch the spectator camera** to whoever's doing something interesting
  (duels, clutches, multi-kills, bomb plants/defuses, incoming grenades, coordinated
  pushes, ...) — no human observer required.
- **Cut to cinematic establishing shots** you capture yourself (map spawns, bomb sites,
  mid) at freezetime, on a bomb plant/uncontested defuse, or as filler during a lull.
- **Drive HLAE** (killfeed/glow/trail colors, x-ray, above-head info, smokes) from one
  place, synced to the same colors as the auto-switch camera.

Everything runs locally — CS2 POSTs its state to a small server on your machine, which
drives the camera over CS2's own console (`-netconport`), no injection or memory reading
involved.

## Getting started

1. Build the installer (see [Development](#development) below) and run it — this repo
   is private and doesn't publish built releases.
2. Open the app → **GSI Setup** → set your CS2 install's `game/csgo/cfg` folder (use
   **Browse...** or paste the path) → **Install `gamestate_integration_cs2hud.cfg` into
   CS2** → restart CS2. The page shows "Receiving GSI data" once it's working.
3. Add `-netconport 2121 -insecure` to CS2's Steam launch options (Properties → General →
   Launch Options) and relaunch CS2. `-netconport` is what lets the app move your camera;
   `-insecure` is also required — CS2 blocks the netconsole port under VAC, so without it
   the app can't send any commands even though the port is open. The port must match the
   one set on the **Smart Auto Observer** page (2121 by default). Note that `-insecure`
   disables VAC for that session, so it's meant for practice servers/demos/scrims, not
   official VAC-secured matchmaking.
4. On **Smart Auto Observer**, turn on the toggle (and "Auto-switch inside CS2" once
   netconsole shows connected). Optionally capture cinematic camera shots per map: in
   CS2, `spec_mode 6`, fly to a spot, run `spec_pos`, and paste the printed
   `x y z pitch yaw` into the app.
5. On **HLAE**, point it at your `HLAE.exe` (from [hlae.online](https://www.hlae.online/)
   — not bundled here), pick CT/T colors, and use "Write sync.cfg" once players have
   joined.

All settings and captured camera shots persist locally in SQLite and survive
reinstalling — see **Backup** on the GSI Setup page to export/import them as a file
(handy when moving to a different machine).

## How the camera logic works

Every GSI tick, `packages/server/src/gsi/observer.ts` scores every alive player from a
mix of discrete events (kills, headshots, multi-kills, trades, shots fired — decaying
over a few seconds, and weighted higher when fired with an enemy nearby) and situational
conditions recomputed fresh each tick (clutch state, bomb plant/defuse, proximity to an
enemy, an incoming grenade, a coordinated team push, burning, low HP).
`observer/auto-switch.ts` picks whoever's on top, but only actually cuts once they beat
the current player by a margin and a minimum dwell time has passed — this is what keeps
the camera from thrashing between near-tied scores.

Cinematic shots (`cinematic/scheduler.ts`) briefly take over the camera for freezetime,
a bomb plant/uncontested defuse, or a quiet moment, then hand control back. The bomb-plant
shot cuts itself short early if the plant gets interrupted, or if someone opens fire on
the planter — in that case the camera cuts straight to the shooter instead of waiting out
the rest of the establishing shot.

## Requirements

- Windows, with Counter-Strike 2 installed
- For auto-switch: CS2 launched with `-netconport <port> -insecure` (see above)
- For HLAE features: [HLAE](https://www.hlae.online/) downloaded separately

## Development

Node 22+ (uses Node's built-in `node:sqlite`, so no native build toolchain is needed).

```bash
npm install
npm run dev           # server (Fastify, :3001) + web admin panel (Vite, :5173) in dev mode
npm run desktop       # runs the Electron shell against the built web/server, for testing
npm run desktop:dist  # builds the Windows installer (packages/desktop/release/)
npm run typecheck     # typecheck every package
```

Copy `packages/server/.env.example` to `packages/server/.env` if you want to seed
`CS2_CFG_DIR`/`HLAE_EXE_PATH` for local dev. The packaged app does the same via a
`.env` it creates under its `userData` folder on first launch, but that's only ever a
one-time seed — the GSI Setup/HLAE pages are the normal way to set or change these.

### Project structure

```
packages/
  shared/    TypeScript types shared everywhere — GSI payload shapes, domain types
             (HudSettings, CinematicShot, ObserverQueueItem, ...), WS message types
  server/    Fastify server: GSI listener + normalizer, Smart Observer scoring engine,
             cinematic camera scheduler, HLAE client, netconsole client, REST API,
             WebSocket hub, SQLite storage
  web/       React + Vite admin panel (the UI you see in the app window)
  desktop/   Electron shell — wraps the server + web admin panel into one process,
             packaged with electron-builder into a single NSIS installer
```

The desktop app persists its SQLite database under Electron's per-machine `userData`
folder (`%APPDATA%\CS2 Observer Toolkit\cs2hud.sqlite` on Windows), independent of
however the app itself is run or reinstalled.
