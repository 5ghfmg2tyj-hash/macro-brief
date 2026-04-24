// ==============================================================================
// service-worker.js — offline cache for Macro Brief PWA
// ==============================================================================
// Strategy:
//   * App shell (HTML/CSS/JS/manifest/icons) — cache-first.
//   * Data + briefs (JSON/MD)              — network-first with cache fallback.
// Bump CACHE_VERSION whenever app-shell assets change so old clients re-fetch.
// ==============================================================================

const CACHE_VERSION = "v5";
const SHELL_CACHE   = `macro-brief-shell-${CACHE_VERSION}`;
const DATA_CACHE    = `macro-brief-data-${CACHE_VERSION}`;

// Relative to scope (registered at ./service-worker.js).
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./chart.js",
  "./live.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-180.png",
  "./icons/favicon.png"
];

// ---------- install: pre-cache app shell ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ---------- activate: drop old caches ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== SHELL_CACHE && k !== DATA_CACHE) return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- fetch: route by URL shape ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only manage same-origin (don't interfere with cross-origin CDN hits, if any).
  if (url.origin !== self.location.origin) return;

  // Data + briefs — network first, cache fallback.
  if (
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".md") ||
    url.pathname.includes("/data/") ||
    url.pathname.includes("/briefs/")
  ) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Everything else (HTML, CSS, JS, icons) — cache first.
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

// ---------- strategies ----------
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    // Navigation fallback for SPA-like offline: serve index.html if available.
    if (request.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

// ---------- manual cache bust trigger from the page ----------
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  if (event.data === "clearCache") {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
});
