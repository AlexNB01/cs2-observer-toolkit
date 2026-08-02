import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { readHudSettings } from "../db/hud-settings-store.js";

export const GSI_CFG_FILENAME = "gamestate_integration_cs2hud.cfg";

/**
 * Builds the .cfg file CS2 reads at launch to know where to POST state
 * updates. Goes in <CS2 install>/game/csgo/cfg/.
 */
export function generateGsiCfg(port: number): string {
  return `"CS2 Observer Toolkit"
{
  "uri"        "http://localhost:${port}${env.gsiListenPath}"
  "timeout"    "5.0"
  "buffer"     "0"
  "throttle"   "0"
  "heartbeat"  "30.0"
  "data"
  {
    "provider"               "1"
    "map"                    "1"
    "round"                  "1"
    "player_id"               "1"
    "player_state"            "1"
    "player_match_stats"      "1"
    "allplayers_id"           "1"
    "allplayers_state"        "1"
    "allplayers_match_stats"  "1"
    "allplayers_position"     "1"
    "allplayers_weapons"      "1"
    "bomb"                    "1"
    "phase_countdowns"        "1"
    "allgrenades"             "1"
  }
}
`;
}

export function writeGsiCfg(): { path: string } {
  const { cs2CfgDir } = readHudSettings();
  if (!cs2CfgDir) {
    throw new Error("CS2 cfg folder is not set. Set it on the GSI Setup page.");
  }
  const targetPath = path.join(cs2CfgDir, GSI_CFG_FILENAME);
  fs.writeFileSync(targetPath, generateGsiCfg(env.httpPort), "utf-8");
  return { path: targetPath };
}
