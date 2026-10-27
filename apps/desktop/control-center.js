// The full app window: agent sidebar and chat. The drawer is the quick preview; this is where you
// read and answer agents properly. Built from app/ by Vite into dist/app.

import { app, BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "dist", "app", "index.html");

let win = null;

export function openControlCenter(agentId) {
  if (win) {
    if (agentId) win.webContents.send("app:select", agentId);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  if (!existsSync(entry)) {
    throw new Error("The control center is not built. Run `bun run --cwd apps/desktop build`.");
  }

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 820,
    minHeight: 520,
    title: "HerdrBot",
    backgroundColor: "#0f0f11",
    show: false,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 } } : {}),
    webPreferences: {
      preload: join(here, "app-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // Links in agent messages open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(entry, agentId ? { query: { agent: agentId } } : undefined);
  win.once("ready-to-show", () => win.show());

  // A Dock icon only while the window is open, so Cmd+Tab finds it.
  app.dock?.show();
  win.on("closed", () => {
    win = null;
    app.dock?.hide();
  });
}
