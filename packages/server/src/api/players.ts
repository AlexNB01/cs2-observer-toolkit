import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Player } from "@cs2hud/shared";
import { db } from "../db/client.js";
import { getLatestGsiState } from "../gsi/listener.js";

interface PlayerRow {
  id: string;
  nickname: string;
  steam_id: string;
  avatar_url: string | null;
  bust_image: number;
  country: string | null;
  webcam_url: string | null;
  team_id: string | null;
  hidden: number;
  created_at: string;
  updated_at: string;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    nickname: row.nickname,
    steamId: row.steam_id,
    avatarUrl: row.avatar_url ?? undefined,
    bustImage: row.bust_image === 1,
    country: row.country ?? undefined,
    webcamUrl: row.webcam_url ?? undefined,
    teamId: row.team_id ?? undefined,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerPlayerRoutes(app: FastifyInstance): void {
  // Section 10 — "Edited players": locally saved roster.
  app.get("/api/players", async () => {
    const rows = db.prepare("SELECT * FROM players ORDER BY nickname").all() as unknown as PlayerRow[];
    return rows.map(toPlayer);
  });

  // Section 10 — "Players on the server": pulled live from the current GSI payload.
  app.get("/api/players/on-server", async () => {
    const { payload } = getLatestGsiState();
    const allplayers = payload?.allplayers ?? {};
    return Object.entries(allplayers).map(([steamId, p]) => ({
      steamId,
      nickname: p.name,
      team: p.team,
    }));
  });

  app.post("/api/players", async (request, reply) => {
    const body = request.body as Partial<Player>;
    if (!body.nickname || !body.steamId) {
      return reply.code(400).send({ error: "nickname and steamId are required" });
    }

    const now = new Date().toISOString();
    const player: Player = {
      id: randomUUID(),
      nickname: body.nickname,
      steamId: body.steamId,
      avatarUrl: body.avatarUrl,
      bustImage: body.bustImage ?? false,
      country: body.country,
      webcamUrl: body.webcamUrl,
      teamId: body.teamId,
      hidden: false,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO players (id, nickname, steam_id, avatar_url, bust_image, country, webcam_url, team_id, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      player.id,
      player.nickname,
      player.steamId,
      player.avatarUrl ?? null,
      player.bustImage ? 1 : 0,
      player.country ?? null,
      player.webcamUrl ?? null,
      player.teamId ?? null,
      now,
      now
    );
    return reply.code(201).send(player);
  });

  app.put("/api/players/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<Player>;
    const existing = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as unknown as PlayerRow | undefined;
    if (!existing) return reply.code(404).send({ error: "player not found" });

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE players SET nickname = ?, steam_id = ?, avatar_url = ?, bust_image = ?, country = ?, webcam_url = ?, team_id = ?, hidden = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      body.nickname ?? existing.nickname,
      body.steamId ?? existing.steam_id,
      body.avatarUrl ?? existing.avatar_url,
      body.bustImage === undefined ? existing.bust_image : body.bustImage ? 1 : 0,
      body.country ?? existing.country,
      body.webcamUrl ?? existing.webcam_url,
      body.teamId ?? existing.team_id,
      body.hidden === undefined ? existing.hidden : body.hidden ? 1 : 0,
      now,
      id
    );
    return toPlayer(db.prepare("SELECT * FROM players WHERE id = ?").get(id) as unknown as PlayerRow);
  });

  app.delete("/api/players/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    db.prepare("DELETE FROM players WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
