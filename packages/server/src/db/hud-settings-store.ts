import type { HudSettings } from "@cs2hud/shared";
import { db } from "./client.js";

export function readHudSettings(): HudSettings {
  const row = db.prepare("SELECT json FROM hud_settings WHERE id = 1").get() as { json: string };
  return JSON.parse(row.json) as HudSettings;
}

export function writeHudSettings(patch: Partial<HudSettings>): HudSettings {
  const merged: HudSettings = { ...readHudSettings(), ...patch, updatedAt: new Date().toISOString() };
  db.prepare("UPDATE hud_settings SET json = ? WHERE id = 1").run(JSON.stringify(merged));
  return merged;
}
