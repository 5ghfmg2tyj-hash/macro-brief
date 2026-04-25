"use strict";

const { app, BrowserWindow, protocol, net, ipcMain, Notification } = require("electron");
const path = require("path");
const fs   = require("fs");
const { pathToFileURL } = require("url");
const fetchLive     = require("./fetch-live");
const settingsStore = require("./settings-store");
const generateBrief = require("./generate-brief");

const DOCS_ROOT = path.join(__dirname, "..", "docs"); // read-only bundle
let   USER_DOCS = null;                               // set after app ready

const MIME_MAP = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".md":   "text/markdown",
  ".webmanifest": "application/manifest+json",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app",      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: "app-data", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let mainWindow    = null;
let fetchTimer    = null;
let scheduleTimer = null;

// ---------- window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    title: "Macro Brief",
    icon: path.join(__dirname, "icon.icns"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadURL("app://bundle/index.html");
  mainWindow.on("closed", () => { mainWindow = null; });
}

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
}

// ---------- live data fetch ----------

async function runFetch() {
  const historyPath = path.join(DOCS_ROOT, "data", "history.json");
  const outPath     = path.join(app.getPath("userData"), "live.json");
  try {
    await fetchLive.run({ historyPath, outPath });
    if (mainWindow) mainWindow.webContents.send("live-updated");
  } catch (err) {
    console.error("fetch-live error:", err.message);
  }
}

// ---------- brief generation (shared by manual IPC + auto-scheduler) ----------

async function doBriefGeneration() {
  const settings = settingsStore.getSettings();
  const provider = settings.provider;
  const model    = provider === "anthropic" ? settings.anthropic_model : settings.openai_model;
  const apiKey   = settingsStore.getApiKey(provider);

  if (!apiKey) throw new Error(`No API key saved for ${provider}. Go to Settings to add one.`);

  const liveJsonPath = path.join(app.getPath("userData"), "live.json");
  if (!fs.existsSync(liveJsonPath)) {
    throw new Error("Live market data not yet available. Wait for the initial fetch to complete.");
  }

  const liveJson    = JSON.parse(fs.readFileSync(liveJsonPath, "utf8"));
  const userHistPath   = path.join(USER_DOCS, "data", "history.json");
  const bundleHistPath = path.join(DOCS_ROOT, "data", "history.json");
  const historyJson    = JSON.parse(fs.readFileSync(
    fs.existsSync(userHistPath) ? userHistPath : bundleHistPath, "utf8"
  ));

  const onStatus = (msg) => { if (mainWindow) mainWindow.webContents.send("brief-status", msg); };
  return generateBrief.generate({
    docsRoot: DOCS_ROOT, userDocsRoot: USER_DOCS,
    liveJson, historyJson, provider, model, apiKey, onStatus,
  });
}

// ---------- scheduler ----------

async function runAutoGenerate() {
  console.log("Auto-generate: starting…");
  try {
    // Fresh live data first
    await runFetch();
    const result = await doBriefGeneration();
    console.log("Auto-generate: done →", result.slug);

    const n = new Notification({
      title: "Macro Brief",
      body:  `${result.title} is ready.`,
    });
    n.on("click", showWindow);
    n.show();

    if (mainWindow) mainWindow.webContents.send("brief-generated", result);
  } catch (err) {
    console.error("Auto-generate failed:", err.message);
    const n = new Notification({
      title: "Macro Brief — generation failed",
      body:  err.message,
    });
    n.on("click", showWindow);
    n.show();
  }
}

function checkSchedule() {
  const s = settingsStore.getSettings();
  if (!s.auto_generate) return;

  const now = new Date();
  if (now.getDay()   !== s.auto_day)  return;
  if (now.getHours() !== s.auto_hour) return;
  if (now.getMinutes() > 5)          return; // only trigger in the first 5 min of the hour

  // Deduplicate: only once per scheduled window
  const window = `${now.toISOString().slice(0, 10)}T${String(s.auto_hour).padStart(2, "0")}`;
  if (s.last_auto_gen_window === window) return;

  settingsStore.setSettings({ last_auto_gen_window: window });
  runAutoGenerate();
}

function startScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = setInterval(checkSchedule, 60 * 1000); // check every minute
  checkSchedule(); // also check immediately on start
}

// ---------- protocol handlers ----------

function handleAppProtocol(request) {
  const url = new URL(request.url);
  let rel   = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";

  const userPath   = path.join(USER_DOCS,  rel);
  const bundlePath = path.join(DOCS_ROOT,  rel);
  const filePath   = (USER_DOCS && fs.existsSync(userPath)) ? userPath : bundlePath;
  const mime       = MIME_MAP[path.extname(filePath).toLowerCase()] || "application/octet-stream";

  return net.fetch(pathToFileURL(filePath).toString())
    .then((r) => new Response(r.body, {
      status: r.status,
      headers: { ...Object.fromEntries(r.headers), "Content-Type": mime, "Access-Control-Allow-Origin": "*" },
    }))
    .catch(() => new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }));
}

function handleAppDataProtocol(request) {
  const url      = new URL(request.url);
  let rel        = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/live.json";
  const filePath = path.join(app.getPath("userData"), rel);
  const mime     = MIME_MAP[path.extname(filePath).toLowerCase()] || "application/json";

  return net.fetch(pathToFileURL(filePath).toString())
    .then((r) => new Response(r.body, {
      status: r.status,
      headers: { ...Object.fromEntries(r.headers), "Content-Type": mime, "Access-Control-Allow-Origin": "*" },
    }))
    .catch(() => new Response(
      JSON.stringify({ error: "live.json not yet available" }),
      { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    ));
}

// ---------- IPC ----------

ipcMain.handle("settings:get",     ()              => settingsStore.getSettings());
ipcMain.handle("settings:set",     (_e, updates)   => settingsStore.setSettings(updates));
ipcMain.handle("settings:set-key", (_e, { provider, key }) => settingsStore.setApiKey(provider, key || null));

ipcMain.handle("schedule:get-login-item", () => app.getLoginItemSettings());
ipcMain.handle("schedule:set-login-item", (_e, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: enable });
  return app.getLoginItemSettings();
});

ipcMain.handle("brief:generate", async () => {
  const result = await doBriefGeneration();
  if (mainWindow) mainWindow.webContents.send("brief-generated", result);
  return result;
});

// ---------- app lifecycle ----------

app.whenReady().then(() => {
  USER_DOCS = path.join(app.getPath("userData"), "docs");

  protocol.handle("app",      handleAppProtocol);
  protocol.handle("app-data", handleAppDataProtocol);

  // Don't show a window when launched as a hidden login item
  const { wasOpenedAsHidden } = app.getLoginItemSettings();
  if (!wasOpenedAsHidden) createWindow();

  runFetch();
  fetchTimer = setInterval(runFetch, 30 * 60 * 1000);
  startScheduler();

  app.on("activate", showWindow);
});

app.on("window-all-closed", () => {
  // On macOS, keep the process alive when auto-generate is on so the scheduler
  // can fire even with no windows open.
  const { auto_generate } = settingsStore.getSettings();
  if (process.platform !== "darwin" || !auto_generate) {
    if (fetchTimer)    clearInterval(fetchTimer);
    if (scheduleTimer) clearInterval(scheduleTimer);
    app.quit();
  }
});
