import type { FastifyInstance } from "fastify";
import type { CinematicCameraShot } from "@cs2hud/shared";
import { deleteCinematicCameras, getCinematicCameras, listCinematicCameras, saveCinematicCameras } from "../db/cinematic-store.js";
import { generateCinematicCfg, writeCinematicCfg } from "../cinematic/cfg.js";
import { getLatestGsiState } from "../gsi/listener.js";

export function registerCinematicRoutes(app: FastifyInstance): void {
  app.get("/api/cinematic/cameras", async () => listCinematicCameras());

  app.put("/api/cinematic/cameras/:mapName", async (request) => {
    const { mapName } = request.params as { mapName: string };
    const body = request.body as { ctShot?: CinematicCameraShot | null; tShot?: CinematicCameraShot | null };
    const existing = getCinematicCameras(mapName);
    const ctShot = body.ctShot !== undefined ? body.ctShot : existing?.ctShot ?? null;
    const tShot = body.tShot !== undefined ? body.tShot : existing?.tShot ?? null;
    return saveCinematicCameras(mapName, ctShot, tShot);
  });

  app.delete("/api/cinematic/cameras/:mapName", async (request, reply) => {
    const { mapName } = request.params as { mapName: string };
    deleteCinematicCameras(mapName);
    return reply.code(204).send();
  });

  // Section 1-style setup helper: preview/install cinematic.cfg for the
  // map currently reported by GSI (falls back to a query param for
  // testing without a live game).
  app.get("/api/cinematic/cfg", async (request, reply) => {
    const { map } = request.query as { map?: string };
    const mapName = map ?? getLatestGsiState().payload?.map?.name;
    if (!mapName) return reply.code(400).send({ error: "No active map — join a match or pass ?map=de_mirage." });
    const cameras = getCinematicCameras(mapName) ?? { mapName, ctShot: null, tShot: null, updatedAt: new Date().toISOString() };
    return { filename: "cinematic.cfg", mapName, content: generateCinematicCfg(cameras) };
  });

  app.post("/api/cinematic/cfg/install", async (request, reply) => {
    const { map } = request.body as { map?: string };
    const mapName = map ?? getLatestGsiState().payload?.map?.name;
    if (!mapName) return reply.code(400).send({ error: "No active map — join a match or pass { map: 'de_mirage' }." });
    const cameras = getCinematicCameras(mapName);
    if (!cameras) return reply.code(400).send({ error: `No cameras captured for ${mapName} yet.` });
    try {
      return writeCinematicCfg(cameras);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
