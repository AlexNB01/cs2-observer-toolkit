import { getCinematicCameras } from "../db/cinematic-store.js";
import { broadcast } from "../ws/hub.js";

const SHOT_GAP_MS = 5000;

let lastRoundWinner: "CT" | "T" | null = null;

/** Called on every round_end so the next freezetime knows which side to show first. */
export function recordRoundEnd(winningTeam?: "CT" | "T"): void {
  if (winningTeam) lastRoundWinner = winningTeam;
}

/**
 * Section 5 — "order tied to the previous round": the side that just won
 * gets the first cinematic shot, then the other side, before handing
 * control back to the Smart Observer. This only broadcasts a *cue* (which
 * side, which exec alias) — actually moving the in-game camera still
 * needs the user to run that alias (bound to a key) or the native
 * key-sim companion process from spec section 15; there's no way to
 * inject console input into CS2 from a browser.
 */
export function maybeRunCinematicSequence(mapName: string | undefined, enabled: boolean): void {
  if (!enabled || !mapName) return;

  const cameras = getCinematicCameras(mapName);
  if (!cameras?.ctShot || !cameras?.tShot) return;

  const first = lastRoundWinner ?? "CT";
  const second = first === "CT" ? "T" : "CT";
  const order: ("CT" | "T")[] = [first, second];

  order.forEach((team, i) => {
    const side = team === "CT" ? "ct" : "t";
    setTimeout(() => {
      broadcast({ kind: "cinematic_cue", side, sequenceIndex: i as 0 | 1, execCommand: `cinematic_${side}` });
    }, i * SHOT_GAP_MS);
  });
}
