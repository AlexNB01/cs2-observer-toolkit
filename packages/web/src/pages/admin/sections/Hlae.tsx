import { useEffect, useState } from "react";
import { Card, Row, StatusBadge, Toggle } from "../../../components/ui.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { api } from "../../../lib/api-client.js";
import { desktopBridge } from "../../../lib/desktop-bridge.js";

interface HlaeStatus { hlaeConfigured: boolean; cfgDirConfigured: boolean }

const VISUAL_TOGGLES = [
  { key: "hlaeKillfeedEnabled", label: "Killfeed" },
  { key: "hlaeXrayEnabled", label: "Xray" },
  { key: "hlaeTrailsEnabled", label: "Trails" },
  { key: "hlaeAboveHeadInfoEnabled", label: "Above-head information" },
  { key: "hlaeSmokesEnabled", label: "Smokes" },
] as const;

export function Hlae() {
  const { settings, update } = useHudSettings();
  const [status, setStatus] = useState<HlaeStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cfgPreview, setCfgPreview] = useState<string | null>(null);
  const [exePathText, setExePathText] = useState("");

  function reloadStatus() {
    api.get<HlaeStatus>("/hlae/status").then(setStatus).catch(console.error);
  }

  useEffect(reloadStatus, []);

  useEffect(() => {
    if (settings) setExePathText(settings.hlaeExePath);
  }, [settings?.hlaeExePath]);

  async function saveExePath(exePath: string) {
    await update({ hlaeExePath: exePath });
    reloadStatus();
  }

  async function browseExePath() {
    const file = await desktopBridge?.pickFile(["exe"]);
    if (file) {
      setExePathText(file);
      await saveExePath(file);
    }
  }

  async function launch() {
    setMessage(null);
    try {
      await api.post("/hlae/launch");
      setMessage("HLAE launched — use its File → Launch CS2 menu to start the game through it.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function sync() {
    setMessage(null);
    try {
      const result = await api.post<{ path: string }>("/hlae/sync");
      setMessage(`sync.cfg written to ${result.path} — run "exec sync" in the CS2 console.`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function previewCfg() {
    try {
      const result = await api.get<{ content: string }>("/hlae/sync-cfg");
      setCfgPreview(result.content);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  if (!settings) return <p>Loading…</p>;

  return (
    <Card title="HLAE integration" description="Advanced visuals via a third-party program that modifies the game.">
      <div style={{ background: "rgba(224,90,90,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
        HLAE modifies the game client. Only launch it if you trust the server you're about to join.{" "}
        <a href="https://www.hlae.online/" target="_blank" rel="noreferrer">HLAE FAQ</a>
      </div>

      <Row label="HLAE.exe path" hint="From https://www.hlae.online/ — not installed by this app">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={exePathText}
            onChange={(e) => setExePathText(e.target.value)}
            onBlur={() => { if (exePathText !== settings.hlaeExePath) void saveExePath(exePathText.trim()); }}
            placeholder="e.g. C:\HLAE\HLAE.exe"
            style={{ flex: 1, minWidth: 280 }}
          />
          <button className="secondary" onClick={browseExePath} disabled={!desktopBridge}>
            Browse…
          </button>
        </div>
      </Row>
      {!desktopBridge && (
        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          Native file picker isn't available outside the desktop app — paste the path above instead.
        </p>
      )}

      <Row label="CT color">
        <input type="color" value={settings.hlaeCtColor} onChange={(e) => update({ hlaeCtColor: e.target.value })} />
      </Row>
      <Row label="T color">
        <input type="color" value={settings.hlaeTColor} onChange={(e) => update({ hlaeTColor: e.target.value })} />
      </Row>

      <p>
        HLAE.exe: <StatusBadge ok={Boolean(status?.hlaeConfigured)} okLabel="Configured" badLabel="Set the path above" />{" "}
        CS2 cfg folder: <StatusBadge ok={Boolean(status?.cfgDirConfigured)} okLabel="Configured" badLabel="Set it on the GSI Setup page" />
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={launch} disabled={!status?.hlaeConfigured}>Launch HLAE</button>
        <button className="secondary" onClick={sync} disabled={!status?.cfgDirConfigured}>Write sync.cfg</button>
        <button className="secondary" onClick={previewCfg}>Preview sync.cfg</button>
      </div>
      {message && <p style={{ color: "var(--muted)" }}>{message}</p>}
      {cfgPreview && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0b0d10", padding: 12, borderRadius: 6, marginTop: 8 }}>
          {cfgPreview}
        </pre>
      )}

      <ol style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>
        <li>
          Launch HLAE via the button above, then use its own File → Launch CS2 menu to start the game through it — there's
          no reliable unattended command line for that step, so it's not automated further here.
        </li>
        <li>Configure the HUD as usual and join the match server</li>
        <li>
          Once all players have joined, click "Write sync.cfg" then run <code>exec sync</code> in the CS2 console (re-run
          any time to resync colors)
        </li>
      </ol>

      {VISUAL_TOGGLES.map(({ key, label }) => (
        <Row key={key} label={label}>
          <Toggle checked={settings[key]} onChange={(v) => update({ [key]: v })} />
        </Row>
      ))}
    </Card>
  );
}
