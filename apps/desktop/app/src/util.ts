import type { AgentInfo, AgentStatus, HerdState } from "@herdr-bot/protocol";

export const STATUS_ORDER: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

export const STATUS_LABEL: Record<AgentStatus, string> = {
  blocked: "Needs you",
  done: "Done",
  working: "Working",
  idle: "Idle",
  unknown: "Unknown",
};

export const KIND_LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
  gemini: "Gemini",
  cursor: "Cursor",
  opencode: "opencode",
  copilot: "Copilot",
  grok: "Grok",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function machineLabel(state: HerdState, id: string): string {
  return state.machines.find((m) => m.id === id)?.label ?? id;
}

export function byUrgency(a: AgentInfo, b: AgentInfo): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.changedAt ?? 0) - (a.changedAt ?? 0);
}

export function ago(ms: number | null | undefined): string {
  if (ms == null) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function clockTime(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function shortPath(cwd: string): string {
  return cwd.replace(/^\/(home|Users)\/[^/]+/, "~");
}
