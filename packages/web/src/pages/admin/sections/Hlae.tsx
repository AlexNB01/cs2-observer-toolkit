import { useEffect, useState } from "react";
import { Card, Row, StatusBadge, Toggle } from "../../../components/ui.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { api } from "../../../lib/api-client.js";

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

  useEffect(() => {
    api.get<HlaeStatus>("/hlae/status").then(setStatus).catch(console.error);
  }, []);

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
    <Card title="HLAE integration" description="Spec section 12 — advanced visuals via a third-party program that modifies the game.">
      <div style={{ background: "rgba(224,90,90,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
        HLAE modifies the game client. Only launch it if you trust the server you're about to join.{" "}
        <a href="https://www.hlae.online/" target="_blank" rel="noreferrer">HLAE FAQ</a>
      </div>

      <p>
        HLAE.exe: <StatusBadge ok={Boolean(status?.hlaeConfigured)} okLabel="Configured" badLabel="Set HLAE_EXE_PATH in server/.env" />{" "}
        CS2 cfg folder: <StatusBadge ok={Boolean(status?.cfgDirConfigured)} okLabel="Configured" badLabel="Set CS2_CFG_DIR in server/.env" />
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
