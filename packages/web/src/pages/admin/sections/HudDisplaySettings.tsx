import { Card, Row } from "../../../components/ui.js";
import { KeybindInput } from "../../../components/KeybindInput.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { useHudSocket } from "../../../lib/ws-client.js";

const LHM_HUD_URL = "http://localhost:3002/?isProd=1";

export function HudDisplaySettings() {
  const { settings, update } = useHudSettings();
  const { send } = useHudSocket();
  if (!settings) return <p>Loading…</p>;

  return (
    <Card title="HUD" description="The HUD is lexogrine/cs2-react-hud (MIT), served on its own port — its visuals aren't configured from this admin panel.">
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: -4 }}>
        Add it to OBS as a browser source, or use the keybind below to show/hide it as a desktop overlay. Source:{" "}
        <a href="https://github.com/lexogrine/cs2-react-hud" target="_blank" rel="noreferrer">
          github.com/lexogrine/cs2-react-hud
        </a>
        .
      </p>

      <Row label="Monitor" hint="Which display to open the HUD overlay window on — browsers can't enumerate monitors, so this needs the native companion process from spec section 15">
        <input type="text" value={settings.monitor ?? ""} placeholder="Not implemented yet" disabled />
      </Row>

      <Row label="Toggle HUD keybind" hint="Global hotkey — shows/hides the HUD overlay window. Only works in the desktop app, not a plain browser tab">
        <KeybindInput value={settings.toggleHudKeybind} onChange={(v) => update({ toggleHudKeybind: v })} />
      </Row>

      <Row label="Scoreboard keybind" hint="An alias for the keybind above — both toggle the same HUD">
        <KeybindInput value={settings.scoreboardKeybind} onChange={(v) => update({ scoreboardKeybind: v })} />
      </Row>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={() => send({ kind: "open_hud_overlay" })}>Show HUD overlay</button>
        <a href={LHM_HUD_URL} target="_blank" rel="noreferrer">
          <button className="secondary">Open HUD in browser</button>
        </a>
        <button className="secondary" onClick={() => navigator.clipboard.writeText(LHM_HUD_URL)}>
          Copy HUD source URL
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
        "Show HUD overlay" opens the same desktop overlay window as the keybind above — only works in the desktop app.
      </p>
    </Card>
  );
}
