import type { FastifyInstance } from "fastify";
import { generateGsiCfg, writeGsiCfg } from "../gsi/cfg-generator.js";
import { env } from "../config/env.js";
import { getLatestGsiState } from "../gsi/listener.js";

export function registerSystemRoutes(app: FastifyInstance): void {
  // Section 1 — lets the admin panel show/copy the .cfg content even
  // without CS2_CFG_DIR configured for auto-install.
  app.get("/api/system/gsi-cfg", async () => ({
    filename: "gamestate_integration_cs2hud.cfg",
    content: generateGsiCfg(env.httpPort),
    autoInstallConfigured: Boolean(env.cs2CfgDir),
  }));

  app.post("/api/system/gsi-cfg/install", async (_request, reply) => {
    try {
      const result = writeGsiCfg();
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/api/system/gsi-status", async () => {
    const { lastUpdatedAt } = getLatestGsiState();
    return {
      connected: lastUpdatedAt !== null && Date.now() - lastUpdatedAt < 15_000,
      lastUpdatedAt,
    };
  });

  // Lets late-joining clients (a HUD/minimap opened mid-match) render
  // immediately instead of waiting for the next WS gsi_event push.
  app.get("/api/system/gsi-latest", async () => {
    const { payload } = getLatestGsiState();
    return { payload };
  });
}
