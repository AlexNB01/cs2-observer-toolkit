import type { VetoMatch } from "@cs2hud/shared";
import { env } from "../config/env.js";

interface FaceitMatchResponse {
  teams?: {
    faction1?: { name?: string };
    faction2?: { name?: string };
  };
  voting?: {
    map?: {
      pick?: string[];
    };
  };
}

export function extractFaceitMatchId(url: string): string | null {
  const match = url.match(/faceit\.com\/[a-z-]+\/cs2\/room\/([^/?#]+)/i) ?? url.match(/room\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

// Faceit returns map class_names (e.g. "de_mirage"); the veto UI's map
// picker uses display names. Falls back to the raw class_name if unknown
// (e.g. a map outside the current competitive pool).
const MAP_DISPLAY_NAMES: Record<string, string> = {
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_dust2: "Dust II",
  de_inferno: "Inferno",
  de_mirage: "Mirage",
  de_nuke: "Nuke",
  de_train: "Train",
};

function toDisplayMapName(classNameOrDisplay: string): string {
  return MAP_DISPLAY_NAMES[classNameOrDisplay] ?? classNameOrDisplay;
}

/**
 * Pulls team names and the decided map from Faceit's public Data API
 * (https://docs.faceit.com/api/data/). Faceit's docs confirm the match
 * response has a `voting` field but don't document a per-step ban/pick
 * sequence with team attribution — only the final teams and decided map
 * are reliably extracted here. Use manual veto entry for the full ban
 * order.
 */
export async function importFaceitMatch(url: string): Promise<Partial<VetoMatch>> {
  if (!env.faceitApiKey) {
    throw new Error("FACEIT_API_KEY is not set — get one from https://developers.faceit.com/apps and add it to server/.env.");
  }

  const matchId = extractFaceitMatchId(url);
  if (!matchId) {
    throw new Error("Couldn't find a match id in that URL — expected something like https://www.faceit.com/en/cs2/room/<id>.");
  }

  const res = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}`, {
    headers: { Authorization: `Bearer ${env.faceitApiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Faceit API returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as FaceitMatchResponse;
  return {
    source: "faceit",
    sourceUrl: url,
    teamAName: data.teams?.faction1?.name ?? "Team A",
    teamBName: data.teams?.faction2?.name ?? "Team B",
    decidingMap: data.voting?.map?.pick?.[0] ? toDisplayMapName(data.voting.map.pick[0]) : undefined,
    actions: [],
  };
}
