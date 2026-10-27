"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const history = require("../docs/data/history.json");

test("published allocation history is aligned and current through the retrospective", () => {
  expect(history.weeks).toHaveLength(history.weekDates.length);
  expect(history.weekDates.at(-1)).toBe("2026-10-23");

  for (const asset of history.assets) {
    expect(asset.alloc).toHaveLength(history.weekDates.length);
    expect(asset.alloc.every((score) => score === null || [-1, -0.5, 0, 0.5, 1].includes(score))).toBe(true);
    for (const field of ["vals", "wowVals", "moVals", "yrVals"]) {
      expect(asset[field]).toHaveLength(history.weekDates.length);
      expect(asset[field].every(Number.isFinite)).toBe(true);
    }
  }

  const nasdaq = history.assets.find((asset) => asset.key === "nasdaq");
  expect(nasdaq).toMatchObject({ idx: "Nasdaq-100", flowIdx: expect.stringContaining("QQQ + QQQM") });
  expect(nasdaq.alloc.every((score) => score === null)).toBe(true);
});

test("tilt chart visibly extends through October 23", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");
  const chartJs = fs.readFileSync(path.resolve(__dirname, "../docs/chart.js"), "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously" });

  dom.window.eval(chartJs);
  dom.window.Chart.init({ history, flows: {}, dailyFlows: { series: [] } });

  expect(dom.window.document.getElementById("subtitle").textContent).toContain("Oct 23");
  const labels = [...dom.window.document.querySelectorAll("#chart text")].map((node) => node.textContent);
  expect(labels).toContain("Oct 23");

  const points = [...dom.window.document.querySelectorAll("#chart path")]
    .filter((node) => node.style.cursor === "pointer");
  const tooltipNode = dom.window.document.getElementById("tooltip");
  Object.defineProperty(tooltipNode, "offsetParent", {
    configurable: true,
    value: dom.window.document.body,
  });
  points.at(-1).dispatchEvent(new dom.window.MouseEvent("mousemove", {
    bubbles: true,
    clientX: 400,
    clientY: 300,
  }));
  const tooltip = tooltipNode.textContent.replace(/\s+/g, " ");
  expect(tooltip).toContain("Oct 23");
  expect(tooltip).toContain("WoW");
  expect(tooltip).toContain("1M");
  expect(tooltip).toContain("1Y");
  expect(tooltip).toContain("Nasdaq / US GrowthNasdaq-100");
  expect(tooltip).toContain("n/a");
  expect(tooltip).not.toContain("$n/a");
});
