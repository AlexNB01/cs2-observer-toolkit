import { useEffect, useState } from "react";
import type { CinematicShot, ObserverQueueItem } from "@cs2hud/shared";
import { RADAR_CALIBRATION } from "@cs2hud/shared";
import { Card, Row, Toggle } from "../../../components/ui.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { useHudSocket } from "../../../lib/ws-client.js";
import { api } from "../../../lib/api-client.js";

const EVENT_LABEL: Record<ObserverQueueItem["eventType"], string> = {
  CLUTCH: "Clutch",
  TRADE: "Trade",
  MULTI_KILL: "Multi-kill",
  DUEL: "Duel",
  BOMB: "Defusing",
  ENGAGING: "Engaging",
  PROXIMITY: "Close proximity",
  BURNING: "On fire",
  LOW_HP: "Low HP",
  BOMB_STACK: "Stacked with bomb",
  CT_STACK: "CT rotate/stack",
  UTILITY: "Grenade incoming",
};

const SLOT_LABEL: Record<CinematicShot["slot"], string> = {
  ct: "CT spawn (freezetime)",
  t: "T spawn (freezetime)",
  poi: "Point of interest (bomb plant / quiet moment)",
};

const TRIGGER_LABEL: Record<"freezetime" | "bomb_plant" | "quiet_moment", string> = {
  freezetime: "Freezetime",
  bomb_plant: "Bomb plant",
  quiet_moment: "Quiet moment",
};

const MAPS = Object.keys(RADAR_CALIBRATION).sort();

function shotToText(shot: { x: number; y: number; z: number; pitch: number; yaw: number }): string {
  return `${shot.x} ${shot.y} ${shot.z} ${shot.pitch} ${shot.yaw}`;
}

function parseShot(text: string): { x: number; y: number; z: number; pitch: number; yaw: number } | null {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 5 || parts.some(Number.isNaN)) return null;
  const [x, y, z, pitch, yaw] = parts as [number, number, number, number, number];
  return { x, y, z, pitch, yaw };
}

export function SmartObserver() {
  const { settings, update } = useHudSettings();
  const [queue, setQueue] = useState<ObserverQueueItem[]>([]);
  const [allShots, setAllShots] = useState<CinematicShot[]>([]);
  const [selectedMap, setSelectedMap] = useState(MAPS[0] ?? "de_mirage");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelText, setLabelText] = useState("");
  const [slot, setSlot] = useState<CinematicShot["slot"]>("ct");
  const [coordsText, setCoordsText] = useState("");
  const [cinematicMessage, setCinematicMessage] = useState<string | null>(null);
  const [cinematicCfg, setCinematicCfg] = useState<string | null>(null);
  const [lastCue, setLastCue] = useState<string | null>(null);
  const [netconsoleConnected, setNetconsoleConnected] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<ObserverQueueItem[]>("/observer/queue").then(setQueue).catch(console.error);
    function pollStatus() {
      api
        .get<{ connected: boolean }>("/observer/netconsole-status")
        .then((s) => setNetconsoleConnected(s.connected))
        .catch(console.error);
    }
    pollStatus();
    const poll = setInterval(pollStatus, 3000);
    return () => clearInterval(poll);
  }, []);

  function reloadShots() {
    api.get<CinematicShot[]>("/cinematic/shots").then(setAllShots).catch(console.error);
  }
  useEffect(reloadShots, []);

  useHudSocket((message) => {
    if (message.kind === "observer_queue_updated") setQueue(message.queue);
    if (message.kind === "cinematic_cue") {
      setLastCue(
        message.autoTriggered
          ? `${TRIGGER_LABEL[message.trigger]}: ${message.label} — camera moved automatically`
          : `${TRIGGER_LABEL[message.trigger]}: ${message.label} — netconsole not connected, run "${message.execCommand}" yourself (or bind it to a key)`
      );
    }
  });

  function resetForm() {
    setEditingId(null);
    setLabelText("");
    setSlot("ct");
    setCoordsText("");
  }

  function startEdit(s: CinematicShot) {
    setEditingId(s.id);
    setLabelText(s.label);
    setSlot(s.slot);
    setCoordsText(shotToText(s.shot));
  }

  async function saveShot() {
    setCinematicMessage(null);
    if (!labelText.trim()) {
      setCinematicMessage("Label is required.");
      return;
    }
    const shot = parseShot(coordsText);
    if (!shot) {
      setCinematicMessage('Expected 5 numbers: "x y z pitch yaw"');
      return;
    }
    const body = { mapName: selectedMap, label: labelText.trim(), slot, shot };
    if (editingId) {
      await api.put(`/cinematic/shots/${editingId}`, body);
    } else {
      await api.post("/cinematic/shots", body);
    }
    setCinematicMessage(`Saved "${body.label}".`);
    resetForm();
    reloadShots();
  }

  async function deleteShot(id: string) {
    await api.del(`/cinematic/shots/${id}`);
    if (editingId === id) resetForm();
    reloadShots();
  }

  async function previewCfg() {
    try {
      const result = await api.get<{ content: string }>(`/cinematic/cfg?map=${selectedMap}`);
      setCinematicCfg(result.content);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  async function installCfg() {
    try {
      const result = await api.post<{ path: string }>("/cinematic/cfg/install", { map: selectedMap });
      setCinematicMessage(`cinematic.cfg written to ${result.path}. Bind the printed aliases to keys as a manual fallback.`);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  if (!settings) return <p>Loading…</p>;

  const shotsForMap = allShots.filter((s) => s.mapName === selectedMap);
  const mapReady = (m: string) => {
    const shots = allShots.filter((s) => s.mapName === m);
    return shots.some((s) => s.slot === "ct") && shots.some((s) => s.slot === "t");
  };
  const readyCount = MAPS.filter(mapReady).length;

  return (
    <>
      <Card
        title="Smart Auto Observer"
        description="Spec section 5 — real-time GSI analysis detects interesting moments and suggests the POV to switch to."
      >
        <Row label="Smart Auto Observer" hint="Scores kills into a priority queue: multi-kills, clutches, trades">
          <Toggle checked={settings.smartObserverEnabled} onChange={(v) => update({ smartObserverEnabled: v })} />
        </Row>

        <Row label="Auto-switch inside CS2" hint="Sends spec_player over CS2's netconsole — targets a player by name directly, no calibration needed">
          <Toggle checked={settings.autoSwitchInsideCs2} onChange={(v) => update({ autoSwitchInsideCs2: v })} />
        </Row>

        {settings.autoSwitchInsideCs2 && (
          <>
            <p style={{ color: netconsoleConnected ? "var(--ok)" : "var(--danger)" }}>
              {netconsoleConnected === null
                ? "Checking netconsole connection…"
                : netconsoleConnected
                  ? "Connected to CS2's netconsole"
                  : "Not connected — launch CS2 with the matching -netconport option below, and make sure it's running"}
            </p>
            <Row label="CS2 netconsole port" hint={`Add "-netconport ${settings.cs2NetconsolePort}" to CS2's Steam launch options (Properties → General → Launch Options) and relaunch CS2 — must match the port here`}>
              <input
                type="number"
                value={settings.cs2NetconsolePort}
                onChange={(e) => update({ cs2NetconsolePort: Number(e.target.value) || 2121 })}
                style={{ width: 90 }}
              />
            </Row>
          </>
        )}

        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Live priority ranking</h3>
        {!settings.smartObserverEnabled ? (
          <p className="empty-state">Enable Smart Auto Observer above to start scoring players.</p>
        ) : queue.length === 0 ? (
          <p className="empty-state">Empty — nobody has a nonzero score right now.</p>
        ) : (
          queue.map((item) => (
            <div className="list-item" key={item.playerSteamId}>
              <span>{item.playerName} ({item.side})</span>
              <span>{EVENT_LABEL[item.eventType]} · priority {item.priority}</span>
            </div>
          ))
        )}
      </Card>

      <Card
        title="Cinematic camera shots"
        description={`${readyCount}/${MAPS.length} maps have both a CT and T freezetime shot captured.`}
      >
        <Row label="Freezetime shots" hint="Winner's side first, rotates through however many CT/T shots you've captured for the map">
          <Toggle checked={settings.cinematicFreezetimeShotsEnabled} onChange={(v) => update({ cinematicFreezetimeShotsEnabled: v })} />
        </Row>
        <Row label="Bomb plant shots" hint="As planting starts, cuts to whichever captured shot (any type) is nearest the plant">
          <Toggle checked={settings.cinematicBombPlantShotsEnabled} onChange={(v) => update({ cinematicBombPlantShotsEnabled: v })} />
        </Row>
        <Row label="Quiet-moment filler shots" hint="Cuts briefly to a point-of-interest shot (e.g. mid) when players are near it and nothing else is happening">
          <Toggle checked={settings.cinematicQuietMomentShotsEnabled} onChange={(v) => update({ cinematicQuietMomentShotsEnabled: v })} />
        </Row>

        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          There's no way to guess good camera spots without being in the map. In CS2: <code>spec_mode 6</code>, fly to a spot, run{" "}
          <code>spec_pos</code>, and paste the printed x/y/z/pitch/yaw below. Capture as many as you want per map — CT/T spawn shots
          rotate at freezetime, everything else (bomb sites, mid, ...) is a "point of interest" shown mid-round.
        </p>

        <Row label="Map">
          <select value={selectedMap} onChange={(e) => { setSelectedMap(e.target.value); resetForm(); }}>
            {MAPS.map((m) => (
              <option key={m} value={m}>
                {m} {mapReady(m) ? "✓" : ""}
              </option>
            ))}
          </select>
        </Row>

        {shotsForMap.length === 0 ? (
          <p className="empty-state">No shots captured for {selectedMap} yet.</p>
        ) : (
          shotsForMap.map((s) => (
            <div className="list-item" key={s.id}>
              <span>
                {s.label} <small style={{ color: "var(--muted)" }}>({SLOT_LABEL[s.slot]})</small>
              </span>
              <span>
                <button className="secondary" onClick={() => startEdit(s)}>Edit</button>{" "}
                <button className="secondary" onClick={() => deleteShot(s.id)}>Delete</button>
              </span>
            </div>
          ))
        )}

        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>{editingId ? "Edit shot" : "Add shot"}</h3>
        <Row label="Label" hint='e.g. "CT spawn", "Mid", "Bombsite A"'>
          <input type="text" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
        </Row>
        <Row label="Type">
          <select value={slot} onChange={(e) => setSlot(e.target.value as CinematicShot["slot"])}>
            <option value="ct">CT spawn (freezetime)</option>
            <option value="t">T spawn (freezetime)</option>
            <option value="poi">Point of interest (bomb plant / quiet moment)</option>
          </select>
        </Row>
        <Row label="Coordinates" hint="x y z pitch yaw">
          <input type="text" placeholder="e.g. -500 1200 150 -5 90" value={coordsText} onChange={(e) => setCoordsText(e.target.value)} />
        </Row>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={saveShot}>{editingId ? "Save changes" : "Add shot"}</button>
          {editingId && <button className="secondary" onClick={resetForm}>Cancel</button>}
          <button className="secondary" onClick={previewCfg}>Preview cfg</button>
          <button className="secondary" onClick={installCfg}>Install cinematic.cfg</button>
        </div>
        {cinematicMessage && <p style={{ color: "var(--muted)" }}>{cinematicMessage}</p>}
        {cinematicCfg && (
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0b0d10", padding: 12, borderRadius: 6, marginTop: 8 }}>
            {cinematicCfg}
          </pre>
        )}

        {lastCue && (
          <p style={{ marginTop: 12, color: "var(--accent)" }}>
            📷 Live cue: {lastCue}
          </p>
        )}
      </Card>
    </>
  );
}
