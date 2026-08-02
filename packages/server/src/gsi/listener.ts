import type { FastifyInstance } from "fastify";
import type { GsiPayload } from "@cs2hud/shared";
import { normalizeGsiPayload } from "./normalizer.js";
import { processObserverEvents } from "./observer.js";
import { readHudSettings } from "../db/hud-settings-store.js";
import { maybeRunCinematicSequence, maybeShowBombPlantShot, maybeShowQuietMomentShot, recordRoundEnd } from "../cinematic/scheduler.js";
import { maybeAutoSwitch, resetAutoSwitchState } from "../observer/auto-switch.js";
import { broadcast } from "../ws/hub.js";
import { db } from "../db/client.js";

let latestPayload: GsiPayload | null = null;
let lastUpdatedAt: number | null = null;

export function getLatestGsiState(): { payload: GsiPayload | null; lastUpdatedAt: number | null } {
  return { payload: latestPayload, lastUpdatedAt };
}

// Persisted so a restart doesn't lose sections CS2 hasn't resent recently
// (see mergeGsiPayload below) — otherwise every server restart mid-match
// re-opens the exact cold-start gap the merge exists to avoid. Read lazily
// (not at module scope) since the gsi_state table doesn't exist until
// db/schema.ts's migrate() has run, which happens after this module loads.
function hydrateLatestPayload(): void {
  const row = db.prepare("SELECT json FROM gsi_state WHERE id = 1").get() as { json: string | null } | undefined;
  if (row?.json) latestPayload = JSON.parse(row.json) as GsiPayload;
}

function persistLatestPayload(payload: GsiPayload): void {
  db.prepare("INSERT INTO gsi_state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify(payload));
}

/**
 * CS2 only includes a top-level section in a POST when it changed since
 * the last one — e.g. a whole "map" section is routinely absent for many
 * consecutive POSTs during a bomb-planted countdown, since the score/round
 * number aren't changing tick to tick (confirmed live: a real payload with
 * provider/player/allplayers/bomb/phase_countdowns but no "map" at all).
 * Treating each POST as the complete state (a plain overwrite) meant
 * latestPayload — and everything fed from it — would intermittently go
 * stale or blank. Merge instead: keep the last known value for any section
 * this POST didn't include.
 */
function mergeGsiPayload(previous: GsiPayload | null, incoming: GsiPayload): GsiPayload {
  if (!previous) return incoming;
  return {
    ...incoming,
    map: incoming.map ?? previous.map,
    round: incoming.round ?? previous.round,
    player: incoming.player ?? previous.player,
    allplayers: incoming.allplayers ?? previous.allplayers,
    bomb: incoming.bomb ?? previous.bomb,
    phase_countdowns: incoming.phase_countdowns ?? previous.phase_countdowns,
  };
}

/**
 * CS2 POSTs its GSI JSON body here on every state change (see the .cfg
 * written by gsi/cfg-generator.ts). Each payload is diffed against the
 * previous one, normalized into internal events, and fanned out over the
 * WS hub to the admin panel, plus drives the Smart Auto Observer and
 * cinematic freezetime cameras.
 */
export function registerGsiListener(app: FastifyInstance): void {
  hydrateLatestPayload();

  app.post("/gsi", async (request, reply) => {
    const payload = mergeGsiPayload(latestPayload, request.body as GsiPayload);
    const previous = latestPayload;

    latestPayload = payload;
    lastUpdatedAt = Date.now();
    persistLatestPayload(payload);

    const settings = readHudSettings();
    const events = normalizeGsiPayload(payload, previous);
    for (const event of events) {
      broadcast({ kind: "gsi_event", event });

      if (event.type === "freezetime_start") {
        maybeRunCinematicSequence(payload.map?.name, payload.map?.round, settings.cinematicFreezetimeShotsEnabled);
      }

      if (event.type === "bomb_planted") {
        maybeShowBombPlantShot(payload.map?.name, payload.bomb?.position, settings.cinematicBombPlantShotsEnabled);
      }

      if (event.type === "round_end") {
        recordRoundEnd(event.winningTeam);
      }

      if (event.type === "match_start") {
        resetAutoSwitchState();
      }
    }

    processObserverEvents(events, payload, settings.smartObserverEnabled);
    maybeShowQuietMomentShot(payload, settings.cinematicQuietMomentShotsEnabled);

    if (settings.smartObserverEnabled && settings.autoSwitchInsideCs2) {
      void maybeAutoSwitch(true).catch(() => {});
    }

    reply.code(200).send();
  });
}
