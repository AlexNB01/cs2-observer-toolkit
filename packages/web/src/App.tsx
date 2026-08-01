import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./pages/admin/AdminLayout.js";
import { Setup } from "./pages/admin/sections/Setup.js";
import { HudDisplaySettings } from "./pages/admin/sections/HudDisplaySettings.js";
import { SmartObserver } from "./pages/admin/sections/SmartObserver.js";
import { PlayerStats } from "./pages/admin/sections/PlayerStats.js";
import { ObsReplay } from "./pages/admin/sections/ObsReplay.js";
import { Minimap } from "./pages/admin/sections/Minimap.js";
import { PlayerManagement } from "./pages/admin/sections/PlayerManagement.js";
import { TeamManagement } from "./pages/admin/sections/TeamManagement.js";
import { Hlae } from "./pages/admin/sections/Hlae.js";
import { Veto } from "./pages/admin/sections/Veto.js";
import { MinimapView } from "./pages/minimap/MinimapView.js";
import { VetoStandalone } from "./pages/veto/VetoStandalone.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/setup" replace />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route path="setup" element={<Setup />} />
        <Route path="hud-display" element={<HudDisplaySettings />} />
        <Route path="observer" element={<SmartObserver />} />
        <Route path="stats" element={<PlayerStats />} />
        <Route path="obs" element={<ObsReplay />} />
        <Route path="minimap" element={<Minimap />} />
        <Route path="players" element={<PlayerManagement />} />
        <Route path="teams" element={<TeamManagement />} />
        <Route path="hlae" element={<Hlae />} />
        <Route path="veto" element={<Veto />} />
      </Route>

      {/* OBS browser sources — standalone, transparent, no admin chrome.
          The main HUD itself is the vendored lexogrine/cs2-react-hud,
          served on its own port (see @cs2hud/server's lhm/app.ts) — not a
          route here. */}
      <Route path="/minimap" element={<MinimapView />} />
      <Route path="/veto" element={<VetoStandalone />} />
    </Routes>
  );
}
