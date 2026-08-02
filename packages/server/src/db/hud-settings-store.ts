import type { HudSettings } from "@cs2hud/shared";
import { db } from "./client.js";
import { DEFAULT_HUD_SETTINGS } from "./schema.js";

/**
 * Merges with DEFAULT_HUD_SETTINGS rather than a plain JSON.parse — a
 * field added to HudSettings after a user's row was already persisted
 * would otherwise come back undefined for them forever (schema.ts's
 * defaults only ever seed a brand-new row, never backfill an existing
 * one). Merging on every read means a new field just needs its default
 * added once, here, with no migration step for existing installs.
 */
export function readHudSettings(): HudSettings {
  const row = db.prepare("SELECT json FROM hud_settings WHERE id = 1").get() as { json: string };
  return { ...DEFAULT_HUD_SETTINGS, ...(JSON.parse(row.json) as HudSettings) };
}

export function writeHudSettings(patch: Partial<HudSettings>): HudSettings {
  const merged: HudSettings = { ...readHudSettings(), ...patch, updatedAt: new Date().toISOString() };
  db.prepare("UPDATE hud_settings SET json = ? WHERE id = 1").run(JSON.stringify(merged));
  return merged;
}
