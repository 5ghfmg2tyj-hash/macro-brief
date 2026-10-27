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
    expect(asset.alloc.every((score) => [-1, -0.5, 0, 0.5, 1].includes(score))).toBe(true);
  }
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
});
