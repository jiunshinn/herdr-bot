// HTTP + WebSocket API for the desktop drawer and the mobile app.
// Listens on all interfaces but only answers loopback and Tailscale addresses, and every route
// except /api/health needs the bearer token from ~/.config/herdr-bot/config.json.

import { timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import {
  parseAgentId,
  type ErrorResponse,
  type KeysRequest,
  type PromptRequest,
  type ServerMessage,
} from "@herdr-bot/protocol";
import { checkSetup } from "@herdr-bot/setup";
import { loadConfig } from "./config";
import { HerdrError, prompt, readOutput, sendKeys, type Machine } from "./herdr";
import { deliverImage, ImageError } from "./images";
import { Herd } from "./state";
import { readTranscript } from "./transcripts";

const config = loadConfig();
const herd = new Herd();
const sockets = new Set<ServerWebSocket<unknown>>();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } } satisfies ErrorResponse, status);
}

/** 127.0.0.0/8, ::1, Tailscale's 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
function isAllowedAddress(address: string): boolean {
  const v4 = address.replace(/^::ffff:/, "");
  if (/^127\./.test(v4)) return true;
  const m = /^100\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return true;
  return address === "::1" || address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

function hasToken(req: Request, url: URL): boolean {
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resolveAgent(id: unknown): { machine: Machine; paneId: string } {
  const parsed = typeof id === "string" ? parseAgentId(id) : null;
  if (!parsed) throw new HttpError(400, "bad_request", "agentId must look like <machine>|<pane>");
  const machine = herd.machine(parsed.machineId);
  if (!machine) throw new HttpError(404, "not_found", `unknown machine ${parsed.machineId}`);
  return { machine, paneId: parsed.paneId };
}

async function route(req: Request, url: URL): Promise<Response> {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/state") return json(herd.state());

  // What is installed and running on the server's machine, for the apps' onboarding screens.
  if (req.method === "GET" && pathname === "/api/setup") return json(await checkSetup());

  if (req.method === "GET" && pathname === "/api/agent/output") {
    const { machine, paneId } = resolveAgent(url.searchParams.get("agentId"));
    const lines = Math.min(Math.max(Number(url.searchParams.get("lines")) || 80, 1), 1000);
    return json({ text: await readOutput(machine, paneId, lines) });
  }

  if (req.method === "GET" && pathname === "/api/agent/transcript") {
    // after + session: the cursor and session id from the previous response, for new items only.
    const id = url.searchParams.get("agentId");
    const { machine } = resolveAgent(id);
    const agent = herd.agent(id!);
    if (!agent) throw new HttpError(404, "not_found", "unknown agent");
    const after = url.searchParams.get("after");
    return json(await readTranscript(machine, agent, after === null ? null : Number(after) || 0, url.searchParams.get("session")));
  }

  if (req.method === "POST" && pathname === "/api/agent/prompt") {
    const body = (await req.json()) as PromptRequest;
    const { machine, paneId } = resolveAgent(body.agentId);
    if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "bad_request", "text is empty");
    await prompt(machine, paneId, body.text);
    herd.poke(machine.id);
    return json({ ok: true });
  }

  if (req.method === "POST" && pathname === "/api/agent/keys") {
    const body = (await req.json()) as KeysRequest;
    const { machine, paneId } = resolveAgent(body.agentId);
    if (!Array.isArray(body.keys) || body.keys.length === 0 || !body.keys.every((k) => typeof k === "string")) {
      throw new HttpError(400, "bad_request", "keys must be a non-empty list of key names");
    }
    await sendKeys(machine, paneId, body.keys);
    herd.poke(machine.id);
    return json({ ok: true });
  }

  if (req.method === "POST" && pathname === "/api/agent/image") {
    // multipart: agentId, file, optional text. Sends "<text> [image: <path>]" to the agent.
    const form = await req.formData();
    const { machine, paneId } = resolveAgent(form.get("agentId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "bad_request", "file is missing");
    const path = await deliverImage(machine, file);
    const text = String(form.get("text") ?? "").trim() || "See the attached image.";
    // One line: a newline in the prompt would submit early in some agents.
    await prompt(machine, paneId, `${text.replace(/\s*\n\s*/g, " ")} [image: ${path}]`);
    herd.poke(machine.id);
    return json({ path });
  }

  throw new HttpError(404, "not_found", `no route for ${req.method} ${pathname}`);
}

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req, server) {
    const address = server.requestIP(req)?.address ?? "";
    if (!isAllowedAddress(address)) return new Response("Forbidden", { status: 403 });

    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/api/health") return json({ ok: true });
    if (!hasToken(req, url)) return fail(401, "unauthorized", "missing or wrong token");

    if (url.pathname === "/ws") {
      return server.upgrade(req) ? undefined : fail(400, "bad_request", "expected a WebSocket upgrade");
    }

    try {
      return await route(req, url);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.code, err.message);
      if (err instanceof HerdrError) return fail(502, err.code, err.message);
      if (err instanceof ImageError) return fail(400, "image_error", err.message);
      if (err instanceof SyntaxError) return fail(400, "bad_request", "body is not valid JSON");
      console.error("[server]", err);
      return fail(500, "internal", (err as Error).message);
    }
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: "state", state: herd.state() } satisfies ServerMessage));
    },
    close(ws) {
      sockets.delete(ws);
    },
    message() {
      // Clients send commands over HTTP; the socket only carries pushes.
    },
  },
});

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) ws.send(data);
}

herd.on("change", () => broadcast({ type: "state", state: herd.state() }));
herd.on("event", (event) => broadcast(event));

await herd.start();

const { machines } = herd.state();
console.log(`[server] listening on http://0.0.0.0:${server.port} (loopback and Tailscale only)`);
for (const m of machines) console.log(`[server]   ${m.label} (${m.id}): ${m.online ? "online" : `offline: ${m.error}`}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    herd.stop();
    server.stop(true);
    process.exit(0);
  });
}
