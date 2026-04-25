"use strict";

const { app, safeStorage } = require("electron");
const fs   = require("fs");
const path = require("path");

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function load() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); }
  catch { return {}; }
}

function save(data) {
  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function getSettings() {
  const s = load();
  return {
    // AI provider
    provider:        s.provider        || "anthropic",
    anthropic_model: s.anthropic_model || "claude-opus-4-7",
    openai_model:    s.openai_model    || "gpt-4o",
    anthropic_has_key: !!s.anthropic_key_enc,
    openai_has_key:    !!s.openai_key_enc,
    // Schedule
    auto_generate:        !!s.auto_generate,
    auto_day:             s.auto_day  !== undefined ? s.auto_day  : 1, // 1 = Monday
    auto_hour:            s.auto_hour !== undefined ? s.auto_hour : 8, // 8 AM local
    last_auto_gen_window: s.last_auto_gen_window || "",
  };
}

function setSettings(updates) {
  const s = load();
  const allowed = [
    "provider", "anthropic_model", "openai_model",
    "auto_generate", "auto_day", "auto_hour", "last_auto_gen_window",
  ];
  for (const k of allowed) {
    if (updates[k] !== undefined) s[k] = updates[k];
  }
  save(s);
  return getSettings();
}

function getApiKey(provider) {
  const s   = load();
  const enc = s[`${provider}_key_enc`];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, "base64")); }
  catch { return null; }
}

function setApiKey(provider, key) {
  const s = load();
  if (key) {
    s[`${provider}_key_enc`] = safeStorage.encryptString(key).toString("base64");
  } else {
    delete s[`${provider}_key_enc`];
  }
  save(s);
  return getSettings();
}

module.exports = { getSettings, setSettings, getApiKey, setApiKey };
