// src/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ai", {
  runGoal(goal) {
    return ipcRenderer.invoke("ai:runGoal", goal);
  },
  runSteps(steps) {
    return ipcRenderer.invoke("ai:runSteps", steps);
  }
});
