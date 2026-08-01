import type { FastifyInstance } from "fastify";
import type { ObserverQueueItem } from "@cs2hud/shared";
import { getObserverQueue } from "../gsi/observer.js";
import { getNetconsoleStatus } from "../observer/netconsole.js";

/**
 * Section 5 — Smart Auto Observer. Scoring (gsi/observer.ts) is real, and
 * auto-switch (observer/*) sends `spec_player "<name>"` over CS2's
 * netconsole (observer/netconsole.ts) — addressing the target by name
 * directly, so unlike the earlier simulated-keypress approach there's no
 * per-player slot to learn and no calibration step.
 */
export function registerObserverRoutes(app: FastifyInstance): void {
  app.get("/api/observer/queue", async (): Promise<ObserverQueueItem[]> => getObserverQueue());

  app.get("/api/observer/netconsole-status", async () => getNetconsoleStatus());
}
