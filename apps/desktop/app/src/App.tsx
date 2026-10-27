import { useEffect, useMemo, useState } from "react";
import { Api, useHerd } from "./api";
import { bridge } from "./bridge";
import { AgentView } from "./components/AgentView";
import { Overview } from "./components/Overview";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";

export function App({ api }: { api: Api }) {
  const { state, connected } = useHerd(api);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get("agent"));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const select = (id: string | null) => {
    setSelectedId(id);
    setSettingsOpen(false);
  };

  useEffect(
    () =>
      bridge.onSelect((id) => {
        setSelectedId(id);
        setSettingsOpen(false);
      }),
    [],
  );

  const agent = useMemo(() => state.agents.find((a) => a.id === selectedId) ?? null, [state, selectedId]);

  return (
    <div className={`app platform-${api.platform}`}>
      <Sidebar
        state={state}
        connected={connected}
        selectedId={settingsOpen ? null : selectedId}
        onSelect={select}
        overviewOpen={!settingsOpen && !agent}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="main">
        {settingsOpen ? (
          <Settings platform={api.platform} />
        ) : agent ? (
          <AgentView key={agent.id} api={api} state={state} agent={agent} />
        ) : (
          <Overview state={state} connected={connected} onSelect={select} />
        )}
      </main>
    </div>
  );
}
