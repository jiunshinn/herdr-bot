// Setup checks and fixes shared by the desktop onboarding (Electron/Node) and the server (Bun).
// Plain JS with Node APIs only, so both runtimes load it without a build step; types are in index.d.ts.

import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

const MIN_HERDR = [0, 9, 0];
const IS_WINDOWS = platform() === "win32";

// Agent CLI → Herdr integration name. Only agents found on PATH are offered an integration.
export const AGENTS = [
  { integration: "claude", bin: "claude", label: "Claude Code" },
  { integration: "codex", bin: "codex", label: "Codex CLI" },
  { integration: "antigravity-cli", bin: "agy", label: "Antigravity CLI" },
  { integration: "copilot", bin: "copilot", label: "GitHub Copilot CLI" },
  { integration: "cursor", bin: "cursor-agent", label: "Cursor CLI" },
  { integration: "opencode", bin: "opencode", label: "opencode" },
  { integration: "grok", bin: "grok", label: "Grok CLI" },
  { integration: "droid", bin: "droid", label: "Factory Droid" },
  { integration: "kimi", bin: "kimi", label: "Kimi CLI" },
  { integration: "qwen", bin: "qwen", label: "Qwen Code" },
  { integration: "pi", bin: "pi", label: "Pi" },
];

export const HERDR_INSTALL_COMMAND = IS_WINDOWS
  ? 'powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"'
  : "curl -fsSL https://herdr.dev/install.sh | sh";

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

// ── PATH ──────────────────────────────────────────────

let cachedPath;

/**
 * PATH for finding and running CLIs. GUI apps on macOS start with a minimal PATH, so add the login
 * shell's PATH and the usual install folders.
 */
export async function searchPath() {
  if (cachedPath) return cachedPath;
  const home = homedir();
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    ...(await loginShellPath()).split(delimiter),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    ...nvmBins(home),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Applications/Tailscale.app/Contents/MacOS",
  ];
  cachedPath = [...new Set(dirs.filter(Boolean))].join(delimiter);
  return cachedPath;
}

/** Forget the cached PATH, e.g. after an installer added a folder. */
export function resetSearchPath() {
  cachedPath = undefined;
}

function loginShellPath() {
  if (IS_WINDOWS) return Promise.resolve("");
  const shell = process.env.SHELL || "/bin/sh";
  return run(shell, ["-ilc", 'printf "%s" "$PATH"'], { timeoutMs: 3000 })
    .then((r) => (r.code === 0 ? r.stdout.trim().split("\n").pop() : ""))
    .catch(() => "");
}

function nvmBins(home) {
  const root = join(home, ".nvm", "versions", "node");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .reverse()
    .map((v) => join(root, v, "bin"));
}

export async function findBinary(name) {
  const exts = IS_WINDOWS ? [".exe", ".cmd", ""] : [""];
  for (const dir of (await searchPath()).split(delimiter)) {
    for (const ext of exts) {
      const path = join(dir, name + ext);
      if (existsSync(path)) return path;
    }
  }
  // Tailscale's macOS app ships the CLI with a capitalised name.
  if (name === "tailscale" && existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale")) {
    return "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  }
  return null;
}

// ── Process helper ────────────────────────────────────

export function run(cmd, args, { timeoutMs = 15000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: env ?? process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stdout ? err.message : "") });
    });
  });
}

async function runTool(name, args, opts) {
  const bin = await findBinary(name);
  if (!bin) return { code: 127, stdout: "", stderr: `${name} not found` };
  return run(bin, args, { ...opts, env: { ...process.env, PATH: await searchPath() } });
}

// ── Checks ────────────────────────────────────────────

/** @returns {Promise<import("./index").SetupReport>} */
export async function checkSetup() {
  const herdr = await checkHerdr();
  const [server, integrations, tailscale, machines] = herdr.installed
    ? await Promise.all([checkHerdrServer(), checkIntegrations(), checkTailscale(), checkMachines()])
    : [{ running: false }, [], await checkTailscale(), []];
  return { platform: platform(), herdr, server, integrations, tailscale, machines };
}

async function checkHerdr() {
  const path = await findBinary("herdr");
  if (!path) return { installed: false, ok: false };
  const r = await runTool("herdr", ["--version"]);
  const version = /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1];
  const ok = Boolean(version) && compareVersions(version, MIN_HERDR) >= 0;
  return { installed: true, ok, path, version, minVersion: MIN_HERDR.join(".") };
}

async function checkHerdrServer() {
  const r = await runTool("herdr", ["status", "server"]);
  return { running: r.code === 0 && /^status:\s*running/m.test(r.stdout) };
}

async function checkIntegrations() {
  const r = await runTool("herdr", ["integration", "status"]);
  const status = new Map();
  for (const line of r.stdout.split("\n")) {
    const m = /^([a-z0-9-]+)(?: \([^)]*\))?: (.+?)(?: \(([^)]*)\))?$/.exec(line.trim());
    if (m) status.set(m[1], m[2]);
  }
  const found = await Promise.all(AGENTS.map(async (a) => ({ ...a, agentPath: await findBinary(a.bin) })));
  return found
    .filter((a) => a.agentPath)
    .map((a) => {
      const state = status.get(a.integration) ?? "unknown";
      return {
        integration: a.integration,
        label: a.label,
        agentPath: a.agentPath,
        state,
        installed: !/^not installed/.test(state) && state !== "unknown",
        outdated: /outdated|update/i.test(state),
      };
    });
}

async function checkTailscale() {
  const path = await findBinary("tailscale");
  if (!path) return { installed: false, running: false };
  const r = await run(path, ["status", "--json", "--peers=false"], { timeoutMs: 8000 });
  try {
    const s = JSON.parse(r.stdout);
    return {
      installed: true,
      running: s.BackendState === "Running",
      backendState: s.BackendState,
      ip: s.Self?.TailscaleIPs?.find((ip) => ip.includes(".")),
      dnsName: s.Self?.DNSName?.replace(/\.$/, ""),
    };
  } catch {
    return { installed: true, running: false, backendState: r.stderr.trim() || "unknown" };
  }
}

async function checkMachines() {
  const r = await runTool("herdr", ["machine", "status"], { timeoutMs: 20000 });
  return r.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 3)
    .map(([id, label, status]) => ({ id, label, status, reachable: status === "reachable" }));
}

function compareVersions(version, min) {
  const v = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) - min[i];
  return 0;
}

// ── Fixes ─────────────────────────────────────────────

/** Run the official Herdr installer. Streams output lines to `onLine`. */
export async function installHerdr(onLine) {
  const [cmd, args] = IS_WINDOWS
    ? ["powershell", ["-ExecutionPolicy", "Bypass", "-c", "irm https://herdr.dev/install.ps1 | iex"]]
    : ["sh", ["-c", HERDR_INSTALL_COMMAND]];
  const code = await stream(cmd, args, onLine);
  resetSearchPath();
  return { ok: code === 0, code };
}

export async function installIntegration(name, onLine) {
  if (!AGENTS.some((a) => a.integration === name)) throw new Error(`unknown integration: ${name}`);
  const bin = await findBinary("herdr");
  if (!bin) throw new Error("herdr is not installed");
  const code = await stream(bin, ["integration", "install", name], onLine);
  return { ok: code === 0, code };
}

/** Start a headless Herdr server that outlives the caller. */
export async function startHerdrServer() {
  const bin = await findBinary("herdr");
  if (!bin) throw new Error("herdr is not installed");
  const child = spawn(bin, ["server"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PATH: await searchPath() },
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if ((await checkHerdrServer()).running) return { ok: true };
  }
  return { ok: false };
}

async function stream(cmd, args, onLine = () => {}) {
  const env = { ...process.env, PATH: await searchPath() };
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [child.stdout, child.stderr]) {
      let buf = "";
      s.on("data", (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach((l) => onLine(l));
      });
      s.on("end", () => buf && onLine(buf));
    }
    child.on("error", (err) => {
      onLine(err.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
