import { getObserverQueue, isPlayerAlive } from "../gsi/observer.js";
import { specPlayerByName } from "./netconsole.js";

let currentSteamId: string | null = null;
let lastSwitchAt = 0;
let suppressUntil = 0;

// Requiring a clear margin (not just "any higher number") and a minimum
// dwell time between switches is what actually fixes chaotic switching —
// scores fluctuate continuously (see gsi/observer.ts), so picking strictly
// the highest score every tick with no hysteresis would mean the camera
// cuts on every minor fluctuation between two close players.
const SWITCH_MARGIN = 25;
const MIN_DWELL_MS = 2_000;

export function resetAutoSwitchState(): void {
  currentSteamId = null;
  lastSwitchAt = 0;
}

/**
 * Used when something outside the normal ranked-queue flow (currently: the
 * bomb-plant cinematic cam redirecting to whoever just opened fire on the
 * planter) cuts the camera to a specific player directly, bypassing
 * maybeAutoSwitch entirely. Recording it here — rather than leaving
 * currentSteamId stale or calling resetAutoSwitchState() — is what makes
 * the margin/dwell hysteresis apply from this cut onward instead of from
 * whatever the last real auto-switch was, so the camera doesn't
 * immediately re-evaluate against a target it never actually switched to.
 */
export function setAutoSwitchTarget(steamId: string): void {
  currentSteamId = steamId;
  lastSwitchAt = Date.now();
}

/**
 * Blocks maybeAutoSwitch until the given timestamp — used by
 * cinematic/scheduler.ts while a cinematic shot is on screen, so a duel
 * elsewhere can't fight it for camera control mid-display. Without this, a
 * cinematic shot triggered during a *live* round (bomb plant, quiet
 * moment) could get yanked away the very next tick if someone else scores
 * — freezetime-only shots never hit this in practice since nothing scores
 * during freezetime, but it was always a latent gap.
 */
export function suppressAutoSwitchUntil(untilMs: number): void {
  suppressUntil = untilMs;
}

/**
 * Picks the current highest-scored player, but only actually switches to
 * them once: they're not already who we're watching, the minimum dwell
 * time has passed since the last switch, and their score beats whoever's
 * on screen right now by SWITCH_MARGIN — not just barely edges them out.
 *
 * The one hard exception: if the currently-observed player has died,
 * both gates are skipped entirely — there's never a reason to keep
 * dwelling on a dead player's POV, so the switch away happens the very
 * next tick regardless of margin or timing. A merely boring-but-alive
 * current player (present or absent from the ranked list — near-zero
 * scores get dropped from it too) still goes through the normal
 * hysteresis; isPlayerAlive() is what tells the two cases apart.
 *
 * The actual switch is a single `spec_player "<name>"` sent over CS2's
 * netconsole (see netconsole.ts) — no per-player slot lookup and no OS
 * focus check needed, since this addresses the target by name directly
 * and talks to the engine rather than simulating a keypress.
 * currentSteamId/lastSwitchAt only update once the command is actually
 * sent, so a disconnected netconsole doesn't consume the attempt — it
 * just retries next tick.
 */
export async function maybeAutoSwitch(enabled: boolean): Promise<void> {
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;

  const ranked = getObserverQueue();
  const top = ranked[0];
  if (!top) return;
  if (top.playerSteamId === currentSteamId) return;

  const currentDead = currentSteamId !== null && !isPlayerAlive(currentSteamId);

  if (!currentDead) {
    const currentScore = ranked.find((item) => item.playerSteamId === currentSteamId)?.priority ?? -Infinity;
    if (top.priority - currentScore < SWITCH_MARGIN) return;
    if (Date.now() - lastSwitchAt < MIN_DWELL_MS) return;
  }

  const sent = specPlayerByName(top.playerName);
  if (!sent) return; // netconsole not connected — retry next tick

  currentSteamId = top.playerSteamId;
  lastSwitchAt = Date.now();
}
