import type { AgentInfo, HerdState } from "@herdr-bot/protocol";
import { useMemo, useState } from "react";
import { ago, byUrgency, kindLabel, machineLabel } from "../util";

interface Props {
  state: HerdState;
  connected: boolean;
  selectedId: string | null;
  onSelect(id: string | null): void;
}

export function Sidebar({ state, connected, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.agents;
    return state.agents.filter((a) =>
      [a.title, a.workspaceLabel, a.kind, a.cwd, machineLabel(state, a.machineId)].some((s) => s.toLowerCase().includes(q)),
    );
  }, [state, query]);

  const attention = visible.filter((a) => a.status === "blocked" || a.status === "done").sort(byUrgency);

  // Machine → workspace → agents, in Herdr's own workspace order.
  const groups = state.machines.map((m) => ({
    machine: m,
    workspaces: state.workspaces
      .filter((w) => w.machineId === m.id)
      .map((w) => ({
        workspace: w,
        agents: visible.filter((a) => a.machineId === m.id && a.workspaceId === w.workspaceId),
      }))
      .filter((g) => g.agents.length > 0),
  }));

  return (
    <aside className="sidebar">
      <header className="sidebar-head drag">
        <button className="brand no-drag" onClick={() => onSelect(null)}>
          <span className={`conn ${connected ? "on" : "off"}`} />
          HerdrBot
        </button>
      </header>
      <div className="search">
        <input placeholder="Search agents" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      </div>
      <nav className="agent-nav">
        {attention.length > 0 && (
          <section>
            <h3>Needs your attention</h3>
            {attention.map((a) => (
              <AgentRow key={`att-${a.id}`} agent={a} state={state} selected={a.id === selectedId} onSelect={onSelect} showMachine />
            ))}
          </section>
        )}
        {groups.map(({ machine, workspaces }) => (
          <section key={machine.id}>
            <h3>
              <span className={`dot ${machine.online ? "online" : "offline"}`} />
              {machine.label}
              {!machine.online && <span className="muted"> · offline</span>}
            </h3>
            {workspaces.map(({ workspace, agents }) => (
              <div key={workspace.workspaceId} className="workspace">
                <div className="workspace-label">{workspace.label}</div>
                {agents.map((a) => (
                  <AgentRow key={a.id} agent={a} state={state} selected={a.id === selectedId} onSelect={onSelect} />
                ))}
              </div>
            ))}
          </section>
        ))}
        {state.agents.length === 0 && <p className="empty">{connected ? "No agents are running." : "Connecting…"}</p>}
      </nav>
    </aside>
  );
}

function AgentRow({
  agent,
  state,
  selected,
  onSelect,
  showMachine,
}: {
  agent: AgentInfo;
  state: HerdState;
  selected: boolean;
  onSelect(id: string): void;
  showMachine?: boolean;
}) {
  const sub = showMachine
    ? `${machineLabel(state, agent.machineId)} · ${agent.workspaceLabel}`
    : kindLabel(agent.kind);
  return (
    <button className={`agent-row${selected ? " selected" : ""}`} data-status={agent.status} onClick={() => onSelect(agent.id)}>
      <span className="status-dot" />
      <span className="agent-row-main">
        <span className="agent-row-title">{agent.title}</span>
        <span className="agent-row-sub">{sub}</span>
      </span>
      <span className="agent-row-time">{ago(agent.changedAt)}</span>
    </button>
  );
}
