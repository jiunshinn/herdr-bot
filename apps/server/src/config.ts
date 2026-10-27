// Server settings live in ~/.config/herdr-bot/config.json. The token is created on first run; the
// desktop drawer on the same machine reads it from the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  port: number;
  token: string;
}

export const configDir = join(homedir(), ".config", "herdr-bot");
const configPath = join(configDir, "config.json");
const DEFAULT_PORT = 7787;

export function loadConfig(): Config {
  const saved: Partial<Config> = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const config: Config = {
    port: Number(process.env.HERDR_BOT_PORT) || saved.port || DEFAULT_PORT,
    token: saved.token || randomBytes(24).toString("base64url"),
  };
  // Persist only defaults that were missing; an env override stays an override.
  if (!saved.token || !saved.port) {
    const stored = { ...saved, token: config.token, port: saved.port || DEFAULT_PORT };
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(configPath, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
  }
  return config;
}
