// ==============================================================================
// app.js — wire up tabs, data loading, live-data grid, and brief reader.
// ==============================================================================

(function () {
  const isElectron = !!window.macroBrief?.isElectron;
  const vEl = document.getElementById("app-version");
  if (vEl && window.macroBrief?.version) vEl.textContent = `v${window.macroBrief.version}`;

  const state = {
    history:       null,
    flows:         null,
    dailyFlows:    null,
    live:          null,
    sharesHistory: null,
    briefs:        null,  // { briefs: [{ slug, title, date }...] }
  };

  const FLOW_ROWS = [
    { key: "usLarge",  label: "US Large Cap",            vehicle: "SPY+IVV+VOO", etfs: ["SPY", "IVV", "VOO"] },
    { key: "usSmid",   label: "US Small/Mid Cap",        vehicle: "IWM",         etfs: ["IWM"] },
    { key: "intlDev",  label: "International Dev",       vehicle: "EFA",         etfs: ["EFA"] },
    { key: "em",       label: "Emerging Markets",        vehicle: "EEM",         etfs: ["EEM"] },
    { key: "gold",     label: "Gold",                    vehicle: "GLD",         etfs: ["GLD"] },
    { key: "commod",   label: "Commodities (Oil/Cu)",    vehicle: "—",           etfs: [] },
    { key: "bitcoin",  label: "Bitcoin / Crypto",        vehicle: "IBIT+FBTC",   etfs: ["IBIT", "FBTC"] },
    { key: "ig",       label: "IG Bonds",                vehicle: "LQD",         etfs: ["LQD"] },
    { key: "hy",       label: "High Yield Bonds",        vehicle: "HYG+JNK",     etfs: ["HYG", "JNK"] },
    { key: "treas",    label: "Intermediate Treasuries", vehicle: "IEF+TLT",     etfs: ["IEF", "TLT"] },
    { key: "cash",     label: "Cash / Short Duration",   vehicle: "SGOV+BIL",    etfs: ["SGOV", "BIL"] },
  ];

  // ---------- tabs ----------
  function initTabs() {
    const tabs   = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".tab-panel");
    tabs.forEach(t => {
      t.addEventListener("click", () => {
        const key = t.dataset.tab;
        tabs.forEach(x => x.classList.toggle("active", x === t));
        panels.forEach(p => p.classList.toggle("active", p.id === `tab-${key}`));

      });
    });
  }

  // ---------- data load ----------
  async function loadJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadDailyFlows() {
    const url = window.macroBrief?.dailyFlowsUrl || "data/daily-flows.json";
    try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? r.json() : null; }
    catch { return null; }
  }

  async function loadLiveData() {
    try { return await window.Live.load(); }
    catch { return null; }
  }

  async function loadSharesHistory() {
    const url = window.macroBrief?.sharesHistoryUrl || "data/shares-history.json";
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? r.json() : null;
    } catch {
      return null;
    }
  }

  async function reloadRuntimeData() {
    const [dailyFlows, live, sharesHistory] = await Promise.all([
      loadDailyFlows(),
      loadLiveData(),
      loadSharesHistory(),
    ]);
    state.dailyFlows = dailyFlows;
    state.live = live;
    state.sharesHistory = sharesHistory;
  }

  async function loadAll() {
    try {
      const [history, flows] = await Promise.all([
        loadJSON("data/history.json"),
        loadJSON("data/flows.json"),
      ]);
      state.history    = history;
      state.flows      = flows;
      await reloadRuntimeData();
      window.Chart.init({ history, flows, dailyFlows: state.dailyFlows });
      renderFlowSnapshot();
    } catch (e) {
      document.getElementById("subtitle").textContent =
        "Failed to load data: " + e.message;
    }

    try {
      state.briefs = await loadJSON("briefs/index.json");
      loadLatestBrief();
      renderBriefHistory();
    } catch (e) {
      document.getElementById("brief-body").innerHTML =
        `<div class="muted">Failed to load briefs index: ${e.message}</div>`;
    }
  }

  // ---------- flow snapshot ----------
  function sumDefined(values) {
    let total = 0, hasData = false;
    for (const v of values) {
      if (v == null) continue;
      total += v;
      hasData = true;
    }
    return hasData ? total : null;
  }

  function fmtFlow(v) {
    if (v == null) return "—";
    const b = v / 1e9;
    return `${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(2)}B`;
  }

  function fmtTotal(v) {
    if (v == null) return "—";
    return `${(v / 1e9).toFixed(2)}B`;
  }

  function summarizeDailyFlowSeries(series, today) {
    const todayEntry = series.find((e) => e.date === today);
    const todayMs = new Date(today).getTime();

    function sumSeriesFlows(key, daysAgo) {
      const cutoff = new Date(todayMs - daysAgo * 86400_000).toISOString().slice(0, 10);
      let total = 0, hasData = false;
      for (const e of series) {
        if (e.date <= cutoff || e.date > today) continue;
        const f = e.flows?.[key];
        if (f != null) {
          total += f;
          hasData = true;
        }
      }
      return hasData ? total * 1e9 : null;
    }

    const summary = {};
    for (const row of FLOW_ROWS) {
      if (row.key === "commod") {
        summary[row.key] = { daily: null, wow: null, mom: null, mo6: null, yoy: null };
        continue;
      }
      const todayFlowB = todayEntry?.flows?.[row.key];
      summary[row.key] = {
        daily: todayFlowB != null ? todayFlowB * 1e9 : null,
        wow:   sumSeriesFlows(row.key, 7),
        mom:   sumSeriesFlows(row.key, 30),
        mo6:   sumSeriesFlows(row.key, 182),
        yoy:   sumSeriesFlows(row.key, 365),
      };
    }
    return summary;
  }

  function summarizeShareTotals(sharesHistory) {
    if (!sharesHistory || typeof sharesHistory !== "object") return null;

    function pickEntries(entries) {
      if (!Array.isArray(entries) || !entries.length) return { current: null, previous: null };
      const sorted = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        current: sorted[sorted.length - 1] || null,
        previous: sorted.length > 1 ? sorted[sorted.length - 2] : null,
      };
    }

    const summary = {};
    for (const row of FLOW_ROWS) {
      if (!row.etfs.length) {
        summary[row.key] = { currentTotal: null, previousTotal: null };
        continue;
      }

      let currentTotal = 0, previousTotal = 0;
      let hasCurrent = false, hasPrevious = false;
      for (const sym of row.etfs) {
        const { current, previous } = pickEntries(sharesHistory[sym]);
        if (current?.shares != null && current?.price != null) {
          currentTotal += current.shares * current.price;
          hasCurrent = true;
        }
        if (previous?.shares != null && previous?.price != null) {
          previousTotal += previous.shares * previous.price;
          hasPrevious = true;
        }
      }

      summary[row.key] = {
        currentTotal: hasCurrent ? currentTotal : null,
        previousTotal: hasPrevious ? previousTotal : null,
      };
    }

    return summary;
  }

  function buildFlowNote(summary) {
    if (!summary) {
      return "Fund flow data is unavailable right now.";
    }

    const rows = Object.values(summary);
    const hasDaily = rows.some((f) => f?.daily != null);
    const hasHistorical = rows.some((f) => f?.wow != null || f?.mom != null || f?.mo6 != null || f?.yoy != null);

    if (hasHistorical && !hasDaily) {
      return "Daily share-change flow is still initializing. Historical windows are available from the cached flow series.";
    }

    if (!hasHistorical && !hasDaily) {
      return "Fund flow history is unavailable right now.";
    }

    return "";
  }

  function renderFlowSnapshot() {
    const wrap = document.getElementById("flow-snapshot");
    const tsEl = document.getElementById("flow-ts");
    if (!wrap || !tsEl) return;

    const series = state.dailyFlows?.series;
    const latestDate = Array.isArray(series) && series.length ? series[series.length - 1].date : null;
    const summary = latestDate ? summarizeDailyFlowSeries(series, latestDate) : null;
    const totalsByRow = summarizeShareTotals(state.sharesHistory);
    const note = buildFlowNote(summary);
    const total = summary ? {
      currentTotal: sumDefined(FLOW_ROWS.map((r) => totalsByRow?.[r.key]?.currentTotal ?? null)),
      previousTotal: sumDefined(FLOW_ROWS.map((r) => totalsByRow?.[r.key]?.previousTotal ?? null)),
      daily: sumDefined(FLOW_ROWS.map((r) => summary[r.key]?.daily ?? null)),
      wow:   sumDefined(FLOW_ROWS.map((r) => summary[r.key]?.wow ?? null)),
      mom:   sumDefined(FLOW_ROWS.map((r) => summary[r.key]?.mom ?? null)),
      mo6:   sumDefined(FLOW_ROWS.map((r) => summary[r.key]?.mo6 ?? null)),
      yoy:   sumDefined(FLOW_ROWS.map((r) => summary[r.key]?.yoy ?? null)),
    } : null;

    const updatedAt = state.dailyFlows?.updatedAt || state.live?.fetchedAt || null;
    const updatedTs = updatedAt ? new Date(updatedAt) : null;
    tsEl.textContent = updatedTs && !isNaN(updatedTs) ? updatedTs.toLocaleString() : "—";

    if (!summary) {
      wrap.innerHTML = '<div class="muted">No flow data is available yet.</div>';
      return;
    }

    wrap.innerHTML = `
      ${note ? `<div class="snapshot-note">${note}</div>` : ""}
      <div class="snapshot-table-wrap">
        <table class="snapshot-table">
          <thead>
            <tr>
              <th>Asset Class</th>
              <th>Vehicle</th>
              <th>Current Total</th>
              <th>Yesterday Total</th>
              <th>DoD</th>
              <th>WoW</th>
              <th>MoM</th>
              <th>6M</th>
              <th>YoY</th>
            </tr>
          </thead>
          <tbody>
            ${FLOW_ROWS.map((row) => {
              const flow = summary[row.key] || {};
              const totals = totalsByRow?.[row.key] || {};
              return `<tr>
                <td>${row.label}</td>
                <td>${row.vehicle}</td>
                <td>${fmtTotal(totals.currentTotal)}</td>
                <td>${fmtTotal(totals.previousTotal)}</td>
                <td>${fmtFlow(flow.daily)}</td>
                <td>${fmtFlow(flow.wow)}</td>
                <td>${fmtFlow(flow.mom)}</td>
                <td>${fmtFlow(flow.mo6)}</td>
                <td>${fmtFlow(flow.yoy)}</td>
              </tr>`;
            }).join("")}
            <tr class="snapshot-total">
              <td><strong>Total</strong></td>
              <td>—</td>
              <td><strong>${fmtTotal(total.currentTotal)}</strong></td>
              <td><strong>${fmtTotal(total.previousTotal)}</strong></td>
              <td><strong>${fmtFlow(total.daily)}</strong></td>
              <td><strong>${fmtFlow(total.wow)}</strong></td>
              <td><strong>${fmtFlow(total.mom)}</strong></td>
              <td><strong>${fmtFlow(total.mo6)}</strong></td>
              <td><strong>${fmtFlow(total.yoy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  async function refreshCurrentData() {
    const btn = document.getElementById("refresh-current-data");
    const status = document.getElementById("flow-refresh-status");
    if (!btn || !status) return;

    btn.disabled = true;
    status.textContent = "Refreshing…";
    status.classList.remove("error", "ok");

    try {
      if (window.macroBrief?.refreshLiveData) {
        await window.macroBrief.refreshLiveData();
      }
      await reloadRuntimeData();
      renderFlowSnapshot();
      window.Chart.init({ history: state.history, flows: state.flows, dailyFlows: state.dailyFlows });
      status.textContent = isElectron ? "Current data refreshed ✓" : "Published data reloaded ✓";
      status.classList.add("ok");
      setTimeout(() => {
        if (status.textContent === "Current data refreshed ✓" || status.textContent === "Published data reloaded ✓") {
          status.textContent = "";
          status.classList.remove("ok");
        }
      }, 4000);
    } catch (e) {
      status.textContent = "Error: " + (e.message || String(e));
      status.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- briefs ----------
  async function loadLatestBrief() {
    if (!state.briefs || !state.briefs.briefs?.length) {
      document.getElementById("brief-body").innerHTML =
        '<div class="muted">No briefs available yet.</div>';
      return;
    }
    const latest = state.briefs.briefs[0];
    await loadBrief(latest);
  }

  async function loadBrief(b) {
    document.getElementById("brief-title").textContent = b.title || b.slug;
    const subEl = document.getElementById("brief-sub");
    const subParts = [];
    if (b.date) subParts.push(b.date);
    if (b.generatedAt) {
      const ts = new Date(b.generatedAt);
      if (!isNaN(ts)) subParts.push(`Refreshed ${ts.toLocaleString()}`);
    }
    subEl.textContent = subParts.join(" • ");
    try {
      const r = await fetch(`briefs/${b.slug}.md`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (!b.generatedAt) {
        const lastModified = r.headers.get("last-modified");
        if (lastModified) {
          const ts = new Date(lastModified);
          if (!isNaN(ts)) {
            const parts = [];
            if (b.date) parts.push(b.date);
            parts.push(`Refreshed ${ts.toLocaleString()}`);
            subEl.textContent = parts.join(" • ");
          }
        }
      }
      const md = stripLeadingSnapshotSection(await r.text());
      document.getElementById("brief-body").innerHTML = renderMarkdown(md);
    } catch (e) {
      document.getElementById("brief-body").innerHTML =
        `<div class="muted">Failed to load brief: ${e.message}</div>`;
    }
  }

  function stripLeadingSnapshotSection(markdown) {
    if (!markdown) return "";
    const patterns = [
      /^##\s+Money Flow Snapshot[\s\S]*?(?=^##\s|\Z)/m,
      /^##\s+1\.\s+Market Snapshot[\s\S]*?(?=^##\s|\Z)/m,
      /^##\s+Market Snapshot[\s\S]*?(?=^##\s|\Z)/m,
    ];

    let out = markdown.trim();
    for (const pattern of patterns) {
      out = out.replace(pattern, "").trim();
    }
    return out;
  }

  function renderBriefHistory() {
    const ul = document.getElementById("brief-history");
    if (!ul || !state.briefs) return;
    ul.innerHTML = state.briefs.briefs.map(b => `
      <li>
        <a href="#" data-slug="${b.slug}">${b.title || b.slug}</a>
        <span class="muted">${b.date || ""}</span>
      </li>`).join("");
    ul.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const slug = a.dataset.slug;
        const b = state.briefs.briefs.find(x => x.slug === slug);
        if (b) loadBrief(b);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  // ---------- minimal markdown ----------
  // Supports: headings, paragraphs, bold/italic, inline code, code fences,
  // unordered + ordered lists, blockquotes, links, horizontal rules, tables.
  function renderMarkdown(md) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = s => s
      .replace(/`([^`]+)`/g, (_, t) => `<code>${esc(t)}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const lines = md.split(/\r?\n/);
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const ln = lines[i];

      // fenced code
      if (/^```/.test(ln)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        i++; // consume closing fence
        out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
        continue;
      }

      // horizontal rule
      if (/^\s*---+\s*$/.test(ln)) { out.push("<hr/>"); i++; continue; }

      // heading
      const h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { const n = h[1].length; out.push(`<h${n}>${inline(esc(h[2]))}</h${n}>`); i++; continue; }

      // blockquote
      if (/^>\s?/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
        out.push(`<blockquote>${inline(esc(buf.join(" ")))}</blockquote>`);
        continue;
      }

      // table (very light detection: a line then a --- separator)
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i+1])) {
        const headers = ln.trim().slice(1, -1).split("|").map(s => s.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().slice(1, -1).split("|").map(s => s.trim()));
          i++;
        }
        out.push(
          "<table><thead><tr>" +
          headers.map(h => `<th>${inline(esc(h))}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows.map(r => "<tr>" + r.map(c => `<td>${inline(esc(c))}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>"
        );
        continue;
      }

      // unordered list
      if (/^\s*[-*]\s+/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*[-*]\s+/, ""));
          i++;
        }
        out.push("<ul>" + buf.map(x => `<li>${inline(esc(x))}</li>`).join("") + "</ul>");
        continue;
      }

      // ordered list
      if (/^\s*\d+\.\s+/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        out.push("<ol>" + buf.map(x => `<li>${inline(esc(x))}</li>`).join("") + "</ol>");
        continue;
      }

      // blank line -> paragraph break
      if (/^\s*$/.test(ln)) { i++; continue; }

      // paragraph (collect until blank / block)
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>\s?|```|[-*]\s|\d+\.\s|\s*---+\s*$)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.length) out.push(`<p>${inline(esc(buf.join(" ")))}</p>`);
    }

    return out.join("\n");
  }

  // ---------- generate brief ----------
  async function generateBrief() {
    const btn    = document.getElementById("generate-brief-btn");
    const status = document.getElementById("generate-status");

    btn.disabled = true;
    const setStatus = (msg) => {
      status.className = "generate-status";
      status.innerHTML = `<div class="spinner"></div> ${msg}`;
    };
    setStatus("Generating — this takes 30–60 seconds…");

    try {
      await window.macroBrief.generateBrief();
      // brief-generated IPC event triggers reloadAfterGeneration
    } catch (e) {
      status.className   = "generate-status error";
      status.textContent = "Error: " + (e.message || String(e));
      btn.disabled = false;
    }
  }

  // Live status updates from main process (e.g. retry countdown)
  if (window.macroBrief?.onBriefStatus) {
    window.macroBrief.onBriefStatus((msg) => {
      const status = document.getElementById("generate-status");
      if (status && status.classList.contains("generate-status") && !status.classList.contains("error") && !status.classList.contains("ok")) {
        status.innerHTML = `<div class="spinner"></div> ${msg}`;
      }
    });
  }

  async function reloadAfterGeneration(result) {
    const btn    = document.getElementById("generate-brief-btn");
    const status = document.getElementById("generate-status");

    // Reload briefs index and chart data
    try {
      const [history, flows] = await Promise.all([
        loadJSON("data/history.json"),
        loadJSON("data/flows.json"),
      ]);
      state.history    = history;
      state.flows      = flows;
      await reloadRuntimeData();
      window.Chart.init({ history, flows, dailyFlows: state.dailyFlows });
      renderFlowSnapshot();
    } catch {}

    try {
      state.briefs = await loadJSON("briefs/index.json");
      renderBriefHistory();
      if (result) {
        const b = state.briefs.briefs.find(x => x.slug === result.slug);
        if (b) loadBrief(b);
      } else {
        loadLatestBrief();
      }
    } catch {}

    status.className   = "generate-status ok";
    status.textContent = "Brief generated ✓";
    btn.disabled = false;
    setTimeout(() => { if (status.textContent === "Brief generated ✓") status.textContent = ""; }, 4000);
  }

  // ---------- bootstrap ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (!isElectron) {
      document.querySelectorAll("[data-desktop-only]").forEach((el) => { el.hidden = true; });
      document.querySelectorAll(".tab[data-tab='settings']").forEach((el) => { el.hidden = true; });
      const aboutSubtitle = document.querySelector("#tab-about .subtitle");
      if (aboutSubtitle) aboutSubtitle.textContent = "Shared web app for published macro briefs, allocation history, and money flow snapshots.";
      const aboutHow = document.querySelector("#tab-about .panel p");
      if (aboutHow) aboutHow.textContent = "This hosted viewer reads pre-published market data and briefs generated by a trusted publisher account. End users do not need API keys.";
      const noteItems = document.querySelectorAll("#tab-snapshot .notes li");
      if (noteItems[2]) noteItems[2].innerHTML = "The <strong>Refresh</strong> button reloads the latest published data for viewers.";
    }

    initTabs();
    document.getElementById("refresh-current-data").addEventListener("click", refreshCurrentData);

    const genBtn = document.getElementById("generate-brief-btn");
    if (genBtn) {
      if (isElectron) {
        genBtn.addEventListener("click", generateBrief);
        window.macroBrief.onBriefGenerated((result) => reloadAfterGeneration(result));
        window.macroBrief.onLiveUpdate(async () => {
          await reloadRuntimeData();
          renderFlowSnapshot();
          window.Chart.init({ history: state.history, flows: state.flows, dailyFlows: state.dailyFlows });
        });
      } else {
        genBtn.hidden = true;
      }
    }

    loadAll();
  });
})();
