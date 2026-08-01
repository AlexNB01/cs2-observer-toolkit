import type { FastifyInstance } from "fastify";
import { registerPlayerRoutes } from "./players.js";
import { registerTeamRoutes } from "./teams.js";
import { registerThemeRoutes } from "./themes.js";
import { registerHudSettingsRoutes } from "./hud-settings.js";
import { registerSystemRoutes } from "./system.js";
import { registerVetoRoutes } from "./veto.js";
import { registerStatsRoutes } from "./stats.js";
import { registerObserverRoutes } from "./observer.js";
import { registerObsRoutes } from "./obs.js";
import { registerMinimapRoutes } from "./minimap.js";
import { registerHlaeRoutes } from "./hlae.js";
import { registerCinematicRoutes } from "./cinematic.js";

export function registerApiRoutes(app: FastifyInstance): void {
  registerPlayerRoutes(app); // section 10
  registerTeamRoutes(app); // section 11
  registerThemeRoutes(app); // section 4
  registerHudSettingsRoutes(app); // sections 2, 3, 5, 9, 13
  registerSystemRoutes(app); // section 1
  registerVetoRoutes(app); // section 13
  registerStatsRoutes(app); // section 7
  registerObserverRoutes(app); // section 5
  registerObsRoutes(app); // section 8
  registerMinimapRoutes(app); // section 9
  registerHlaeRoutes(app); // section 12
  registerCinematicRoutes(app); // section 5 — cinematic freezetime cameras
}
