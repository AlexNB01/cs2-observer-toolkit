import { useEffect, useState } from "react";
import type { HudSettings, VetoMatch } from "@cs2hud/shared";
import { api } from "../../lib/api-client.js";
import { useHudSocket } from "../../lib/ws-client.js";

export function VetoStandalone() {
  const [settings, setSettings] = useState<HudSettings | null>(null);
  const [veto, setVeto] = useState<VetoMatch | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    api.get<HudSettings>("/hud-settings").then(setSettings).catch(console.error);
    api.get<VetoMatch | null>("/veto").then(setVeto).catch(console.error);
  }, []);

  useHudSocket((message) => {
    if (message.kind === "settings_updated") setSettings(message.settings);
    if (message.kind === "veto_updated") setVeto(message.veto);
    if (message.kind === "veto_visibility_toggle") setVisible((prev) => !prev);
  });

  if (!veto || !visible) return <div className="obs-source-view" />;

  const cardHeight = settings?.vetoFullHeightCards ? "100vh" : "auto";

  return (
    <div className="obs-source-view" style={{ display: "flex", alignItems: "flex-end", padding: 16, gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 4px" }}>{veto.teamAName}</h2>
      </div>
      <div style={{ display: "flex", gap: 8, flex: 1, height: cardHeight }}>
        {veto.actions.map((action, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              background: action.action === "ban" ? "rgba(224,90,90,0.25)" : "rgba(76,175,111,0.25)",
              borderRadius: 6,
              padding: 8,
              fontSize: 12,
              textAlign: "center",
            }}
          >
            <strong>{action.map}</strong>
            <span style={{ opacity: 0.8 }}>{action.action.toUpperCase()} — {action.team === "team_a" ? veto.teamAName : veto.teamBName}</span>
          </div>
        ))}
      </div>
      <div>
        <h2 style={{ margin: "0 0 4px" }}>{veto.teamBName}</h2>
      </div>
      {veto.decidingMap && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", fontSize: 14 }}>
          Deciding map: <strong>{veto.decidingMap}</strong>
        </div>
      )}
    </div>
  );
}
