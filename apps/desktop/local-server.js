// "This computer" mode: the desktop app starts the herdr-bot server when it isn't running.
// The server is detached, so it keeps serving the phone after the drawer quits.
// TODO(packaging): ship `bun build --compile` binaries instead of needing Bun.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, searchPath } from "@herdr-bot/setup";
import { configDir, localServerUrl } from "./config.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "server");

export async function serverReachable(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startLocalServer() {
  const url = localServerUrl();
  if (await serverReachable(url)) return { ok: true, url };
  const bun = await findBinary("bun");
  if (!bun) throw new Error("Bun is not installed. Install it from https://bun.sh and try again.");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const log = openSync(join(configDir, "server.log"), "a");
  spawn(bun, ["src/index.ts"], {
    cwd: serverDir,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PATH: await searchPath() },
  }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await serverReachable(url)) return { ok: true, url };
  }
  throw new Error(`The server did not start. See ${join(configDir, "server.log")}.`);
}
