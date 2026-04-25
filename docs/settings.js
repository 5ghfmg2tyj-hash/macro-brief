// Settings tab — provider, model, API key, and schedule configuration.

(function () {
  if (!window.macroBrief || !window.macroBrief.isElectron) return;

  const MODELS = {
    anthropic: [
      { value: "claude-opus-4-7",          label: "Claude Opus 4 (most capable)" },
      { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4 (fast)" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4 (fastest)" },
    ],
    openai: [
      { value: "gpt-4o",      label: "GPT-4o (recommended)" },
      { value: "gpt-4o-mini", label: "GPT-4o mini (fast)" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    ],
  };

  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  let current = {};

  // --- elements ---
  const providerSeg       = document.getElementById("provider-seg");
  const modelSelect       = document.getElementById("model-select");
  const keyLabel          = document.getElementById("key-label");
  const keyStatus         = document.getElementById("key-status");
  const keyInput          = document.getElementById("api-key-input");
  const keyShowBtn        = document.getElementById("key-show-btn");
  const keySaveBtn        = document.getElementById("key-save-btn");
  const keyClearBtn       = document.getElementById("key-clear-btn");
  const autoToggle        = document.getElementById("auto-generate-toggle");
  const autoLabel         = document.getElementById("auto-generate-label");
  const scheduleOptions   = document.getElementById("schedule-options");
  const autoDaySelect     = document.getElementById("auto-day-select");
  const autoHourSelect    = document.getElementById("auto-hour-select");
  const nextRunLabel      = document.getElementById("next-run-label");
  const loginItemToggle   = document.getElementById("login-item-toggle");

  // --- populate hour dropdown ---
  for (let h = 0; h < 24; h++) {
    const ampm  = h < 12 ? "AM" : "PM";
    const h12   = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const label = `${h12}:00 ${ampm}`;
    autoHourSelect.appendChild(Object.assign(document.createElement("option"), { value: h, textContent: label }));
  }

  // --- helpers ---
  function renderModels(provider) {
    modelSelect.innerHTML = MODELS[provider]
      .map(m => `<option value="${m.value}">${m.label}</option>`).join("");
    const saved = provider === "anthropic" ? current.anthropic_model : current.openai_model;
    if (saved) modelSelect.value = saved;
  }

  function renderKeyStatus(s) {
    const hasKey = s.provider === "anthropic" ? s.anthropic_has_key : s.openai_has_key;
    keyStatus.textContent = hasKey ? "Key saved ✓" : "Not set";
    keyStatus.className   = "key-status " + (hasKey ? "saved" : "unset");
    keyLabel.textContent  = s.provider === "anthropic" ? "Anthropic API key" : "OpenAI API key";
    keyInput.value        = "";
    keyInput.placeholder  = hasKey ? "Enter new key to replace…" : "Paste API key here…";
  }

  function renderProvider(provider) {
    providerSeg.querySelectorAll(".seg-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.value === provider);
    });
    renderModels(provider);
  }

  function computeNextRun(day, hour) {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    const daysUntil = (day - now.getDay() + 7) % 7 || (now.getHours() >= hour ? 7 : 0);
    next.setDate(next.getDate() + daysUntil);
    return next.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) +
           " at " + next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function renderSchedule(s) {
    autoToggle.checked        = !!s.auto_generate;
    autoLabel.textContent     = s.auto_generate ? "On" : "Off";
    scheduleOptions.hidden    = !s.auto_generate;
    autoDaySelect.value       = String(s.auto_day);
    autoHourSelect.value      = String(s.auto_hour);
    nextRunLabel.textContent  = s.auto_generate
      ? computeNextRun(s.auto_day, s.auto_hour) : "—";
  }

  async function load() {
    try {
      current = await window.macroBrief.settings.get();
      renderProvider(current.provider);
      renderKeyStatus(current);
      renderSchedule(current);
    } catch (e) { console.error("Settings load:", e); }

    try {
      const li = await window.macroBrief.schedule.getLoginItem();
      loginItemToggle.checked = !!(li.openAtLogin);
    } catch {}
  }

  // --- provider toggle ---
  providerSeg.addEventListener("click", async (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    current = await window.macroBrief.settings.set({ provider: btn.dataset.value });
    renderProvider(current.provider);
    renderKeyStatus(current);
  });

  // --- model change ---
  modelSelect.addEventListener("change", async () => {
    const key = current.provider === "anthropic" ? "anthropic_model" : "openai_model";
    current = await window.macroBrief.settings.set({ [key]: modelSelect.value });
  });

  // --- show/hide key ---
  keyShowBtn.addEventListener("click", () => {
    const show = keyInput.type === "password";
    keyInput.type = show ? "text" : "password";
    keyShowBtn.textContent = show ? "Hide" : "Show";
  });

  // --- save key ---
  keySaveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) { keyInput.focus(); return; }
    keySaveBtn.disabled = true;
    keySaveBtn.textContent = "Saving…";
    try {
      current = await window.macroBrief.settings.setKey(current.provider, key);
      renderKeyStatus(current);
    } catch (e) { alert("Failed to save key: " + e.message); }
    finally { keySaveBtn.disabled = false; keySaveBtn.textContent = "Save key"; }
  });

  // --- clear key ---
  keyClearBtn.addEventListener("click", async () => {
    if (!confirm(`Clear the saved ${current.provider} API key?`)) return;
    try {
      current = await window.macroBrief.settings.setKey(current.provider, "");
      renderKeyStatus(current);
    } catch (e) { alert("Failed to clear key: " + e.message); }
  });

  // --- auto-generate toggle ---
  autoToggle.addEventListener("change", async () => {
    current = await window.macroBrief.settings.set({ auto_generate: autoToggle.checked });
    renderSchedule(current);
  });

  // --- day / hour change ---
  autoDaySelect.addEventListener("change", async () => {
    current = await window.macroBrief.settings.set({ auto_day: Number(autoDaySelect.value) });
    renderSchedule(current);
  });
  autoHourSelect.addEventListener("change", async () => {
    current = await window.macroBrief.settings.set({ auto_hour: Number(autoHourSelect.value) });
    renderSchedule(current);
  });

  // --- login item toggle ---
  loginItemToggle.addEventListener("change", async () => {
    try {
      await window.macroBrief.schedule.setLoginItem(loginItemToggle.checked);
    } catch (e) {
      alert("Failed to update login item: " + e.message);
      loginItemToggle.checked = !loginItemToggle.checked;
    }
  });

  // --- load when Settings tab is opened ---
  document.querySelectorAll(".tab[data-tab='settings']").forEach(t =>
    t.addEventListener("click", load)
  );
  load();
})();
