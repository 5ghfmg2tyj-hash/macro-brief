"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function makeResponse(body, { json = true } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => (json ? JSON.parse(body) : body),
    text: async () => body,
    headers: { get: () => null },
  };
}

test("money flow snapshot uses the latest populated flow date when trailing rows are null", async () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");
  const chartJs = fs.readFileSync(path.resolve(__dirname, "../docs/chart.js"), "utf8");
  const liveJs = fs.readFileSync(path.resolve(__dirname, "../docs/live.js"), "utf8");
  const appJs = fs.readFileSync(path.resolve(__dirname, "../docs/app.js"), "utf8");
  const history = fs.readFileSync(path.resolve(__dirname, "../docs/data/history.json"), "utf8");
  const flows = fs.readFileSync(path.resolve(__dirname, "../docs/data/flows.json"), "utf8");
  const briefs = JSON.stringify({ briefs: [] });
  const daily = JSON.stringify({
    updatedAt: "2026-06-18T23:35:46Z",
    series: [
      { date: "2026-06-03", flows: { usLarge: 1.0, usSmid: 0.1, cash: 0.2 } },
      { date: "2026-06-04", flows: { usLarge: 2.0, usSmid: 0.2, cash: 0.3 } },
      { date: "2026-06-05", flows: { usLarge: null, usSmid: null, cash: null } },
      { date: "2026-06-18", flows: { usLarge: null, usSmid: null, cash: null } },
    ],
  });

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "file:///Users/ipman/Codex/macro-brief-latest/docs/index.html",
  });
  const { window } = dom;

  window.fetch = async (resource) => {
    if (resource === "data/history.json") return makeResponse(history);
    if (resource === "data/flows.json") return makeResponse(flows);
    if (resource === "data/daily-flows.json") return makeResponse(daily);
    if (resource === "data/shares-history.json") return makeResponse("{}", { json: true });
    if (resource === "briefs/index.json") return makeResponse(briefs);
    if (String(resource).startsWith("briefs/")) return makeResponse("", { json: false });
    throw new Error(`Unexpected fetch: ${resource}`);
  };
  window.macroBrief = { isElectron: false };

  window.eval(liveJs);
  window.eval(chartJs);
  window.eval(appJs);

  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 25));

  const snapshotText = window.document.getElementById("flow-snapshot").textContent.replace(/\s+/g, " ");
  expect(snapshotText).toContain("US Large Cap");
  expect(snapshotText).toContain("+3.00B");
  expect(snapshotText).not.toContain("US Large Cap SPY+IVV+VOO — — — —");
});
