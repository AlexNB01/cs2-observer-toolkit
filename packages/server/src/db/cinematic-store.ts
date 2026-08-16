import { randomUUID } from "node:crypto";
import type { CinematicShot } from "@cs2hud/shared";
import { db } from "./client.js";

interface CinematicShotRow {
  id: string;
  map_name: string;
  label: string;
  slot: "ct" | "t" | "poi";
  x: number | null;
  y: number | null;
  z: number | null;
  campath_file_name: string;
  campath_duration_ms: number | null;
  updated_at: string;
}

function toShot(row: CinematicShotRow): CinematicShot {
  const hasPosition = row.x !== null && row.y !== null && row.z !== null;
  return {
    id: row.id,
    mapName: row.map_name,
    label: row.label,
    slot: row.slot,
    campathFileName: row.campath_file_name,
    position: hasPosition ? { x: row.x!, y: row.y!, z: row.z! } : undefined,
    campathDurationMs: row.campath_duration_ms ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** All shots, or all shots for one map, ordered so ct/t/poi group together. */
export function listCinematicShots(mapName?: string): CinematicShot[] {
  const rows = (
    mapName
      ? db.prepare("SELECT * FROM cinematic_shots WHERE map_name = ? ORDER BY map_name, slot, label").all(mapName)
      : db.prepare("SELECT * FROM cinematic_shots ORDER BY map_name, slot, label").all()
  ) as unknown as CinematicShotRow[];
  return rows.map(toShot);
}

export function getCinematicShot(id: string): CinematicShot | null {
  const row = db.prepare("SELECT * FROM cinematic_shots WHERE id = ?").get(id) as unknown as CinematicShotRow | undefined;
  return row ? toShot(row) : null;
}

/** Insert if `id` is omitted, otherwise update the existing row. */
export function saveCinematicShot(input: {
  id?: string;
  mapName: string;
  label: string;
  slot: "ct" | "t" | "poi";
  campathFileName: string;
  position?: CinematicShot["position"];
  campathDurationMs?: number;
}): CinematicShot {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cinematic_shots (id, map_name, label, slot, x, y, z, campath_file_name, campath_duration_ms, updated_at)
     VALUES (@id, @mapName, @label, @slot, @x, @y, @z, @campathFileName, @campathDurationMs, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       map_name = excluded.map_name, label = excluded.label, slot = excluded.slot,
       x = excluded.x, y = excluded.y, z = excluded.z,
       campath_file_name = excluded.campath_file_name, campath_duration_ms = excluded.campath_duration_ms,
       updated_at = excluded.updated_at`
  ).run({
    id,
    mapName: input.mapName,
    label: input.label,
    slot: input.slot,
    x: input.position?.x ?? null,
    y: input.position?.y ?? null,
    z: input.position?.z ?? null,
    campathFileName: input.campathFileName,
    campathDurationMs: input.campathDurationMs ?? null,
    updatedAt: now,
  });
  return getCinematicShot(id)!;
}

export function deleteCinematicShot(id: string): void {
  db.prepare("DELETE FROM cinematic_shots WHERE id = ?").run(id);
}

/** Wholesale replace, for restoring a backup (see api/backup.ts) — wipes every existing shot first. */
export function replaceAllCinematicShots(shots: CinematicShot[]): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM cinematic_shots");
    const insert = db.prepare(
      `INSERT INTO cinematic_shots (id, map_name, label, slot, x, y, z, campath_file_name, campath_duration_ms, updated_at)
       VALUES (@id, @mapName, @label, @slot, @x, @y, @z, @campathFileName, @campathDurationMs, @updatedAt)`
    );
    for (const shot of shots) {
      insert.run({
        id: shot.id,
        mapName: shot.mapName,
        label: shot.label,
        slot: shot.slot,
        x: shot.position?.x ?? null,
        y: shot.position?.y ?? null,
        z: shot.position?.z ?? null,
        campathFileName: shot.campathFileName,
        campathDurationMs: shot.campathDurationMs ?? null,
        updatedAt: now,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
