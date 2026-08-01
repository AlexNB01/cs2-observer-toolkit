import { useEffect, useState } from "react";
import { Card, StatusBadge } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";

interface CfgInfo { filename: string; content: string; autoInstallConfigured: boolean }
interface GsiStatus { connected: boolean; lastUpdatedAt: number | null }

export function Setup() {
  const [cfg, setCfg] = useState<CfgInfo | null>(null);
  const [status, setStatus] = useState<GsiStatus | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<CfgInfo>("/system/gsi-cfg").then(setCfg).catch(console.error);
    const poll = setInterval(() => {
      api.get<GsiStatus>("/system/gsi-status").then(setStatus).catch(console.error);
    }, 3000);
    return () => clearInterval(poll);
  }, []);

  async function install() {
    try {
      const result = await api.post<{ path: string }>("/system/gsi-cfg/install");
      setInstallMessage(`Written to ${result.path}`);
    } catch (err) {
      setInstallMessage((err as Error).message);
    }
  }

  return (
    <Card
      title="GSI setup"
      description="CS2 needs a .cfg file in its csgo/cfg folder telling it where to send live match state."
    >
      <p>
        Game connection: <StatusBadge ok={Boolean(status?.connected)} okLabel="Receiving GSI data" badLabel="No data yet" />
      </p>

      {cfg && (
        <>
          <p>
            Auto-install: <StatusBadge ok={cfg.autoInstallConfigured} okLabel="CS2_CFG_DIR configured" badLabel="Set CS2_CFG_DIR in server/.env" />
          </p>
          <button onClick={install} disabled={!cfg.autoInstallConfigured}>
            Install {cfg.filename} into CS2
          </button>
          {installMessage && <p>{installMessage}</p>}

          <details style={{ marginTop: 16 }}>
            <summary>Or copy it manually</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0b0d10", padding: 12, borderRadius: 6 }}>
              {cfg.content}
            </pre>
            <p style={{ color: "var(--muted)" }}>
              Save as <code>{cfg.filename}</code> inside your CS2 install's <code>game/csgo/cfg</code> folder.
            </p>
          </details>
        </>
      )}
    </Card>
  );
}
