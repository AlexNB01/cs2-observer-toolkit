import { useEffect, useState } from "react";
import type { VetoAction, VetoMatch } from "@cs2hud/shared";
import { Card, Row, Toggle } from "../../../components/ui.js";
import { KeybindInput } from "../../../components/KeybindInput.js";
import { api } from "../../../lib/api-client.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";

const MAPS = ["Ancient", "Anubis", "Dust II", "Inferno", "Mirage", "Nuke", "Train"];

export function Veto() {
  const { settings, update } = useHudSettings();
  const [veto, setVeto] = useState<VetoMatch | null>(null);
  const [teamAName, setTeamAName] = useState("Team A");
  const [teamBName, setTeamBName] = useState("Team B");
  const [decidingMap, setDecidingMap] = useState("");
  const [actions, setActions] = useState<VetoAction[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  useEffect(() => {
    api.get<VetoMatch | null>("/veto").then((v) => {
      setVeto(v);
      if (v) {
        setTeamAName(v.teamAName);
        setTeamBName(v.teamBName);
        setDecidingMap(v.decidingMap ?? "");
        setActions(v.actions);
      }
    });
  }, []);

  function addAction() {
    setActions([...actions, { team: "team_a", action: "ban", map: MAPS[0] ?? "Ancient" }]);
  }

  function updateAction(i: number, patch: Partial<VetoAction>) {
    setActions(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function removeAction(i: number) {
    setActions(actions.filter((_, idx) => idx !== i));
  }

  async function save() {
    const saved = await api.put<VetoMatch>("/veto", { teamAName, teamBName, actions, decidingMap: decidingMap || undefined });
    setVeto(saved);
  }

  async function importMatch() {
    setImportError(null);
    setImportNotice(null);
    try {
      const imported = await api.post<Partial<VetoMatch>>("/veto/import", { url: importUrl });
      if (imported.teamAName) setTeamAName(imported.teamAName);
      if (imported.teamBName) setTeamBName(imported.teamBName);
      if (imported.decidingMap) setDecidingMap(imported.decidingMap);
      if (imported.actions) setActions(imported.actions);
      setImportNotice(
        imported.actions?.length
          ? "Imported — review below and click Save veto."
          : "Imported team names and the decided map. The full ban order isn't available from this source — add it manually below if you want it shown."
      );
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  if (!settings) return <p>Loading…</p>;

  return (
    <Card title="Veto / map-pick" description="Spec section 13.">
      <Row label="Veto overlay keybind" hint="Global hotkey toggle on /veto. Only works in the desktop app, not a plain browser tab">
        <KeybindInput value={settings.vetoKeybind} onChange={(v) => update({ vetoKeybind: v })} />
      </Row>
      <Row label="Full-height map cards">
        <Toggle checked={settings.vetoFullHeightCards} onChange={(v) => update({ vetoFullHeightCards: v })} />
      </Row>

      <h3 style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>Import a match</h3>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Compatible with Faceit and HLTV match URLs.</p>
      <div className="inline-form">
        <input type="text" placeholder="https://www.faceit.com/en/cs2/room/... or https://www.hltv.org/matches/..." value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
        <button onClick={importMatch}>Import</button>
      </div>
      {importError && <p style={{ color: "var(--danger)" }}>{importError}</p>}
      {importNotice && <p style={{ color: "var(--muted)" }}>{importNotice}</p>}

      <h3 style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>Manual veto</h3>
      <Row label="Team A"><input type="text" value={teamAName} onChange={(e) => setTeamAName(e.target.value)} /></Row>
      <Row label="Team B"><input type="text" value={teamBName} onChange={(e) => setTeamBName(e.target.value)} /></Row>
      <Row label="Deciding map" hint="The map that was actually played">
        <select value={decidingMap} onChange={(e) => setDecidingMap(e.target.value)}>
          <option value="">— none —</option>
          {MAPS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Row>

      {actions.map((a, i) => (
        <div key={i} className="inline-form">
          <select value={a.team} onChange={(e) => updateAction(i, { team: e.target.value as VetoAction["team"] })}>
            <option value="team_a">{teamAName}</option>
            <option value="team_b">{teamBName}</option>
          </select>
          <select value={a.action} onChange={(e) => updateAction(i, { action: e.target.value as VetoAction["action"] })}>
            <option value="ban">Ban</option>
            <option value="pick">Pick</option>
          </select>
          <select value={a.map} onChange={(e) => updateAction(i, { map: e.target.value })}>
            {MAPS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button className="danger" onClick={() => removeAction(i)}>Remove</button>
        </div>
      ))}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="secondary" onClick={addAction}>+ Add step</button>
        <button onClick={save}>Save veto</button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
        Standalone web source: <a href="/veto" target="_blank" rel="noreferrer">/veto</a> — usable as an OBS browser source without a HUD connection.
      </p>

      {veto && <p style={{ color: "var(--muted)", fontSize: 12 }}>Last saved: {new Date(veto.updatedAt).toLocaleString()}</p>}
    </Card>
  );
}
