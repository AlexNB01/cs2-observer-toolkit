import type { FastifyInstance } from "fastify";
import type { HudSettings } from "@cs2hud/shared";
import { readHudSettings, writeHudSettings } from "../db/hud-settings-store.js";
import { broadcast } from "../ws/hub.js";

export function registerHudSettingsRoutes(app: FastifyInstance): void {
  // Backs sections 2, 3, 5, 9 and 13 — all HUD/observer/minimap/veto toggles
  // live in one settings object pushed to every client over WS on change.
  app.get("/api/hud-settings", async () => readHudSettings());

  app.put("/api/hud-settings", async (request) => {
    const patch = request.body as Partial<HudSettings>;
    const merged = writeHudSettings(patch);
    broadcast({ kind: "settings_updated", settings: merged });
    return merged;
  });
}
