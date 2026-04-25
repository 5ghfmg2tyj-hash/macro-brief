# Macro Brief

Weekly macro allocation tracker — interactive tilt/flows chart, live market data, and full text of each week's brief. Runs as a **native macOS app** (Electron) with live data fetched directly from Yahoo Finance, FRED, and CoinGecko. Also deployable as a static PWA on GitHub Pages.

---

## Install on macOS (recommended)

1. Build the app (one-time, see **Build from source** below), or download `Macro Brief.dmg` from GitHub Releases.
2. Open the `.dmg`, drag **Macro Brief** to `/Applications`.
3. Launch from the Dock or Spotlight.

Live market data is fetched automatically every 30 minutes while the app is open — no browser, no server, no cron job needed.

---

## Build from source

```bash
git clone https://github.com/<your-username>/macro-brief.git
cd macro-brief
npm install
npm run dist        # → dist/Macro Brief-1.0.0.dmg
```

Or to run without packaging (dev mode):

```bash
npm start
```

### Requirements

- macOS 12+ (arm64 or x64)
- Node.js 18+ and npm

---

## Run as a hosted PWA (optional)

The `docs/` folder is a standalone static site. Deploy it to GitHub Pages for a browser-installable version:

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment**: source = `main` / `/docs`.
3. Visit `https://<your-username>.github.io/macro-brief/`.

For live data on the hosted PWA, run the local cron (see **Live data cron** below) — it writes `docs/data/live.json` and pushes it to GitHub; Pages redeploys in ~60 s.

---

## Weekly update workflow

Each Monday, copy the new outputs into the repo and push:

```bash
cp /path/to/allocation_history.json docs/data/history.json
cp /path/to/flows.json              docs/data/flows.json
cp /path/to/Weekly_Macro_Brief_2026-04-27.md docs/briefs/2026-04-27.md

# Edit docs/briefs/index.json — prepend the new entry (or overwrite if within ±5 days).

git add docs/
git commit -m "Weekly update: Apr 27, 2026"
git push
```

---

## Live data cron (PWA / GitHub Pages path only)

The Electron app fetches live data internally. If you use the hosted PWA, run the launchd cron on your Mac:

```bash
./scripts/install_cron.sh          # one-time install
launchctl list | grep macro-brief  # verify
launchctl start com.macro-brief.fetch  # run immediately
tail -f ~/Library/Logs/macro-brief/fetch.log
./scripts/install_cron.sh uninstall   # remove
```

Schedule: every 30 min on weekdays. The fetcher auto-commits and pushes `docs/data/live.json`.

---

## What's inside

```
macro-brief/
├── electron/
│   ├── main.js           # Electron main process — protocol, window, fetch scheduler
│   ├── preload.js        # Exposes window.macroBrief to renderer
│   ├── fetch-live.js     # Node port of fetch_live.py (Yahoo/FRED/Stooq/CoinGecko)
│   └── icon.icns         # macOS app icon (generated from docs/icons/icon-512.png)
├── scripts/
│   ├── fetch_live.py               # Python fetcher (used by launchd cron, PWA path)
│   ├── fetch_and_push.sh           # Shell wrapper: fetch → diff → commit → push
│   ├── com.macro-brief.fetch.plist # launchd LaunchAgent template
│   ├── install_cron.sh             # Install / uninstall the launchd job
│   ├── generate_icons.py           # One-off: generate PWA icon set
│   └── generate_icns.sh            # One-off: generate electron/icon.icns
└── docs/                           # GitHub Pages serves this folder (also bundled in app)
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── chart.js
    ├── live.js
    ├── pwa.js
    ├── service-worker.js
    ├── manifest.webmanifest
    ├── icons/
    └── data/
        ├── history.json
        ├── flows.json
        └── live.json
```

---

## Data sources

| Asset | Primary | Fallback |
|---|---|---|
| S&P 500 | Yahoo `^GSPC` | FRED `SP500` |
| IWM / EFA / EEM | Yahoo ticker | — |
| Gold spot | FRED `GOLDAMGBD228NLBM` | Yahoo `GC=F` |
| WTI crude | FRED `DCOILWTICO` | Yahoo `CL=F` |
| BTC | Yahoo `BTC-USD` | CoinGecko `bitcoin` |
| IG OAS | FRED `BAMLC0A0CM` (×100 → bps) | — |
| HY OAS | FRED `BAMLH0A0HYM2` (×100 → bps) | — |
| 10Y Treasury | FRED `DGS10` | — |
| Fed Funds upper | FRED `DFEDTARU` | — |

---

## Tabs

- **Chart** — allocation history. Toggle Tilt / Flows, filter by group, toggle assets.
- **Live data** — current prices/yields/spreads. Reload re-fetches from source.
- **This week's brief** — full markdown text. Prior briefs listed below.
- **About** — data sources, update cadence, offline support.

---

## License

Private / personal use.
