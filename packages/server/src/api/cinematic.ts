import type { FastifyInstance } from "fastify";
import { deleteCinematicShot, getCinematicShot, listCinematicShots, saveCinematicShot } from "../db/cinematic-store.js";
import { generateCinematicCfg, writeCinematicCfg } from "../cinematic/cfg.js";
import { deleteCampathFile, importCampathFile } from "../cinematic/campath-storage.js";
import { fireShotManually, stopManualShot } from "../cinematic/scheduler.js";
import { getLatestGsiState } from "../gsi/listener.js";

interface CampathShotBody {
  mapName?: string;
  label?: string;
  slot?: "ct" | "t" | "poi";
  sourcePath?: string;
}

export function registerCinematicRoutes(app: FastifyInstance): void {
  app.get("/api/cinematic/shots", async (request) => {
    const { map } = request.query as { map?: string };
    return listCinematicShots(map);
  });

  // The only way to create a shot: every shot plays a camera path (see
  // @cs2hud/shared's CinematicShot doc comment), and its reference position
  // is auto-derived from that file's first keyframe (see
  // campath-storage.ts's parseCampathInfo) — nothing to walk the map and
  // capture manually anymore. sourcePath is wherever the user's own HLAE
  // campath editor saved the file.
  app.post("/api/cinematic/campath-shots", async (request, reply) => {
    const body = request.body as CampathShotBody;
    if (!body.mapName || !body.label || !body.slot || !body.sourcePath) {
      return reply.code(400).send({ error: "mapName, label, slot, and sourcePath are required" });
    }
    try {
      const { fileName, position, durationMs } = importCampathFile(body.sourcePath);
      return saveCinematicShot({ mapName: body.mapName, label: body.label, slot: body.slot, campathFileName: fileName, position, campathDurationMs: durationMs });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Renames/reslots an existing shot without touching its camera path.
  app.put("/api/cinematic/shots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getCinematicShot(id);
    if (!existing) return reply.code(404).send({ error: "Shot not found" });
    const body = request.body as { mapName?: string; label?: string; slot?: "ct" | "t" | "poi" };
    if (!body.mapName || !body.label || !body.slot) return reply.code(400).send({ error: "mapName, label, and slot are required" });
    return saveCinematicShot({ ...existing, mapName: body.mapName, label: body.label, slot: body.slot });
  });

  app.delete("/api/cinematic/shots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getCinematicShot(id);
    if (existing) deleteCampathFile(existing.campathFileName);
    deleteCinematicShot(id);
    return reply.code(204).send();
  });

  // Replaces the camera path a shot plays (and re-derives its reference
  // position/duration from the new file) without having to delete and
  // re-create the shot.
  app.post("/api/cinematic/shots/:id/campath", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sourcePath } = request.body as { sourcePath?: string };
    const existing = getCinematicShot(id);
    if (!existing) return reply.code(404).send({ error: "Shot not found" });
    if (!sourcePath) return reply.code(400).send({ error: "sourcePath is required" });
    try {
      const { fileName, position, durationMs } = importCampathFile(sourcePath);
      deleteCampathFile(existing.campathFileName);
      return saveCinematicShot({ ...existing, campathFileName: fileName, position, campathDurationMs: durationMs });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Manual trigger: fires this shot's camera path right now over
  // netconsole, bypassing freezetime/bomb-plant/quiet-moment. Stays up
  // until /api/cinematic/stop is called — see scheduler.ts's
  // fireShotManually for why there's no automatic hand-back timer here.
  app.post("/api/cinematic/shots/:id/fire", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shot = getCinematicShot(id);
    if (!shot) return reply.code(404).send({ error: "Shot not found" });
    fireShotManually(shot);
    return { fired: true };
  });

  app.post("/api/cinematic/stop", async () => {
    stopManualShot();
    return { stopped: true };
  });

  // Setup helper: preview/install cinematic.cfg for the map currently
  // reported by GSI (falls back to a query param for testing without a
  // live game).
  app.get("/api/cinematic/cfg", async (request, reply) => {
    const { map } = request.query as { map?: string };
    const mapName = map ?? getLatestGsiState().payload?.map?.name;
    if (!mapName) return reply.code(400).send({ error: "No active map — join a match or pass ?map=de_mirage." });
    return { filename: "cinematic.cfg", mapName, content: generateCinematicCfg(mapName, listCinematicShots(mapName)) };
  });

  app.post("/api/cinematic/cfg/install", async (request, reply) => {
    const { map } = request.body as { map?: string };
    const mapName = map ?? getLatestGsiState().payload?.map?.name;
    if (!mapName) return reply.code(400).send({ error: "No active map — join a match or pass { map: 'de_mirage' }." });
    const shots = listCinematicShots(mapName);
    if (shots.length === 0) return reply.code(400).send({ error: `No shots captured for ${mapName} yet.` });
    try {
      return writeCinematicCfg(mapName, shots);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
