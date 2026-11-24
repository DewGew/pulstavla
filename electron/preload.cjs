// Avsiktligt minimal preload: renderer får inga Node.js- eller filsystemsrättigheter.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("pulstavlaDesktop", Object.freeze({
  isDesktop: true,
}));
