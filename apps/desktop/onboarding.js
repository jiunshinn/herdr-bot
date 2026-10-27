// First-run window: choose where the server runs, check Herdr / integrations / Tailscale on this
// computer, fix what can be fixed with one click, then hand over to the drawer.

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkSetup,
  HERDR_INSTALL_COMMAND,
  installHerdr,
  installIntegration,
  startHerdrServer,
} from "@herdr-bot/setup";
import { localServerUrl, readConfig, updateConfig } from "./config.js";
import { serverReachable, startLocalServer } from "./local-server.js";

const here = dirname(fileURLToPath(import.meta.url));

let win = null;
let onDone = () => {};
let finished = false;

export function needsOnboarding() {
  return !readConfig().desktop?.onboarded;
}

export function openOnboarding(done) {
  onDone = done;
  finished = false;
  if (win) return win.focus();
  win = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 520,
    minHeight: 560,
    title: "Set up HerdrBot",
    backgroundColor: "#16171b",
    webPreferences: {
      preload: join(here, "onboarding-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(here, "renderer", "onboarding.html"));
  win.on("closed", () => {
    win = null;
    if (!finished) onDone({ cancelled: true });
  });
}

const log = (event) => (line) => event.sender.send("setup:log", line);

ipcMain.handle("setup:current", () => {
  const config = readConfig();
  return { mode: config.desktop?.mode, url: config.url, hasToken: Boolean(config.token) };
});

ipcMain.handle("setup:check", async () => {
  const url = localServerUrl();
  const [report, reachable] = await Promise.all([checkSetup(), serverReachable(url)]);
  return { report, server: { url, reachable } };
});

ipcMain.handle("setup:install-herdr", async (event) => {
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Install", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: "Install Herdr?",
    detail: `HerdrBot will run the official Herdr installer:\n\n${HERDR_INSTALL_COMMAND}`,
  });
  if (response !== 0) return { ok: false, cancelled: true };
  return installHerdr(log(event));
});

ipcMain.handle("setup:install-integration", (event, name) => installIntegration(String(name), log(event)));

ipcMain.handle("setup:start-herdr", () => startHerdrServer());

ipcMain.handle("setup:start-server", async () => {
  try {
    return await startLocalServer();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("setup:test-remote", async (_e, { url, token }) => {
  token ||= readConfig().token ?? "";
  let base;
  try {
    base = new URL(String(url));
    if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error();
  } catch {
    return { ok: false, error: "Enter a URL like http://100.64.0.1:7787" };
  }
  const origin = base.origin;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!health.ok) return { ok: false, error: `The server answered ${health.status}. Is this a herdr-bot server?` };
  } catch {
    return {
      ok: false,
      error: "No answer. Check that the server runs and that both computers are on the same Tailscale network.",
    };
  }
  const state = await fetch(`${origin}/api/state`, { headers, signal: AbortSignal.timeout(4000) });
  if (state.status === 401) return { ok: false, error: "The token is wrong." };
  if (!state.ok) return { ok: false, error: `The server answered ${state.status}.` };
  const { machines, agents } = await state.json();
  const setup = await fetch(`${origin}/api/setup`, { headers, signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return { ok: true, url: origin, machines, agentCount: agents.length, setup };
});

ipcMain.handle("setup:open-url", (_e, url) => {
  if (/^https:\/\//.test(String(url))) shell.openExternal(String(url));
});

ipcMain.handle("setup:finish", (_e, choice) => {
  const config = readConfig();
  if (choice.mode === "remote") {
    updateConfig({ url: choice.url, token: choice.token || config.token, desktop: { ...config.desktop, mode: "remote", onboarded: true } });
  } else {
    // The local server owns the token; drop a remote URL left from an earlier setup.
    updateConfig({ url: undefined, desktop: { ...config.desktop, mode: "local", onboarded: true } });
  }
  finished = true;
  win?.close();
  onDone({ cancelled: false });
});
