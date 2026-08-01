import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { app, BrowserWindow, Menu, Tray, clipboard, shell, globalShortcut, dialog, screen } from "electron";
import type { HudSettings, ServerToClientMessage } from "@cs2hud/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Without this, Electron derives the app name (and so the userData folder)
// from package.json's "name" — "@cs2hud/desktop" — which it splits on "/"
// into a nested "@cs2hud\desktop" folder. Must be set before any
// app.getPath() call.
app.setName("CS2 HUD Tool");

// @cs2hud/server's own `import "dotenv/config"` looks for .env in
// process.cwd() — which, launched from Explorer or a shortcut, is *not*
// packages/server (dev) or anything predictable (packaged), so
// CS2_CFG_DIR/HLAE_EXE_PATH/FACEIT_API_KEY silently came back unset. Load
// the right file explicitly, before the dynamic import below, so these
// values are already in process.env by the time env.ts reads them (dotenv
// never overwrites a key that's already set).
const devEnvPath = path.join(__dirname, "..", "..", "server", ".env");
const packagedEnvPath = path.join(app.getPath("userData"), ".env");
const envPath = app.isPackaged ? packagedEnvPath : devEnvPath;

const ENV_TEMPLATE = `# CS2 HUD Tool configuration.
# Point these at real paths, save, then restart the app from the tray icon.

# CS2 install's game/csgo/cfg folder, e.g.:
# C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg
CS2_CFG_DIR=

# HLAE.exe, from https://www.hlae.online/ (not installed by this app):
HLAE_EXE_PATH=

# Faceit Data API key, from https://developers.faceit.com/apps:
FACEIT_API_KEY=
`;

function ensureConfigFile(): void {
  if (app.isPackaged && !fs.existsSync(packagedEnvPath)) {
    fs.mkdirSync(path.dirname(packagedEnvPath), { recursive: true });
    fs.writeFileSync(packagedEnvPath, ENV_TEMPLATE, "utf-8");
  }
}
ensureConfigFile();

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Set these *before* anything imports @cs2hud/server, since its env module
// reads process.env once at import time. Using a dynamic import() below
// (rather than a static import) guarantees that ordering.
process.env.DB_PATH = path.join(app.getPath("userData"), "cs2hud.sqlite");
process.env.WEB_DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "web-dist")
  : path.join(__dirname, "..", "..", "web", "dist");
process.env.LHM_HUD_DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "lhm-hud-dist")
  : path.join(__dirname, "..", "..", "..", "lhm-hud", "build");
process.env.PORT = process.env.PORT ?? "3001";

const windowIconPath = path.join(__dirname, "..", "build", "icon.png");
const trayIconPath = path.join(__dirname, "..", "build", "tray-icon.png");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let broadcastFn: ((message: ServerToClientMessage) => void) | null = null;

/**
 * The HUD/veto keybinds originally only broadcast a WS visibility toggle,
 * which only does something if /hud or /veto is already open somewhere
 * (e.g. an OBS browser source). With nothing open, pressing the keybind
 * visibly did nothing. These overlay windows give the keybind something to
 * show/hide even before OBS is set up — frameless, transparent, always on
 * top of CS2, and click-through so they don't steal game input.
 */
let hudOverlayWindow: BrowserWindow | null = null;
let vetoOverlayWindow: BrowserWindow | null = null;

function createOverlayWindow(url: string, title: string, assign: (w: BrowserWindow | null) => void): void {
  // Full-screen so the HUD's corner-anchored layout (minimap top-left,
  // team panels bottom-left/right, observed-player card bottom-center) has
  // room to render over the whole game window, not just a thin top strip.
  const bounds = screen.getPrimaryDisplay().bounds;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    // Shown in the taskbar (unlike a typical overlay) so it can be brought
    // to front or closed from there — the window itself has no frame/title
    // bar/close button, and is click-through, so the taskbar is the only
    // way to interact with it directly.
    skipTaskbar: false,
    show: false,
    title,
    icon: windowIconPath,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.setIgnoreMouseEvents(true, { forward: true });
  // Without this, the loaded page's own <title> (e.g. "LHM CS2 Default
  // HUD") overwrites the taskbar label once it loads, making this window
  // hard to tell apart from the admin window there.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => assign(null));
  win.loadURL(url);
  assign(win);
}

function toggleOverlayWindow(current: BrowserWindow | null, url: string, title: string, assign: (w: BrowserWindow | null) => void): void {
  if (current && !current.isDestroyed()) {
    if (current.isVisible()) {
      current.hide();
    } else {
      current.showInactive();
    }
    return;
  }
  createOverlayWindow(url, title, assign);
}

// For the admin panel's "Open HUD" button — unlike the keybind, a button
// click means "show it", not "toggle it" (clicking it again while it's
// already open shouldn't hide it out from under you).
function showOverlayWindow(current: BrowserWindow | null, url: string, title: string, assign: (w: BrowserWindow | null) => void): void {
  if (current && !current.isDestroyed()) {
    current.showInactive();
    return;
  }
  createOverlayWindow(url, title, assign);
}

function lhmHudUrl(): string {
  return `http://localhost:${Number(process.env.LHM_HUD_PORT ?? 3002)}/?isProd=1`;
}

async function startServer(): Promise<number> {
  const { buildApp, buildLhmApp, broadcast } = await import("@cs2hud/server");
  broadcastFn = broadcast;
  const fastifyApp = await buildApp();
  const port = Number(process.env.PORT);
  await fastifyApp.listen({ port, host: "127.0.0.1" });

  // Vendored lexogrine/cs2-react-hud (MIT) — absent until `npm run build`
  // has been run in /lhm-hud, same gate as the main SPA's dist check.
  const lhmApp = await buildLhmApp();
  if (lhmApp) {
    const lhmPort = Number(process.env.LHM_HUD_PORT ?? 3002);
    try {
      await lhmApp.listen({ port: lhmPort, host: "127.0.0.1" });
    } catch (err) {
      lhmApp.log.error(err);
    }
  }

  return port;
}

let registeredAccelerators: string[] = [];

function safeRegister(accelerator: string, callback: () => void): void {
  if (!accelerator?.trim()) return;
  try {
    if (globalShortcut.register(accelerator, callback)) {
      registeredAccelerators.push(accelerator);
    }
  } catch {
    // Malformed accelerator string (e.g. an unrecognized key name) —
    // ignored rather than crashing the app over a bad settings value.
  }
}

/**
 * Section 2/13's HUD/scoreboard/veto keybinds need a global OS-level hotkey
 * listener — impossible from a browser tab, which is why these were inert
 * text fields before the Electron shell existed. There's no separate
 * "detailed scoreboard" overlay built, so the HUD and scoreboard keybinds
 * both just show/hide the one HUD view. This is a toggle, not true
 * hold-to-show — Electron's globalShortcut only fires on the full press,
 * with no key-up event to hide on release.
 */
function applyKeybinds(settings: Pick<HudSettings, "toggleHudKeybind" | "scoreboardKeybind" | "vetoKeybind">, port: number): void {
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator);
  }
  registeredAccelerators = [];

  const toggleHud = () => {
    toggleOverlayWindow(hudOverlayWindow, lhmHudUrl(), "CS2 HUD Overlay", (w) => (hudOverlayWindow = w));
  };
  const toggleVeto = () => {
    broadcastFn?.({ kind: "veto_visibility_toggle" });
    toggleOverlayWindow(vetoOverlayWindow, `http://localhost:${port}/veto`, "CS2 Veto Overlay", (w) => (vetoOverlayWindow = w));
  };

  safeRegister(settings.toggleHudKeybind, toggleHud);
  if (settings.scoreboardKeybind && settings.scoreboardKeybind !== settings.toggleHudKeybind) {
    safeRegister(settings.scoreboardKeybind, toggleHud);
  }
  safeRegister(settings.vetoKeybind, toggleVeto);
}

async function setupKeybinds(port: number): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hud-settings`);
    applyKeybinds((await res.json()) as HudSettings, port);
  } catch {
    // Shortcuts just stay unregistered until the next settings_updated push.
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.addEventListener("error", () => {});
  ws.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as ServerToClientMessage;
      if (message.kind === "settings_updated") applyKeybinds(message.settings, port);
      // Admin panel's "Open HUD" button — see showOverlayWindow's doc comment
      // for why this shows rather than toggles.
      if (message.kind === "hud_overlay_requested") {
        showOverlayWindow(hudOverlayWindow, lhmHudUrl(), "CS2 HUD Overlay", (w) => (hudOverlayWindow = w));
      }
    } catch {
      // ignore malformed frames
    }
  });
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "CS2 HUD Tool",
    icon: windowIconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${port}/admin/setup`);

  // Electron denies window.open()/target="_blank" by default — without
  // this, the "open in browser" links (minimap, veto, etc.) in the admin
  // panel silently do nothing. Route them to the system's real browser
  // instead of spawning another sandboxed Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // OBS's HUD/minimap/veto browser sources depend on the server staying
  // up, so closing the admin window just hides it — the tray is the real
  // "quit" control.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(port: number): void {
  tray = new Tray(trayIconPath);
  tray.setToolTip("CS2 HUD Tool");
  const lhmPort = Number(process.env.LHM_HUD_PORT ?? 3002);
  const lhmUrl = `http://localhost:${lhmPort}/?isProd=1`;
  const copyUrl = (urlPath: string) => clipboard.writeText(`http://localhost:${port}${urlPath}`);
  const openUrl = (urlPath: string) => shell.openExternal(`http://localhost:${port}${urlPath}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open admin panel", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Open HUD in browser (lexogrine/cs2-react-hud)", click: () => shell.openExternal(lhmUrl) },
      { label: "Open MiniMap in browser", click: () => openUrl("/minimap") },
      { label: "Open Veto in browser", click: () => openUrl("/veto") },
      { type: "separator" },
      { label: "Copy HUD source URL", click: () => clipboard.writeText(lhmUrl) },
      { label: "Copy MiniMap source URL", click: () => copyUrl("/minimap") },
      { label: "Copy Veto source URL", click: () => copyUrl("/veto") },
      { type: "separator" },
      ...(app.isPackaged
        ? [
            {
              label: "Edit config (CS2 path, HLAE, Faceit key)...",
              click: () => shell.showItemInFolder(packagedEnvPath),
            },
          ]
        : []),
      {
        label: "Restart",
        click: () => {
          app.relaunch();
          quitting = true;
          app.quit();
        },
      },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => mainWindow?.show());
}

app.whenReady().then(async () => {
  let port: number;
  try {
    port = await startServer();
  } catch (err) {
    const isPortConflict = (err as NodeJS.ErrnoException)?.code === "EADDRINUSE";
    dialog.showErrorBox(
      "CS2 HUD Tool",
      isPortConflict
        ? `Port ${process.env.PORT} is already in use — CS2 HUD Tool may already be running (check the system tray) or another app is using that port.`
        : `Failed to start: ${(err as Error).message}`
    );
    app.quit();
    return;
  }

  createWindow(port);
  createTray(port);
  await setupKeybinds(port);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Keep running in the tray when the window closes — see the close handler
// above. Electron's default of quitting on all-windows-closed would kill
// the GSI listener/HUD server that OBS is still reading from.
app.on("window-all-closed", () => {});
