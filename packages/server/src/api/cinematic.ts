import type { FastifyInstance } from "fastify";
import type { CinematicCameraShot } from "@cs2hud/shared";
import { deleteCinematicShot, listCinematicShots, saveCinematicShot } from "../db/cinematic-store.js";
import { generateCinematicCfg, writeCinematicCfg } from "../cinematic/cfg.js";
import { getLatestGsiState } from "../gsi/listener.js";

interface ShotBody {
  mapName?: string;
  label?: string;
  slot?: "ct" | "t" | "poi";
  shot?: CinematicCameraShot;
}

function validateShotBody(body: ShotBody): { mapName: string; label: string; slot: "ct" | "t" | "poi"; shot: CinematicCameraShot } | null {
  if (!body.mapName || !body.label || !body.slot || !body.shot) return null;
  return { mapName: body.mapName, label: body.label, slot: body.slot, shot: body.shot };
}

export function registerCinematicRoutes(app: FastifyInstance): void {
  app.get("/api/cinematic/shots", async (request) => {
    const { map } = request.query as { map?: string };
    return listCinematicShots(map);
  });

  app.post("/api/cinematic/shots", async (request, reply) => {
    const valid = validateShotBody(request.body as ShotBody);
    if (!valid) return reply.code(400).send({ error: "mapName, label, slot, and shot are required" });
    return saveCinematicShot(valid);
  });

  app.put("/api/cinematic/shots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const valid = validateShotBody(request.body as ShotBody);
    if (!valid) return reply.code(400).send({ error: "mapName, label, slot, and shot are required" });
    return saveCinematicShot({ id, ...valid });
  });

  app.delete("/api/cinematic/shots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteCinematicShot(id);
    return reply.code(204).send();
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
