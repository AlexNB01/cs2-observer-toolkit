import { useEffect, useState } from "react";
import type { CinematicMapCameras, ObserverQueueItem } from "@cs2hud/shared";
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
  BOMB: "Bomb plant/defuse",
  ENGAGING: "Engaging",
  PROXIMITY: "Close proximity",
  BURNING: "On fire",
  LOW_HP: "Low HP",
  BOMB_STACK: "Stacked with bomb",
  CT_STACK: "CT rotate/stack",
};

const MAPS = Object.keys(RADAR_CALIBRATION).sort();

function shotToText(shot: { x: number; y: number; z: number; pitch: number; yaw: number } | null): string {
  return shot ? `${shot.x} ${shot.y} ${shot.z} ${shot.pitch} ${shot.yaw}` : "";
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
  const [cameras, setCameras] = useState<CinematicMapCameras[]>([]);
  const [selectedMap, setSelectedMap] = useState(MAPS[0] ?? "de_mirage");
  const [ctText, setCtText] = useState("");
  const [tText, setTText] = useState("");
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

  function reloadCameras() {
    api.get<CinematicMapCameras[]>("/cinematic/cameras").then(setCameras).catch(console.error);
  }
  useEffect(reloadCameras, []);

  useEffect(() => {
    const existing = cameras.find((c) => c.mapName === selectedMap);
    setCtText(shotToText(existing?.ctShot ?? null));
    setTText(shotToText(existing?.tShot ?? null));
  }, [selectedMap, cameras]);

  useHudSocket((message) => {
    if (message.kind === "observer_queue_updated") setQueue(message.queue);
    if (message.kind === "cinematic_cue") {
      setLastCue(
        message.autoTriggered
          ? `${message.side.toUpperCase()} shot — camera moved automatically`
          : `${message.side.toUpperCase()} shot — netconsole not connected, run "${message.execCommand}" yourself (or bind it to a key)`
      );
    }
  });

  async function saveCameras() {
    setCinematicMessage(null);
    const ctShot = ctText.trim() ? parseShot(ctText) : null;
    const tShot = tText.trim() ? parseShot(tText) : null;
    if ((ctText.trim() && !ctShot) || (tText.trim() && !tShot)) {
      setCinematicMessage('Expected 5 numbers: "x y z pitch yaw"');
      return;
    }
    await api.put(`/cinematic/cameras/${selectedMap}`, { ctShot, tShot });
    setCinematicMessage(`Saved ${selectedMap}.`);
    reloadCameras();
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
      setCinematicMessage(`cinematic.cfg written to ${result.path}. Bind cinematic_ct / cinematic_t to keys, or run "exec cinematic" then the alias.`);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  if (!settings) return <p>Loading…</p>;

  const capturedCount = cameras.filter((c) => c.ctShot && c.tShot).length;

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
        title="Cinematic freezetime cameras"
        description={`Two fixed shots (winner's side first) shown before handing back to the Smart Observer. ${capturedCount}/${MAPS.length} maps captured.`}
      >
        <Row label="Cinematic shots during freezetime">
          <Toggle checked={settings.cinematicFreezetimeShotsEnabled} onChange={(v) => update({ cinematicFreezetimeShotsEnabled: v })} />
        </Row>

        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          There's no way to guess good camera spots without being in the map. In CS2: <code>spec_mode 6</code>, fly to a spot with a good
          view of T spawn / CT spawn, run <code>spec_pos</code>, and paste the printed x/y/z/pitch/yaw below.
        </p>

        <Row label="Map">
          <select value={selectedMap} onChange={(e) => setSelectedMap(e.target.value)}>
            {MAPS.map((m) => (
              <option key={m} value={m}>
                {m} {cameras.find((c) => c.mapName === m)?.ctShot && cameras.find((c) => c.mapName === m)?.tShot ? "✓" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label="CT shot" hint="x y z pitch yaw">
          <input type="text" placeholder="e.g. -500 1200 150 -5 90" value={ctText} onChange={(e) => setCtText(e.target.value)} />
        </Row>
        <Row label="T shot" hint="x y z pitch yaw">
          <input type="text" placeholder="e.g. 800 -300 100 -8 -120" value={tText} onChange={(e) => setTText(e.target.value)} />
        </Row>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={saveCameras}>Save</button>
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
