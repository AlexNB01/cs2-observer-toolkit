/**
 * Exposed by packages/desktop/src/preload.ts — only present when this page
 * is running inside the Electron admin window. Absent in plain-browser
 * dev mode (`npm run dev`) or if someone opens the admin panel in a
 * regular browser tab, so every caller must treat it as optional and fall
 * back to a plain text input.
 */
export interface DesktopBridge {
  pickFolder(): Promise<string | null>;
  pickFile(extensions: string[], filterName?: string, defaultPath?: string): Promise<string | null>;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export const desktopBridge: DesktopBridge | undefined = typeof window !== "undefined" ? window.desktopBridge : undefined;
