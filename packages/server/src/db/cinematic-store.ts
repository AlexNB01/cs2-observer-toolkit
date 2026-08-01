import type { CinematicCameraShot, CinematicMapCameras } from "@cs2hud/shared";
import { db } from "./client.js";

interface CinematicRow {
  map_name: string;
  ct_x: number | null;
  ct_y: number | null;
  ct_z: number | null;
  ct_pitch: number | null;
  ct_yaw: number | null;
  t_x: number | null;
  t_y: number | null;
  t_z: number | null;
  t_pitch: number | null;
  t_yaw: number | null;
  updated_at: string;
}

function shotFrom(x: number | null, y: number | null, z: number | null, pitch: number | null, yaw: number | null): CinematicCameraShot | null {
  if (x === null || y === null || z === null || pitch === null || yaw === null) return null;
  return { x, y, z, pitch, yaw };
}

function toMapCameras(row: CinematicRow): CinematicMapCameras {
  return {
    mapName: row.map_name,
    ctShot: shotFrom(row.ct_x, row.ct_y, row.ct_z, row.ct_pitch, row.ct_yaw),
    tShot: shotFrom(row.t_x, row.t_y, row.t_z, row.t_pitch, row.t_yaw),
    updatedAt: row.updated_at,
  };
}

export function listCinematicCameras(): CinematicMapCameras[] {
  const rows = db.prepare("SELECT * FROM cinematic_cameras ORDER BY map_name").all() as unknown as CinematicRow[];
  return rows.map(toMapCameras);
}

export function getCinematicCameras(mapName: string): CinematicMapCameras | null {
  const row = db.prepare("SELECT * FROM cinematic_cameras WHERE map_name = ?").get(mapName) as unknown as CinematicRow | undefined;
  return row ? toMapCameras(row) : null;
}

export function saveCinematicCameras(
  mapName: string,
  ctShot: CinematicCameraShot | null,
  tShot: CinematicCameraShot | null
): CinematicMapCameras {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cinematic_cameras (map_name, ct_x, ct_y, ct_z, ct_pitch, ct_yaw, t_x, t_y, t_z, t_pitch, t_yaw, updated_at)
     VALUES (@mapName, @ctX, @ctY, @ctZ, @ctPitch, @ctYaw, @tX, @tY, @tZ, @tPitch, @tYaw, @updatedAt)
     ON CONFLICT(map_name) DO UPDATE SET
       ct_x = excluded.ct_x, ct_y = excluded.ct_y, ct_z = excluded.ct_z, ct_pitch = excluded.ct_pitch, ct_yaw = excluded.ct_yaw,
       t_x = excluded.t_x, t_y = excluded.t_y, t_z = excluded.t_z, t_pitch = excluded.t_pitch, t_yaw = excluded.t_yaw,
       updated_at = excluded.updated_at`
  ).run({
    mapName,
    ctX: ctShot?.x ?? null,
    ctY: ctShot?.y ?? null,
    ctZ: ctShot?.z ?? null,
    ctPitch: ctShot?.pitch ?? null,
    ctYaw: ctShot?.yaw ?? null,
    tX: tShot?.x ?? null,
    tY: tShot?.y ?? null,
    tZ: tShot?.z ?? null,
    tPitch: tShot?.pitch ?? null,
    tYaw: tShot?.yaw ?? null,
    updatedAt: now,
  });
  return getCinematicCameras(mapName)!;
}

export function deleteCinematicCameras(mapName: string): void {
  db.prepare("DELETE FROM cinematic_cameras WHERE map_name = ?").run(mapName);
}
