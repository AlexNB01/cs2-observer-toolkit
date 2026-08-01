import { useEffect, useState } from "react";
import type { Player, PlayerStatsCard, StatsProvider } from "@cs2hud/shared";
import { Card, Row } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";

interface OnServerPlayer { steamId: string; nickname: string; team: "CT" | "T" }

export function PlayerStats() {
  const { settings } = useHudSettings();
  const [provider, setProvider] = useState<StatsProvider>("live");
  const [myPlayers, setMyPlayers] = useState<Player[]>([]);
  const [onServer, setOnServer] = useState<OnServerPlayer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<PlayerStatsCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Player[]>("/players").then(setMyPlayers).catch(console.error);
    api.get<OnServerPlayer[]>("/players/on-server").then(setOnServer).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    setCard(null);
    api
      .get<PlayerStatsCard>(`/stats/${selected}?provider=${provider}`)
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [selected, provider]);

  return (
    <Card title="Player stats" description="Spec section 7 — live card shown in the HUD (keybind: O).">
      <Row label="Data provider">
        <select value={provider} onChange={(e) => setProvider(e.target.value as StatsProvider)}>
          <option value="live">Live (from GSI)</option>
          <option value="faceit">Faceit</option>
        </select>
      </Row>

      <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>My players</h3>
      {myPlayers.length === 0 && <p className="empty-state">No saved players yet — add some under Roster → Players.</p>}
      {myPlayers.map((p) => (
        <div className="list-item" key={p.id}>
          <span>{p.nickname}</span>
          <button className="secondary" onClick={() => setSelected(p.steamId)}>Preview</button>
        </div>
      ))}

      <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Players on the server</h3>
      {onServer.length === 0 && <p className="empty-state">Join the target server for players to appear here.</p>}
      {onServer.map((p) => (
        <div className="list-item" key={p.steamId}>
          <span>{p.nickname} ({p.team})</span>
          <button className="secondary" onClick={() => setSelected(p.steamId)}>Preview</button>
        </div>
      ))}

      {selected && (
        <div className="card" style={{ marginTop: 16, background: "var(--panel-2)" }}>
          <div className="card-body" style={{ paddingTop: 16 }}>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
            {card && (
              <div style={{ display: "flex", gap: 12 }}>
                {card.avatarUrl && <img src={card.avatarUrl} alt="" width={48} height={48} style={{ borderRadius: 6 }} />}
                <div>
                  <strong>{card.nickname}</strong>
                  {card.elo !== undefined && <span style={{ marginLeft: 8, color: "var(--muted)" }}>{card.elo} ELO</span>}
                  <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 6px" }}>Data by {card.provider}</p>
                  <p style={{ margin: 0 }}>
                    K/D: {card.kd?.toFixed(2) ?? "—"} · Win rate: {card.winRatePct !== undefined ? `${card.winRatePct}%` : "—"} · ADR:{" "}
                    {card.adr ?? "—"} · HS%: {card.hsPct !== undefined ? `${card.hsPct}%` : "—"}
                  </p>
                  {card.bestMap && (
                    <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
                      Best map: {card.bestMap} ({card.mapWinRates?.[card.bestMap]}% win rate)
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!settings?.scoreboardAvatarsEnabled && (
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          Tip: enable scoreboard avatars under In-game visuals to show these players' photos in the HUD too.
        </p>
      )}
    </Card>
  );
}
