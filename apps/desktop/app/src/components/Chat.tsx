import type { AgentInfo, TranscriptItem } from "@herdr-bot/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clockTime, kindLabel } from "../util";
import { Markdown } from "./Markdown";

type ToolCall = Extract<TranscriptItem, { kind: "tool_call" }>;
type ToolResult = Extract<TranscriptItem, { kind: "tool_result" }>;

type Block =
  | { type: "user"; item: Extract<TranscriptItem, { kind: "user" }> }
  | { type: "assistant"; item: Extract<TranscriptItem, { kind: "assistant" }> }
  | { type: "steps"; id: string; steps: { call: ToolCall; result?: ToolResult }[] };

/** Consecutive tool calls between two messages become one collapsible "steps" block. */
function toBlocks(items: TranscriptItem[]): Block[] {
  const results = new Map<string, ToolResult>();
  for (const i of items) if (i.kind === "tool_result") results.set(i.callId, i);
  const blocks: Block[] = [];
  for (const i of items) {
    if (i.kind === "tool_result") continue;
    if (i.kind === "tool_call") {
      const last = blocks[blocks.length - 1];
      const step = { call: i, result: results.get(i.callId) };
      if (last?.type === "steps") last.steps.push(step);
      else blocks.push({ type: "steps", id: i.id, steps: [step] });
    } else if (i.kind === "user") {
      blocks.push({ type: "user", item: i });
    } else {
      blocks.push({ type: "assistant", item: i });
    }
  }
  return blocks;
}

export function Chat({ agent, items, truncated }: { agent: AgentInfo; items: TranscriptItem[]; truncated: boolean }) {
  const blocks = useMemo(() => toBlocks(items), [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [zoom, setZoom] = useState<string | null>(null);

  // Follow new messages only while the user is at the bottom.
  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [blocks.length, items.length]);
  useEffect(() => {
    stick.current = true;
  }, [agent.id]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const lastSteps = [...blocks].reverse().find((b) => b.type === "steps") as Extract<Block, { type: "steps" }> | undefined;

  return (
    <div className="chat" ref={scroller} onScroll={onScroll}>
      <div className="chat-inner">
        {truncated && <div className="notice">Older messages are not shown.</div>}
        {blocks.length === 0 && <div className="notice">No messages yet.</div>}
        {blocks.map((b) => {
          if (b.type === "user") {
            return (
              <div key={b.item.id} className="msg user">
                {b.item.images.length > 0 && (
                  <div className="msg-images">
                    {b.item.images.map((src, i) =>
                      src ? (
                        <img key={i} src={src} alt="" onClick={() => setZoom(src)} />
                      ) : (
                        <div key={i} className="image-chip">
                          🖼 Image
                        </div>
                      ),
                    )}
                  </div>
                )}
                {b.item.text && <div className="bubble">{b.item.text}</div>}
                <div className="meta">{clockTime(b.item.at)}</div>
              </div>
            );
          }
          if (b.type === "assistant") {
            return (
              <div key={b.item.id} className="msg assistant">
                <div className="avatar" data-kind={agent.kind}>{kindLabel(agent.kind)[0]}</div>
                <div className="assistant-body">
                  <Markdown text={b.item.text} />
                  <div className="meta">{clockTime(b.item.at)}</div>
                </div>
              </div>
            );
          }
          return (
            <Steps
              key={b.id}
              steps={b.steps}
              live={b === lastSteps && agent.status === "working" && blocks[blocks.length - 1] === b}
            />
          );
        })}
      </div>
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  );
}

function Steps({ steps, live }: { steps: { call: ToolCall; result?: ToolResult }[]; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? live;
  const errors = steps.filter((s) => s.result?.isError).length;
  const last = steps[steps.length - 1]!;
  return (
    <div className={`steps${live ? " live" : ""}`}>
      <button className="steps-head" onClick={() => setOpen(!expanded)}>
        <span className="chevron">{expanded ? "▾" : "▸"}</span>
        <span>
          {live ? "Working" : "Worked"} · {steps.length} step{steps.length > 1 ? "s" : ""}
          {errors > 0 && <span className="err"> · {errors} failed</span>}
        </span>
        {!expanded && <span className="steps-last">{toolTitle(last.call.name)} {last.call.summary}</span>}
      </button>
      {expanded && (
        <div className="steps-list">
          {steps.map((s) => (
            <Step key={s.call.id} call={s.call} result={s.result} />
          ))}
        </div>
      )}
    </div>
  );
}

const TOOL_ICON: Record<string, string> = {
  Bash: "⌘",
  exec_command: "⌘",
  shell: "⌘",
  Read: "📄",
  Write: "✎",
  Edit: "✎",
  MultiEdit: "✎",
  apply_patch: "✎",
  Grep: "🔍",
  Glob: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  web_search: "🌐",
  Agent: "◎",
  Task: "◎",
  TodoWrite: "☑",
};

function toolTitle(name: string): string {
  if (name === "exec_command" || name === "shell") return "Run";
  if (name === "apply_patch") return "Patch";
  return name.replace(/^mcp__[^_]+__/, "");
}

function Step({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`step${result?.isError ? " error" : ""}${result ? "" : " pending"}`}>
      <button className="step-head" onClick={() => setOpen(!open)}>
        <span className="step-icon">{TOOL_ICON[call.name] ?? "•"}</span>
        <span className="step-name">{toolTitle(call.name)}</span>
        <span className="step-summary">{call.summary}</span>
        {!result && <span className="spinner" />}
      </button>
      {open && (
        <div className="step-detail">
          <div className="label">Input</div>
          <pre>{call.input}</pre>
          {result && (
            <>
              <div className="label">{result.isError ? "Error" : "Output"}</div>
              <pre>{result.output || "(no output)"}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
