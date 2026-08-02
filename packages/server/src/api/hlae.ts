import type { FastifyInstance } from "fastify";
import { readHudSettings } from "../db/hud-settings-store.js";
import { generateSyncCfg, launchHlae, SYNC_CFG_FILENAME, writeSyncCfg } from "../hlae/client.js";

/**
 * HLAE integration. Launching opens HLAE's own GUI (see hlae/client.ts for
 * why full unattended CS2 launch isn't automated), and "sync" writes
 * sync.cfg with real mirv_colors/mirv_deathmsg commands derived from the
 * configured CT/T colors — the user then runs `exec sync` in CS2.
 */
export function registerHlaeRoutes(app: FastifyInstance): void {
  app.get("/api/hlae/status", async () => {
    const settings = readHudSettings();
    return {
      hlaeConfigured: Boolean(settings.hlaeExePath),
      cfgDirConfigured: Boolean(settings.cs2CfgDir),
    };
  });

  app.post("/api/hlae/launch", async (_request, reply) => {
    try {
      launchHlae();
      return { launched: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/api/hlae/sync-cfg", async () => {
    const settings = readHudSettings();
    const content = generateSyncCfg({ ctColor: settings.hlaeCtColor, tColor: settings.hlaeTColor }, settings);
    return { filename: SYNC_CFG_FILENAME, content, autoInstallConfigured: Boolean(settings.cs2CfgDir) };
  });

  app.post("/api/hlae/sync", async (_request, reply) => {
    const settings = readHudSettings();
    const content = generateSyncCfg({ ctColor: settings.hlaeCtColor, tColor: settings.hlaeTColor }, settings);
    try {
      const result = writeSyncCfg(content);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
