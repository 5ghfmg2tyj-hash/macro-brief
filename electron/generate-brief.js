"use strict";

// Calls Anthropic or OpenAI to generate a macro brief from live data + history,
// then writes the markdown file and updates briefs/index.json + history.json.

const fs   = require("fs");
const path = require("path");

const TIMEOUT_MS    = 120_000; // AI calls can take a while
const MAX_RETRIES   = 3;
const RETRYABLE     = new Set([429, 500, 503, 529]); // overloaded / rate-limited / transient

// Retry with exponential backoff. attemptFn must throw err with err.retryable=true to trigger a retry.
async function withRetry(attemptFn, label, onStatus) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(10_000 * 2 ** (attempt - 1), 60_000); // 10s, 20s, 40s
      const secs  = delay / 1000;
      console.log(`${label}: retry ${attempt}/${MAX_RETRIES} in ${secs}s…`);
      onStatus?.(`${label} overloaded — retrying in ${secs}s… (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, delay));
      onStatus?.(`${label} overloaded — retrying now… (attempt ${attempt}/${MAX_RETRIES})`);
    }
    try   { return await attemptFn(); }
    catch (e) { lastErr = e; if (!e.retryable) throw e; }
  }
  const finalErr = new Error(`${label} servers are overloaded. Tried ${MAX_RETRIES} times. Please wait a few minutes and try again.`);
  finalErr.cause = lastErr;
  throw finalErr;
}

const ASSET_KEYS = ["usLarge","usSmid","intlDev","em","gold","commod","bitcoin","ig","hy","treas","cash"];

const VALID_SCORES = new Set([-1, -0.5, 0, 0.5, 1]);

// ---------- prompt building ----------

const SYSTEM_PROMPT = `You are a macro investment analyst. Given live market data and recent allocation history, produce a comprehensive weekly macro brief and updated allocation recommendations.

The brief markdown should include:
1. Money Flow Snapshot — MANDATORY: produce a markdown table showing net fund flows into/out of each asset class. EXACTLY these 7 columns:
   | Asset Class | Vehicle | Daily Flow | WoW | MoM | 6M | YoY |
   - All values in $B (billions). Positive = inflows, negative = outflows.
   - Format: "+$1.5B", "−$2.3B", or "—" if data is unavailable.
   - "Daily Flow" = today's estimated flow; WoW = past ~7 days; MoM = past ~30 days; 6M = past ~180 days; YoY = past ~365 days.
   - Include ALL 11 asset classes. For Commodities and Cash, show "—" for any columns without data.
   - Cash row: vehicle is SGOV+BIL (T-bill ETF proxy — directional signal, not the full MMF universe). Show flow data normally.
   - Commodities row: all "—" (no ETF proxy).
   - Use EXACTLY the vehicle names provided in the user prompt. Do not rename or add alternatives.
   - This section is about WHERE MONEY IS FLOWING, not price levels.
2. Macro Cycle Assessment — 2–3 paragraphs on the macro regime
3. Key Signals This Week — bulleted highlights of the most important moves
4. Allocation Recommendations — one paragraph per asset class with rationale
5. Risk Factors to Watch — bulleted list of top risks

Allocation scores must be one of: -1, -0.5, 0, 0.5, or 1
  -1   = Underweight (UW)
  -0.5 = Slight Underweight
   0   = Neutral
   0.5 = Slight Overweight
   1   = Overweight (OW)

Asset classes to score:
  usLarge  = US Large Cap Equities
  usSmid   = US Small/Mid Cap Equities
  intlDev  = International Developed Markets (Europe, Japan, UK)
  em       = Emerging Markets
  gold     = Gold / Precious Metals
  commod   = Commodities (Oil, Copper, etc.)
  bitcoin  = Bitcoin / Crypto
  ig       = Investment Grade Bonds
  hy       = High Yield Bonds
  treas    = Intermediate Treasuries (5–10Y)
  cash     = Cash / Short Duration`;

function fmtB(v) {
  if (v == null) return "—";
  const b = v / 1e9;
  return `${b >= 0 ? "+" : "−"}$${Math.abs(b).toFixed(2)}B`;
}

function buildUserPrompt(liveJson, historyJson) {
  const now       = new Date();
  const weekDate  = now.toISOString().slice(0, 10);
  const weekLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const assets    = historyJson.assets || [];

  // Market price context (for Macro Cycle Assessment, not the flow table)
  const liveRows = assets.map(a => {
    const d = (liveJson.assets || {})[a.key];
    if (!d || d.error) return `  ${a.label} (${a.idx}): [ERROR: ${d?.error || "no data"}]`;
    const unit = a.unit ? ` [${a.unit}]` : "";
    const h = d.hist;
    if (!h) return `  ${a.label} (${a.idx})${unit}: ${d.value} (${d.asOf || "?"}) [${d.source}]`;
    const yoy = h.yoy ? ` | 1yr_ago=${h.yoy.value}(${h.yoy.date})` : "";
    const wow = h.wow ? ` | 1wk_ago=${h.wow.value}(${h.wow.date})` : "";
    return `  ${a.label} (${a.idx})${unit}: ${d.value}(${d.asOf || "?"})${wow}${yoy} [${d.source}]`;
  }).join("\n");

  // Fund flow data for Money Flow Snapshot table
  // ETF vehicle names — must be used exactly as-is in the brief table
  const VEHICLES = {
    usLarge: "SPY+IVV+VOO", usSmid:  "IWM",      intlDev: "EFA",
    em:      "EEM",         gold:    "GLD",       commod:  "—",
    bitcoin: "IBIT+FBTC",  ig:      "LQD",       hy:      "HYG+JNK",
    treas:   "IEF+TLT",    cash:    "SGOV+BIL",
  };
  const df = liveJson.dailyFlows;
  const allNull = df && Object.values(df).every(f => f.daily == null && f.wow == null);
  const flowNote = (!df || allNull)
    ? "NOTE: Flow history is initializing — day 1 baseline stored today. Deltas will appear from day 2 onward. Show — for all numeric cells."
    : "";
  const flowRows = assets.map(a => {
    const f    = df?.[a.key];
    const veh  = VEHICLES[a.key] || "—";
    if (!f || (a.key === "commod")) return `  ${a.label} | vehicle=${veh} | daily=— | wow=— | mom=— | mo6=— | yoy=—`;
    return `  ${a.label} | vehicle=${veh} | daily=${fmtB(f.daily)} | wow=${fmtB(f.wow)} | mom=${fmtB(f.mom)} | mo6=${fmtB(f.mo6)} | yoy=${fmtB(f.yoy)}`;
  }).join("\n");

  const nWeeks = (historyJson.weeks || []).length;
  const start  = Math.max(0, nWeeks - 4);
  const recentWeeks = (historyJson.weeks     || []).slice(start);
  const recentDates = (historyJson.weekDates || []).slice(start);

  const allocRows = assets.map(a => {
    const recent = (a.alloc || []).slice(start);
    const cols   = recentWeeks.map((w, i) => `${w}: ${recent[i] >= 0 ? "+" : ""}${recent[i]}`);
    return `  ${a.label}: ${cols.join(" | ")}`;
  }).join("\n");

  return `Today's date: ${weekDate}
You MUST use exactly these values in your response — do not infer or change them:
  weekDate:  "${weekDate}"
  weekLabel: "${weekLabel}"

FUND FLOW DATA — use this for the Money Flow Snapshot table (fetched ${liveJson.fetchedAt || "recently"}):
${flowNote}
CRITICAL: Use the EXACT vehicle names from this data. Do NOT substitute, rename, or add alternatives (e.g. use "IWM" not "IWM/IJR", "GLD" not "GLD/IAU").
${flowRows}

MARKET PRICE CONTEXT — use for Macro Cycle Assessment / Key Signals / Allocation Recommendations:
${liveRows}

RECENT ALLOCATION HISTORY (last ${recentWeeks.length} week${recentWeeks.length !== 1 ? "s" : ""}):
${allocRows}

Generate the full weekly macro brief and return the updated allocation scores.
IMPORTANT: Section 1 heading must be "## Money Flow Snapshot" — not "Market Snapshot" or any other title.
IMPORTANT: Section 1 table must have EXACTLY 7 columns (Asset Class | Vehicle | Daily Flow | WoW | MoM | 6M | YoY) showing fund flows in $B, not prices.`;
}

// ---------- Anthropic ----------

async function callAnthropic(liveJson, historyJson, model, apiKey, onStatus) {
  const body = {
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [{
      name: "submit_brief",
      description: "Submit the completed macro brief and allocation recommendations.",
      input_schema: {
        type: "object",
        required: ["weekLabel", "weekDate", "brief", "allocations"],
        properties: {
          weekLabel:   { type: "string", description: "Short label, e.g. \"Apr 27\"" },
          weekDate:    { type: "string", description: "ISO Monday date, e.g. \"2026-04-27\"" },
          brief:       { type: "string", description: "Full markdown brief text" },
          allocations: {
            type: "object",
            description: "Allocation score per asset. Values must be -1, -0.5, 0, 0.5, or 1.",
            required: ASSET_KEYS,
            properties: Object.fromEntries(ASSET_KEYS.map(k => [k, { type: "number" }])),
          },
        },
      },
    }],
    tool_choice: { type: "tool", name: "submit_brief" },
    messages: [{ role: "user", content: buildUserPrompt(liveJson, historyJson) }],
  };

  return withRetry(async () => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      onStatus?.("Generating brief with Anthropic…");
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
          "content-type":      "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const err = new Error(
        RETRYABLE.has(resp.status)
          ? `Anthropic servers busy (${resp.status}) — retrying…`
          : `Anthropic API ${resp.status}: ${txt}`
      );
      err.retryable = RETRYABLE.has(resp.status);
      throw err;
    }

    const data    = await resp.json();
    const toolUse = (data.content || []).find(b => b.type === "tool_use");
    if (!toolUse) throw new Error("Anthropic response contained no tool_use block");
    return toolUse.input;
  }, "Anthropic", onStatus);
}

// ---------- OpenAI ----------

async function callOpenAI(liveJson, historyJson, model, apiKey, onStatus) {
  const jsonSchema = {
    type: "object",
    required: ["weekLabel", "weekDate", "brief", "allocations"],
    properties: {
      weekLabel:   { type: "string" },
      weekDate:    { type: "string" },
      brief:       { type: "string" },
      allocations: {
        type: "object",
        required: ASSET_KEYS,
        properties: Object.fromEntries(ASSET_KEYS.map(k => [k, { type: "number" }])),
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };

  const body = {
    model,
    max_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: { name: "macro_brief", strict: true, schema: jsonSchema },
    },
    messages: [
      { role: "system",  content: SYSTEM_PROMPT },
      { role: "user",    content: buildUserPrompt(liveJson, historyJson) },
    ],
  };

  return withRetry(async () => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      onStatus?.("Generating brief with OpenAI…");
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const err = new Error(
        RETRYABLE.has(resp.status)
          ? `OpenAI servers busy (${resp.status}) — retrying…`
          : `OpenAI API ${resp.status}: ${txt}`
      );
      err.retryable = RETRYABLE.has(resp.status);
      throw err;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response had no content");
    return JSON.parse(text);
  }, "OpenAI", onStatus);
}

// ---------- file writers ----------
// All writes go to userDocsRoot (userData/docs) — the bundle is read-only inside .asar.
// The app:// protocol handler checks userDocsRoot first, then falls back to the bundle.

function writeBriefFile(userDocsRoot, slug, markdown) {
  const briefsDir = path.join(userDocsRoot, "briefs");
  fs.mkdirSync(briefsDir, { recursive: true });
  fs.writeFileSync(path.join(briefsDir, `${slug}.md`), markdown, "utf8");
}

function updateBriefIndex(userDocsRoot, docsRoot, slug, title, date) {
  const userPath   = path.join(userDocsRoot, "briefs", "index.json");
  const bundlePath = path.join(docsRoot,     "briefs", "index.json");
  let index = { briefs: [] };
  try       { index = JSON.parse(fs.readFileSync(userPath,   "utf8")); }
  catch     { try { index = JSON.parse(fs.readFileSync(bundlePath, "utf8")); } catch {} }

  const note = index._note;
  const list = (index.briefs || []).filter(b => b.slug !== slug);
  list.unshift({ slug, title, date });
  const out = note ? { _note: note, briefs: list } : { briefs: list };
  fs.mkdirSync(path.join(userDocsRoot, "briefs"), { recursive: true });
  fs.writeFileSync(userPath, JSON.stringify(out, null, 2) + "\n", "utf8");
}

function updateHistory(userDocsRoot, docsRoot, weekLabel, weekDate, allocations) {
  const userPath   = path.join(userDocsRoot, "data", "history.json");
  const bundlePath = path.join(docsRoot,     "data", "history.json");
  let history;
  try   { history = JSON.parse(fs.readFileSync(userPath,   "utf8")); }
  catch { history = JSON.parse(fs.readFileSync(bundlePath, "utf8")); }

  const weeks     = history.weeks     || [];
  const weekDates = history.weekDates || [];

  // ±5 day overwrite rule
  const newMs  = new Date(weekDate).getTime();
  const lastMs = weekDates.length ? new Date(weekDates[weekDates.length - 1]).getTime() : 0;
  const overwrite = Math.abs(newMs - lastMs) <= 5 * 24 * 60 * 60 * 1000;

  if (overwrite && weeks.length) {
    weeks[weeks.length - 1]         = weekLabel;
    weekDates[weekDates.length - 1] = weekDate;
    for (const asset of history.assets) {
      const score = allocations[asset.key];
      if (score !== undefined && VALID_SCORES.has(score)) {
        asset.alloc[asset.alloc.length - 1] = score;
      }
    }
  } else {
    weeks.push(weekLabel);
    weekDates.push(weekDate);
    for (const asset of history.assets) {
      const score = allocations[asset.key];
      asset.alloc.push(VALID_SCORES.has(score) ? score : 0);
    }
  }

  history.weeks     = weeks;
  history.weekDates = weekDates;
  fs.mkdirSync(path.join(userDocsRoot, "data"), { recursive: true });
  fs.writeFileSync(userPath, JSON.stringify(history, null, 2) + "\n", "utf8");
}

// ---------- main export ----------

async function generate({ docsRoot, userDocsRoot, liveJson, historyJson, provider, model, apiKey, onStatus }) {
  let result;
  if (provider === "anthropic") {
    result = await callAnthropic(liveJson, historyJson, model, apiKey, onStatus);
  } else if (provider === "openai") {
    result = await callOpenAI(liveJson, historyJson, model, apiKey, onStatus);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const { weekLabel, weekDate, brief, allocations } = result;

  if (!weekLabel || !weekDate || !brief || !allocations) {
    throw new Error("AI response missing required fields (weekLabel, weekDate, brief, allocations)");
  }

  const slug  = weekDate.slice(0, 10);
  const title = `Weekly Macro Brief — ${new Date(weekDate + "T12:00:00Z")
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  writeBriefFile(userDocsRoot, slug, brief);
  updateBriefIndex(userDocsRoot, docsRoot, slug, title, slug);
  updateHistory(userDocsRoot, docsRoot, weekLabel, weekDate, allocations);

  return { slug, title, date: slug };
}

module.exports = { generate };
