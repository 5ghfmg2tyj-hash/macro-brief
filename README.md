# Macro Brief

Static web app that renders the weekly macro allocation brief — historical tilt chart, live market data, and the full text of each week's note.

Built as a vanilla HTML/JS/CSS site with no build step. Hosted on GitHub Pages from the `/docs` folder on `main`, matching the same workflow as the Meeting Mate project.

## Live site

After following the setup below, the site will be available at:

```
https://<your-github-username>.github.io/macro-brief/
```

## What's inside

```
macro-brief/
├── README.md
└── docs/                       <-- GitHub Pages serves this folder
    ├── index.html              <-- app shell (tabs, panels)
    ├── styles.css              <-- dark theme + grid/chips/tooltip
    ├── app.js                  <-- wiring (tabs, data load, brief reader, live refresh)
    ├── chart.js                <-- Tilt/Flows SVG chart (data-driven)
    ├── live.js                 <-- CORS-safe fetchers (FRED / Yahoo / Stooq / CoinGecko)
    ├── data/
    │   ├── history.json        <-- weekly allocation tilts + representative index values
    │   └── flows.json          <-- weekly net fund flows ($B)
    └── briefs/
        ├── index.json          <-- newest-first listing
        └── 2026-04-20.md       <-- one markdown file per brief
```

No package.json, no node_modules, no build step. Just commit and push.

## First-time GitHub Pages setup

1. Create a new GitHub repo named `macro-brief` (or whatever you like — just update the URL references below).
2. From the folder that contains this README:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: macro brief app scaffold"
   git branch -M main
   git remote add origin https://github.com/<your-username>/macro-brief.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment**
   - **Source:** Deploy from a branch
   - **Branch:** `main` / `/docs`
   - Save.
4. Wait ~1 minute, then visit `https://<your-username>.github.io/macro-brief/`.

That's it — exactly the pattern you use for Meeting Mate.

## Weekly update workflow

Each Monday, the scheduled macro-brief task produces three outputs:

1. An updated `allocation_history.json` (matches `docs/data/history.json` schema).
2. An updated flows table (matches `docs/data/flows.json`).
3. A `Weekly_Macro_Brief_<date>.md`.

To publish the new week:

```bash
# From the macro-brief repo root:
cp /path/to/new/allocation_history.json docs/data/history.json
cp /path/to/new/flows.json              docs/data/flows.json
cp /path/to/new/Weekly_Macro_Brief_2026-04-27.md docs/briefs/2026-04-27.md

# Edit docs/briefs/index.json — prepend the new entry at the top of "briefs".
# (Apply the ±5 day overwrite rule: if the new date is within 5 days of the top
#  entry, overwrite that entry instead of prepending.)

git add docs/
git commit -m "Weekly update: Apr 27, 2026"
git push
```

GitHub Pages redeploys in ~30–60 seconds. No cache-busting needed — the app uses `cache: "no-store"` on every fetch.

## Local preview

No build step, but because the app loads JSON via `fetch()`, you need a local HTTP server:

```bash
# From the repo root:
cd docs
python3 -m http.server 8080
# Open http://localhost:8080 in your browser.
```

Or use any static server (`npx serve`, VS Code Live Server, etc.).

## Tabs

- **Chart** — the full allocation history. Toggle between **Tilt** (allocation score, −1 to +1) and **Flows** (weekly net fund flows in $B). Filter by group, toggle individual assets on/off.
- **Live data** — current prices/yields/spreads pulled in the browser from public CORS endpoints (FRED CSV, Yahoo Finance chart API, Stooq, CoinGecko). No API keys. Click **Refresh now** to re-fetch.
- **This week's brief** — the full markdown text of the latest brief. Click any prior brief in the history list to load it.
- **About** — data sources, update cadence, link back to repo.

## Live data sources

| Asset | Primary | Fallback |
|---|---|---|
| S&P 500 | Yahoo `^GSPC` | — |
| IWM / EFA / EEM | Yahoo ticker | — |
| Gold spot | FRED `GOLDAMGBD228NLBM` | Yahoo `GC=F` |
| WTI crude | FRED `DCOILWTICO` | Yahoo `CL=F` |
| BTC | Yahoo `BTC-USD` | CoinGecko `bitcoin` |
| IG OAS | FRED `BAMLC0A0CM` (×100 → bps) | — |
| HY OAS | FRED `BAMLH0A0HYM2` (×100 → bps) | — |
| 10Y Treasury | FRED `DGS10` | — |
| Fed Funds upper | FRED `DFEDTARU` | — |

If a primary source fails (CORS, rate limit, network), the fallback runs automatically. If both fail, the card displays the error message and the rest of the grid still renders.

## Why not a framework?

The app has ~11 assets, ~4 weekly points per asset, 3 tabs, and 1 chart. A framework would be pure overhead. Every file on this site is directly editable and debuggable — no sourcemaps, no transpile step, no `npm install` before you can change a color.

If the app grows substantially (more interactive views, routing, complex state), Preact or Alpine can be added via a CDN import without changing the rest of the stack.

## License

Private / personal use.
