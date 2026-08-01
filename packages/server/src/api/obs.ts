import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { connectObs, getObsStatus, getReplayPath, triggerReplay } from "../obs/client.js";
import { readObsConfig, writeObsConfig } from "../db/obs-config-store.js";

const CONTENT_TYPES: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".flv": "video/x-flv",
};

/**
 * Section 8 — OBS Replay integration, backed by obs-websocket v5
 * (obs-websocket-js). "Press the replay key during the game" needs a
 * global OS hotkey listener — out of scope in a browser (spec section 15)
 * — so "Trigger replay now" in the admin panel is the manual equivalent.
 * Once OBS reports a saved clip, gsi/listener.ts shows it in the HUD at
 * the next freezetime_start via the replay_show WS message.
 */
export function registerObsRoutes(app: FastifyInstance): void {
  app.get("/api/obs/status", async () => getObsStatus());

  app.get("/api/obs/config", async () => {
    const { password, ...rest } = readObsConfig();
    return { ...rest, hasPassword: password.length > 0 };
  });

  app.post("/api/obs/connect", async (request, reply) => {
    const { host, port, password } = request.body as { host: string; port: number; password?: string };
    // A blank password field means "keep the previously saved one," not
    // "connect with no password" — the admin panel never re-sends it as
    // plaintext once saved.
    const effectivePassword = password !== undefined ? password : readObsConfig().password;
    try {
      return await connectObs(host, port, effectivePassword);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.put("/api/obs/volume", async (request) => {
    const { volume } = request.body as { volume: number };
    const config = writeObsConfig({ volume });
    return { volume: config.volume };
  });

  app.post("/api/obs/trigger-replay", async (_request, reply) => {
    try {
      await triggerReplay();
      return { triggered: true };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  // Streams a saved replay clip to the HUD's <video> tag by id (see
  // obs/client.ts — the id is minted when OBS reports ReplayBufferSaved).
  app.get("/api/obs/replay-file/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = getReplayPath(id);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "Replay not found or no longer available" });
    }
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "video/mp4";
    reply.header("Content-Type", contentType);
    return reply.send(fs.createReadStream(filePath));
  });
}
