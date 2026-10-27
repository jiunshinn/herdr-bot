// Agents take images as file paths in the prompt, so an upload is copied to the agent's machine
// first: ~/.herdr-bot/inbox/ locally, or the same folder on the remote machine over SSH.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { Machine } from "./herdr";
import { SSH_OPTS } from "./ssh";

const INBOX = ".herdr-bot/inbox";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([".png", ".jpg", ".gif", ".webp", ".heic"]);

export class ImageError extends Error {}

export async function deliverImage(machine: Machine, file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new ImageError("image is larger than 20 MB");
  const ext = (extname(file.name).toLowerCase() || extFromType(file.type)).replace(".jpeg", ".jpg");
  if (!ALLOWED.has(ext)) throw new ImageError(`unsupported image type: ${ext || file.type}`);
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!machine.remote) {
    const dir = join(homedir(), INBOX);
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, bytes);
    return path;
  }

  if (!machine.target) throw new ImageError(`no SSH target for machine ${machine.label}`);
  const dir = (await exec(["ssh", ...SSH_OPTS, machine.target, `mkdir -p ~/${INBOX} && cd ~/${INBOX} && pwd`])).trim();
  const tmp = join(tmpdir(), `herdr-bot-${name}`);
  await writeFile(tmp, bytes);
  try {
    await exec(["scp", "-q", ...SSH_OPTS, tmp, `${machine.target}:${dir}/${name}`]);
  } finally {
    await rm(tmp, { force: true });
  }
  return `${dir}/${name}`;
}

function extFromType(type: string): string {
  const sub = type.split("/")[1];
  return sub ? `.${sub}` : "";
}

async function exec(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ImageError(`${cmd[0]} failed: ${err.trim() || `exit ${code}`}`);
  return out;
}
