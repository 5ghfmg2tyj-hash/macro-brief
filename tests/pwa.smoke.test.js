"use strict";

const fs   = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");

test("index.html has no install button", () => {
  const dom = new JSDOM(HTML);
  const btn = dom.window.document.getElementById("install-btn");
  expect(btn).toBeNull();
});

test("index.html has no pwa.js script tag", () => {
  expect(HTML).not.toMatch(/pwa\.js/);
});

test("index.html has no service-worker reference", () => {
  expect(HTML).not.toMatch(/service-worker/);
});

test("index.html has no manifest link", () => {
  expect(HTML).not.toMatch(/manifest\.webmanifest/);
});

test("five tabs are present (including Settings)", () => {
  const dom  = new JSDOM(HTML);
  const tabs = dom.window.document.querySelectorAll(".tab[data-tab]");
  expect(tabs.length).toBe(5);
  const tabNames = Array.from(tabs).map(t => t.dataset.tab);
  expect(tabNames).toContain("settings");
});
