import { useEffect, useState } from "react";
import { Card, Row, StatusBadge } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";

interface ObsStatus { connected: boolean; replayBufferActive: boolean }
interface ObsConfig { host: string; port: number; volume: number; hasPassword: boolean }

export function ObsReplay() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("4455");
  const [password, setPassword] = useState("");
  const [volume, setVolume] = useState(80);
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<ObsConfig>("/obs/config").then((c) => {
      setHost(c.host);
      setPort(String(c.port));
      setVolume(c.volume);
    }).catch(console.error);

    const poll = setInterval(() => {
      api.get<ObsStatus>("/obs/status").then(setStatus).catch(console.error);
    }, 3000);
    api.get<ObsStatus>("/obs/status").then(setStatus).catch(console.error);
    return () => clearInterval(poll);
  }, []);

  async function connect() {
    setError(null);
    try {
      // Omit password when left blank so the server keeps the previously
      // saved one instead of overwriting it with an empty string.
      const body: { host: string; port: number; password?: string } = { host, port: Number(port) };
      if (password) body.password = password;
      const result = await api.post<ObsStatus>("/obs/connect", body);
      setStatus(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveVolume(next: number) {
    setVolume(next);
    await api.put("/obs/volume", { volume: next });
  }

  async function triggerReplay() {
    setTriggerMessage(null);
    try {
      await api.post("/obs/trigger-replay");
      setTriggerMessage("Replay saved — will show in the HUD at the start of next freezetime.");
    } catch (e) {
      setTriggerMessage((e as Error).message);
    }
  }

  return (
    <Card title="OBS Replay integration" description="Spec section 8 — obs-websocket v5.">
      <Row label="Host"><input type="text" value={host} onChange={(e) => setHost(e.target.value)} /></Row>
      <Row label="Port"><input type="text" value={port} onChange={(e) => setPort(e.target.value)} /></Row>
      <Row label="Password" hint={status?.connected ? "Saved from a previous connection" : undefined}>
        <input type="password" placeholder={status?.connected ? "•••••••• (unchanged)" : ""} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Row>
      <Row label="Replay volume">
        <input type="number" min={0} max={100} value={volume} onChange={(e) => saveVolume(Number(e.target.value))} /> %
      </Row>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button onClick={connect}>Connect</button>
        <button className="secondary" onClick={triggerReplay} disabled={!status?.connected}>
          Trigger replay now
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {triggerMessage && <p style={{ color: "var(--muted)" }}>{triggerMessage}</p>}

      <p style={{ marginTop: 12 }}>
        Status: <StatusBadge ok={Boolean(status?.connected)} okLabel="Connected" badLabel="Disconnected" />{" "}
        <StatusBadge ok={Boolean(status?.replayBufferActive)} okLabel="Replay buffer active" badLabel="Replay buffer inactive" />
      </p>

      <ol style={{ color: "var(--muted)", fontSize: 13 }}>
        <li>Enable the WebSocket server in OBS (Tools → WebSocket Server Settings)</li>
        <li>Enable the Replay Buffer (Settings → Output → Replay Buffer, default 30s)</li>
        <li>
          Press the replay key during the game — the clip shows fullscreen in the HUD at the start of the next round's
          freezetime, then is removed. There's no in-game hotkey capture here (needs the native process from section 15),
          so use "Trigger replay now" above as the equivalent action.
        </li>
      </ol>
    </Card>
  );
}
