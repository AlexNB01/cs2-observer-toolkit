import type { NormalizedEvent } from "./gsi.js";
import type { HudSettings, ObserverQueueItem } from "./domain.js";

/** Messages pushed from server to any connected client (the admin panel). */
export type ServerToClientMessage =
  | { kind: "gsi_event"; event: NormalizedEvent }
  | { kind: "settings_updated"; settings: HudSettings }
  | { kind: "observer_queue_updated"; queue: ObserverQueueItem[] }
  | { kind: "observer_focus_status"; cs2Focused: boolean }
  | { kind: "cinematic_cue"; trigger: "freezetime" | "bomb_plant" | "quiet_moment"; label: string; execCommand: string; autoTriggered: boolean }
  | { kind: "hello"; clientId: string };

/** Messages sent from a client (the admin panel) to the server. */
export type ClientToServerMessage = { kind: "identify"; role: "admin" };
