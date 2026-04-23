// ==============================================================================
// live.js — browser-side live data fetchers.
//
// Every source is public, CORS-friendly, and key-free. Each asset has a primary
// source and a fallback chain; we try in order and surface the first success.
//
// Exports: window.Live.fetchOne(assetDef) -> { value, asOf, source } | { err }
//          window.Live.fetchAll(assetDefs) -> Promise<Array<{asset, result}>>
// ==============================================================================

(function () {
  const FRED_CSV = id => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const YAHOO    = sym => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;
  const STOOQ    = sym => `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
  const COINGECKO= id  => `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_last_updated_at=true`;

  // ---------- generic fetch with timeout + no-cache ----------
  async function fetchText(url, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }
  async function fetchJSON(url, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- parsers ----------
  // FRED CSV: "DATE,SERIES_ID\n2026-04-20,4.26\n..." — take last non-"." row.
  function parseFredCsv(csv) {
    const lines = csv.trim().split(/\r?\n/).slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const [date, raw] = lines[i].split(",");
      if (raw && raw !== "." && !isNaN(Number(raw))) {
        return { value: Number(raw), asOf: date };
      }
    }
    throw new Error("FRED: no valid rows");
  }

  // Yahoo chart: {"chart":{"result":[{"meta":{"regularMarketPrice":7126.1,...},"timestamp":[...],"indicators":{"quote":[{"close":[...]}]}}]}}
  function parseYahoo(json) {
    const r = json?.chart?.result?.[0];
    if (!r) throw new Error("Yahoo: no result");
    const meta = r.meta || {};
    const price = meta.regularMarketPrice;
    const ts = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : null;
    if (typeof price !== "number") throw new Error("Yahoo: no price");
    return {
      value: price,
      asOf: ts ? ts.toISOString().slice(0, 10) : null,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null
    };
  }

  // Stooq CSV: "Symbol,Date,Time,Open,High,Low,Close,Volume\nSPX,2026-04-20,22:00:00,...,7126.10,..."
  function parseStooq(csv) {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("Stooq: empty");
    const parts = lines[1].split(",");
    const date = parts[1];
    const close = Number(parts[6]);
    if (isNaN(close)) throw new Error("Stooq: no close");
    return { value: close, asOf: date };
  }

  // CoinGecko: {"bitcoin":{"usd":75746.12,"last_updated_at":1745700000}}
  function parseCoingecko(json, id) {
    const o = json?.[id];
    if (!o || typeof o.usd !== "number") throw new Error("CG: no price");
    const ts = o.last_updated_at ? new Date(o.last_updated_at * 1000) : null;
    return { value: o.usd, asOf: ts ? ts.toISOString().slice(0, 10) : null };
  }

  // ---------- per-source runners ----------
  async function tryYahoo(symbol) {
    const j = await fetchJSON(YAHOO(symbol));
    const p = parseYahoo(j);
    return { ...p, source: `Yahoo (${symbol})` };
  }
  async function tryFred(series, unitScale) {
    const csv = await fetchText(FRED_CSV(series));
    const p = parseFredCsv(csv);
    return {
      value: unitScale ? p.value * unitScale : p.value,
      asOf: p.asOf,
      source: `FRED (${series})`
    };
  }
  async function tryStooq(symbol) {
    const csv = await fetchText(STOOQ(symbol));
    const p = parseStooq(csv);
    return { ...p, source: `Stooq (${symbol})` };
  }
  async function tryCoingecko(id) {
    const j = await fetchJSON(COINGECKO(id));
    const p = parseCoingecko(j, id);
    return { ...p, source: `CoinGecko (${id})` };
  }

  // ---------- per-asset orchestration ----------
  async function fetchOne(asset) {
    const live = asset.live || {};
    const errs = [];
    const pri = live.source;

    // Try primary
    try {
      if (pri === "yahoo"     && live.symbol)     return await tryYahoo(live.symbol);
      if (pri === "fred"      && live.fredSeries) return await tryFred(live.fredSeries, live.unitScale);
      if (pri === "stooq"     && live.symbol)     return await tryStooq(live.symbol);
      if (pri === "coingecko" && live.id)         return await tryCoingecko(live.id);
    } catch (e) {
      errs.push(`${pri}: ${e.message}`);
    }

    // Fallbacks
    try {
      if (live.yahooFallback)      return await tryYahoo(live.yahooFallback);
    } catch (e) { errs.push(`yahoo-fb: ${e.message}`); }
    try {
      if (live.fredSeries && pri !== "fred") return await tryFred(live.fredSeries, live.unitScale);
    } catch (e) { errs.push(`fred-fb: ${e.message}`); }
    try {
      if (live.coingeckoFallback)  return await tryCoingecko(live.coingeckoFallback);
    } catch (e) { errs.push(`cg-fb: ${e.message}`); }
    try {
      if (live.stooqFallback)      return await tryStooq(live.stooqFallback);
    } catch (e) { errs.push(`stooq-fb: ${e.message}`); }

    return { err: errs.join(" · ") || "no source configured" };
  }

  async function fetchAll(assets, onEach) {
    const tasks = assets.map(async a => {
      const result = await fetchOne(a);
      if (onEach) onEach(a, result);
      return { asset: a, result };
    });
    return Promise.all(tasks);
  }

  window.Live = { fetchOne, fetchAll };
})();
