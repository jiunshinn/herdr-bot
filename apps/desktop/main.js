// Desktop drawer: a transparent, always-on-top window docked to the vertical centre of the right
// screen edge. Collapsed, only a small notch shows and clicks pass through; when the mouse rests on
// the notch the page slides the panel open, and it closes again once the mouse leaves.

import { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, serverConfig } from "./config.js";
import { openControlCenter } from "./control-center.js";
import { startLocalServer } from "./local-server.js";
import { needsOnboarding, openOnboarding } from "./onboarding.js";

const here = dirname(fileURLToPath(import.meta.url));

// Keep in sync with renderer/style.css (:root --notch-* / --panel-*).
const NOTCH = { width: 26, height: 84 };
const PANEL = { width: 360, height: 520 };
// Transparent room around the panel for the open animation's overshoot and the shadow.
const MARGIN = 40;

const OPEN_DELAY = 80; // ms the mouse has to rest on the notch, so sweeping past doesn't open it
const CLOSE_DELAY = 300;
const TICK_MS = 1000 / 30;
const TOGGLE_SHORTCUT = "CommandOrControl+Alt+H";

let win;
let isOpen = false;
let pinned = false; // opened with the shortcut: stays until the shortcut or Esc closes it
let holding = false;
let enteredAt = null;
let leftAt = null;
let peekUntil = 0;

/** The rightmost display, so the notch sits where the cursor stops at the edge of the desktop. */
function edgeDisplay() {
  return screen.getAllDisplays().reduce((a, b) => (b.bounds.x + b.bounds.width > a.bounds.x + a.bounds.width ? b : a));
}

function place() {
  const { bounds } = edgeDisplay();
  const width = PANEL.width + MARGIN;
  const height = PANEL.height + MARGIN * 2;
  win.setBounds({
    x: bounds.x + bounds.width - width,
    y: Math.round(bounds.y + bounds.height / 2 - height / 2),
    width,
    height,
  });
}

function setOpen(open) {
  if (open === isOpen) return;
  isOpen = open;
  if (!open) pinned = false;
  win.setIgnoreMouseEvents(!open, { forward: true });
  win.webContents.send("drawer:set-open", open);
  if (!open && win.isFocused()) win.blur();
}

function tick() {
  const { bounds } = edgeDisplay();
  const p = screen.getCursorScreenPoint();
  const size = isOpen ? PANEL : NOTCH;
  const slack = isOpen ? 16 : 0;
  const right = bounds.x + bounds.width;
  const midY = bounds.y + bounds.height / 2;
  const inside = p.x >= right - size.width - slack && p.x <= right && Math.abs(p.y - midY) <= size.height / 2 + slack;

  const now = Date.now();
  if (inside) {
    leftAt = null;
    enteredAt ??= now;
  } else {
    enteredAt = null;
    leftAt ??= now;
  }

  if (!isOpen) {
    if (enteredAt !== null && now - enteredAt >= OPEN_DELAY) setOpen(true);
  } else if (!pinned && !holding && leftAt !== null && now - leftAt >= CLOSE_DELAY && now >= peekUntil) {
    setOpen(false);
  }
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    // macOS: a non-activating panel, so opening the drawer doesn't steal focus from the editor.
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true }); // collapsed: let clicks through
  place();
  win.loadFile(join(here, "renderer", "index.html"));
  win.once("ready-to-show", () => win.showInactive());

  screen.on("display-metrics-changed", place);
  screen.on("display-added", place);
  screen.on("display-removed", place);
  setInterval(tick, TICK_MS);
}

ipcMain.handle("drawer:config", () => ({ ...serverConfig(), platform: process.platform }));
ipcMain.on("drawer:peek", (_e, ms) => {
  peekUntil = Date.now() + (Number(ms) || 5000);
  setOpen(true);
});
ipcMain.on("drawer:hold", (_e, on) => {
  holding = Boolean(on);
});
ipcMain.on("drawer:notify", (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});
ipcMain.on("drawer:close", () => setOpen(false));
ipcMain.on("drawer:open-app", (_e, agentId) => {
  setOpen(false);
  try {
    openControlCenter(typeof agentId === "string" ? agentId : undefined);
  } catch (err) {
    if (Notification.isSupported()) new Notification({ title: "HerdrBot", body: err.message }).show();
  }
});
ipcMain.on("app:open-setup", () => openOnboarding(() => {}));
ipcMain.on("drawer:quit", () => app.quit());

if (!app.requestSingleInstanceLock()) app.quit();

async function startDrawer() {
  app.dock?.hide(); // no Dock icon
  if (readConfig().desktop?.mode !== "remote" && !process.env.HERDR_BOT_URL) {
    await startLocalServer().catch((err) => {
      if (Notification.isSupported()) new Notification({ title: "HerdrBot server", body: err.message }).show();
    });
  }
  createWindow();
  globalShortcut.register(TOGGLE_SHORTCUT, () => {
    if (isOpen) return setOpen(false);
    setOpen(true);
    pinned = true;
    win.focus();
  });
}

app.whenReady().then(() => {
  // `--setup` reopens onboarding, e.g. to switch between this computer and another one.
  if (needsOnboarding() || process.argv.includes("--setup")) {
    openOnboarding(({ cancelled }) => (cancelled ? app.quit() : startDrawer()));
  } else {
    startDrawer();
  }
});

// The drawer is the only window after onboarding; keep running when onboarding closes into it.
app.on("window-all-closed", () => {});

app.on("will-quit", () => globalShortcut.unregisterAll());
