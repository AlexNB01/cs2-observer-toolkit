import { useEffect, useRef, useState } from "react";
import type { BackupData } from "@cs2hud/shared";
import { Card, Row, StatusBadge } from "../../../components/ui.js";
import { api } from "../../../lib/api-client.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { desktopBridge } from "../../../lib/desktop-bridge.js";

interface CfgInfo { filename: string; content: string; autoInstallConfigured: boolean }
interface GsiStatus { connected: boolean; lastUpdatedAt: number | null }

export function Setup() {
  const { settings, update } = useHudSettings();
  const [cfg, setCfg] = useState<CfgInfo | null>(null);
  const [status, setStatus] = useState<GsiStatus | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [cfgDirText, setCfgDirText] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  function reloadCfg() {
    api.get<CfgInfo>("/system/gsi-cfg").then(setCfg).catch(console.error);
  }

  useEffect(() => {
    reloadCfg();
    const poll = setInterval(() => {
      api.get<GsiStatus>("/system/gsi-status").then(setStatus).catch(console.error);
    }, 3000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (settings) setCfgDirText(settings.cs2CfgDir);
  }, [settings?.cs2CfgDir]);

  async function saveCfgDir(dir: string) {
    await update({ cs2CfgDir: dir });
    reloadCfg();
  }

  async function browseCfgDir() {
    const dir = await desktopBridge?.pickFolder();
    if (dir) {
      setCfgDirText(dir);
      await saveCfgDir(dir);
    }
  }

  async function install() {
    try {
      const result = await api.post<{ path: string }>("/system/gsi-cfg/install");
      setInstallMessage(`Written to ${result.path}`);
    } catch (err) {
      setInstallMessage((err as Error).message);
    }
  }

  async function exportBackup() {
    setBackupMessage(null);
    try {
      const data = await api.get<BackupData>("/backup/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cs2-observer-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMessage(`Exported ${data.cinematicShots.length} camera shot(s) and all settings.`);
    } catch (err) {
      setBackupMessage((err as Error).message);
    }
  }

  function chooseImportFile() {
    setBackupMessage(null);
    importInputRef.current?.click();
  }

  async function importBackup(file: File) {
    setBackupMessage(null);
    let data: BackupData;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setBackupMessage("That file isn't valid JSON.");
      return;
    }

    const shotCount = Array.isArray(data.cinematicShots) ? data.cinematicShots.length : 0;
    const confirmed = window.confirm(
      `Import this backup? This replaces ALL current camera shots (with ${shotCount} from the file) and every setting on this page, Smart Auto Observer, and HLAE.`
    );
    if (!confirmed) return;

    try {
      const result = await api.post<BackupData>("/backup/import", data);
      setBackupMessage(`Imported ${result.cinematicShots.length} camera shot(s) and all settings. Reload the other pages to see them.`);
      reloadCfg();
    } catch (err) {
      setBackupMessage((err as Error).message);
    }
  }

  return (
    <>
      <Card
        title="GSI setup"
        description="CS2 needs a .cfg file in its csgo/cfg folder telling it where to send live match state."
      >
        <p>
          Game connection: <StatusBadge ok={Boolean(status?.connected)} okLabel="Receiving GSI data" badLabel="No data yet" />
        </p>

        <Row label="CS2 cfg folder" hint="…\Counter-Strike Global Offensive\game\csgo\cfg — needed to auto-install the GSI/HLAE/cinematic configs">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={cfgDirText}
              onChange={(e) => setCfgDirText(e.target.value)}
              onBlur={() => { if (cfgDirText !== settings?.cs2CfgDir) void saveCfgDir(cfgDirText.trim()); }}
              placeholder="e.g. C:\...\Counter-Strike Global Offensive\game\csgo\cfg"
              style={{ flex: 1, minWidth: 280 }}
            />
            <button className="secondary" onClick={browseCfgDir} disabled={!desktopBridge}>
              Browse…
            </button>
          </div>
        </Row>
        {!desktopBridge && (
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            Native folder picker isn't available outside the desktop app — paste the path above instead.
          </p>
        )}

        {cfg && (
          <>
            <p>
              Auto-install: <StatusBadge ok={cfg.autoInstallConfigured} okLabel="Configured" badLabel="Set the CS2 cfg folder above" />
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

      <Card
        title="Backup"
        description="Export every captured camera shot and setting (Smart Observer, HLAE, cinematic triggers) to a file, or restore one — handy before reinstalling or when moving to a different machine."
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportBackup}>Export backup</button>
          <button className="secondary" onClick={chooseImportFile}>Import backup</button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-selecting the same file later
              if (file) void importBackup(file);
            }}
          />
        </div>
        {backupMessage && <p style={{ color: "var(--muted)" }}>{backupMessage}</p>}
      </Card>
    </>
  );
}
