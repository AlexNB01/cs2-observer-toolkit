import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { GsiPayload } from "@cs2hud/shared";
import { db } from "../db/client.js";

let io: SocketIOServer | null = null;

interface VetoJson {
  teamAName: string;
  teamBName: string;
}

function buildHudConfig() {
  const row = db.prepare("SELECT json FROM veto_current WHERE id = 1").get() as { json: string | null } | undefined;
  const veto = row?.json ? (JSON.parse(row.json) as VetoJson) : null;

  // Field names match public/panel.json's "display_settings" section in
  // lexogrine/cs2-react-hud — this is the shape its useConfig("display_settings")
  // hook expects, not our own hud-settings schema.
  return {
    display_settings: {
      left_title: veto?.teamAName ?? "",
      right_title: veto?.teamBName ?? "",
    },
  };
}

/**
 * Socket.IO server implementing lexogrine/cs2-react-hud's expected
 * handshake (readyToRegister -> register -> hud_config/match) and its
 * "update" event, which the HUD feeds straight into the `csgogsi` package's
 * own GSI state machine client-side. That means CS2's raw GSI payload can
 * just be relayed through verbatim — no server-side re-derivation of
 * kills/rounds/etc. needed for this HUD's benefit, since csgogsi already
 * does that parsing in the browser.
 */
export function registerLhmSocket(httpServer: HttpServer): void {
  io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.emit("readyToRegister");

    socket.on("register", () => {
      socket.emit("hud_config", buildHudConfig());
      socket.emit("match");
    });
  });
}

/**
 * csgogsi 3.0.5's digest() throws (`raw.player?.position.split(...)`) if
 * the top-level "player" (observed) field lacks position/forward — which
 * real CS2 GSI frequently does, even though allplayers entries always have
 * them. A single bad payload here kills the client's "data" pipeline for
 * that update, so fill it in from the matching allplayers entry (or a
 * harmless fallback) before relaying rather than passing it through as-is.
 */
function withObserverPosition(payload: GsiPayload): GsiPayload {
  const observed = payload.player;
  if (!observed || (observed.position && observed.forward)) return payload;

  const fromAllplayers = payload.allplayers?.[observed.steamid];
  return {
    ...payload,
    player: {
      ...observed,
      position: observed.position ?? fromAllplayers?.position ?? "0, 0, 0",
      forward: observed.forward ?? fromAllplayers?.forward ?? "0, 0, 0",
    },
  };
}

// Missing top-level sections (map/allplayers/phase_countdowns — CS2 omits
// a section from a POST when it's unchanged) are already backfilled by
// gsi/listener.ts's mergeGsiPayload before this is called, since csgogsi's
// digest() hard-requires all three and every other consumer benefits from
// a complete payload too — this only needs to patch the position/forward
// gap, which is specific to how csgogsi reads the "player" field.
//
// Note on ADR: csgogsi's own digest() already computes player.state.adr
// client-side from state.round_totaldmg across rounds — no server-side
// computation or injection needed (an earlier version of this file did
// that redundantly, and read from the wrong property besides — see the
// ADR fix in lhm-hud/src/HUD/Players/*.tsx).
export function emitLhmGsiUpdate(payload: GsiPayload): void {
  io?.emit("update", withObserverPosition(payload));
}

export function emitLhmMatchUpdate(): void {
  io?.emit("match");
}

export function emitLhmConfigUpdate(): void {
  io?.emit("hud_config", buildHudConfig());
}
