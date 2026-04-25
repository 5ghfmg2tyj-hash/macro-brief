"use strict";

// Node port of scripts/fetch_live.py.
// Uses Node 18+ global fetch (available in Electron 28+). No third-party deps.

const fs   = require("fs");
const path = require("path");

const UA             = "Mozilla/5.0 (compatible; macro-brief/1.0; +https://github.com)";
const TIMEOUT_MS     = 20_000;
const SLEEP_BETWEEN  = 250; // ms, polite crawl delay

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*" },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- historical-point helpers ----------

function extractHistPoint(timestamps, closes, targetDaysAgo) {
  const targetMs = Date.now() - targetDaysAgo * 86400_000;
  let best = -1, bestDiff = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const diff = Math.abs(timestamps[i] * 1000 - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  if (best < 0 || closes[best] == null) return null;
  return { value: Number(closes[best]), date: new Date(timestamps[best] * 1000).toISOString().slice(0, 10) };
}

function findClosestFred(rows, targetDate) {
  const targetMs = new Date(targetDate).getTime();
  let best = null, bestDiff = Infinity;
  for (const row of rows) {
    const diff = Math.abs(new Date(row.date).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return best ? { value: best.val, date: best.date } : null;
}

// ---------- per-source fetchers ----------

async function fetchYahoo(symbol) {
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
  const data = await (await _get(url)).json();
  const result = (data?.chart?.result) || [];
  if (!result.length) throw new Error("no result");
  const meta  = result[0].meta || {};
  const price = meta.regularMarketPrice;
  if (price == null) throw new Error("no regularMarketPrice");
  const ts    = meta.regularMarketTime;
  const asOf  = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? null;

  const timestamps = result[0].timestamp || [];
  const closes     = (result[0].indicators?.quote?.[0]?.close) || [];
  const hist = {
    dod: extractHistPoint(timestamps, closes, 1),
    wow: extractHistPoint(timestamps, closes, 7),
    mom: extractHistPoint(timestamps, closes, 30),
    mo6: extractHistPoint(timestamps, closes, 182),
    yoy: extractHistPoint(timestamps, closes, 365),
  };

  return { value: Number(price), asOf, prevClose: prev != null ? Number(prev) : null,
           source: `Yahoo (${symbol})`, hist };
}

async function fetchFred(series, unitScale) {
  const url  = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`;
  const text = await (await _get(url)).text();
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("empty CSV");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(",").map((s) => s.trim());
    if (raw && raw !== ".") {
      const val = parseFloat(raw);
      if (!isNaN(val)) rows.push({ date, val: unitScale ? val * unitScale : val });
    }
  }
  if (!rows.length) throw new Error("no valid rows");

  const last = rows[rows.length - 1];
  const now  = new Date();
  function isoOffset(daysAgo) {
    return new Date(now - daysAgo * 86400_000).toISOString().slice(0, 10);
  }
  const hist = {
    dod: findClosestFred(rows, isoOffset(1)),
    wow: findClosestFred(rows, isoOffset(7)),
    mom: findClosestFred(rows, isoOffset(30)),
    mo6: findClosestFred(rows, isoOffset(182)),
    yoy: findClosestFred(rows, isoOffset(365)),
  };

  return { value: last.val, asOf: last.date, source: `FRED (${series})`, hist };
}

async function fetchStooq(symbol) {
  const url  = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
  const text = await (await _get(url)).text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("no rows");
  const parts = lines[1].split(",");
  if (parts.length < 7) throw new Error(`short row: ${lines[1]}`);
  const val = parseFloat(parts[6]);
  if (isNaN(val)) throw new Error(`bad close: ${parts[6]}`);
  return { value: val, asOf: parts[1].trim(), source: `Stooq (${symbol})`, hist: null };
}

async function fetchCoinGecko(coinId) {
  const url   = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=365&interval=daily`;
  const data  = await (await _get(url)).json();
  const prices = data?.prices;
  if (!prices || !prices.length) throw new Error("no prices");

  const last  = prices[prices.length - 1];
  const asOf  = last ? new Date(last[0]).toISOString().slice(0, 10) : null;
  const value = last ? Number(last[1]) : null;
  if (value == null) throw new Error("no price");

  function findClosestCG(targetMs) {
    let best = null, bestDiff = Infinity;
    for (const [ts, price] of prices) {
      const diff = Math.abs(ts - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = { value: Number(price), date: new Date(ts).toISOString().slice(0, 10) }; }
    }
    return best;
  }

  const now  = Date.now();
  const hist = {
    dod: findClosestCG(now - 1   * 86400_000),
    wow: findClosestCG(now - 7   * 86400_000),
    mom: findClosestCG(now - 30  * 86400_000),
    mo6: findClosestCG(now - 182 * 86400_000),
    yoy: findClosestCG(now - 365 * 86400_000),
  };

  return { value, asOf, source: `CoinGecko (${coinId})`, hist };
}

// ---------- try wrapper ----------

async function _try(fn, ...args) {
  try   { return [await fn(...args), null]; }
  catch (e) { return [null, e.message || String(e)]; }
}

// ---------- ETF fund-flow proxies (shares-outstanding method) ----------

// Maps asset keys to representative ETFs whose share-count changes proxy daily flows.
// Shares outstanding change = creation/redemption → net flow ≈ Δshares × price.
const ETF_FLOWS = [
  { key: "usLarge", vehicle: "SPY+IVV+VOO", etfs: ["SPY","IVV","VOO"] },
  { key: "usSmid",  vehicle: "IWM",         etfs: ["IWM"] },
  { key: "intlDev", vehicle: "EFA",         etfs: ["EFA"] },
  { key: "em",      vehicle: "EEM",         etfs: ["EEM"] },
  { key: "gold",    vehicle: "GLD",         etfs: ["GLD"] },
  { key: "bitcoin", vehicle: "IBIT+FBTC",   etfs: ["IBIT","FBTC"] },
  { key: "hy",      vehicle: "HYG+JNK",     etfs: ["HYG","JNK"] },
  { key: "ig",      vehicle: "LQD",         etfs: ["LQD"] },
  { key: "treas",   vehicle: "IEF+TLT",     etfs: ["IEF","TLT"] },
  { key: "cash",    vehicle: "SGOV+BIL",    etfs: ["SGOV","BIL"] },
  // commod: no clean ETF proxy
];

// Increment when new ETFs are added to ETF_FLOWS — triggers a fresh bootstrap on existing installs.
const BOOTSTRAP_VERSION = 4;
// Earliest date to include in bootstrap history.
const BOOTSTRAP_START = "2026-01-01";

async function fetchSharesOutstanding(symbol) {
  const url  = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,price`;
  const data = await (await _get(url)).json();
  const r    = data?.quoteSummary?.result?.[0];
  const shares = r?.defaultKeyStatistics?.sharesOutstanding?.raw;
  const price  = r?.price?.regularMarketPrice?.raw;
  if (shares == null || price == null) throw new Error("missing sharesOutstanding or price");
  return { shares: Number(shares), price: Number(price) };
}

const FLOW_FRACTION = 0.05; // ~5% of ETF dollar volume ≈ net creation/redemption

async function fetchEtfOHLCV(symbol) {
  // range=ytd gives Jan 1 of the current year → today, daily bars — more reliable than period1/period2.
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=ytd&interval=1d`;
  const data = await (await _get(url)).json();
  const res  = data?.chart?.result?.[0];
  if (!res) throw new Error("no result");
  const ts = res.timestamp || [];
  const q  = res.indicators?.quote?.[0] || {};
  const closes  = q.close  || [];
  const volumes = q.volume || [];
  console.log(`  ohlcv:${symbol.padEnd(5)} ${ts.length} days returned`);
  return { timestamps: ts, closes, volumes };
}

async function buildBootstrapSeries(today) {
  const allEtfs = [...new Set(ETF_FLOWS.flatMap(f => f.etfs))];
  const etfData = {};
  for (const sym of allEtfs) {
    const [hist, err] = await _try(fetchEtfOHLCV, sym);
    if (hist) etfData[sym] = hist;
    else console.warn(`  bootstrap:${sym} ERR ${err}`);
    await sleep(SLEEP_BETWEEN);
  }

  // Build per-ETF signed-flow map: { sym -> { date -> flowUSD } }
  const etfDailyFlow = {};
  for (const sym of allEtfs) {
    const d = etfData[sym];
    if (!d) continue;
    const { timestamps, closes, volumes } = d;
    etfDailyFlow[sym] = {};
    let counted = 0;
    for (let i = 1; i < timestamps.length; i++) {
      if (closes[i] == null || volumes[i] == null || volumes[i] === 0) continue;
      const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      if (dateStr < BOOTSTRAP_START || dateStr >= today) continue;
      const prev = closes[i - 1];
      if (prev == null || prev === 0) continue;
      const dir = closes[i] >= prev ? 1 : -1;
      etfDailyFlow[sym][dateStr] = dir * volumes[i] * closes[i] * FLOW_FRACTION;
      counted++;
    }
    console.log(`  bstrap:${sym.padEnd(5)} ${counted} usable days`);
  }

  // Collect all trading dates from BOOTSTRAP_START onward
  const allDates = new Set();
  for (const sym of allEtfs) {
    if (!etfDailyFlow[sym]) continue;
    for (const d of Object.keys(etfDailyFlow[sym])) allDates.add(d);
  }

  const sortedDates = [...allDates].sort();
  const series = [];
  for (const date of sortedDates) {
    const flows = {};
    for (const { key, etfs } of ETF_FLOWS) {
      let total = 0, hasData = false;
      for (const sym of etfs) {
        const f = etfDailyFlow[sym]?.[date];
        if (f != null) { total += f; hasData = true; }
      }
      flows[key] = hasData ? +((total / 1e9).toFixed(3)) : null;
    }
    series.push({ date, flows });
  }
  console.log(`  bootstrap: built ${series.length} entries (${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]})`);
  return series;
}

async function fetchFlows(userData) {
  const histPath       = path.join(userData, "shares-history.json");
  const dailyFlowsPath = path.join(userData, "daily-flows.json");
  const today          = new Date().toISOString().slice(0, 10);

  // ---- Load daily-flows; bootstrap on first run or when new ETFs are added ----
  let dailyFlows = { updatedAt: null, bootstrapVersion: 0, series: [] };
  try { dailyFlows = JSON.parse(fs.readFileSync(dailyFlowsPath, "utf8")); } catch {}
  // Back-compat: treat old `bootstrapped: true` flag as version 1
  if (dailyFlows.bootstrapped && !dailyFlows.bootstrapVersion) dailyFlows.bootstrapVersion = 1;

  if ((dailyFlows.bootstrapVersion || 0) < BOOTSTRAP_VERSION) {
    console.log(`  flows: bootstrapping 4 weeks of history (v${BOOTSTRAP_VERSION})…`);
    try {
      const bootstrapSeries = await buildBootstrapSeries(today);
      if (bootstrapSeries.length) {
        // Build a lookup of bootstrap flows by date
        const bootstrapMap = new Map(bootstrapSeries.map(e => [e.date, e.flows]));

        // Pass 1: backfill any missing flow keys in existing entries
        for (const entry of dailyFlows.series) {
          const bFlows = bootstrapMap.get(entry.date);
          if (!bFlows) continue;
          for (const [key, val] of Object.entries(bFlows)) {
            if (entry.flows[key] == null && val != null) entry.flows[key] = val;
          }
        }

        // Pass 2: append entirely new dates that weren't in the series yet
        const existingDates = new Set(dailyFlows.series.map(e => e.date));
        const toAdd = bootstrapSeries.filter(e => !existingDates.has(e.date));
        dailyFlows.series = [...toAdd, ...dailyFlows.series]
          .sort((a, b) => a.date.localeCompare(b.date));

        dailyFlows.bootstrapVersion = BOOTSTRAP_VERSION;
        console.log(`  flows: bootstrap v${BOOTSTRAP_VERSION} — backfilled keys + added ${toAdd.length} new days`);
      }
    } catch (e) {
      console.warn("  flows: bootstrap error:", e.message);
    }
  }

  // ---- Shares-outstanding method for today's real flow ----
  let sharesHistory = {};
  try { sharesHistory = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch {}

  const allEtfs = [...new Set(ETF_FLOWS.flatMap(f => f.etfs))];
  const current = {};
  for (const sym of allEtfs) {
    const [data, err] = await _try(fetchSharesOutstanding, sym);
    if (data) {
      current[sym] = data;
      console.log(`  flow:${sym.padEnd(5)} ${(data.shares / 1e6).toFixed(1)}M sh @ $${data.price.toFixed(2)}`);
    } else {
      console.warn(`  flow:${sym.padEnd(5)} ERR ${err}`);
    }
    await sleep(SLEEP_BETWEEN);
  }

  // Append today's shares to history
  for (const sym of allEtfs) {
    if (!current[sym]) continue;
    if (!sharesHistory[sym]) sharesHistory[sym] = [];
    sharesHistory[sym] = [
      ...sharesHistory[sym].filter(e => e.date !== today),
      { date: today, ...current[sym] },
    ].slice(-400);
  }
  fs.mkdirSync(path.dirname(histPath), { recursive: true });
  fs.writeFileSync(histPath, JSON.stringify(sharesHistory, null, 2) + "\n");

  // Find reference entry strictly before today for shares-delta
  function findRef(hist, targetDate) {
    const targetMs = new Date(targetDate).getTime();
    let best = null, bestDiff = Infinity;
    for (const e of (hist || [])) {
      if (e.date >= today) continue;
      const diff = Math.abs(new Date(e.date).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = e; }
    }
    return best;
  }

  function computeTodayFlow(etfs) {
    const isoYesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    let total = 0, hasData = false;
    for (const sym of etfs) {
      const curr = current[sym];
      if (!curr) continue;
      const ref = findRef(sharesHistory[sym], isoYesterday);
      if (!ref) continue;
      total += (curr.shares - ref.shares) * curr.price;
      hasData = true;
    }
    return hasData ? total : null;
  }

  // Append today's entry to series (real flow if available, else nulls)
  const todayEntry = { date: today, flows: {} };
  for (const { key, etfs } of ETF_FLOWS) {
    const f = computeTodayFlow(etfs);
    todayEntry.flows[key] = f != null ? +((f / 1e9).toFixed(3)) : null;
  }
  dailyFlows.series = [
    ...dailyFlows.series.filter(e => e.date !== today),
    todayEntry,
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  dailyFlows.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  fs.mkdirSync(path.dirname(dailyFlowsPath), { recursive: true });
  fs.writeFileSync(dailyFlowsPath, JSON.stringify(dailyFlows, null, 2) + "\n");

  // ---- Compute summary for AI from accumulated series ----
  function sumSeriesFlows(key, daysAgo) {
    const cutoff = new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
    let total = 0, hasData = false;
    for (const e of dailyFlows.series) {
      if (e.date <= cutoff) continue;
      const f = e.flows?.[key];
      if (f != null) { total += f; hasData = true; }
    }
    return hasData ? total * 1e9 : null; // raw USD
  }

  const summary = {};
  for (const { key, vehicle } of ETF_FLOWS) {
    const todayFlowB = todayEntry.flows[key];
    summary[key] = {
      vehicle,
      daily: todayFlowB != null ? todayFlowB * 1e9 : null,
      wow:   sumSeriesFlows(key, 7),
      mom:   sumSeriesFlows(key, 30),
      mo6:   sumSeriesFlows(key, 182),
      yoy:   sumSeriesFlows(key, 365),
    };
  }

  return summary;
}

// ---------- fetch one asset (mirrors fetch_one in fetch_live.py) ----------

async function fetchOne(asset) {
  const live   = asset.live || {};
  const pri    = live.source;
  const errors = [];

  // Primary
  if (pri === "yahoo" && live.symbol) {
    const [r, err] = await _try(fetchYahoo, live.symbol);
    if (r) return r;
    errors.push(`yahoo: ${err}`);
  } else if (pri === "fred" && live.fredSeries) {
    const [r, err] = await _try(fetchFred, live.fredSeries, live.unitScale);
    if (r) return r;
    errors.push(`fred: ${err}`);
  } else if (pri === "stooq" && live.symbol) {
    const [r, err] = await _try(fetchStooq, live.symbol);
    if (r) return r;
    errors.push(`stooq: ${err}`);
  } else if (pri === "coingecko" && live.id) {
    const [r, err] = await _try(fetchCoinGecko, live.id);
    if (r) return r;
    errors.push(`coingecko: ${err}`);
  }

  // Fallbacks
  if (live.yahooFallback) {
    const [r, err] = await _try(fetchYahoo, live.yahooFallback);
    if (r) return r;
    errors.push(`yahoo-fb: ${err}`);
  }
  if (live.fredSeries && pri !== "fred") {
    const [r, err] = await _try(fetchFred, live.fredSeries, live.unitScale);
    if (r) return r;
    errors.push(`fred-fb: ${err}`);
  }
  if (live.coingeckoFallback) {
    const [r, err] = await _try(fetchCoinGecko, live.coingeckoFallback);
    if (r) return r;
    errors.push(`cg-fb: ${err}`);
  }
  if (live.stooqFallback) {
    const [r, err] = await _try(fetchStooq, live.stooqFallback);
    if (r) return r;
    errors.push(`stooq-fb: ${err}`);
  }

  return { error: errors.join(" · ") || "no source configured" };
}

// ---------- main export ----------

async function run({ historyPath, outPath }) {
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  const results = {};

  for (const asset of history.assets) {
    const key = asset.key;
    try {
      const r = await fetchOne(asset);
      results[key] = r;
      if (r.value != null) {
        console.log(`  ${key.padEnd(9)} ${String(r.value).padStart(12)}  [${r.source}]`);
      } else {
        console.warn(`  ${key.padEnd(9)} ERR  ${r.error}`);
      }
    } catch (e) {
      results[key] = { error: `orchestrator: ${e.message}` };
      console.error(`  ${key.padEnd(9)} ORCHESTRATOR ERR  ${e.message}`);
    }
    await sleep(SLEEP_BETWEEN);
  }

  // Fetch ETF daily flows (shares-outstanding proxy)
  const userData = path.dirname(outPath);
  let dailyFlows = null;
  console.log("\nFetching ETF fund flows…");
  try {
    dailyFlows = await fetchFlows(userData);
    console.log(`  computed flows for ${Object.keys(dailyFlows).length} asset classes`);
  } catch (e) {
    console.error("fetchFlows error:", e.message);
  }

  const out = {
    fetchedAt:     new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    schemaVersion: 1,
    notes:         "Generated by electron/fetch-live.js (local Electron app).",
    assets:        results,
    dailyFlows,
  };

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${outPath} (${Object.keys(results).length} assets)`);
}

module.exports = { run };
