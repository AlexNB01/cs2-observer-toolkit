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
