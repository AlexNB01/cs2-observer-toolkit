import { useCallback, useEffect, useState } from "react";
import type { HudSettings } from "@cs2hud/shared";
import { api } from "./api-client.js";
import { useHudSocket } from "./ws-client.js";

export function useHudSettings() {
  const [settings, setSettings] = useState<HudSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<HudSettings>("/hud-settings").then(setSettings).catch(console.error);
  }, []);

  useHudSocket((message) => {
    if (message.kind === "settings_updated") setSettings(message.settings);
  });

  const update = useCallback(async (patch: Partial<HudSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    setSaving(true);
    try {
      const updated = await api.put<HudSettings>("/hud-settings", patch);
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, update, saving };
}
