/**
 * CS2 Game State Integration types.
 * Raw shape is intentionally partial — GSI payloads vary by which sections
 * the .cfg file subscribes to. See https://developer.valvesoftware.com/wiki/Counter-Strike_2/Game_State_Integration
 */

export interface GsiProvider {
  name: string;
  appid: number;
  version: number;
  steamid: string;
  timestamp: number;
}

export interface GsiMap {
  mode: string;
  name: string;
  phase: "warmup" | "live" | "intermission" | "gameover";
  round: number;
  team_ct?: { score: number; consecutive_round_losses?: number; timeouts_remaining?: number };
  team_t?: { score: number; consecutive_round_losses?: number; timeouts_remaining?: number };
}

export interface GsiRoundState {
  phase: "freezetime" | "live" | "over" | "bomb";
  bomb?: "planted" | "defused" | "exploded";
  win_team?: "CT" | "T";
}

export interface GsiPlayerState {
  health: number;
  armor: number;
  helmet: boolean;
  flashed: number;
  smoked: number;
  burning: number;
  money: number;
  round_kills: number;
  round_killhs: number;
  equip_value: number;
}

export interface GsiWeapon {
  name: string; // e.g. "weapon_ak47"
  paintkit?: string;
  type?: string; // "Rifle", "Pistol", "Grenade", "Knife", "C4", ...
  ammo_clip?: number;
  ammo_clip_max?: number;
  ammo_reserve?: number;
  state: "active" | "holstered" | "reloading";
}

export interface GsiPlayer {
  steamid: string;
  name: string;
  team: "CT" | "T";
  activity?: "playing" | "menu" | "textinput";
  state?: GsiPlayerState;
  position?: string; // "x, y, z" — sparse/limited per GSI docs
  forward?: string; // "x, y, z" view direction
  match_stats?: {
    kills: number;
    assists: number;
    deaths: number;
    mvps: number;
    score: number;
  };
  weapons?: Record<string, GsiWeapon>; // keyed "weapon_0", "weapon_1", ... — only present if allplayers_weapons is subscribed
}

export interface GsiBomb {
  state: "planting" | "planted" | "defusing" | "defused" | "exploded" | "carried" | "dropped";
  position?: string;
  player?: string; // steamid of whoever's carrying/planting/defusing — populated during plain "carried" too, not just active planting/defusing
  countdown?: string; // seconds remaining, as string, only while "planted"
}

/** Raw POST body from CS2's GSI HTTP client. */
export interface GsiPayload {
  provider: GsiProvider;
  map?: GsiMap;
  round?: GsiRoundState;
  player?: GsiPlayer; // the spectated/observed player
  allplayers?: Record<string, GsiPlayer>;
  bomb?: GsiBomb;
  phase_countdowns?: { phase: string; phase_ends_in: string };
  /**
   * Requires "allgrenades" "1" in the GSI cfg (see gsi/cfg-generator.ts) —
   * without it CS2 never includes this key at all, which is what silently
   * broke grenade rendering in the LHM HUD's minimap (lhm-hud/src/HUD/Radar)
   * despite that rendering code itself being correct. We don't process this
   * server-side ourselves — it's relayed through verbatim for the HUD's own
   * client-side csgogsi digest() to parse. Keyed by grenade entity ID.
   */
  grenades?: Record<string, unknown>;
  previously?: unknown; // diff of the previous payload, shape mirrors the full payload
  added?: unknown; // keys newly present since the previous payload
}

/** Internal, normalized event model that the rest of the system consumes. */
export type NormalizedEventType =
  | "match_start"
  | "round_start"
  | "freezetime_start"
  | "round_end"
  | "kill"
  | "player_hurt"
  | "bomb_planted"
  | "bomb_defused"
  | "bomb_exploded"
  | "mvp"
  | "state_snapshot";

export interface NormalizedEventBase {
  type: NormalizedEventType;
  timestamp: number;
}

export interface KillEvent extends NormalizedEventBase {
  type: "kill";
  attackerSteamId?: string;
  victimSteamId?: string;
  headshot?: boolean;
}

export interface BombEvent extends NormalizedEventBase {
  type: "bomb_planted" | "bomb_defused" | "bomb_exploded";
  playerSteamId?: string;
}

export interface RoundEndEvent extends NormalizedEventBase {
  type: "round_end";
  winningTeam?: "CT" | "T";
}

export interface MvpEvent extends NormalizedEventBase {
  type: "mvp";
  playerSteamId: string;
}

export interface StateSnapshotEvent extends NormalizedEventBase {
  type: "state_snapshot";
  raw: GsiPayload;
}

export interface GenericNormalizedEvent extends NormalizedEventBase {
  type: Exclude<
    NormalizedEventType,
    "kill" | "bomb_planted" | "bomb_defused" | "bomb_exploded" | "round_end" | "mvp" | "state_snapshot"
  >;
}

export type NormalizedEvent = KillEvent | BombEvent | RoundEndEvent | MvpEvent | StateSnapshotEvent | GenericNormalizedEvent;
