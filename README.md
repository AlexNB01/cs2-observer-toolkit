# CS2 Observer Toolkit

A Windows desktop companion for casting/observing Counter-Strike 2 matches. It reads
live match state from CS2's Game State Integration (GSI) feed and uses it to:

- **Automatically switch the spectator camera** to whoever's doing something interesting
  (duels, clutches, multi-kills, bomb plants/defuses, coordinated pushes, ...) — no
  human observer required.
- **Cut to cinematic establishing shots** you capture yourself (map spawns, bomb sites,
  mid) at freezetime or on an uncontested bomb plant/defuse.
- **Drive HLAE** (killfeed/glow/trail colors, x-ray, above-head info, smokes) from one
  place, synced to the same colors as the auto-switch camera.

Everything runs locally — CS2 POSTs its state to a small server on your machine, which
drives the camera over CS2's own console (`-netconport`), no injection or memory reading
involved.

## Getting started

1. Get the installer: download the latest `CS2 Observer Toolkit Setup *.exe` from
   [Releases](https://github.com/AlexNB01/cs2-observer-toolkit/releases) and run it, or
   build it yourself (see [Development](#development) below) if you want to run off a
   local change.
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
5. On **HLAE**, point it at your `HLAE.exe` (from
   [advancedfx/advancedfx](https://github.com/advancedfx/advancedfx) — not bundled here),
   pick CT/T colors, and use "Write sync.cfg" once players have joined.

All settings and captured camera shots persist locally in SQLite and survive
reinstalling — see **Backup** on the GSI Setup page to export/import them as a file
(handy when moving to a different machine).

## How the camera logic works

Every GSI tick, `packages/server/src/gsi/observer.ts` recomputes a single priority score
from scratch for every alive player. `packages/server/src/observer/auto-switch.ts` then
picks whoever's on top of that ranked list — but only actually cuts the camera to them
once they clearly beat the current player by a margin (25 points) and a minimum dwell
time (2s) has passed since the last switch, which is what keeps the camera from
thrashing between two players with near-identical scores. The one exception: if the
player currently on camera has died, it cuts away immediately regardless of margin or
dwell — there's no reason to keep dwelling on a dead player's POV.

Each player's total is the sum of two kinds of contribution:

### Decaying event score

Discrete moments that already happened add a one-time boost that fades on its own
afterward instead of vanishing the instant the camera first cuts to them:

| Event | Amount | Notes |
|---|---|---|
| Kill | 100 (+15 headshot) | |
| Multi-kill | +25 per kill this round | on top of the kill, once the attacker has 2+ round kills |
| Trade | +30 | killing whoever killed a teammate within the last 5s |
| Clutch kill | +40, +20 per enemy still alive | attacker is the sole survivor of their team |
| Shot fired | 10 (+15 if aimed at an enemy) | the aim bonus needs the shooter roughly facing an alive enemy within 1200 units, not just one nearby; total capped at 45 so spraying a wall can't out-score a real duel |

The half-life these decay at isn't fixed — it depends on whether an enemy is currently
*in the shooter's view* (facing roughly toward them, not just nearby): 12s while looking
at a nearby live enemy, a 5s baseline further away, or as fast as 2.5s the moment
they're looking somewhere with no enemy in sight at all — even one standing right behind
them doesn't count, since "not watching for a threat" is a stronger "this is over"
signal than distance alone.

### Situational score

Recomputed fresh every tick from whatever's true *right now* — no history needed, since
it naturally reaches zero the instant the condition stops being true:

- **Clutch state** — the sole survivor of a team, facing at least one alive enemy, gets
  1000 (+10 per enemy still alive) — enough to dominate the ranking outright, since
  there's rarely anything more worth watching.
- **Contested bomb defuse** — while a CT is defusing and the T side still has anyone
  alive, every alive T gets 500 instead of the defuser: watching whether the defuse gets
  stopped is more interesting than watching someone hold a key. Once the enemy team is
  fully dead, nobody gets this score at all — the cinematic uncontested-defuse shot
  below takes over instead. Planting is never scored here either way — it's purely a
  cinematic trigger (below), so the planter's priority never competes with that shot.
- **Proximity** — a small, smoothly-falling-off score (up to 10) for every CT/T pair
  within 1200 units of each other. Deliberately capped low, since GSI has no map
  geometry to check for walls — "close" can just mean opposite sides of one.
- **Flank potential** — up to 45 when a player is within 1000 units of an enemy, facing
  roughly toward them, while that enemy *isn't* facing back. This uses GSI's `forward`
  view-direction field, only available because this app runs as a spectator client — a
  live playing client never gets it, since it'd be a wallhack. It's the closest thing to
  "holding an unnoticed angle" GSI can express without real line-of-sight data.
  Independent of anyone's remaining life count.
- **Coordinated pushes** — 3+ teammates moving together (not just standing near each
  other) score a bump: 80 for the bomb carrier if the T side is stacked while still
  carrying (not yet planting), 35 for every player in a stacked CT rotate/retake.
- **Burning** — a flat 15 while on fire.
- **Low HP** — scales up to 8 as health drops toward 0.

### Cinematic shots

`packages/server/src/cinematic/scheduler.ts` briefly takes the camera away from the
ranked-list logic above for freezetime or an uncontested bomb plant/defuse, then hands
control back. The bomb-plant shot is skipped entirely if a CT is already close to the
site when the plant starts (that's a fight, not an establishing shot), and cuts itself
short early if the plant gets interrupted or if someone opens fire on the planter
mid-shot — in that case the camera cuts straight to the shooter instead of waiting out
the rest of the establishing shot.

Quiet-moment filler shots (cutting to a point-of-interest camera during a lull) are
implemented but currently disabled for all users — the toggle is hidden in the admin UI
and the server ignores the setting for now.

## Requirements

- Windows, with Counter-Strike 2 installed
- For auto-switch: CS2 launched with `-netconport <port> -insecure` (see above)
- For HLAE features: [HLAE](https://github.com/advancedfx/advancedfx) downloaded separately

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
