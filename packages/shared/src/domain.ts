/** Settings singleton (one row) — Smart Auto Observer, cinematic cameras, HLAE. */
export interface HudSettings {
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
    | "BOMB"
    | "ENGAGING"
    | "PROXIMITY"
    | "BURNING"
    | "LOW_HP"
    | "BOMB_STACK"
    | "CT_STACK"
    | "UTILITY";
  priority: number;
  createdAt: string;
}

/**
 * A cinematic camera position. Captured by the user in-game (spec_mode 6,
 * walk the free camera to a spot, run `spec_pos`, copy the printed
 * x/y/z/pitch/yaw here) — there's no way to derive these without being in
 * the map, so they're not pre-filled for any map.
 */
export interface CinematicCameraShot {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
}

/**
 * A single named camera spot captured for a map. Any number can be
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
  shot: CinematicCameraShot;
  updatedAt: string;
}
