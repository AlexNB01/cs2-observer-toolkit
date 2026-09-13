/** Settings singleton (one row) — Smart Auto Observer, cinematic cameras, HLAE. */
export interface HudSettings {
  // Paths (GSI Setup page) — editable live via "Browse..." in the desktop
  // app or by pasting a path; previously only settable via a CS2_CFG_DIR/
  // HLAE_EXE_PATH env var, which still seeds these on first run.
  /** CS2's game/csgo/cfg folder — needed to auto-install the GSI/cinematic/sync .cfg files. */
  cs2CfgDir: string;
  /** Path to HLAE.exe (hlae.online) — not bundled/downloaded by this app. */
  hlaeExePath: string;

  // Smart Auto Observer
  smartObserverEnabled: boolean;
  autoSwitchInsideCs2: boolean;
  /** Must match CS2's "-netconport <port>" launch option — see observer/netconsole.ts. */
  cs2NetconsolePort: number;
  cinematicFreezetimeShotsEnabled: boolean;
  /** On bomb_planted, show whichever captured shot is nearest the plant. */
  cinematicBombPlantShotsEnabled: boolean;
  /** Opportunistic filler: cut to a "poi" shot when players are near it and nothing else is happening. */
  cinematicQuietMomentShotsEnabled: boolean;
  /** Scoring/decay/range tuning for the Smart Auto Observer — see ObserverTuning below. */
  observerTuning: ObserverTuning;

  // HLAE
  hlaeKillfeedEnabled: boolean;
  hlaeXrayEnabled: boolean;
  hlaeTrailsEnabled: boolean;
  hlaeAboveHeadInfoEnabled: boolean;
  hlaeSmokesEnabled: boolean;
  /** CT/T hex colors used to generate sync.cfg's mirv_colors/mirv_deathmsg commands. */
  hlaeCtColor: string;
  hlaeTColor: string;

  updatedAt: string;
}

/**
 * Every number that shapes how the Smart Auto Observer scores players and
 * decides when to cut the camera — server/src/gsi/observer.ts (scoring) and
 * server/src/observer/auto-switch.ts (switch hysteresis). Previously fixed
 * constants, now live settings so a user can retune feel/behavior from the
 * Smart Observer page's Advanced section without a rebuild. Both files read
 * the current value fresh on every GSI tick (see gsi/listener.ts).
 * DEFAULT_OBSERVER_TUNING below reproduces the values this app shipped with
 * before this became configurable.
 */
export interface ObserverTuning {
  // Auto-switch hysteresis (observer/auto-switch.ts) — requiring a clear
  // margin (not just "any higher number") and a minimum dwell time between
  // switches is what stops the camera from thrashing between two players
  // with close, fluctuating scores. Both are skipped the instant the
  // currently-observed player dies.
  /** A challenger must beat the currently-observed player's score by at least this much before the camera cuts to them. */
  switchMarginScore: number;
  /** Minimum time (ms) between camera switches. */
  minDwellMs: number;

  // Score decay — a kill/shot boost fades on its own rather than vanishing
  // the instant the camera first cuts to it, and how fast it fades depends
  // on whether an enemy is still in view (see decayHalfLifeFor in
  // gsi/observer.ts).
  /** Baseline half-life (ms) for a decaying kill/engaging score. */
  eventScoreHalfLifeMs: number;
  /** Half-life (ms) once an in-view enemy is right on top of the player — slower, since the fight probably isn't over yet. */
  eventScoreHalfLifeNearEnemyMs: number;
  /** Half-life (ms) when the player has no enemy anywhere in view — faster than the baseline, since they've likely moved on. */
  eventScoreHalfLifeNoEnemyInSightMs: number;
  /** How long (ms) after a player's last real kill/shot the near-enemy slow decay still applies, regardless of who remains in view. */
  nearEnemyBonusMaxElapsedMs: number;

  // Kill scoring
  /** Points for any kill. */
  killBase: number;
  /** Extra points for a headshot kill. */
  headshotBonus: number;
  /** Extra points per round-kill once the attacker has 2+ this round (multi-kill). */
  multiKillBonusPerKill: number;
  /** How long (ms) after a teammate's death a kill still counts as avenging them (a trade). */
  tradeWindowMs: number;
  /** Extra points for a trade kill. */
  tradeBonus: number;
  /** Extra points for a clutch-winning kill (attacker is the last alive on their team, vs 1+ enemy). */
  clutchWinBaseBonus: number;
  /** Extra points per enemy still alive, added to a clutch-winning kill. */
  clutchWinBonusPerEnemy: number;

  // Shots fired ("engaging") — detected as an ammo_clip drop, adds a small
  // decaying boost per shot rather than a fixed one-off event.
  /** Points per shot fired, whether or not an enemy is in the crosshair. */
  engagingShotBoost: number;
  /** Extra points per shot when roughly aimed at an alive enemy. */
  engagingShootingAtEnemyBonus: number;
  /** Hard ceiling on the decayed engaging-score contribution — keeps sustained fire from a high-RPM/large-mag weapon alone from reaching clutch-tier priority. */
  engagingCap: number;

  // Situational bonuses — recomputed fresh every tick from current game
  // state, no history needed.
  /** Base priority for whoever is the lone survivor in a clutch (1 vs 1+). */
  clutchSituationalBase: number;
  /** Extra priority per enemy still alive, added to the clutch situational bonus. */
  clutchSituationalPerEnemy: number;
  /** Priority for every alive enemy of whoever is currently defusing (while any are still alive to contest it). */
  bombSituational: number;
  /** Highest possible proximity contribution — each of a close CT/T pair gets up to this, scaled by closeness. */
  proximityMax: number;
  /** Distance (game units) at which the proximity/flank/push-target contribution reaches 0. */
  proximityRangeUnits: number;
  /** Range used instead of proximityRangeUnits/flankRangeUnits/pushTargetRangeUnits whenever a player in the pairing is holding a sniper rifle (AWP/SSG08/Scout) — long sightlines (Dust2 long-A, Mirage mid) routinely exceed the rifle/CQC-tuned base ranges. */
  sniperRangeUnits: number;

  // Team stacks — several teammates moving together as a group, usually
  // signaling a coordinated execute/rush (T) or rotate/retake (CT).
  /** Minimum teammates (including the one being checked) moving together to count as a "stack". */
  stackMinPlayers: number;
  /** How close together (game units) counts as one pack. */
  stackRadiusUnits: number;
  /** Minimum speed (units/sec) to count as "moving" rather than just standing near each other — CS2 walk speed is ~130. */
  stackMinSpeedUps: number;
  /** Priority for a T bomb carrier who's part of a moving stack. */
  bombStackSituational: number;
  /** Priority for each CT in a moving stack. */
  ctStackSituational: number;
  /** Distance (game units) within which a defending CT gets credit for watching an incoming T stack. */
  pushTargetRangeUnits: number;
  /** Priority for a CT who's facing an incoming T stack within range. */
  pushTargetSituational: number;

  // Flank potential / facing detection — "I can see where they are and they
  // don't know I'm here."
  /** Distance (game units) within which flank potential (an unnoticed angle on an enemy) can register. */
  flankRangeUnits: number;
  /** Cosine of the view cone used for general awareness checks (flank potential, push-target facing) — 0.87 ≈ ±30°. */
  flankViewCosThreshold: number;
  /** Highest possible flank-potential contribution, scaled by closeness. */
  flankPotentialMax: number;
  /** Cosine of the tighter cone used to decide whether a shot was actually aimed at an enemy — 0.96 ≈ ±16°. */
  shootingAtEnemyCosThreshold: number;
}

/** Values this app shipped with before ObserverTuning became user-editable. */
export const DEFAULT_OBSERVER_TUNING: ObserverTuning = {
  switchMarginScore: 25,
  minDwellMs: 2_000,

  eventScoreHalfLifeMs: 5_000,
  eventScoreHalfLifeNearEnemyMs: 12_000,
  eventScoreHalfLifeNoEnemyInSightMs: 2_500,
  nearEnemyBonusMaxElapsedMs: 6_000,

  killBase: 100,
  headshotBonus: 15,
  multiKillBonusPerKill: 25,
  tradeWindowMs: 5_000,
  tradeBonus: 30,
  clutchWinBaseBonus: 40,
  clutchWinBonusPerEnemy: 20,

  engagingShotBoost: 10,
  engagingShootingAtEnemyBonus: 15,
  engagingCap: 45,

  clutchSituationalBase: 1000,
  clutchSituationalPerEnemy: 10,
  bombSituational: 500,
  proximityMax: 10,
  proximityRangeUnits: 1200,
  sniperRangeUnits: 2500,

  stackMinPlayers: 3,
  stackRadiusUnits: 600,
  stackMinSpeedUps: 100,
  bombStackSituational: 80,
  ctStackSituational: 35,
  pushTargetRangeUnits: 1000,
  pushTargetSituational: 45,

  flankRangeUnits: 1000,
  flankViewCosThreshold: 0.87,
  flankPotentialMax: 45,
  shootingAtEnemyCosThreshold: 0.96,
};

/** Smart Auto Observer queue */
export interface ObserverQueueItem {
  playerSteamId: string;
  playerName: string;
  side: "T" | "CT";
  eventType:
    | "TRADE"
    | "DUEL"
    | "CLUTCH"
    | "MULTI_KILL"
    | "BOMB_CONTEST"
    | "ENGAGING"
    | "PROXIMITY"
    | "FLANK_POTENTIAL"
    | "BOMB_STACK"
    | "CT_STACK"
    | "PUSH_TARGET";
  priority: number;
  createdAt: string;
}

/** A world-space point, e.g. an auto-derived reference position for a camera path (see CinematicShot below). */
export interface CinematicCameraPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * A single named camera path attached for a map. Any number can be
 * captured per map. `slot` decides how it's used: "ct"/"t" shots rotate
 * through at freezetime start (winner's side first, see
 * cinematic/scheduler.ts); "poi" ("point of interest" — mid, a bombsite,
 * anywhere else) shots are only ever shown via the bomb-plant or
 * quiet-moment triggers, never at freezetime.
 */
export interface CinematicShot {
  id: string;
  mapName: string;
  label: string;
  slot: "ct" | "t" | "poi";
  /**
   * Stored filename (see cinematic/campath-storage.ts) of the imported
   * HLAE mirv_campath file this shot plays — every shot has one; there's
   * no static-jump fallback.
   */
  campathFileName: string;
  /**
   * The path's earliest keyframe's world position, parsed automatically at
   * import time (see campath-storage.ts's parseCampathInfo) — stands in for
   * a manually-captured reference point, used for bomb-site/quiet-moment
   * nearest-shot matching (see cinematic/scheduler.ts). Freezetime ct/t
   * rotation doesn't use it at all (that pool just rotates by index).
   * Optional only as a safety net for a file whose keyframes somehow
   * couldn't be parsed — importCampathFile rejects that case outright, so
   * in practice this is always present.
   */
  position?: CinematicCameraPosition;
  /**
   * Playback length of the attached camera path in milliseconds, parsed
   * from its keyframe timestamps at import time. cinematic/scheduler.ts
   * uses this instead of each trigger's fixed hold duration when set, so a
   * shot is held for exactly as long as its path actually plays — neither
   * cut off mid-motion nor left sitting still after it finishes.
   */
  campathDurationMs?: number;
  updatedAt: string;
}

/**
 * Portable snapshot of everything the user configures — HLAE colors/
 * toggles, Smart Observer settings, and every captured cinematic camera
 * shot — for backing up or moving to a different install (see
 * api/backup.ts). Bumping `version` is reserved for if the shape ever
 * needs a breaking change; import doesn't currently branch on it.
 */
export interface BackupData {
  version: 1;
  exportedAt: string;
  hudSettings: HudSettings;
  cinematicShots: CinematicShot[];
}
