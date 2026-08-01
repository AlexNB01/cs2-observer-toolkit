import { randomUUID } from "node:crypto";
import type { ColorTheme, HudSettings } from "@cs2hud/shared";
import { BUILTIN_THEME_NAMES } from "@cs2hud/shared";
import { db } from "./client.js";

const DEFAULT_THEME_COLORS: Record<(typeof BUILTIN_THEME_NAMES)[number], Pick<ColorTheme, "backgroundColor" | "ctColor" | "tColor">> = {
  Default: { backgroundColor: "#0d0f12", ctColor: "#5d79ae", tColor: "#c9a26d" },
  ESL: { backgroundColor: "#0b0b0b", ctColor: "#ff5900", tColor: "#ffffff" },
  "CS 1.6": { backgroundColor: "#1a1a1a", ctColor: "#3d5a99", tColor: "#8a6d3b" },
  "La Coupe": { backgroundColor: "#0a0e17", ctColor: "#3a86ff", tColor: "#ffbe0b" },
  "Steam 2007": { backgroundColor: "#22252b", ctColor: "#4c6b8a", tColor: "#8a7a4c" },
  "Blast Paris": { backgroundColor: "#050014", ctColor: "#7b2ff7", tColor: "#f72fa1" },
  "CS Source": { backgroundColor: "#141414", ctColor: "#3f5f8a", tColor: "#8a6a3f" },
};

const DEFAULT_HUD_SETTINGS: Omit<HudSettings, "activeThemeId" | "updatedAt"> = {
  monitor: null,
  toggleHudKeybind: "Shift+W",
  eventTitle: "",
  displayMode: "horizontal",
  killDisplayStyle: "classic",
  headerStyle: "compact",
  hideTeamNamesDuringRounds: false,
  scoreboardKeybind: "F1",
  showPlayersAliveCounter: true,
  clutchModeEnabled: true,
  clutchModeMinOpponents: 1,

  inventoryBarMode: "round_start_only",
  teamOnFireEnabled: true,
  playerOnFireEnabled: true,
  showBombTimerSeconds: true,
  showDefuseTimerSeconds: true,
  mvpAnimationEnabled: true,
  mvpTrophyEnabled: true,
  roundWinnerBannerEnabled: true,
  scoreboardAvatarsEnabled: true,
  teamLogoFallbackEnabled: true,

  smartObserverEnabled: false,
  autoSwitchInsideCs2: false,
  cs2NetconsolePort: 2121,
  cinematicFreezetimeShotsEnabled: false,

  minimapEnabled: false,
  minimapAutoZoom: true,
  minimapSizePx: 300,
  minimapBackgroundEnabled: true,

  vetoKeybind: "F7",
  vetoFullHeightCards: false,

  hlaeKillfeedEnabled: false,
  hlaeXrayEnabled: false,
  hlaeTrailsEnabled: false,
  hlaeAboveHeadInfoEnabled: false,
  hlaeSmokesEnabled: false,
};

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      avatar_url TEXT,
      bust_image INTEGER NOT NULL DEFAULT 0,
      country TEXT,
      webcam_url TEXT,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS color_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('builtin', 'partner', 'custom')),
      background_color TEXT NOT NULL,
      ct_color TEXT NOT NULL,
      t_color TEXT NOT NULL,
      corner_radius_px INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS hud_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS veto_current (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT
    );

    CREATE TABLE IF NOT EXISTS obs_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL DEFAULT 'localhost',
      port INTEGER NOT NULL DEFAULT 4455,
      password TEXT NOT NULL DEFAULT '',
      volume INTEGER NOT NULL DEFAULT 80
    );

    CREATE TABLE IF NOT EXISTS cinematic_cameras (
      map_name TEXT PRIMARY KEY,
      ct_x REAL, ct_y REAL, ct_z REAL, ct_pitch REAL, ct_yaw REAL,
      t_x REAL, t_y REAL, t_z REAL, t_pitch REAL, t_yaw REAL,
      updated_at TEXT NOT NULL
    );

    -- Merged last-known-good GSI state (see gsi/listener.ts's mergeGsiPayload
    -- doc comment) — persisted so a server restart mid-match doesn't lose
    -- sections CS2 only resends when they change, which can otherwise leave
    -- consumers requiring a complete payload (the LHM HUD's csgogsi digest)
    -- stalled until CS2 happens to resend everything.
    CREATE TABLE IF NOT EXISTS gsi_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT
    );
  `);

  seedBuiltinThemes();
  seedDefaultHudSettings();
  seedDefaultObsConfig();
}

function seedBuiltinThemes(): void {
  const count = db.prepare("SELECT COUNT(*) as c FROM color_themes WHERE kind = 'builtin'").get() as { c: number };
  if (count.c > 0) return;

  const insert = db.prepare(
    `INSERT INTO color_themes (id, name, kind, background_color, ct_color, t_color, corner_radius_px)
     VALUES (?, ?, 'builtin', ?, ?, ?, 10)`
  );
  for (const name of BUILTIN_THEME_NAMES) {
    const colors = DEFAULT_THEME_COLORS[name];
    insert.run(randomUUID(), name, colors.backgroundColor, colors.ctColor, colors.tColor);
  }
}

function seedDefaultHudSettings(): void {
  const row = db.prepare("SELECT id FROM hud_settings WHERE id = 1").get();
  if (row) return;

  const defaultTheme = db.prepare("SELECT id FROM color_themes WHERE name = 'Default' AND kind = 'builtin'").get() as
    | { id: string }
    | undefined;

  const settings: HudSettings = {
    ...DEFAULT_HUD_SETTINGS,
    activeThemeId: defaultTheme?.id ?? null,
    updatedAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO hud_settings (id, json) VALUES (1, ?)").run(JSON.stringify(settings));
}

function seedDefaultObsConfig(): void {
  const row = db.prepare("SELECT id FROM obs_config WHERE id = 1").get();
  if (row) return;
  db.prepare("INSERT INTO obs_config (id) VALUES (1)").run();
}
