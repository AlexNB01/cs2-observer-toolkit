import type { CinematicShot, GsiPayload } from "@cs2hud/shared";
import { listCinematicShots } from "../db/cinematic-store.js";
import { broadcast } from "../ws/hub.js";
import { sendConsoleCommand, specPlayerByName } from "../observer/netconsole.js";
import { resetAutoSwitchState, setAutoSwitchTarget, suppressAutoSwitchUntil } from "../observer/auto-switch.js";
import { getObserverQueue } from "../gsi/observer.js";
import { aliasName, shotCommand } from "./cfg.js";

const SHOT_GAP_MS = 5000; // freezetime sequence: time each of the 2 shots stays up
const BOMB_PLANT_SHOT_DURATION_MS = 4000; // roughly matches the ~3.2s plant animation
// CS2's actual defuse timer — 5s with a kit, 10s without. The shot stays up
// for the whole defuse (not just a quick establishing cut) since this
// trigger only ever fires when it's genuinely uncontested — there's
// nothing else worth cutting to in the meantime.
const BOMB_DEFUSE_SHOT_DURATION_WITH_KIT_MS = 5000;
const BOMB_DEFUSE_SHOT_DURATION_NO_KIT_MS = 10_000;
const BOMB_SITE_MAX_DISTANCE_UNITS = 1500; // skip if no captured shot is anywhere near the plant/defuse
// If a CT is already this close when the plant starts, the site is
// contested right from the start — skip the establishing shot entirely
// rather than risk missing the retake fight while staring at an establishing shot
// (the same reasoning as maybeShowBombDefuseShot only firing when the
// defuse is uncontested, just checked at the start instead of throughout).
// Tighter than observer.ts's PROXIMITY_RANGE_UNITS (1200, "somewhere in the
// area, maybe behind a wall") since this needs to mean "realistically
// already fighting over the site," not just "on that side of the map."
const BOMB_PLANT_CONTEST_RADIUS_UNITS = 500;
const QUIET_MOMENT_SHOT_DURATION_MS = 4000;
const QUIET_MOMENT_COOLDOWN_MS = 45_000; // shared across all three triggers, so filler shots don't stack right after a real one
const QUIET_SCORE_THRESHOLD = 30; // ambient proximity/decaying-engaging routinely sits in the 20s even when nothing's actually happening — 20 almost never triggered
// The top score dipping under QUIET_SCORE_THRESHOLD for a single tick isn't
// actually a lull — decaying scores (engaging, kills) naturally sag between
// discrete events even mid-fight, e.g. the gap between two shots. Requiring
// it to stay under the threshold for this long before triggering filler is
// the same idea as auto-switch's MIN_DWELL_MS: without it, one unlucky tick
// could cut away from a genuinely live fight for the full shot duration.
const QUIET_MIN_DWELL_MS = 3_000;
const QUIET_PRESENCE_RADIUS_UNITS = 700;

let lastRoundWinner: "CT" | "T" | null = null;
let lastCinematicActivityAt = 0;
// When the top score first dropped under QUIET_SCORE_THRESHOLD, or null if
// it's currently at/above threshold (or the round isn't live) — see
// QUIET_MIN_DWELL_MS.
let quietSince: number | null = null;

// Tracks the bomb-plant establishing shot specifically (not freezetime/
// defuse/quiet-moment) so it can be cut short from outside its own
// setTimeout: either canceled outright (the plant got interrupted before
// finishing — see cancelBombPlantShot) or overridden by a shooter cutting
// loose on the planter (see maybeRedirectToShooterDuringBombPlant). Neither
// case applies to the defuse shot: it only ever fires once the enemy team
// is already fully dead, so there's nobody left who could cancel it or
// shoot at the defuser.
let bombPlantHandback: ReturnType<typeof setTimeout> | null = null;
let activeBombPlant: { planterSteamId: string; enemyTeam: "CT" | "T" } | null = null;

// Pending timers for the freezetime CT/T sequence (see
// maybeRunCinematicSequence) — cleared and handed back immediately on
// round_start (see cancelFreezetimeSequence). The sequence's own total
// duration is a wall-clock guess (each shot's actual camera-path length,
// summed) that has no relationship to the server's real mp_freezetime —
// GSI never exposes that cvar — so a couple of long camera paths can
// easily add up to more than freezetime actually lasts. Without this, the
// second shot would get cut short by whatever else reacts to the round
// going live, rather than a clean, intentional hand-back timed to the
// genuine end of freezetime.
let freezetimeSequenceTimers: ReturnType<typeof setTimeout>[] = [];

/** Called on every round_end so the next freezetime knows which side to show first. */
export function recordRoundEnd(winningTeam?: "CT" | "T"): void {
  if (winningTeam) lastRoundWinner = winningTeam;
}

/** Called on round_start — ends the freezetime sequence right now if any of it is still pending/on screen. */
export function cancelFreezetimeSequence(): void {
  if (freezetimeSequenceTimers.length === 0) return;
  for (const t of freezetimeSequenceTimers) clearTimeout(t);
  freezetimeSequenceTimers = [];
  suppressAutoSwitchUntil(0);
  handBackToObserver();
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
  sendConsoleCommand("mirv_campath enabled 0");
  const top = getObserverQueue()[0];
  if (top) {
    sendConsoleCommand("spec_mode 1");
    specPlayerByName(top.playerName);
  }
  resetAutoSwitchState();
}

function fireShot(shot: CinematicShot, trigger: "freezetime" | "bomb_plant" | "bomb_defuse" | "quiet_moment" | "manual"): void {
  const autoTriggered = sendConsoleCommand(shotCommand(shot));
  broadcast({ kind: "cinematic_cue", trigger, label: shot.label, execCommand: aliasName(shot), autoTriggered });
  lastCinematicActivityAt = Date.now();
}

/**
 * How long to hold `shot` on screen before cutting away or handing back —
 * its camera path's actual length (parsed from its keyframes at import
 * time), so it's neither cut off mid-motion nor left sitting still once
 * it's finished. Falls back to the trigger's usual fixed duration if the
 * path's length couldn't be parsed.
 */
function shotDurationMs(shot: CinematicShot, fallbackMs: number): number {
  return shot.campathDurationMs && shot.campathDurationMs > 0 ? shot.campathDurationMs : fallbackMs;
}

/**
 * Fires a saved shot right now, bypassing every automatic trigger — for
 * testing a captured shot's camera path against a live match, or
 * for a human director cutting to it on demand instead of waiting for
 * freezetime/bomb-plant/quiet-moment to happen to line up. Unlike the
 * automatic triggers, there's no known duration to hold it for, so
 * auto-switch is suppressed indefinitely rather than for a fixed window —
 * stopManualShot() (not a timer) is what hands the camera back.
 */
export function fireShotManually(shot: CinematicShot): void {
  suppressAutoSwitchUntil(Number.MAX_SAFE_INTEGER);
  fireShot(shot, "manual");
}

/** Ends a manually-fired shot (see fireShotManually) and hands the camera back to the observer. */
export function stopManualShot(): void {
  suppressAutoSwitchUntil(0);
  handBackToObserver();
}

/**
 * Shared by the plant and defuse triggers: cut to whichever captured shot
 * (any slot) is nearest `position`, then hand back after durationMs.
 * `bombPlantContext` is only passed for the plant trigger — it records who's
 * planting and their enemy team so cancelBombPlantShot/
 * maybeRedirectToShooterDuringBombPlant can find and cut short this exact
 * shot later, before its own timer would otherwise hand back naturally.
 */
function showNearestBombSiteShot(
  mapName: string,
  position: Vec3,
  trigger: "bomb_plant" | "bomb_defuse",
  fallbackDurationMs: number,
  bombPlantContext?: { planterSteamId: string; enemyTeam: "CT" | "T" }
): void {
  let nearest: { shot: CinematicShot; distance: number } | null = null;
  for (const shot of listCinematicShots(mapName)) {
    // A shot whose camera path had no parseable position can't be
    // distance-matched — it only ever fires via freezetime rotation or a
    // manual "Fire now" click (see cinematic-store.ts's saveCinematicShot).
    if (!shot.position) continue;
    const distance = distance3d(position, shot.position);
    if (distance > BOMB_SITE_MAX_DISTANCE_UNITS) continue;
    if (!nearest || distance < nearest.distance) nearest = { shot, distance };
  }
  if (!nearest) return;

  const durationMs = shotDurationMs(nearest.shot, fallbackDurationMs);
  suppressAutoSwitchUntil(Date.now() + durationMs + 500);
  fireShot(nearest.shot, trigger);

  if (bombPlantContext) {
    activeBombPlant = bombPlantContext;
    bombPlantHandback = setTimeout(() => {
      activeBombPlant = null;
      bombPlantHandback = null;
      handBackToObserver();
    }, durationMs);
  } else {
    setTimeout(handBackToObserver, durationMs);
  }
}

/**
 * Called on bomb_plant_canceled (the plant interrupted before finishing —
 * planter killed, or they just let go of use). Only does anything if the
 * bomb-plant establishing shot is still actually on screen; cuts it short
 * immediately instead of waiting out BOMB_PLANT_SHOT_DURATION_MS staring at
 * a bomb site nobody's planting at anymore.
 */
export function cancelBombPlantShot(): void {
  if (bombPlantHandback === null) return;
  clearTimeout(bombPlantHandback);
  bombPlantHandback = null;
  activeBombPlant = null;
  suppressAutoSwitchUntil(0);
  handBackToObserver();
}

/**
 * Called every GSI tick with whoever's ammo_clip just dropped (see
 * gsi/observer.ts's getLastTickShooters). If the bomb-plant establishing
 * shot is currently up and one of this tick's shooters is on the planter's
 * enemy team, someone's actively contesting the plant — cut straight to
 * them instead of sitting on the site shot for the rest of its duration.
 * Bypasses handBackToObserver (which would just re-pick the ranked queue's
 * current top, not necessarily the shooter) and instead cuts directly to
 * the shooter and seeds auto-switch's hysteresis with them via
 * setAutoSwitchTarget, so the camera doesn't immediately re-evaluate away
 * from a cut it just made.
 */
export function maybeRedirectToShooterDuringBombPlant(shooterSteamIds: string[], payload: GsiPayload): void {
  if (!activeBombPlant) return;
  const enemyTeam = activeBombPlant.enemyTeam;
  const shooterId = shooterSteamIds.find((id) => payload.allplayers?.[id]?.team === enemyTeam);
  if (!shooterId) return;
  const shooter = payload.allplayers?.[shooterId];
  if (!shooter) return;

  if (bombPlantHandback !== null) clearTimeout(bombPlantHandback);
  bombPlantHandback = null;
  activeBombPlant = null;
  suppressAutoSwitchUntil(0);

  sendConsoleCommand("mirv_campath enabled 0");
  sendConsoleCommand("spec_mode 1");
  specPlayerByName(shooter.name);
  setAutoSwitchTarget(shooterId);
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

  // Each shot's own hold time (its camera path's actual length, or
  // SHOT_GAP_MS if that couldn't be parsed — see shotDurationMs) rather
  // than a fixed gap, so the second shot cuts in exactly when the first
  // one finishes instead of mid-motion or after an awkward pause.
  const durations = order.map((team) => shotDurationMs(picks[team], SHOT_GAP_MS));
  const totalMs = durations.reduce((sum, d) => sum + d, 0);
  const startOffsets = durations.reduce<number[]>((offsets, d, i) => {
    offsets.push(i === 0 ? 0 : offsets[i - 1]! + durations[i - 1]!);
    return offsets;
  }, []);

  suppressAutoSwitchUntil(Date.now() + totalMs + 500);

  // Clears any timers a still-running previous sequence somehow left
  // behind (shouldn't normally happen — round_start already clears these
  // via cancelFreezetimeSequence before the next freezetime can start —
  // but avoids two overlapping sequences fighting over the camera if it
  // ever does).
  for (const t of freezetimeSequenceTimers) clearTimeout(t);
  freezetimeSequenceTimers = order.map((team, i) => setTimeout(() => fireShot(picks[team], "freezetime"), startOffsets[i]));
  freezetimeSequenceTimers.push(
    setTimeout(() => {
      freezetimeSequenceTimers = [];
      handBackToObserver();
    }, totalMs)
  );
}

/**
 * Called on bomb_planting (the plant *starting*, not finishing — the ~3s
 * plant animation itself is the moment worth cutting to an establishing
 * shot for, not just the aftermath) — cuts to whichever captured shot (any
 * slot) is nearest the plant, then hands back. Also records the planter and
 * their enemy team so cancelBombPlantShot/maybeRedirectToShooterDuringBombPlant
 * can react while this shot is up.
 *
 * Skipped entirely if a CT is already within BOMB_PLANT_CONTEST_RADIUS_UNITS
 * of the plant when it starts — that's not a clean establishing-shot moment,
 * it's a fight already happening, and the reactive camera (Smart Observer's
 * BOMB_SITUATIONAL/ENGAGING scoring) is better placed to follow it than a
 * pre-recorded camera path would be.
 */
export function maybeShowBombPlantShot(payload: GsiPayload, enabled: boolean): void {
  if (!enabled) return;
  const mapName = payload.map?.name;
  const bomb = payload.bomb;
  if (!mapName || !bomb?.player) return;

  const planter = payload.allplayers?.[bomb.player];
  const plantPos = parsePosition(bomb.position);
  if (!planter || !plantPos) return;

  const enemyTeam: "CT" | "T" = planter.team === "CT" ? "T" : "CT";

  const contested = Object.values(payload.allplayers ?? {}).some((p) => {
    if (p.team !== enemyTeam || (p.state?.health ?? 0) <= 0) return false;
    const pos = parsePosition(p.position);
    return pos !== undefined && distance3d(plantPos, pos) <= BOMB_PLANT_CONTEST_RADIUS_UNITS;
  });
  if (contested) return;

  showNearestBombSiteShot(mapName, plantPos, "bomb_plant", BOMB_PLANT_SHOT_DURATION_MS, {
    planterSteamId: bomb.player,
    enemyTeam,
  });
}

/**
 * Called on bomb_defusing, but only when the defuser's whole enemy team is
 * already dead — with nobody left to contest it, there's no risk of
 * missing a fight elsewhere by cutting away, so it's a clean broadcast
 * beat rather than a gamble. (While enemies are still alive, the reactive
 * priority in gsi/observer.ts keeps the camera on *them* instead of the
 * defuser — see bumpBombDefuse there.)
 */
export function maybeShowBombDefuseShot(payload: GsiPayload, enabled: boolean): void {
  if (!enabled) return;

  const mapName = payload.map?.name;
  const bomb = payload.bomb;
  if (!mapName || !bomb?.player) return;

  const defuser = payload.allplayers?.[bomb.player];
  const defusePos = parsePosition(bomb.position);
  if (!defuser || !defusePos) return;

  const enemyTeam: "CT" | "T" = defuser.team === "CT" ? "T" : "CT";
  const enemiesAlive = Object.values(payload.allplayers ?? {}).some((p) => p.team === enemyTeam && (p.state?.health ?? 0) > 0);
  if (enemiesAlive) return;

  const durationMs = defuser.state?.defusekit ? BOMB_DEFUSE_SHOT_DURATION_WITH_KIT_MS : BOMB_DEFUSE_SHOT_DURATION_NO_KIT_MS;
  showNearestBombSiteShot(mapName, defusePos, "bomb_defuse", durationMs);
}

/**
 * Opportunistic filler: while a round is live, if nobody has had a
 * meaningful Smart Observer score for at least QUIET_MIN_DWELL_MS (nothing's
 * really happening, not just a one-tick dip mid-fight) and there are
 * actually players near a captured "poi" shot (mid, or anywhere else that
 * isn't spawn/bombsite-plant-tied), cut to it briefly before handing back
 * — like a broadcast director filling a lull rather than staring at an
 * empty duel queue. Gated by a shared cooldown so this can't fire right
 * after (or repeatedly stack with) a freezetime/bomb-plant shot.
 */
export function maybeShowQuietMomentShot(payload: GsiPayload, enabled: boolean): void {
  if (!enabled) return;

  const phase = payload.phase_countdowns?.phase ?? payload.round?.phase;
  if (phase !== "live") {
    quietSince = null;
    return;
  }

  const now = Date.now();
  const top = getObserverQueue()[0];
  if (top && top.priority >= QUIET_SCORE_THRESHOLD) {
    quietSince = null;
    return;
  }

  if (quietSince === null) quietSince = now;
  if (now - quietSince < QUIET_MIN_DWELL_MS) return;

  if (now - lastCinematicActivityAt < QUIET_MOMENT_COOLDOWN_MS) return;

  const mapName = payload.map?.name;
  if (!mapName) return;

  // Same reference-point requirement as showNearestBombSiteShot above — a
  // shot whose camera path had no parseable position can't be distance-matched.
  const poiShots = listCinematicShots(mapName).filter((s) => s.slot === "poi" && s.position);
  if (poiShots.length === 0) return;

  const alivePlayers = Object.values(payload.allplayers ?? {}).filter((p) => (p.state?.health ?? 0) > 0);

  let nearest: { shot: CinematicShot; distance: number } | null = null;
  for (const shot of poiShots) {
    const shotPos: Vec3 = shot.position!;
    for (const player of alivePlayers) {
      const pos = parsePosition(player.position);
      if (!pos) continue;
      const distance = distance3d(shotPos, pos);
      if (distance > QUIET_PRESENCE_RADIUS_UNITS) continue;
      if (!nearest || distance < nearest.distance) nearest = { shot, distance };
    }
  }
  if (!nearest) return;

  const durationMs = shotDurationMs(nearest.shot, QUIET_MOMENT_SHOT_DURATION_MS);
  quietSince = null;
  suppressAutoSwitchUntil(now + durationMs + 500);
  fireShot(nearest.shot, "quiet_moment");
  setTimeout(handBackToObserver, durationMs);
}
