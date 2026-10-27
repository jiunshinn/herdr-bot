import type { AgentInfo, HerdState } from "@herdr-bot/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Api, useOutput, useTranscript } from "../api";
import { kindLabel, machineLabel, shortPath, STATUS_LABEL } from "../util";
import { Chat } from "./Chat";
import { Composer } from "./Composer";

interface Props {
  api: Api;
  state: HerdState;
  agent: AgentInfo;
}

const NO_CHAT_REASON: Record<string, (agent: AgentInfo, machine: string) => string> = {
  no_session: (a, m) =>
    `The Herdr hook for ${kindLabel(a.kind)} is not installed on ${m}, so HerdrBot can't find this conversation. Showing the terminal instead. Add the hook in Setup on ${m}.`,
  unsupported_agent: (a) => `Chat view is not available for ${kindLabel(a.kind)} yet. Showing the terminal instead.`,
  file_not_found: () => "HerdrBot can't find this conversation's file. Showing the terminal instead.",
};

export function AgentView({ api, state, agent }: Props) {
  const transcript = useTranscript(api, agent);
  const chatAvailable = transcript.source !== null || transcript.loading;
  const [tab, setTab] = useState<"chat" | "terminal">("chat");
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showTerminal = tab === "terminal" || !chatAvailable;
  const machine = machineLabel(state, agent.machineId);
  const terminal = useOutput(api, agent.id, 300, showTerminal);
  const blockedSnippet = useOutput(api, agent.id, 24, agent.status === "blocked" && !showTerminal);

  useEffect(() => setTab("chat"), [agent.id]);

  const fail = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const send = async (text: string, image: File | null) => {
    try {
      if (image) await api.image(agent.id, image, text);
      else await api.prompt(agent.id, text);
    } catch (err) {
      const msg = (err as Error).message;
      fail(msg.includes("blocked") ? "The agent waits for your choice. Use the buttons above." : msg);
      throw err;
    }
  };

  const keys = (k: string[]) => api.keys(agent.id, k).catch((err) => fail((err as Error).message));
  const consumeDrop = useCallback(() => setDropped(null), []);

  return (
    <section
      className={`agent-view${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (f) setDropped(f);
      }}
    >
      <header className="agent-head drag">
        <div className="agent-head-main">
          <h1>{agent.title}</h1>
          <div className="agent-head-sub">
            <span className="pill" data-status={agent.status}>
              {STATUS_LABEL[agent.status]}
            </span>
            <span>{kindLabel(agent.kind)}</span>
            <span>·</span>
            <span>{machine}</span>
            <span>·</span>
            <span title={agent.cwd}>{shortPath(agent.cwd)}</span>
          </div>
        </div>
        <div className="tabs no-drag">
          <button className={!showTerminal ? "active" : ""} disabled={!chatAvailable} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={showTerminal ? "active" : ""} onClick={() => setTab("terminal")}>
            Terminal
          </button>
        </div>
      </header>

      {!chatAvailable && transcript.reason && (
        <div className="banner info">{(NO_CHAT_REASON[transcript.reason] ?? NO_CHAT_REASON.file_not_found!)(agent, machine)}</div>
      )}

      {showTerminal ? (
        <pre className="terminal">{terminal ?? "Loading…"}</pre>
      ) : (
        <Chat agent={agent} items={transcript.items} truncated={transcript.truncated} />
      )}

      {agent.status === "blocked" && (
        <div className="banner blocked">
          <div className="banner-title">{kindLabel(agent.kind)} needs your answer</div>
          {!showTerminal && blockedSnippet && <pre className="snippet">{lastLines(blockedSnippet, 14)}</pre>}
          <div className="choice-keys">
            <button onClick={() => keys(["1"])}>1</button>
            <button onClick={() => keys(["2"])}>2</button>
            <button onClick={() => keys(["3"])}>3</button>
            <button onClick={() => keys(["enter"])}>Enter</button>
            <button onClick={() => keys(["esc"])}>Esc</button>
          </div>
        </div>
      )}

      {agent.status === "working" && !showTerminal && (
        <div className="working">
          <span className="spinner" /> {kindLabel(agent.kind)} is working…
          <button className="link" onClick={() => keys(["esc"])}>
            Stop
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <Composer
        placeholder={agent.status === "blocked" ? "Answer with the buttons above" : `Message ${agent.title}`}
        disabled={agent.status === "blocked"}
        droppedImage={dropped}
        onConsumeDrop={consumeDrop}
        onSend={send}
      />
    </section>
  );
}

function lastLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}
