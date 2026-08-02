import type { HudSettings } from "@cs2hud/shared";
import { db } from "./client.js";
import { env } from "../config/env.js";

// Read from CS2_CFG_DIR/HLAE_EXE_PATH once, at startup — this is only ever
// a *default*: for a brand-new install it seeds the first row, and for an
// existing install upgrading to this field, readHudSettings()'s merge
// (`{...DEFAULT_HUD_SETTINGS, ...persisted}`) fills the gap transparently
// so a working .env-based setup doesn't go blank. Once the user sets
// either via the GSI Setup/HLAE pages, the persisted DB value always wins
// from then on and this env fallback stops mattering.
export const DEFAULT_HUD_SETTINGS: Omit<HudSettings, "updatedAt"> = {
  cs2CfgDir: env.cs2CfgDir,
  hlaeExePath: env.hlaeExePath,

  smartObserverEnabled: false,
  autoSwitchInsideCs2: false,
  cs2NetconsolePort: 2121,
  cinematicFreezetimeShotsEnabled: false,
  cinematicBombPlantShotsEnabled: false,
  cinematicQuietMomentShotsEnabled: false,

  hlaeKillfeedEnabled: false,
  hlaeXrayEnabled: false,
  hlaeTrailsEnabled: false,
  hlaeAboveHeadInfoEnabled: false,
  hlaeSmokesEnabled: false,
  hlaeCtColor: "#5d9cff",
  hlaeTColor: "#e8a33d",
};

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hud_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cinematic_shots (
      id TEXT PRIMARY KEY,
      map_name TEXT NOT NULL,
      label TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('ct', 't', 'poi')),
      x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, pitch REAL NOT NULL, yaw REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Merged last-known-good GSI state (see gsi/listener.ts's mergeGsiPayload
    -- doc comment) — persisted so a server restart mid-match doesn't lose
    -- sections CS2 only resends when they change.
    CREATE TABLE IF NOT EXISTS gsi_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT
    );
  `);

  seedDefaultHudSettings();
}

function seedDefaultHudSettings(): void {
  const row = db.prepare("SELECT id FROM hud_settings WHERE id = 1").get();
  if (row) return;

  const settings: HudSettings = {
    ...DEFAULT_HUD_SETTINGS,
    updatedAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO hud_settings (id, json) VALUES (1, ?)").run(JSON.stringify(settings));
}
