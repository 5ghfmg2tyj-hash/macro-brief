/**
 * Smoke tests for PWA behaviour: service worker registration and install button.
 * Uses jsdom to create a real DOM from index.html and evaluate pwa.js inside it.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML    = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");
const PWA_JS  = fs.readFileSync(path.resolve(__dirname, "../docs/pwa.js"),     "utf8");

/** Build a JSDOM instance with mocked SW support. Returns { dom, registerMock }. */
function buildDOM() {
  const registerMock = jest.fn().mockResolvedValue({
    update: jest.fn().mockResolvedValue(undefined),
  });

  const dom = new JSDOM(HTML, { runScripts: "dangerously" });
  const { window } = dom;

  // jsdom doesn't implement matchMedia or serviceWorker — provide minimal stubs.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: false }),
  });

  Object.defineProperty(window.navigator, "serviceWorker", {
    writable: true,
    configurable: true,
    value: {
      register: registerMock,
      addEventListener: jest.fn(),
    },
  });

  // Evaluate pwa.js inside the window context (sets up listeners synchronously).
  window.eval(PWA_JS);

  return { dom, window, registerMock };
}

// ---------------------------------------------------------------------------

test("install button is present in the DOM and hidden by default", () => {
  const dom = new JSDOM(HTML);
  const btn = dom.window.document.getElementById("install-btn");
  expect(btn).not.toBeNull();
  expect(btn.hidden).toBe(true);
});

test("service worker register() is called when load fires", async () => {
  const { registerMock } = buildDOM();

  // jsdom fires the window load event asynchronously after parsing; wait for it.
  await new Promise((r) => setTimeout(r, 50));

  expect(registerMock).toHaveBeenCalled();
  expect(registerMock).toHaveBeenCalledWith("service-worker.js", { scope: "./" });
});

test("install button becomes visible after beforeinstallprompt", () => {
  const { window } = buildDOM();

  const btn = window.document.getElementById("install-btn");
  expect(btn.hidden).toBe(true);

  // Simulate the browser firing beforeinstallprompt.
  const evt = new window.Event("beforeinstallprompt");
  evt.preventDefault = jest.fn();
  window.dispatchEvent(evt);

  expect(btn.hidden).toBe(false);
});

test("install button stays hidden when already running as standalone PWA", () => {
  const { window } = buildDOM();

  // Override matchMedia to report standalone mode, then re-evaluate pwa.js.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: true }), // display-mode: standalone
  });

  const dom2 = new JSDOM(HTML, { runScripts: "dangerously" });
  Object.defineProperty(dom2.window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  });
  Object.defineProperty(dom2.window.navigator, "serviceWorker", {
    writable: true,
    configurable: true,
    value: { register: jest.fn().mockResolvedValue({ update: jest.fn() }), addEventListener: jest.fn() },
  });
  dom2.window.eval(PWA_JS);

  // Fire beforeinstallprompt — button should stay hidden because we're standalone.
  const evt = new dom2.window.Event("beforeinstallprompt");
  evt.preventDefault = jest.fn();
  dom2.window.dispatchEvent(evt);

  const btn = dom2.window.document.getElementById("install-btn");
  expect(btn.hidden).toBe(true);
});
