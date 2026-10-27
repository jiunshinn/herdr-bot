// Reads an agent's conversation from its own session file, so the apps can show it as chat
// instead of terminal text. Herdr's hook reports the session id; the file is found from that:
//   Claude Code  ~/.claude/projects/<project>/<session>.jsonl
//   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session>.jsonl
// Reads are incremental: the client passes back a byte cursor and gets only the new lines.

import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, TranscriptItem, TranscriptResponse } from "@herdr-bot/protocol";
import type { Machine } from "./herdr";
import { shellQuote, sshRun } from "./ssh";

type Source = "claude" | "codex";

/** How far back a full load reaches. Long sessions show their latest part. */
const INITIAL_BYTES = 1_500_000;
/** Most bytes read per request; the client catches up over several polls. */
const MAX_CHUNK = 4_000_000;
const MAX_TOOL_TEXT = 4_000;

const located = new Map<string, string>();

export async function readTranscript(
  machine: Machine,
  agent: AgentInfo,
  after: number | null,
  clientSession: string | null,
): Promise<TranscriptResponse> {
  let sessionId = agent.sessionId;
  const empty = (reason: string): TranscriptResponse => ({
    source: null,
    sessionId,
    items: [],
    cursor: 0,
    reset: true,
    truncated: false,
    reason,
  });

  const source: Source | null = agent.kind === "claude" ? "claude" : agent.kind === "codex" ? "codex" : null;
  if (!source) return empty("unsupported_agent");
  if (!sessionId && source === "claude") sessionId = await claudePaneSession(machine, agent.paneId);
  if (!sessionId) return empty("no_session");
  // The id goes into a shell command for remote machines.
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return empty("bad_session");

  const key = `${machine.id}|${sessionId}`;
  let path = located.get(key);
  if (!path) {
    path = (await locate(machine, source, sessionId)) ?? undefined;
    if (!path) return empty("file_not_found");
    located.set(key, path);
  }

  const reset = after === null || clientSession !== sessionId;
  const chunk = await readChunk(machine, path, reset ? null : after);
  if (!chunk) {
    located.delete(key);
    return empty("file_not_found");
  }
  // The file shrank (rewritten): start over.
  if (!reset && chunk.size < (after ?? 0)) return readTranscript(machine, agent, null, null);

  let bytes = chunk.data;
  let start = chunk.start;
  // A full load that starts mid-file begins inside a line: skip to the next one.
  if (reset && start > 0) {
    const nl = bytes.indexOf(0x0a);
    bytes = nl >= 0 ? bytes.subarray(nl + 1) : new Uint8Array();
    start += nl + 1;
  }
  // Keep a trailing partial line for the next read.
  const lastNl = bytes.lastIndexOf(0x0a);
  const complete = lastNl >= 0 ? bytes.subarray(0, lastNl + 1) : new Uint8Array();

  const items = parse(source, complete, start);
  return {
    source,
    sessionId,
    items,
    cursor: start + complete.length,
    reset,
    truncated: reset && chunk.start > 0,
  };
}

// ── Finding and reading the file ──────────────────────

// Herdr's hook reports the session id only when a session starts, so a Claude Code agent that
// started before the hook was installed has none. Claude Code also keeps
// ~/.claude/sessions/<pid>.json with its live session id, and its process inherits the pane's
// HERDR_PANE_ID: together they map each pane to its session. Prints "<pane>\t<start>\t<json>".
const CLAUDE_PANES_SCRIPT = `
for f in "$HOME"/.claude/sessions/*.json; do
  [ -f "$f" ] || continue
  pid=$(basename "$f" .json)
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  if [ -r "/proc/$pid/environ" ]; then
    pane=$(tr '\\0' '\\n' < "/proc/$pid/environ" | sed -n 's/^HERDR_PANE_ID=//p' | tail -1)
  else
    pane=$(ps -E -ww -o command= -p "$pid" 2>/dev/null | tr ' ' '\\n' | sed -n 's/^HERDR_PANE_ID=//p' | tail -1)
  fi
  [ -n "$pane" ] || continue
  start=$(TZ=UTC LC_ALL=C ps -o lstart= -p "$pid" 2>/dev/null)
  printf '%s\\t%s\\t%s\\n' "$pane" "$start" "$(tr -d '\\n' < "$f")"
done
true`;

const CLAUDE_PANES_TTL_MS = 10_000;
const claudePanes = new Map<string, { at: number; panes: Promise<Map<string, string>> }>();

async function claudePaneSession(machine: Machine, paneId: string): Promise<string | null> {
  let entry = claudePanes.get(machine.id);
  if (!entry || Date.now() - entry.at > CLAUDE_PANES_TTL_MS) {
    entry = { at: Date.now(), panes: scanClaudePanes(machine) };
    claudePanes.set(machine.id, entry);
  }
  return (await entry.panes).get(paneId) ?? null;
}

async function scanClaudePanes(machine: Machine): Promise<Map<string, string>> {
  let out = "";
  try {
    if (machine.remote) {
      if (machine.target) out = new TextDecoder().decode((await sshRun(machine.target, CLAUDE_PANES_SCRIPT)).stdout);
    } else {
      const proc = Bun.spawn(["sh", "-c", CLAUDE_PANES_SCRIPT], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
      out = await new Response(proc.stdout).text();
    }
  } catch {}

  const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  const found = new Map<string, { sessionId: string; startedAt: number }>();
  for (const line of out.split("\n")) {
    const [pane, start, json] = line.split("\t");
    if (!pane || !json) continue;
    let s: any;
    try {
      s = JSON.parse(json);
    } catch {
      continue;
    }
    if (typeof s?.sessionId !== "string") continue;
    // Skip `claude -p` runs inside the pane, and files of dead processes whose pid is in use again.
    if (s.kind && s.kind !== "interactive") continue;
    if (typeof s.procStart === "string" && start && !same(s.procStart, start)) continue;
    const startedAt = Number(s.startedAt) || 0;
    const prev = found.get(pane);
    if (!prev || startedAt > prev.startedAt) found.set(pane, { sessionId: s.sessionId, startedAt });
  }
  return new Map([...found].map(([pane, s]) => [pane, s.sessionId]));
}

async function locate(machine: Machine, source: Source, sessionId: string): Promise<string | null> {
  if (machine.remote) {
    if (!machine.target) return null;
    const cmd =
      source === "claude"
        ? `ls -1 ~/.claude/projects/*/${sessionId}.jsonl 2>/dev/null | head -1`
        : `find ~/.codex/sessions -name '*${sessionId}.jsonl' 2>/dev/null | head -1`;
    const r = await sshRun(machine.target, cmd);
    return new TextDecoder().decode(r.stdout).trim() || null;
  }

  const home = homedir();
  if (source === "claude") {
    const root = join(home, ".claude", "projects");
    if (!existsSync(root)) return null;
    for (const dir of await readdir(root)) {
      const path = join(root, dir, `${sessionId}.jsonl`);
      if (existsSync(path)) return path;
    }
    return null;
  }
  return findCodex(join(home, ".codex", "sessions"), `${sessionId}.jsonl`);
}

/** Newest dated folders first: the live session is almost always recent. */
async function findCodex(dir: string, suffix: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => b.name.localeCompare(a.name));
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isFile() && e.name.endsWith(suffix)) return path;
    if (e.isDirectory()) {
      const found = await findCodex(path, suffix);
      if (found) return found;
    }
  }
  return null;
}

interface Chunk {
  size: number;
  start: number;
  data: Uint8Array;
}

/** `from` null: the last INITIAL_BYTES. */
async function readChunk(machine: Machine, path: string, from: number | null): Promise<Chunk | null> {
  if (machine.remote) {
    if (!machine.target) return null;
    // First line: file size. Then the bytes from `start`.
    const fromExpr = from === null ? `$(( s > ${INITIAL_BYTES} ? s - ${INITIAL_BYTES} : 0 ))` : String(from);
    const cmd = `f=${shellQuote(path)}; [ -f "$f" ] || exit 3; s=$(wc -c < "$f" | tr -d ' '); st=${fromExpr}; echo "$s $st"; tail -c +$((st + 1)) "$f" | head -c ${MAX_CHUNK}`;
    const r = await sshRun(machine.target, cmd);
    if (r.code !== 0) return null;
    const nl = r.stdout.indexOf(0x0a);
    const [size, start] = new TextDecoder().decode(r.stdout.subarray(0, nl)).split(" ").map(Number);
    return { size: size ?? 0, start: start ?? 0, data: r.stdout.subarray(nl + 1) };
  }

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return null;
  }
  const start = from === null ? Math.max(0, size - INITIAL_BYTES) : Math.min(from, size);
  const length = Math.min(size - start, MAX_CHUNK);
  const file = await open(path, "r");
  try {
    const data = new Uint8Array(length);
    await file.read(data, 0, length, start);
    return { size, start, data };
  } finally {
    await file.close();
  }
}

// ── Parsing ───────────────────────────────────────────

function parse(source: Source, bytes: Uint8Array, start: number): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset < bytes.length) {
    let end = bytes.indexOf(0x0a, offset);
    if (end < 0) end = bytes.length;
    const line = decoder.decode(bytes.subarray(offset, end)).trim();
    // The line's byte position in the file is a stable id across incremental reads.
    const id = String(start + offset);
    offset = end + 1;
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (source === "claude") parseClaude(entry, id, items);
    else parseCodex(entry, id, items);
  }
  return items;
}

/** Prompts the agent's harness injects, not text the user typed. */
function isInjected(text: string): boolean {
  return /^\s*<[a-z][a-z0-9_-]*>/i.test(text) || /^\s*Caveat: The messages below/.test(text);
}

function clip(text: string, max = MAX_TOOL_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c?.type === "text" ? c.text : c?.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

function summarize(name: string, input: any): string {
  if (!input || typeof input !== "object") return typeof input === "string" ? firstLine(input) : "";
  const pick =
    input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ??
    input.description ?? input.prompt ?? Object.values(input).find((v) => typeof v === "string");
  return firstLine(Array.isArray(pick) ? pick.join(" ") : String(pick ?? ""));
}

/** Readable tool input: a shell command as itself, other inputs as `key: value` lines. */
function formatInput(input: any): string {
  if (input == null) return "";
  if (typeof input !== "object") return String(input);
  const command = input.command ?? input.cmd;
  if (command !== undefined && Object.keys(input).every((k) => ["command", "cmd", "description", "workdir", "timeout", "yield_time_ms", "max_output_tokens"].includes(k))) {
    return Array.isArray(command) ? command.join(" ") : String(command);
  }
  return Object.entries(input)
    .map(([k, v]) => {
      const text = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      return text.includes("\n") ? `${k}:\n${text.replace(/^/gm, "  ")}` : `${k}: ${text}`;
    })
    .join("\n");
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function parseClaude(e: any, id: string, items: TranscriptItem[]): void {
  // Sub-agent turns live in the same file; the main conversation is enough here.
  if (e.isSidechain || (e.type !== "user" && e.type !== "assistant")) return;
  const at: string | undefined = e.timestamp;
  const content = e.message?.content;

  if (e.type === "user") {
    // isCompactSummary: the summary Claude writes when it compacts a long conversation.
    if (e.isMeta || e.isCompactSummary) return;
    if (typeof content === "string") {
      if (!isInjected(content)) items.push({ kind: "user", id, at, text: content, images: 0 });
      return;
    }
    if (!Array.isArray(content)) return;
    const texts: string[] = [];
    let images = 0;
    content.forEach((b: any, i: number) => {
      if (b.type === "text" && !isInjected(b.text)) texts.push(b.text);
      else if (b.type === "image") images++;
      else if (b.type === "tool_result") {
        items.push({
          kind: "tool_result",
          id: `${id}:${i}`,
          at,
          callId: b.tool_use_id,
          output: clip(toText(b.content)),
          isError: Boolean(b.is_error),
        });
      }
    });
    if (texts.length || images) items.push({ kind: "user", id, at, text: texts.join("\n\n"), images });
    return;
  }

  if (!Array.isArray(content)) return;
  content.forEach((b: any, i: number) => {
    if (b.type === "text" && b.text?.trim()) items.push({ kind: "assistant", id: `${id}:${i}`, at, text: b.text });
    else if (b.type === "tool_use") {
      items.push({
        kind: "tool_call",
        id: `${id}:${i}`,
        at,
        callId: b.id,
        name: b.name,
        summary: summarize(b.name, b.input),
        input: clip(formatInput(b.input)),
      });
    }
  });
}

function parseCodex(e: any, id: string, items: TranscriptItem[]): void {
  if (e.type !== "response_item") return;
  const p = e.payload ?? {};
  const at: string | undefined = e.timestamp;

  switch (p.type) {
    case "message": {
      const parts: any[] = Array.isArray(p.content) ? p.content : [];
      const text = parts
        .filter((c) => c.type === "input_text" || c.type === "output_text")
        .map((c) => c.text)
        .join("\n\n");
      if (p.role === "user") {
        const images = parts.filter((c) => c.type === "input_image").length;
        if ((text && !isInjected(text)) || images) items.push({ kind: "user", id, at, text: isInjected(text) ? "" : text, images });
      } else if (p.role === "assistant" && text.trim()) {
        items.push({ kind: "assistant", id, at, text });
      }
      return;
    }
    case "function_call":
    case "custom_tool_call": {
      let input: any = p.arguments ?? p.input;
      try {
        if (typeof input === "string" && p.type === "function_call") input = JSON.parse(input);
      } catch {}
      items.push({
        kind: "tool_call",
        id,
        at,
        callId: p.call_id,
        name: p.name,
        summary: summarize(p.name, input),
        input: clip(formatInput(input)),
      });
      return;
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      const out = typeof p.output === "string" ? p.output : toText(p.output?.content ?? p.output?.output ?? p.output);
      items.push({ kind: "tool_result", id, at, callId: p.call_id, output: clip(out), isError: false });
      return;
    }
    case "web_search_call":
      items.push({
        kind: "tool_call",
        id,
        at,
        callId: id,
        name: "web_search",
        summary: firstLine(p.action?.query ?? ""),
        input: clip(formatInput(p.action ?? {})),
      });
      return;
  }
}
