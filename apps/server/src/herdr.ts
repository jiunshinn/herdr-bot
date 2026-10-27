// Thin wrapper over the `herdr` CLI. Remote machines go through `herdr --machine <id>`, which reuses
// the SSH connection Herdr already manages, so the server needs no Herdr code on the other machines.

import { hostname } from "node:os";
import type { AgentStatus } from "@herdr-bot/protocol";

export interface Machine {
  id: string;
  label: string;
  remote: boolean;
  /** SSH target for remote machines, as saved in `herdr machine list`. */
  target?: string;
  /** Herdr session on the remote machine. */
  session?: string;
}

export const localMachine: Machine = { id: "local", label: hostname(), remote: false };

export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code = "herdr_error",
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function run(machine: Machine, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const cmd = ["herdr", ...(machine.remote ? ["--machine", machine.id] : []), ...args];
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0) {
    // The CLI prints API errors as JSON on stdout or stderr; prefer their code and message.
    const apiError = parseError(out) ?? parseError(err);
    if (apiError) throw apiError;
    throw new HerdrError(err.trim() || out.trim() || `herdr exited with code ${code}`);
  }
  return out;
}

export async function runJson<T>(machine: Machine, args: string[], timeoutMs?: number): Promise<T> {
  const out = await run(machine, args, timeoutMs);
  const msg = JSON.parse(out);
  if (msg.error) throw new HerdrError(msg.error.message ?? msg.error.code, msg.error.code);
  return msg.result as T;
}

function parseError(text: string): HerdrError | null {
  try {
    const msg = JSON.parse(text);
    if (msg?.error) return new HerdrError(msg.error.message ?? msg.error.code, msg.error.code);
  } catch {}
  return null;
}

// Only the snapshot fields the server uses.
export interface RawAgent {
  agent: string;
  agent_status: AgentStatus;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  cwd: string;
  terminal_title_stripped?: string;
  agent_session?: { kind: string; value: string } | null;
}

export interface RawWorkspace {
  workspace_id: string;
  label: string;
  agent_status: AgentStatus;
}

export interface RawSnapshot {
  agents: RawAgent[];
  workspaces: RawWorkspace[];
}

export async function snapshot(machine: Machine): Promise<RawSnapshot> {
  const result = await runJson<{ snapshot: RawSnapshot }>(machine, ["api", "snapshot"]);
  return result.snapshot;
}

export async function savedMachines(): Promise<Machine[]> {
  const out = await run(localMachine, ["machine", "list", "--json"]);
  const list = JSON.parse(out) as { id: string; label: string; target: string; session: string; enabled: boolean }[];
  return list
    .filter((m) => m.enabled)
    .map((m) => ({ id: m.id, label: m.label, remote: true, target: m.target, session: m.session }));
}

export function readOutput(machine: Machine, paneId: string, lines: number): Promise<string> {
  return run(machine, ["agent", "read", paneId, "--source", "recent", "--lines", String(lines)]);
}

export async function prompt(machine: Machine, paneId: string, text: string): Promise<void> {
  await run(machine, ["agent", "prompt", paneId, text]);
}

export async function sendKeys(machine: Machine, paneId: string, keys: string[]): Promise<void> {
  await run(machine, ["agent", "send-keys", paneId, ...keys]);
}
