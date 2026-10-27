// Desktop drawer: a transparent, always-on-top window docked to the middle of one screen edge (see
// placement.js). Collapsed, only a small notch shows and clicks pass through; when the mouse rests on
// the notch the page slides the panel open, and it closes again once the mouse leaves.
// After setup the app opens on the control center; closing it leaves the drawer running.

import { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, serverConfig } from "./config.js";
import { openControlCenter, sendToControlCenter } from "./control-center.js";
import { startLocalServer } from "./local-server.js";
import { needsOnboarding, openOnboarding } from "./onboarding.js";
import { layout, loadCameraNotches, placementInfo, savePlacement } from "./placement.js";

const here = dirname(fileURLToPath(import.meta.url));

const OPEN_DELAY = 80; // ms the mouse has to rest on the notch, so sweeping past doesn't open it
const CLOSE_DELAY = 300;
const TICK_MS = 1000 / 30;
const TOGGLE_SHORTCUT = "CommandOrControl+Alt+H";
const SHOW_PLACE_MS = 1800; // after a move, the drawer slides out this long to show where it went

let win;
let isOpen = false;
let pinned = false; // opened with the shortcut: stays until the shortcut or Esc closes it
let holding = false;
let enteredAt = null;
let leftAt = null;
let peekUntil = 0;
let current; // layout(): where the window, the notch and the panel are
let showPlaceTimer = null;

function place() {
  current = layout();
  win.setBounds(current.bounds);
  win.webContents.send("drawer:layout", current);
  sendToControlCenter("placement:changed", placementInfo());
}

/** `p` is inside `r` grown by `slack` on each side except the screen edge. */
function within(r, p, slack, edge) {
  const grow = (side) => (side === edge ? 0 : slack);
  return (
    p.x >= r.x - grow("left") &&
    p.x <= r.x + r.width + grow("right") &&
    p.y >= r.y - grow("top") &&
    p.y <= r.y + r.height + grow("bottom")
  );
}

function setOpen(open) {
  if (open === isOpen) return;
  isOpen = open;
  if (!open) pinned = false;
  win.setIgnoreMouseEvents(!open, { forward: true });
  win.webContents.send("drawer:set-open", open);
  if (!open && win.isFocused()) win.blur();
}

function peek(ms) {
  peekUntil = Date.now() + ms;
  setOpen(true);
}

function tick() {
  const p = screen.getCursorScreenPoint();
  const inside = isOpen
    ? within(current.panelRect, p, 16, current.edge)
    : within(current.notchRect, p, 0, current.edge);

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

  // A new or changed screen can add or move a camera notch, so read the notches again.
  const displaysChanged = (reread) => {
    place();
    if (reread) loadCameraNotches().then(place);
  };
  screen.on("display-added", () => displaysChanged(true));
  screen.on("display-removed", () => displaysChanged(true));
  screen.on("display-metrics-changed", (_e, _d, changed) =>
    displaysChanged(changed.includes("bounds") || changed.includes("scaleFactor")),
  );
  setInterval(tick, TICK_MS);
}

function showControlCenter(agentId) {
  try {
    openControlCenter(agentId);
  } catch (err) {
    if (Notification.isSupported()) new Notification({ title: "HerdrBot", body: err.message }).show();
  }
}

ipcMain.handle("drawer:config", () => ({ ...serverConfig(), platform: process.platform, layout: current }));
ipcMain.on("drawer:peek", (_e, ms) => peek(Number(ms) || 5000));
ipcMain.on("drawer:hold", (_e, on) => {
  holding = Boolean(on);
});
ipcMain.on("drawer:notify", (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});
ipcMain.on("drawer:close", () => setOpen(false));
ipcMain.on("drawer:open-app", (_e, agentId) => {
  setOpen(false);
  showControlCenter(typeof agentId === "string" ? agentId : undefined);
});
ipcMain.handle("placement:get", () => placementInfo());
ipcMain.handle("placement:set", (_e, choice) => {
  savePlacement(choice);
  if (win) {
    setOpen(false);
    place();
    // Slide out at the new place, so the user sees where the drawer went.
    clearTimeout(showPlaceTimer);
    showPlaceTimer = setTimeout(() => peek(SHOW_PLACE_MS), 350);
  }
  return placementInfo();
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
  await loadCameraNotches();
  createWindow();
  globalShortcut.register(TOGGLE_SHORTCUT, () => {
    if (isOpen) return setOpen(false);
    setOpen(true);
    pinned = true;
    win.focus();
  });
}

async function start() {
  await startDrawer();
  showControlCenter();
}

app.whenReady().then(() => {
  // `--setup` reopens onboarding, e.g. to switch between this computer and another one.
  if (needsOnboarding() || process.argv.includes("--setup")) {
    openOnboarding(({ cancelled }) => (cancelled ? app.quit() : start()));
  } else {
    start();
  }
});

// Opening the app again (a second launch, or a click on its Dock icon) shows the control center.
app.on("second-instance", () => win && showControlCenter());
app.on("activate", () => win && showControlCenter());

// The drawer keeps running when the control center or onboarding closes.
app.on("window-all-closed", () => {});

app.on("will-quit", () => globalShortcut.unregisterAll());
