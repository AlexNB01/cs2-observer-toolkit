import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { app, BrowserWindow, Menu, Tray, shell, dialog, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Without this, Electron derives the app name (and so the userData folder)
// from package.json's "name" — "@cs2hud/desktop" — which it splits on "/"
// into a nested "@cs2hud\desktop" folder. Must be set before any
// app.getPath() call.
app.setName("CS2 Observer Toolkit");

// @cs2hud/server's own `import "dotenv/config"` looks for .env in
// process.cwd() — which, launched from Explorer or a shortcut, is *not*
// packages/server (dev) or anything predictable (packaged), so
// CS2_CFG_DIR/HLAE_EXE_PATH silently came back unset. Load the right file
// explicitly, before the dynamic import below, so these values are already
// in process.env by the time env.ts reads them (dotenv never overwrites a
// key that's already set).
const devEnvPath = path.join(__dirname, "..", "..", "server", ".env");
const packagedEnvPath = path.join(app.getPath("userData"), ".env");
const envPath = app.isPackaged ? packagedEnvPath : devEnvPath;

// CS2_CFG_DIR/HLAE_EXE_PATH below are now just a one-time seed for a brand
// new install — the GSI Setup and HLAE pages in the app itself are the
// normal way to set (and change) these, with a native folder/file picker,
// no restart needed. Editing this file still works too, but only until
// the first time either path is set from within the app, at which point
// the value saved there always wins.
const ENV_TEMPLATE = `# CS2 Observer Toolkit configuration.
# You can set these here, but it's easier to use the GSI Setup and HLAE
# pages inside the app itself — this file is only read once, on first
# launch.

# CS2 install's game/csgo/cfg folder, e.g.:
# C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg
CS2_CFG_DIR=

# HLAE.exe, from https://www.hlae.online/ (not installed by this app):
HLAE_EXE_PATH=
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
process.env.PORT = process.env.PORT ?? "3001";

const windowIconPath = path.join(__dirname, "..", "build", "icon.png");
const trayIconPath = path.join(__dirname, "..", "build", "tray-icon.png");
const preloadPath = path.join(__dirname, "preload.js");

// Backs the admin panel's "Browse..." buttons for the CS2 cfg folder and
// HLAE.exe path (see preload.ts) — a real native picker instead of asking
// the user to type/paste an absolute path.
ipcMain.handle("pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle("pick-file", async (_event, extensions: string[]) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Executable", extensions }],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

async function startServer(): Promise<number> {
  const { buildApp } = await import("@cs2hud/server");
  const fastifyApp = await buildApp();
  const port = Number(process.env.PORT);
  await fastifyApp.listen({ port, host: "127.0.0.1" });
  return port;
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "CS2 Observer Toolkit",
    icon: windowIconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${port}/admin/setup`);

  // Electron denies window.open()/target="_blank" by default — without
  // this, "open in browser" links in the admin panel silently do nothing.
  // Route them to the system's real browser instead of spawning another
  // sandboxed Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // The GSI listener needs to stay up even with the admin window closed, so
  // closing it just hides it — the tray is the real "quit" control.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  tray = new Tray(trayIconPath);
  tray.setToolTip("CS2 Observer Toolkit");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open admin panel", click: () => mainWindow?.show() },
      { type: "separator" },
      ...(app.isPackaged
        ? [
            {
              label: "Edit config (CS2 path, HLAE)...",
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
      "CS2 Observer Toolkit",
      isPortConflict
        ? `Port ${process.env.PORT} is already in use — CS2 Observer Toolkit may already be running (check the system tray) or another app is using that port.`
        : `Failed to start: ${(err as Error).message}`
    );
    app.quit();
    return;
  }

  createWindow(port);
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

// Keep running in the tray when the window closes — see the close handler
// above. Electron's default of quitting on all-windows-closed would kill
// the GSI listener that CS2 is still POSTing to.
app.on("window-all-closed", () => {});
