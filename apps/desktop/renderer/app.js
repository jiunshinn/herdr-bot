// Drawer page: agent list across all machines, agent detail with live output, reply, keys and images.
// Talks to the HerdrBot server over HTTP (commands) and a WebSocket (state and status events).

const STATUS_ORDER = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
const STATUS_COLOR = {
  blocked: "var(--blocked)",
  done: "var(--done)",
  working: "var(--working)",
  idle: "var(--idle)",
  unknown: "var(--unknown)",
};
const PEEK_MS = 5000;
const OUTPUT_LINES = 120;
const OUTPUT_REFRESH_MS = 1500;

const $ = (id) => document.getElementById(id);

const config = await window.drawer.config();
let state = { machines: [], workspaces: [], agents: [] };
let selectedId = null;
let pendingImage = null;
let outputTimer = null;
let peekTimer = null;

// ── Server ────────────────────────────────────────────

async function api(path, init = {}) {
  const res = await fetch(config.url + path, {
    ...init,
    headers: { Authorization: `Bearer ${config.token}`, ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `${res.status} ${res.statusText}`);
  return body;
}

function postJson(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function connect(delay = 1000) {
  const ws = new WebSocket(`${config.url.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(config.token)}`);
  ws.onopen = () => {
    delay = 1000;
    setOffline(false);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      state = msg.state;
      render();
    } else if (msg.type === "agent.status") {
      onStatus(msg);
    }
  };
  ws.onclose = () => {
    setOffline(true);
    setTimeout(() => connect(Math.min(delay * 2, 15000)), delay);
  };
}

// ── Layout ────────────────────────────────────────────

/** Edge and sizes come from placement.js, so the page and the window always agree. */
function applyLayout(layout) {
  const root = document.documentElement;
  // The window moved to a new edge: jump there instead of animating across it.
  document.body.classList.add("no-anim");
  document.body.dataset.edge = layout.edge;
  document.body.classList.toggle("camera", layout.camera);
  for (const [name, px] of Object.entries({
    "--notch-w": layout.notch.width,
    "--notch-h": layout.notch.height,
    "--panel-w": layout.panel.width,
    "--panel-h": layout.panel.height,
    "--inset": layout.inset,
    "--margin": layout.margin,
  })) {
    root.style.setProperty(name, `${px}px`);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("no-anim")));
}

applyLayout(config.layout);
window.drawer.onLayout(applyLayout);

// ── Events ────────────────────────────────────────────

function onStatus({ agent, from, to }) {
  if (from === null || (to !== "blocked" && to !== "done")) return;
  const machine = machineLabel(agent.machineId);
  const what = to === "blocked" ? "needs your input" : "finished";
  window.drawer.notify(`${agent.title}`, `${machine} · ${agent.workspaceLabel} · ${what}`, agent.id);
  document.body.style.setProperty("--peek-color", STATUS_COLOR[to]);
  document.body.classList.add("peek");
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => document.body.classList.remove("peek"), PEEK_MS);
  window.drawer.peek(PEEK_MS);
}

window.drawer.onSetOpen((open) => {
  document.body.classList.toggle("open", open);
  $("panel").setAttribute("aria-hidden", String(!open));
  if (open && selectedId) refreshOutput();
});

// ── Rendering ─────────────────────────────────────────

function machineLabel(id) {
  return state.machines.find((m) => m.id === id)?.label ?? id;
}

function sortedAgents() {
  return [...state.agents].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.changedAt ?? 0) - (a.changedAt ?? 0),
  );
}

function ago(ms) {
  if (ms == null) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render() {
  const counts = { blocked: 0, done: 0, working: 0 };
  for (const a of state.agents) if (a.status in counts) counts[a.status]++;

  // Notch: the most urgent status sets the colour.
  const herd = counts.blocked ? "blocked" : counts.done ? "done" : counts.working ? "working" : "idle";
  document.body.dataset.herd = herd;
  document.body.style.setProperty("--notch-color", STATUS_COLOR[herd]);
  $("notch-count").textContent = counts.blocked || counts.done || counts.working || "";

  if (selectedId) return renderAgentHeader();

  $("title").textContent = "HerdrBot";
  const parts = [];
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);
  if (counts.done) parts.push(`${counts.done} done`);
  if (counts.working) parts.push(`${counts.working} working`);
  parts.push(`${state.agents.length} agents`);
  $("subtitle").textContent = parts.join(" · ");

  $("machines").replaceChildren(
    ...state.machines.map((m) =>
      el("span", { className: `chip${m.online ? "" : " offline"}`, title: m.error ?? "" }, m.label),
    ),
  );

  const agents = sortedAgents();
  $("empty").hidden = agents.length > 0;
  $("agents").replaceChildren(
    ...agents.map((a) => {
      const li = el(
        "li",
        { className: "agent", onclick: () => openAgent(a.id) },
        el("span", { className: "status-dot" }),
        el(
          "div",
          { className: "agent-main" },
          el("div", { className: "agent-title" }, a.title),
          el("div", { className: "agent-sub" }, `${machineLabel(a.machineId)} · ${a.workspaceLabel} · ${a.kind}`),
        ),
        el("div", { className: "agent-meta" }, el("b", {}, a.status), ago(a.changedAt)),
      );
      li.dataset.status = a.status;
      li.style.setProperty("--status-color", STATUS_COLOR[a.status]);
      return li;
    }),
  );
}

function renderAgentHeader() {
  const a = state.agents.find((x) => x.id === selectedId);
  if (!a) {
    $("subtitle").textContent = "This agent is gone.";
    return;
  }
  $("title").textContent = a.title;
  $("subtitle").textContent = `${a.status} · ${machineLabel(a.machineId)} · ${a.workspaceLabel} · ${a.kind}`;
}

function setOffline(offline) {
  if (offline) $("subtitle").textContent = `Server unreachable: ${config.url}`;
  document.body.classList.toggle("offline", offline);
}

// ── Agent detail ──────────────────────────────────────

function openAgent(id) {
  selectedId = id;
  $("list-view").hidden = true;
  $("agent-view").hidden = false;
  $("back").hidden = false;
  $("output").textContent = "";
  renderAgentHeader();
  refreshOutput(true);
  clearInterval(outputTimer);
  outputTimer = setInterval(() => document.body.classList.contains("open") && refreshOutput(), OUTPUT_REFRESH_MS);
  $("input").focus();
}

function closeAgent() {
  selectedId = null;
  clearInterval(outputTimer);
  clearImage();
  $("input").value = "";
  $("agent-view").hidden = true;
  $("list-view").hidden = false;
  $("back").hidden = true;
  render();
}

async function refreshOutput(scroll = false) {
  const id = selectedId;
  try {
    const { text } = await api(`/api/agent/output?agentId=${encodeURIComponent(id)}&lines=${OUTPUT_LINES}`);
    if (id !== selectedId) return;
    const out = $("output");
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    // Full-width rules from the TUI wrap into many lines in the narrow panel; keep one short rule.
    out.textContent = text.replace(/^[─━═]{8,}$/gm, "────────").replace(/\s+$/, "");
    if (scroll || atBottom) out.scrollTop = out.scrollHeight;
  } catch (err) {
    if (id === selectedId) toast(err.message);
  }
}

async function send() {
  const text = $("input").value.trim();
  if (!selectedId || (!text && !pendingImage)) return;
  $("composer").querySelector(".send").disabled = true;
  try {
    if (pendingImage) {
      const form = new FormData();
      form.set("agentId", selectedId);
      form.set("text", text);
      form.set("file", pendingImage);
      await api("/api/agent/image", { method: "POST", body: form });
    } else {
      await postJson("/api/agent/prompt", { agentId: selectedId, text });
    }
    $("input").value = "";
    clearImage();
    refreshOutput(true);
  } catch (err) {
    toast(
      err.message.includes("blocked")
        ? "The agent waits for a choice. Use the keys (Enter, 1, 2, 3) to answer."
        : err.message,
    );
  } finally {
    $("composer").querySelector(".send").disabled = false;
  }
}

async function sendKeys(keys) {
  try {
    await postJson("/api/agent/keys", { agentId: selectedId, keys });
    setTimeout(refreshOutput, 300);
  } catch (err) {
    toast(err.message);
  }
}

// ── Images ────────────────────────────────────────────

function setImage(file) {
  if (!file?.type.startsWith("image/")) return toast("Only images can be attached.");
  pendingImage = file;
  $("attachment-img").src = URL.createObjectURL(file);
  $("attachment-name").textContent = file.name || "pasted image";
  $("attachment").hidden = false;
}

function clearImage() {
  if ($("attachment-img").src) URL.revokeObjectURL($("attachment-img").src);
  pendingImage = null;
  $("attachment").hidden = true;
  $("file").value = "";
}

// ── UI wiring ─────────────────────────────────────────

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

$("back").onclick = closeAgent;
$("close").onclick = () => window.drawer.close();
$("open-app").onclick = () => window.drawer.openApp(selectedId ?? undefined);
$("attachment-clear").onclick = clearImage;
$("file").onchange = (e) => e.target.files[0] && setImage(e.target.files[0]);

$("composer").onsubmit = (e) => {
  e.preventDefault();
  send();
};

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

// Keep the drawer open while the user types, even if the mouse drifts off the panel.
$("input").addEventListener("focus", () => window.drawer.hold(true));
$("input").addEventListener("blur", () => window.drawer.hold(false));

$("input").addEventListener("paste", (e) => {
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    setImage(file);
  }
});

for (const button of document.querySelectorAll(".keys button")) {
  button.onclick = () => sendKeys(button.dataset.keys.split(" "));
}

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "q" && (e.ctrlKey || e.metaKey)) return window.drawer.quit();
  if (e.key !== "Escape") return;
  if (selectedId) closeAgent();
  else window.drawer.close();
});

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (selectedId) document.body.classList.add("dragging");
});
document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (selectedId && file) setImage(file);
});

// Relative times in the list go stale without new state.
setInterval(() => !selectedId && render(), 30_000);

render();
connect();
