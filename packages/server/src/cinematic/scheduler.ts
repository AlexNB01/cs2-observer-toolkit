import type { CinematicCameraShot, CinematicShot, GsiPayload } from "@cs2hud/shared";
import { listCinematicShots } from "../db/cinematic-store.js";
import { broadcast } from "../ws/hub.js";
import { sendConsoleCommand, specPlayerByName } from "../observer/netconsole.js";
import { resetAutoSwitchState, suppressAutoSwitchUntil } from "../observer/auto-switch.js";
import { getObserverQueue } from "../gsi/observer.js";
import { aliasName } from "./cfg.js";

const SHOT_GAP_MS = 5000; // freezetime sequence: time each of the 2 shots stays up
const BOMB_PLANT_SHOT_DURATION_MS = 4000;
const BOMB_PLANT_MAX_DISTANCE_UNITS = 1500; // skip if no captured shot is anywhere near the plant
const QUIET_MOMENT_SHOT_DURATION_MS = 4000;
const QUIET_MOMENT_COOLDOWN_MS = 45_000; // shared across all three triggers, so filler shots don't stack right after a real one
const QUIET_SCORE_THRESHOLD = 30; // ambient proximity/decaying-engaging routinely sits in the 20s even when nothing's actually happening — 20 almost never triggered
const QUIET_PRESENCE_RADIUS_UNITS = 700;

let lastRoundWinner: "CT" | "T" | null = null;
let lastCinematicActivityAt = 0;

/** Called on every round_end so the next freezetime knows which side to show first. */
export function recordRoundEnd(winningTeam?: "CT" | "T"): void {
  if (winningTeam) lastRoundWinner = winningTeam;
}

function specGotoCommand(shot: CinematicCameraShot): string {
  return `spec_mode 6; spec_goto ${shot.x} ${shot.y} ${shot.z} ${shot.pitch} ${shot.yaw}`;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function parsePosition(raw: string | undefined): Vec3 | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  const [x, y, z] = parts as [number, number, number];
  return { x, y, z };
}

function distance3d(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * spec_mode 6 (ROAMING, used by every trigger below) is a detached free
 * camera with no player target — a later spec_player alone doesn't pull
 * the view out of it, the game just accepts the target and ignores it
 * until the *mode* itself changes. So this explicitly forces first-person
 * mode back on (spec_mode 1) together with an immediate spec_player for
 * whoever's currently top-ranked, rather than waiting for the next
 * natural auto-switch tick to (uselessly) send spec_player alone. Also
 * resets auto-switch's "who we're watching" tracker, since it never heard
 * about any of this — otherwise, if the top-ranked player is unchanged
 * from before the cinematic shot (common — nothing scores during
 * freezetime, and a bomb-plant/quiet-moment shot is short), it would
 * think it's already watching them and skip sending anything on future
 * ticks too.
 */
function handBackToObserver(): void {
  const top = getObserverQueue()[0];
  if (top) {
    sendConsoleCommand("spec_mode 1");
    specPlayerByName(top.playerName);
  }
  resetAutoSwitchState();
}

function fireShot(shot: CinematicShot, trigger: "freezetime" | "bomb_plant" | "quiet_moment"): void {
  const autoTriggered = sendConsoleCommand(specGotoCommand(shot.shot));
  broadcast({ kind: "cinematic_cue", trigger, label: shot.label, execCommand: aliasName(shot), autoTriggered });
  lastCinematicActivityAt = Date.now();
}

/**
 * "Order tied to the previous round": the side that just won gets the
 * first cinematic shot, then the other side, before handing control back
 * to the Smart Observer. Rotates through whichever shots are captured for
 * each side (round number modulo the pool size) so a match shows
 * different angles over time rather than the same two every round.
 */
export function maybeRunCinematicSequence(mapName: string | undefined, roundNumber: number | undefined, enabled: boolean): void {
  if (!enabled || !mapName) return;

  const shots = listCinematicShots(mapName);
  const ctShots = shots.filter((s) => s.slot === "ct");
  const tShots = shots.filter((s) => s.slot === "t");
  if (ctShots.length === 0 || tShots.length === 0) return;

  const round = roundNumber ?? 0;
  const picks: Record<"CT" | "T", CinematicShot> = {
    CT: ctShots[round % ctShots.length]!,
    T: tShots[round % tShots.length]!,
  };

  const first = lastRoundWinner ?? "CT";
  const second = first === "CT" ? "T" : "CT";
  const order: ("CT" | "T")[] = [first, second];

  suppressAutoSwitchUntil(Date.now() + order.length * SHOT_GAP_MS + 500);

  order.forEach((team, i) => {
    setTimeout(() => fireShot(picks[team], "freezetime"), i * SHOT_GAP_MS);
  });

  setTimeout(handBackToObserver, order.length * SHOT_GAP_MS);
}

/**
 * Called on bomb_planting (the plant *starting*, not finishing — the ~3s
 * plant animation itself is the moment worth cutting to an establishing
 * shot for, not just the aftermath) — cuts to whichever captured shot (any
 * slot) is nearest the plant, then hands back.
 */
export function maybeShowBombPlantShot(mapName: string | undefined, bombPosition: string | undefined, enabled: boolean): void {
  if (!enabled || !mapName) return;

  const plantPos = parsePosition(bombPosition);
  if (!plantPos) return;

  let nearest: { shot: CinematicShot; distance: number } | null = null;
  for (const shot of listCinematicShots(mapName)) {
    const shotPos: Vec3 = shot.shot;
    const distance = distance3d(plantPos, shotPos);
    if (distance > BOMB_PLANT_MAX_DISTANCE_UNITS) continue;
    if (!nearest || distance < nearest.distance) nearest = { shot, distance };
  }
  if (!nearest) return;

  suppressAutoSwitchUntil(Date.now() + BOMB_PLANT_SHOT_DURATION_MS + 500);
  fireShot(nearest.shot, "bomb_plant");
  setTimeout(handBackToObserver, BOMB_PLANT_SHOT_DURATION_MS);
}

/**
 * Opportunistic filler: while a round is live, if nobody has a meaningful
 * Smart Observer score right now (nothing's happening) and there are
 * actually players near a captured "poi" shot (mid, or anywhere else that
 * isn't spawn/bombsite-plant-tied), cut to it briefly before handing back
 * — like a broadcast director filling a lull rather than staring at an
 * empty duel queue. Gated by a shared cooldown so this can't fire right
 * after (or repeatedly stack with) a freezetime/bomb-plant shot.
 */
export function maybeShowQuietMomentShot(payload: GsiPayload, enabled: boolean): void {
  if (!enabled) return;
  if (Date.now() - lastCinematicActivityAt < QUIET_MOMENT_COOLDOWN_MS) return;

  const phase = payload.phase_countdowns?.phase ?? payload.round?.phase;
  if (phase !== "live") return;

  const mapName = payload.map?.name;
  if (!mapName) return;

  const top = getObserverQueue()[0];
  if (top && top.priority >= QUIET_SCORE_THRESHOLD) return;

  const poiShots = listCinematicShots(mapName).filter((s) => s.slot === "poi");
  if (poiShots.length === 0) return;

  const alivePlayers = Object.values(payload.allplayers ?? {}).filter((p) => (p.state?.health ?? 0) > 0);

  let nearest: { shot: CinematicShot; distance: number } | null = null;
  for (const shot of poiShots) {
    const shotPos: Vec3 = shot.shot;
    for (const player of alivePlayers) {
      const pos = parsePosition(player.position);
      if (!pos) continue;
      const distance = distance3d(shotPos, pos);
      if (distance > QUIET_PRESENCE_RADIUS_UNITS) continue;
      if (!nearest || distance < nearest.distance) nearest = { shot, distance };
    }
  }
  if (!nearest) return;

  suppressAutoSwitchUntil(Date.now() + QUIET_MOMENT_SHOT_DURATION_MS + 500);
  fireShot(nearest.shot, "quiet_moment");
  setTimeout(handBackToObserver, QUIET_MOMENT_SHOT_DURATION_MS);
}
