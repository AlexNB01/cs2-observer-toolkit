import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export const env = {
  httpPort: Number(process.env.PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  dbPath: process.env.DB_PATH ?? path.join(repoRoot, "data", "cs2hud.sqlite"),
  /**
   * Built admin/HUD/minimap/veto SPA (packages/web's `vite build` output).
   * When present, the server serves it directly so the whole app runs off
   * one port — used by the packaged Electron app. WEB_DIST_DIR lets the
   * desktop package point this at its own bundled resources, since the
   * repo-relative default only makes sense for the unbundled monorepo.
   */
  webDistDir: process.env.WEB_DIST_DIR ?? path.join(repoRoot, "packages", "web", "dist"),
  /**
   * Built output of the vendored lexogrine/cs2-react-hud (MIT) — see
   * /lhm-hud at the repo root; absent until `npm run build` is run there.
   * Served on its own port (lhmHudPort) rather than a path prefix on the
   * main server — that app hardcodes its production API base to "/" (see
   * packages/server/src/lhm/rest.ts's doc comment), so it can't live under
   * a sub-path.
   */
  lhmHudDistDir: process.env.LHM_HUD_DIST_DIR ?? path.join(repoRoot, "lhm-hud", "build"),
  lhmHudPort: Number(process.env.LHM_HUD_PORT ?? 3002),
  /** CS2's csgo/cfg folder, e.g. "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg" */
  cs2CfgDir: process.env.CS2_CFG_DIR ?? "",
  gsiListenPath: "/gsi",
  /** Path to HLAE.exe, e.g. "C:\\HLAE\\HLAE.exe" — hlae.online, not bundled/downloaded here. */
  hlaeExePath: process.env.HLAE_EXE_PATH ?? "",
  /** Faceit Data API key (Bearer token), from https://developers.faceit.com/apps — needed for veto import. */
  faceitApiKey: process.env.FACEIT_API_KEY ?? "",
};
