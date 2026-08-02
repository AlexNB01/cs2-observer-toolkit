import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export const GSI_CFG_FILENAME = "gamestate_integration_cs2hud.cfg";

/**
 * Builds the .cfg file CS2 reads at launch to know where to POST state
 * updates. Goes in <CS2 install>/game/csgo/cfg/.
 */
export function generateGsiCfg(port: number): string {
  return `"CS2 HUD Tool"
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
  if (!env.cs2CfgDir) {
    throw new Error(
      "CS2_CFG_DIR is not set. Point it at your CS2 install's game/csgo/cfg folder (see .env.example)."
    );
  }
  const targetPath = path.join(env.cs2CfgDir, GSI_CFG_FILENAME);
  fs.writeFileSync(targetPath, generateGsiCfg(env.httpPort), "utf-8");
  return { path: targetPath };
}
