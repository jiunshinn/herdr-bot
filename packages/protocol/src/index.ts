// Wire types shared by the server, the desktop drawer and the mobile app.

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface MachineInfo {
  /** "local" for the machine the server runs on, otherwise the Herdr saved-machine id. */
  id: string;
  label: string;
  remote: boolean;
  online: boolean;
  /** True when changes arrive as Herdr events; false while the server falls back to polling. */
  live: boolean;
  error?: string;
  updatedAt?: number;
}

export interface WorkspaceInfo {
  machineId: string;
  workspaceId: string;
  label: string;
  status: AgentStatus;
}

export interface AgentInfo {
  /** `${machineId}|${paneId}`: unique across machines. */
  id: string;
  machineId: string;
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  /** Agent kind as Herdr detects it: claude, codex, agy, gemini, ... */
  kind: string;
  status: AgentStatus;
  title: string;
  cwd: string;
  /** When the server saw the status change (ms since epoch); null if unchanged since it started. */
  changedAt: number | null;
  /**
   * The agent's own session id, reported by its Herdr hook. Needed to read the conversation as chat;
   * null when the agent has no Herdr hook on its machine.
   */
  sessionId: string | null;
}

export interface HerdState {
  machines: MachineInfo[];
  workspaces: WorkspaceInfo[];
  agents: AgentInfo[];
}

export interface AgentStatusEvent {
  type: "agent.status";
  agent: AgentInfo;
  /** null when the agent is new. */
  from: AgentStatus | null;
  to: AgentStatus;
  at: number;
}

/** Messages the server pushes over /ws. */
export type ServerMessage = { type: "state"; state: HerdState } | AgentStatusEvent;

/** One entry of an agent's conversation, parsed from its own session file. */
export type TranscriptItem =
  /** images: a data URL for each attached image, or "" when the session file has no data for it. */
  | { kind: "user"; id: string; at?: string; text: string; images: string[] }
  | { kind: "assistant"; id: string; at?: string; text: string }
  | { kind: "tool_call"; id: string; at?: string; callId: string; name: string; summary: string; input: string }
  | { kind: "tool_result"; id: string; at?: string; callId: string; output: string; isError: boolean };

/** How freely the agent acts: Claude Code's permission mode, or Codex's sandbox policy. */
export interface AgentPermissions {
  /** As the agent names it, e.g. "auto mode", "bypass permissions", "full access". */
  label: string;
  /** ask: asks before risky actions; auto: acts alone within limits; skip: no checks at all. */
  level: "ask" | "auto" | "skip";
}

/** What the agent's own status line shows, read from its session file. */
export interface AgentMeta {
  /** Display name, e.g. "Opus 5.5", or the model id when it has no known name. */
  model?: string;
  /** Reasoning effort, e.g. "high", "xhigh". */
  effort?: string;
  branch?: string;
  /** Tokens in the latest request and the model's context window. */
  context?: { used: number; window: number };
  permissions?: AgentPermissions;
}

export interface TranscriptResponse {
  /** "claude" or "codex"; null when the conversation can't be read (see `reason`). */
  source: "claude" | "codex" | null;
  sessionId: string | null;
  items: TranscriptItem[];
  /** Fields found in this read only: merge them over the previous ones, or replace them on `reset`. */
  meta: AgentMeta;
  /** Pass back as `after` to get only newer items. */
  cursor: number;
  /** True when this is a full (re)load: replace the items instead of appending. */
  reset: boolean;
  /** True when older items were left out of a full load. */
  truncated: boolean;
  reason?: string;
}

export interface PromptRequest {
  agentId: string;
  text: string;
}

export interface KeysRequest {
  agentId: string;
  /** Herdr key names, e.g. "enter", "esc", "1", "ctrl+c". */
  keys: string[];
}

export interface OutputResponse {
  text: string;
}

export interface ImageResponse {
  /** Absolute path of the image on the agent's machine. */
  path: string;
}

export interface ErrorResponse {
  error: { code: string; message: string };
}

export function agentId(machineId: string, paneId: string): string {
  return `${machineId}|${paneId}`;
}

export function parseAgentId(id: string): { machineId: string; paneId: string } | null {
  const i = id.indexOf("|");
  if (i <= 0 || i === id.length - 1) return null;
  return { machineId: id.slice(0, i), paneId: id.slice(i + 1) };
}
