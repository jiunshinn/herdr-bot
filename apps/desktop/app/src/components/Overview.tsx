import type { HerdState } from "@herdr-bot/protocol";
import { ago, byUrgency, kindLabel, machineLabel, STATUS_LABEL } from "../util";

export function Overview({ state, connected, onSelect }: { state: HerdState; connected: boolean; onSelect(id: string): void }) {
  const count = (s: string) => state.agents.filter((a) => a.status === s).length;
  const attention = state.agents.filter((a) => a.status === "blocked" || a.status === "done").sort(byUrgency);
  const working = state.agents.filter((a) => a.status === "working").sort(byUrgency);

  return (
    <section className="overview">
      <header className="drag overview-head">
        <h1>Control center</h1>
        <p className="muted">{connected ? `${state.agents.length} agents on ${state.machines.length} computers` : "Connecting to the server…"}</p>
      </header>
      <div className="overview-body">
        <div className="stats">
          {(["blocked", "done", "working", "idle"] as const).map((s) => (
            <div key={s} className="stat" data-status={s}>
              <div className="stat-n">{count(s)}</div>
              <div className="stat-l">{STATUS_LABEL[s]}</div>
            </div>
          ))}
        </div>

        <h2>Computers</h2>
        <div className="machines">
          {state.machines.map((m) => (
            <div key={m.id} className="machine">
              <span className={`dot ${m.online ? "online" : "offline"}`} />
              <strong>{m.label}</strong>
              <span className="muted">
                {m.online ? `${state.agents.filter((a) => a.machineId === m.id).length} agents` : "offline"}
                {m.online && !m.live && " · polling"}
              </span>
            </div>
          ))}
        </div>

        {[
          ["Needs your attention", attention],
          ["Working now", working],
        ].map(([title, list]) =>
          (list as typeof attention).length ? (
            <div key={title as string}>
              <h2>{title as string}</h2>
              <div className="cards">
                {(list as typeof attention).map((a) => (
                  <button key={a.id} className="card" data-status={a.status} onClick={() => onSelect(a.id)}>
                    <span className="status-dot" />
                    <span className="card-main">
                      <strong>{a.title}</strong>
                      <span className="muted">
                        {kindLabel(a.kind)} · {machineLabel(state, a.machineId)} · {a.workspaceLabel}
                      </span>
                    </span>
                    <span className="muted">{ago(a.changedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}
