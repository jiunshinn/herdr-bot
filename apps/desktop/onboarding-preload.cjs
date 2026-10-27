// Bridge for the onboarding window. CommonJS: sandboxed preloads can't be ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  check: () => ipcRenderer.invoke("setup:check"),
  installHerdr: () => ipcRenderer.invoke("setup:install-herdr"),
  installIntegration: (name) => ipcRenderer.invoke("setup:install-integration", name),
  startHerdr: () => ipcRenderer.invoke("setup:start-herdr"),
  startServer: () => ipcRenderer.invoke("setup:start-server"),
  testRemote: (url, token) => ipcRenderer.invoke("setup:test-remote", { url, token }),
  openUrl: (url) => ipcRenderer.invoke("setup:open-url", url),
  finish: (choice) => ipcRenderer.invoke("setup:finish", choice),
  current: () => ipcRenderer.invoke("setup:current"),
  onLog: (fn) => ipcRenderer.on("setup:log", (_e, line) => fn(line)),
});
