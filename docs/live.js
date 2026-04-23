// ==============================================================================
// live.js — thin loader for pre-fetched live market data.
//
// The actual data is fetched server-side by GitHub Actions (see
// .github/workflows/fetch-live.yml) and committed to docs/data/live.json. This
// avoids the CORS restrictions on FRED and Yahoo that made the earlier
// browser-side fetcher unreliable.
//
// Exports: window.Live.load() -> Promise<liveJson>
//   liveJson shape: {
//     fetchedAt: ISO string,
//     schemaVersion: 1,
//     assets: { <key>: { value, asOf, source } | { error } }
//   }
// ==============================================================================

(function () {
  async function load() {
    const r = await fetch("data/live.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`data/live.json: HTTP ${r.status}`);
    return r.json();
  }

  window.Live = { load };
})();
