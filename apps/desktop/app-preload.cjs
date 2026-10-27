// Bridge for the control-center window. CommonJS: sandboxed preloads can't be ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hb", {
  config: () => ipcRenderer.invoke("drawer:config"),
  onSelect: (fn) => ipcRenderer.on("app:select", (_e, agentId) => fn(agentId)),
  openSetup: () => ipcRenderer.send("app:open-setup"),
  placement: () => ipcRenderer.invoke("placement:get"),
  setPlacement: (choice) => ipcRenderer.invoke("placement:set", choice),
  onPlacement: (fn) => {
    const listener = (_e, placement) => fn(placement);
    ipcRenderer.on("placement:changed", listener);
    return () => ipcRenderer.removeListener("placement:changed", listener);
  },
});
