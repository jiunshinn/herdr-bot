import { useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  AgentMeta,
  HerdState,
  ServerMessage,
  TranscriptItem,
  TranscriptResponse,
} from "@herdr-bot/protocol";

export interface ServerConfig {
  url: string;
  token: string;
  platform?: string;
}

export class Api {
  readonly platform: string;

  constructor(readonly config: ServerConfig) {
    this.platform = config.platform ?? "";
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.config.url + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.token}`, ...init.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message || `${res.status} ${res.statusText}`);
    return body as T;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  output(agentId: string, lines = 200): Promise<{ text: string }> {
    return this.request(`/api/agent/output?agentId=${encodeURIComponent(agentId)}&lines=${lines}`);
  }

  transcript(agentId: string, after: number | null, session: string | null): Promise<TranscriptResponse> {
    const q = new URLSearchParams({ agentId });
    if (after !== null && session) {
      q.set("after", String(after));
      q.set("session", session);
    }
    return this.request(`/api/agent/transcript?${q}`);
  }

  prompt(agentId: string, text: string): Promise<unknown> {
    return this.post("/api/agent/prompt", { agentId, text });
  }

  keys(agentId: string, keys: string[]): Promise<unknown> {
    return this.post("/api/agent/keys", { agentId, keys });
  }

  image(agentId: string, file: File, text: string): Promise<{ path: string }> {
    const form = new FormData();
    form.set("agentId", agentId);
    form.set("file", file);
    form.set("text", text);
    return this.request("/api/agent/image", { method: "POST", body: form });
  }

  socketUrl(): string {
    return `${this.config.url.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(this.config.token)}`;
  }
}

/** Live herd state over the server's WebSocket, reconnecting with backoff. */
export function useHerd(api: Api | null): { state: HerdState; connected: boolean } {
  const [state, setState] = useState<HerdState>({ machines: [], workspaces: [], agents: [] });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!api) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let stopped = false;

    const connect = () => {
      ws = new WebSocket(api.socketUrl());
      ws.onopen = () => {
        delay = 1000;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === "state") setState(msg.state);
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [api]);

  return { state, connected };
}

/** Poll faster while the agent works; pause while the window is hidden. */
function pollDelay(status: AgentInfo["status"]): number {
  return status === "working" ? 1000 : status === "blocked" ? 1500 : 3000;
}

export interface Transcript {
  items: TranscriptItem[];
  source: TranscriptResponse["source"];
  meta: AgentMeta;
  reason?: string;
  truncated: boolean;
  loading: boolean;
  error?: string;
}

const MAX_ITEMS = 3000;

export function useTranscript(api: Api, agent: AgentInfo): Transcript {
  const [t, setT] = useState<Transcript>({ items: [], source: null, meta: {}, truncated: false, loading: true });
  const cursor = useRef<{ after: number | null; session: string | null }>({ after: null, session: null });
  const status = useRef(agent.status);
  status.current = agent.status;

  useEffect(() => {
    cursor.current = { after: null, session: null };
    setT({ items: [], source: null, meta: {}, truncated: false, loading: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await api.transcript(agent.id, cursor.current.after, cursor.current.session);
          if (stopped) return;
          cursor.current = { after: r.cursor, session: r.sessionId };
          setT((prev) => ({
            items: (r.reset ? r.items : prev.items.concat(r.items)).slice(-MAX_ITEMS),
            source: r.source,
            meta: r.reset ? r.meta : { ...prev.meta, ...r.meta },
            reason: r.reason,
            truncated: r.reset ? r.truncated : prev.truncated,
            loading: false,
          }));
        } catch (err) {
          if (!stopped) setT((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
        }
      }
      if (!stopped) timer = setTimeout(tick, pollDelay(status.current));
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // A new session (e.g. /clear) needs a full reload.
  }, [api, agent.id, agent.sessionId]);

  return t;
}

/** Recent terminal text, refreshed while shown. */
export function useOutput(api: Api, agentId: string, lines: number, enabled = true): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const { text } = await api.output(agentId, lines);
          if (!stopped) setText(text.replace(/\s+$/, ""));
        } catch {}
      }
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, agentId, lines, enabled]);
  return text;
}
