# Macro Brief

Static PWA that renders the weekly macro allocation brief — interactive tilt/flows chart, live market data, and the full text of each week's note. Installable from the browser on iOS, Android, macOS, Windows, and Linux.

## Live site

```
https://<your-github-username>.github.io/macro-brief/
```

## Install as an app

- **Chrome / Edge / Android:** an **Install** button appears in the header. Click it to add to your home screen or desktop.
- **iOS / Safari:** tap the Share icon → **Add to Home Screen** → **Add**. The app opens full-screen with its own icon.
- **Already installed?** The install button is hidden automatically.

## What's inside

```
macro-brief/
├── README.md
├── scripts/
│   ├── fetch_live.py               # Python fetcher (run by launchd)
│   ├── fetch_and_push.sh           # Shell wrapper: fetch → diff → commit → push
│   ├── com.macro-brief.fetch.plist # launchd LaunchAgent template
│   ├── install_cron.sh             # Install / uninstall the launchd job
│   └── generate_icons.py           # One-off: generate PWA icon set from a source image
└── docs/                           # GitHub Pages serves this folder
    ├── index.html                  # App shell (tabs, panels, install overlay)
    ├── styles.css                  # Dark theme + grid/chips/tooltip/PWA chrome
    ├── app.js                      # Wiring: tabs, data load, brief reader, live refresh
    ├── chart.js                    # Tilt/Flows SVG chart (data-driven)
    ├── live.js                     # Loader that reads data/live.json
    ├── pwa.js                      # Service worker registration + install button logic
    ├── service-worker.js           # Offline cache (shell: cache-first; data: network-first)
    ├── manifest.webmanifest        # PWA manifest (icons, shortcuts, display mode)
    ├── icons/                      # PWA icon set (192, 512, maskable-512, 180, favicon)
    └── data/
        ├── history.json            # Weekly allocation tilts + representative index values
        ├── flows.json              # Weekly net fund flows ($B)
        └── live.json               # Pre-fetched live quotes (rewritten by the local cron)
    └── briefs/
        ├── index.json              # Newest-first listing
        └── 2026-04-20.md           # One markdown file per brief
```

No package.json, no node_modules, no build step. Just commit and push.

## First-time GitHub Pages setup

1. Create a new GitHub repo named `macro-brief`.
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

GitHub Pages redeploys in ~30–60 seconds.

## Live data pipeline

Live quotes are fetched server-side by a Python script running on a **local launchd cron**, then auto-committed and pushed so the deployed GitHub Pages site stays fresh.

### How it works

```
launchd (every 30 min, weekdays)
  └── scripts/fetch_and_push.sh
        ├── runs scripts/fetch_live.py  → writes docs/data/live.json
        ├── diffs live.json (skips commit if only fetchedAt changed)
        ├── git commit -m "chore: refresh live.json …"
        └── git push
```

The frontend just reads `data/live.json` on page load (and on **Reload** button press). No CORS, no API keys, no backend to host.

### Install the launchd job

```bash
# One-time install from the repo root:
./scripts/install_cron.sh

# Verify it's loaded:
launchctl list | grep macro-brief

# Run immediately (don't wait for the next :00 or :30):
launchctl start com.macro-brief.fetch

# Tail the log:
tail -f ~/Library/Logs/macro-brief/fetch.log

# Uninstall:
./scripts/install_cron.sh uninstall
```

The installer substitutes the absolute repo path into `com.macro-brief.fetch.plist` and copies it to `~/Library/LaunchAgents/`.

**Schedule:** every 30 minutes on weekdays (`:00` and `:30`), all hours. After-hours runs are cheap — the script detects "no meaningful change" and exits without committing.

### Run manually

```bash
# From the repo root:
./scripts/fetch_and_push.sh
```

Useful after a holiday, a weekend, or any gap in coverage.

### Sources

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

If both primary and fallback fail, the asset's entry in `live.json` gets an `error` field and the Live tab renders an error card for that asset while the rest render cleanly.

### Python dependencies

```bash
pip3 install requests yfinance
```

(`urllib` is used for FRED; `yfinance` for Yahoo; `requests` for CoinGecko.)

### Git auth for auto-push

The cron pushes over HTTPS or SSH, whichever your repo remote is configured to use. Make sure the credential helper (macOS Keychain) or SSH key is set up so that `git push` works without a prompt:

```bash
# Verify from the repo root:
git push --dry-run
```

## Local preview

Because the app loads JSON via `fetch()`, you need a local HTTP server:

```bash
cd docs
python3 -m http.server 8080
# Open http://localhost:8080
```

Or use any static server (`npx serve`, VS Code Live Server, etc.).

## Tabs

- **Chart** — full allocation history. Toggle between **Tilt** (allocation score, −1 to +1) and **Flows** (weekly net fund flows in $B). Filter by group, toggle individual assets.
- **Live data** — current prices/yields/spreads from `live.json`. Click **Reload** to re-read the file.
- **This week's brief** — full markdown text of the latest brief. Click any prior brief to load it.
- **About** — data sources, update cadence, offline support.

## Offline support

A service worker caches the app shell (HTML/CSS/JS/icons) so Macro Brief loads instantly and works offline. Live data and briefs are fetched network-first; the last cached copy is served when offline.

Cache version is controlled by `CACHE_VERSION` in `service-worker.js` — bump it whenever app-shell assets change.

## Why not a framework?

The app has ~11 assets, ~4 weekly points per asset, 3 tabs, and 1 chart. A framework would be pure overhead. Every file is directly editable and debuggable — no sourcemaps, no transpile step, no `npm install` before you can change a color.

## License

Private / personal use.
