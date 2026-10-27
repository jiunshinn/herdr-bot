// Keeps every machine's agents up to date and turns status differences into events.
// Each machine has a Herdr event stream; an event only triggers a fresh snapshot, so local and
// remote machines share one code path. Without a stream (no `nc` on the remote, old Herdr, network
// down) the machine falls back to polling until the stream comes back.

import { EventEmitter } from "node:events";
import { basename } from "node:path";
import {
  agentId,
  type AgentInfo,
  type AgentStatusEvent,
  type HerdState,
  type MachineInfo,
  type WorkspaceInfo,
} from "@herdr-bot/protocol";
import { openStream, type EventStream } from "./events";
import { localMachine, savedMachines, snapshot, type Machine } from "./herdr";

const TICK_MS = 1_000;
/** Snapshot interval while a machine has no event stream. */
const FALLBACK_POLL_MS = 5_000;
/** Safety snapshot interval while the stream is live, in case an event was missed. */
const RECONCILE_MS = 60_000;
/** Group bursts of events (an agent finishing changes several panes) into one snapshot. */
const EVENT_DEBOUNCE_MS = 150;
const STREAM_RETRY_MIN_MS = 2_000;
const STREAM_RETRY_MAX_MS = 60_000;
const MACHINE_REFRESH_MS = 60_000;

interface MachineRuntime {
  machine: Machine;
  online: boolean;
  error?: string;
  updatedAt?: number;
  workspaces: WorkspaceInfo[];
  agents: Map<string, AgentInfo>;
  /** False until the first successful poll, so existing agents don't fire "new agent" events. */
  seeded: boolean;
  polling: boolean;
  /** An event arrived while a poll was running; poll once more when it ends. */
  pollAgain: boolean;
  lastPollAt: number;
  debounce?: Timer;

  stream?: EventStream;
  live: boolean;
  /** Agent panes the current stream watches for status changes, sorted and joined. */
  streamPanes: string;
  streamRetryAt: number;
  streamRetryMs: number;
  streamError?: string;
}

export interface HerdEvents {
  change: [];
  event: [AgentStatusEvent];
}

export class Herd extends EventEmitter<HerdEvents> {
  private runtimes = new Map<string, MachineRuntime>();
  private timers: Timer[] = [];
  private lastPublished = "";

  async start(): Promise<void> {
    this.track(localMachine);
    await this.refreshMachines();
    await Promise.all([...this.runtimes.values()].map((rt) => this.poll(rt)));
    this.publish();
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => void this.refreshMachines(), MACHINE_REFRESH_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const rt of this.runtimes.values()) this.drop(rt);
  }

  machine(id: string): Machine | undefined {
    return this.runtimes.get(id)?.machine;
  }

  agent(id: string): AgentInfo | undefined {
    for (const rt of this.runtimes.values()) {
      const a = rt.agents.get(id);
      if (a) return a;
    }
  }

  state(): HerdState {
    const machines: MachineInfo[] = [];
    const workspaces: WorkspaceInfo[] = [];
    const agents: AgentInfo[] = [];
    for (const rt of this.runtimes.values()) {
      const { id, label, remote } = rt.machine;
      machines.push({ id, label, remote, online: rt.online, live: rt.live, error: rt.error, updatedAt: rt.updatedAt });
      workspaces.push(...rt.workspaces);
      agents.push(...rt.agents.values());
    }
    return { machines, workspaces, agents };
  }

  /** Poll one machine now, e.g. right after sending it a prompt. */
  poke(machineId: string): void {
    const rt = this.runtimes.get(machineId);
    if (rt) this.requestPoll(rt);
  }

  private track(machine: Machine): void {
    const existing = this.runtimes.get(machine.id);
    if (existing) {
      existing.machine = machine;
      return;
    }
    this.runtimes.set(machine.id, {
      machine,
      online: false,
      workspaces: [],
      agents: new Map(),
      seeded: false,
      polling: false,
      pollAgain: false,
      lastPollAt: 0,
      live: false,
      streamPanes: "",
      streamRetryAt: 0,
      streamRetryMs: STREAM_RETRY_MIN_MS,
    });
  }

  private drop(rt: MachineRuntime): void {
    clearTimeout(rt.debounce);
    const stream = rt.stream;
    rt.stream = undefined; // first, so its onClose sees a replaced stream and does nothing
    stream?.close();
  }

  private tick(): void {
    const now = Date.now();
    for (const rt of this.runtimes.values()) {
      if (!rt.stream && rt.seeded && now >= rt.streamRetryAt) this.connect(rt);
      const interval = rt.live ? RECONCILE_MS : FALLBACK_POLL_MS;
      if (now - rt.lastPollAt >= interval) this.requestPoll(rt);
    }
  }

  private connect(rt: MachineRuntime): void {
    rt.streamPanes = agentPanes(rt);
    const stream = openStream(rt.machine, rt.streamPanes ? rt.streamPanes.split(",") : [], {
      onLive: () => {
        if (rt.stream !== stream) return;
        rt.live = true;
        rt.streamError = undefined;
        rt.streamRetryMs = STREAM_RETRY_MIN_MS;
        this.publish();
      },
      onChange: () => {
        if (rt.stream !== stream) return;
        clearTimeout(rt.debounce);
        rt.debounce = setTimeout(() => this.requestPoll(rt), EVENT_DEBOUNCE_MS);
      },
      onClose: (reason) => {
        if (rt.stream !== stream) return; // replaced on purpose
        rt.stream = undefined;
        const wasLive = rt.live;
        rt.live = false;
        if (reason !== rt.streamError) console.error(`[server] ${rt.machine.label}: event stream ended: ${reason}; polling`);
        rt.streamError = reason;
        // A stream that was live and dropped (events lost, pane race) gets a quick retry; one that
        // never started backs off.
        rt.streamRetryMs = wasLive ? STREAM_RETRY_MIN_MS : Math.min(rt.streamRetryMs * 2, STREAM_RETRY_MAX_MS);
        rt.streamRetryAt = Date.now() + rt.streamRetryMs;
        this.requestPoll(rt);
      },
    });
    rt.stream = stream;
  }

  private requestPoll(rt: MachineRuntime): void {
    if (rt.polling) {
      rt.pollAgain = true;
      return;
    }
    void this.poll(rt).then(() => {
      this.publish();
      // Status events are per pane: a new or closed agent pane needs a new subscription.
      if (rt.stream && rt.live && agentPanes(rt) !== rt.streamPanes) {
        const old = rt.stream;
        rt.stream = undefined;
        rt.live = false;
        old.close();
        this.connect(rt);
      }
      if (rt.pollAgain) {
        rt.pollAgain = false;
        this.requestPoll(rt);
      }
    });
  }

  private async refreshMachines(): Promise<void> {
    let saved: Machine[];
    try {
      saved = await savedMachines();
    } catch (err) {
      console.error("[server] could not list saved machines:", (err as Error).message);
      return;
    }
    const keep = new Set([localMachine.id, ...saved.map((m) => m.id)]);
    for (const m of saved) this.track(m);
    for (const [id, rt] of this.runtimes) {
      if (keep.has(id)) continue;
      this.drop(rt);
      this.runtimes.delete(id);
    }
    this.publish();
  }

  private async poll(rt: MachineRuntime): Promise<void> {
    if (rt.polling) return;
    rt.polling = true;
    rt.lastPollAt = Date.now();
    try {
      const snap = await snapshot(rt.machine);
      const now = Date.now();
      const machineId = rt.machine.id;
      const labels = new Map(snap.workspaces.map((w) => [w.workspace_id, w.label]));

      rt.workspaces = snap.workspaces.map((w) => ({
        machineId,
        workspaceId: w.workspace_id,
        label: w.label,
        status: w.agent_status,
      }));

      const next = new Map<string, AgentInfo>();
      for (const raw of snap.agents) {
        const id = agentId(machineId, raw.pane_id);
        const prev = rt.agents.get(id);
        const agent: AgentInfo = {
          id,
          machineId,
          paneId: raw.pane_id,
          tabId: raw.tab_id,
          workspaceId: raw.workspace_id,
          workspaceLabel: labels.get(raw.workspace_id) ?? raw.workspace_id,
          kind: raw.agent,
          status: raw.agent_status,
          title: agentTitle(raw.agent, raw.terminal_title_stripped, raw.cwd),
          cwd: raw.cwd,
          sessionId: raw.agent_session?.kind === "id" ? raw.agent_session.value : null,
          changedAt: !rt.seeded ? null : prev?.status === raw.agent_status ? prev.changedAt : now,
        };
        next.set(id, agent);
        if (rt.seeded && prev?.status !== agent.status) {
          this.emit("event", { type: "agent.status", agent, from: prev?.status ?? null, to: agent.status, at: now });
        }
      }
      rt.agents = next;
      rt.online = true;
      rt.error = undefined;
      rt.updatedAt = now;
      rt.seeded = true;
    } catch (err) {
      // Keep the last known agents so the apps can still show them, marked as offline.
      rt.online = false;
      rt.error = (err as Error).message;
    } finally {
      rt.polling = false;
    }
  }

  private publish(): void {
    // updatedAt changes on every poll; leave it out so an idle herd sends nothing.
    const state = this.state();
    const key = JSON.stringify({ ...state, machines: state.machines.map(({ updatedAt, ...m }) => m) });
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.emit("change");
  }
}

function agentPanes(rt: MachineRuntime): string {
  return [...rt.agents.values()].map((a) => a.paneId).sort().join(",");
}

/** The agent's own session title when it sets one; otherwise the folder, not the command line. */
function agentTitle(kind: string, terminalTitle: string | undefined, cwd: string): string {
  const title = terminalTitle?.trim();
  if (title && title !== kind && !title.startsWith(`${kind} `)) return title;
  return basename(cwd) || kind;
}
