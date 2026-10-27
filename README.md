# herdr-bot

One chat-style interface for every coding agent you run in [Herdr](https://herdr.dev):
Claude Code, Codex CLI, Antigravity, Gemini CLI and the rest, across all your sessions,
workspaces, tabs, panes and SSH machines. Read their output, answer them, approve
choices and send them images from a desktop drawer or (soon) your phone.

> Unofficial. herdr-bot is not part of Herdr and is not made by the Herdr authors.

```
 Desktop drawer (Electron)      Mobile app (Expo, planned)
            \                         /
             \  HTTP + WebSocket     /   over Tailscale
              v                     v
        +-----------------------------------+
        | server (Bun)                      |
        |  polls every machine's snapshot   |
        |  status events, image inbox       |
        +-----------------------------------+
              | herdr CLI
      +-------+----------+-----------------+
      v                  v                 v
   this machine   herdr --machine pro   more machines
```

## Requirements

- Herdr 0.9+ with the agent integrations installed (`herdr integration status`).
  Without an integration Herdr can't tell when an agent is working, blocked or done.
- [Bun](https://bun.sh) 1.3+
- [Tailscale](https://tailscale.com) on the server machine and on every device that uses it
- SSH access (key-based, no prompt) to remote machines, for image delivery

## Run

```sh
bun install
bun run server     # on the always-on machine
bun run desktop    # on the machine you sit at
```

The first time the desktop app starts, it opens a setup window. Choose **On this computer** to
check Herdr, its agent integrations and Tailscale here (with buttons to fix them) and to start the
server, or **On another computer** to connect to a server that already runs elsewhere. Run
`bun run --cwd apps/desktop setup` to open it again.

After setup, the app opens on the control center, and the drawer waits at the screen edge.
Closing the control center leaves the drawer running; opening the app again brings the control
center back.

On first start the server writes `~/.config/herdr-bot/config.json` with a random token and
port 7787. A drawer on the same machine reads it from there. A drawer on another machine needs
the server's Tailscale address and the token, in its own `~/.config/herdr-bot/config.json`:

```json
{ "url": "http://100.x.y.z:7787", "token": "<token from the server machine>" }
```

or as `HERDR_BOT_URL` / `HERDR_BOT_TOKEN`.

The server listens on all interfaces but answers only loopback and Tailscale addresses
(100.64.0.0/10, fd7a:115c:a1e0::/48), and every route except `/api/health` needs the token.

### Linux: Electron sandbox

If Electron aborts with "The SUID sandbox helper binary was found, but is not configured
correctly", fix the helper's permissions once:

```sh
sudo chown root apps/desktop/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 apps/desktop/node_modules/electron/dist/chrome-sandbox
```

## Desktop drawer

- A small notch sits at the middle of a screen edge (the right edge until you choose one). Its
  dot shows the most urgent state: orange = an agent is blocked, green = an agent finished,
  blue = agents are working.
- Choose the screen and the edge (top, right, bottom or left) in the control center under
  **Settings**: click an edge on the map of your screens. On the top edge of a MacBook screen the
  notch wraps the camera. An edge where another screen continues is harder to hit, because the
  pointer doesn't stop there.
- Rest the mouse on the notch to slide the panel open; move away to close it.
  `Ctrl/Cmd+Alt+H` opens it and keeps it open; `Esc` or `×` closes it; `Ctrl/Cmd+Q` quits.
- When an agent gets blocked or finishes, the panel peeks out for 5 s and a system
  notification appears.
- Click an agent to see its live output. Reply in the box, or answer a choice with the
  `Enter` / `1` / `2` / `3` / `Esc` buttons.
- Attach an image with `+`, paste it, or drop it on the panel. The server copies it to
  `~/.herdr-bot/inbox/` on the agent's machine and sends the path with your message.

On Linux under Wayland, Electron can't read the cursor position outside its own window, so
hover-to-open may not work; use the shortcut.

## Control center

Click `⤢` in the drawer to open the full app window. It lists every agent by computer and
workspace, and shows each conversation as chat: your messages, the agent's answers (Markdown),
and its tool calls grouped into expandable steps. When an agent waits for a choice, a banner
shows the question with answer buttons. The Terminal tab shows the raw pane.

Chat needs the agent's Herdr hook, which reports its session id; HerdrBot then reads the
agent's own session file (Claude Code: `~/.claude/projects`, Codex: `~/.codex/sessions`).
The hook reports the id only when a session starts. For a Claude Code agent that started before
the hook, HerdrBot finds the id in `~/.claude/sessions/<pid>.json`, matched to the pane by the
`HERDR_PANE_ID` in the agent's environment. Without a session id the app shows the terminal.

## API

All routes need `Authorization: Bearer <token>` (or `?token=` for the WebSocket).
Agent ids are `<machineId>|<paneId>`, e.g. `local|w2:p1`. Types are in
[`packages/protocol`](packages/protocol/src/index.ts).

| Route | |
|---|---|
| `GET /api/state` | machines, workspaces, agents |
| `GET /api/setup` | setup checks on the server machine: Herdr, integrations, Tailscale, machines |
| `GET /api/agent/output?agentId=&lines=` | recent terminal output |
| `GET /api/agent/transcript?agentId=&after=&session=` | conversation as chat items; pass back `cursor` / `sessionId` for new items only |
| `POST /api/agent/prompt` `{agentId, text}` | submit a prompt |
| `POST /api/agent/keys` `{agentId, keys}` | send keys, e.g. `["enter"]` |
| `POST /api/agent/image` multipart `agentId, file, text?` | deliver an image and prompt with its path |
| `WS /ws` | `state` on connect and on change, `agent.status` on every status change |

## Layout

```
packages/protocol   wire types shared by server and apps
packages/setup      setup checks and fixes (Herdr, integrations, Tailscale)
apps/server         Bun server: Herdr CLI wrapper, poller, HTTP/WebSocket API
apps/desktop        Electron drawer, onboarding and control center (app/: React + Vite)
apps/mobile         Expo app (planned)
```

## Roadmap

- [x] Server: all machines, agent state, output, prompt, keys, images
- [x] Desktop drawer
- [ ] Mobile app (Expo): agent list, detail, reply, camera/photo attach
- [ ] iOS Live Activity + Dynamic Island (`expo-widgets`, APNs push)
- [ ] Android Live Update (promoted ongoing notification, FCM)
- [ ] Chat brain: natural-language commands ("start Codex on pro in repo X")
- [ ] Create/close workspaces, tabs and panes from the apps

## License

MIT
