import { randomUUID } from "node:crypto";
import OBSWebSocket from "obs-websocket-js";
import { readObsConfig, writeObsConfig } from "../db/obs-config-store.js";

const obs = new OBSWebSocket();

let connected = false;
let replayBufferActive = false;
let pendingReplayId: string | null = null;
const replayPaths = new Map<string, string>();

obs.on("ConnectionClosed", () => {
  connected = false;
  replayBufferActive = false;
});

obs.on("ReplayBufferStateChanged", (data) => {
  replayBufferActive = data.outputActive;
});

obs.on("ReplayBufferSaved", (data) => {
  const id = randomUUID();
  replayPaths.set(id, data.savedReplayPath);
  pendingReplayId = id;
});

export interface ObsStatus {
  connected: boolean;
  replayBufferActive: boolean;
}

export function getObsStatus(): ObsStatus {
  return { connected, replayBufferActive };
}

/** Consumed once per round by the GSI listener on freezetime_start. */
export function consumePendingReplayId(): string | null {
  const id = pendingReplayId;
  pendingReplayId = null;
  return id;
}

export function getReplayPath(id: string): string | undefined {
  return replayPaths.get(id);
}

// obs-websocket-js throws a WebSocket close event (a bare `{ code }`, no
// useful `.message`) on connection failures — map the codes worth
// distinguishing to something the admin panel can actually show.
const CLOSE_CODE_MESSAGES: Record<number, string> = {
  1006: "Couldn't reach OBS — check the host/port and that OBS is running with the WebSocket server enabled.",
  4008: "Authentication failed — check the OBS WebSocket password.",
  4009: "Unsupported obs-websocket RPC version — update OBS or obs-websocket-js.",
};

function describeObsError(err: unknown): string {
  const code = (err as { code?: number })?.code;
  if (code !== undefined && CLOSE_CODE_MESSAGES[code]) return CLOSE_CODE_MESSAGES[code];
  const message = (err as Error)?.message;
  if (message) return message;
  return code !== undefined ? `OBS connection closed (code ${code})` : "Unknown OBS connection error";
}

export async function connectObs(host: string, port: number, password: string): Promise<ObsStatus> {
  if (connected) {
    await obs.disconnect();
  }
  try {
    await obs.connect(`ws://${host}:${port}`, password || undefined);
  } catch (err) {
    throw new Error(describeObsError(err));
  }
  connected = true;
  writeObsConfig({ host, port, password });

  try {
    const status = await obs.call("GetReplayBufferStatus");
    replayBufferActive = status.outputActive;
  } catch {
    replayBufferActive = false;
  }

  return getObsStatus();
}

export async function triggerReplay(): Promise<void> {
  if (!connected) {
    throw new Error("Not connected to OBS");
  }
  await obs.call("SaveReplayBuffer");
}

/**
 * Reconnect using saved credentials so a server restart during a broadcast
 * doesn't require re-entering the connection form. Must be called after
 * db/schema.ts's migrate() — not at module load, since ES module imports
 * are evaluated before buildApp() runs migrate().
 */
export function reconnectObsFromSavedConfig(): void {
  const saved = readObsConfig();
  if (!saved.host) return;
  connectObs(saved.host, saved.port, saved.password).catch(() => {
    // OBS not running / not reachable yet — the admin panel can retry.
  });
}
