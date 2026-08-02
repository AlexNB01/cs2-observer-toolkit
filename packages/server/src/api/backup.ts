import type { FastifyInstance } from "fastify";
import type { BackupData, CinematicShot } from "@cs2hud/shared";
import { readHudSettings, writeHudSettings } from "../db/hud-settings-store.js";
import { listCinematicShots, replaceAllCinematicShots } from "../db/cinematic-store.js";

const BACKUP_VERSION = 1;

function isValidShot(shot: unknown): shot is CinematicShot {
  if (!shot || typeof shot !== "object") return false;
  const s = shot as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.mapName === "string" &&
    typeof s.label === "string" &&
    (s.slot === "ct" || s.slot === "t" || s.slot === "poi") &&
    typeof s.shot === "object" &&
    s.shot !== null
  );
}

/**
 * Everything the user configures — HLAE colors/toggles, Smart Observer
 * settings, and every captured cinematic camera shot — lives in just two
 * tables (hud_settings, cinematic_shots). Export bundles both into one
 * downloadable JSON file; import fully replaces both, for moving to a
 * different install or recovering after a reinstall (see the "Backup"
 * card on the GSI Setup page).
 */
export function registerBackupRoutes(app: FastifyInstance): void {
  app.get("/api/backup/export", async (): Promise<BackupData> => ({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    hudSettings: readHudSettings(),
    cinematicShots: listCinematicShots(),
  }));

  app.post("/api/backup/import", async (request, reply) => {
    const body = request.body as Partial<BackupData>;
    if (!body.hudSettings || typeof body.hudSettings !== "object") {
      return reply.code(400).send({ error: "Not a valid backup file — missing hudSettings." });
    }
    if (!Array.isArray(body.cinematicShots) || !body.cinematicShots.every(isValidShot)) {
      return reply.code(400).send({ error: "Not a valid backup file — cinematicShots is missing or malformed." });
    }

    writeHudSettings(body.hudSettings);
    replaceAllCinematicShots(body.cinematicShots);

    return { hudSettings: readHudSettings(), cinematicShots: listCinematicShots() };
  });
}
