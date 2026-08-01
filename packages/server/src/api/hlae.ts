import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { readHudSettings } from "../db/hud-settings-store.js";
import { env } from "../config/env.js";
import { generateSyncCfg, launchHlae, SYNC_CFG_FILENAME, writeSyncCfg } from "../hlae/client.js";

interface ThemeColorRow {
  name: string;
  ct_color: string;
  t_color: string;
}

function getActiveTheme(): { name: string; ctColor: string; tColor: string } | null {
  const settings = readHudSettings();
  if (!settings.activeThemeId) return null;
  const row = db
    .prepare("SELECT name, ct_color, t_color FROM color_themes WHERE id = ?")
    .get(settings.activeThemeId) as unknown as ThemeColorRow | undefined;
  return row ? { name: row.name, ctColor: row.ct_color, tColor: row.t_color } : null;
}

/**
 * Section 12 — HLAE integration. Launching opens HLAE's own GUI (see
 * hlae/client.ts for why full unattended CS2 launch isn't automated), and
 * "sync" writes sync.cfg with real mirv_colors/mirv_deathmsg commands
 * derived from the active theme — the user then runs `exec sync` in CS2.
 */
export function registerHlaeRoutes(app: FastifyInstance): void {
  app.get("/api/hlae/status", async () => ({
    hlaeConfigured: Boolean(env.hlaeExePath),
    cfgDirConfigured: Boolean(env.cs2CfgDir),
  }));

  app.post("/api/hlae/launch", async (_request, reply) => {
    try {
      launchHlae();
      return { launched: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/api/hlae/sync-cfg", async (_request, reply) => {
    const theme = getActiveTheme();
    if (!theme) return reply.code(400).send({ error: "No active color theme selected — pick one under Color themes." });
    const content = generateSyncCfg(theme, readHudSettings());
    return { filename: SYNC_CFG_FILENAME, content, autoInstallConfigured: Boolean(env.cs2CfgDir) };
  });

  app.post("/api/hlae/sync", async (_request, reply) => {
    const theme = getActiveTheme();
    if (!theme) return reply.code(400).send({ error: "No active color theme selected — pick one under Color themes." });
    const content = generateSyncCfg(theme, readHudSettings());
    try {
      const result = writeSyncCfg(content);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
