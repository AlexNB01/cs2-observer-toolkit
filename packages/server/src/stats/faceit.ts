import type { PlayerStatsCard } from "@cs2hud/shared";
import { env } from "../config/env.js";

const FACEIT_GAME_ID = "cs2";

interface FaceitPlayerDetails {
  player_id: string;
  nickname: string;
  avatar?: string;
  games?: Record<string, { skill_level?: number; faceit_elo?: number }>;
}

interface FaceitMapSegment {
  label: string;
  type: string;
  stats?: Record<string, string>;
}

interface FaceitPlayerStats {
  lifetime?: Record<string, string | string[]>;
  segments?: FaceitMapSegment[];
}

async function faceitGet<T>(path: string): Promise<T> {
  if (!env.faceitApiKey) {
    throw new Error("FACEIT_API_KEY is not set — get one from https://developers.faceit.com/apps and add it to server/.env.");
  }
  const res = await fetch(`https://open.faceit.com/data/v4${path}`, {
    headers: { Authorization: `Bearer ${env.faceitApiKey}` },
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "No Faceit account found for that SteamID." : `Faceit API returned ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Looks up a player by SteamID64 via Faceit's public Data API and returns
 * lifetime CS2 stats. Field names (the odd "Average K/D Ratio" / "Win Rate %"
 * string keys) come from a real example response for
 * GET /players/{id}/stats/{game_id} — see
 * https://github.com/kallelundgren93/faceit-ruby/blob/master/README.md
 * (checked 2026-08-01; Faceit doesn't otherwise document exact field names).
 * ADR isn't exposed by this API, so PlayerStatsCard.adr stays unset.
 */
export async function getFaceitPlayerStatsBySteamId(steamId: string): Promise<PlayerStatsCard> {
  const player = await faceitGet<FaceitPlayerDetails>(`/players?game=${FACEIT_GAME_ID}&game_player_id=${steamId}`);
  const gameProfile = player.games?.[FACEIT_GAME_ID];
  const stats = await faceitGet<FaceitPlayerStats>(`/players/${player.player_id}/stats/${FACEIT_GAME_ID}`);

  const lifetime = stats.lifetime ?? {};
  const mapSegments = (stats.segments ?? []).filter((s) => s.type === "Map");

  const mapWinRates: Record<string, number> = {};
  for (const segment of mapSegments) {
    const winRate = numberOrUndefined(segment.stats?.["Win Rate %"]);
    if (winRate !== undefined) mapWinRates[segment.label] = winRate;
  }

  let bestMap: string | undefined;
  let bestWinRate = -1;
  for (const [map, winRate] of Object.entries(mapWinRates)) {
    if (winRate > bestWinRate) {
      bestWinRate = winRate;
      bestMap = map;
    }
  }

  return {
    provider: "faceit",
    steamId,
    nickname: player.nickname,
    avatarUrl: player.avatar,
    elo: gameProfile?.faceit_elo,
    winRatePct: numberOrUndefined(lifetime["Win Rate %"]),
    kd: numberOrUndefined(lifetime["Average K/D Ratio"]),
    hsPct: numberOrUndefined(lifetime["Average Headshots %"]),
    bestMap,
    mapWinRates,
  };
}
