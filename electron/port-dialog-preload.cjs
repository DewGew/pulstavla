const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("portDialog", Object.freeze({
  submit: (port) => ipcRenderer.send("pulstavla-port-dialog-submit", port),
  cancel: () => ipcRenderer.send("pulstavla-port-dialog-cancel"),
  onError: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("pulstavla-port-dialog-error", (_event, message) => callback(String(message)));
  },
}));
