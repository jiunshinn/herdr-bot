# TODO

## Desktop drawer

### Linux (GNOME on Wayland)

Tested on Ubuntu GNOME Wayland, running Electron under XWayland (`--ozone-platform=x11`).

- [ ] **Hover does not open the drawer.** Under XWayland, `screen.getCursorScreenPoint()` is
      only updated while the pointer is over an X11 window, and the collapsed drawer ignores
      mouse events, so the notch never sees the cursor. Ideas: make the notch strip itself
      clickable (`setIgnoreMouseEvents(false)` over the notch rect, `forward: true` elsewhere);
      open on click instead of hover on Linux; or a GNOME Shell extension that reports the
      pointer.
- [ ] **`Ctrl+Alt+H` is not global.** It only fires while the drawer window has focus.
      Electron's `globalShortcut` uses X11 key grabs, and Wayland compositors don't pass keys
      to XWayland clients that aren't focused. Ideas: the XDG GlobalShortcuts portal
      (Electron `--enable-features=GlobalShortcutsPortal`); a GNOME custom shortcut that runs
      a CLI command (`herdr-bot toggle`) which signals the running app over its single-instance
      lock or a local socket.
- [ ] Native Wayland (`--ozone-platform=wayland`) can't keep a window always on top or read
      the global cursor; XWayland stays the default until the above is solved.
- [ ] Electron's SUID sandbox needs `sudo chown root` + `chmod 4755` on `chrome-sandbox`
      on Ubuntu (AppArmor blocks unprivileged user namespaces). Packaged builds (.deb /
      AppImage) should set this up at install time.

### All platforms

- [x] The `×` button quit the whole app, which was easy to click by mistake. It now closes the
      panel; quit with `Ctrl/Cmd+Q` while the panel is focused.
- [ ] Tray / menu bar icon with Open, Settings and Quit.
- [x] The app opens on the control center after setup; the drawer stays at the screen edge.
- [x] Settings: the drawer's screen and edge (top, right, bottom, left), chosen on a map of the
      screens. The top edge of a MacBook screen wraps the camera notch (read with JXA, because
      Electron doesn't report the notch).
- [ ] Settings: server URL, token, shortcut.
- [ ] Test the drawer on Windows (taskbar) and Linux for each edge; only macOS was checked.

## Control center (full app window)

- [x] Agent sidebar (needs attention, then computer → workspace), overview, chat view.
- [x] Chat from the agent's own session file (`/api/agent/transcript`): Claude Code and Codex.
      Tool calls grouped into "Worked · N steps" cards with input and output.
- [x] Blocked banner with the terminal prompt and 1/2/3/Enter/Esc buttons; Terminal tab fallback.
- [x] Chat for Claude Code agents that started before the Herdr hook: the hook reports the
      session id only on `SessionStart`, so the server falls back to `~/.claude/sessions/<pid>.json`
      plus the process's `HERDR_PANE_ID`. This is likely why pro reported no session ids.
- [ ] Codex has no such session registry: a Codex agent that started before its hook still shows
      the terminal.
- [ ] Codex parsing is tested against a saved rollout file only, not a live Codex agent.
- [ ] Chat for other agents (Antigravity, Gemini, opencode, ...): find their session files.
- [ ] Click a notification to open that agent in the control center.
- [ ] Code syntax highlighting in messages; image thumbnails for sent images.
- [ ] Start a new agent / new workspace from the app.

## Onboarding

- [x] First-run window with a checklist: Herdr installed, Herdr server running, agents and
      their Herdr integrations, Tailscale, other computers, herdr-bot server.
- [x] One-click install for Herdr (official installer, after confirmation) and for missing
      integrations (`herdr integration install <name>`).
- [x] "This computer" mode: the desktop app starts the server itself (detached, log in
      `~/.config/herdr-bot/server.log`).
- [x] "Another computer" mode: server URL + token, with a connection test.
- [x] `/api/setup` on the server so the mobile app can show server-side problems.
- [x] macOS GUI apps don't get the shell PATH: checks also use the login shell PATH and the
      usual install folders.
- [ ] Packaging: ship the server as a `bun build --compile` binary so users don't need Bun.
- [ ] Pairing: show a QR code (URL + token) for the mobile app instead of copying the token.
- [ ] Reopen setup from the drawer (today: `bun run --cwd apps/desktop setup`).
- [ ] Test the fix buttons on a clean machine (no Herdr, no Tailscale).
- [ ] Check integrations on the other computers too (`herdr --machine <id> integration status`).
      Found on pro: Claude Code, Codex CLI, Antigravity CLI, Cursor, opencode and Grok are all
      "not installed" there, so pro's agent states are less reliable than the ThinkPad's.

## Server

- [ ] Replace the 1 s in-memory tick with one timer per machine (low priority; it makes no
      Herdr calls).
- [ ] Create / close workspaces, tabs and panes; start agents (`herdr agent start --kind`).

## Mobile

- [ ] Expo app: agent list, detail, reply, camera/photo attach.
- [ ] iOS Live Activity + Dynamic Island (`expo-widgets`, APNs push).
- [ ] Android 16 Live Update (promoted ongoing notification, FCM); ongoing notification with
      actions on Android 15 and older.
- [ ] Chat brain: natural-language commands ("start Codex on pro in repo X").
