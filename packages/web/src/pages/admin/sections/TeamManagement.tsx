import { useEffect, useState } from "react";
import type { Player, Team } from "@cs2hud/shared";
import { Card, Row, Toggle } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";

export function TeamManagement() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");

  function reload() {
    api.get<Team[]>("/teams").then(setTeams).catch(console.error);
    api.get<Player[]>("/players").then(setPlayers).catch(console.error);
  }
  useEffect(reload, []);

  async function createTeam() {
    if (!newName.trim()) return;
    await api.post("/teams", { name: newName.trim() });
    setNewName("");
    reload();
  }

  async function toggleActive(team: Team) {
    await api.put(`/teams/${team.id}`, { active: !team.active });
    reload();
  }

  async function remove(id: string) {
    await api.del(`/teams/${id}`);
    reload();
  }

  async function deleteAll() {
    await Promise.all(teams.map((t) => api.del(`/teams/${t.id}`)));
    reload();
  }

  const active = teams.filter((t) => t.active);
  const filtered = teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card title="Team management" description="Spec section 11.">
      <h3 style={{ fontSize: 13, color: "var(--muted)" }}>Active teams</h3>
      {active.length === 0 && <p className="empty-state">Shown once at least one player from each team is on the server.</p>}
      {active.map((t) => (
        <div className="list-item" key={t.id}>
          <span>{t.name}</span>
          <button className="danger" onClick={() => remove(t.id)}>Delete</button>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Edited teams</h3>
        <button className="danger" onClick={deleteAll}>Delete all</button>
      </div>
      <input type="text" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", margin: "8px 0" }} />
      {filtered.map((t) => (
        <div className="list-item" key={t.id}>
          <span>
            {t.name} <small style={{ color: "var(--muted)" }}>{t.id.slice(0, 8)} · {players.filter((p) => p.teamId === t.id).length} players</small>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Toggle checked={t.active} onChange={() => toggleActive(t)} />
            <button className="danger" onClick={() => remove(t.id)}>Delete</button>
          </span>
        </div>
      ))}

      <div className="inline-form">
        <input type="text" placeholder="New team name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={createTeam}>+ Add a team</button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
        Team ID is generated on creation. Logo upload and roster assignment (attach saved players) happen from each player's edit form under Roster → Players.
      </p>
    </Card>
  );
}
