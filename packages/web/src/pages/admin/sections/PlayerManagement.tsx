import { useEffect, useState } from "react";
import type { Player, Team } from "@cs2hud/shared";
import { Card, Row, Toggle } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";

interface OnServerPlayer { steamId: string; nickname: string; team: "CT" | "T" }

const emptyForm = { nickname: "", steamId: "", avatarUrl: "", bustImage: false, country: "", webcamUrl: "", teamId: "" };

export function PlayerManagement() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [onServer, setOnServer] = useState<OnServerPlayer[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  function reload() {
    api.get<Player[]>("/players").then(setPlayers).catch(console.error);
    api.get<Team[]>("/teams").then(setTeams).catch(console.error);
    api.get<OnServerPlayer[]>("/players/on-server").then(setOnServer).catch(console.error);
  }
  useEffect(reload, []);

  async function save() {
    if (!form.nickname || !form.steamId) return;
    const payload = { ...form, teamId: form.teamId || undefined };
    if (editingId) await api.put(`/players/${editingId}`, payload);
    else await api.post("/players", payload);
    setForm(emptyForm);
    setEditingId(null);
    reload();
  }

  function edit(p: Player) {
    setEditingId(p.id);
    setForm({
      nickname: p.nickname,
      steamId: p.steamId,
      avatarUrl: p.avatarUrl ?? "",
      bustImage: p.bustImage,
      country: p.country ?? "",
      webcamUrl: p.webcamUrl ?? "",
      teamId: p.teamId ?? "",
    });
  }

  async function remove(id: string) {
    await api.del(`/players/${id}`);
    reload();
  }

  async function hide(p: Player) {
    await api.put(`/players/${p.id}`, { hidden: !p.hidden });
    reload();
  }

  const filtered = players.filter(
    (p) => p.nickname.toLowerCase().includes(search.toLowerCase()) || (teams.find((t) => t.id === p.teamId)?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );
  const ct = onServer.filter((p) => p.team === "CT");
  const t = onServer.filter((p) => p.team === "T");

  return (
    <Card title="Player management" description="Spec section 10 — requires you to have joined the target server for GSI to detect players.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: 13, color: "var(--muted)" }}>Anti-Terrorists</h3>
          {ct.length === 0 && <p className="empty-state">None detected.</p>}
          {ct.map((p) => (
            <div className="list-item" key={p.steamId}>
              <span>{p.nickname}</span>
              <button className="secondary" onClick={() => setForm({ ...emptyForm, nickname: p.nickname, steamId: p.steamId })}>
                Personalize
              </button>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ fontSize: 13, color: "var(--muted)" }}>Terrorists</h3>
          {t.length === 0 && <p className="empty-state">None detected.</p>}
          {t.map((p) => (
            <div className="list-item" key={p.steamId}>
              <span>{p.nickname}</span>
              <button className="secondary" onClick={() => setForm({ ...emptyForm, nickname: p.nickname, steamId: p.steamId })}>
                Personalize
              </button>
            </div>
          ))}
        </div>
      </div>

      <h3 style={{ fontSize: 13, color: "var(--muted)", marginTop: 20 }}>Edited players</h3>
      <input type="text" placeholder="Search by nickname or team" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      {filtered.length === 0 && <p className="empty-state">No saved players yet.</p>}
      {filtered.map((p) => (
        <div className="list-item" key={p.id}>
          <span>
            {p.nickname} {p.hidden && <em style={{ color: "var(--muted)" }}>(hidden)</em>}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="secondary" onClick={() => edit(p)}>Edit</button>
            <button className="secondary" onClick={() => hide(p)}>{p.hidden ? "Unhide" : "Hide"}</button>
            <button className="danger" onClick={() => remove(p.id)}>Delete</button>
          </span>
        </div>
      ))}

      <h3 style={{ fontSize: 13, color: "var(--muted)", marginTop: 20 }}>{editingId ? "Edit player" : "Add a player"}</h3>
      <Row label="Nickname*"><input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} /></Row>
      <Row label="Steam ID*"><input type="text" value={form.steamId} onChange={(e) => setForm({ ...form, steamId: e.target.value })} /></Row>
      <Row label="Avatar URL" hint="jpg/png/jpeg/webp">
        <input type="text" value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} />
      </Row>
      <Row label="Bust image (pro)"><Toggle checked={form.bustImage} onChange={(v) => setForm({ ...form, bustImage: v })} /></Row>
      <Row label="Country"><input type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Row>
      <Row label="Webcam link" hint="e.g. VDO.ninja"><input type="text" value={form.webcamUrl} onChange={(e) => setForm({ ...form, webcamUrl: e.target.value })} /></Row>
      <Row label="Team">
        <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
          <option value="">— none —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </Row>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button onClick={save}>Edit & Save</button>
        {editingId && (
          <button className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
            Cancel
          </button>
        )}
      </div>
    </Card>
  );
}
