import { RADAR_CALIBRATION } from "@cs2hud/shared";
import { Card, Row, Toggle } from "../../../components/ui.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";

const CALIBRATED_MAPS = Object.keys(RADAR_CALIBRATION).sort();

export function Minimap() {
  const { settings, update } = useHudSettings();
  if (!settings) return <p>Loading…</p>;

  return (
    <Card
      title="MiniMap"
      description="Spec section 9 — coordinate calibration is wired up for 9 competitive maps; radar background images are not bundled (Valve IP) — see public/radar/README.md to add your own."
    >
      <Row label="Enable minimap">
        <Toggle checked={settings.minimapEnabled} onChange={(v) => update({ minimapEnabled: v })} />
      </Row>
      <Row label="AutoZoom" hint="Automatic zoom based on player positions">
        <Toggle checked={settings.minimapAutoZoom} onChange={(v) => update({ minimapAutoZoom: v })} />
      </Row>
      <Row label="Size (px)">
        <input type="number" value={settings.minimapSizePx} onChange={(e) => update({ minimapSizePx: Number(e.target.value) })} style={{ width: 80 }} />
      </Row>
      <Row label="Show background">
        <Toggle checked={settings.minimapBackgroundEnabled} onChange={(v) => update({ minimapBackgroundEnabled: v })} />
      </Row>
      <div style={{ marginTop: 12 }}>
        <a href="/minimap" target="_blank" rel="noreferrer">
          <button className="secondary">Open minimap in browser</button>
        </a>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
        Calibrated maps: {CALIBRATED_MAPS.join(", ")}. On other maps the minimap still opens (grid background) but player dots won't render until that map's pos_x/pos_y/scale are added to RADAR_CALIBRATION.
      </p>
    </Card>
  );
}
