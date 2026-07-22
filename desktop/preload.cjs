/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cpDanceDesktop", {
  getInitialState: () => ipcRenderer.invoke("desktop:get-initial-state"),
  getBridgeState: () => ipcRenderer.invoke("desktop:get-bridge-state"),
  dispatchAction: (action) => ipcRenderer.invoke("desktop:dispatch-action", action),
  setMousePassthrough: (passthrough) => ipcRenderer.send("desktop:set-mouse-passthrough", Boolean(passthrough)),
  onProbeHitTest: (callback) => {
    const listener = (_event, point) => callback(point);
    ipcRenderer.on("desktop:probe-hit-test", listener);
    return () => ipcRenderer.removeListener("desktop:probe-hit-test", listener);
  },
  requestStop: () => ipcRenderer.invoke("desktop:request-stop"),
});
