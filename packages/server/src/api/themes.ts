import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ColorTheme } from "@cs2hud/shared";
import { db } from "../db/client.js";

interface ThemeRow {
  id: string;
  name: string;
  kind: ColorTheme["kind"];
  background_color: string;
  ct_color: string;
  t_color: string;
  corner_radius_px: number;
}

function toTheme(row: ThemeRow): ColorTheme {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    backgroundColor: row.background_color,
    ctColor: row.ct_color,
    tColor: row.t_color,
    cornerRadiusPx: row.corner_radius_px,
  };
}

export function registerThemeRoutes(app: FastifyInstance): void {
  app.get("/api/themes", async () => {
    const rows = db.prepare("SELECT * FROM color_themes ORDER BY kind, name").all() as unknown as ThemeRow[];
    return rows.map(toTheme);
  });

  // Section 4 — "+ New color": create a custom palette.
  app.post("/api/themes", async (request, reply) => {
    const body = request.body as Partial<ColorTheme>;
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const theme: ColorTheme = {
      id: randomUUID(),
      name: body.name,
      kind: "custom",
      backgroundColor: body.backgroundColor ?? "#0d0f12",
      ctColor: body.ctColor ?? "#5d79ae",
      tColor: body.tColor ?? "#c9a26d",
      cornerRadiusPx: body.cornerRadiusPx ?? 10,
    };
    db.prepare(
      `INSERT INTO color_themes (id, name, kind, background_color, ct_color, t_color, corner_radius_px)
       VALUES (?, ?, 'custom', ?, ?, ?, ?)`
    ).run(theme.id, theme.name, theme.backgroundColor, theme.ctColor, theme.tColor, theme.cornerRadiusPx);
    return reply.code(201).send(theme);
  });

  app.put("/api/themes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<ColorTheme>;
    const existing = db.prepare("SELECT * FROM color_themes WHERE id = ?").get(id) as unknown as ThemeRow | undefined;
    if (!existing) return reply.code(404).send({ error: "theme not found" });
    if (existing.kind === "builtin") return reply.code(403).send({ error: "builtin themes are read-only" });

    db.prepare(
      "UPDATE color_themes SET name = ?, background_color = ?, ct_color = ?, t_color = ?, corner_radius_px = ? WHERE id = ?"
    ).run(
      body.name ?? existing.name,
      body.backgroundColor ?? existing.background_color,
      body.ctColor ?? existing.ct_color,
      body.tColor ?? existing.t_color,
      body.cornerRadiusPx ?? existing.corner_radius_px,
      id
    );
    return toTheme(db.prepare("SELECT * FROM color_themes WHERE id = ?").get(id) as unknown as ThemeRow);
  });

  app.delete("/api/themes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare("SELECT * FROM color_themes WHERE id = ?").get(id) as unknown as ThemeRow | undefined;
    if (existing?.kind === "builtin") return reply.code(403).send({ error: "builtin themes cannot be deleted" });
    db.prepare("DELETE FROM color_themes WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
