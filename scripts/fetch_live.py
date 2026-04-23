#!/usr/bin/env python3
"""
fetch_live.py — pull latest market data for each asset in history.json and
write a flat JSON file the frontend can load without any CORS pain.

Runs server-side (in GitHub Actions). No API keys required.

Usage:
    python scripts/fetch_live.py docs/data/live.json docs/data/history.json
"""

import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

UA = "Mozilla/5.0 (compatible; macro-brief/1.0; +https://github.com)"

TIMEOUT = 20
SLEEP_BETWEEN = 0.25  # be polite to hosts


def _get(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# -------------- per-source fetchers --------------
def fetch_yahoo(symbol):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d"
    data = json.loads(_get(url))
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        raise ValueError("no result")
    meta = result[0].get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError("no regularMarketPrice")
    ts = meta.get("regularMarketTime")
    as_of = datetime.fromtimestamp(ts, timezone.utc).date().isoformat() if ts else None
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    return {
        "value": float(price),
        "asOf": as_of,
        "prevClose": float(prev) if prev is not None else None,
        "source": f"Yahoo ({symbol})",
    }


def fetch_fred(series, unit_scale=None):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    csv = _get(url).decode("utf-8", errors="replace")
    lines = [ln for ln in csv.strip().splitlines() if ln]
    if len(lines) < 2:
        raise ValueError("empty CSV")
    for line in reversed(lines[1:]):  # skip header
        parts = line.split(",")
        if len(parts) < 2:
            continue
        date, raw = parts[0].strip(), parts[1].strip()
        if raw and raw != ".":
            try:
                val = float(raw)
                if unit_scale:
                    val *= unit_scale
                return {"value": val, "asOf": date, "source": f"FRED ({series})"}
            except ValueError:
                continue
    raise ValueError("no valid rows")


def fetch_stooq(symbol):
    url = f"https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv"
    csv = _get(url).decode("utf-8", errors="replace")
    lines = csv.strip().splitlines()
    if len(lines) < 2:
        raise ValueError("no rows")
    parts = lines[1].split(",")
    if len(parts) < 7:
        raise ValueError(f"short row: {lines[1]!r}")
    try:
        return {
            "value": float(parts[6]),
            "asOf": parts[1],
            "source": f"Stooq ({symbol})",
        }
    except ValueError:
        raise ValueError(f"bad close: {parts[6]!r}")


def fetch_coingecko(coin_id):
    url = (
        f"https://api.coingecko.com/api/v3/simple/price"
        f"?ids={coin_id}&vs_currencies=usd&include_last_updated_at=true"
    )
    data = json.loads(_get(url))
    o = data.get(coin_id)
    if not o or "usd" not in o:
        raise ValueError("no price")
    ts = o.get("last_updated_at")
    as_of = datetime.fromtimestamp(ts, timezone.utc).date().isoformat() if ts else None
    return {"value": float(o["usd"]), "asOf": as_of, "source": f"CoinGecko ({coin_id})"}


# -------------- orchestration --------------
def _try(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return None, f"URL {getattr(e, 'reason', e)}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def fetch_one(asset):
    live = asset.get("live") or {}
    errors = []
    pri = live.get("source")

    # Primary
    if pri == "yahoo" and live.get("symbol"):
        r, err = _try(fetch_yahoo, live["symbol"])
        if r: return r
        errors.append(f"{pri}: {err}")
    elif pri == "fred" and live.get("fredSeries"):
        r, err = _try(fetch_fred, live["fredSeries"], live.get("unitScale"))
        if r: return r
        errors.append(f"{pri}: {err}")
    elif pri == "stooq" and live.get("symbol"):
        r, err = _try(fetch_stooq, live["symbol"])
        if r: return r
        errors.append(f"{pri}: {err}")
    elif pri == "coingecko" and live.get("id"):
        r, err = _try(fetch_coingecko, live["id"])
        if r: return r
        errors.append(f"{pri}: {err}")

    # Fallbacks
    if live.get("yahooFallback"):
        r, err = _try(fetch_yahoo, live["yahooFallback"])
        if r: return r
        errors.append(f"yahoo-fb: {err}")
    if live.get("fredSeries") and pri != "fred":
        r, err = _try(fetch_fred, live["fredSeries"], live.get("unitScale"))
        if r: return r
        errors.append(f"fred-fb: {err}")
    if live.get("coingeckoFallback"):
        r, err = _try(fetch_coingecko, live["coingeckoFallback"])
        if r: return r
        errors.append(f"cg-fb: {err}")
    if live.get("stooqFallback"):
        r, err = _try(fetch_stooq, live["stooqFallback"])
        if r: return r
        errors.append(f"stooq-fb: {err}")

    return {"error": " · ".join(errors) or "no source configured"}


def main():
    if len(sys.argv) < 3:
        print("Usage: fetch_live.py <out.json> <history.json>", file=sys.stderr)
        sys.exit(2)
    out_path, hist_path = sys.argv[1], sys.argv[2]

    with open(hist_path, "r", encoding="utf-8") as f:
        history = json.load(f)

    results = {}
    for asset in history["assets"]:
        key = asset["key"]
        print(f"  {key:9s} ... ", end="", flush=True)
        try:
            r = fetch_one(asset)
            results[key] = r
            if "value" in r:
                print(f"{r['value']!r:>12}  [{r.get('source','?')}]")
            else:
                print(f"ERR  {r.get('error','?')}")
        except Exception as e:
            results[key] = {"error": f"orchestrator: {e}"}
            print(f"ORCHESTRATOR ERR  {e}")
        time.sleep(SLEEP_BETWEEN)

    out = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schemaVersion": 1,
        "notes": "Generated by scripts/fetch_live.py via GitHub Actions.",
        "assets": results,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"\nWrote {out_path} ({len(results)} assets)")


if __name__ == "__main__":
    main()
