// ==============================================================================
// pwa.js — service worker registration + install button wiring.
// Runs last (after app.js) so the DOM is fully built and tabs work.
// ==============================================================================

(function () {
  // ---------- platform detection ----------
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;

  // macOS Safari: excludes Chrome, Edge, and Firefox even when they include
  // "Safari" in their UA strings.
  const isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) &&
                      !/Chrome|Chromium|CriOS|FxiOS|EdgA|Firefox/.test(ua);

  // Safari 26+ supports beforeinstallprompt natively; 17–25 needs "Add to Dock".
  const safariVersion = parseInt((ua.match(/Version\/(\d+)/) || [])[1]) || 0;
  const isMacSafariLegacy = isMacSafari && safariVersion >= 17 && safariVersion < 26;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  // ---------- register service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("service-worker.js", { scope: "./" })
        .then((reg) => {
          // Check for new SW version on each load.
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn("SW registration failed:", err);
        });

      // Reload when the new SW takes over, so fresh shell loads.
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  // ---------- install button ----------
  const installBtn   = document.getElementById("install-btn");
  const iosSheet     = document.getElementById("ios-sheet");
  const iosCloseBtn  = document.getElementById("ios-close");
  const aboutHint    = document.getElementById("install-ios-hint");

  // Capture Android/Chrome/Edge install prompt.
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone && installBtn) installBtn.hidden = false;
  });

  // iOS + macOS Safari 17–25: no beforeinstallprompt; show button immediately.
  if ((isIOS || isMacSafariLegacy) && !isStandalone && installBtn) {
    installBtn.hidden = false;
    if (aboutHint) aboutHint.hidden = false;
    // Pre-configure the sheet for the right platform.
    const iosSteps = document.getElementById("install-ios-steps");
    const macSteps = document.getElementById("install-mac-steps");
    if (isMacSafariLegacy && iosSteps && macSteps) {
      iosSteps.hidden = true;
      macSteps.hidden = false;
    }
  }
  // Safari 26+ and Firefox 128+ fire beforeinstallprompt; handled above.

  // Hide install button when the app is already running as a PWA.
  if (isStandalone && installBtn) installBtn.hidden = true;

  // Button click: either fire the browser prompt or open the iOS sheet.
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          deferredPrompt = null;
          if (choice.outcome === "accepted") installBtn.hidden = true;
        } catch (err) {
          // Browser throttled or cancelled the prompt — fall through to sheet.
          console.warn("Install prompt failed:", err);
          deferredPrompt = null;
          if (iosSheet) iosSheet.hidden = false;
        }
        return;
      }
      // No deferred prompt: show manual-install sheet for any platform.
      if (iosSheet) iosSheet.hidden = false;
    });
  }

  if (iosCloseBtn && iosSheet) {
    iosCloseBtn.addEventListener("click", () => { iosSheet.hidden = true; });
    iosSheet.addEventListener("click", (e) => {
      if (e.target === iosSheet) iosSheet.hidden = true;
    });
  }

  // After successful install, drop the button.
  window.addEventListener("appinstalled", () => {
    if (installBtn) installBtn.hidden = true;
    deferredPrompt = null;
  });

  // ---------- hash-based deep links (for manifest shortcuts) ----------
  // manifest defines shortcuts like #brief and #live — map those to tabs.
  function openTabFromHash() {
    const h = (window.location.hash || "").replace(/^#/, "");
    if (!h) return;
    const tab = document.querySelector(`.tab[data-tab="${h}"]`);
    if (tab) tab.click();
  }
  window.addEventListener("hashchange", openTabFromHash);
  // Slight delay so app.js initTabs has definitely run.
  setTimeout(openTabFromHash, 50);
})();
