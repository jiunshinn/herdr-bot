// ~/.config/herdr-bot/config.json is shared with the server: the server owns `port` and `token`,
// the desktop app adds `url` (only when the server runs on another computer) and `desktop`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = join(homedir(), ".config", "herdr-bot");
const configPath = join(configDir, "config.json");
export const DEFAULT_PORT = 7787;

export function readConfig() {
  try {
    return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  } catch {
    return {};
  }
}

/** Shallow-merge `patch`; keys set to undefined are removed. */
export function updateConfig(patch) {
  const next = { ...readConfig(), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
}

export function localServerUrl() {
  return `http://127.0.0.1:${readConfig().port || DEFAULT_PORT}`;
}

/** Server URL and token: env first, then the config file. */
export function serverConfig() {
  const saved = readConfig();
  return {
    url: process.env.HERDR_BOT_URL || saved.url || localServerUrl(),
    token: process.env.HERDR_BOT_TOKEN || saved.token || "",
  };
}
