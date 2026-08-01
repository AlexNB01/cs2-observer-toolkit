import { useEffect, useState } from "react";
import type { Player, Team } from "@cs2hud/shared";
import { api } from "./api-client.js";

/** Polls players/teams periodically — roster edits are rare, unlike GSI state. */
export function useRoster() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    function reload() {
      api.get<Player[]>("/players").then(setPlayers).catch(console.error);
      api.get<Team[]>("/teams").then(setTeams).catch(console.error);
    }
    reload();
    const poll = setInterval(reload, 5000);
    return () => clearInterval(poll);
  }, []);

  return { players, teams };
}
