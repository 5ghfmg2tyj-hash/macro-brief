"use strict";

const fs = require("fs");
const path = require("path");

const DAY_MS = 86_400_000;
const UA = "Mozilla/5.0 (compatible; macro-brief/1.0; +https://github.com)";
const HISTORY_PATH = path.resolve(process.argv[2] || "docs/data/history.json");

function nearestOnOrBefore(rows, target) {
  const targetMs = target.getTime();
  let best = null;
  for (const row of rows) {
    const rowMs = Date.parse(`${row.date}T12:00:00Z`);
    if (rowMs <= targetMs && (!best || rowMs > best.ms)) best = { ...row, ms: rowMs };
  }
  if (!best) {
    for (const row of rows) {
      const rowMs = Date.parse(`${row.date}T12:00:00Z`);
      if (!best || Math.abs(rowMs - targetMs) < Math.abs(best.ms - targetMs)) {
        best = { ...row, ms: rowMs };
      }
    }
  }
  return best ? Number(best.value.toFixed(6)) : null;
}

async function getText(url) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchYahoo(symbol, startDate, endDate) {
  const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const payload = JSON.parse(await getText(url));
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo returned no history for ${symbol}`);
  const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  return (result.timestamp || [])
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      value: closes[index],
    }))
    .filter((row) => Number.isFinite(row.value));
}

async function fetchFred(series, scale = 1) {
  const csv = await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const comma = line.indexOf(",");
    const date = line.slice(0, comma);
    const raw = line.slice(comma + 1).trim();
    if (!raw || raw === ".") return null;
    const value = Number(raw) * scale;
    return Number.isFinite(value) ? { date, value } : null;
  }).filter(Boolean);
}

const SOURCES = {
  usLarge:  () => fetchYahoo("^GSPC", "2025-01-01", "2027-01-10"),
  usSmid:   () => fetchYahoo("IWM", "2025-01-01", "2027-01-10"),
  intlDev:  () => fetchYahoo("EFA", "2025-01-01", "2027-01-10"),
  em:       () => fetchYahoo("EEM", "2025-01-01", "2027-01-10"),
  gold:     () => fetchYahoo("GC=F", "2025-01-01", "2027-01-10"),
  commod:   () => fetchFred("DCOILWTICO"),
  bitcoin:  () => fetchYahoo("BTC-USD", "2025-01-01", "2027-01-10"),
  ig:       () => fetchFred("BAMLC0A0CM", 100),
  hy:       () => fetchFred("BAMLH0A0HYM2", 100),
  treas:    () => fetchFred("DGS10"),
  cash:     () => fetchFred("DFEDTARU"),
};

async function main() {
  const history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  const dates = history.weekDates.map((date) => new Date(`${date}T12:00:00Z`));

  for (const asset of history.assets) {
    const fetchSource = SOURCES[asset.key];
    if (!fetchSource) throw new Error(`No historical source configured for ${asset.key}`);
    const rows = await fetchSource();
    const valuesAt = (daysAgo) => dates.map((date) =>
      nearestOnOrBefore(rows, new Date(date.getTime() - daysAgo * DAY_MS))
    );
    asset.vals = valuesAt(0);
    asset.wowVals = valuesAt(7);
    asset.moVals = valuesAt(30);
    asset.yrVals = valuesAt(365);
    console.log(`${asset.key}: ${asset.vals.length} points`);
  }

  const note = "Historical tooltip values use the closest available observation on or before each brief date and its 7-day, 30-day, and 365-day reference dates.";
  if (!String(history.notes || "").includes(note)) history.notes = `${history.notes || ""} ${note}`.trim();
  fs.writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
