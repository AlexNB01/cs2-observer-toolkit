import net from "node:net";
import { readHudSettings } from "../db/hud-settings-store.js";

const RECONNECT_COOLDOWN_MS = 3_000;

let socket: net.Socket | null = null;
let connectedPort: number | null = null;
let connecting = false;
let lastAttemptAt = 0;

function targetPort(): number {
  return readHudSettings().cs2NetconsolePort || 2121;
}

function teardown(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
  }
  socket = null;
  connectedPort = null;
  connecting = false;
}

export function isNetconsoleConnected(): boolean {
  return socket !== null && !socket.destroyed && connectedPort === targetPort();
}

/**
 * Lazily (re)connects on demand — called from specPlayerByName and the
 * status endpoint — rather than running a background reconnect loop.
 * There's nothing useful to do with an idle connection between switches,
 * and this naturally retries exactly when a switch (or a status check)
 * needs one. Also picks up port changes: if the HudSettings port no
 * longer matches connectedPort, isNetconsoleConnected() goes false and
 * this reconnects to the new one. RECONNECT_COOLDOWN_MS just stops a
 * burst of switch attempts from hammering connect() while CS2 is closed.
 */
function ensureConnecting(): void {
  if (isNetconsoleConnected() || connecting) return;
  const now = Date.now();
  if (now - lastAttemptAt < RECONNECT_COOLDOWN_MS) return;
  lastAttemptAt = now;

  teardown();
  const port = targetPort();
  connecting = true;

  const s = net.createConnection({ host: "127.0.0.1", port }, () => {
    connecting = false;
    connectedPort = port;
  });
  s.on("error", () => {
    connecting = false;
  });
  s.on("close", () => {
    if (socket === s) teardown();
  });
  socket = s;
}

/**
 * CS2's netconsole (the "-netconport <port>" launch option — a raw local
 * TCP text console) lets us send `spec_player "<name>"` and target a
 * player directly by name. GSI already gives us every player's name, so
 * unlike simulated keypresses bound to `spec_player <index>` (the previous
 * approach — see git history), there's no index-to-player mapping to
 * learn, hence no calibration step, and no dependency on CS2 having OS
 * focus either, since this talks to the engine directly rather than
 * simulating input at the OS level.
 */
export function specPlayerByName(name: string): boolean {
  ensureConnecting();
  if (!isNetconsoleConnected() || !socket) return false;

  // Strip quotes so a (very unlikely) quote in a player name can't break
  // out of the quoted console command argument.
  const safeName = name.replace(/"/g, "");
  socket.write(`spec_player "${safeName}"\n`);
  return true;
}

export function getNetconsoleStatus(): { connected: boolean; port: number } {
  ensureConnecting();
  return { connected: isNetconsoleConnected(), port: targetPort() };
}
