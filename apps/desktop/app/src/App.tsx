import { useEffect, useMemo, useState } from "react";
import { Api, useHerd } from "./api";
import { bridge } from "./bridge";
import { AgentView } from "./components/AgentView";
import { Overview } from "./components/Overview";
import { Sidebar } from "./components/Sidebar";

export function App({ api }: { api: Api }) {
  const { state, connected } = useHerd(api);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get("agent"));

  useEffect(() => bridge.onSelect(setSelectedId), []);

  const agent = useMemo(() => state.agents.find((a) => a.id === selectedId) ?? null, [state, selectedId]);

  return (
    <div className={`app platform-${api.platform}`}>
      <Sidebar
        state={state}
        connected={connected}
        selectedId={selectedId}
        onSelect={setSelectedId}
        overviewOpen={!agent}
      />
      <main className="main">
        {agent ? (
          <AgentView key={agent.id} api={api} state={state} agent={agent} />
        ) : (
          <Overview state={state} connected={connected} onSelect={setSelectedId} />
        )}
      </main>
    </div>
  );
}
