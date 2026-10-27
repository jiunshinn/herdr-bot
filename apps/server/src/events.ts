// Live Herdr event stream for one machine: `events.subscribe` on the local socket, or on the remote
// machine's socket through `ssh <target> nc -U <socket>`. The stream only signals "something changed";
// the caller re-reads the snapshot, so event payloads never need to be merged into state.

import { homedir } from "node:os";
import { join } from "node:path";
import type { Machine } from "./herdr";
import { SSH_OPTS } from "./ssh";

// Structure changes for every pane, plus status changes for the agent panes we know about
// (`pane.agent_status_changed` needs a pane_id). Not `pane.updated`: it fires on every terminal
// title change, and agents animate their titles while they work.
const STRUCTURE_EVENTS = [
  "workspace.created",
  "workspace.renamed",
  "workspace.closed",
  "tab.created",
  "tab.renamed",
  "tab.closed",
  "pane.created",
  "pane.closed",
  "pane.exited",
  "pane.agent_detected",
];

export interface StreamHandlers {
  /** The server accepted the subscription. */
  onLive(): void;
  /** Herdr reported a change. */
  onChange(): void;
  /** The stream ended: rejected, events lost, network gone, or closed by us. */
  onClose(reason: string): void;
}

export interface EventStream {
  close(): void;
}

function socketPath(session: string | undefined, home: string): string {
  return !session || session === "default"
    ? join(home, ".config", "herdr", "herdr.sock")
    : join(home, ".config", "herdr", "sessions", session, "herdr.sock");
}

export function openStream(machine: Machine, agentPaneIds: string[], handlers: StreamHandlers): EventStream {
  const subscribe = JSON.stringify({
    id: "sub",
    method: "events.subscribe",
    params: {
      subscriptions: [
        ...STRUCTURE_EVENTS.map((type) => ({ type })),
        ...agentPaneIds.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
      ],
    },
  });

  let closed = false;
  let buffer = "";
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    transport.close();
    handlers.onClose(reason);
  };
  const onData = (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg: { id?: string; result?: unknown; error?: { code?: string; message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.error) return finish(msg.error.code ?? msg.error.message ?? "error");
      if (msg.id === "sub") handlers.onLive();
      else handlers.onChange();
    }
  };

  const transport = machine.remote ? remoteTransport(machine, subscribe, onData, finish) : localTransport(subscribe, onData, finish);
  return { close: () => finish("closed") };
}

interface Transport {
  close(): void;
}

function localTransport(subscribe: string, onData: (s: string) => void, finish: (r: string) => void): Transport {
  const path = process.env.HERDR_SOCKET_PATH || socketPath(process.env.HERDR_SESSION, homedir());
  let socket: { end(): void } | undefined;
  let closed = false;
  const decoder = new TextDecoder();
  Bun.connect({
    unix: path,
    socket: {
      open(s) {
        s.write(subscribe + "\n");
      },
      data(_s, data) {
        onData(decoder.decode(data, { stream: true }));
      },
      close() {
        finish("socket closed");
      },
      error(_s, err) {
        finish(err.message);
      },
    },
  }).then(
    (s) => (closed ? s.end() : (socket = s)),
    (err: Error) => finish(err.message),
  );
  return {
    close() {
      closed = true;
      socket?.end();
    },
  };
}

function remoteTransport(machine: Machine, subscribe: string, onData: (s: string) => void, finish: (r: string) => void): Transport {
  if (!machine.target) {
    queueMicrotask(() => finish("no SSH target"));
    return { close() {} };
  }
  // $HOME expands on the remote side; the path is built there, not here.
  const path = socketPath(machine.session, "$HOME").replace("$HOME", '"$HOME"');
  const proc = Bun.spawn(["ssh", ...SSH_OPTS, machine.target, `exec nc -U ${path}`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(subscribe + "\n");
  proc.stdin.flush();
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) onData(decoder.decode(chunk, { stream: true }));
    const err = (await new Response(proc.stderr).text()).trim();
    finish(err || `ssh exited with code ${await proc.exited}`);
  })().catch((err: Error) => finish(err.message));
  return {
    close() {
      proc.kill();
    },
  };
}
