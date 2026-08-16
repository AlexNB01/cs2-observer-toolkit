import fs from "node:fs";
import type { HudSettings } from "@cs2hud/shared";
import { db } from "./client.js";
import { env } from "../config/env.js";
import { campathFilePath, parseCampathInfo } from "../cinematic/campath-storage.js";

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

    -- Every shot plays a camera path (campath_file_name) — there's no
    -- static-jump fallback. x/y/z is the path's own first-keyframe
    -- position, auto-derived at import time (see campath-storage.ts's
    -- parseCampathInfo) and used only as a reference point for bomb-site/
    -- quiet-moment nearest-shot matching (see cinematic/scheduler.ts);
    -- nullable purely as a safety net for a file whose keyframes somehow
    -- couldn't be parsed.
    CREATE TABLE IF NOT EXISTS cinematic_shots (
      id TEXT PRIMARY KEY,
      map_name TEXT NOT NULL,
      label TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('ct', 't', 'poi')),
      x REAL, y REAL, z REAL,
      campath_file_name TEXT NOT NULL,
      campath_duration_ms REAL,
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

  ensureColumn("cinematic_shots", "campath_file_name", "TEXT");
  ensureColumn("cinematic_shots", "campath_duration_ms", "REAL");
  ensureCinematicShotsCoordsNullable();
  ensureCinematicShotsCampathOnly();
  seedDefaultHudSettings();
}

/** Adds `column` to `table` if an earlier install's db predates it — CREATE TABLE IF NOT EXISTS above only helps brand-new dbs. */
function ensureColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * An earlier install's db has x/y/z/pitch/yaw as NOT NULL (see the
 * CREATE TABLE above, which only takes effect for a brand-new db) — SQLite
 * can't drop a NOT NULL constraint via ALTER TABLE, so this rebuilds the
 * table instead. Idempotent: only runs if the old constraint is still
 * there.
 */
function ensureCinematicShotsCoordsNullable(): void {
  const cols = db.prepare(`PRAGMA table_info(cinematic_shots)`).all() as { name: string; notnull: number }[];
  const xCol = cols.find((c) => c.name === "x");
  if (!xCol || xCol.notnull !== 1) return;

  db.exec(`
    CREATE TABLE cinematic_shots_new (
      id TEXT PRIMARY KEY,
      map_name TEXT NOT NULL,
      label TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('ct', 't', 'poi')),
      x REAL, y REAL, z REAL, pitch REAL, yaw REAL,
      campath_file_name TEXT,
      campath_duration_ms REAL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO cinematic_shots_new (id, map_name, label, slot, x, y, z, pitch, yaw, campath_file_name, campath_duration_ms, updated_at)
      SELECT id, map_name, label, slot, x, y, z, pitch, yaw, campath_file_name, campath_duration_ms, updated_at FROM cinematic_shots;
    DROP TABLE cinematic_shots;
    ALTER TABLE cinematic_shots_new RENAME TO cinematic_shots;
  `);
}

/**
 * Transitions from the earlier "coordinates always optional, campath
 * optional" shape (see ensureCinematicShotsCoordsNullable) to the current
 * one: every shot requires a camera path, and its reference position is
 * auto-derived from that file's first keyframe rather than manually
 * captured — so pitch/yaw (only ever used for the now-removed static
 * spec_goto jump) are dropped, and any shot that never got a camera path
 * attached is dropped entirely, since there's nothing left for it to play.
 * Idempotent: only runs if the old `pitch` column is still there.
 */
function ensureCinematicShotsCampathOnly(): void {
  const cols = db.prepare(`PRAGMA table_info(cinematic_shots)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "pitch")) return;

  interface OldRow {
    id: string;
    map_name: string;
    label: string;
    slot: string;
    campath_file_name: string | null;
    updated_at: string;
  }
  const rows = db.prepare(`SELECT * FROM cinematic_shots`).all() as unknown as OldRow[];

  interface NewRow {
    id: string;
    map_name: string;
    label: string;
    slot: string;
    x: number;
    y: number;
    z: number;
    campath_file_name: string;
    campath_duration_ms: number | null;
    updated_at: string;
  }
  const migrated: NewRow[] = [];
  let droppedNoCampath = 0;
  let droppedUnparseable = 0;

  for (const row of rows) {
    if (!row.campath_file_name) {
      droppedNoCampath++;
      continue;
    }
    const filePath = campathFilePath(row.campath_file_name);
    if (!fs.existsSync(filePath)) {
      droppedUnparseable++;
      continue;
    }
    const { position, durationMs } = parseCampathInfo(fs.readFileSync(filePath, "utf-8"));
    if (!position) {
      droppedUnparseable++;
      continue;
    }
    migrated.push({
      id: row.id,
      map_name: row.map_name,
      label: row.label,
      slot: row.slot,
      x: position.x,
      y: position.y,
      z: position.z,
      campath_file_name: row.campath_file_name,
      campath_duration_ms: durationMs ?? null,
      updated_at: row.updated_at,
    });
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE cinematic_shots_new (
        id TEXT PRIMARY KEY,
        map_name TEXT NOT NULL,
        label TEXT NOT NULL,
        slot TEXT NOT NULL CHECK (slot IN ('ct', 't', 'poi')),
        x REAL, y REAL, z REAL,
        campath_file_name TEXT NOT NULL,
        campath_duration_ms REAL,
        updated_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare(
      `INSERT INTO cinematic_shots_new (id, map_name, label, slot, x, y, z, campath_file_name, campath_duration_ms, updated_at)
       VALUES (@id, @map_name, @label, @slot, @x, @y, @z, @campath_file_name, @campath_duration_ms, @updated_at)`
    );
    for (const row of migrated) insert.run(row as unknown as Record<string, string | number | null>);
    db.exec(`DROP TABLE cinematic_shots; ALTER TABLE cinematic_shots_new RENAME TO cinematic_shots;`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (droppedNoCampath > 0 || droppedUnparseable > 0) {
    console.log(
      `[migrate] Removed static camera shots that had no working camera path: ${droppedNoCampath} never had one attached` +
        (droppedUnparseable > 0 ? `, ${droppedUnparseable} had an unreadable/unparseable path file` : "") +
        `. Kept ${migrated.length} shot(s) with a working camera path.`
    );
  }
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
