// ==============================================================================
// chart.js — data-driven version of the Tilt/Flows allocation chart.
//
// Reads history.json + flows.json (already fetched by app.js and passed in).
// Exports window.Chart.init({ history, flows }) -> renders into existing DOM.
// ==============================================================================

(function () {
  let HIST, FLOWS, ASSETS, WEEKS, GROUPS;
  let activeGroup = "all";
  let activeView  = "tilt";
  let visibleAssets = new Set();

  const VIEWS = [
    { key: "tilt",  label: "Tilt (allocation score)" },
    { key: "flows", label: "Flows (weekly net, $B)" }
  ];

  const W = 960, H = 440;
  const M = { t: 24, r: 24, b: 56, l: 90 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  // --------------------- helpers ---------------------
  const xScale = i => M.l + (i / (WEEKS.length - 1)) * iw;

  function flowSeries(a) { return (FLOWS.flows || {})[a.key] || null; }
  function isPlottable(a) {
    return activeView === "tilt" ? true : !!flowSeries(a);
  }
  function seriesFor(a) {
    return activeView === "tilt" ? a.alloc : flowSeries(a);
  }
  function getFlowDomain() {
    const vals = [];
    ASSETS.forEach(a => {
      if (visibleAssets.has(a.key) && flowSeries(a)) vals.push(...flowSeries(a));
    });
    if (vals.length === 0) return [-1, 1];
    const lo = Math.min(...vals, 0);
    const hi = Math.max(...vals, 0);
    const span = hi - lo || 1;
    return [lo - span * 0.08, hi + span * 0.08];
  }
  function yDomain() {
    return activeView === "tilt" ? [-1, 1] : getFlowDomain();
  }
  function yScale(v) {
    const [lo, hi] = yDomain();
    return M.t + ih - ((v - lo) / (hi - lo)) * ih;
  }

  function shortLabel(v) {
    if (v >=  0.99) return "OW (+1)";
    if (v >=  0.4)  return "Sl. OW (+0.5)";
    if (v > -0.4)   return "Neutral (0)";
    if (v > -0.99)  return "Sl. UW (−0.5)";
    return "UW (−1)";
  }
  function scoreLabel(v) {
    if (v >=  0.99) return "OW";
    if (v >=  0.4)  return "Sl. OW";
    if (v > -0.4)   return "Neutral";
    if (v > -0.99)  return "Sl. UW";
    return "UW";
  }

  function fmtFlow(v) {
    if (v === null || v === undefined) return "n/a";
    const sign = v > 0 ? "+" : (v < 0 ? "−" : "");
    const abs = Math.abs(v);
    if (abs >= 10) return `${sign}$${abs.toFixed(1)}B`;
    if (abs >= 1)  return `${sign}$${abs.toFixed(2)}B`;
    return `${sign}$${(abs * 1000).toFixed(0)}M`;
  }
  function fmtVal(v, unit) {
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
  function fmtDelta(cur, ref, unit) {
    if (ref === null || ref === undefined) return { txt: "n/a", cls: "delta-flat" };
    const d = cur - ref;
    const pct = ref !== 0 ? (d / Math.abs(ref)) * 100 : 0;
    if (Math.abs(d) < 1e-9) return { txt: "flat", cls: "delta-flat" };
    const arr = d > 0 ? "▲" : "▼";
    const cls = d > 0 ? "delta-up" : "delta-dn";
    let txt;
    if (unit === "bps" || unit === "pct") {
      const absBps = unit === "pct" ? (d * 100) : d;
      txt = `${arr} ${d>0?"+":""}${absBps.toFixed(0)} bps (${pct>0?"+":""}${pct.toFixed(1)}%)`;
    } else {
      txt = `${arr} ${pct>0?"+":""}${pct.toFixed(1)}%`;
    }
    return { txt, cls };
  }

  function markerPath(shape, x, y, r = 4.2) {
    switch (shape) {
      case "circle":   return `M${x-r},${y} a${r},${r} 0 1 0 ${2*r},0 a${r},${r} 0 1 0 -${2*r},0 Z`;
      case "square":   return `M${x-r},${y-r} h${2*r} v${2*r} h-${2*r} Z`;
      case "triangle": return `M${x},${y-r} L${x+r},${y+r} L${x-r},${y+r} Z`;
      case "diamond":  return `M${x},${y-r} L${x+r},${y} L${x},${y+r} L${x-r},${y} Z`;
      case "star": {
        const pts=[];
        for (let i=0;i<10;i++){
          const a=-Math.PI/2+i*Math.PI/5;
          const rr=i%2 ? r*0.5 : r;
          pts.push([x+Math.cos(a)*rr, y+Math.sin(a)*rr]);
        }
        return "M"+pts.map(p=>p.join(",")).join(" L")+" Z";
      }
      case "x":    return `M${x-r},${y-r} L${x+r},${y+r} M${x+r},${y-r} L${x-r},${y+r}`;
      case "plus": return `M${x-r},${y} L${x+r},${y} M${x},${y-r} L${x},${y+r}`;
    }
  }
  const markerStroke = s => (s === "x" || s === "plus");

  function niceTicks(lo, hi, count = 5) {
    const span = hi - lo;
    if (span === 0) return [lo];
    const rough = span / (count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough))));
    const norm = rough / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks = [];
    const start = Math.ceil(lo / step) * step;
    for (let v = start; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  // --------------------- chips ---------------------
  function buildChips() {
    const vDiv = document.getElementById("viewChips");
    const gDiv = document.getElementById("groupChips");
    const aDiv = document.getElementById("assetChips");
    vDiv.innerHTML = ""; gDiv.innerHTML = ""; aDiv.innerHTML = "";

    VIEWS.forEach(v => {
      const chip = document.createElement("div");
      chip.className = "chip" + (v.key === activeView ? " active" : "");
      chip.textContent = v.label;
      chip.onclick = () => { activeView = v.key; buildChips(); render(); };
      vDiv.appendChild(chip);
    });

    GROUPS.forEach(g => {
      const chip = document.createElement("div");
      chip.className = "chip" + (g.key === activeGroup ? " active" : "");
      chip.textContent = g.label;
      chip.onclick = () => {
        activeGroup = g.key;
        visibleAssets.clear();
        ASSETS.forEach(a => { if (g.key === "all" || a.group === g.key) visibleAssets.add(a.key); });
        buildChips(); render();
      };
      gDiv.appendChild(chip);
    });

    ASSETS.forEach(a => {
      const chip = document.createElement("div");
      const plottable = isPlottable(a);
      const on = visibleAssets.has(a.key) && plottable;
      chip.className = "chip" + (on ? " on" : " inactive");
      const prev = `<span class="chip-preview"><svg width="26" height="10">
        <line x1="1" y1="5" x2="16" y2="5" stroke="${a.color}" stroke-width="2" stroke-dasharray="${a.dash}"/>
        <g transform="translate(22,5)" fill="${markerStroke(a.shape)?'none':a.color}" stroke="${a.color}" stroke-width="1.4">
          <path d="${markerPath(a.shape, 0, 0, 3.2)}"/>
        </g>
      </svg></span>`;
      const flag = (activeView === "flows" && !plottable)
        ? ` <span style="color:var(--muted);font-size:10px">(no flow data)</span>` : "";
      chip.innerHTML = prev + a.label + flag;
      chip.onclick = () => {
        if (visibleAssets.has(a.key)) visibleAssets.delete(a.key);
        else visibleAssets.add(a.key);
        buildChips(); render();
      };
      aDiv.appendChild(chip);
    });

    const sub = document.getElementById("subtitle");
    if (sub) {
      sub.textContent = (activeView === "tilt")
        ? `Macro brief allocation calls, ${WEEKS[0]} – ${WEEKS[WEEKS.length-1]}. Line value = allocation score (−1 UW, 0 Neutral, +1 OW). Toggle "Flows" to swap the y-axis to actual weekly net fund flows ($B).`
        : `Weekly net fund flows ($B) for the underlying vehicles that represent each asset class. MMF flows (cash) dominate the scale — toggle cash off to zoom into the ETF series. Non-flow-tracked categories (IG, Treasuries, Commodities) are hidden.`;
    }
  }

  // --------------------- render chart ---------------------
  function render() {
    const svg = document.getElementById("chart");
    svg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs = {}, text) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text !== undefined) e.textContent = text;
      return e;
    };

    const [lo, hi] = yDomain();
    let tickVals;
    if (activeView === "tilt") {
      tickVals = [-1, -0.5, 0, 0.5, 1];
    } else {
      tickVals = niceTicks(lo, hi, 6);
      if (lo < 0 && hi > 0 && !tickVals.includes(0)) tickVals.push(0);
      tickVals.sort((a, b) => a - b);
    }

    tickVals.forEach(v => {
      const isZero = Math.abs(v) < 1e-9;
      svg.appendChild(el("line", {
        x1: M.l, x2: W - M.r, y1: yScale(v), y2: yScale(v),
        stroke: isZero ? "#475569" : "#334155",
        "stroke-dasharray": isZero ? "0" : "2,3",
        "stroke-width": isZero ? 1 : 0.7
      }));
      const label = (activeView === "tilt") ? shortLabel(v) : fmtFlow(v);
      svg.appendChild(el("text", {
        x: M.l - 10, y: yScale(v) + 4, fill: "#94a3b8",
        "text-anchor": "end", "font-size": 11
      }, label));
    });

    WEEKS.forEach((w, i) => {
      svg.appendChild(el("text", {
        x: xScale(i), y: H - M.b + 22, fill: "#94a3b8",
        "text-anchor": "middle", "font-size": 12
      }, w));
    });
    svg.appendChild(el("text", { x: W/2, y: H - 8, fill: "#64748b",
      "text-anchor": "middle", "font-size": 11 }, "Week"));
    svg.appendChild(el("text", {
      x: 18, y: M.t + ih/2, fill: "#64748b", "font-size": 11,
      "text-anchor": "middle", transform: `rotate(-90 18 ${M.t + ih/2})`
    }, activeView === "tilt" ? "Allocation score" : "Weekly net flow ($B)"));

    ASSETS.forEach(a => {
      if (!visibleAssets.has(a.key)) return;
      if (!isPlottable(a)) return;
      const series = seriesFor(a);
      const pathD = series.map((v, i) => `${i===0?"M":"L"}${xScale(i)},${yScale(v)}`).join(" ");
      svg.appendChild(el("path", {
        d: pathD, fill: "none", stroke: a.color,
        "stroke-width": 2, "stroke-dasharray": a.dash, "stroke-linecap": "round"
      }));
      series.forEach((v, i) => {
        const cx = xScale(i), cy = yScale(v);
        const fill = markerStroke(a.shape) ? "none" : a.color;
        const pt = el("path", {
          d: markerPath(a.shape, cx, cy),
          fill, stroke: a.color, "stroke-width": 1.6
        });
        pt.style.cursor = "pointer";
        pt.addEventListener("mousemove", e => showTip(e, i));
        pt.addEventListener("mouseleave", hideTip);
        svg.appendChild(pt);
      });
    });
  }

  // --------------------- tooltip ---------------------
  function showTip(ev, i) {
    const tip = document.getElementById("tooltip");
    const visible = ASSETS.filter(a => visibleAssets.has(a.key));
    let gridCols, headerCells, rows, subLine;

    if (activeView === "tilt") {
      gridCols = "auto 1fr auto auto auto auto";
      headerCells = `
        <div></div>
        <div class="tt-head">Asset / Index</div>
        <div class="tt-head" style="text-align:right">Value</div>
        <div class="tt-head" style="text-align:right">WoW</div>
        <div class="tt-head" style="text-align:right">1M</div>
        <div class="tt-head" style="text-align:right">1Y</div>`;
      subLine = "Representative index values · change vs prior week / 1 month ago / 1 year ago";
      rows = visible.map(a => {
        const cur = a.vals[i];
        const prevWk = i > 0 ? a.vals[i-1] : null;
        const wow = fmtDelta(cur, prevWk, a.unit);
        const mom = fmtDelta(cur, a.mo,   a.unit);
        const yoy = fmtDelta(cur, a.yr,   a.unit);
        return `
          <span class="tt-sw" style="background:${a.color}"></span>
          <span class="tt-name"><strong>${a.label}</strong><br><span style="color:var(--muted);font-size:10px">${a.idx}</span></span>
          <span class="tt-val">${fmtVal(cur, a.unit)}<br>
            <span style="color:var(--muted);font-size:10px">${scoreLabel(a.alloc[i])}</span>
          </span>
          <span class="tt-delta ${wow.cls}">${wow.txt}</span>
          <span class="tt-delta ${mom.cls}">${mom.txt}</span>
          <span class="tt-delta ${yoy.cls}">${yoy.txt}</span>`;
      }).join("");
    } else {
      gridCols = "auto 1fr auto auto";
      headerCells = `
        <div></div>
        <div class="tt-head">Asset · Vehicle</div>
        <div class="tt-head" style="text-align:right">Net Flow</div>
        <div class="tt-head" style="text-align:right">Brief Tilt</div>`;
      subLine = "Weekly net flow for the underlying vehicle, alongside the brief's tilt that week.";
      rows = visible.map(a => {
        const flows = flowSeries(a);
        if (!flows) {
          return `
            <span class="tt-sw" style="background:${a.color};opacity:0.4"></span>
            <span class="tt-name"><strong>${a.label}</strong><br><span style="color:var(--muted);font-size:10px">no flow data</span></span>
            <span class="tt-val" style="color:var(--muted)">—</span>
            <span class="tt-val" style="color:var(--muted);font-size:10.5px">${scoreLabel(a.alloc[i])}</span>`;
        }
        const cur = flows[i];
        const flowCls = cur > 0 ? "delta-up" : (cur < 0 ? "delta-dn" : "delta-flat");
        return `
          <span class="tt-sw" style="background:${a.color}"></span>
          <span class="tt-name"><strong>${a.label}</strong><br><span style="color:var(--muted);font-size:10px">${a.flowIdx || ""}</span></span>
          <span class="tt-val ${flowCls}">${fmtFlow(cur)}</span>
          <span class="tt-val" style="color:var(--muted);font-size:10.5px">${scoreLabel(a.alloc[i])}</span>`;
      }).join("");
    }

    tip.innerHTML = `
      <div class="tt-title">${WEEKS[i]}</div>
      <div class="tt-sub">${subLine}</div>
      <div class="tt-grid" style="grid-template-columns:${gridCols}">
        ${headerCells}
        ${rows || '<div style="grid-column:1/-1;color:var(--muted)">No assets visible</div>'}
      </div>`;
    tip.style.opacity = 1;

    const parentRect = tip.offsetParent.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const xRight = ev.clientX - parentRect.left + 14;
    const viewportW = document.documentElement.clientWidth;
    const wouldOverflow = (ev.clientX + tipRect.width + 30) > viewportW;
    tip.style.left = (wouldOverflow
      ? ev.clientX - parentRect.left - tipRect.width - 14
      : xRight) + "px";
    tip.style.top  = Math.max(8, ev.clientY - parentRect.top - tipRect.height/2) + "px";
  }
  function hideTip() {
    const tip = document.getElementById("tooltip");
    if (tip) tip.style.opacity = 0;
  }

  // --------------------- public init ---------------------
  function init({ history, flows }) {
    HIST   = history;
    FLOWS  = flows;
    WEEKS  = history.weeks;
    ASSETS = history.assets;
    GROUPS = history.groups;
    visibleAssets = new Set(ASSETS.map(a => a.key));

    // footer copy
    const footer = document.getElementById("chart-footer");
    if (footer) {
      footer.innerHTML = `
        <strong>Tilt data:</strong> Allocation scores and representative index values from <code>data/history.json</code>.
        ${history.notes ? "<br>" + history.notes : ""}<br><br>
        <strong>Flows data ($B net, weekly):</strong> From <code>data/flows.json</code>.
        ${flows._note || ""}
      `;
    }

    buildChips();
    render();
  }

  window.Chart = { init };
})();
