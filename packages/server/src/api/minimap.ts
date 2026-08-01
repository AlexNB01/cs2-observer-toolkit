import type { FastifyInstance } from "fastify";
import { RADAR_CALIBRATION, worldToRadarNormalized } from "@cs2hud/shared";
import { getLatestGsiState } from "../gsi/listener.js";

/**
 * Section 9 — MiniMap. Projects each player's GSI world position onto the
 * radar image (normalized 0-1 coordinates) using the per-map calibration
 * in @cs2hud/shared/radar.ts. Altitude (Z) is ignored — see that file's
 * doc comment for what that means on multi-level maps. Actual radar
 * *images* aren't bundled (Valve IP) — the frontend falls back to a
 * placeholder background until you supply your own.
 */
export function registerMinimapRoutes(app: FastifyInstance): void {
  app.get("/api/minimap/state", async () => {
    const { payload } = getLatestGsiState();
    const mapName = payload?.map?.name ?? null;
    const calibration = mapName ? RADAR_CALIBRATION[mapName] : undefined;

    const ctSlots: string[] = [];
    const tSlots: string[] = [];

    const players = Object.entries(payload?.allplayers ?? {}).map(([steamId, p]) => {
      const parsed = p.position?.split(",").map(Number);
      const worldX = parsed?.[0];
      const worldY = parsed?.[1];
      const projected =
        calibration && worldX !== undefined && worldY !== undefined && !Number.isNaN(worldX) && !Number.isNaN(worldY)
          ? worldToRadarNormalized(worldX, worldY, calibration)
          : null;

      // Slot number shown on the dot — position within its team as GSI
      // enumerates allplayers. Not CS2's own observer-slot numbering (GSI
      // doesn't expose that), but stable and good enough as a "who's who"
      // label between the radar and the roster panels.
      const slots = p.team === "CT" ? ctSlots : tSlots;
      slots.push(steamId);

      return {
        steamId,
        team: p.team,
        alive: (p.state?.health ?? 0) > 0,
        xPct: projected?.xPct ?? null,
        yPct: projected?.yPct ?? null,
        slot: slots.length,
      };
    });

    const bombParsed = payload?.bomb?.position?.split(",").map(Number);
    const bombX = bombParsed?.[0];
    const bombY = bombParsed?.[1];
    const bombProjected =
      calibration && bombX !== undefined && bombY !== undefined && !Number.isNaN(bombX) && !Number.isNaN(bombY)
        ? worldToRadarNormalized(bombX, bombY, calibration)
        : null;

    const bomb =
      payload?.bomb && bombProjected
        ? { state: payload.bomb.state, xPct: bombProjected.xPct, yPct: bombProjected.yPct }
        : null;

    return { mapName, calibrated: Boolean(calibration), players, bomb, observedSteamId: payload?.player?.steamid ?? null };
  });
}
