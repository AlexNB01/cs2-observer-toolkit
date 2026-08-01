import type { NormalizedEvent } from "./gsi.js";
import type { HudSettings, ObserverQueueItem, VetoMatch } from "./domain.js";

/** Messages pushed from server to any connected client (HUD, minimap, admin panel). */
export type ServerToClientMessage =
  | { kind: "gsi_event"; event: NormalizedEvent }
  | { kind: "settings_updated"; settings: HudSettings }
  | { kind: "observer_queue_updated"; queue: ObserverQueueItem[] }
  | { kind: "observer_focus_status"; cs2Focused: boolean }
  | { kind: "replay_show"; fileUrl: string; volume: number }
  | { kind: "veto_updated"; veto: VetoMatch | null }
  | { kind: "cinematic_cue"; side: "ct" | "t"; sequenceIndex: 0 | 1; execCommand: string }
  | { kind: "preview_triggered"; preview: "mvp" | "round_winner" | "scoreboard_avatar" | "veto" }
  | { kind: "hud_visibility_toggle" }
  | { kind: "veto_visibility_toggle" }
  | { kind: "hud_overlay_requested" }
  | { kind: "hello"; clientId: string };

/** Messages sent from a client (typically the admin panel) to the server. */
export type ClientToServerMessage =
  | { kind: "identify"; role: "admin" | "hud" | "minimap" | "veto" }
  | { kind: "trigger_preview"; preview: "mvp" | "round_winner" | "scoreboard_avatar" | "veto" }
  | { kind: "open_hud_overlay" };
