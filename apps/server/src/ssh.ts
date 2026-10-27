// SSH to remote machines for things the Herdr CLI doesn't carry (event streams, image copies,
// transcript reads). One shared master connection per host keeps repeated calls cheap.

import { homedir } from "node:os";
import { join } from "node:path";

export const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=auto",
  // Short path: macOS limits Unix socket paths to 104 bytes.
  "-o", `ControlPath=${join(homedir(), ".ssh", "hb-%C")}`,
  "-o", "ControlPersist=300",
];

/** Single-quote for a POSIX shell. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function sshRun(
  target: string,
  command: string,
  timeoutMs = 15_000,
): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
  const proc = Bun.spawn(["ssh", ...SSH_OPTS, target, command], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}
