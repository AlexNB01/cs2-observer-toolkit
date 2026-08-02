import { randomUUID } from "node:crypto";
import type { CinematicShot } from "@cs2hud/shared";
import { db } from "./client.js";

interface CinematicShotRow {
  id: string;
  map_name: string;
  label: string;
  slot: "ct" | "t" | "poi";
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  updated_at: string;
}

function toShot(row: CinematicShotRow): CinematicShot {
  return {
    id: row.id,
    mapName: row.map_name,
    label: row.label,
    slot: row.slot,
    shot: { x: row.x, y: row.y, z: row.z, pitch: row.pitch, yaw: row.yaw },
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
  shot: CinematicShot["shot"];
}): CinematicShot {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cinematic_shots (id, map_name, label, slot, x, y, z, pitch, yaw, updated_at)
     VALUES (@id, @mapName, @label, @slot, @x, @y, @z, @pitch, @yaw, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       map_name = excluded.map_name, label = excluded.label, slot = excluded.slot,
       x = excluded.x, y = excluded.y, z = excluded.z, pitch = excluded.pitch, yaw = excluded.yaw,
       updated_at = excluded.updated_at`
  ).run({
    id,
    mapName: input.mapName,
    label: input.label,
    slot: input.slot,
    x: input.shot.x,
    y: input.shot.y,
    z: input.shot.z,
    pitch: input.shot.pitch,
    yaw: input.shot.yaw,
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
      `INSERT INTO cinematic_shots (id, map_name, label, slot, x, y, z, pitch, yaw, updated_at)
       VALUES (@id, @mapName, @label, @slot, @x, @y, @z, @pitch, @yaw, @updatedAt)`
    );
    for (const shot of shots) {
      insert.run({
        id: shot.id,
        mapName: shot.mapName,
        label: shot.label,
        slot: shot.slot,
        x: shot.shot.x,
        y: shot.shot.y,
        z: shot.shot.z,
        pitch: shot.shot.pitch,
        yaw: shot.shot.yaw,
        updatedAt: now,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
