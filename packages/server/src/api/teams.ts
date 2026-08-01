import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Team } from "@cs2hud/shared";
import { db } from "../db/client.js";

interface TeamRow {
  id: string;
  name: string;
  logo_url: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url ?? undefined,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerTeamRoutes(app: FastifyInstance): void {
  app.get("/api/teams", async () => {
    const rows = db.prepare("SELECT * FROM teams ORDER BY name").all() as unknown as TeamRow[];
    return rows.map(toTeam);
  });

  app.post("/api/teams", async (request, reply) => {
    const body = request.body as { name: string; logoUrl?: string };
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const now = new Date().toISOString();
    const team: Team = { id: randomUUID(), name: body.name, logoUrl: body.logoUrl, active: false, createdAt: now, updatedAt: now };
    db.prepare(
      "INSERT INTO teams (id, name, logo_url, active, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
    ).run(team.id, team.name, team.logoUrl ?? null, now, now);
    return reply.code(201).send(team);
  });

  app.put("/api/teams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<Pick<Team, "name" | "logoUrl" | "active">>;
    const existing = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as unknown as TeamRow | undefined;
    if (!existing) return reply.code(404).send({ error: "team not found" });

    const now = new Date().toISOString();
    db.prepare("UPDATE teams SET name = ?, logo_url = ?, active = ?, updated_at = ? WHERE id = ?").run(
      body.name ?? existing.name,
      body.logoUrl ?? existing.logo_url,
      body.active === undefined ? existing.active : body.active ? 1 : 0,
      now,
      id
    );
    return toTeam(db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as unknown as TeamRow);
  });

  app.delete("/api/teams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    db.prepare("DELETE FROM teams WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
