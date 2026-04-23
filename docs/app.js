// ==============================================================================
// app.js — wire up tabs, data loading, live-data grid, and brief reader.
// ==============================================================================

(function () {
  const state = {
    history: null,
    flows: null,
    briefs: null,      // { briefs: [{ slug, title, date }...] }
    liveLoaded: false
  };

  // ---------- tabs ----------
  function initTabs() {
    const tabs   = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".tab-panel");
    tabs.forEach(t => {
      t.addEventListener("click", () => {
        const key = t.dataset.tab;
        tabs.forEach(x => x.classList.toggle("active", x === t));
        panels.forEach(p => p.classList.toggle("active", p.id === `tab-${key}`));

        // lazy-load live data on first visit
        if (key === "live" && !state.liveLoaded) refreshLive();
      });
    });
  }

  // ---------- data load ----------
  async function loadJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadAll() {
    try {
      const [history, flows] = await Promise.all([
        loadJSON("data/history.json"),
        loadJSON("data/flows.json")
      ]);
      state.history = history;
      state.flows   = flows;
      window.Chart.init({ history, flows });
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

  // ---------- live data ----------
  async function refreshLive() {
    if (!state.history) return;
    state.liveLoaded = true;
    const grid = document.getElementById("live-grid");
    const status = document.getElementById("live-status");
    const btn = document.getElementById("refresh-live");
    btn.disabled = true;
    status.textContent = "Fetching…";
    grid.innerHTML = state.history.assets.map(a =>
      `<div class="live-card" id="live-${a.key}">
        <div class="live-label">${a.label}</div>
        <div class="live-idx">${a.idx}</div>
        <div class="live-val muted">Loading…</div>
        <div class="live-meta"><span>&nbsp;</span><span>&nbsp;</span></div>
      </div>`
    ).join("");

    let done = 0;
    await window.Live.fetchAll(state.history.assets, (asset, result) => {
      done++;
      status.textContent = `Fetching… ${done}/${state.history.assets.length}`;
      renderLiveCard(asset, result);
    });
    status.textContent = "";
    btn.disabled = false;
    document.getElementById("live-ts").textContent = new Date().toLocaleString();
  }

  function renderLiveCard(asset, result) {
    const card = document.getElementById(`live-${asset.key}`);
    if (!card) return;
    if (result.err) {
      card.classList.add("err");
      card.innerHTML = `
        <div class="live-label">${asset.label}</div>
        <div class="live-idx">${asset.idx}</div>
        <div class="live-val">Error</div>
        <div class="live-meta"><span>${result.err}</span></div>`;
      return;
    }
    const fmtValue = v => formatLiveValue(v, asset.unit);
    const histLast = asset.vals[asset.vals.length - 1];
    const delta = histLast ? ((result.value - histLast) / histLast * 100).toFixed(2) : null;
    const dCls  = delta === null ? "" : (parseFloat(delta) > 0 ? "delta-up" : "delta-dn");

    card.classList.remove("err");
    card.innerHTML = `
      <div class="live-label">${asset.label}</div>
      <div class="live-idx">${asset.idx}</div>
      <div class="live-val">${fmtValue(result.value)}</div>
      <div class="live-meta">
        <span>${result.asOf || "—"} · ${result.source || ""}</span>
        <span class="${dCls}">${delta !== null ? (parseFloat(delta) > 0 ? "+" : "") + delta + "% vs last brief" : ""}</span>
      </div>`;
  }

  function formatLiveValue(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    switch (unit) {
      case "pts": return Math.round(v).toLocaleString("en-US");
      case "usd": return "$" + v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 });
      case "bbl": return "$" + v.toFixed(v < 100 ? 2 : 0) + "/bbl";
      case "oz":  return "$" + Math.round(v).toLocaleString("en-US") + "/oz";
      case "bps": return Math.round(v) + " bps";
      case "pct": return v.toFixed(2) + "%";
      default:    return String(v);
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
    document.getElementById("brief-sub").textContent   = b.date || "";
    try {
      const r = await fetch(`briefs/${b.slug}.md`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const md = await r.text();
      document.getElementById("brief-body").innerHTML = renderMarkdown(md);
    } catch (e) {
      document.getElementById("brief-body").innerHTML =
        `<div class="muted">Failed to load brief: ${e.message}</div>`;
    }
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

  // ---------- bootstrap ----------
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    document.getElementById("refresh-live").addEventListener("click", refreshLive);
    loadAll();
  });
})();
