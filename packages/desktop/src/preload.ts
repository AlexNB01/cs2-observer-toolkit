import { contextBridge, ipcRenderer } from "electron";

/**
 * The admin panel is a sandboxed, contextIsolated renderer with no direct
 * Node/Electron access — this is the only bridge it has into the main
 * process, and it's deliberately tiny: two native file/folder pickers, so
 * "set the CS2 cfg folder" / "set HLAE.exe" can be a real OS dialog instead
 * of asking the user to type an absolute path by hand. See main.ts's
 * matching ipcMain.handle("pick-folder"/"pick-file", ...).
 */
contextBridge.exposeInMainWorld("desktopBridge", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("pick-folder"),
  pickFile: (extensions: string[], filterName?: string, defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke("pick-file", extensions, filterName ?? "Executable", defaultPath),
});
