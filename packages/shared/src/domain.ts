/** Settings singleton (one row) — Smart Auto Observer, cinematic cameras, HLAE. */
export interface HudSettings {
  // Smart Auto Observer
  smartObserverEnabled: boolean;
  autoSwitchInsideCs2: boolean;
  /** Must match CS2's "-netconport <port>" launch option — see observer/netconsole.ts. */
  cs2NetconsolePort: number;
  cinematicFreezetimeShotsEnabled: boolean;

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
  eventType: "TRADE" | "DUEL" | "CLUTCH" | "MULTI_KILL" | "BOMB" | "ENGAGING" | "PROXIMITY" | "BURNING" | "LOW_HP" | "BOMB_STACK" | "CT_STACK";
  priority: number;
  createdAt: string;
}

/**
 * Cinematic freezetime shots. Captured by the user in-game (spec_mode 6,
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

export interface CinematicMapCameras {
  mapName: string;
  ctShot: CinematicCameraShot | null;
  tShot: CinematicCameraShot | null;
  updatedAt: string;
}
