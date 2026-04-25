"use strict";

const { contextBridge, ipcRenderer, app } = require("electron");

contextBridge.exposeInMainWorld("macroBrief", {
  isElectron:    true,
  version:       require("../package.json").version,
  dailyFlowsUrl: "app-data://data/daily-flows.json",
  liveDataUrl: "app-data://data/live.json",

  onLiveUpdate:     (cb) => ipcRenderer.on("live-updated",    ()         => cb()),
  onBriefGenerated: (cb) => ipcRenderer.on("brief-generated", (_e, res)  => cb(res)),
  onBriefStatus:    (cb) => ipcRenderer.on("brief-status",    (_e, msg)  => cb(msg)),

  settings: {
    get:    ()              => ipcRenderer.invoke("settings:get"),
    set:    (updates)       => ipcRenderer.invoke("settings:set", updates),
    setKey: (provider, key) => ipcRenderer.invoke("settings:set-key", { provider, key }),
  },

  schedule: {
    getLoginItem: ()       => ipcRenderer.invoke("schedule:get-login-item"),
    setLoginItem: (enable) => ipcRenderer.invoke("schedule:set-login-item", enable),
  },

  generateBrief: () => ipcRenderer.invoke("brief:generate"),
});
