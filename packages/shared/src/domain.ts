/** Section 10 — Player management */
export interface Player {
  id: string;
  nickname: string;
  steamId: string;
  avatarUrl?: string;
  bustImage: boolean; // "Bust image (pro)" — displays avatar larger in the HUD
  country?: string; // ISO country code
  webcamUrl?: string; // e.g. VDO.ninja link
  teamId?: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Section 11 — Team management */
export interface Team {
  id: string;
  name: string;
  logoUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Section 4 — Color themes */
export interface ColorTheme {
  id: string;
  name: string;
  kind: "builtin" | "partner" | "custom";
  backgroundColor: string;
  ctColor: string;
  tColor: string;
  cornerRadiusPx: number;
}

export const BUILTIN_THEME_NAMES = [
  "Default",
  "ESL",
  "CS 1.6",
  "La Coupe",
  "Steam 2007",
  "Blast Paris",
  "CS Source",
] as const;

/** Section 2 & 3 & 9 — HUD display / in-game visuals / minimap settings (singleton, one row) */
export interface HudSettings {
  // Section 2
  monitor: string | null;
  toggleHudKeybind: string; // default "Shift+W"
  eventTitle: string;
  displayMode: "horizontal" | "vertical";
  killDisplayStyle: "classic" | "card";
  headerStyle: "old" | "compact";
  hideTeamNamesDuringRounds: boolean;
  scoreboardKeybind: string; // default "F1", hold to show
  showPlayersAliveCounter: boolean;
  clutchModeEnabled: boolean;
  clutchModeMinOpponents: 1 | 2 | 3;

  // Section 3
  inventoryBarMode: "always" | "round_start_only";
  teamOnFireEnabled: boolean;
  playerOnFireEnabled: boolean;
  showBombTimerSeconds: boolean;
  showDefuseTimerSeconds: boolean;
  mvpAnimationEnabled: boolean;
  mvpTrophyEnabled: boolean;
  roundWinnerBannerEnabled: boolean;
  scoreboardAvatarsEnabled: boolean;
  teamLogoFallbackEnabled: boolean;

  // Section 5 — Smart Auto Observer
  smartObserverEnabled: boolean;
  autoSwitchInsideCs2: boolean;
  /** Must match CS2's "-netconport <port>" launch option — see observer/netconsole.ts. */
  cs2NetconsolePort: number;
  cinematicFreezetimeShotsEnabled: boolean;

  // Section 9 — Minimap
  minimapEnabled: boolean;
  minimapAutoZoom: boolean;
  minimapSizePx: number; // e.g. 300
  minimapBackgroundEnabled: boolean;

  // Section 13 — Veto
  vetoKeybind: string; // default "F7"
  vetoFullHeightCards: boolean;

  // Section 12 — HLAE (each tied to the active color theme's CT/T colors)
  hlaeKillfeedEnabled: boolean;
  hlaeXrayEnabled: boolean;
  hlaeTrailsEnabled: boolean;
  hlaeAboveHeadInfoEnabled: boolean;
  hlaeSmokesEnabled: boolean;

  activeThemeId: string | null;
  updatedAt: string;
}

/** Section 5 — Smart Auto Observer queue */
export interface ObserverQueueItem {
  playerSteamId: string;
  playerName: string;
  side: "T" | "CT";
  eventType: "TRADE" | "DUEL" | "CLUTCH" | "MULTI_KILL" | "BOMB" | "ENGAGING" | "PROXIMITY" | "BURNING" | "LOW_HP" | "BOMB_STACK" | "CT_STACK";
  priority: number;
  createdAt: string;
}

/**
 * Section 5 — cinematic freezetime shots. Captured by the user in-game
 * (spec_mode 6, walk the free camera to a spot, run `spec_pos`, copy the
 * printed x/y/z/pitch/yaw here) — there's no way to derive these without
 * being in the map, so they're not pre-filled for any map.
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

/** Section 13 — Veto / map-pick */
export interface VetoAction {
  team: "team_a" | "team_b";
  action: "pick" | "ban";
  map: string;
}

export interface VetoMatch {
  id: string;
  source: "manual" | "faceit" | "hltv";
  sourceUrl?: string;
  teamAName: string;
  teamBName: string;
  actions: VetoAction[];
  decidingMap?: string;
  updatedAt: string;
}

/** Section 7 — Player stats providers */
export type StatsProvider = "faceit" | "live";

export interface PlayerStatsCard {
  provider: StatsProvider;
  steamId: string;
  nickname: string;
  avatarUrl?: string;
  elo?: number;
  winRatePct?: number;
  kd?: number;
  adr?: number;
  hsPct?: number;
  bestMap?: string;
  mapWinRates?: Record<string, number>;
}
