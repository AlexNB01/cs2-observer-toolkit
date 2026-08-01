import type { FastifyInstance } from "fastify";
import type { PlayerStatsCard, StatsProvider } from "@cs2hud/shared";
import { getLatestGsiState } from "../gsi/listener.js";
import { getFaceitPlayerStatsBySteamId } from "../stats/faceit.js";

/**
 * Section 7 — player stats card. "live" is served from the current GSI
 * payload; "faceit" calls Faceit's public Data API (needs FACEIT_API_KEY).
 */
export function registerStatsRoutes(app: FastifyInstance): void {
  app.get("/api/stats/:steamId", async (request, reply) => {
    const { steamId } = request.params as { steamId: string };
    const { provider = "live" } = request.query as { provider?: StatsProvider };

    if (provider === "live") {
      const { payload } = getLatestGsiState();
      const player = payload?.allplayers?.[steamId];
      if (!player) {
        return reply.code(404).send({ error: "player not found on current server" });
      }
      const card: PlayerStatsCard = {
        provider: "live",
        steamId,
        nickname: player.name,
        kd: player.match_stats ? player.match_stats.kills / Math.max(1, player.match_stats.deaths) : undefined,
        winRatePct: undefined,
        adr: undefined,
        hsPct: undefined,
      };
      return card;
    }

    if (provider === "faceit") {
      try {
        return await getFaceitPlayerStatsBySteamId(steamId);
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }

    return reply.code(400).send({ error: `Unknown provider "${provider}".` });
  });
}
