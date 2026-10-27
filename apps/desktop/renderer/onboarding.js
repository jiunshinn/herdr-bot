// Onboarding page. Every check comes from the main process (window.setup); this file only renders
// them and wires the fix buttons.

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function show(step) {
  for (const s of document.querySelectorAll(".step")) s.hidden = s.id !== step;
}

// ── Step 1 ────────────────────────────────────────────

for (const button of document.querySelectorAll(".choice")) {
  button.onclick = () => {
    if (button.dataset.mode === "local") {
      show("local");
      recheck();
    } else {
      show("remote");
    }
  };
}
for (const button of document.querySelectorAll(".back")) button.onclick = () => show("welcome");

// ── This computer ─────────────────────────────────────

let busy = null; // id of the check whose fix is running

function log(line) {
  const out = $("log");
  out.hidden = false;
  out.textContent += line + "\n";
  out.scrollTop = out.scrollHeight;
}
window.setup.onLog(log);

async function fix(id, label, action) {
  busy = id;
  render(lastResult);
  log(`── ${label}`);
  try {
    const result = await action();
    if (result?.cancelled) log("Cancelled.");
    else if (result && result.ok === false) log(result.error ? `Failed: ${result.error}` : `Failed (exit ${result.code ?? "?"}).`);
    else log("Done.");
  } catch (err) {
    log(`Failed: ${err.message}`);
  }
  busy = null;
  await recheck();
}

function action(id, label, run) {
  return el("button", { className: "small", disabled: busy !== null, onclick: () => fix(id, label, run) }, label);
}

let lastResult = null;

async function recheck() {
  $("recheck").disabled = true;
  const checking = el("li", { className: "check" }, el("span", { className: "icon" }), el("span", {}, "Checking this computer…"));
  checking.dataset.state = "busy";
  $("checks").replaceChildren(checking);
  lastResult = await window.setup.check();
  $("recheck").disabled = false;
  render(lastResult);
}

$("recheck").onclick = recheck;

function item(id, state, title, detail, extra) {
  const li = el(
    "li",
    { className: "check" },
    el("span", { className: "icon" }, state === "ok" ? "✓" : state === "busy" ? "" : "!"),
    el("div", {}, el("div", { className: "title" }, title), detail && el("div", { className: "detail" }, detail), extra?.rows),
    el("div", { className: "actions" }, ...(extra?.actions ?? [])),
  );
  li.dataset.state = busy === id ? "busy" : state;
  return li;
}

function render(result) {
  if (!result) return;
  const { report, server } = result;
  const { herdr, integrations, tailscale, machines } = report;
  const items = [];

  // 1. Herdr
  if (!herdr.installed) {
    items.push(item("herdr", "bad", "Herdr", "Herdr is not installed.", { actions: [action("herdr", "Install", () => window.setup.installHerdr())] }));
  } else if (!herdr.ok) {
    items.push(
      item("herdr", "bad", "Herdr", `Version ${herdr.version ?? "?"} is too old. HerdrBot needs ${herdr.minVersion} or newer.`, {
        actions: [action("herdr", "Update", () => window.setup.installHerdr())],
      }),
    );
  } else {
    items.push(item("herdr", "ok", "Herdr", `Version ${herdr.version}`));
  }

  // 2. Herdr server
  if (report.server.running) {
    items.push(item("herdr-server", "ok", "Herdr server", "Running"));
  } else {
    items.push(
      item("herdr-server", "bad", "Herdr server", herdr.ok ? "Not running." : "Install Herdr first.", {
        actions: herdr.ok ? [action("herdr-server", "Start", () => window.setup.startHerdr())] : [],
      }),
    );
  }

  // 3. Agent integrations
  if (herdr.ok) {
    if (integrations.length === 0) {
      items.push(item("integrations", "warn", "Agents", "No supported agent found. Install Claude Code, Codex CLI or another agent, then check again."));
    } else {
      const missing = integrations.filter((i) => !i.installed || i.outdated);
      const rows = el(
        "div",
        { className: "rows" },
        ...integrations.map((i) =>
          el(
            "div",
            { className: "row" },
            el(
              "span",
              { title: i.agentPath },
              el("strong", {}, i.label),
              ` · found · Herdr hook: ${i.installed ? (i.outdated ? "outdated" : "installed") : "missing"}`,
            ),
            !i.installed || i.outdated
              ? action(`int-${i.integration}`, i.installed ? "Update hook" : "Add hook", () =>
                  window.setup.installIntegration(i.integration),
                )
              : null,
          ),
        ),
      );
      items.push(
        item(
          "integrations",
          missing.length ? "warn" : "ok",
          "Herdr hooks for your agents",
          missing.length
            ? "These agent CLIs are installed. A Herdr hook lets each one report when it is working, blocked or done. Without it, Herdr guesses from the screen text."
            : "Every agent found reports its state to Herdr.",
          { rows },
        ),
      );
    }
  }

  // 4. Tailscale (optional)
  if (tailscale.running) {
    items.push(item("tailscale", "ok", "Tailscale", `Connected as ${tailscale.dnsName ?? "this computer"} (${tailscale.ip ?? "no IPv4"})`));
  } else {
    const detail = tailscale.installed
      ? "Installed, but not connected. Open Tailscale and log in."
      : "Optional. You need it to use HerdrBot from your phone or another computer.";
    items.push(
      item("tailscale", "warn", "Tailscale (optional)", detail, {
        actions: tailscale.installed ? [] : [el("button", { className: "small", onclick: () => window.setup.openUrl("https://tailscale.com/download") }, "Download")],
      }),
    );
  }

  // 5. Other computers (optional)
  if (herdr.ok) {
    const rows =
      machines.length > 0
        ? el("div", { className: "rows" }, ...machines.map((m) => el("div", { className: "row" }, el("span", {}, `${m.label}: ${m.status}`))))
        : null;
    const unreachable = machines.filter((m) => !m.reachable).length;
    items.push(
      item(
        "machines",
        machines.length && !unreachable ? "ok" : "warn",
        "Other computers (optional)",
        machines.length === 0
          ? "None yet. To add one, run herdr machine add in a terminal."
          : unreachable
            ? `${unreachable} of ${machines.length} can't be reached now. HerdrBot shows them as offline.`
            : "HerdrBot will show agents from these computers too.",
        { rows },
      ),
    );
  }

  // 6. HerdrBot server
  const canStart = herdr.ok && report.server.running;
  if (server.reachable) {
    items.push(item("bot-server", "ok", "HerdrBot server", `Running at ${server.url}`));
  } else {
    items.push(
      item("bot-server", "bad", "HerdrBot server", canStart ? "Not running." : "Waiting for Herdr.", {
        actions: canStart ? [action("bot-server", "Start", () => window.setup.startServer())] : [],
      }),
    );
  }

  $("checks").replaceChildren(...items);
  $("finish-local").disabled = !(herdr.ok && report.server.running && server.reachable) || busy !== null;
}

$("finish-local").onclick = () => window.setup.finish({ mode: "local" });

// ── Another computer ──────────────────────────────────

let tested = null;

function invalidate() {
  tested = null;
  $("finish-remote").disabled = true;
}
$("remote-url").oninput = invalidate;
$("remote-token").oninput = invalidate;

$("test-remote").onclick = async () => {
  const box = $("remote-result");
  box.hidden = false;
  box.className = "result";
  box.textContent = "Connecting…";
  $("test-remote").disabled = true;
  const r = await window.setup.testRemote($("remote-url").value.trim(), $("remote-token").value.trim());
  $("test-remote").disabled = false;
  if (!r.ok) {
    box.className = "result bad";
    box.textContent = r.error;
    return;
  }
  tested = r;
  const warnings = [];
  for (const i of r.setup?.integrations ?? []) {
    if (!i.installed) warnings.push(`${i.label} has no Herdr integration on the server computer. Its state shows as unknown.`);
  }
  box.replaceChildren(
    el("strong", {}, `Connected. ${r.agentCount} agents on ${r.machines.length} computer(s):`),
    el("ul", {}, ...r.machines.map((m) => el("li", {}, `${m.label}: ${m.online ? "online" : "offline"}`))),
    ...(warnings.length ? [el("ul", {}, ...warnings.map((w) => el("li", {}, w)))] : []),
  );
  $("finish-remote").disabled = false;
};

$("finish-remote").onclick = () => {
  if (!tested) return;
  window.setup.finish({ mode: "remote", url: tested.url, token: $("remote-token").value.trim() });
};

// Prefill from an earlier setup (the saved token stays in the main process).
const current = await window.setup.current();
if (current.url) $("remote-url").value = current.url;
if (current.hasToken && current.url) $("remote-token").placeholder = "Leave empty to keep the saved token";
