import type { GsiPayload, NormalizedEvent } from "@cs2hud/shared";

/**
 * Best-effort diff-based normalizer. CS2's GSI feed has no explicit
 * "kill"/"round_start" events — only state snapshots — so events are
 * inferred by comparing the previous payload to the current one.
 *
 * Known limitations (see spec section 15 — verify against the official
 * GSI docs before relying on these for anything precision-critical):
 *  - GSI never pairs an attacker with a victim directly. Kills are
 *    inferred from a per-player match_stats.kills increase, and the
 *    victim from a health->0 transition in the same diff. The attacker
 *    identity itself is always correct — it's a direct stat increase — but
 *    when a payload batches more than one kill, WHICH death goes with
 *    which attacker is inferred by matching each attacker to an
 *    opposite-team death (a kill can't credit a teammate), which is right
 *    far more often than pure array order but still can't fully
 *    disambiguate e.g. two CTs killed in the same tick by two Ts — GSI
 *    just doesn't carry enough information to do better than that.
 *  - `position` is only present for the observed player unless
 *    allplayers_position is requested, and even then can lag a tick.
 */
export function normalizeGsiPayload(current: GsiPayload, previous: GsiPayload | null): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const timestamp = Date.now();

  events.push({ type: "state_snapshot", timestamp, raw: current });

  if (!previous) {
    events.push({ type: "match_start", timestamp });
    return events;
  }

  const prevPhase = previous.round?.phase;
  const currPhase = current.round?.phase;
  if (currPhase && currPhase !== prevPhase) {
    if (currPhase === "freezetime") {
      events.push({ type: "freezetime_start", timestamp });
    } else if (currPhase === "live" && prevPhase === "freezetime") {
      events.push({ type: "round_start", timestamp });
    } else if (currPhase === "over") {
      events.push({ type: "round_end", timestamp, winningTeam: current.round?.win_team });
    }
  }

  const prevBomb = previous.bomb?.state;
  const currBomb = current.bomb?.state;
  if (currBomb && currBomb !== prevBomb) {
    if (currBomb === "planted") events.push({ type: "bomb_planted", timestamp, playerSteamId: current.bomb?.player });
    if (currBomb === "defused") events.push({ type: "bomb_defused", timestamp, playerSteamId: current.bomb?.player });
    if (currBomb === "exploded") events.push({ type: "bomb_exploded", timestamp });
  }

  const prevPlayers = previous.allplayers ?? {};
  const currPlayers = current.allplayers ?? {};

  const killCandidates: { steamId: string; headshot: boolean; team: "CT" | "T" }[] = [];
  const newlyDead: { steamId: string; team: "CT" | "T" }[] = [];

  for (const [steamId, player] of Object.entries(currPlayers)) {
    const prevPlayer = prevPlayers[steamId];

    const prevKills = prevPlayer?.match_stats?.kills ?? 0;
    const currKills = player.match_stats?.kills ?? 0;
    if (currKills > prevKills) {
      const prevHs = prevPlayer?.state?.round_killhs ?? 0;
      const currHs = player.state?.round_killhs ?? 0;
      killCandidates.push({ steamId, headshot: currHs > prevHs, team: player.team });
    }

    if (prevPlayer) {
      const prevHealth = prevPlayer.state?.health ?? 100;
      const currHealth = player.state?.health ?? 100;
      if (prevHealth > 0 && currHealth === 0) {
        newlyDead.push({ steamId, team: player.team });
      }
    }

    const prevMvps = prevPlayer?.match_stats?.mvps ?? 0;
    const currMvps = player.match_stats?.mvps ?? 0;
    if (currMvps > prevMvps) {
      events.push({ type: "mvp", timestamp, playerSteamId: steamId });
    }
  }

  // Prefer matching each attacker to an opposite-team death (a kill can't
  // credit a teammate) over raw array order — see the file doc comment.
  const unmatchedDead = [...newlyDead];
  for (const candidate of killCandidates) {
    const enemyTeam = candidate.team === "CT" ? "T" : "CT";
    const enemyIndex = unmatchedDead.findIndex((d) => d.team === enemyTeam);
    const victim = enemyIndex !== -1 ? unmatchedDead.splice(enemyIndex, 1)[0] : unmatchedDead.shift();

    events.push({
      type: "kill",
      timestamp,
      attackerSteamId: candidate.steamId,
      victimSteamId: victim?.steamId,
      headshot: candidate.headshot,
    });
  }

  return events;
}
