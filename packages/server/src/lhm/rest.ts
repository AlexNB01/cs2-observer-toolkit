import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { RADAR_CALIBRATION } from "@cs2hud/shared";
import { db } from "../db/client.js";
import { env } from "../config/env.js";

/**
 * REST surface expected by lexogrine/cs2-react-hud (MIT-licensed) — the
 * exact paths/shapes its src/API/index.ts and src/HUD/Radar/LexoRadar/maps
 * call. In production mode that app hardcodes its API base to "/" (see its
 * src/API/index.ts) — it can't be deployed under a path prefix — so this is
 * registered on its own dedicated Fastify app/port (lhm/app.ts) rather than
 * mounted into the main server, where a plain /api/players would collide
 * with this project's own differently-shaped /api/players route.
 */

interface PlayerRow {
  id: string;
  nickname: string;
  steam_id: string;
  avatar_url: string | null;
  country: string | null;
  team_id: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  logo_url: string | null;
}

function toLhmPlayer(row: PlayerRow) {
  return {
    _id: row.id,
    firstName: row.nickname,
    lastName: "",
    username: row.nickname,
    avatar: row.avatar_url ?? "",
    country: row.country ?? "",
    steamid: row.steam_id,
    team: row.team_id ?? "",
    extra: {},
  };
}

function toLhmTeam(row: TeamRow) {
  return {
    _id: row.id,
    name: row.name,
    country: "",
    shortName: row.name.slice(0, 4).toUpperCase(),
    logo: row.logo_url ?? "",
    extra: {},
  };
}

// lexogrine's LexoRadarContainer always computes player positions in a
// fixed 1024px reference box (`transform: scale(size/1024)` in
// LexoRadarContainer.tsx), then CSS-stretches the background image to fill
// it regardless of the image file's actual resolution (2048x2048 here —
// see packages/web/public/radar/README.md). So origin/pxPerU must be
// calibrated against that fixed 1024 reference, not the real image size —
// scaling by the image's actual pixel dimensions (as an earlier version of
// this code did) pushed every player dot off the edge of the visible map.
const IMAGE_SCALE = 1;

export function registerLhmRestRoutes(app: FastifyInstance): void {
  app.get("/api/players", async (request) => {
    const { steamids } = request.query as { steamids?: string };
    const rows = db.prepare("SELECT id, nickname, steam_id, avatar_url, country, team_id FROM players").all() as unknown as PlayerRow[];
    const filtered = steamids ? rows.filter((r) => steamids.split(";").includes(r.steam_id)) : rows;
    return filtered.map(toLhmPlayer);
  });

  app.get("/api/players/avatar/steamid/:steamid", async (request) => {
    const { steamid } = request.params as { steamid: string };
    const row = db.prepare("SELECT avatar_url FROM players WHERE steam_id = ?").get(steamid) as { avatar_url: string | null } | undefined;
    const url = row?.avatar_url ?? "";
    return { custom: url, steam: url };
  });

  app.get("/api/teams", async () => {
    const rows = db.prepare("SELECT id, name, logo_url FROM teams").all() as unknown as TeamRow[];
    return rows.map(toLhmTeam);
  });

  app.get("/api/teams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT id, name, logo_url FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
    if (!row) return reply.code(404).send({ error: "team not found" });
    return toLhmTeam(row);
  });

  // The HUD template resolves left/right team boxes and per-map veto data
  // from this. Our own veto model doesn't track real team-record links (its
  // team names are free text, section 13), so this does a best-effort name
  // match against the roster teams table and otherwise returns null — the
  // HUD renders fine without a match, it just won't show team names/logos
  // fed through this path (raw GSI score/timer keeps working regardless).
  app.get("/api/match/current", async (_request, reply) => {
    const row = db.prepare("SELECT json FROM veto_current WHERE id = 1").get() as { json: string | null } | undefined;
    if (!row?.json) return reply.send(null);

    const veto = JSON.parse(row.json) as {
      teamAName: string;
      teamBName: string;
      actions: { team: "team_a" | "team_b"; action: "pick" | "ban"; map: string }[];
      decidingMap?: string;
    };

    const teams = db.prepare("SELECT id, name FROM teams").all() as { id: string; name: string }[];
    const findTeamId = (name: string) => teams.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id ?? null;

    return {
      id: "current",
      current: true,
      left: { id: findTeamId(veto.teamAName), wins: 0 },
      right: { id: findTeamId(veto.teamBName), wins: 0 },
      matchType: "bo1",
      vetos: veto.actions.map((a) => ({
        teamId: a.team === "team_a" ? findTeamId(veto.teamAName) : findTeamId(veto.teamBName),
        mapName: a.map,
        side: "NO",
        type: a.action,
        mapEnd: false,
      })),
    };
  });

  app.get("/api/game-maps/cs2", async () => {
    return Object.entries(RADAR_CALIBRATION).map(([mapName, cal]) => {
      const pxPerUX = IMAGE_SCALE / cal.scale;
      const pxPerUY = -IMAGE_SCALE / cal.scale;
      return {
        _id: mapName,
        name: mapName,
        lhmId: mapName,
        game: "cs2",
        inVetoPool: true,
        isActive: true,
        radars: [
          {
            id: 1,
            lhmId: "default",
            originX: -cal.posX * pxPerUX,
            originY: -cal.posY * pxPerUY,
            pxPerUX,
            pxPerUY,
            radar: `/api/game-maps/cs2/image/${mapName}/radar`,
            visibleOverHeight: null,
            visibleUnderHeight: null,
          },
        ],
      };
    });
  });

  app.get("/api/game-maps/cs2/image/:lhmId/radar", async (request, reply) => {
    const { lhmId } = request.params as { lhmId: string };
    const filePath = path.join(env.webDistDir, "radar", `${lhmId}.png`);
    if (!fs.existsSync(filePath)) return reply.code(404).send();
    reply.type("image/png");
    return reply.send(fs.createReadStream(filePath));
  });

  // No tournament-bracket system in this project (section 13 is a flat
  // veto/map-pick, not a bracket) — the template handles an empty list fine.
  app.get("/api/tournament", async () => []);

  // vMix camera-switching feature — out of scope (this project's observer
  // automation is the separate Smart Observer feature, section 10/15), so
  // this just reports no cameras rather than 404ing.
  app.get("/api/camera", async () => ({ availablePlayers: [], uuid: randomUUID() }));
}
