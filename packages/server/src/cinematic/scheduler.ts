import type { CinematicCameraShot } from "@cs2hud/shared";
import { getCinematicCameras } from "../db/cinematic-store.js";
import { broadcast } from "../ws/hub.js";
import { sendConsoleCommand, specPlayerByName } from "../observer/netconsole.js";
import { resetAutoSwitchState } from "../observer/auto-switch.js";
import { getObserverQueue } from "../gsi/observer.js";

const SHOT_GAP_MS = 5000;

let lastRoundWinner: "CT" | "T" | null = null;

/** Called on every round_end so the next freezetime knows which side to show first. */
export function recordRoundEnd(winningTeam?: "CT" | "T"): void {
  if (winningTeam) lastRoundWinner = winningTeam;
}

function specGotoCommand(shot: CinematicCameraShot): string {
  return `spec_mode 6; spec_goto ${shot.x} ${shot.y} ${shot.z} ${shot.pitch} ${shot.yaw}`;
}

/**
 * "Order tied to the previous round": the side that just won gets the
 * first cinematic shot, then the other side, before handing control back
 * to the Smart Observer. Sends the spec_goto command straight over CS2's
 * netconsole (same connection Smart Auto Observer's auto-switch uses) —
 * this moves the camera itself. Falls back to a manual cue (the
 * `cinematic_ct`/`cinematic_t` alias from an installed cinematic.cfg, for
 * a keybind) when netconsole isn't connected.
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
    const shot = team === "CT" ? cameras.ctShot! : cameras.tShot!;
    setTimeout(() => {
      const autoTriggered = sendConsoleCommand(specGotoCommand(shot));
      broadcast({ kind: "cinematic_cue", side, sequenceIndex: i as 0 | 1, execCommand: `cinematic_${side}`, autoTriggered });
    }, i * SHOT_GAP_MS);
  });

  // Hand control back to Smart Auto Observer once both shots have shown.
  // spec_mode 6 (ROAMING, above) is a detached free camera with no player
  // target — a later spec_player alone doesn't pull the view out of it,
  // the game just accepts the target and ignores it until the *mode*
  // itself changes. So this explicitly forces first-person mode back on
  // (spec_mode 1) together with an immediate spec_player for whoever's
  // currently top-ranked, rather than just waiting for the next natural
  // auto-switch tick to (uselessly) send spec_player alone. Also resets
  // auto-switch's "who we're watching" tracker, since it never heard
  // about any of this — otherwise, if the top-ranked player is unchanged
  // from before freezetime (the common case, nothing scores during
  // freezetime), it would think it's already watching them and skip
  // sending anything on future ticks too.
  setTimeout(() => {
    const top = getObserverQueue()[0];
    if (top) {
      sendConsoleCommand("spec_mode 1");
      specPlayerByName(top.playerName);
    }
    resetAutoSwitchState();
  }, order.length * SHOT_GAP_MS);
}
