// Bridge between the drawer page and the main process. CommonJS: sandboxed preloads can't be ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("drawer", {
  config: () => ipcRenderer.invoke("drawer:config"),
  /** The screen or the edge changed: new sizes and edge for the page. */
  onLayout: (fn) => ipcRenderer.on("drawer:layout", (_e, layout) => fn(layout)),
  onSetOpen: (fn) => ipcRenderer.on("drawer:set-open", (_e, open) => fn(open)),
  /** Slide out for `ms` even if the mouse is elsewhere (an agent got blocked or finished). */
  peek: (ms) => ipcRenderer.send("drawer:peek", ms),
  /** Keep the drawer open while the user types, even if the mouse leaves. */
  hold: (on) => ipcRenderer.send("drawer:hold", on),
  close: () => ipcRenderer.send("drawer:close"),
  /** Open the control-center window, optionally on one agent. */
  openApp: (agentId) => ipcRenderer.send("drawer:open-app", agentId),
  notify: (title, body) => ipcRenderer.send("drawer:notify", { title, body }),
  quit: () => ipcRenderer.send("drawer:quit"),
});
