import { useEffect, useState } from "react";
import type { HudSettings } from "@cs2hud/shared";
import { api } from "../lib/api-client.js";
import { useHudSocket } from "../lib/ws-client.js";

interface MinimapPlayer {
  steamId: string;
  team: "CT" | "T";
  alive: boolean;
  xPct: number | null;
  yPct: number | null;
  slot: number;
}

interface MinimapBomb {
  state: string;
  xPct: number;
  yPct: number;
}

interface MinimapState {
  mapName: string | null;
  calibrated: boolean;
  players: MinimapPlayer[];
  bomb: MinimapBomb | null;
  observedSteamId: string | null;
}

const MAX_ZOOM = 3;
const ZOOM_PADDING = 0.15;
const MIN_BOX_EXTENT = 0.25;

/**
 * Self-contained radar — fetches its own settings/state so it can be
 * dropped into the standalone /minimap OBS source and directly into the
 * full HUD overlay without either caller having to thread minimap state
 * through.
 */
export function Minimap() {
  const [settings, setSettings] = useState<HudSettings | null>(null);
  const [state, setState] = useState<MinimapState | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    api.get<HudSettings>("/hud-settings").then(setSettings).catch(console.error);
    const poll = setInterval(() => {
      api.get<MinimapState>("/minimap/state").then(setState).catch(console.error);
    }, 500);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => setImageFailed(false), [state?.mapName]);

  useHudSocket((message) => {
    if (message.kind === "settings_updated") setSettings(message.settings);
  });

  const size = settings?.minimapSizePx ?? 300;

  if (!settings?.minimapEnabled) return null;

  const radarImageUrl = state?.mapName ? `/radar/${state.mapName}.png` : null;
  const showImage = radarImageUrl && !imageFailed;

  // Section 9 "AutoZoom": scale/pan around the bounding box of alive
  // players so the action fills the frame instead of the whole radar.
  let zoom = 1;
  let dx = 0;
  let dy = 0;
  if (settings.minimapAutoZoom && state) {
    const alive = state.players.filter((p) => p.alive && p.xPct !== null && p.yPct !== null);
    if (alive.length > 0) {
      const xs = alive.map((p) => p.xPct as number);
      const ys = alive.map((p) => p.yPct as number);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const boxW = Math.max(maxX - minX + ZOOM_PADDING * 2, MIN_BOX_EXTENT);
      const boxH = Math.max(maxY - minY + ZOOM_PADDING * 2, MIN_BOX_EXTENT);
      zoom = Math.max(1, Math.min(1 / boxW, 1 / boxH, MAX_ZOOM));
      dx = (0.5 - (minX + maxX) / 2) * size;
      dy = (0.5 - (minY + maxY) / 2) * size;
    }
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        background: settings.minimapBackgroundEnabled && !showImage ? "rgba(0,0,0,0.55)" : "transparent",
        borderRadius: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${zoom}) translate(${dx}px, ${dy}px)`,
          transformOrigin: "50% 50%",
          transition: "transform 300ms ease-out",
        }}
      >
        {showImage && (
          <img
            src={radarImageUrl}
            onError={() => setImageFailed(true)}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {!showImage && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "10% 10%",
            }}
          />
        )}

        {state?.players.map((p) => {
          if (p.xPct === null || p.yPct === null) return null;
          const isObserved = p.steamId === state.observedSteamId;
          const dotSize = isObserved ? 12 : 8;
          return (
            <div
              key={p.steamId}
              style={{
                position: "absolute",
                left: `${p.xPct * 100}%`,
                top: `${p.yPct * 100}%`,
                width: dotSize,
                height: dotSize,
                marginLeft: -dotSize / 2,
                marginTop: -dotSize / 2,
                borderRadius: "50%",
                border: isObserved ? "2px solid #fff" : "1px solid rgba(0,0,0,0.5)",
                boxShadow: isObserved ? "0 0 6px #fff" : undefined,
                background: p.team === "CT" ? "var(--hud-ct, var(--ct))" : "var(--hud-t, var(--t))",
                opacity: p.alive ? 1 : 0.3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 7,
                fontWeight: 700,
                lineHeight: 1,
                color: "#fff",
              }}
            >
              {p.alive ? p.slot : ""}
            </div>
          );
        })}

        {state?.bomb && (state.bomb.state === "planted" || state.bomb.state === "dropped") && (
          <img
            src="/icons/icon_bomb_default.svg"
            alt=""
            title={state.bomb.state === "planted" ? "Bomb planted" : "Bomb dropped"}
            style={{
              position: "absolute",
              left: `${state.bomb.xPct * 100}%`,
              top: `${state.bomb.yPct * 100}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              filter: state.bomb.state === "planted" ? "drop-shadow(0 0 3px #ff4d4d)" : "drop-shadow(0 0 3px #ffcc00)",
            }}
          />
        )}
      </div>

      {!state?.mapName && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, opacity: 0.6 }}>
          Waiting for GSI…
        </div>
      )}
      {state?.mapName && !state.calibrated && (
        <div style={{ position: "absolute", bottom: 4, left: 6, fontSize: 10, opacity: 0.6 }}>No calibration for {state.mapName}</div>
      )}
      {state?.mapName && state.calibrated && !showImage && (
        <div style={{ position: "absolute", bottom: 4, left: 6, fontSize: 10, opacity: 0.6 }}>
          {state.mapName} — add /radar/{state.mapName}.png for a real background
        </div>
      )}
    </div>
  );
}
