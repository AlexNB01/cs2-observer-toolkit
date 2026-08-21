# CS2 Observer Toolkit

A Windows desktop companion for casting/observing Counter-Strike 2 matches. It reads
live match state from CS2's Game State Integration (GSI) feed and uses it to:

- **Automatically switch the spectator camera** to whoever's doing something interesting
  (duels, clutches, multi-kills, bomb plants/defuses, coordinated pushes, ...).
- **Cut to cinematic HLAE `mirv_campath` camera shots** at freezetime — import a moving
  camera path per CT/T spawn and the app plays it automatically, normalized to a fixed
  length so both sides get roughly equal screen time.
- **Drive HLAE** (killfeed/glow/trail colors, x-ray, above-head info, smokes) from one
  place, synced to the same colors as the auto-switch camera.

Everything runs locally — CS2 POSTs its state to a small server on your machine, which
drives the camera over CS2's own console (`-netconport`).

## Getting started

1. Get the installer: download the latest `CS2 Observer Toolkit Setup *.exe` from
   [Releases](https://github.com/AlexNB01/cs2-observer-toolkit/releases) and run it, or
   build it yourself (see [Development](#development) below) if you want to run off a
   local change.
2. Open the app → **GSI Setup** → set your CS2 install's `game/csgo/cfg` folder (use
   **Browse...** or paste the path) → **Install `gamestate_integration_cs2hud.cfg` into
   CS2** → restart CS2. The page shows "Receiving GSI data" once it's working.
3. Add `-netconport 54545 -insecure` to CS2's Steam launch options (Properties → General →
   Launch Options) and relaunch CS2. `-netconport` is what lets the app move your camera;
   `-insecure` is also required — CS2 blocks the netconsole port under VAC, so without it
   the app can't send any commands even though the port is open. The port number itself is
   arbitrary — just make sure it matches whatever's set on the **Smart Auto Observer**
   page. Note that `-insecure` disables VAC for that session, so it's meant for practice
   servers/demos/scrims, not official VAC-secured matchmaking.
4. On **Smart Auto Observer**, turn on the toggle (and "Auto-switch inside CS2" once
   netconsole shows connected). Optionally add cinematic camera shots per map: build a
   camera path in HLAE's own campath editor, save it as a `.campath` file
   (`mirv_campath save`), then click "Load campath" in the app and pick that file — no
   in-game coordinate capture needed, the app derives everything it needs from the path
   itself.
5. On **HLAE**, point it at your `HLAE.exe` (from
   [advancedfx/advancedfx](https://github.com/advancedfx/advancedfx) — not bundled here),
   pick CT/T colors, and use "Write & apply sync.cfg" once players have joined. This
   applies automatically over netconsole if it's connected; otherwise run `exec sync` in
   the CS2 console yourself.

All settings and captured camera shots persist locally in SQLite and survive
reinstalling — see **Backup** on the GSI Setup page to export/import them as a file.

## How the camera logic works

Every GSI tick, `packages/server/src/gsi/observer.ts` recomputes a single priority score
from scratch for every alive player. `packages/server/src/observer/auto-switch.ts` then
picks whoever's on top of that ranked list, but only actually cuts the camera to them
once they clearly beat the current player by a margin (25 points) and a minimum dwell
time (2s) has passed since the last switch. The one exception: if the player currently on
camera has died, it cuts away immediately regardless of margin or dwell.

Each player's total is the sum of two kinds of contribution:

### Decaying event score

Discrete moments that already happened add a one-time boost that fades on its own
afterward:

| Event | Amount | Notes |
|---|---|---|
| Kill | 100 (+15 headshot) | |
| Multi-kill | +25 per kill this round | on top of the kill, once the attacker has 2+ round kills |
| Trade | +30 | killing whoever killed a teammate within the last 5s |
| Clutch kill | +40, +20 per enemy still alive | attacker is the sole survivor of their team |
| Shot fired | 10 (+15 if aimed at an enemy) | the aim bonus needs the shooter roughly facing an alive enemy within 1200 units (2500 if the shooter's holding a sniper rifle), not just one nearby; capped at 45 total |

The half-life these decay at isn't fixed — it depends on whether an enemy is currently
*in the shooter's view* (facing roughly toward them, not just nearby): 12s while looking
at a nearby live enemy, a 5s baseline further away, or 2.5s when looking somewhere with
no enemy in sight at all — even one standing right behind them doesn't count. "Nearby"
extends to 2500 units (from 1200) while holding a sniper rifle, so a long-range AWP pick
doesn't decay at the fast rate just because nobody else is within rifle range.

### Situational score

Recomputed fresh every tick from whatever's true *right now*:

- **Clutch state** — the sole survivor of a team, facing at least one alive enemy, gets
  1000 (+10 per enemy still alive).
- **Contested bomb defuse** — while a CT is defusing and the T side still has anyone
  alive, every alive T gets 500 instead of the defuser. Once the enemy team is fully
  dead, nobody gets this score — the cinematic uncontested-defuse shot below takes over
  instead. Planting is never scored here either way — it's purely a cinematic trigger
  (below).
- **Proximity** — a small, smoothly-falling-off score (up to 10) for every CT/T pair
  within 1200 units of each other. Capped low since GSI has no map geometry to check
  for walls.
- **Flank potential** — up to 45 when a player is within 1000 units of an enemy, facing
  roughly toward them, while that enemy *isn't* facing back. Uses GSI's `forward`
  view-direction field. Independent of anyone's remaining life count.
- **Coordinated pushes** — 3+ teammates moving together (not just standing near each
  other) score a bump: 80 for the bomb carrier if the T side is stacked while still
  carrying (not yet planting), 35 for every player in a stacked CT rotate/retake.
- **Holding against a push** — up to 45 for whichever CT is within 1000 units of a
  detected T stack and facing roughly toward the nearest one. Doesn't fire for a CT who
  isn't looking that way.

All four of these ranges (1200/1000/1000/1000 units above) extend to 2500 units for
whichever player in the pair is holding a sniper rifle (AWP/SSG08/Scout) — those
duels and holds routinely happen well past rifle engagement distance, so without this
an AWPer never registers as a threat before the shot and gets cut away from almost
immediately after a pick.

### Cinematic shots

`packages/server/src/cinematic/scheduler.ts` briefly takes the camera away from the
ranked-list logic above at freezetime, playing an imported `mirv_campath` camera path for
whichever CT/T spawn shot is up (winner's side first), then hands control back once both
have played. Every imported path is rescaled to a fixed 8s on import — speeding up a
longer recording or slowing down a shorter one, never skipping a keyframe — so the
sequence stays predictable regardless of how long the original recording session ran. If
the server's actual freezetime turns out shorter than that combined length, the sequence
cuts to a clean hand-back on `round_start` instead of getting interrupted mid-motion.

Bomb-plant/defuse establishing shots and quiet-moment filler shots (cutting to a
point-of-interest camera during a lull) are both implemented but currently disabled for
all users — their toggles are hidden in the admin UI and the server ignores the settings
for now.

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
