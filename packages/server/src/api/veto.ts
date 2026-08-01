import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { VetoMatch } from "@cs2hud/shared";
import { db } from "../db/client.js";
import { broadcast } from "../ws/hub.js";
import { importFaceitMatch } from "../veto/faceit.js";
import { emitLhmMatchUpdate, emitLhmConfigUpdate } from "../lhm/socket.js";

function readVeto(): VetoMatch | null {
  const row = db.prepare("SELECT json FROM veto_current WHERE id = 1").get() as { json: string | null } | undefined;
  return row?.json ? (JSON.parse(row.json) as VetoMatch) : null;
}

export function registerVetoRoutes(app: FastifyInstance): void {
  app.get("/api/veto", async () => readVeto());

  // Section 13 — "Manual veto": user enters the pick/ban sequence by hand.
  app.put("/api/veto", async (request) => {
    const body = request.body as Pick<VetoMatch, "teamAName" | "teamBName" | "actions" | "decidingMap">;
    const veto: VetoMatch = {
      id: randomUUID(),
      source: "manual",
      teamAName: body.teamAName,
      teamBName: body.teamBName,
      actions: body.actions ?? [],
      decidingMap: body.decidingMap,
      updatedAt: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO veto_current (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json"
    ).run(JSON.stringify(veto));
    broadcast({ kind: "veto_updated", veto });
    emitLhmMatchUpdate();
    emitLhmConfigUpdate();
    return veto;
  });

  app.delete("/api/veto", async (_request, reply) => {
    db.prepare("UPDATE veto_current SET json = NULL WHERE id = 1").run();
    broadcast({ kind: "veto_updated", veto: null });
    emitLhmMatchUpdate();
    emitLhmConfigUpdate();
    return reply.code(204).send();
  });

  // Section 13 — "Import a match". Returns a preview (not saved) that the
  // admin panel drops into the manual veto form for review before saving.
  app.post("/api/veto/import", async (request, reply) => {
    const { url } = request.body as { url: string };

    if (/faceit\.com/i.test(url)) {
      try {
        return await importFaceitMatch(url);
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }

    if (/hltv\.org/i.test(url)) {
      // HLTV has no public API — pulling this would mean scraping their
      // match pages, which needs a look at their ToS before building
      // (see spec section 15's own note on this). Not done here.
      return reply.code(501).send({
        error: "HLTV import isn't implemented — HLTV has no public API, and scraping their pages needs a ToS review this app doesn't make for you.",
      });
    }

    return reply.code(400).send({ error: "Unrecognized URL — expected a faceit.com or hltv.org match link." });
  });
}
