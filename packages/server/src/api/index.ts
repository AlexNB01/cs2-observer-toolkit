import type { FastifyInstance } from "fastify";
import { registerHudSettingsRoutes } from "./hud-settings.js";
import { registerSystemRoutes } from "./system.js";
import { registerObserverRoutes } from "./observer.js";
import { registerHlaeRoutes } from "./hlae.js";
import { registerCinematicRoutes } from "./cinematic.js";
import { registerBackupRoutes } from "./backup.js";

export function registerApiRoutes(app: FastifyInstance): void {
  registerHudSettingsRoutes(app);
  registerSystemRoutes(app); // GSI Setup
  registerObserverRoutes(app); // Smart Auto Observer
  registerHlaeRoutes(app); // HLAE
  registerCinematicRoutes(app); // cinematic freezetime cameras
  registerBackupRoutes(app); // export/import everything above
}
